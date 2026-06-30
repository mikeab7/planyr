/* Self-verification for B568/B569 — the structural column grid + dock doors actually RENDER
 * on a drawn building (the integration the unit tests can't cover: lib geometry → SVG).
 *
 * Seeds two buildings logged-out (this-device mode, no auth):
 *   • single-load 336×260 (dock bottom) — speed bay 60′ off the dock face, 56′×50′ typ bays
 *   • cross-dock   336×320 (docks both long walls) — a speed bay mirrored to BOTH walls
 *
 * Asserts (DOM ground truth — colors come straight from the GRID_* constants in SitePlanner):
 *   1) After zooming so the footprint clears the FEAT_BTN_MIN_PX grid gate, the interior
 *      column lines (#6b7480) and the speed-bay line(s) (#E0552E) are present in the SVG.
 *   2) Single-load shows exactly ONE speed-bay line; cross-dock shows TWO (mirror symmetry).
 *   3) Dock-door leaves (#c2c9d2) render along the dock wall.
 *   4) At site-overview (zoom-to-fit, footprint below the gate) the interior grid lines are
 *      ABSENT — the grid reveals only when legible, never clutters zoomed out.
 *
 * Run:  node ui-audit/verify-b568-b569-grid.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const GRID_LINE = "#6b7480", GRID_SPEED = "#e0552e", DOOR = "#c2c9d2";

const mkSite = (id, name, els) => ({
  id, groupId: id, site: name, name: "Plan 1",
  origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -700, y: -600 }, { x: 700, y: -600 }, { x: 700, y: 600 }, { x: -700, y: 600 }] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
});
// length runs along the dock wall; w is the long (length) axis, h the depth axis.
const SINGLE = "verify-b568-single";
const CROSS = "verify-b568-cross";
const sites = {
  [SINGLE]: mkSite(SINGLE, "Verify B568 single", [{ id: "b1", type: "building", cx: 0, cy: 0, w: 336, h: 260, rot: 0, dock: "single", dockSide: "bottom" }]),
  [CROSS]: mkSite(CROSS, "Verify B568 cross", [{ id: "b1", type: "building", cx: 0, cy: 0, w: 336, h: 320, rot: 0, dock: "cross" }]),
};
const seedFor = (cur) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(cur)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const strokeCount = (page, hex) => page.evaluate((h) => [...document.querySelectorAll("svg line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === h).length, hex);
const fillCount = (page, hex) => page.evaluate((h) => [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === h).length, hex);

let fail = 0;
const ok = (label, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

async function run(cur, label, expectSpeedLines) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(cur));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
  await page.waitForTimeout(500);

  // Zoom IN so the footprint clears the FEAT_BTN_MIN_PX gate.
  const mid = await page.evaluate(() => {
    const rects = [...document.querySelectorAll("svg rect")];
    let bb = null, area = 0;
    for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width * b.height > area && b.width > 30) { area = b.width * b.height; bb = b; } }
    return bb ? { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } : { x: 720, y: 450 };
  });
  for (let i = 0; i < 6; i++) { await page.mouse.move(mid.x, mid.y); await page.mouse.wheel(0, -300); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `b568-${cur}-zoomed.png` });

  console.log(`\n== ${label}: zoomed in — grid + doors should RENDER ==`);
  const interior = await strokeCount(page, GRID_LINE);
  const speed = await strokeCount(page, GRID_SPEED);
  const doors = await fillCount(page, DOOR);
  console.log(`  (interior lines ${interior} · speed lines ${speed} · door leaves ${doors})`);
  ok(`${label}: interior column lines render`, interior >= 3);
  ok(`${label}: ${expectSpeedLines} speed-bay line(s) render`, speed === expectSpeedLines);
  ok(`${label}: dock-door leaves render`, doors >= 3);

  // Zoom OUT far so the footprint drops below the grid gate — the grid must vanish.
  for (let i = 0; i < 16; i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, 300); await page.waitForTimeout(70); }
  await page.waitForTimeout(400);
  const interiorOut = await strokeCount(page, GRID_LINE);
  const speedOut = await strokeCount(page, GRID_SPEED);
  await page.screenshot({ path: OUT + `b568-${cur}-zoomout.png` });
  console.log(`  (zoomed OUT: interior ${interiorOut} · speed ${speedOut})`);
  ok(`${label}: grid hidden when zoomed out below the gate (LOD)`, interiorOut === 0 && speedOut === 0);

  await ctx.close();
}

await run(SINGLE, "single-load", 1);
await run(CROSS, "cross-dock", 2);

console.log(fail === 0 ? "\n✓ ALL B568/B569 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
