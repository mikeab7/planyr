/* NEW-2 (California) — the Select-parcels outline layer on a California view must (1) draw exactly ONE source
 * (ca_statewide — no Nevada/Texas/other fan-out), (2) draw NOTHING below the source's declared outline floor
 * (zoom 17: a dense California cell exceeds the service's 2,000-feature cap at 16 — measured live 2026-10-02) and
 * query the service ZERO times while below it, (3) draw and hold a bounded feature count at the floor, and (4) paint
 * on a canvas. Sibling of verify-parcel-display-california.mjs (Bartow GA).
 *
 * Hermetic (every GIS host is mocked; the /query mock returns a dense parcel grid clipped to the requested tile
 * envelope and honours a 2,000-feature maxRecordCount like the real service). Reads the app's own armed-diagnostic
 * `window.__mapParcelDisplay()`. Known-good arm: the run is VOID unless the mocked California service was actually
 * queried and features were actually held at the floor. Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 &
 *   node ui-audit/verify-parcel-display-california.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BARTOW = { lat: 34.0260, lng: -117.6030 }; // Ontario, CA (name kept so the shared mock reads unchanged)
const STEP = 0.0004; // ~45 m parcels
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1,
  capabilities: "Query", maxRecordCount: 2000,
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  extent: { xmin: -125, ymin: 32, xmax: -114, ymax: 42.5, spatialReference: { wkid: 4326 } },
});
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const counts = { bartowQuery: 0, atFloorQuery: 0, otherQuery: 0, otherHosts: new Set() };

function parcelsIn(env) {
  const feats = [];
  const i0 = Math.floor(env.xmin / STEP), i1 = Math.ceil(env.xmax / STEP);
  const j0 = Math.floor(env.ymin / STEP), j1 = Math.ceil(env.ymax / STEP);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const x = i * STEP, y = j * STEP, h = STEP * 0.45;
    feats.push({ type: "Feature", id: (i + 100000) * 100000 + (j + 100000), properties: { OBJECTID: (i + 100000) * 100000 + (j + 100000) },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + h, y], [x + h, y + h], [x, y + h], [x, y]]] } });
    if (feats.length >= 2000) return feats; // the real service's maxRecordCount
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
await assertMeasurable(page, "verify-parcel-display-california");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({
    s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "California Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ca_statewide", parcels: [], els: [], updatedAt: Date.now() },
  }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
await page.route("**/*", (route) => {
  const u = route.request().url();
  const isGis = /\/(MapServer|FeatureServer)\//i.test(u);
  if (!isGis) return route.continue();
  if (u.includes("bz1uwWPKUInZBK94")) {
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
const row = page.locator('div[title*="Open site"]').filter({ hasText: "California Verify Site" }).first();
await row.hover();
await row.locator('[aria-label="Show on map"]').click();
await page.waitForTimeout(1500);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
const snap = async () => page.evaluate(() => (window.__mapParcelDisplay && window.__mapParcelDisplay()) || null);
const settle = async () => { await page.waitForTimeout(2500); };
const zoomBtn = async (which) => { await page.locator(`.leaflet-control-zoom-${which}`).first().click(); await settle(); };

const zoomNow = async () => page.evaluate(() => { const m = window.__lmap || null; return m && m.getZoom ? m.getZoom() : null; });
await settle();
const start = await snap();
console.log("start:", JSON.stringify(start && { sources: start.sources, held: start.held }));
expect("diagnostic armed and reporting", !!start);
expect("ONE source draws for the Ontario CA view (ca_statewide only)", start && start.sources.length === 1 && start.sources[0] === "ca_statewide", start && start.sources.join(","));
const baseHeld = start ? start.held : 0;
expect("KNOWN-GOOD ARM: mocked California service was queried and features are held at the floor (else the run is void)", counts.bartowQuery > 0 && baseHeld > 0, `queries=${counts.bartowQuery}, held=${baseHeld}`);
expect("bounded: held features never exceed one capped answer per cell (2,000 × visible cells)", baseHeld <= 2000 * 12, String(baseHeld));

// Zoom OUT one level (17 → 16): below the declared floor the layer must clear and stop asking.
await zoomBtn("out");
const below = await snap();
const qAtBelowStart = counts.bartowQuery;
await settle();
console.log(`zoom out (below floor): held=${below && below.held} drawn=${below && below.drawn}`);
expect("below the floor nothing is held (the dense-cell truncation never happens)", below && below.held === 0, String(below && below.held));
expect("below the floor the California service is not asked for outlines any more", counts.bartowQuery === qAtBelowStart, `${qAtBelowStart} → ${counts.bartowQuery}`);
await zoomBtn("in");
const back = await snap();
console.log(`zoom back in (at floor): held=${back && back.held}`);
expect("back at the floor the outlines return and stay bounded", back && back.held > 0 && back.held <= 2000 * 12, String(back && back.held));
const cnv = await page.evaluate(() => ({ canvases: document.querySelectorAll(".leaflet-overlay-pane canvas").length, paths: document.querySelectorAll(".leaflet-overlay-pane path").length }));
expect("outlines paint on a canvas, not one <path> per lot", cnv.canvases > 0 && cnv.paths < 50, JSON.stringify(cnv));
expect("no request to any non-California parcel service", counts.otherQuery === 0, [...counts.otherHosts].join(","));
expect("no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel display, California (NEW-2)`);
process.exit(failures ? 1 : 0);
