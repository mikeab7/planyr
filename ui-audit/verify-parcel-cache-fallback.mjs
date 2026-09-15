/* Verify B1164656/B1164657 (NEW-1/NEW-2) — the Drive-backed county PARCEL SNAPSHOT (B629) is
 * actually USED to select a lot when the live parcel sources are down, and the outage banner
 * names the cache honestly. This is the deterministic harness NEW-3/B1164658 asks for: V199 had
 * been parked since 2026-07-04 because nobody could make the live source fail on demand
 * (PR #691 re-parked it 2026-07-18 with a `Blocker: live-GIS`). This harness makes the outage
 * on demand, so the mechanism is a normal CI check instead of a wait for a real one.
 *
 * Fully hermetic — no real network to any GIS host or to Google Drive is needed or attempted:
 *   - The three live parcel hosts (gisdata.pandai.com [Chambers CCAD], feature.geographic.texas.gov
 *     [TxGIO statewide — Waller's only live source, and the universal fallback], www.gis.hctx.net
 *     [Harris HCAD]) are either ABORTED (outage scenarios) or served a canned ArcGIS JSON hit
 *     (Harris control) via page.route — never dialed for real, so this runs in any environment,
 *     including this sandbox (whose egress proxy resets Chromium's connection to real GIS hosts
 *     and to planyr.io — the reason V199 itself could never be driven from here).
 *   - `/api/parcel-cache/svc/<county>` (same-origin) is served a canned response too — `vite
 *     preview` serves only the static build, not the Cloudflare Pages Function, so the endpoint
 *     wouldn't exist at all without a mock. This tests the CLIENT's use of a well-formed response;
 *     the SERVER's own decompression is separately unit-tested (test/parcelCacheHandler.test.js).
 *   - The Esri World Geocoding endpoint is mocked too — used only to FLY the map to the test
 *     point at a parcel-selectable zoom (mirrors how Michael's own repro used an address search),
 *     never to answer the identify itself.
 *
 * Why address-search-then-click, not a bare map click: this MapFinder screen (bare `#/site`, no
 * project chosen — "Select a project ▾") lands at a metro-wide ~5 mi view with no reliable way to
 * reach parcel-selectable zoom (>= PARCEL_MINZOOM 14) other than a real geocode fly-to (manual
 * wheel/zoom-button automation was tried and is not reliable headless — Leaflet's synthetic wheel
 * handling and the zoom control both proved flaky under Playwright). The address search's own
 * `selectParcelAt` path already had a working (pre-fix) cache fallback, so it would trivially pass
 * even on the old code — the harness instead flies there, CLEARS the search's own selection (the
 * decide bar's ✕ — an instant local action, zero network, B441's same toggle-off underneath), then
 * arms Select-parcels mode and clicks the SAME point to force a fresh `handleClick` →
 * `identifyParcelEager` → cache-fallback pass, which is the exact code NEW-1 fixed.
 * (B1430384 moved the address field OUT of Select-parcels mode — it did nothing there — so the
 * search now has to run before that mode is armed, not after; see `flyThenForceFreshClick`.)
 *
 * Three scenarios:
 *   1. Chambers, live down → cached outlines paint, the fresh click selects the lot, and the
 *      "Cached copy · as of" badge names the county + date. Chambers has its OWN live CAD (CCAD),
 *      so this is the case NEW-1 was actually filed for — pre-fix, `handleClick`'s cache fallback
 *      only fired when the snapshot happened to already be the DISPLAYED layer, which is never
 *      true for a county with its own live source.
 *   2. Waller, live down → same three assertions. Waller's only live source IS the statewide layer
 *      that's blocked, so its optimistic-hit path already worked pre-fix — kept as a regression
 *      guard, not because it was broken.
 *   3. Harris control — no snapshot for Harris (SNAPSHOT_COUNTIES excludes it): confirms the
 *      "Cached copy" badge never renders there, proving the fallback fires only where a snapshot
 *      actually exists (live answers via a canned hit so no real network reach is required).
 *
 * Run:  VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *       npx vite preview --port 4188 &
 *       node ui-audit/verify-parcel-cache-fallback.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const GENERATED_AT_ISO = "2026-08-04T10:37:33Z";
const GENERATED_AT_HUMAN = "Aug 4, 2026";

// A small square GeoJSON ring around {lat,lng}, half-side in degrees (~ a few acres at these lats).
const squareRing = (lat, lng, h) => [
  [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
];

function fixture(lat, lng, county) {
  return {
    meta: { cached: true, generatedAt: GENERATED_AT_ISO, count: 1, source: "stratmap-2025", stale: false },
    fc: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { OBJECTID: 1, Prop_ID: "TEST1", OWNER_NAME: "TEST OWNER", LEGAL_AREA: 5.0, GIS_AREA: 5.0, SITUS_ADDR: "123 Test Rd", county },
        geometry: { type: "Polygon", coordinates: [squareRing(lat, lng, 0.0015)] },
      }],
    },
  };
}

const CHAMBERS = { lat: 29.75, lng: -94.70 };
const WALLER = { lat: 30.05, lng: -95.95 };
const HARRIS = { lat: 29.76, lng: -95.37 };

const FIXTURES = {
  chambers: fixture(CHAMBERS.lat, CHAMBERS.lng, "CHAMBERS"),
  waller: fixture(WALLER.lat, WALLER.lng, "WALLER"),
};

// Seed one site with an `origin` so the "Select a project" MapFinder screen has something to
// show, and pre-provision the current project as none (bare `#/site` = the map-first screen).
function seedFor(id, lat, lng, county) {
  const sites = {
    [id]: {
      id, groupId: id, site: "Parcel Cache Fallback Test", name: "Plan 1", status: "active",
      origin: { lat, lon: lng }, county,
      parcels: [], els: [], updatedAt: Date.now(),
    },
  };
  return `(() => { try {
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`;
}

// One router for every scenario: abort the blocked live hosts, answer the geocoder + the
// same-origin parcel-cache endpoint, and (Harris only) answer HCAD's own /query with a canned hit.
function installRoutes(page, { blockHosts, geocodeTo, harrisHit }) {
  return page.route("**/*", (route) => {
    const u = route.request().url();
    if (blockHosts.some((h) => u.includes(h))) return route.abort("connectionfailed");
    if (u.includes("geocode.arcgis.com")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        candidates: [{ location: { y: geocodeTo.lat, x: geocodeTo.lng }, address: geocodeTo.label }],
      }) });
    }
    if (u.includes("/api/parcel-cache/svc/")) {
      const url = new URL(u);
      const county = url.pathname.split("/").filter(Boolean)[3];
      const f = FIXTURES[county];
      if (!f) return route.fulfill({ status: 404 });
      const isMeta = url.searchParams.get("meta") === "1";
      return route.fulfill({
        status: 200,
        contentType: isMeta ? "application/json" : "application/geo+json",
        body: JSON.stringify(isMeta ? f.meta : f.fc),
      });
    }
    if (harrisHit && u.includes("HCAD/Parcels/MapServer")) {
      const ring = squareRing(HARRIS.lat, HARRIS.lng, 0.0015);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        features: [{ geometry: { rings: [ring] }, attributes: { OBJECTID: 1, HCAD_NUM: "1234567890123", LEGAL_AREA: 2.0, GIS_AREA: 2.0, SITUS_ADDR: "1 Test Blvd" } }],
      }) });
    }
    return route.continue();
  });
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await assertMeasurable(page, "verify-parcel-cache-fallback");
  const pageErrors = [];
  page.on("pageerror", (e) => { pageErrors.push(String(e)); console.log("  [pageerror]", String(e)); });
  return { page, pageErrors };
}

