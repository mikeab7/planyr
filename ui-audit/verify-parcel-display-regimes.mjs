/* Verify NEW-1 (owner decision 2026-09-24) — the zoom-based three-regime parcel display that
 * replaces the retired "capped this view at N lots" banner. This is a `Verify: live` item by
 * the repo's own LIVE-VERIFY rule (zoom-/data-density-dependent rendering), because it needs a
 * real ArcGIS server's own `maxRecordCount` to genuinely trip — nothing here can prove THAT.
 * What this CAN prove, hermetically (no real network to any GIS host): that the Leaflet/
 * esri-leaflet WIRING actually behaves the way `parcelDisplay.js`'s header claims — vector
 * outlines close-in, a server-rendered image wide, nothing far out — against Harris County
 * (a real MapServer CAD, so it gets the full adaptive composite), driven by REAL wheel-zoom
 * gestures rather than assumed from reading esri-leaflet's source alone.
 *
 * FOREGROUND-OR-VOID: this harness zooms a real map and reads real DOM geometry/counts
 * afterward, so `assertMeasurable` runs before every reading.
 *
 * Fully hermetic — no real network to any GIS host. Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   npx vite preview --port 4188 &
 *   node ui-audit/verify-parcel-display-regimes.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const HOUSTON = { lat: 29.7550, lng: -95.3620 };

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const squareRing = (lat, lng, h) => [
  [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
];
const META_OK = JSON.stringify({ name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }] });
const EMPTY_QUERY = JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], features: [] });
const oneFeatureQuery = (lat, lng) => JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], features: [{ attributes: { OBJECTID: 1, HCAD_NUM: "1234567890123", LocAddr: "1 Test Rd" }, geometry: { rings: [squareRing(lat, lng, 0.0015)] } }] });

function seedThrowawaySite() {
  const sites = {
    s_verify_regimes: { id: "s_verify_regimes", groupId: "s_verify_regimes", site: "Regime Verify Site", name: "Plan 1", status: "active", origin: { lat: HOUSTON.lat, lon: HOUSTON.lng }, county: "harris", parcels: [], els: [], updatedAt: Date.now() },
  };
  return `(() => { try {
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`;
}

// Every county's URL gets a harmless generic answer (91 counties resolve in select mode); Harris'
// own HCAD MapServer additionally answers /query with a real point-under-cursor hit at ANY zoom,
// so a click can be proven to work in all three regimes regardless of what's drawn.
function installRoutes(page) {
  return page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.includes("gis.hctx.net")) {
      if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: oneFeatureQuery(HOUSTON.lat, HOUSTON.lng) });
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
    }
    if (/\/(MapServer|FeatureServer)\//i.test(u)) {
      if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_QUERY });
      return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
    }
    return route.continue();
  });
}

async function domState(page) {
  return page.evaluate(() => ({
    vectorPaths: document.querySelectorAll(".leaflet-overlay-pane path").length,
    parcelImg: document.querySelectorAll(".leaflet-overlay-pane img[src*='gis.hctx.net']").length,
    zoomTip: document.querySelector('[data-testid="select-parcels-tip"]')?.textContent || "",
  }));
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await assertMeasurable(page, "verify-parcel-display-regimes");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(seedThrowawaySite());
await installRoutes(page);
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const row = page.locator('div[title*="Open site"]').filter({ hasText: "Regime Verify Site" }).first();
await row.hover();
await row.locator('[aria-label="Show on map"]').click();
await page.waitForTimeout(3000); // let the fly-to-site animation fully settle before mounting
// the county display layer — mounting mid-flight (at whatever lower zoom the animation is
// passing through) can fire a transient /export at that moment, whose <img> the SUBSEQUENT
// zoomend cleanup should remove but need not have finished doing before the next assertion.
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
await page.waitForTimeout(1800);

console.log("--- CLOSE (the site's own opening zoom) — Harris/HCAD, a real MapServer CAD ---");
let s = await domState(page);
console.log(`  state: ${JSON.stringify(s)}`);
expect("vector outlines draw close-in", s.vectorPaths > 0, `${s.vectorPaths} path nodes`);
expect("no server-image overlay close-in (the vector layer owns this band)", s.parcelImg === 0);

// `map-decide-summary` renders "<N> parcel(s) · <acres> AC" once at least one is selected —
// read the leading count rather than assuming a testid this app doesn't have.
async function selectedParcelCount(page) {
  const text = await page.locator('[data-testid="map-decide-summary"]').first().textContent().catch(() => null);
  const m = text && /^(\d+)\s+parcel/.exec(text.trim());
  return m ? Number(m[1]) : 0;
}
// The mocked county always answers with the SAME feature under the click point, so a repeat
// click at the same screen position would otherwise read as "click inside an already-selected
// parcel" and TOGGLE IT OFF — clear first so each check starts from a known empty selection.
async function clearSelectionIfAny() {
  const clearBtn = page.locator('[title="Clear selection"]').first();
  if (await clearBtn.count()) { await clearBtn.click(); await page.waitForTimeout(300); }
}
async function clickAddsParcel(label) {
  await clearSelectionIfAny();
  const before = await selectedParcelCount(page);
  const box = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
  const after = await selectedParcelCount(page);
  console.log(`  [${label}] selected parcel count: ${before} -> ${after}`);
  return after > before;
}
expect("clicking the site's own point adds a parcel while close-in", await clickAddsParcel("close"));
await clearSelectionIfAny(); // the highlight itself is a separate, always-drawn `<path>` — never
// zoom-gated by design (a selected parcel stays marked at any zoom) — and would otherwise
// contaminate every `vectorPaths` reading below with a leftover count of 1.

// Zoom out with real wheel gestures (Leaflet's default scrollWheelZoom) until either the "wide"
// image layer appears or the far-zoom hint text does — polling rather than assuming a fixed
// wheel-notch-to-zoom-level mapping, because smooth zoom (B1449) means one notch's settled zoom
// delta is not guaranteed to be exactly 1.
await page.mouse.move(640, 430);
let sawWide = false, sawFar = false;
for (let i = 0; i < 30 && !sawFar; i++) {
  await page.mouse.wheel(0, 300); // positive deltaY = zoom OUT
  await page.waitForTimeout(450); // let the smooth-zoom gesture + any query settle
  s = await domState(page);
  if (!sawWide && s.parcelImg > 0) {
    sawWide = true;
    console.log(`--- WIDE reached after ${i + 1} wheel notches ---`);
    console.log(`  state: ${JSON.stringify(s)}`);
    expect("vector outlines stop drawing once the image layer takes over", s.vectorPaths === 0, `${s.vectorPaths} path nodes`);
    expect("the server-image overlay is present", s.parcelImg > 0);
    expect("clicking still adds a parcel while wide (no outline drawn at the click point)", await clickAddsParcel("wide"));
    await clearSelectionIfAny(); // see the identical note after the "close" check above
    // `clickAddsParcel`/`clearSelectionIfAny` moved the cursor onto the click point and then the
    // "Clear selection" button — put it back over the map or every wheel event below lands on
    // whatever UI it's now hovering instead of zooming (this is exactly what stalled the loop
    // the first time this harness ran: 29 more notches, zero zoom change).
    await page.mouse.move(640, 430);
    s = await domState(page); // the highlight's own `<path>` just cleared — re-read before continuing
  }
  if (/zoom in a little/i.test(s.zoomTip)) sawFar = true;
}
expect("the WIDE (image) regime was reached by zooming out", sawWide);
expect("the FAR (draw-nothing) floor was reached by continuing to zoom out", sawFar);
if (sawFar) {
  console.log("--- FAR reached (the pre-existing PARCEL_MINZOOM floor, unchanged by this item) ---");
  console.log(`  state: ${JSON.stringify(s)}`);
  expect("no vector outlines far out", s.vectorPaths === 0);
  expect("no server-image overlay far out either — neither sublayer draws below PARCEL_MINZOOM", s.parcelImg === 0);
  expect("the far-zoom hint is the pre-existing one, unchanged", /zoom in a little to see the lines/i.test(s.zoomTip));
}

expect("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);
await page.close();
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel display regimes (NEW-1, zoom-based cap-banner replacement)`);
process.exit(failures ? 1 : 0);
