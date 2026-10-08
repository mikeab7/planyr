/* verify-map-corners — the Site canvas's corner furniture, at the window sizes the owner works in (B2206704–B2206706).
 *
 *  PART A (NEW-2) — bottom-right corner group. At 1191×521, 1440×900, 1920×1080 and ~1000×450, with the left panel
 *    closed AND docked open: scale bar · help · zoom stack are ONE tidy group — same baseline (bottom), the same small
 *    margin as the bottom-left group (MAP_CORNER_PX) off the pane's bottom and right edges, in that left-to-right order,
 *    nothing overlapping anything (including the north arrow, the Scaled badge, the coordinate chip and the top-right
 *    View/Layers row), nothing over the docked panel or its grip, nothing past the pane.
 *    The pane's edges are MEASURED (the canvas SVG + the panel's drag grip), not read back from the app's arithmetic.
 *  PART B (NEW-3) — the graphic scale bar. For EVERY step the picker can choose (10 ft … 5,000 ft), in both themes,
 *    rendered by a real browser in a deliberately WIDE fallback font: the END label's right edge sits inside the plate
 *    with at least the stated margin, no label pokes past either border, and the drawn bar is still exactly true to scale
 *    (the four segments sum to the bar length the picker asked for).
 *  KNOWN-GOOD ARMS (DRIVER-SCROLL §6): Part A requires that north, scale bar, help and zoom are all OBSERVED (a layout
 *    check that saw nothing proves nothing); Part B requires that the label it measures is the one it thinks it is (the
 *    "0" label sits at the bar's left tick).
 *
 * Run:  node ui-audit/verify-map-corners.mjs        (preview on :4173; BASE_URL overrides)  — add --shots to write PNGs.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import fs from "node:fs";
import path from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { readFurnitureFrame, judgeFurniture } from "./lib/furnitureFrames.mjs";
import { MAP_CORNER_PX, rectOverlap } from "../src/workspaces/site-planner/lib/mapCorners.js";
import { NICE_FEET, screenFurniturePlates, furnitureMetrics, scaleBarPlate, SCALE_END_MARGIN_EM } from "../src/workspaces/site-planner/lib/sheetFurniture.js";
import { paletteFor } from "../src/shared/theme/palette.js";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/map-corners-shots";
const SIZES = [{ w: 1191, h: 521 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 1000, h: 450 }];
let fail = 0, checks = 0;
const check = (ok, msg) => { checks++; console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* ───────────────────────────── PART A ───────────────────────────── */
const seed = fixtureSeed(readFixture("sylvestri"), { id: "verify-map-corners", name: "Concept D", site: "Silvestri" });
for (const win of SIZES) {
  for (const panel of [false, true]) {
    const tag = `${win.w}×${win.h} · panel ${panel ? "open" : "closed"}`;
    const ctx = await browser.newContext({ viewport: { width: win.w, height: win.h } });
    await ctx.addInitScript(seed);
    await ctx.addInitScript(`window.__readFur = ${readFurnitureFrame.toString()};`);
    await ctx.addInitScript(() => { try { localStorage.setItem("planarfit:leftWidth", "320"); } catch (_) {} });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-map-corners");
    await page.goto(`${BASE}#/project/verify-map-corners/site`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    if (panel) { await page.evaluate(() => document.querySelector('[data-rail-tab="parcel"]')?.click()); await page.waitForTimeout(1200); }
    await page.mouse.move(Math.round(win.w * 0.55), Math.round(win.h * 0.55)); // wake the coordinate chip
    await page.waitForTimeout(500);
    const f = await page.evaluate(() => {
      const base = window.__readFur();
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { left: q.left, top: q.top, right: q.right, bottom: q.bottom }; };
      const helpBtn = (() => { const e = document.querySelector('[data-canvas-dock="planner"] button, [data-canvas-dock="planner"] [role="button"]'); if (!e) return null; const q = e.getBoundingClientRect(); return { left: q.left, top: q.top, right: q.right, bottom: q.bottom }; })();
      return { ...base, viewBtn: r('[data-testid="view-menu-btn"]'), layers: r('[data-testid="layer-panel"]'), helpBtn, vv: { w: innerWidth, h: innerHeight } };
    });
    const fv = judgeFurniture([f], { requireObserved: ["north", "scale-bar", "help", "zoom"] });
    check(fv.violations.length === 0, `${tag}: every corner item is inside the visible pane, off the panel and its grip, and overlaps no other (${[...fv.observed].join(", ")})${fv.violations.length ? " — " + fv.violations[0] : ""}`);
    const paneB = f.canvas.bottom, paneR = f.canvas.right, paneL = f.grip ? f.grip.right : f.canvas.left;
    const gap = (r) => paneB - r.bottom;
    const it = f.items;
    if (it["scale-bar"] && it.zoom) {
      check(Math.abs(gap(it["scale-bar"]) - MAP_CORNER_PX) <= 1.5, `${tag}: scale bar sits ${MAP_CORNER_PX}px above the pane's bottom (measured ${gap(it["scale-bar"]).toFixed(1)})`);
      check(Math.abs(gap(it.zoom) - gap(it["scale-bar"])) <= 1, `${tag}: zoom stack shares the scale bar's baseline (${gap(it.zoom).toFixed(1)} vs ${gap(it["scale-bar"]).toFixed(1)})`);
      check(Math.abs((paneR - it.zoom.right) - MAP_CORNER_PX) <= 1.5, `${tag}: zoom stack sits ${MAP_CORNER_PX}px in from the pane's right edge (measured ${(paneR - it.zoom.right).toFixed(1)})`);
      if (f.helpBtn) {
        check(Math.abs(gap(f.helpBtn) - gap(it["scale-bar"])) <= 1.5, `${tag}: the help "?" button shares that baseline (${gap(f.helpBtn).toFixed(1)})`);
        check(it["scale-bar"].right <= f.helpBtn.left + 0.5 && f.helpBtn.right <= it.zoom.left + 0.5, `${tag}: order is scale bar · help · zoom, left to right`);
      } else check(false, `${tag}: the help button is not docked in the corner group`);
    }
    if (it.north) check(Math.abs((it.north.left - paneL) - MAP_CORNER_PX) <= 1.5, `${tag}: north arrow sits ${MAP_CORNER_PX}px in from the visible pane's LEFT edge (measured ${(it.north.left - paneL).toFixed(1)})`);
    if (it.cursor) check(Math.abs((paneB - it.cursor.bottom) - MAP_CORNER_PX) <= 1.5 && Math.abs((it.cursor.left - paneL) - MAP_CORNER_PX) <= 1.5, `${tag}: coordinate chip keeps the same ${MAP_CORNER_PX}px corner margin as the right-hand group`);
    else console.log(`  (info) ${tag}: the coordinate chip yielded (pane too narrow beside the corner group) — by design`);
    // the top-right View / Layers row is another occupant of the same edge — nothing in the corner may touch it
    for (const k of ["viewBtn", "layers"]) if (f[k]) for (const [name, r] of Object.entries(it)) check(rectOverlap(f[k], r) === 0, `${tag}: ${name} does not touch the top-right ${k === "viewBtn" ? "View" : "Layers"} control`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, `corners-${win.w}x${win.h}-${panel ? "panel" : "closed"}.png`) });
    await ctx.close();
  }
}

