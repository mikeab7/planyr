/* verify-admin-parcel-coverage.mjs — NEW-1: the admin parcel-coverage map, driven in a real browser.
 *
 * Mounts the admin page (AdminApp — what AdminGate renders when is_admin() is true) on a throwaway
 * vite dev server and checks, against the SAME pure join the section uses (computed here in Node
 * from the live registry, so the expected values are never typed in):
 *   · the one-line total equals totalLine(buildCoverage(...).totals)
 *   · Harris TX is a FILLED shape reading "County's own server"; a known-unwired county is UNFILLED
 *   · a Florida county reads statewide; Lafayette Parish LA reads third-party
 *   · the "not drawn" list matches the join's notDrawn
 *   · zoom (wheel + button) changes the viewport transform; tap selects on a phone-width touch page
 *   · the page does not scroll sideways at phone width
 * KNOWN-GOOD ARM: Harris must read its known answer or the whole run is VOID, not scored.
 *
 * Run: node ui-audit/verify-admin-parcel-coverage.mjs
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import {
  COUNTIES, COUNTIES_MAP, countyKeyForName, statewideKeysForState, isStatewideLayerUrl,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { buildCoverage, totalLine, SOURCE_KIND_LABEL } from "../src/workspaces/admin/lib/parcelCoverage.js";

const EXEC = process.env.PW_CHROME || undefined;
const payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
await setCountyPolygons(payload);
const cov = buildCoverage(payload.counties, {
  countiesMap: COUNTIES_MAP, counties: COUNTIES, keyForName: countyKeyForName,
  statewideKeysForState, isStatewideUrl: isStatewideLayerUrl, verification: COUNTY_VERIFICATION,
});
const find = (state, name) => cov.rows.find((r) => r.state === state && r.name === name);
const harris = find("TX", "Harris");
const flCounty = cov.rows.find((r) => r.state === "FL" && r.wired);
const lafayette = find("LA", "Lafayette Parish");
const unwired = cov.rows.find((r) => !r.wired);
const expectReadout = (r) => (r.wired
  ? `${r.displayName} — ${SOURCE_KIND_LABEL[r.kind]}${r.publisherName ? ` · ${r.publisherName}` : ""}${r.host ? ` · reads from ${r.host}` : ""}`
  : `${r.displayName} — not wired for parcels.`);

const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) fails.push(name); };

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:5199/ui-audit/fixtures/admin-parcel-coverage.html";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* A screen point INSIDE a county's drawn shape that the browser really resolves to that shape
 * (a simplified neighbour can overlap it, so "inside the fill" is not enough). If the shape is too
 * small to hit at this zoom, wheel-zoom anchored on it until it is — what a person does. */
async function pointIn(page, i) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const hit = await page.evaluate((idx) => {
      const p = document.querySelector(`path[data-i="${idx}"]`);
      p.scrollIntoView({ block: "center", inline: "center" });
      const b = p.getBBox(), ctm = p.getScreenCTM();
      const rect = p.getBoundingClientRect();
      // a person zooms until the county is a comfortable target, and so does this
      if ((rect.width < 40 || rect.height < 40) && !window.__atMaxZoom) {
        return { center: [rect.x + rect.width / 2, rect.y + rect.height / 2] };
      }
      const found = [];
      for (let a = 0; a <= 24; a++) for (let c = 0; c <= 24; c++) {
        const pt = new DOMPoint(b.x + (b.width * a) / 24, b.y + (b.height * c) / 24);
        if (!p.isPointInFill(pt)) continue;
        const s = pt.matrixTransform(ctm);
        if (s.x < 24 || s.y < 24 || s.x > innerWidth - 24 || s.y > innerHeight - 96) continue; // keep clear of the screen edges
        if (document.elementFromPoint(s.x, s.y) === p) found.push([s.x, s.y]);
      }
      // the MEDIAN hit, not the first: a first hit sits on the shape's edge and a half-pixel move loses it
      if (found.length) return found[Math.floor(found.length / 2)];
      const r = p.getBoundingClientRect();
      return { center: [r.x + r.width / 2, r.y + r.height / 2] };
    }, i);
    if (Array.isArray(hit)) return hit;
    await page.mouse.move(hit.center[0], hit.center[1]);
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(120);
  }
  return null;
}

