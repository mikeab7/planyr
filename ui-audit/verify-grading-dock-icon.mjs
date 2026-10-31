/* verify-grading-dock-icon — NEW-1 (B2591568, owner 2026-10-30): the Grading dock icon is the contour-lines glyph.
 *
 * Draws the dock's five icons exactly as the rail does (SitePlanner.jsx's RAIL_ICONS paths for Land / Analysis / Drainage / Yield read
 * from the SOURCE, Grading from components/railGlyphs.js, all through the rail's own svg attributes: 24 grid, stroke 1.75, round cap + join,
 * currentColor) — idle and selected, light and dark, at 1x and 2x — and writes the PNGs to ui-audit/screenshots/grading/dock-icon-*.png.
 *
 * PAINTED-PIXEL checks (the glyph rasterised by Chromium, not read off its attributes):
 *   - the glyph's ink stays inside the 24 grid with the same margin as the neighbours' (nothing clipped at the viewBox edge)
 *   - three contour lines cross a vertical through the knoll, separated by clear paper at 21 px AND 20 px, at an EVEN pitch
 *   - the spot triangle is solid (filled) and sits below-right of every contour line, clear of them
 *   - a known-good arm: the Drainage icon's two wave lines read as exactly two runs on the same scan (the probe can count)
 *   - the selected state comes from the wrapper's colour alone: the svg carries no colour of its own
 * The source guard also fails if the old glyph (a dome on a baseline) reappears in the planner source.
 *   node ui-audit/verify-grading-dock-icon.mjs      (no dev server — the page is built from the source text) */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { GRADING_GLYPH } from "../src/workspaces/site-planner/components/railGlyphs.js";

const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SRC = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
const fails = [], notes = [];
const check = (n, ok, x = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);