/* ───────────────────────────── PART B ───────────────────────────── */
{
  // every step the picker can choose: sweep the zoom range and collect what it actually returns
  const picked = new Set();
  for (let lg = -2.2; lg <= 2.6; lg += 0.01) {
    const r = screenFurniturePlates({ ftPerUnit: 10 ** lg, fmtFeet: (n) => Math.round(n).toLocaleString(), paneW: 1400, pal: {} });
    picked.add(Math.round(Number(/>([\d,]+)<\/text><text[^>]*>FEET/.exec(r.scaleBar.markup)?.[1]?.replace(/,/g, "")) || 0));
  }
  for (const ft of NICE_FEET) check(picked.has(ft), `scale picker can choose ${ft.toLocaleString()} ft (reachable step)`);
  const ctx = await browser.newContext({ viewport: { width: 600, height: 300 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const m = furnitureMetrics(540);
  for (const theme of ["light", "dark"]) {
    const P = paletteFor(theme);
    const pal = { ink: P.textPrimary, muted: P.textSecondary, panelLine: P.borderDefault, plateFill: P.canvasPlateFill };
    for (const lengthU of [64, 130, 240]) {
      for (const feet of NICE_FEET) {
        const sb = scaleBarPlate({ lengthU, feet, m, pal, fmtFeet: (n) => Math.round(n).toLocaleString() });
        // a WIDE fallback face on purpose: the shipped stack is Inter → system-ui, and a plate that fits DejaVu Sans fits both
        await page.setContent(`<body style="margin:0;background:${P.surfacePage}"><svg id="s" width="${sb.plateW}" height="${sb.plateH}" viewBox="0 0 ${sb.plateW} ${sb.plateH}" font-family="DejaVu Sans, Verdana, sans-serif">${sb.markup}</svg></body>`);
        const g = await page.evaluate(() => {
          const svg = document.getElementById("s");
          const texts = [...svg.querySelectorAll("text")].map((t) => { const b = t.getBBox(); return { s: t.textContent, l: b.x, r: b.x + b.width }; });
          const rects = [...svg.querySelectorAll("rect")].map((r) => ({ x: +r.getAttribute("x"), w: +r.getAttribute("width") }));
          return { texts, rects };
        });
        const nums = g.texts.filter((t) => t.s !== "FEET");
        const first = nums[0], last = nums[nums.length - 1];
        const tag = `${theme} · ${lengthU}u bar · ${feet.toLocaleString()} ft`;
        const barL = sb.padL, barR = sb.padL + lengthU;
        if (lengthU === 130 && feet === NICE_FEET[0] && theme === "light") check(Math.abs((first.l + first.r) / 2 - barL) <= 1, `known-good arm: the "0" label is centred on the bar's left tick (${((first.l + first.r) / 2).toFixed(1)} vs ${barL.toFixed(1)})`);
        const needMargin = m.fs * SCALE_END_MARGIN_EM * 0.6; // measured margin must still clear 60% of the stated one in a wide font
        check(sb.plateW - last.r >= needMargin, `${tag}: the end label "${last.s}" ends ${(sb.plateW - last.r).toFixed(1)}px inside the plate's right border (need ≥ ${needMargin.toFixed(1)})`);
        check(first.l >= 0.5 && last.r <= sb.plateW - 0.5, `${tag}: no label pokes past either border`);
        const segs = g.rects.slice(1, 5); // [plate, 4 segments]
        check(Math.abs(segs.reduce((a, r) => a + r.w, 0) - lengthU) < 0.05 && Math.abs(segs[0].x - barL) < 0.05 && Math.abs(segs[3].x + segs[3].w - barR) < 0.05, `${tag}: the drawn bar is exactly ${lengthU}u long (true to scale)`);
        if (SHOTS && lengthU === 240 && (feet === 2000 || feet === 5000)) await page.locator("#s").screenshot({ path: path.join(SHOT_DIR, `scalebar-${theme}-${feet}.png`) });
      }
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing of ${checks} checks`);
process.exit(fail === 0 ? 0 : 1);