// Fly to {lat,lng} via the (mocked) address search, then force a FRESH `handleClick` pass at
// that point — the code path NEW-1 fixed. Returns nothing; leaves the map ready for assertions.
//
// B1430384 (NEW-1) — the address field no longer renders while Select-parcels mode is active
// (it earns its place only outside that mode), so the search has to run BEFORE arming
// selection, not after. It still auto-selects the parcel there via `selectParcelAt` — that
// selection is cleared with the decide bar's ✕ (also a local, zero-network action, same role
// the old "click to deselect" step played) so Select parcels can then be armed and the one map
// click that follows lands on a genuinely empty spot, forcing the full `handleClick` →
// `identifyParcelEager` → cache-fallback path rather than the instant local toggle-off.
async function flyThenForceFreshClick(page, label) {
  const input = page.locator('input[placeholder*="Type an address"]').first();
  await input.click();
  await input.fill(label);
  await page.waitForTimeout(600);
  await input.press("Enter");
  await page.waitForTimeout(4000); // fly-to + selectParcelAt's own identify settle
  const clearBtn = page.getByTestId("map-decide-clear");
  if (await clearBtn.count()) { await clearBtn.click(); await page.waitForTimeout(300); }
  await page.locator("text=/^Select parcels/").first().click();
  await page.waitForTimeout(500);
  const box = await page.locator(".leaflet-container").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // fresh handleClick
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// ── 1 & 2: outage scenarios ────────────────────────────────────────────────────────────────────
for (const [county, pt] of [["chambers", CHAMBERS], ["waller", WALLER]]) {
  const Label = county[0].toUpperCase() + county.slice(1);
  console.log(`\n--- ${Label}, live parcel sources down ---`);
  const { page, pageErrors } = await newPage(browser);
  await installRoutes(page, {
    blockHosts: ["gisdata.pandai.com", "feature.geographic.texas.gov", "www.gis.hctx.net"],
    geocodeTo: { ...pt, label: `Test Lot, ${Label} County, TX` },
  });
  await page.addInitScript(seedFor(`s_${county}`, pt.lat, pt.lng, county));
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  await flyThenForceFreshClick(page, `Test Lot, ${Label} County, TX`);

  const pathCount = await page.locator(".leaflet-container path").count();
  expect(`${Label}: some vector outline drew with both live sources blocked (proxy for the cache display)`, pathCount > 0, `${pathCount} <path> elements`);

  const notice = page.locator('[data-testid="parcel-cached-notice"]');
  const noticeVisible = await notice.count() > 0 && await notice.isVisible().catch(() => false);
  const noticeText = noticeVisible ? await notice.innerText() : "";
  expect(`${Label}: "Cached copy" badge renders on the FRESH click (not just the search's own selection)`, noticeText.includes("Cached copy"), noticeText || "(not shown)");
  expect(`${Label}: badge names the snapshot's as-of date`, noticeText.includes(GENERATED_AT_HUMAN), noticeText || "(not shown)");

  const summary = page.locator("text=/1 parcel/i");
  const selected = await summary.count() > 0 && await summary.isVisible().catch(() => false);
  expect(`${Label}: the lot was actually selected (sidebar shows "1 parcel · … AC")`, selected);

  expect(`${Label}: no uncaught page errors`, pageErrors.length === 0, `${pageErrors.length} errors`);
  await page.close();
}

// ── 3: control — Harris has no Drive snapshot, so the cache badge must never appear. ───────────
console.log("\n--- Harris control (no Drive snapshot for this county) ---");
{
  const { page, pageErrors } = await newPage(browser);
  await installRoutes(page, {
    blockHosts: [], // nothing blocked — live "answers" via the canned HCAD hit below
    geocodeTo: { ...HARRIS, label: "1 Test Blvd, Houston, TX" },
    harrisHit: true,
  });
  await page.addInitScript(seedFor("s_harris", HARRIS.lat, HARRIS.lng, "harris"));
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  await flyThenForceFreshClick(page, "1 Test Blvd, Houston, TX");

  const notice = page.locator('[data-testid="parcel-cached-notice"]');
  const noticeVisible = await notice.count() > 0 && await notice.isVisible().catch(() => false);
  expect('Harris: no "Cached copy" badge (no snapshot exists for this county)', !noticeVisible, noticeVisible ? await notice.innerText() : "");
  expect("Harris: no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} errors`);
  await page.close();
}

await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel-cache fallback (B1164656/B1164657)`);
process.exit(failures ? 1 : 0);
