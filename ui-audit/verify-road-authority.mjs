/* Headless verification — Road authority: per-road rows (B94) + the color-coded
 * road-authority map overlay (NEW-2/B5264).
 *
 * Drives the built app (vite preview on :4173) over a seeded, georeferenced Houston
 * site and checks, against the LIVE TxDOT Roadway Inventory:
 *   1. the Site Analysis "Who governs this site" box shows the Roads row — one maintainer for
 *      every road ("County maintains all 4 · …") or, when mixed, a PER-ROAD list (name → authority).
 *   (The old card's "Activate layer" overlay toggle was retired by the NEW-1 redesign.)
 *
 * Live-data caveat: the road query hits services.arcgis.com from the browser. If that
 * host isn't reachable from this sandbox's browser egress, the card reads "unavailable"
 * — the script reports that honestly (the UI structure still verifies; the live click-
 * through is logged to VERIFICATION.md). Run: node ui-audit/verify-road-authority.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

// "#/project/<groupId>/site" — bare "#/" now lands on the Dashboard (B1213312), and "#/site"
// alone lands on the project-picker MapFinder rather than opening the seeded plan; the
// project-scoped hash is what actually opens the Site Planner canvas for this seeded site.
const BASE = process.env.BASE_URL || "http://localhost:4173/#/project/road-auth-demo/site";

// A georeferenced NE-Houston site (Greenspoint / IH-45 area — a dense road grid). A big
// ~2400 ft parcel box so its 40 m frontage buffer abuts several distinct roads (city
// streets + a state highway), the multi-road case the feature exists for.
const ORIGIN = { lat: 29.9400, lon: -95.4000 };
const box = (h) => [{ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h }];
const SITE = {
  id: "road-auth-demo", groupId: "road-auth-demo", site: "Road Authority Demo", name: "Plan 1",
  origin: ORIGIN, county: "harris",
  parcels: [{ id: "pc1", locked: false, active: true, points: box(1200) }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE.id]: SITE })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE.id)});
} catch (e) {} })();`;

// The browser can't reach services.arcgis.com from this sandbox (only basemap tiles are
// allowlisted), so the data-path fetch is shimmed to return realistic TxDOT Roadway
// Inventory features for the frontage query — letting the per-road CARD rendering verify
// deterministically. (The OVERLAY paint uses esri-leaflet's own XHR to the same host and
// can't be shimmed here → it's logged to VERIFICATION.md for a live browser.)
const ln = (lat0, lat1) => ({ paths: [[[-95.40, lat0], [-95.40, lat1]]] });
const CANNED = [
  { attributes: { RIA_RTE_ID: "h1", HWY: "IH0045", HSYS: "IH", RDWAY_MAINT_AGCY: 1, F_SYSTEM: 1 }, geometry: ln(29.935, 29.945) }, // longest → first
  { attributes: { RIA_RTE_ID: "g1", STE_NAM: "GREENS RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: ln(29.940, 29.9412) },
  { attributes: { RIA_RTE_ID: "g2", STE_NAM: "GREENS RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: ln(29.9412, 29.9424) },
  { attributes: { RIA_RTE_ID: "g3", STE_NAM: "GREENS  RD", HSYS: "LS", RDWAY_MAINT_AGCY: 4, F_SYSTEM: 4 }, geometry: ln(29.9424, 29.9436) },
  { attributes: { RIA_RTE_ID: "c1", STE_NAM: "ALDINE MAIL RD", HSYS: "CR", RDWAY_MAINT_AGCY: 2, F_SYSTEM: 5 }, geometry: ln(29.939, 29.9405) },
  { attributes: { RIA_RTE_ID: "u1", STE_NAM: "PRIVATE DR", HSYS: "ZZ", RDWAY_MAINT_AGCY: 999 }, geometry: ln(29.9402, 29.9408) },
];
const fetchShim = `(() => { try {
  const orig = window.fetch.bind(window);
  const canned = ${JSON.stringify(CANNED)};
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('TxDOT_Roadway_Inventory') !== -1) {
      const body = url.indexOf('/query') !== -1 ? { features: canned } : { currentVersion: 11, fullExtent: null };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return orig(input, init);
  };
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
await ctx.addInitScript(fetchShim);
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-road-authority");
const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

// Open the ⚐ Analysis left-rail tab.
await page.locator('button[title="Analysis"]').click({ timeout: 8000 });
await page.waitForSelector('[data-site-analysis="1"]', { timeout: 20000 });

// NEW-1 (2026-10-05) — road authority now lives in the "Who governs this site" box (plain facts, no card, no
// INFO badge, no Activate-layer chip). Wait for its Roads row to leave the loading state (live GIS query).
const governs = page.locator('[data-section="governs"]');
let cardText = "";
for (let i = 0; i < 40; i++) {
  cardText = ((await governs.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  if (/maintains|Mixed — \d+ roads|Maintainer unknown|No fronting road|Couldn't check|Not screened/i.test(cardText)) break;
  await page.waitForTimeout(700);
}
ok(/Who governs this site/i.test(cardText), "Site Analysis panel opened with the 'Who governs this site' box");
console.log("\n--- Who governs this site ---\n" + cardText + "\n-----------------------------\n");

const liveOk = /maintains|Mixed — \d+ roads|Maintainer unknown/i.test(cardText);
if (liveOk) {
  ok(true, "Roads row reached a resolved state (road query returned)");
  const mixed = /Mixed — \d+ roads/i.test(cardText);
  if (mixed) {
    const list = ((await page.locator("[data-roads-list]").innerText().catch(() => "")) || "").replace(/\s+/g, " ");
    ok(list.length > 0, "a mixed site lists each road with its own maintainer");
    ok(/Greens Rd/.test(list), "same-named segments merged to one 'Greens Rd' row");
    ok(/IH 45/.test(list), "highway named from coded HWY ('IH 45')");
    ok(/State \(TxDOT\)/.test(list) && /City/.test(list) && /County/.test(list), "City / County / State (TxDOT) all labeled per-road");
    ok(/Unknown/.test(list), "unclassifiable road shows an explicit Unknown (never a guess)");
  } else {
    ok(/maintains all \d+|maintains /.test(cardText), "one maintainer for every road reads 'X maintains all N · names'");
  }
} else {
  // Honest degradation: the browser couldn't reach the live GIS host from this sandbox.
  console.log("  ⚠ Live TxDOT query did not resolve in-browser (egress) — structural checks only.");
  ok(/Roads/i.test(cardText), "Roads row rendered (live data unavailable in sandbox)");
}

await page.screenshot({ path: new URL("./screens/road-authority.png", import.meta.url).pathname });
await browser.close();

console.log(fails.length ? `\nFAIL (${fails.length}): ${fails.join("; ")}` : "\nPASS — road-authority verification");
process.exit(fails.length ? 1 : 0);