async function run(label, ctxOpts, phone) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|supabase/i.test(m.text())) errors.push(m.text()); });
  await page.goto(base, { waitUntil: "load" });
  await assertMeasurable(page, "verify-admin-parcel-coverage");
  await page.waitForSelector('[data-testid="parcel-coverage-map"] path', { timeout: 30000 });
  const sec = page.locator('[data-testid="parcel-coverage-section"]');
  await sec.scrollIntoViewIfNeeded();
  console.log(`\n── ${label} ──`);

  const total = (await page.locator('[data-testid="parcel-coverage-total"]').textContent()).trim();
  check("total line matches the pure join", total === totalLine(cov.totals), total);

  const fillOf = (i) => page.evaluate((idx) => getComputedStyle(document.querySelector(`path[data-i="${idx}"]`)).fill, i);
  const hFill = await fillOf(harris.index), uFill = await fillOf(unwired.index);
  check("known-wired county (Harris TX) is a filled shape", hFill !== "none" && (await page.locator(`path[data-i="${harris.index}"]`).getAttribute("data-wired")) === "1", hFill);
  check(`known-unwired county (${unwired.displayName}) is unfilled`, uFill === "none", uFill);

  const readout = async () => (await page.locator('[data-testid="parcel-coverage-readout"]').textContent()).trim();
  const probe = async (r, how) => {
    await page.getByRole("button", { name: "Reset map view" }).click(); // every probe starts from the whole-US view
    await page.waitForTimeout(100);
    const pt = await pointIn(page, r.index);
    if (!pt) { check(`${r.displayName}: found a point inside the shape`, false); return; }
    if (process.env.DBG) console.log("   point", pt, await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return [e && e.dataset && e.dataset.i, window.scrollY, document.querySelector('[data-testid="admin-app"]').scrollTop]; }, pt));
    if (how === "tap") await page.touchscreen.tap(pt[0], pt[1]);
    else { await page.mouse.move(pt[0] - 3, pt[1] - 3); await page.mouse.move(pt[0], pt[1], { steps: 3 }); }
    await page.waitForTimeout(150);
    const got = await readout();
    check(`${how} ${r.displayName}`, got === expectReadout(r), got);
  };
  const how = phone ? "tap" : "hover";
  await probe(harris, how);
  // KNOWN-GOOD ARM: if Harris did not read its known answer the run proves nothing.
  if (!(await readout()).includes("County's own server")) { console.log("VOID — known-good arm (Harris = own server) did not hold."); process.exitCode = 2; await ctx.close(); return false; }
  await probe(flCounty, how);
  await probe(lafayette, how);
  await probe(unwired, how);

  const nd = (await page.locator('[data-testid="parcel-coverage-notdrawn"]').textContent()).trim();
  check("not-drawn list matches", nd.startsWith(`${cov.notDrawn.length} wired entries not drawn: ${cov.notDrawn.join(", ")}`), nd);

  // Zoom: button, then wheel, each must change the viewport transform.
  const tf = () => page.locator('[data-testid="parcel-coverage-viewport"]').getAttribute("transform");
  await page.getByRole("button", { name: "Reset map view" }).click();
  const t0 = await tf();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const t1 = await tf();
  check("Zoom in changes the view", t1 !== t0, t1);
  const box = await page.locator('[data-testid="parcel-coverage-map"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);
  const t2 = await tf();
  check("wheel zoom changes the view", t2 !== t1, t2);
  await page.getByRole("button", { name: "Reset map view" }).click();
  check("Reset restores the view", (await tf()) === t0 && t0 === "translate(0 0) scale(1)", t0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways page scroll", overflow <= 0, `overflow ${overflow}`);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `/tmp/admin-parcel-coverage-${phone ? "phone" : "desktop"}.png`, fullPage: false });
  await ctx.close();
  return true;
}

try {
  await run("desktop", { viewport: { width: 1400, height: 900 } }, false);
  await run("phone width (touch)", { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, true);
} finally {
  await browser.close();
  await server.close();
}
if (process.exitCode === 2) process.exit(2);
console.log(fails.length ? `\nFAILED: ${fails.join("; ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
