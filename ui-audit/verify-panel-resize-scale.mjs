/* verify-panel-resize-scale — dragging a docked side panel wider must NOT shrink the map (NEW-1).
 *
 * Owner report, 2026-10-06: "as I resize the left menu, it literally shrinks everything else on the
 * site." Root cause (measured): the planner canvas SVG is `width/height 100%` with
 * `viewBox="0 0 size.w size.h"`, and `size` was floored at 320 × 360. Once the map pane got narrower
 * than 320 CSS px — a wide docked panel on a laptop-width / zoomed window — the viewBox outgrew the
 * element and the browser's default `preserveAspectRatio` ("meet") scaled the WHOLE DRAWING down in
 * proportion to the pane (0.79 at 252 px, 0.475 at 152, 0.16 at 52) while `view.ppf` — and so the
 * scale-bar label — stayed put. The previous chat's non-reproduction ran at 1191 px wide, where the
 * pane bottoms out at 343 px: just above the floor. THE WIDTH WAS THE VARIABLE (WRONG-CASE).
 *
 * What this drives, per window size: open a left-rail panel, drag its real "Drag to resize" grip to
 * three widths and back, and after EVERY drag measure
 *   · the SVG's screen scale (getScreenCTM().a — must be exactly 1: the drawing is never scaled),
 *   · the viewBox vs the element's own box (must match),
 *   · view.ppf (the map scale — must not change),
 *   · a fixed drawn element's on-screen size and position (must not move or resize),
 *   · a Leaflet basemap tile's on-screen size and position (the aerial must not rezoom or slide),
 *   · chrome text heights: the panel header, the app header, a rail tab (must not change).
 * Window sizes include a SHORT one (the same floor existed vertically at 360 tall) and every other
 * left-rail panel is swept at the narrowest width.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL §6): at 1920 × 1080 the pane can never drop under the old floor, so
 * that window must read scale 1 on ANY build. If it does not, the instrument is broken and the run
 * is VOID rather than scored. `--expect-red` inverts the exit for a run against a pre-fix build
 * (proves the instrument sees the defect).
 *
 * Run:  node ui-audit/verify-panel-resize-scale.mjs                      (preview on :4173)
 *       BASE_URL=http://localhost:4174/ node ui-audit/verify-panel-resize-scale.mjs --expect-red
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXPECT_RED = process.argv.includes("--expect-red");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PANEL_WIDTHS = [240, 420, 620, 240];               // the grip's clamp range is 240–620
const WINDOWS = [
  { w: 1920, h: 1080, knownGood: true },                 // pane never < 320: scale 1 on ANY build
  { w: 1191, h: 521 },                                   // the previous chat's own window
  { w: 1100, h: 700 },
  { w: 1000, h: 650 },
  { w: 900, h: 600 },
  { w: 1280, h: 380 },                                   // short window: the old 360-tall floor
];
const OTHER_TABS = ["analysis", "drainage", "yield", "properties", "references", "standards"];

const seed = fixtureSeed(readFixture("sylvestri"), { id: "verify-panel-resize", name: "Concept D", site: "Silvestri" });
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* Runs in the page. Everything is scoped to the planner canvas's own wrap — the hidden Map view
   keeps its own 0×0 `.leaflet-container`, which a page-wide query would hit first. */
const measure = () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  const ctm = svg.getScreenCTM();
  // el-tier: one fixed ELEMENT is the yardstick (its size/position), not a census of plan contents.
  // the largest drawn element (a building, not a 1-px stripe) — the same one on every reading
  const el = [...svg.querySelectorAll("[data-el-id]")].sort((a, b) => (a.getAttribute("data-el-id") < b.getAttribute("data-el-id") ? -1 : 1))
    .map((n) => [n, n.getBoundingClientRect()]).filter(([, q]) => q.width > 0)
    .sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)[0]?.[0] || null;
  const er = el ? el.getBoundingClientRect() : null;
  // the planner's basemap = the visible leaflet container (the Map view's is display:none → 0×0)
  const cont = [...document.querySelectorAll(".leaflet-container")].find((c) => c.getBoundingClientRect().width > 0);
  const tile = cont ? [...cont.querySelectorAll("img.leaflet-tile")].find((t) => t.getBoundingClientRect().width > 0) : null;
  const tr = tile ? tile.getBoundingClientRect() : null;
  const h = (sel) => { const n = document.querySelector(sel); return n ? +n.getBoundingClientRect().height.toFixed(1) : null; };
  const titleNode = document.querySelector('[data-testid^="panel-chrome-"]');
  return {
    scale: ctm ? +ctm.a.toFixed(4) : null,
    svgW: +r.width.toFixed(1), svgH: +r.height.toFixed(1), vbW: vb[2], vbH: vb[3],
    ppf: +svg.getAttribute("data-view-ppf"),
    el: er && { x: +er.left.toFixed(1), y: +er.top.toFixed(1), w: +er.width.toFixed(1), h: +er.height.toFixed(1) },
    tile: tr && { src: tile.getAttribute("src"), x: +tr.left.toFixed(1), y: +tr.top.toFixed(1), w: +tr.width.toFixed(1) },
    chrome: { panelHdr: titleNode ? +titleNode.getBoundingClientRect().height.toFixed(1) : null, toolsRailHdr: h(".rail-hdr"), railTab: h('[data-rail-tab="parcel"]') },
  };
};

