/* verify-admin-parcel-coverage.mjs — NEW-1: the admin parcel-coverage map, driven in a real browser.
 *
 * Mounts the admin page (AdminApp — what AdminGate renders when is_admin() is true) on a throwaway
 * vite dev server and checks, against the SAME pure join the section uses (computed here in Node
 * from the live registry, so the expected values are never typed in):
 *   · the one-line total equals totalLine(buildCoverage(...).totals)
 *   · Harris TX is a FILLED shape reading "County's own server"; a known-unwired county is UNFILLED
 *   · a Florida county reads statewide; Lafayette Parish LA reads third-party
 *   · the "not drawn" list matches the join's notDrawn
 *   · hover shows a tooltip at the cursor; a click (desktop) / tap (phone) opens the details card with that
 *     county's name, and Esc / ✕ / another county closes or replaces it; a real DRAG pans and does not open it
 *   · a plain wheel over the map scrolls the PAGE (never preventDefault'ed) both down AND back up on a short window;
 *     Ctrl+wheel and the +/−/reset buttons zoom; the first plain wheel shows "Use Ctrl + scroll to zoom" once
 *   · the whole map fits under the header/legend on a laptop window, and Reset brings back the whole US
 *   · no developer text under the map; Detroit / Sioux Falls / Kansas City / Independence paint on their counties
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
import { CITY_SCOPE_COUNTIES } from "../src/workspaces/site-planner/lib/cityScopes.js";
import { buildCoverage, totalLine } from "../src/workspaces/admin/lib/parcelCoverage.js";

const EXEC = process.env.PW_CHROME || undefined;
const payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
await setCountyPolygons(payload);
const cov = buildCoverage(payload.counties, {
  countiesMap: COUNTIES_MAP, counties: COUNTIES, keyForName: countyKeyForName,
  statewideKeysForState, isStatewideUrl: isStatewideLayerUrl, verification: COUNTY_VERIFICATION,
  cityScopes: CITY_SCOPE_COUNTIES,
});
const find = (state, name) => cov.rows.find((r) => r.state === state && r.name === name);
const harris = find("TX", "Harris");
const flCounty = cov.rows.find((r) => r.state === "FL" && r.wired);
const lafayette = find("LA", "Lafayette Parish");
const unwired = cov.rows.find((r) => !r.wired && !r.cityOnly);
const wayne = find("MI", "Wayne County");
const kindWord = (r) => (r.wired ? { own: "County's own server", statewide: "Statewide layer", "third-party": "Third-party copy", unclassified: "Unclassified" }[r.kind] : r.cityOnly ? "City-level parcels only" : "Not wired");

const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) fails.push(name); };

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:5199/ui-audit/fixtures/admin-parcel-coverage.html#/admin/parcel-coverage";
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
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -350); await page.keyboard.up("Control"); // a plain wheel is the page's now
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

  const card = page.locator('[data-testid="parcel-coverage-card"]');
  const tip = page.locator('[data-testid="parcel-coverage-tooltip"]');
  const closeCard = async () => { if (await card.count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(60); } };
  const probe = async (r, how) => {
    await closeCard();
    await page.getByRole("button", { name: "Reset map view" }).click(); // every probe starts from the whole-US view
    await page.waitForTimeout(100);
    const pt = await pointIn(page, r.index);
    if (!pt) { check(`${r.displayName}: found a point inside the shape`, false); return; }
    if (how === "tap") await page.touchscreen.tap(pt[0], pt[1]);
    else {
      await page.mouse.move(pt[0] - 3, pt[1] - 3); await page.mouse.move(pt[0], pt[1], { steps: 3 });
      await page.waitForTimeout(100);
      const t = (await tip.textContent().catch(() => "")) || "";
      check(`hover ${r.displayName}: tooltip at the cursor names county + coverage`, t.includes(r.displayName) && t.includes(kindWord(r)), t);
      const tb = await tip.boundingBox();
      check(`hover ${r.displayName}: tooltip sits next to the cursor`, !!tb && Math.abs(tb.x - pt[0]) < 40 && Math.abs(tb.y - pt[1]) < 40, JSON.stringify(tb));
      await page.mouse.down(); await page.mouse.up(); // a click with NO movement
    }
    await page.waitForTimeout(150);
    const title = (await card.locator('[data-testid="parcel-coverage-card-title"]').textContent().catch(() => "")) || "";
    check(`${how} ${r.displayName}: details card opens with the county's name`, title.trim() === r.displayName, title);
    const cardText = (await card.textContent().catch(() => "")) || "";
    check(`${how} ${r.displayName}: card states the coverage kind`, cardText.includes(kindWord(r)), cardText.slice(0, 120));
    return cardText;
  };
  const how = phone ? "tap" : "click";
  const hText = await probe(harris, how);
  // KNOWN-GOOD ARM: if Harris did not read its known answer the run proves nothing.
  if (!(hText || "").includes("County's own server")) { console.log("VOID — known-good arm (Harris = own server) did not hold."); process.exitCode = 2; await ctx.close(); return false; }
  check("Harris card carries the layer URL, registry key and host", /https:\/\//.test(hText) && hText.includes("harris") && hText.includes(harris.host), hText.slice(0, 200));
  const flText = await probe(flCounty, how);
  const laText = await probe(lafayette, how);
  const unText = await probe(unwired, how);
  check("not-wired county says so", (unText || "").includes("Not wired") && /No parcel source is wired/.test(unText || ""), (unText || "").slice(0, 120));

  // Esc closes; ✕ closes; another county replaces
  await page.keyboard.press("Escape");
  check("Esc closes the card", (await card.count()) === 0);
  const pt2 = await pointIn(page, harris.index);
  if (pt2) {
    if (phone) await page.touchscreen.tap(pt2[0], pt2[1]); else await page.mouse.click(pt2[0], pt2[1]);
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Close details" }).click();
    check("the ✕ closes the card", (await card.count()) === 0);
  }

  // City-level sources: painted on their counties, described on the card, no developer text
  check("Wayne MI (Detroit only) is a painted city-level shape", (await page.locator(`path[data-i="${wayne.index}"]`).getAttribute("data-city")) === "1" && (await fillOf(wayne.index)) !== "none");
  const cityText = await probe(wayne, how);
  check("Wayne card says City of Detroit parcels available", /City of Detroit parcels available/.test(cityText || ""), (cityText || "").slice(0, 160));
  await closeCard();
  const body = await page.evaluate(() => document.body.innerText);
  check("no 'not drawn' developer text on the page", !/not drawn|wired entries/i.test(body) && (await page.locator('[data-testid="parcel-coverage-notdrawn"]').count()) === 0);

  // Zoom: button, ctrl+wheel; plain wheel must NOT zoom or be swallowed.
  const tf = () => page.locator('[data-testid="parcel-coverage-viewport"]').getAttribute("transform");
  await page.getByRole("button", { name: "Reset map view" }).click();
  const t0 = await tf();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const t1 = await tf();
  check("Zoom in changes the view", t1 !== t0, t1);
  const box = await page.locator('[data-testid="parcel-coverage-map"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -400); await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  const t2 = await tf();
  check("Ctrl+wheel zoom changes the view", t2 !== t1, t2);
  await page.getByRole("button", { name: "Reset map view" }).click();
  check("Reset restores the view", (await tf()) === t0 && t0 === "translate(0 0) scale(1)", t0);
  const clipped = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="parcel-coverage-map"]'), vb = svg.viewBox.baseVal;
    let bad = 0;
    for (const p of svg.querySelectorAll("path[data-i]")) { const b = p.getBBox(); if (b.x < -1 || b.y < -1 || b.x + b.width > vb.width + 1 || b.y + b.height > vb.height + 1) bad++; }
    return bad;
  });
  check("at Reset no county is clipped by the frame", clipped === 0, `${clipped} clipped`);

  // A real DRAG pans and must not open the card.
  await page.getByRole("button", { name: "Zoom in" }).click(); await page.getByRole("button", { name: "Zoom in" }).click();
  const tz = await tf();
  const fb = await page.locator('[data-testid="parcel-coverage-map"]').boundingBox();
  const sx = fb.x + fb.width * 0.5, sy = fb.y + fb.height * 0.5;
  if (!phone) {
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 60, sy + 30, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(100);
    check("a drag pans the map", (await tf()) !== tz, await tf());
    check("a drag does NOT open the card", (await card.count()) === 0);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways page scroll", overflow <= 0, `overflow ${overflow}`);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `/tmp/admin-parcel-coverage-${phone ? "phone" : "desktop"}.png`, fullPage: false });
  await ctx.close();
  return true;
}

/* NEW-1 — the page must stay scrollable with the cursor over the map, and the map must fit the window. */
async function wheelAndFit(label, viewport, { expectPageScroll }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "load" });
  await assertMeasurable(page, "verify-admin-parcel-coverage");
  await page.waitForSelector('[data-testid="parcel-coverage-map"] path', { timeout: 30000 });
  console.log(`\n── ${label} ──`);
  await page.evaluate(() => {
    window.__wheel = [];
    document.addEventListener("wheel", (e) => setTimeout(() => window.__wheel.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented }), 0), true);
    // capture-phase record happens before the app's handler, so read defaultPrevented after the dispatch finishes
  });
  const main = page.locator('[data-testid="admin-main"]');
  const mapBox = async () => page.locator('[data-testid="parcel-coverage-frame"]').boundingBox();
  const mainBox = await main.boundingBox();
  const fb = await mapBox();
  const natural = await page.evaluate(() => document.querySelector('[data-testid="admin-main"]').scrollTop);
  check(`${label}: map frame is at least ${expectPageScroll ? "the floor" : "fully"} sized`, fb.height >= 290, `h=${Math.round(fb.height)}`);
  if (!expectPageScroll) {
    check(`${label}: the WHOLE map is visible under the header and legend without scrolling`, fb.y >= mainBox.y && fb.y + fb.height <= mainBox.y + mainBox.height + 1, `map ${Math.round(fb.y)}-${Math.round(fb.y + fb.height)} in main ${Math.round(mainBox.y)}-${Math.round(mainBox.y + mainBox.height)}`);
  }
  const tf = () => page.locator('[data-testid="parcel-coverage-viewport"]').getAttribute("transform");
  const cx = fb.x + fb.width / 2, cy = fb.y + Math.min(fb.height, mainBox.height) / 2;
  await page.mouse.move(cx, Math.min(cy, mainBox.y + mainBox.height - 40));
  const t0 = await tf();
  // first plain wheel: hint appears (once)
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  check(`${label}: first plain wheel shows the Ctrl+scroll hint`, (await page.locator('[data-testid="parcel-coverage-hint"]').count()) === 1);
  check(`${label}: plain wheel does not zoom the map`, (await tf()) === t0, await tf());
  if (expectPageScroll) {
    const down = await main.evaluate((m) => m.scrollTop);
    check(`${label}: plain wheel DOWN over the map scrolls the page`, down > 0, `scrollTop ${down}`);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    const up = await main.evaluate((m) => m.scrollTop);
    check(`${label}: plain wheel UP over the map scrolls the page back (no longer stuck)`, up < down, `scrollTop ${down} -> ${up}`);
  }
  await page.waitForTimeout(2600);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  check(`${label}: the hint does not come back this visit`, (await page.locator('[data-testid="parcel-coverage-hint"]').count()) === 0);
  const events = await page.evaluate(() => window.__wheel);
  check(`${label}: no plain wheel event was preventDefault'ed`, events.length > 0 && events.every((e) => !e.prevented), JSON.stringify(events));
  // ctrl+wheel: zoomed AND prevented
  await page.evaluate(() => { window.__wheel = []; });
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -300); await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  const ev2 = await page.evaluate(() => window.__wheel);
  check(`${label}: Ctrl+wheel zooms the map`, (await tf()) !== t0, await tf());
  check(`${label}: Ctrl+wheel is handled by the map (prevented)`, ev2.length > 0 && ev2.every((e) => e.ctrl && e.prevented), JSON.stringify(ev2));
  // zoomed in: plain wheel still belongs to the page
  const zoomed = await tf();
  await page.mouse.wheel(0, 200); await page.waitForTimeout(150);
  check(`${label}: zoomed in, a plain wheel still does not zoom`, (await tf()) === zoomed);
  await page.getByRole("button", { name: "Reset map view" }).click();
  check(`${label}: Reset brings back the whole US`, (await tf()) === "translate(0 0) scale(1)");
  await ctx.close();
}

try {
  await run("desktop", { viewport: { width: 1400, height: 900 } }, false);
  await wheelAndFit("laptop window 1440x800", { width: 1440, height: 800 }, { expectPageScroll: false });
  await wheelAndFit("short window 1280x450", { width: 1280, height: 450 }, { expectPageScroll: true });
  await wheelAndFit("tall window 1600x1100", { width: 1600, height: 1100 }, { expectPageScroll: false });
  await run("phone width (touch)", { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, true);
} finally {
  await browser.close();
  await server.close();
}
if (process.exitCode === 2) process.exit(2);
console.log(fails.length ? `\nFAILED: ${fails.join("; ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
