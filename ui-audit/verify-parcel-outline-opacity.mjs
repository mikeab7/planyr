/* Verify the NEW-1 (parcel outline opacity race) fix — recorded as a recurrence-neighbor of
 * B1427664 (PR #1602, "parcel outlines lag behind clickability"). That item fixed a listener-
 * ordering hazard (fl.addTo(map) ran before any listener was attached); this is a DIFFERENT
 * mechanism the owner hit afterward, in a different county, with the "still loading" notice
 * genuinely firing (proving #1602's own fix IS live) while the outline image itself sat fully
 * loaded, correctly positioned, and permanently invisible (opacity 0).
 *
 * ROOT CAUSE, confirmed by driving the real esri-leaflet RasterLayer and the real MapFinder
 * component (not read off the source and agreed with): esri-leaflet's RasterLayer
 * (`_renderImage`, esri-leaflet 3.0.19) fades a fresh /export image in from opacity 0 to visible
 * ONLY if the map's bounds at load-completion exactly equal the bounds it was requested for. If
 * the LAYER ITSELF is removed (`map.removeLayer(fl)`) while that request is still in flight, the
 * freshly-created <img> is orphaned — esri-leaflet adds it straight to the map, bypassing the
 * layer's own tracked `_currentImage`, so its `onRemove` cleanup never sees it, and it never
 * recovers. The specific trigger reproduced here: Waller County's `layerUrl` is the SAME URL as
 * the statewide TxGIO composite (`counties.js`), so whichever of the two resolves its display
 * layer first becomes its "owner" (an accident of async resolve order) — and when Waller's Drive
 * parcel-snapshot cache finishes loading (kicked off unconditionally on entering select mode) and
 * swaps Waller onto its own vector layer, the old `removeDisplay('waller')` unconditionally tore
 * down the SHARED layer object whenever Waller happened to be its owner, orphaning that layer's
 * own in-flight /export image — even though `txgio_statewide` (covering the rest of the state)
 * still needed it. THE FIX has two parts: (1) `MapFinder.jsx`'s `removeDisplay` hands ownership
 * to a surviving alias instead of destroying a still-referenced shared layer; (2)
 * `parcelOpacityGuard.js` (wired into every parcel image layer via `parcelDisplay.js`) closes the
 * orphan class generally — any teardown mid-flight now cleans the orphan up, and any "load" whose
 * image still matches the current view is force-shown as a defense-in-depth self-heal.
 *
 * THREE OF THE FOUR NAMED BRANCHES ARE DRIVEN HERE; the fourth (the 1,000-lot cap notice) is
 * REASONED ABOUT, not driven, and that reasoning is stated rather than assumed: it fires from
 * `fl.on("requestsuccess", …)` on a REAL county's VECTOR featureLayer (`parcelTruncation.js`,
 * "NEW-3"), entirely independent of the raster/image layer and of `removeDisplay` — nothing this
 * fix touches can reach that code path, so no separate harness was built for it.
 *   1. Normal county service (Harris, downtown Houston) — vector layer, unaffected baseline.
 *   2. Statewide fallback (slow county, Rosharon/Brazoria — the owner's own repro address) WITH
 *      the Waller-snapshot race that reproduces the defect — must now end at non-zero opacity
 *      and STAY there, never regressing back to 0.
 *   3. The true-outage cached-copy path (a snapshot county's own CAD failing, Chambers) — proves
 *      the ownership-handoff fix didn't disturb the plain (non-aliased) teardown-and-swap case.
 *
 * ⛔ TEETH — run against the pre-fix tree (revert both the MapFinder.jsx `removeDisplay` hunk and
 * parcelDisplay.js's `guardRasterOpacity` wiring), branch 2 FAILS: the statewide image reaches
 * `complete:true` around t=3s and its opacity never leaves "0" for the rest of the poll window —
 * reproducing the reported symptom verbatim. Confirmed live: `git stash` the two fix hunks, rebuild,
 * re-run — branch 2's "once loaded … opacity is non-zero" assertion fails exactly as described;
 * branches 1 and 3 stay green on both trees (correctly unrelated code paths).
 *
 * Fully hermetic — no real network to any GIS host. Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 &
 *   node ui-audit/verify-parcel-outline-opacity.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXPORT_DELAY_MS = 3000;

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const HOUSTON = { lat: 29.7550, lng: -95.3620 };
const ROSHARON = { lat: 29.3549, lng: -95.4508 }; // Brazoria County — the owner's own repro address
const CHAMBERS_CENTER = { lat: 29.70, lng: -94.66 };

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const EMPTY_ARCGIS_QUERY = JSON.stringify({
  objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
  spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: [],
});
const oneFeatureQuery = (lat, lng) => JSON.stringify({
  objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
  spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: [{ attributes: { OBJECTID: 1 }, geometry: { rings: [squareRing(lat, lng, 0.002)] } }],
});
const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon",
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
});
const QUERY_CAPABILITY_ERROR = JSON.stringify({ error: { code: -2147220222, message: "Query operation is not supported by this service." } });
const squareRing = (lat, lng, h) => [
  [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
];
const identifyHit = (lat, lng, county) => JSON.stringify({
  results: [{ layerId: 0, layerName: "Parcels", geometry: { rings: [squareRing(lat, lng, 0.0015)] }, attributes: { OBJECTID: 1, county, SITUS_ADDR: "1 Test Rd" } }],
});

function seedThrowawaySites() {
  const sites = {
    s_verify_houston: { id: "s_verify_houston", groupId: "s_verify_houston", site: "Houston Control Site", name: "Plan 1", status: "active", origin: { lat: HOUSTON.lat, lon: HOUSTON.lng }, county: "harris", parcels: [], els: [], updatedAt: Date.now() },
    s_verify_rosharon: { id: "s_verify_rosharon", groupId: "s_verify_rosharon", site: "Rosharon Repro Site", name: "Plan 1", status: "active", origin: { lat: ROSHARON.lat, lon: ROSHARON.lng }, county: "brazoria", parcels: [], els: [], updatedAt: Date.now() - 1000 },
    s_verify_chambers: { id: "s_verify_chambers", groupId: "s_verify_chambers", site: "Chambers Outage Site", name: "Plan 1", status: "active", origin: { lat: CHAMBERS_CENTER.lat, lon: CHAMBERS_CENTER.lng }, county: "chambers", parcels: [], els: [], updatedAt: Date.now() - 2000 },
  };
  return `(() => { try {
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`;
}

function installRoutes(page, { walerSnapshotFast = false, chambersHangs = false } = {}) {
  return page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("feature.geographic.texas.gov")) {
      if (/\/export(\?|$)/i.test(u)) return new Promise((resolve) => setTimeout(() => resolve(route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG })), EXPORT_DELAY_MS));
      if (/\/identify(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: identifyHit(ROSHARON.lat, ROSHARON.lng, "BRAZORIA") });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: QUERY_CAPABILITY_ERROR });
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
    }
    if (u.includes("BrazoriaCADWebService")) return new Promise(() => {}); // real CAD hangs — forces the statewide fallback
    if (chambersHangs && u.includes("ChambersCADPublic")) return new Promise(() => {}); // Chambers' own live CAD is "down"
    if (walerSnapshotFast && u.includes("/api/parcel-cache/svc/waller")) {
      if (/meta=1/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cached: true, generatedAt: "2026-01-01", count: 1, bbox: null }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [squareRing(30.0, -95.86, 0.01)] } }] }) });
    }
    if (u.includes("/api/parcel-cache/svc/chambers")) {
      if (/meta=1/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cached: true, generatedAt: "2026-01-01", count: 1, bbox: null }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [squareRing(CHAMBERS_CENTER.lat, CHAMBERS_CENTER.lng, 0.01)] } }] }) });
    }
    if (/\/(MapServer|FeatureServer)\//i.test(u)) {
      if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      if (/\/query(\?|$)/i.test(u)) {
        const body = u.includes("gis.hctx.net") ? oneFeatureQuery(HOUSTON.lat, HOUSTON.lng) : EMPTY_ARCGIS_QUERY;
        return route.fulfill({ status: 200, contentType: "application/json", body });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
    }
    return route.continue();
  });
}

async function flyToSeededSite(page, label) {
  const row = page.locator('div[title*="Open site"]').filter({ hasText: label }).first();
  await row.hover();
  await row.locator('[aria-label="Show on map"]').click();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// --- 1: normal county service (Harris, downtown Houston) — vector layer, unaffected baseline ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await assertMeasurable(page, "verify-parcel-outline-opacity");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(seedThrowawaySites());
  await installRoutes(page);
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  console.log("--- 1: Harris County (downtown Houston) — normal county vector service ---");
  await flyToSeededSite(page, "Houston Control Site");
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await page.waitForTimeout(1500);
  // B1976336 — parcel outlines now paint on a canvas (one bitmap, no <path> per lot)
  const paths = await page.locator(".leaflet-overlay-pane path, .leaflet-overlay-pane canvas").count();
  expect("Harris renders vector parcel outlines (unaffected by the raster-layer fix)", paths > 0, `${paths} path nodes`);
  expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);
  await page.close();
}

// --- 2: the reported defect — Rosharon/Brazoria, statewide fallback, Waller-snapshot race ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await assertMeasurable(page, "verify-parcel-outline-opacity");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(seedThrowawaySites());
  await installRoutes(page, { walerSnapshotFast: true });
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  console.log("\n--- 2: Rosharon TX (Brazoria) — statewide fallback + the Waller-snapshot race ---");
  await flyToSeededSite(page, "Rosharon Repro Site");
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();

  let sawNonZero = false, regressedToZero = false, sawComplete = false;
  // B1976336 — the statewide backup now comes in only once the county's own layer is declared down
  // (8 s hang-guard), so the window covers guard + the 3 s mocked export: 100 * 150ms = 15s.
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => {
      const img = document.querySelector(".leaflet-overlay-pane img[src*='feature.geographic.texas.gov']");
      if (!img) return null;
      return { complete: img.complete, naturalWidth: img.naturalWidth, opacity: getComputedStyle(img).opacity };
    });
    if (!state) continue;
    if (state.complete && state.naturalWidth > 0) {
      sawComplete = true;
      if (state.opacity !== "0") sawNonZero = true;
      else if (sawNonZero) regressedToZero = true; // was visible, then went back to 0 — also a failure
    }
  }
  expect("the statewide image actually finished loading during the poll window", sawComplete);
  expect("once loaded, the outline image's rendered opacity is non-zero (the reported defect)", sawNonZero);
  expect("opacity never regresses back to 0 after becoming visible", !regressedToZero);
  expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);
  await page.close();
}

// --- 3: the true-outage cached-copy path (Chambers' own CAD down) — non-aliased owner teardown ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await assertMeasurable(page, "verify-parcel-outline-opacity");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(seedThrowawaySites());
  await installRoutes(page, { chambersHangs: true });
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  console.log("\n--- 3: Chambers County — own CAD down, Drive snapshot cache fallback (non-aliased owner) ---");
  await flyToSeededSite(page, "Chambers Outage Site");
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await page.waitForTimeout(9000); // past the 8s hang-guard
  const notice = await page.locator('[data-testid="map-source-notice"], [role="status"]').first().innerText().catch(() => "");
  // B1976336 — parcel outlines now paint on a canvas (one bitmap, no <path> per lot)
  const paths = await page.locator(".leaflet-overlay-pane path, .leaflet-overlay-pane canvas").count();
  console.log(`  notice: ${JSON.stringify(notice)}`);
  expect("Chambers falls back to its cached Drive snapshot and draws it (vector layer)", paths > 0, `${paths} path nodes`);
  expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);
  await page.close();
}

await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel outline opacity race (NEW-1, neighbor of B1427664)`);
process.exit(failures ? 1 : 0);