let fail = 0, measured = 0, knownGoodOk = null;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const near = (a, b, tol = 0.6) => a != null && b != null && Math.abs(a - b) <= tol;

async function dragTo(page, target) {
  const grip = page.locator('[title="Drag to resize"]').first();
  const b = await grip.boundingBox();
  if (!b) return false;
  const panelLeft = await page.evaluate(() => document.querySelector('[data-testid="left-menu-panel"]')?.getBoundingClientRect().left ?? 0);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(panelLeft + target + b.width / 2, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  return true;
}

/* Compare one reading against the baseline taken at the narrow-panel start. */
function check(label, base, m) {
  measured++;
  log(m.scale === 1, `${label}: drawing is unscaled (screen scale ${m.scale})`);
  log(near(m.vbW, m.svgW, 1) && near(m.vbH, m.svgH, 1), `${label}: viewBox ${m.vbW}×${m.vbH} matches the canvas box ${m.svgW}×${m.svgH}`);
  log(m.ppf === base.ppf, `${label}: map scale unchanged (ppf ${m.ppf} vs ${base.ppf})`);
  if (base.el && m.el) log(near(m.el.w, base.el.w) && near(m.el.h, base.el.h) && near(m.el.x, base.el.x) && near(m.el.y, base.el.y),
    `${label}: drawn element same size and place (${m.el.w}×${m.el.h} @ ${m.el.x},${m.el.y} vs ${base.el.w}×${base.el.h} @ ${base.el.x},${base.el.y})`);
  else log(false, `${label}: no drawn element to measure`);
  if (base.tile && m.tile && m.tile.src === base.tile.src) log(near(m.tile.w, base.tile.w) && near(m.tile.x, base.tile.x) && near(m.tile.y, base.tile.y),
    `${label}: basemap tile same size and place (${m.tile.w} @ ${m.tile.x},${m.tile.y} vs ${base.tile.w} @ ${base.tile.x},${base.tile.y})`);
  else if (base.tile && m.tile) log(near(m.tile.w, base.tile.w), `${label}: basemap tile size unchanged (${m.tile.w} vs ${base.tile.w})`);
  for (const k of Object.keys(base.chrome)) if (base.chrome[k] != null && m.chrome[k] != null) log(m.chrome[k] === base.chrome[k], `${label}: chrome "${k}" height unchanged (${m.chrome[k]} vs ${base.chrome[k]})`);
}

for (const win of WINDOWS) {
  const ctx = await browser.newContext({ viewport: { width: win.w, height: win.h } });
  await ctx.addInitScript(seed);
  await ctx.addInitScript(() => { try { localStorage.setItem("planarfit:leftWidth", "240"); } catch (_) {} });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-panel-resize-scale");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}#/project/verify-panel-resize/site`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('[data-rail-tab="parcel"]')?.click());
  await page.waitForTimeout(900);
  const tag = `${win.w}×${win.h}`;
  const base = await page.evaluate(measure);
  if (!base) { log(false, `${tag}: planner canvas not found`); await ctx.close(); continue; }
  let winOk = true;
  for (const target of PANEL_WIDTHS) {
    if (!(await dragTo(page, target))) { log(false, `${tag}: no resize grip`); winOk = false; break; }
    const m = await page.evaluate(measure);
    const before = fail;
    check(`${tag} · Land panel → ${target}`, base, m);
    if (fail > before) winOk = false;
  }
  // Every other left-rail panel, at the widest panel, on the narrowest-pane windows only.
  if (win.w <= 1000) {
    await dragTo(page, 620);
    for (const tab of OTHER_TABS) {
      await page.evaluate((id) => document.querySelector(`[data-rail-tab="${id}"]`)?.click(), tab);
      await page.waitForTimeout(700);
      const m = await page.evaluate(measure);
      const before = fail;
      check(`${tag} · ${tab} panel @620`, base, m);
      if (fail > before) winOk = false;
    }
  }
  if (win.knownGood) knownGoodOk = winOk;
  if (errors.length) log(false, `${tag}: page errors: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}
await browser.close();

if (measured === 0) { console.log("VOID — nothing was measured."); process.exit(2); }
if (knownGoodOk !== true) { console.log("VOID — the known-good arm (1920×1080, pane never under the old floor) did not read clean; the instrument cannot be trusted."); process.exit(2); }
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing check(s) across ${measured} readings`);
if (EXPECT_RED) { console.log(fail > 0 ? "expected-red arm: instrument sees the defect ✓" : "expected-red arm FAILED TO GO RED — the instrument cannot see this defect"); process.exit(fail > 0 ? 0 : 1); }
process.exit(fail === 0 ? 0 : 1);
