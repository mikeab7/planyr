/* Self-verification for B221 + B222 (building feature-edit button visibility).
 *
 * Seeds a single 400'×300' cross-dock building inside a parcel, boots the planner,
 * and verifies the combined visibility rule for the +/− feature-add buttons (truck
 * dock / sidewalk / bump-out — the coloured circles with an "Add …"/"Remove this"
 * <title>):
 *
 *   B221 — the buttons hide once the building's rendered ON-SCREEN footprint drops
 *          below the legibility threshold (FEAT_BTN_MIN_PX = 72px), gated PER AXIS:
 *          a wall's +/− needs its perpendicular on-screen size ≥ 72px. So on a
 *          long/narrow on-screen footprint the long-side buttons persist while the
 *          cramped short-end ones drop (overlap handled without a collapse menu),
 *          and when the whole footprint is tiny ALL of them vanish (no spill/cluster).
 *          At every zoom step we PREDICT the count from the measured px using the
 *          exact rule and compare to what's actually drawn.
 *
 *   B222 — the buttons render only for ONE building (selected, or — when nothing is
 *          selected — hovered), never every building at once. We deselect, then show
 *          that hovering the building reveals its buttons and moving off hides them.
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-b221-b222.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const MIN = 72; // must match FEAT_BTN_MIN_PX in SitePlanner.jsx

const DEMO_ID = "verify-b221";
// 400 (w) × 300 (h) cross-dock building → long sides = top/bottom (truck-dock buttons),
// short sides = left/right (sidewalk buttons), 4 bump-out buttons at the dock corners.
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 400, h: 300, rot: 0, dock: "cross", dockSide: "bottom" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -450 }, { x: 700, y: -450 }, { x: 700, y: 450 }, { x: -700, y: 450 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B221", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// Measure: the building footprint rect (fill #f3ece1) on-screen size + the count of
// feature-add buttons currently drawn (g > title starting "Add " or "Remove this").
const measure = () => page.evaluate(() => {
  const rects = [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  let bb = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width * b.height > area) { area = b.width * b.height; bb = b; } }
  const titles = [...document.querySelectorAll("svg g title")].map((t) => t.textContent || "");
  const feat = titles.filter((t) => /^Add |^Remove this/.test(t));
  return { rw: bb ? bb.width : 0, rh: bb ? bb.height : 0, cx: bb ? bb.x + bb.width / 2 : 0, cy: bb ? bb.y + bb.height / 2 : 0, btn: feat.length };
});

// Predicted count for a w>h cross-dock building (dock=top/bottom → gated on height-px;
// sidewalk=left/right → gated on width-px; 4 corner bump-outs → need both axes).
const predict = (rw, rh) => (rh >= MIN ? 2 : 0) + (rw >= MIN ? 2 : 0) + (Math.min(rw, rh) >= MIN ? 4 : 0);

// Negative notches zoom IN, positive zoom OUT (wheel down = zoom out).
let mx = 820, my = 450;
const zoom = async (notches) => { for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.move(mx, my); await page.mouse.wheel(0, notches < 0 ? -300 : 300); await page.waitForTimeout(120); } await page.waitForTimeout(250); };

let m = await measure();
mx = m.cx; my = m.cy;
// A canvas point that's OFF the building but still over the SVG (over the parcel) so a
// move there fires onMove and clears hover — NOT the side panel (no events there).
const offPt = () => [Math.min(1390, m.cx + m.rw * 0.75 + 40), m.cy];

// ---- B222 (tested FIRST — nothing is selected at boot, so no deselect needed): hover
//      reveals the buttons on the hovered building when nothing is selected ----
console.log("== B222: selected-or-hovered (one building only) ==");
console.log(`  (fit footprint ${m.rw.toFixed(0)}×${m.rh.toFixed(0)}px — ≥ ${MIN}px so the size gate passes)`);
await page.mouse.move(...offPt()); await page.waitForTimeout(150);
const offA = await measure();
await page.mouse.move(mx, my); await page.waitForTimeout(150); // hover the building
const onHover = await measure();
await page.screenshot({ path: OUT + "b222-hover.png" });
await page.mouse.move(...offPt()); await page.waitForTimeout(150); // move off again
const offB = await measure();
console.log(`  nothing-selected+off=${offA.btn}  hovering=${onHover.btn}  off-again=${offB.btn}`);
let fail = 0;
if (offA.btn !== 0) { console.log("  ✗ buttons shown with nothing selected and not hovering"); fail++; }
if (onHover.btn < 1) { console.log("  ✗ hovering the building did NOT reveal its buttons"); fail++; }
if (offB.btn !== 0) { console.log("  ✗ buttons stayed after moving off the building"); fail++; }

// Select the building (click its centre — clear of the inset buttons at fit zoom).
await page.mouse.click(mx, my);
await page.waitForTimeout(200);

// ---- B221: sweep from zoomed-IN down to deeply zoomed-OUT, asserting at each step ----
console.log("== B221: footprint-gated feature buttons (selected building) ==");
let sawFull = false, sawPartial = false, sawNone = false;
await zoom(-4); // start big
for (let step = 0; step <= 18; step++) {
  m = await measure();
  mx = m.cx; my = m.cy; // keep the wheel anchored on the (re-centred) building
  const want = predict(m.rw, m.rh);
  // Skip a step whose either axis sits within the stroke-width slop of the threshold
  // (the rect bbox includes the ~3px building stroke, so right at 72px it's ambiguous).
  const ambiguous = Math.abs(m.rw - MIN) < 6 || Math.abs(m.rh - MIN) < 6;
  const tag = `  ftprint ${m.rw.toFixed(0)}×${m.rh.toFixed(0)}px  buttons=${m.btn}  predicted=${want}`;
  if (ambiguous) { console.log(`${tag}  (near-threshold — not asserted)`); }
  else if (m.btn === want) { console.log(`${tag}  ✓`); }
  else { console.log(`${tag}  ✗ MISMATCH`); fail++; }
  if (!ambiguous) {
    if (m.btn === 8) sawFull = true;
    if (m.btn === 2 && m.rw >= MIN && m.rh < MIN) sawPartial = true; // long-side only: per-axis collision handling
    if (m.btn === 0 && Math.max(m.rw, m.rh) < MIN) sawNone = true;
  }
  if (step === 1) await page.screenshot({ path: OUT + "b221-zoomed-in.png" });
  if (m.btn === 2) await page.screenshot({ path: OUT + "b221-partial-longside.png" });
  if (m.btn === 0 && m.rw > 0) await page.screenshot({ path: OUT + "b221-zoomed-out.png" });
  await zoom(2);
}
if (!sawFull) { console.log("  ✗ never saw the full 8-button state (zoomed in)"); fail++; }
if (!sawPartial) { console.log("  ✗ never saw the long-side-only (2-button) state — per-axis collision handling not demonstrated"); fail++; }
if (!sawNone) { console.log("  ✗ never saw the all-hidden state (zoomed out)"); fail++; }

console.log(fail === 0 ? "\n✓ ALL B221+B222 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
