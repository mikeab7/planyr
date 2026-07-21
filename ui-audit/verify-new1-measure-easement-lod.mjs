/* Self-verification for NEW-1 — extend the B149 zoom-out declutter to USER-DRAWN Measure-tool
 * labels AND Easement labels.
 *
 * The owner's repro: draw Measure-tool distances (a long ~3,500′ run + a few short ~275′ runs) and
 * place labeled easements ("50′ Utility Esmt", "10′ Utility Esmt"), then zoom out to full site-
 * overview. Before NEW-1 those labels kept painting at fixed screen size (the auto infrastructure
 * dims already dropped under B149) — illegible clutter. Expected after NEW-1: at overview zoom the
 * measurement value labels and the easement labels are GONE (only buildings + site-level content
 * read), the measure/easement GEOMETRY stays (no flicker), each REVEALS on zoom-in, and a SELECTED
 * measurement/easement keeps its label at any zoom.
 *
 * The gate is the PURE zoom floor (dimCalloutVisible, ppf ≥ 0.18) — NOT a min-on-screen-length rule
 * (a 3,500′ run projects to hundreds of px and a length rule would keep its label at overview).
 *
 * What this asserts (all DOM-based — the gate SKIPS rendering the <text>, so presence in the SVG is
 * ground truth):
 *   1) At full site-overview (fit ppf below the floor): the "3,500′" / "275′" measurement labels and
 *      the "…Utility Esmt" easement labels are ABSENT, while "Building 1" PERSISTS and the easement
 *      hatched-fill polygons + measure hit-geometry are STILL in the DOM (keep-geometry).
 *   2) SELECTED-at-overview exception: clicking the long measurement's geometry (still there) reveals
 *      its "3,500′" label at overview; clicking the 50′ easement reveals "Utility Esmt" at overview.
 *   3) Zoom IN past the floor → every measurement + easement label REVEALS; building name persists.
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-new1-measure-easement-lod.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const FLOOR = 0.18; // must match DIM_CALLOUT_MIN_PPF (dimCalloutVisible) in lib/labelLayout.js

const DEMO_ID = "verify-new1";
// A deliberately LARGE site so zoom-to-fit lands BELOW the declutter floor (full site-overview).
// Parcel 8000×5200 ⇒ fit ppf ≈ min(1320/8000, 780/5200) ≈ 0.15 < 0.18.
const parcel = { id: "pc1", locked: false, points: [{ x: -4000, y: -2600 }, { x: 4000, y: -2600 }, { x: 4000, y: 2600 }, { x: -4000, y: 2600 }] };
const els = [
  // 1200×700 building at the origin — its name is the OVERVIEW tier (never zoom-gated).
  { id: "b1", type: "building", cx: 0, cy: 0, w: 1200, h: 700, rot: 0, dock: "none" },
];
// USER-DRAWN measurements: one long 3,500′ distance + two short 275′ distances.
const measures = [
  { id: "mLong", mode: "line", pts: [{ x: -1750, y: 1500 }, { x: 1750, y: 1500 }] },   // 3,500′
  { id: "mShortA", mode: "line", pts: [{ x: -1750, y: -1500 }, { x: -1475, y: -1500 }] }, // 275′
  { id: "mShortB", mode: "line", pts: [{ x: 1200, y: -1500 }, { x: 1475, y: -1500 }] },   // 275′
];
// Labeled easements (kind:"easement" markups). Centerline strips; `pts` is the derived ring, so the
// label rides centroid(pts). easementLabel ⇒ "50′ Utility Esmt" / "10′ Utility Esmt".
const easeAttrs = { easeType: "utility", holder: "", recording: "", exclusive: false, status: "existing", restrictsBuildings: true, restrictsPaving: false, notes: "" };
const markups = [
  { id: "e50", kind: "easement", mode: "centerline", width: 50, centerline: [{ x: -1500, y: 800 }, { x: 1500, y: 800 }],
    pts: [{ x: -1500, y: 775 }, { x: 1500, y: 775 }, { x: 1500, y: 825 }, { x: -1500, y: 825 }], ...easeAttrs },
  { id: "e10", kind: "easement", mode: "centerline", width: 10, centerline: [{ x: -1500, y: -800 }, { x: 1500, y: -800 }],
    pts: [{ x: -1500, y: -805 }, { x: 1500, y: -805 }, { x: 1500, y: -795 }, { x: -1500, y: -795 }], ...easeAttrs },
];
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify NEW-1", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures, callouts: [],
  markups, settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// Read live label state + the world→screen transform off the building footprint (fill #f3ece1).
const measure = () => page.evaluate(() => {
  const texts = [...document.querySelectorAll("svg text")];
  const joined = texts.map((t) => (t.textContent || "")).join("\n");
  const rects = [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  let bb = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width * b.height > area) { area = b.width * b.height; bb = b; } }
  return {
    cx: bb ? bb.x + bb.width / 2 : 0, cy: bb ? bb.y + bb.height / 2 : 0, rw: bb ? bb.width : 0,
    hasLong: /3,500/.test(joined),
    hasShort: /275/.test(joined),
    hasEaseLabel: /Utility Esmt/.test(joined),
    hasBuilding: /Building 1/.test(joined),
    easePolys: document.querySelectorAll('svg polygon[fill^="url(#pat-ease"]').length,
    measHit: [...document.querySelectorAll('svg polyline[stroke="transparent"]')].length,
  };
});

// building is 1200′ wide → ppf = on-screen px / 1200; transform: screen = world*ppf + t
const ppfOf = (m) => (m.rw > 0 ? m.rw / 1200 : 0);
const toScreen = (m, wx, wy) => { const ppf = ppfOf(m); return { x: m.cx + wx * ppf, y: m.cy + wy * ppf }; };
let mx = 720, my = 450;
const zoom = async (notches) => { for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.move(mx, my); await page.mouse.wheel(0, notches < 0 ? -300 : 300); await page.waitForTimeout(90); } await page.waitForTimeout(200); };

let fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++; };

// ---- Phase 1: full site-OVERVIEW (zoom-to-fit) — the reported bug state ----
let m = await measure();
mx = m.cx; my = m.cy;
let ppf = ppfOf(m);
// If the site somehow fit ABOVE the floor, zoom out until we're at a genuine overview (below floor).
for (let i = 0; i < 12 && ppf >= FLOOR; i++) { await zoom(2); m = await measure(); mx = m.cx; my = m.cy; ppf = ppfOf(m); }
console.log(`== NEW-1: measurement + easement labels at OVERVIEW (ppf ≈ ${ppf.toFixed(3)}, floor ${FLOOR}) ==`);
await page.screenshot({ path: OUT + "new1-overview.png" });
check("overview is below the declutter floor (a genuine full-site view)", ppf < FLOOR);
check("long '3,500′' measurement label ABSENT at overview", !m.hasLong);
check("short '275′' measurement label ABSENT at overview", !m.hasShort);
check("'…Utility Esmt' easement label ABSENT at overview", !m.hasEaseLabel);
check("building 'Building 1' PERSISTS at overview (overview tier)", m.hasBuilding);
check("easement hatched-fill GEOMETRY kept at overview (both easements)", m.easePolys >= 2);
check("measure hit-GEOMETRY kept at overview (3 measures)", m.measHit >= 3);

// ---- Phase 2: SELECTED-at-overview keeps the label (edit handles never vanish) ----
console.log("\n== NEW-1: a SELECTED measurement / easement keeps its label at overview ==");
// Click the long measurement's midpoint (world (0,1500)) — its hit polyline is still in the DOM.
let p = toScreen(m, 0, 1500);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(250);
let ms = await measure();
check("selecting the long measurement REVEALS '3,500′' at overview", ms.hasLong);
await page.screenshot({ path: OUT + "new1-selected-measure.png" });
// Deselect, then click the 50′ easement body (world centroid ≈ (0,800)).
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
p = toScreen(m, 0, 800);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(250);
ms = await measure();
check("selecting the 50′ easement REVEALS 'Utility Esmt' at overview", ms.hasEaseLabel);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// ---- Phase 3: zoom IN past the floor → all labels REVEAL ----
console.log("\n== NEW-1: zoom IN past the floor → measurement + easement labels REVEAL ==");
for (let i = 0; i < 16 && ppf < FLOOR + 0.06; i++) { await zoom(-2); m = await measure(); mx = m.cx; my = m.cy; ppf = ppfOf(m); }
console.log(`  (zoomed to ppf ≈ ${ppf.toFixed(3)})`);
await page.screenshot({ path: OUT + "new1-zoomed-in.png" });
check("zoomed above the floor", ppf >= FLOOR);
check("long '3,500′' measurement label REVEALED on zoom-in", m.hasLong);
check("short '275′' measurement label REVEALED on zoom-in", m.hasShort);
check("'…Utility Esmt' easement label REVEALED on zoom-in", m.hasEaseLabel);
check("building 'Building 1' still present after zoom-in", m.hasBuilding);

console.log(fail === 0 ? "\n✓ ALL NEW-1 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
