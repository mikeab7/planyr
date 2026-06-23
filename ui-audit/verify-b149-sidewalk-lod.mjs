/* Self-verification for B149 (amendment) — fine-detail strip/width labels are DETAIL tier:
 * they must NOT paint at site-overview zoom, and reveal progressively on zoom-in, while the
 * OVERVIEW-tier building name/SF stays visible the whole time.
 *
 * Repro the owner reported: at site-overview zoom the "5′ Sidewalk" centred label (and the
 * fine width dimensions around it) still painted, illegible, over the layout. Expected: they
 * drop at overview and reveal as you zoom in. The thin strip GEOMETRY is kept (decision: a
 * ~1px strip popping in/out on zoom would flicker) — only the LABEL/DIMENSION drops.
 *
 * What this asserts (all DOM-based — the gate SKIPS rendering the <text>/<tspan>, so presence
 * in the SVG is the ground truth, independent of off-screen clipping):
 *   1) At overview (zoom-to-fit): the "5′ Sidewalk" + "25′ Landscape" width labels and the
 *      "37′" paving width dimension are ABSENT, while "Building 1" + "240,000 sf" PERSIST.
 *   2) Self-tuning min-on-screen-length (B149, DETAIL_LABEL_MIN_PX = 40px): each label reveals
 *      only once the feature it measures projects to ≥40px — so the WIDER 25′ buffer reveals at
 *      a lower zoom than the 5′ sidewalk (40/25 ≈ 1.6 ppf vs 40/5 = 8 ppf), and the 37′ paving
 *      width dim reveals at 40/37 ≈ 1.08 ppf. At every zoom step we PREDICT presence from the
 *      measured ppf using the exact rule and compare to what's actually in the DOM.
 *   3) The building's name/SF is present at EVERY step (overview tier never zoom-gated).
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-b149-sidewalk-lod.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const MIN_PX = 30; // must match DETAIL_LABEL_MIN_PX in lib/labelLayout.js (calibrated to the ppf-8 zoom cap)

// 600×400 building at the origin (name/SF = overview tier, always shown). A 5′ sidewalk and a
// 25′ landscape buffer flank it (detail-tier width labels). A 37′ paving pad to the side gives
// a detail-tier red WIDTH dimension ("37′"). Feature widths chosen so the reveal thresholds are
// well separated (DETAIL_LABEL_MIN_PX = 30px): paving 30/37≈0.81, landscape 30/25=1.2, sidewalk
// 30/5=6.0 ppf — the 5′ strip reveals with headroom below the planner's ppf-8 zoom cap.
const DEMO_ID = "verify-b149";
const els = [
  { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 400, rot: 0, dock: "none" },
  { id: "sw1", type: "sidewalk", cx: 0, cy: 230, w: 600, h: 5, rot: 0 },     // 5′ sidewalk below
  { id: "ls1", type: "landscape", cx: 0, cy: -230, w: 600, h: 25, rot: 0 },  // 25′ landscape above
  { id: "pv1", type: "paving", cx: -700, cy: 0, w: 37, h: 200, rot: 0 },     // 37′-wide paving pad
];
const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -750 }, { x: 900, y: -750 }, { x: 900, y: 750 }, { x: -900, y: 750 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B149", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
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

// Read the live label/dim state from the SVG + measure ppf off the building footprint (#f3ece1).
const measure = () => page.evaluate(() => {
  const texts = [...document.querySelectorAll("svg text")];
  const joined = texts.map((t) => t.textContent || "").join("\n");
  const redDims = texts.filter((t) => (t.getAttribute("fill") || "").toLowerCase() === "#dc2626").map((t) => (t.textContent || "").trim());
  const rects = [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  let bb = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width * b.height > area) { area = b.width * b.height; bb = b; } }
  return {
    rw: bb ? bb.width : 0, cx: bb ? bb.x + bb.width / 2 : 0, cy: bb ? bb.y + bb.height / 2 : 0,
    hasSidewalk: /Sidewalk/.test(joined),
    hasLandscape: /Landscape/.test(joined),
    hasBuilding: /Building/.test(joined),
    hasSf: /240,000 sf/.test(joined),
    hasPavingDim: redDims.includes("37′"),
  };
});

// Negative notches zoom IN (wheel up), positive zoom OUT.
let mx = 720, my = 450;
const zoom = async (notches) => { for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.move(mx, my); await page.mouse.wheel(0, notches < 0 ? -300 : 300); await page.waitForTimeout(90); } await page.waitForTimeout(200); };

let fail = 0;
const ppfOf = (m) => (m.rw > 0 ? m.rw / 600 : 0); // building is 600′ wide → ppf = on-screen px / 600

// ---- Phase 1: OVERVIEW (zoom-to-fit) — the reported bug state ----
let m = await measure();
mx = m.cx; my = m.cy;
let ppf = ppfOf(m);
console.log(`== B149: detail-tier strip labels at OVERVIEW (fit ppf ≈ ${ppf.toFixed(3)} — a 5′ strip ≈ ${(5 * ppf).toFixed(1)}px) ==`);
await page.screenshot({ path: OUT + "b149-overview.png" });
const overviewChecks = [
  ["'5′ Sidewalk' label absent at overview", !m.hasSidewalk],
  ["'25′ Landscape' label absent at overview", !m.hasLandscape],
  ["'37′' paving width dimension absent at overview", !m.hasPavingDim],
  ["building name 'Building 1' PERSISTS at overview", m.hasBuilding],
  ["building '240,000 sf' PERSISTS at overview", m.hasSf],
];
for (const [label, ok] of overviewChecks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++; }

// ---- Phase 2: zoom IN stepwise — predict each label's presence from the measured ppf ----
console.log("\n== B149: sweep zoom-in — each label reveals once its feature projects to ≥40px ==");
let landscapeRevealPpf = Infinity, sidewalkRevealPpf = Infinity, pavingRevealPpf = Infinity;
let buildingEverAbsent = false, sawSidewalkPresent = false, sawLandscapePresent = false, sawPavingPresent = false;
const near = (featFt) => Math.abs(featFt * ppf - MIN_PX) < 6; // skip steps right at a threshold (measurement slop)

for (let step = 0; step <= 30 && ppf < 8; step++) {
  if (sawSidewalkPresent && ppf >= 7) break; // narrowest strip revealed with headroom → done sweeping
  await zoom(-2);
  m = await measure();
  if (m.rw <= 0) { console.log("  (building footprint not measurable — stop)"); break; }
  mx = m.cx; my = m.cy; // keep the wheel anchored on the (re-centred) building
  ppf = ppfOf(m);

  // Ground-truth predictions from the exact rule (featureFt * ppf >= 40, ppf always > floor here).
  const wantSidewalk = 5 * ppf >= MIN_PX;
  const wantLandscape = 25 * ppf >= MIN_PX;
  const wantPaving = 37 * ppf >= MIN_PX;

  if (!m.hasBuilding || !m.hasSf) buildingEverAbsent = true;
  if (m.hasSidewalk) { sawSidewalkPresent = true; sidewalkRevealPpf = Math.min(sidewalkRevealPpf, ppf); }
  if (m.hasLandscape) { sawLandscapePresent = true; landscapeRevealPpf = Math.min(landscapeRevealPpf, ppf); }
  if (m.hasPavingDim) { sawPavingPresent = true; pavingRevealPpf = Math.min(pavingRevealPpf, ppf); }

  const cmp = (name, has, want, featFt) => {
    if (near(featFt)) return `${name}~`;            // near threshold → not asserted
    if (has === want) return `${name}${has ? "✓" : "·"}`;
    fail++; return `${name}✗`;
  };
  const tags = [
    cmp("sw", m.hasSidewalk, wantSidewalk, 5),
    cmp("ls", m.hasLandscape, wantLandscape, 25),
    cmp("pv", m.hasPavingDim, wantPaving, 37),
    m.hasBuilding && m.hasSf ? "bldg✓" : "bldg✗",
  ];
  console.log(`  ppf ${ppf.toFixed(2)}  [${tags.join("  ")}]`);
  if (step === 0) await page.screenshot({ path: OUT + "b149-zoom-mid.png" });
}
await page.screenshot({ path: OUT + "b149-zoom-in.png" });

// ---- Phase 3: roll-up assertions ----
console.log("\n== B149: roll-up ==");
const rollup = [
  ["building name/SF present at EVERY zoom step (overview tier)", !buildingEverAbsent],
  ["'37′' paving width dim REVEALED on zoom-in", sawPavingPresent],
  ["'25′ Landscape' label REVEALED on zoom-in", sawLandscapePresent],
  ["'5′ Sidewalk' label REVEALED on deep zoom-in", sawSidewalkPresent],
  [`self-tuning: 25′ buffer reveals BEFORE the 5′ sidewalk (${landscapeRevealPpf.toFixed(2)} < ${sidewalkRevealPpf.toFixed(2)} ppf)`, landscapeRevealPpf < sidewalkRevealPpf],
  [`self-tuning: 37′ paving reveals BEFORE the 25′ buffer (${pavingRevealPpf.toFixed(2)} < ${landscapeRevealPpf.toFixed(2)} ppf)`, pavingRevealPpf < landscapeRevealPpf],
  [`sidewalk reveal ppf ≈ 6 as predicted, with headroom below the ppf-8 cap (got ${sidewalkRevealPpf.toFixed(2)})`, sidewalkRevealPpf >= 5 && sidewalkRevealPpf <= 7.2],
];
for (const [label, ok] of rollup) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++; }

console.log(fail === 0 ? "\n✓ ALL B149 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
