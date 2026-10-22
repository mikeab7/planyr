/* Verify the "outlines lag behind clickability" fix (B1427664).
 *
 * Reported live: Michael panned to a slow area — Texarkana (Bowie County, far NE Texas, which
 * has NO county CAD of its own; its only parcel source is the statewide TxGIO composite that
 * covers every Texas county) — and no parcel outlines drew for a long stretch, yet clicking a
 * lot still selected it correctly the whole time: "the outlines didn't show up, but I can still
 * click them. So it seems like they're there. So maybe it's just a loading issue."
 *
 * Root cause: the DISPLAY draws the whole viewport (slow, and for the statewide layer
 * specifically the hang-guard deliberately never pulls it, so it has no timeout at all and can
 * sit silently slow forever); the CLICK path (`identifyParcelEager`) is a single fast point
 * query, independent of the display's own request. The fix does NOT make clicks wait for the
 * slower half (explicitly the wrong fix per the dispatch — selection working early is the good
 * half). It says so plainly instead: `slowDisplayKeys` (MapFinder.jsx) names any display layer
 * whose request has been outstanding past `SLOW_DISPLAY_NOTICE_MS` with nothing drawn yet, and
 * the existing select-mode tip (the ONE explanation anywhere in the app for how "+ Select
 * parcels" works) swaps in a line that tells the truth, reusing the exact mechanism already
 * shipped for the "below outline zoom" case.
 *
 * This harness drives the real component end to end and proves BOTH halves of the reported gap
 * in one sequence, at the exact repro location (statewide-only, no Drive snapshot — Bowie is not
 * in SNAPSHOT_COUNTIES, so this also covers the dispatch's second adjacent case for free):
 *   1. fly to Texarkana, enter select mode, and hold the statewide layer's OWN /export request
 *      open forever (a real hang, not an abort) — the tip must switch from the normal line to
 *      the "still loading" line once past the notice delay, and BEFORE that (fast machines,
 *      networks) it must still show the ORDINARY tip rather than flashing "still loading"
 *      immediately;
 *   2. click the map at that same point while the outline request is still hanging — the
 *      identify path answers fast (mocked) and the click selects the lot (the decide-bar summary
 *      reads "1 parcel"), proving selection never waited on the slow display;
 *   3. fly to Denver, CO — a DIFFERENT state — and the "still loading" tip must clear (the same
 *      view-plausibility discipline B1164656 already established for the outage banner, reused
 *      here via `displayNoticeShape`; a statewide composite's own notice is deliberately scoped to
 *      its WHOLE state, not a bbox, so this step must cross a state line to be a real test — flying
 *      within Texas would correctly LEAVE the notice showing, since the same slow TxGIO layer
 *      genuinely still covers wherever else in Texas the view lands).
 *
 * ⛔ TEETH — run against the pre-fix tree (revert the MapFinder.jsx hunk that adds
 * `slowDisplayKeys`/`markDisplaySlow`/the third tip line), step 1 fails: the tip stays on the
 * ordinary "Click lots to add or remove" line for the whole hang, with no indication
 * anything is still loading — the exact silence that was reported.
 *
 * Fully hermetic — no real network to any GIS host is needed or attempted. The statewide
 * TxGIO host's own /query is answered with ArcGIS's real "not supported by this service"
 * capability-error shape (query really is disabled upstream there), so the click path takes the
 * SAME /identify fallback production code takes; /export is left to hang forever, matching the
 * reported symptom exactly (never an abort — an abort already fires the DIFFERENT, already-tested
 * requesterror path). Every other county/statewide composite is answered with a clean, fast,
 * empty success so of the ~70 counties this app loads in select mode, only the statewide TxGIO
 * layer is slow.
 *
 * Run:  VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *       npx vite preview --port 4188 &
 *       node ui-audit/verify-parcel-outline-loading-notice.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const TEXARKANA = { lat: 33.4418, lng: -94.0377 }; // Bowie County — no CAD, statewide-only
const DENVER = { lat: 39.7392, lng: -104.9903 }; // Colorado — a genuinely different state

const squareRing = (lat, lng, h) => [
  [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
];

const EMPTY_ARCGIS_QUERY = JSON.stringify({
  objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
  spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: [],
});
const META_OK = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon",
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
});
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

// The statewide layer's real-world shape: /query is disabled upstream, HTTP 200 with an ArcGIS
// error body naming the capability gap (arcgis.js's `isQueryCapabilityError` regex) — the SAME
// path production takes today against the live TxGIO service.
const QUERY_CAPABILITY_ERROR = JSON.stringify({ error: { code: -2147220222, message: "Query operation is not supported by this service." } });
// A fast /identify hit at Texarkana, in the shape `identifyAtPoint` reads.
const IDENTIFY_HIT = JSON.stringify({
  results: [{
    layerId: 0, layerName: "Parcels",
    geometry: { rings: [squareRing(TEXARKANA.lat, TEXARKANA.lng, 0.0015)] },
    attributes: { OBJECTID: 1, county: "BOWIE", SITUS_ADDR: "1 Test Rd" },
  }],
});

function seedThrowawaySites() {
  const sites = {
    s_verify_texarkana: {
      id: "s_verify_texarkana", groupId: "s_verify_texarkana", site: "Texarkana Test Site", name: "Plan 1",
      status: "active", origin: { lat: TEXARKANA.lat, lon: TEXARKANA.lng }, county: null,
      parcels: [], els: [], updatedAt: Date.now(),
    },
    s_verify_denver: {
      id: "s_verify_denver", groupId: "s_verify_denver", site: "Denver Test Site", name: "Plan 1",
      status: "active", origin: { lat: DENVER.lat, lon: DENVER.lng }, county: "co_denver",
      parcels: [], els: [], updatedAt: Date.now() - 500000,
    },
  };
  return `(() => { try {
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`;
}

function installRoutes(page) {
  return page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("feature.geographic.texas.gov")) {
      // The statewide layer's own /export (the viewport-wide DISPLAY draw) hangs forever — a
      // real stall, not an abort (an abort takes the already-tested requesterror path instead).
      // Never calling route.continue/fulfill/abort leaves the request genuinely pending.
      if (/\/export(\?|$)/i.test(u)) return new Promise(() => {});
      if (/\/identify(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: IDENTIFY_HIT });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: QUERY_CAPABILITY_ERROR });
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
    }
    // Every OTHER county/statewide composite — answered clean and fast, so of the ~70 counties
    // this app loads in select mode, only the one under test is ever slow.
    if (/\/(MapServer|FeatureServer)\//i.test(u)) {
      if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_ARCGIS_QUERY });
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

const tipTextOf = async (page) => {
  const t = page.locator('[data-testid="select-parcels-tip"]');
  return (await t.count()) && await t.first().isVisible().catch(() => false) ? t.first().innerText() : "";
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await assertMeasurable(page, "verify-parcel-outline-loading-notice");
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(String(e)); console.log("  [pageerror]", String(e)); });

await page.addInitScript(seedThrowawaySites());
await installRoutes(page);
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

console.log("\n--- 1: fly to Texarkana (Bowie County — statewide-only), enter select mode; the statewide /export hangs forever ---");
await flyToSeededSite(page, "Texarkana Test Site");
await page.waitForTimeout(1500);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();

// Sampled BEFORE the notice delay elapses — must still read the ORDINARY tip, not the "loading"
// one (no flicker on an outline that could still turn up fast on a healthier host).
await page.waitForTimeout(1200);
const early = await tipTextOf(page);
console.log(`  tip @1.2s: ${JSON.stringify(early)}`);
expect("before the notice delay, the ordinary tip shows (no premature flicker)", /add several, then plan/i.test(early), early);

await page.waitForTimeout(2500); // past SLOW_DISPLAY_NOTICE_MS (2.5s) from select-mode entry
const late = await tipTextOf(page);
console.log(`  tip @3.7s: ${JSON.stringify(late)}`);
expect("past the notice delay, the tip says outlines are STILL LOADING", /still loading/i.test(late), late);
expect("the still-loading tip also says a click already works", /already adds it/i.test(late), late);

console.log("\n--- 2: click the map at that same point — selection must succeed even though outlines never drew ---");
const mapBox = await page.locator(".leaflet-container").boundingBox();
await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
await page.waitForTimeout(1500);
const summary = await page.locator('[data-testid="map-decide-summary"]').innerText().catch(() => "");
console.log(`  decide-bar summary: ${JSON.stringify(summary)}`);
expect("the click selected a parcel via the fast identify path, despite the hung display", /1 parcel/i.test(summary), summary || "(nothing selected)");

console.log("\n--- 3: fly to Denver, CO — a different state — the 'still loading' tip must clear ---");
await flyToSeededSite(page, "Denver Test Site");
await page.waitForTimeout(1500);
const afterMove = await tipTextOf(page);
console.log(`  tip after flying to a different state: ${JSON.stringify(afterMove)}`);
expect("the 'still loading' line does not follow the view into a different state", !/still loading/i.test(afterMove), afterMove);

expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);

await page.close();
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel outline "still loading" notice (B1427664)`);
process.exit(failures ? 1 : 0);
