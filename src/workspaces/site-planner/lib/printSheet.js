// Print sheet composition (B200 + B197) — the WHOLE printed sheet as ONE SVG.
//
// Why one SVG: the old print view put the site plan in a nested SVG but the
// title block and metrics in HTML flow around it. Those are two different layout
// systems, so the browser's print "scale" slider (≈25%–500%) could scale the
// HTML chrome while the plan held a fixed size — the output wasn't one cohesive
// sheet (B200). Composing the title block, the plan, the buildings table (B197)
// and the metrics into a SINGLE <svg> with ONE viewBox gives them ONE coordinate
// system and ONE scaling transform, so every layer scales together at any zoom
// and prints as one cohesive PDF.
//
// Units: "centi-inches" (1 user unit = 1/100 in), so a letter-landscape sheet is
// 1100×850 and font sizes read directly as hundredths of an inch (e.g. 22 ≈ 16pt).
// The outer <svg> is given a physical width/height in inches matching the paper, so
// it fills exactly one page; the print scale slider then scales the whole thing.
//
// This module is PURE (strings only, no DOM) so the layout + composition are
// unit-testable. The caller (SitePlanner.printPDF) owns the DOM bits: it clones the
// live plan SVG, inlines images, sizes the clone to `layout.plan`, serializes it, and
// hands the string in as `planSvg`.

import { bulletBarSvg } from "./yieldBar.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (n) => Number(Number(n).toFixed(2));
// B862 (chat NEW-3) — the Stormwater bar strip's row geometry (shared by the layout
// reservation + the renderer so the reserved height always fits what's drawn). PDF-PARITY.
const SW_ROW_H = 30, SW_HEAD_H = 16;
export const stormwaterBandH = (barCount) => (barCount > 0 ? SW_HEAD_H + barCount * SW_ROW_H : 0);
// Integer with thousands separators, locale-independent (e.g. 250000 → "250,000").
const commas = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// ---- page geometry -------------------------------------------------------
const PAGE = {
  "letter:landscape": { w: 1100, h: 850, wIn: 11, hIn: 8.5 },
  "letter:portrait": { w: 850, h: 1100, wIn: 8.5, hIn: 11 },
  "tabloid:landscape": { w: 1700, h: 1100, wIn: 17, hIn: 11 },
  "tabloid:portrait": { w: 1100, h: 1700, wIn: 11, hIn: 17 },
};
export const pageSize = (paper, orient) => PAGE[`${paper}:${orient}`] || PAGE["letter:landscape"];

// Lay the sheet out for the given paper/orientation and whether a buildings table
// is present. Returns boxes (in centi-inch units) for every region so the caller
// can position the nested plan SVG and so composition is deterministic + testable.
/* How many rows the metrics band needs for these pairs at this width — the SAME
 * width/flow math buildMetricsSvg uses (fs 12.5 × 0.54 char estimate + 26 gap), so
 * the band the layout reserves always fits what the renderer draws. Pure; exported
 * for the layout + tests. `pairs` may be [label, value] tuples or plain counts fall
 * back to a coarse ~150 c-in average. */
export function metricsRowsFor(pairsOrCount, bandW) {
  const padX = 4, fs = 12.5, colGap = 26;
  const maxX = bandW - 2 * padX;
  if (!Array.isArray(pairsOrCount)) {
    const perRow = Math.max(1, Math.floor(maxX / 150));
    return Math.max(2, Math.ceil((pairsOrCount || 0) / perRow));
  }
  let cx = 0, rows = pairsOrCount.length ? 1 : 0;
  for (const [k, v] of pairsOrCount) {
    const wEst = (String(k).length + 2 + String(v).length) * fs * 0.54;
    if (cx + wEst > maxX && cx > 0) { cx = 0; rows++; }
    cx += wEst + colGap;
  }
  return Math.max(2, rows);
}

