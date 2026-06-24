/* B441 — verify the parcel-select highlight is OPTIMISTIC (instant) and reconciles.
 *
 * The fix: on click, MapFinder paints the parcel outline already drawn under the cursor
 * BEFORE the (variable, multi-second) county identify even starts, then the background
 * identify confirms/corrects it.
 *
 * To prove the TIMING deterministically (the live county GIS is too flaky in-sandbox —
 * it times out or the click lands on a road), this harness MOCKS the county `/query`
 * endpoint:
 *   • the display-layer bbox query (geometryType=esriGeometryEnvelope) → returns a known
 *     lot at the map centre IMMEDIATELY, so the vector outline is drawn (the optimistic
 *     hit-test has geometry to find);
 *   • the identify point query (geometryType=esriGeometryPoint) → returns the SAME lot
 *     but DELAYED 3.5 s, standing in for slow county-server latency.
 * Service-root resolution + basemap tiles are left live (they pass through).
 *
 * PASS = the SELECTED panel ("N parcel · …") appears within a few hundred ms of the
 * click — well BEFORE the 3.5 s identify resolves (optimistic), the selection SURVIVES
 * the confirm, busy clears, and the tab never crashes.
 * Run: npm run build && npx vite preview  then  node ui-audit/verify-b441-optimistic-parcel.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ORIGIN = { lat: 29.76, lon: -95.37 };
const IDENTIFY_DELAY_MS = 3500;

// One Harris site WITH an origin → the app lands on the MapFinder (not the planner).
const sites = {
  s1: { id: "s1", groupId: "s1", site: "Katy Ind", name: "Plan 1", status: "active",
        origin: ORIGIN, county: "harris",
        parcels: [{ id: "p1", points: [{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: -400, y: 300 }] }],
        els: [], updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`;

// A known lot (esri JSON, EPSG:4326) covering the map centre, big enough that a
// centre click lands inside it. esri-leaflet queries with outSR:4326, so one polygon
// serves both the display layer and the identify.
const H = 0.01;
const lot = {
  attributes: { OBJECTID: 1 },
  geometry: {
    rings: [[
      [ORIGIN.lon - H, ORIGIN.lat - H], [ORIGIN.lon + H, ORIGIN.lat - H],
      [ORIGIN.lon + H, ORIGIN.lat + H], [ORIGIN.lon - H, ORIGIN.lat + H],
      [ORIGIN.lon - H, ORIGIN.lat - H],
    ]],
    spatialReference: { wkid: 4326 },
  },
};
const queryBody = JSON.stringify({
  objectIdFieldName: "OBJECTID", globalIdFieldName: "",
  geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 },
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }],
  features: [lot],
});

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(String(e)); console.log("  [pageerror]", String(e)); });

// Mock the county /query endpoint: instant for the display layer, delayed for identify.
await page.route(/\/query\?/i, async (route) => {
  const url = route.request().url();
  const isIdentify = /esriGeometryPoint/i.test(url);
  if (isIdentify) await new Promise((r) => setTimeout(r, IDENTIFY_DELAY_MS));
  try { await route.fulfill({ status: 200, contentType: "application/json", body: queryBody }); }
  catch (_) { /* navigated away */ }
});

await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const mapVisible = await page.locator(".leaflet-container").count();
console.log(`Map container present: ${mapVisible > 0 ? "yes (PASS)" : "NO (FAIL)"}`);

const selBtn = page.locator("text=/Select parcels/i").first();
const haveBtn = await selBtn.count();
console.log(`"Select parcels" button present: ${haveBtn > 0 ? "yes" : "NO (FAIL)"}`);
if (haveBtn) await selBtn.click();

// The map lands at the Harris centre (= our origin) at zoom 11; parcel outlines only
// draw past PARCEL_MINZOOM 14. Wheel-zoom IN over the map centre (which stays on the
// origin) up past 14 so the optimistic hit-test has on-screen geometry to find.
const box = await page.locator(".leaflet-container").first().boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(500); } // 11 → ~16
// Let the (mocked, instant) vector outline layers draw at the new zoom.
await page.waitForTimeout(3000);

const busyCount = () => page.locator("text=/Looking up lot/i").count();
const selPanelCount = () => page.locator("text=/parcel[s]? ·/i").count();
const t0 = Date.now();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

// Poll fast: capture (a) when the selected panel first appears, (b) when busy clears.
let selAppearedMs = null, busyClearedMs = null, busyWasSeen = false;
for (let i = 0; i < 120; i++) { // up to ~12s
  const [busy, sel] = await Promise.all([busyCount(), selPanelCount()]);
  if (busy > 0) busyWasSeen = true;
  if (sel > 0 && selAppearedMs == null) selAppearedMs = Date.now() - t0;
  if (busyWasSeen && busy === 0 && busyClearedMs == null) busyClearedMs = Date.now() - t0;
  if (selAppearedMs != null && busyClearedMs != null) break;
  await page.waitForTimeout(100);
}

const finalSel = await selPanelCount();
console.log(`Selected panel first appeared at: ${selAppearedMs == null ? "never (FAIL)" : selAppearedMs + "ms"}`);
console.log(`Busy ("Looking up lot…") cleared at: ${busyClearedMs == null ? "n/a" : busyClearedMs + "ms"} (identify mocked at ${IDENTIFY_DELAY_MS}ms)`);
// Optimistic = the highlight showed well before the identify resolved. With identify
// pinned at 3.5s, an optimistic paint lands in a few hundred ms.
const optimistic = selAppearedMs != null && selAppearedMs < 1500 && (busyClearedMs == null || selAppearedMs < busyClearedMs - 1000);
console.log(`Highlight appeared instantly, before identify resolved (OPTIMISTIC): ${optimistic ? "yes (PASS)" : "NO (FAIL)"}`);
console.log(`Selection survived the confirm (still highlighted): ${finalSel > 0 ? "yes (PASS)" : "NO (FAIL)"}`);
// The "Looking up lot…" spinner lives in the no-selection branch — with an instant
// optimistic highlight there IS no selection-less moment, so it's expected to never show.
console.log(`"Looking up lot…" spinner: ${busyWasSeen ? `shown, cleared at ${busyClearedMs}ms` : "never shown — the lot appeared instantly (PASS)"}`);

await page.screenshot({ path: OUT + "b441-after-click.png" });
const alive = await page.evaluate(() => { try { return !!document.querySelector(".leaflet-container"); } catch (_) { return false; } });
console.log(`Tab alive after click: ${alive ? "yes (PASS)" : "NO (FAIL)"}`);
console.log(`Uncaught page errors: ${pageErrors.length} (expect 0)`);

const pass = mapVisible > 0 && haveBtn > 0 && alive && pageErrors.length === 0 && finalSel > 0 && optimistic;
console.log(`\n${pass ? "✅ PASS" : "❌ FAIL"} — B441 optimistic parcel highlight`);
await browser.close();
process.exit(pass ? 0 : 1);