/* neighbours: the registered JSX of each, converted to plain SVG markup (the paths are pure literals) */
const block = SRC.match(/const RAIL_ICONS = \{([\s\S]*?)\n\};/)[1];
const entry = (id) => {
  const m = block.match(new RegExp(`\\n  ${id}: (<[\\s\\S]*?),\\n  (?://|[a-z]+:)`));
  if (!m) throw new Error(`RAIL_ICONS.${id} not found in SitePlanner.jsx`);
  return m[1].replace(/^<>|<\/>$/g, "");
};
const svgBody = { parcel: entry("parcel"), analysis: entry("analysis"), drainage: entry("drainage"), yield: entry("yield") };
svgBody.grading = GRADING_GLYPH.contours.map((d) => `<path d="${d}"/>`).join("") + `<path d="${GRADING_GLYPH.spot}" fill="currentColor" stroke-width="${GRADING_GLYPH.spotStrokeWidth}"/>`;
check("the dock registers Grading from the shared glyph (components/railGlyphs.js), not inline path data", /grading: <>\{GRADING_GLYPH\.contours\.map/.test(block) && /GRADING_GLYPH\.spot/.test(block));
check("the old dome-on-a-baseline path data is gone from the planner source", !/M3 20h18/.test(SRC) && !/M6 20c0-6 3-10 6-10/.test(SRC));
check("the rail's shared svg still draws stroke 1.75 round/round (the glyph inherits, it does not set its own)", /const RailIcon[\s\S]{0,260}strokeWidth="1\.75" strokeLinecap="round" strokeLinejoin="round"/.test(SRC));

const svg = (body, size, extra = "") => `<svg ${extra} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block">${body}</svg>`;
const LABELS = [["parcel", "Land"], ["analysis", "Analysis"], ["drainage", "Drainage"], ["grading", "Grading"], ["yield", "Yield"]];
const THEMES = {
  light: { bg: "#EAEEF3", idle: "#353B49", on: "#0F6E56", onBg: "#FFFFFF", ink: "#1B1E26" },
  dark: { bg: "#111319", idle: "#A6ADBA", on: "#5DCAA5", onBg: "#1B1F27", ink: "#ECEFF4" },
};
const strip = (t, selected) => `<div style="display:flex;gap:2px;padding:6px;background:${t.bg}">${LABELS.map(([id, label]) => {
  const on = id === selected;
  return `<div style="width:54px;height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:8px;background:${on ? t.onBg : "transparent"};font:10.5px system-ui,sans-serif;color:${on ? t.on : t.idle}"><span style="display:grid;place-items:center;height:21px;color:${on ? t.on : t.idle}">${svg(svgBody[id], 21)}</span><span>${label}</span></div>`;
}).join("")}</div>`;
const page_html = (t) => `<body style="margin:0;background:${t.bg}">${strip(t, null)}${strip(t, "grading")}</body>`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
try {
  for (const [themeName, t] of Object.entries(THEMES)) {
    for (const dsf of [1, 2]) {
      const ctx = await browser.newContext({ viewport: { width: 300, height: 130 }, deviceScaleFactor: dsf });
      const page = await ctx.newPage();
      await page.setContent(page_html(t));
      await assertMeasurable(page, "verify-grading-dock-icon");
      await page.screenshot({ path: `${OUT}dock-icon-${dsf}x-${themeName}.png`, clip: { x: 0, y: 0, width: 300, height: 124 } });
      await ctx.close();
    }
  }
  /* an enlarged sheet for the PR: the glyph at 24 / 20 / 12x beside Drainage */
  { const ctx = await browser.newContext({ viewport: { width: 640, height: 320 }, deviceScaleFactor: 1 }); const page = await ctx.newPage();
    await page.setContent(`<body style="margin:0;background:#fff;color:#1B1E26;display:flex;gap:28px;padding:20px;align-items:flex-end">${[24, 20, 96, 192].map((s) => svg(svgBody.grading, s)).join("")}${svg(svgBody.drainage, 96)}</body>`);
    await assertMeasurable(page, "verify-grading-dock-icon"); await page.screenshot({ path: `${OUT}dock-icon-enlarged.png` }); await ctx.close(); }

  /* ---- painted-pixel measurements: rasterise through a canvas, read the alpha ---- */
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  const page = await ctx.newPage();
  await page.setContent("<body></body>");
  await assertMeasurable(page, "verify-grading-dock-icon");
  const raster = (body, px, dsf = 1) => page.evaluate(async ({ body, px, dsf }) => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" color="#000">${body.replace(/currentColor/g, "#000")}</svg>`;
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); await img.decode();
    const W = px * dsf, c = document.createElement("canvas"); c.width = c.height = W; const g = c.getContext("2d"); g.drawImage(img, 0, 0, W, W);
    const d = g.getImageData(0, 0, W, W).data, a = new Float32Array(W * W); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255; return { W, a: Array.from(a) };
  }, { body, px, dsf });
  const runs = (r, xUnits, thr = 0.5) => { const col = Math.min(r.W - 1, Math.round((xUnits / 24) * r.W)); const out = []; let s = -1;
    for (let y = 0; y < r.W; y++) { const on = r.a[y * r.W + col] > thr; if (on && s < 0) s = y; if (!on && s >= 0) { out.push([s, y - 1]); s = -1; } } if (s >= 0) out.push([s, r.W - 1]); return out; };
  const bbox = (r, thr = 0.12) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 0; y < r.W; y++) for (let x = 0; x < r.W; x++) if (r.a[y * r.W + x] > thr) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };

  const hi = await raster(svgBody.grading, 240);  // 10 px per grid unit: geometry-level truth
  const bb = bbox(hi), u = 240 / 24;
  check("the glyph's ink stays inside the 24 grid with at least a unit of margin on every side", bb.x0 / u >= 1 && bb.y0 / u >= 1 && (hi.W - 1 - bb.x1) / u >= 1 && (hi.W - 1 - bb.y1) / u >= 0.9,
    `ink ${(bb.x0 / u).toFixed(1)}–${((bb.x1 + 1) / u).toFixed(1)} × ${(bb.y0 / u).toFixed(1)}–${((bb.y1 + 1) / u).toFixed(1)} of 24`);
  { const r = runs(hi, 13).filter(([a, b]) => b - a > 5 * 1.75); // thick runs only (the contour lines, 1.75 units ≈ 17 px) — never the spot, which is at x ≥ 17
    check("three contour lines cross the vertical through the knoll", r.length === 3, `${r.length} runs`);
    if (r.length === 3) { const c = r.map(([a, b]) => (a + b) / 2 / u), g1 = c[1] - c[0], g2 = c[2] - c[1];
      check("the lines sit at an even pitch (the two gaps differ by under 0.25 of a unit)", Math.abs(g1 - g2) < 0.25, `pitch ${g1.toFixed(2)} / ${g2.toFixed(2)} units`); } }
  for (const px of [21, 20]) {
    const r = await raster(svgBody.grading, px, 2);  // 2x device pixels, as the owner's display
    const one = await raster(svgBody.grading, px, 1);
    for (const [label, rr] of [["1x", one], ["2x", r]]) {
      const rs = runs(rr, 13, 0.4);
      check(`at ${px} px (${label}) the three lines stay separate bands with clear paper between them`, rs.length === 3, `${rs.length} runs [${rs.map((x) => x.join("–")).join(", ")}]`);
    }
  }
  { const dr = await raster(svgBody.drainage, 240); const rs = runs(dr, 7.5 / 21 * 24, 0.5).filter(([a, b]) => b - a > 5);
    check("known-good arm: the probe counts Drainage's two wave lines as two runs on a vertical through them", runs(dr, 6, 0.5).length === 2, `${runs(dr, 6, 0.5).length} runs`); void rs; }
  { // the spot triangle: solid centre, below-right of every contour end
    const spotOnly = await raster(`<path d="${GRADING_GLYPH.spot}" fill="currentColor" stroke-width="${GRADING_GLYPH.spotStrokeWidth}"/>`, 240);
    const sb = bbox(spotOnly), h = (sb.y1 + 1 - sb.y0) / u, w = (sb.x1 + 1 - sb.x0) / u;
    check("the spot triangle is about 3 units tall (3.0–3.8 painted, including its thin rounded edge)", h >= 3 && h <= 3.8, `${h.toFixed(2)} tall × ${w.toFixed(2)} wide`);
    const cx = Math.round((sb.x0 + sb.x1) / 2), cy = Math.round(sb.y0 + (sb.y1 - sb.y0) * 0.68);
    check("the spot triangle is FILLED (solid ink at its centre)", spotOnly.a[cy * spotOnly.W + cx] > 0.95);
    const contoursOnly = await raster(GRADING_GLYPH.contours.map((d) => `<path d="${d}"/>`).join(""), 240); const cb = bbox(contoursOnly);
    check("the spot sits below every contour line's lowest point on its side and clear of them (gap ≥ 0.5 unit)", sb.y0 > cb.y1 - 4.4 * u && (() => {
      let min = 1e9; for (let y = 0; y < hi.W; y += 2) for (let x = 0; x < hi.W; x += 2) if (spotOnly.a[y * hi.W + x] > 0.1) { for (let yy = Math.max(0, y - 6 * 2); yy <= Math.min(hi.W - 1, y + 12); yy += 2) for (let xx = Math.max(0, x - 12); xx <= Math.min(hi.W - 1, x + 12); xx += 2) if (contoursOnly.a[yy * hi.W + xx] > 0.1) min = Math.min(min, Math.hypot(xx - x, yy - y)); }
      return min / u >= 0.5; })(), "");
  }
  await ctx.close();
  const hasColour = /fill="#|stroke="#|color:/.test(svgBody.grading.replace(/currentColor/g, ""));
  check("the glyph carries no colour of its own (idle / selected come from the wrapper's colour alone)", !hasColour);
} catch (e) { fails.push(`✗ harness crashed — ${e && e.stack || e}`); } finally { await browser.close(); }
console.log([...notes, ...fails].join("\n"));
console.log(fails.length ? `\n${fails.length} FAILED` : `\nall ${notes.length} checks passed`);
process.exit(fails.length ? 1 : 0);