export function printSheetLayout({ paper = "letter", orient = "landscape", buildingCount = 0, metricsCount = 9, metricsPairs = null, stormwaterBars = 0 } = {}) {
  const page = pageSize(paper, orient);
  const M = 28; // ≈0.28 in border inset
  const inner = { x: M, y: M, w: page.w - 2 * M, h: page.h - 2 * M };
  const titleH = 56;
  // The metrics band grows with its ACTUAL pairs (B712 added detention/mitigation
  // pairs — some very wide) instead of clipping a wrapped row into the note line.
  // Sized from the same flow estimate buildMetricsSvg draws with; a bare count
  // falls back to a coarse average. Two rows minimum = the historical 64 c-in.
  // B862 — the Stormwater required-vs-provided bar strip (when present) reserves its own
  // rows on top of the text pairs, so the band deepens instead of clipping.
  const metricRows = metricsRowsFor(metricsPairs || metricsCount, inner.w);
  const metricsH = 18 + metricRows * 17 + 12 + stormwaterBandH(stormwaterBars);
  const gap = 14;
  const contentTop = inner.y + titleH + gap;
  const contentBot = inner.y + inner.h - metricsH - gap;
  const contentH = Math.max(0, contentBot - contentTop);
  const hasTable = buildingCount > 0;
  // Right-hand data column near the title block; clamped so it never starves the plan.
  const tableW = hasTable ? Math.max(230, Math.min(360, Math.round(inner.w * 0.3))) : 0;
  const planW = inner.w - (hasTable ? tableW + gap : 0);
  return {
    unit: "centi-inch",
    page,
    inner,
    title: { x: inner.x, y: inner.y, w: inner.w, h: titleH },
    plan: { x: inner.x, y: contentTop, w: planW, h: contentH },
    table: hasTable ? { x: inner.x + planW + gap, y: contentTop, w: tableW, h: contentH } : null,
    metrics: { x: inner.x, y: contentBot + gap, w: inner.w, h: metricsH },
  };
}

// ---- buildings data table (B197) ----------------------------------------
// `rows`: [{ name, sf, clearHeight, slab }] — values already resolved (effective,
// from buildingProps). Columns: BUILDING | SF | CLEAR | SLAB; numeric columns
// right-aligned. Returns an SVG markup string anchored at the box's top-left.
export function buildBuildingTableSvg({ x, y, w, h, rows = [], pal = {} } = {}) {
  const ink = pal.ink || "#26231e";
  const muted = pal.muted || "#8a8473";
  const line = pal.panelLine || "#cfc6af";
  const padX = 11;
  const titleH = 26, headerH = 22, rowH = 21;
  const colSlab = 56, colClear = 60, colSf = 92; // right-side fixed columns
  const right = x + w - padX;
  const xSlab = right; // right edges (text-anchor=end)
  const xClear = right - colSlab;
  const xSf = right - colSlab - colClear;
  const xName = x + padX; // left edge (text-anchor=start)
  const nameMax = (xSf - colSf) - xName - 6; // px room for the name before SF column
  // Truncate an over-long name to fit its column (rough char-width estimate).
  const fitName = (s, fs) => {
    const str = String(s || "");
    const max = Math.max(4, Math.floor(nameMax / (fs * 0.56)));
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  };
  let s = `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="6" fill="#ffffff" stroke="${line}" stroke-width="1"/>`;
  // title
  s += `<text x="${r2(xName)}" y="${r2(y + 18)}" font-size="14" font-weight="700" letter-spacing="0.6" fill="${ink}">BUILDINGS</text>`;
  s += `<line x1="${r2(x)}" y1="${r2(y + titleH)}" x2="${r2(x + w)}" y2="${r2(y + titleH)}" stroke="${line}" stroke-width="1"/>`;
  // header row
  const hy = y + titleH + 15;
  const hdr = (tx, anchor, label) => `<text x="${r2(tx)}" y="${r2(hy)}" text-anchor="${anchor}" font-size="10.5" font-weight="700" letter-spacing="0.5" fill="${muted}">${esc(label)}</text>`;
  s += hdr(xName, "start", "BUILDING") + hdr(xSf, "end", "SF") + hdr(xClear, "end", "CLEAR") + hdr(xSlab, "end", "SLAB");
  s += `<line x1="${r2(x)}" y1="${r2(y + titleH + headerH)}" x2="${r2(x + w)}" y2="${r2(y + titleH + headerH)}" stroke="${line}" stroke-width="0.75"/>`;
  // body rows (clip to the box height)
  let ry = y + titleH + headerH + 15;
  const maxY = y + h - 6;
  const rowFs = 12.5;
  rows.forEach((row, i) => {
    if (ry > maxY) return; // overflow guard (plan area is tall; this is rarely hit)
    if (i % 2 === 1) s += `<rect x="${r2(x + 1)}" y="${r2(ry - 14)}" width="${r2(w - 2)}" height="${r2(rowH)}" fill="#faf8f3"/>`;
    s += `<text x="${r2(xName)}" y="${r2(ry)}" font-size="${rowFs}" fill="${ink}">${esc(fitName(row.name, rowFs))}</text>`;
    s += `<text x="${r2(xSf)}" y="${r2(ry)}" text-anchor="end" font-size="${rowFs}" fill="${ink}" font-variant-numeric="tabular-nums slashed-zero">${esc(commas(row.sf))}</text>`;
    s += `<text x="${r2(xClear)}" y="${r2(ry)}" text-anchor="end" font-size="${rowFs}" fill="${ink}" font-variant-numeric="tabular-nums slashed-zero">${esc(row.clearHeight == null ? "—" : row.clearHeight + "'")}</text>`;
    s += `<text x="${r2(xSlab)}" y="${r2(ry)}" text-anchor="end" font-size="${rowFs}" fill="${ink}" font-variant-numeric="tabular-nums slashed-zero">${esc(row.slab == null ? "—" : row.slab + '"')}</text>`;
    ry += rowH;
  });
  return s;
}

