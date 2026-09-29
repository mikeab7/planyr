/* B1976336 — the Select-parcels outline layer must (1) draw exactly ONE source for a Bartow County GA
 * view, (2) hold a number of outline features bounded to what is in view across a zoom-out / zoom-in
 * cycle (the live report: 17,282 <path> nodes after ONE zoom step, tab unresponsive 30 s), and
 * (3) paint them on a canvas rather than one SVG <path> per lot.
 *
 * Hermetic (every GIS host is mocked; the /query mock returns a dense parcel grid clipped to the
 * requested tile envelope, so a layer that keeps old tiles visibly accumulates). Reads the app's own
 * armed-diagnostic `window.__mapParcelDisplay()`. Known-good arm: the run is VOID unless the mocked
 * Bartow service was actually queried and features were actually held — a run that saw nothing
 * cannot pass. Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 &
 *   node ui-audit/verify-parcel-display-bounded.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BARTOW = { lat: 34.20, lng: -84.83 };
const STEP = 0.0004; // ~45 m parcels
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1,
  capabilities: "Query", maxRecordCount: 100000,
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  extent: { xmin: -85.1, ymin: 34.0, xmax: -84.5, ymax: 34.5, spatialReference: { wkid: 4326 } },
});
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const counts = { bartowQuery: 0, otherQuery: 0, otherHosts: new Set() };

function parcelsIn(env) {
  const feats = [];
  const i0 = Math.floor(env.xmin / STEP), i1 = Math.ceil(env.xmax / STEP);
  const j0 = Math.floor(env.ymin / STEP), j1 = Math.ceil(env.ymax / STEP);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const x = i * STEP, y = j * STEP, h = STEP * 0.45;
    feats.push({ type: "Feature", id: (i + 100000) * 100000 + (j + 100000), properties: { OBJECTID: (i + 100000) * 100000 + (j + 100000) },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + h, y], [x + h, y + h], [x, y + h], [x, y]]] } });
    if (feats.length > 6000) return feats;
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
await assertMeasurable(page, "verify-parcel-display-bounded");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({
    s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "Bartow Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ga_bartow", parcels: [], els: [], updatedAt: Date.now() },
  }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
await page.route("**/*", (route) => {
  const u = route.request().url();
  const isGis = /\/(MapServer|FeatureServer)\//i.test(u);
  if (!isGis) return route.continue();
  if (u.includes("bartowgis.org")) {
    if (/\/query(\?|$)/i.test(u)) {
      counts.bartowQuery++;
      const env = envelopeOf(u);
      const feats = env ? parcelsIn(env) : [];
      // esri-leaflet asks for f=json unless the service advertises GeoJSON; answer in the format asked.
      if (new URL(u).searchParams.get("f") === "geojson") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: feats }) });
      const esri = feats.map((f) => ({ attributes: { OBJECTID: f.id }, geometry: { rings: f.geometry.coordinates } }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], features: esri }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
  }
  if (/\/query(\?|$)/i.test(u)) { counts.otherQuery++; counts.otherHosts.add(new URL(u).host); return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY }); }
  if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
});
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const row = page.locator('div[title*="Open site"]').filter({ hasText: "Bartow Verify Site" }).first();
await row.hover();
await row.locator('[aria-label="Show on map"]').click();
await page.waitForTimeout(1500);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
const snap = async () => page.evaluate(() => (window.__mapParcelDisplay && window.__mapParcelDisplay()) || null);
const settle = async () => { await page.waitForTimeout(2500); };
const zoomBtn = async (which) => { await page.locator(`.leaflet-control-zoom-${which}`).first().click(); await settle(); };

await settle();
const start = await snap();
console.log("start:", JSON.stringify(start && { sources: start.sources, held: start.held }));
expect("diagnostic armed and reporting", !!start);
expect("ONE source draws for the Bartow view (no Fulton/other overlap)", start && start.sources.length === 1 && start.sources[0] === "ga_bartow", start && start.sources.join(","));
const baseHeld = start ? start.held : 0;
expect("KNOWN-GOOD ARM: mocked Bartow service was queried and features are held (else the run is void)", counts.bartowQuery > 0 && baseHeld > 0, `queries=${counts.bartowQuery}, held=${baseHeld}`);

let peak = baseHeld;
for (const dir of ["out", "in", "in", "out", "in"]) { await zoomBtn(dir); const s = await snap(); peak = Math.max(peak, s ? s.held : 0); console.log(`  zoom ${dir}: held=${s && s.held} sources=${s && s.sources.join(",")}`); }
const end = await snap();
const cnv = await page.evaluate(() => ({ canvases: document.querySelectorAll(".leaflet-overlay-pane canvas").length, paths: document.querySelectorAll(".leaflet-overlay-pane path").length }));
console.log(`peak held=${peak}, end held=${end && end.held}, dom=`, JSON.stringify(cnv), `other-host queries=${counts.otherQuery}`);
// Bounded: a full cycle must not accumulate — end within 1.5x of the single-view baseline, peak within 4x (a zoom-out shows ~4x the ground).
expect("held features after a zoom cycle are bounded to the view (end ≤ 1.5× baseline)", end && end.held <= Math.max(1, baseHeld) * 1.5, `${end && end.held} vs baseline ${baseHeld}`);
expect("peak held stays bounded (≤ 4.5× baseline)", peak <= baseHeld * 4.5, `${peak} vs ${baseHeld}`);
expect("outlines paint on a canvas, not one <path> per lot", cnv.canvases > 0 && cnv.paths < 50, JSON.stringify(cnv));
expect("no request to any non-Bartow parcel service", counts.otherQuery === 0, [...counts.otherHosts].join(","));
expect("no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel display bounded (B1976336)`);
process.exit(failures ? 1 : 0);
