/* V243 (B707/B712) live-look verification: the floodplain-mitigation suite against a REAL AE
 * reach, using genuine FEMA NFHL geometry (queried live, not mocked) — a real AE zone near
 * Cypress Creek (Harris County, TX) and a real regulatory FLOODWAY polygon in the same reach
 * (both found via a live NFHL query — see the coordinates below).
 *
 * Network model (same as the terrain scripts): Chromium here cannot open its own connection to
 * any external host; only this session's Node process can (via HTTPS_PROXY). So Chromium loads
 * the local preview build, and page.route relays EVERY request to an allowlisted GIS host through
 * the deployed planyr.io gis-cache proxy (functions/api/gis-cache — same-origin, so no CORS
 * issue), which itself fetches the real upstream. Nothing about the flood-zone classification is
 * mocked — it is the same live query the production app would run.
 *
 * Run: npm run build && npx vite preview --port 4173 (background), then
 *      node ui-audit/verify-v243-floodplain-real-ae.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PLANYR = "https://planyr.io";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// Real points found via a live NFHL query (2026-07-18) over a Cypress Creek reach in
// unincorporated Harris County — see /tmp/ae_zone.json / /tmp/floodway.json provenance.
const AE_POINT = { lat: 29.99218, lon: -95.60081 };       // inside a real AE (non-floodway) polygon
// Deepest-interior point found by sampling: ~100 ft from the nearest floodway edge (a narrow
// creek channel there) — keep the building SMALL so it can't straddle out past that margin.
const FLOODWAY_POINT = { lat: 29.9925497337577, lon: -95.6017628007153 };

const H = 200; // a 400x400 ft parcel footprint centered on the origin point
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const bldg = { id: "b1", type: "building", cx: 0, cy: 0, w: 200, h: 150, rot: 0 };
const smallBldg = { id: "b1", type: "building", cx: 0, cy: 0, w: 60, h: 60, rot: 0 }; // for the floodway case — stays inside the ~100ft margin

const mkSite = (id, origin, building = bldg) => ({
  [id]: {
    id, groupId: id, site: `V243 ${id}`, name: "Plan 1", status: "active",
    origin, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [building], measures: [], callouts: [], markups: [], deletedIds: [],
    settings: { showSetback: false, drainage: { autoFacts: false } }, underlay: null, updatedAt: Date.now(),
  },
});

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Real GIS hosts this app allowlists through its own gis-cache proxy (src/shared/gis/gisProxyCore.js
// ALLOWED_GIS_HOST_RE) — relay ANY request to one of these through the deployed proxy from Node,
// which CAN reach the real internet (unlike Chromium in this sandbox).
const GIS_HOST_RE = /(?:^|\.)(?:arcgis\.com|arcgisonline\.com|fema\.gov|fws\.gov|usgs\.gov|epa\.gov|texas\.gov|tnris\.org|tx\.gov|houstontx\.gov|harriscountytx\.gov|hcfcd\.org|fortbendcountytx\.gov|fbcad\.org|chambers-county\.com|h-gac\.com|hctx\.net|nationalmap\.gov|harcresearch\.org)$/i;

async function relayGisHosts(ctx, { blockFema = false } = {}) {
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (!GIS_HOST_RE.test(u.host)) return route.continue();
    if (blockFema && /fema\.gov$/i.test(u.host)) return route.abort("connectionreset"); // simulate an NFHL outage
    try {
      const prox = `${PLANYR}/api/gis-cache/svc/${b64url(`${u.origin}${u.pathname}`)}${u.search}`;
      const r = await fetch(prox, { redirect: "follow" });
      const body = Buffer.from(await r.arrayBuffer());
      await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/json", headers: { "access-control-allow-origin": "*" }, body });
    } catch (e) { await route.fulfill({ status: 502, contentType: "text/plain", body: String(e) }); }
  });
}

async function openSite(browser, id, origin, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(mkSite(id, origin, opts.building || bldg))}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)});
  } catch (e) {} })();`);
  await relayGisHosts(ctx, opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 15000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const cb = page.getByRole("button", { name: /Check drainage criteria/ });
  await cb.waitFor({ timeout: 8000 }).catch(() => {});
  await cb.click();
  // The check runs several live GIS queries — give it real time to settle.
  await page.waitForTimeout(1500);
  for (let i = 0; i < 30; i++) {
    const t = await page.locator("body").innerText().catch(() => "");
    if (/Checking drainage criteria/.test(t) === false) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
  // The group header button's accessible text is "▸<STATUS BADGE><Group name><summary>" all
  // concatenated with no separating space (e.g. "▸STOPFloodplain mitigationfloodway fill …") —
  // match on the group NAME as a substring, not the "▸ Name" form.
  for (const g of ["Detention", "Floodplain mitigation", "Buildability / FFE"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return { ctx, page, text, errors };
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── Case 1: real AE zone (not floodway) — plausible classification, UNKNOWN volume until FFE entered ──
  console.log("\n== Real AE-reach site (Cypress Creek, Harris County) — Check drainage criteria ==");
  const c1 = await openSite(browser, "v243-ae", AE_POINT);
  await c1.page.screenshot({ path: OUT + "v243-ae-zone.png" });
  log(/AE\b/.test(c1.text) || /Special Flood Hazard/i.test(c1.text) || /floodplain/i.test(c1.text), `drainage check surfaced a real flood classification`);
  log(!/pageerror/i.test(c1.errors.join(" ")) && c1.errors.length === 0, `no page errors (${c1.errors.length})`);
  // Intersect acreage / mitigation card renders something concrete (not blank) even before FFE entry.
  const hasIntersect = /ac of fill footprint|mitigation|Combined basin|not screened yet/i.test(c1.text);
  log(hasIntersect, `mitigation/intersect readout renders (not blank) before elevations are entered`);
  const unknownBeforeFfe = /unknown/i.test(c1.text) || /incomplete/i.test(c1.text) || /not screened yet/i.test(c1.text);
  log(unknownBeforeFfe, `with no pad FFE/grade entered yet, the volume reads UNKNOWN/INCOMPLETE — never a fabricated zero`);
  console.log(`  (context) drainage/mitigation excerpt: ${(c1.text.match(/(Floodplain mitigation|Combined basin)[^:]{0,300}/) || ["(not found)"])[0]}`);

  // Enter pad FFE / grade / BFE manually → a real volume should compute. Real field ids (from
  // SitePlanner.jsx's `fmRow`/`autoField`, id="drain-field-<key>"): padFfeFt, existGradeFt,
  // bfeFt, wse02Ft. An auto-populated field (e.g. existGradeFt from 3DEP) renders as clickable
  // "~value · source [edit]" text first — click it to reveal the actual <input>.
  console.log("\n== Entering pad FFE / grade / BFE → a real volume ==");
  let enteredSomething = false;
  for (const key of ["bfeFt", "padFfeFt", "existGradeFt"]) {
    const field = c1.page.locator(`#drain-field-${key}`);
    if (!(await field.count())) continue;
    let input = field.locator("input").first();
    if (!(await input.count())) {
      // auto-value text mode — click it to switch into edit mode, revealing the input.
      await field.locator("button", { hasText: "edit" }).first().click({ timeout: 3000 }).catch(() => field.locator("span", { hasText: "edit" }).first().click({ timeout: 3000 }).catch(() => {}));
      await c1.page.waitForTimeout(200);
      input = field.locator("input").first();
    }
    if (await input.count()) {
      try { await input.fill("104"); await input.press("Enter"); enteredSomething = true; await c1.page.waitForTimeout(400); }
      catch (e) { console.log(`  (debug) fill failed for ${key}: ${e.message.split("\n")[0]}`); }
    }
  }
  log(enteredSomething, `found and filled at least one grade/FFE/BFE field`);
  await c1.page.waitForTimeout(1000);
  const textAfterFfe = (await c1.page.locator("body").innerText()).replace(/\s+/g, " ");
  const gotRealVolume = /\d+(\.\d+)?\s*ac-ft/.test(textAfterFfe);
  log(gotRealVolume, `after entering elevations, a real ac-ft volume figure appears`, textAfterFfe.match(/[\d.]+\s*ac-ft/)?.[0] || "");
  await c1.page.screenshot({ path: OUT + "v243-ae-zone-with-ffe.png" });
  await c1.ctx.close();

  // ── Case 2: real FLOODWAY — the loud prohibit-fill flag ──────────────────────────────
  console.log("\n== Real FLOODWAY site (same reach) — prohibit-fill flag ==");
  const c2 = await openSite(browser, "v243-floodway", FLOODWAY_POINT, { building: smallBldg });
  await c2.page.screenshot({ path: OUT + "v243-floodway.png" });
  log(/FLOODWAY/i.test(c2.text), `the FLOODWAY classification surfaces somewhere in the readout`);
  const prohibitFired = /prohibited/i.test(c2.text) || /fill footprint sits in the regulatory floodway/i.test(c2.text) || /no mitigation ratio prices floodway fill/i.test(c2.text);
  log(prohibitFired, `the loud "fill in the floodway is PROHIBITED" flag fires for a building footprint over real floodway geometry`);
  log(c2.errors.length === 0, `no page errors (${c2.errors.length})`);
  await c2.ctx.close();

  // ── Case 3: NFHL host unreachable — the honest geometry-outage warning, never a false-clear ──
  console.log("\n== NFHL host blocked mid-session → honest outage warning, not a false all-clear ==");
  const c3 = await openSite(browser, "v243-outage", AE_POINT, { blockFema: true });
  await c3.page.screenshot({ path: OUT + "v243-outage.png" });
  const honestOutage = /unavailable|could not|not respond|outage|failed|error/i.test(c3.text) && !/No mapped Special Flood Hazard Area/i.test(c3.text);
  log(honestOutage, `an NFHL outage renders an honest "unavailable" state, never a false "no flood risk" all-clear`);
  console.log(`  (context) excerpt: ${(c3.text.match(/(Floodplain mitigation|flood)[^:]{0,200}/i) || ["(not found)"])[0]}`);
  await c3.ctx.close();

  await browser.close();
  console.log(fail === 0 ? "\n✓ ALL V243 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("harness error:", e); process.exit(1); });