// ---- stormwater required-vs-provided bar strip (B862, chat NEW-3) --------
// The SAME bullet-bar the on-screen Yield → Stormwater readout draws (via yieldBar.js),
// so the export can't drift from the screen (PDF-PARITY). `bars`: [{ label, verdict,
// status, layout, unit }]. Returns an SVG string anchored at (x,y); its height is
// stormwaterBandH(bars.length).
const SW_MONO = "Inter, system-ui, sans-serif"; // B895 — matches the on-screen NUM_FONT (PDF-PARITY); var() can't survive SVG-export rasterization, so this is a concrete string kept in sync by hand.
export function buildStormwaterSvg({ x, y, w, bars = [], pal = {} } = {}) {
  const ink = pal.ink || "#26231e";
  const muted = pal.muted || "#8a8473";
  if (!bars.length) return "";
  const padX = 4;
  const labelW = 168, verdictW = 118;
  const barX = x + padX + labelW + verdictW;
  const barW = Math.max(120, Math.min(340, x + w - padX - barX - 8));
  let s = `<text x="${r2(x + padX)}" y="${r2(y + 11)}" font-size="10.5" font-weight="700" letter-spacing="0.6" fill="${muted}">STORMWATER — REQUIRED vs PROVIDED</text>`;
  bars.forEach((b, i) => {
    const ry = y + SW_HEAD_H + i * SW_ROW_H;
    const midY = ry + 12;
    s += `<text x="${r2(x + padX)}" y="${r2(midY)}" font-size="11.5" font-weight="700" fill="${ink}">${esc(b.label)}</text>`;
    if (b.verdict != null) s += `<text x="${r2(x + padX + labelW)}" y="${r2(midY)}" font-size="11.5" font-weight="700" font-family="${SW_MONO}" font-variant-numeric="tabular-nums slashed-zero" fill="${ink}">${esc(b.verdict)}</text>`;
    if (b.layout) s += bulletBarSvg(b.layout, { x: barX, y: ry, w: barW, barH: 12, status: b.status || null, unit: b.unit || "ac-ft", mono: SW_MONO }).svg;
  });
  return s;
}

// ---- metrics band --------------------------------------------------------
// Flow `pairs` ([label, value]) left→right, wrapping within the band width; a
// disclaimer note is appended on its own line at the bottom. The optional Stormwater
// bar strip (B862) renders at the TOP of the band, above the text pairs.
function buildMetricsSvg({ x, y, w, h, pairs = [], note = "", pal = {}, stormwater = [] }) {
  const ink = pal.ink || "#26231e";
  const muted = pal.muted || "#8a8473";
  const line = pal.panelLine || "#cfc6af";
  const padX = 4;
  const fs = 12.5;
  const lh = 17;
  let s = `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x + w)}" y2="${r2(y)}" stroke="${line}" stroke-width="1"/>`;
  const swH = stormwaterBandH(stormwater.length);
  if (swH) {
    s += buildStormwaterSvg({ x, y: y + 6, w, bars: stormwater, pal });
    s += `<line x1="${r2(x)}" y1="${r2(y + swH + 4)}" x2="${r2(x + w)}" y2="${r2(y + swH + 4)}" stroke="${line}" stroke-width="0.5"/>`;
  }
  let cx = x + padX;
  let cy = y + swH + 18;
  const colGap = 26;
  const maxX = x + w - padX;
  pairs.forEach(([k, v]) => {
    const label = `${k}: `;
    const wEst = (label.length + String(v).length) * fs * 0.54;
    if (cx + wEst > maxX && cx > x + padX) { cx = x + padX; cy += lh; }
    s += `<text x="${r2(cx)}" y="${r2(cy)}" font-size="${fs}"><tspan fill="${muted}">${esc(label)}</tspan><tspan fill="${ink}" font-weight="700" font-variant-numeric="tabular-nums slashed-zero">${esc(v)}</tspan></text>`;
    cx += wEst + colGap;
  });
  if (note) s += `<text x="${r2(x + padX)}" y="${r2(y + h - 4)}" font-size="11" font-style="italic" fill="${muted}">${esc(note)}</text>`;
  return s;
}

