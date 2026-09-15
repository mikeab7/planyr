/* B1614544 — "LETS MAKE IT SO THAT GRIDLINES SHOW AT THE SAME ZOOM FOR ALL BUILDINGS, I DONT
 * LIKE SEEING GRID LINES ON SOME BUT NOT OTHERS." (owner report, verbatim, 2026-09-15).
 *
 * Confirmed live BEFORE this fix (this harness's mixed-size case, run against the pre-fix
 * build): a 200×150 building and a 1200×600 building on one plan, at the identical zoom, drew
 * 0 and 31 interior column-grid lines respectively. Root cause: the reveal gate compared EACH
 * building's own rendered footprint px against a fixed floor (`FEAT_BTN_MIN_PX`), so the gate
 * answer depended on which building you asked about, not on where the map was zoomed.
 *
 * The fix (buildingGrid.gridLinesVisible(ppf)) is a pure function of the render scale alone —
 * screen ppf, or the sheet's own px/ft on export — with NO building-size, position or rotation
 * term. This harness proves that property survives contact with the real renderer, across every
 * case the owner asked to see checked:
 *   1. buildings of very different sizes — the set is either all-on or all-off, at a fine sweep
 *      of zoom levels (also proves no STAGGER: every sampled frame is all-or-none, never mixed).
 *   2. buildings of the same size (sanity).
 *   3. rotated buildings.
 *   4. a building sitting partly off-screen.
 *   5. the exported sheet — same all-or-none property in the printed SVG, independent of which
 *      live zoom triggered the export.
 *
 * Run: node ui-audit/verify-grid-view-scale.mjs   (vite preview must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { GRID_MIN_PPF } from "../src/workspaces/site-planner/lib/buildingGrid.js";

// `--base=<url>` points the rig at an ALREADY-DEPLOYED build (planyr.io, or a preview) — the same
// flag shape ui-audit/verify-boot-framing.mjs uses, so the export-parity and off-screen checks can
// be re-run against production once this fix deploys (BACKLOG.md's V1149440 live-verify step).
const argBase = (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1];
const BASE = argBase || process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const GRID_LINE = "#6b7480";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const ok = (label, cond, detail) => { console.log(`  ${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); if (!cond) fail++; };

const mkSite = (id, name, els, extra = {}) => ({
  id, groupId: id, site: name, name: "Plan 1",
  origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -4000, y: -2000 }, { x: 4000, y: -2000 }, { x: 4000, y: 2000 }, { x: -4000, y: 2000 }] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1, data: { status: "active" },
  ...extra,
});

// ── Scenes ────────────────────────────────────────────────────────────────────────────────────
const MIXED = "verify-grid-mixed";     // very different sizes, far apart (region-bucketed by x)
const SAME = "verify-grid-same";       // identical sizes, far apart
const ROTATED = "verify-grid-rotated"; // very different sizes, BOTH rotated
const OFFSCREEN_SMALL = "verify-grid-offscreen-small";
const OFFSCREEN_LARGE = "verify-grid-offscreen-large";

const sites = {
  [MIXED]: mkSite(MIXED, "Verify grid mixed", [
    { id: "small", type: "building", cx: -2000, cy: 0, w: 200, h: 150, rot: 0, dock: "none" },
    { id: "large", type: "building", cx: 2000, cy: 0, w: 1200, h: 600, rot: 0, dock: "none" },
  ]),
  [SAME]: mkSite(SAME, "Verify grid same", [
    { id: "a", type: "building", cx: -1500, cy: 0, w: 400, h: 250, rot: 0, dock: "none" },
    { id: "b", type: "building", cx: 1500, cy: 0, w: 400, h: 250, rot: 0, dock: "none" },
  ]),
  [ROTATED]: mkSite(ROTATED, "Verify grid rotated", [
    { id: "smallRot", type: "building", cx: -2000, cy: 0, w: 200, h: 150, rot: 37, dock: "none" },
    { id: "largeRot", type: "building", cx: 2000, cy: 0, w: 1200, h: 600, rot: 53, dock: "none" },
  ]),
  // Single-building scenes for the export-parity check — kept as separate plans so the exported
  // SVG's grid-line presence for one size can't be confused with the other's.
  [OFFSCREEN_SMALL]: mkSite(OFFSCREEN_SMALL, "Verify grid offscreen small", [
    { id: "s", type: "building", cx: 0, cy: 0, w: 200, h: 150, rot: 0, dock: "none" },
  ]),
  [OFFSCREEN_LARGE]: mkSite(OFFSCREEN_LARGE, "Verify grid offscreen large", [
    { id: "l", type: "building", cx: 0, cy: 0, w: 1200, h: 600, rot: 0, dock: "none" },
  ]),
};
const seedFor = (cur) => `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(cur)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function openSite(cur) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(cur));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-grid-view-scale");
  await page.goto(BASE + `#/project/${cur}/site`, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.waitForFunction(() => !!window.__plannerView, { timeout: 10000 });
  return { ctx, page };
}

const gridCountsByRegion = (page) => page.evaluate((hex) => {
  const lines = [...document.querySelectorAll("svg line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === hex);
  const midX = window.innerWidth / 2;
  let left = 0, right = 0;
  for (const l of lines) {
    const mx = (+l.getAttribute("x1") + +l.getAttribute("x2")) / 2;
    if (mx < midX) left++; else right++;
  }
  return { left, right, total: lines.length };
}, GRID_LINE);

const totalGridLines = (page) => page.evaluate((hex) =>
  [...document.querySelectorAll("svg line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === hex).length, GRID_LINE);

// ── 1 & 2 & 3: fine ppf sweep, assert all-or-none at every sampled frame (also proves no
// stagger — a staggered flip would show up as a frame with left>0 XOR right>0). ─────────────────
async function sweepScene(cur, label) {
  const { ctx, page } = await openSite(cur);
  console.log(`\n== ${label}: ppf sweep across GRID_MIN_PPF (${GRID_MIN_PPF.toFixed(3)}) ==`);
  const lo = GRID_MIN_PPF * 0.5, hi = GRID_MIN_PPF * 1.6, steps = 24;
  let mixedFrames = 0, sawOn = false, sawOff = false, transitionPpf = null, prevOn = null;
  for (let i = 0; i <= steps; i++) {
    const ppf = lo + ((hi - lo) * i) / steps;
    await page.evaluate((p) => window.__plannerView.centerOn(0, 0, p), ppf);
    await page.waitForTimeout(90);
    const c = await gridCountsByRegion(page);
    const mixed = (c.left === 0) !== (c.right === 0);
    if (mixed) mixedFrames++;
    const on = c.left > 0 || c.right > 0;
    if (on) sawOn = true; else sawOff = true;
    if (prevOn === false && on === true) transitionPpf = ppf;
    prevOn = on;
    if (mixed) console.log(`  ppf ${ppf.toFixed(3)}: MIXED left=${c.left} right=${c.right}`);
  }
  ok(`${label}: never a mixed frame across the sweep`, mixedFrames === 0, `${mixedFrames}/${steps + 1} frames mixed`);
  ok(`${label}: sweep covers both a hidden and a shown state`, sawOn && sawOff, `on=${sawOn} off=${sawOff}`);
  if (transitionPpf != null) console.log(`  (transition observed near ppf ${transitionPpf.toFixed(3)})`);
  await ctx.close();
}

await sweepScene(MIXED, "MIXED SIZES (200×150 vs 1200×600)");
await sweepScene(SAME, "SAME SIZE (400×250 vs 400×250)");
await sweepScene(ROTATED, "ROTATED (37° small, 53° large)");

// ── 4: a building sitting partly off-screen — pan so most of it is outside the viewport, and
// confirm the show/hide decision still matches a fully-on-screen read at the same ppf. ─────────
async function offscreenCheck(cur, label, w) {
  const { ctx, page } = await openSite(cur);
  console.log(`\n== ${label}: partly off-screen ==`);
  const below = GRID_MIN_PPF * 0.7, above = GRID_MIN_PPF * 1.4;
  for (const [tag, ppf, expectOn] of [["below gate", below, false], ["above gate", above, true]]) {
    // Fully on-screen baseline.
    await page.evaluate((p) => window.__plannerView.centerOn(0, 0, p), ppf);
    await page.waitForTimeout(150);
    const onScreen = await totalGridLines(page);
    // Pan so only the building's left edge remains in the viewport (most of it off-screen).
    const panX = (w / 2) * 0.92;
    await page.evaluate(([p, x]) => window.__plannerView.centerOn(x, 0, p), [ppf, panX]);
    await page.waitForTimeout(150);
    const offScreenPartial = await totalGridLines(page);
    ok(`${label}: ${tag} — on-screen grid ${expectOn ? ">0" : "=0"}`, expectOn ? onScreen > 0 : onScreen === 0, `count ${onScreen}`);
    ok(`${label}: ${tag} — partly-off-screen grid matches (${expectOn ? ">0" : "=0"})`, expectOn ? offScreenPartial > 0 : offScreenPartial === 0, `count ${offScreenPartial}`);
  }
  await page.screenshot({ path: OUT + `grid-offscreen-${cur}.png` });
  await ctx.close();
}

await offscreenCheck(OFFSCREEN_SMALL, "SMALL building off-screen", 200);
await offscreenCheck(OFFSCREEN_LARGE, "LARGE building off-screen", 1200);

// ── 5: printed/exported sheet matches what the canvas shows, and doesn't depend on which
// live zoom triggered the export (the sheet reasons at its OWN scale — exportLabelScale.js). ───
const exportHook = `(() => {
  window.__exportSvgs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try { if (b && typeof b.type === "string" && b.type.indexOf("svg") >= 0) b.text().then((t) => window.__exportSvgs.push(t)).catch(() => {}); } catch (e) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
})();`;

async function exportGridLineCount(cur, triggerPpf) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(cur));
  await ctx.addInitScript(exportHook);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-grid-view-scale (export)");
  await page.goto(BASE + `#/project/${cur}/site`, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.waitForFunction(() => !!window.__plannerView, { timeout: 10000 });
  await page.evaluate((p) => window.__plannerView.centerOn(0, 0, p), triggerPpf);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__exportSvgs.length = 0; });
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Export PNG" }).click();
  for (let i = 0; i < 80 && !(await page.evaluate(() => window.__exportSvgs.length)); i++) await page.waitForTimeout(250);
  const svgs = await page.evaluate(() => window.__exportSvgs);
  await ctx.close();
  if (!svgs.length) throw new Error(`no export payload captured for ${cur} @ ${triggerPpf}`);
  const svg = svgs[0];
  const count = [...svg.matchAll(/<line\b[^>]*stroke="#6b7480"[^>]*>/g)].length;
  return count;
}

console.log("\n== EXPORT PARITY: single-building sheets, triggered from two very different live zooms ==");
for (const triggerPpf of [0.05, 1.2]) {
  const smallCount = await exportGridLineCount(OFFSCREEN_SMALL, triggerPpf);
  const largeCount = await exportGridLineCount(OFFSCREEN_LARGE, triggerPpf);
  console.log(`  trigger ppf ${triggerPpf}: small-plan sheet grid lines ${smallCount} · large-plan sheet grid lines ${largeCount}`);
  ok(`export @ live-trigger ppf ${triggerPpf}: both plans agree (both drawn or both absent)`,
    (smallCount === 0) === (largeCount === 0), `small=${smallCount} large=${largeCount}`);
}

await browser.close();
console.log(fail === 0 ? "\n✅ ALL GRID VIEW-SCALE CHECKS PASSED" : `\n❌ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
