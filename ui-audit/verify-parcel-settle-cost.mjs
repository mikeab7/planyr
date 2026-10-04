/* NEW-1 (parcel-outline settle cost) — the Select-parcels outlines must not hitch when a zoom or pan SETTLES
 * at site-scale zoom (14–16) on a dense Georgia view. Michael's Chrome, Bartow GA, build 2feca52, timing the
 * canvas renderer's update+redraw: z16 6–8 ms (767 in view) · z15 37–51 ms (8,230 held) · z14 75–94 ms
 * (16,702 held). The cost scaled with what was HELD, not what was seen.
 *
 * THE MEASUREMENT: the synchronous `map.fire("moveend")`/`zoomend` work PLUS the next animation frame's
 * callbacks (Leaflet batches the canvas redraw and the tile paint into rAF) — i.e. everything the main thread
 * does between "the map stopped moving" and "the frame that shows the result is ready to be produced".
 * Hermetic (every GIS host mocked; the /query mock serves a Bartow-density parcel grid, ~0.001° pitch, so
 * ~7k lots are in view at z14). Known-good arm: the run is VOID unless the layer actually held a z14-scale
 * number of lots (a run over an empty layer measures nothing and must not pass). Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 &
 *   node ui-audit/verify-parcel-settle-cost.mjs
 * BUDGET: the parcel layer's share of a settle (settle with Select parcels on, minus the same settle with it off) < 16 ms median at z14/z15/z16 (one 60 fps frame). Red on 2feca52, green on this change.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BUDGET_MS = Number(process.env.SETTLE_BUDGET_MS || 16);
const BARTOW = { lat: 34.20, lng: -84.83 };
const STEP = 0.001; // ~110 m pitch → ~7k lots across a 1280×860 view at z14 (Michael's measured 7,124)
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1,
  capabilities: "Query", maxRecordCount: 100000,
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  extent: { xmin: -85.1, ymin: 34.0, xmax: -84.5, ymax: 34.5, spatialReference: { wkid: 4326 } },
});
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const counts = { bartowQuery: 0 };
function parcelsIn(env) {
  const feats = [];
  const i0 = Math.floor(env.xmin / STEP), i1 = Math.ceil(env.xmax / STEP);
  const j0 = Math.floor(env.ymin / STEP), j1 = Math.ceil(env.ymax / STEP);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const x = i * STEP, y = j * STEP, h = STEP * 0.45;
    const id = (i + 100000) * 100000 + (j + 100000);
    feats.push({ type: "Feature", id, properties: { OBJECTID: id }, geometry: { type: "Polygon", coordinates: [[[x, y], [x + h, y], [x + h, y + h], [x, y + h], [x, y]]] } });
    if (feats.length > 30000) return feats;
  }
  return feats;
}
function envelopeOf(u) {
  const g = new URL(u).searchParams.get("geometry");
  if (!g) return null;
  try { const o = JSON.parse(g); if (o.xmin != null) return o; } catch (_) {}
  const p = g.split(",").map(Number); return p.length === 4 ? { xmin: p[0], ymin: p[1], xmax: p[2], ymax: p[3] } : null;
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await assertMeasurable(page, "verify-parcel-settle-cost");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({
    s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "Bartow Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ga_bartow", parcels: [], els: [], updatedAt: Date.now() },
  }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
// Real county servers answer after the settle, in their own tasks — so the mock answers after a delay too.
// An instant answer would land INSIDE the timing window and charge feature ingestion (async, chunked per
// response in real use) to the settle. Ingestion is reported separately below as the longest task.
const RESPONSE_DELAY_MS = 350;
await page.route("**/*", async (route) => {
  const u = route.request().url();
  if (u.includes("bartowgis.org") && /\/query(\?|$)/i.test(u)) await new Promise((r) => setTimeout(r, RESPONSE_DELAY_MS));
  if (!/\/(MapServer|FeatureServer)\//i.test(u)) return route.continue();
  if (u.includes("bartowgis.org")) {
    if (/\/query(\?|$)/i.test(u)) {
      counts.bartowQuery++;
      const env = envelopeOf(u);
      const feats = env ? parcelsIn(env) : [];
      if (new URL(u).searchParams.get("f") === "geojson") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: feats }) });
      const esri = feats.map((f) => ({ attributes: { OBJECTID: f.id }, geometry: { rings: f.geometry.coordinates } }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], features: esri }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
  }
  if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY });
  if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
});
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const row = page.locator('div[title*="Open site"]').filter({ hasText: "Bartow Verify Site" }).first();
await row.hover();
await row.locator('[aria-label="Show on map"]').click();
await page.waitForTimeout(1500);
// CONTROL ARM (Select parcels still OFF): what a settle costs on this map with no parcel layer at all — the
// base map's own tiles, basemap overlays, labels. The parcel layer's cost is everything above this floor,
// so the budget is asked of the DIFFERENCE and a slow CI box cannot blame the parcel layer for the map.
const snap = async () => page.evaluate(() => (window.__mapParcelDisplay && window.__mapParcelDisplay()) || null);
// In-page settle timer: runs `act()` (synchronous map call that ends in moveend/zoomend), then waits for the next
// animation frame's callbacks, and returns the elapsed wall time. Paced with MessageChannel/rAF only (never a timer).
const settleMs = (kind, z) => page.evaluate(async ({ kind, z }) => {
  const map = window.__mapFinderMap;
  const t0 = performance.now();
  if (kind === "zoom") map.setView(map.getCenter(), z, { animate: false });
  else map.panBy([260, 0], { animate: false });
  await new Promise((r) => requestAnimationFrame(() => r()));
  return performance.now() - t0;
}, { kind, z });
const settleLoaded = async () => { await page.waitForTimeout(2500); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const floors = {};
for (const z of [16, 15, 14]) {
  await page.evaluate(([lat, lng, zz]) => { window.__mapFinderMap.setView([lat, lng], zz, { animate: false }); }, [BARTOW.lat, BARTOW.lng, z]);
  await settleLoaded();
  const zr = [], pr = [];
  for (let i = 0; i < 5; i++) { zr.push(await settleMs("zoom", z === 16 ? 15 : z + 1)); await settleLoaded(); zr.push(await settleMs("zoom", z)); await settleLoaded(); pr.push(await settleMs("pan")); await page.waitForTimeout(400); }
  floors[z] = { zoom: median(zr), pan: median(pr) };
  console.log(`  control z${z} (no parcel layer): zoom-settle median ${floors[z].zoom.toFixed(1)} ms · pan-settle median ${floors[z].pan.toFixed(1)} ms`);
}
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
await page.waitForTimeout(2500);

await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ["longtask"] }); } catch (_) {} });
const results = {};
for (const z of [16, 15, 14]) {
  // Land at z (data fetched + held), then measure re-settles with the data already held — what Michael sees on
  // every pan/zoom settle. Alternate z±1 so every zoom measurement crosses a real tile-zoom change.
  await page.evaluate(([lat, lng, zz]) => { window.__mapFinderMap.setView([lat, lng], zz, { animate: false }); }, [BARTOW.lat, BARTOW.lng, z]);
  await settleLoaded();
  const s = await snap();
  const zoomRuns = [], panRuns = [];
  for (let i = 0; i < 5; i++) {
    zoomRuns.push(await settleMs("zoom", z === 16 ? 15 : z + 1)); await settleLoaded();
    zoomRuns.push(await settleMs("zoom", z)); await settleLoaded();
    panRuns.push(await settleMs("pan")); await page.waitForTimeout(400);
  }
  results[z] = { longTasks: await page.evaluate(() => { const a = window.__lt.slice(); window.__lt.length = 0; return a; }), held: s && s.held, zoom: median(zoomRuns), pan: median(panRuns), zoomRuns, panRuns };
  console.log(`    long tasks (>=50 ms) during z${z} zooms/pans incl. data arrival: n=${results[z].longTasks.length}, max=${Math.max(0, ...results[z].longTasks).toFixed(0)} ms`);
  results[z].zoomCost = results[z].zoom - floors[z].zoom; results[z].panCost = results[z].pan - floors[z].pan;
  console.log(`  z${z}: held=${s && s.held} sources=${s && s.sources.join(",")}  zoom-settle median ${results[z].zoom.toFixed(1)} ms (parcel cost ${results[z].zoomCost.toFixed(1)}) · pan-settle median ${results[z].pan.toFixed(1)} ms (parcel cost ${results[z].panCost.toFixed(1)})`);
}
expect("KNOWN-GOOD ARM: the mocked Bartow service was queried and a z14-scale number of lots is held (else the run is void)", counts.bartowQuery > 0 && (results[14].held || 0) >= 5000, `queries=${counts.bartowQuery}, held@z14=${results[14].held}`);
for (const z of [16, 15, 14]) {
  expect(`z${z} zoom settle: parcel layer's cost under ${BUDGET_MS} ms (median, over the no-parcel floor)`, results[z].zoomCost < BUDGET_MS, `${results[z].zoomCost.toFixed(1)} ms`);
  expect(`z${z} pan settle: parcel layer's cost under ${BUDGET_MS} ms (median, over the no-parcel floor)`, results[z].panCost < BUDGET_MS, `${results[z].panCost.toFixed(1)} ms`);
}
expect("no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel settle cost (NEW-1)`);
process.exit(failures ? 1 : 0);