// ---- whole sheet ---------------------------------------------------------
// Compose the single-SVG sheet. `planSvg` is a serialized <svg> string the caller
// has already sized/positioned to `layout.plan` (a nested SVG keeps its own viewBox
// and scales with the sheet). `date` is a preformatted string. Returns the full
// <svg> markup string ready to drop into the print document.
export function buildPrintSheetSvg({
  layout,
  planSvg = "",
  title = "",
  sub = "",
  date = "",
  brand = "Planyr · Site Planner",
  metrics = [],
  stormwater = [],
  note = "",
  buildings = [],
  pal = {},
} = {}) {
  const L = layout || printSheetLayout({});
  const ink = pal.ink || "#26231e";
  const muted = pal.muted || "#8a8473";
  const line = pal.panelLine || "#b8b1a0";
  const paper = pal.paper || "#ffffff";
  const { page } = L;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
    + `viewBox="0 0 ${page.w} ${page.h}" width="${page.wIn}in" height="${page.hIn}in" `
    + `preserveAspectRatio="xMidYMid meet" font-family="Inter, system-ui, sans-serif">`;
  // paper + outer border
  s += `<rect x="0" y="0" width="${page.w}" height="${page.h}" fill="${paper}"/>`;
  s += `<rect x="${r2(L.inner.x)}" y="${r2(L.inner.y)}" width="${r2(L.inner.w)}" height="${r2(L.inner.h)}" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
  // title block
  const t = L.title;
  s += `<text x="${r2(t.x + 10)}" y="${r2(t.y + 26)}" font-size="22" font-weight="700" fill="${ink}">${esc(title)}</text>`;
  if (sub) s += `<text x="${r2(t.x + 10)}" y="${r2(t.y + 45)}" font-size="13" fill="${muted}">${esc(sub)}</text>`;
  s += `<text x="${r2(t.x + t.w - 10)}" y="${r2(t.y + 24)}" text-anchor="end" font-size="14" font-weight="600" fill="${ink}">${esc(date)}</text>`;
  s += `<text x="${r2(t.x + t.w - 10)}" y="${r2(t.y + 43)}" text-anchor="end" font-size="11.5" fill="${muted}">${esc(brand)}</text>`;
  s += `<line x1="${r2(t.x)}" y1="${r2(t.y + t.h)}" x2="${r2(t.x + t.w)}" y2="${r2(t.y + t.h)}" stroke="${line}" stroke-width="1"/>`;
  // plan frame + the nested plan SVG (caller-positioned)
  s += `<rect x="${r2(L.plan.x)}" y="${r2(L.plan.y)}" width="${r2(L.plan.w)}" height="${r2(L.plan.h)}" fill="none" stroke="${line}" stroke-width="0.75"/>`;
  s += planSvg;
  // buildings table (right column)
  if (L.table && buildings.length) s += buildBuildingTableSvg({ ...L.table, rows: buildings, pal });
  // metrics band (+ the B862 stormwater required-vs-provided bar strip)
  s += buildMetricsSvg({ ...L.metrics, pairs: metrics, note, pal, stormwater });
  s += `</svg>`;
  return s;
}

// ---- export filename (B201) ---------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
// Today (or a given date) as YYYY.MM.DD.
export const formatDateStamp = (d = new Date()) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
// Strip filesystem-illegal characters (\ / : * ? " < > | and control chars),
// collapse whitespace. Keeps spaces, dots and hyphens (the format uses them).
export const sanitizeFilename = (s) =>
  String(s == null ? "" : s)
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ").trim();
// "YYYY.MM.DD {Project Name} - {Plan Name}" — the trailing piece is the plan's own
// label (e.g. "Plan 1", later "Scheme A"), so the filename always tracks whatever the
// owner has named the plan (B201). Project + plan are sanitized; the literal " - "
// separator and the date dots are kept. If the plan name is blank, the tail is omitted.
export function sheetFileName({ project, plan, date = new Date() } = {}) {
  const proj = sanitizeFilename(project) || "Site Plan";
  const pl = sanitizeFilename(plan);
  return `${formatDateStamp(date)} ${proj}${pl ? ` - ${pl}` : ""}`;
}
