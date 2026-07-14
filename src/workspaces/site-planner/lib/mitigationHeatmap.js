/* B809 — the fill-depth heat map: renders the EXACT cells the mitigation engine priced.
 *
 * Engine-truth rule (non-negotiable design principle): every function here consumes the
 * retained cell array computeMitigation produced (B808's `cells` — the same cells whose
 * depths summed to the ledger volume) and NEVER re-derives geometry or depth. Picture
 * and number cannot diverge because they are the same array — the PDF-PARITY discipline
 * applied to pixels.
 *
 * Cell shape: { cls: "1pct"|"02pct"|"floodway", fpId, x, y, wFt, hFt, depthFt|null }
 * — x/y are the cell CENTER in site feet; depthFt null = area-only geography (floodway
 * prohibition, or an unpriced/UNKNOWN bucket rendered as hatch, never a depth color).
 *
 * Colors are FIXED HEX by design — the overlay draws over aerial imagery, which doesn't
 * theme (the terrain-layer / coordinate-chip rule). Pure except paintHeatmap, which
 * needs a DOM canvas and returns null where none exists (tests, SSR). */

export const DEPTH_BIN_FT = 0.5;

/* Sequential fill-depth ramp, shallow → deep (screening blues; readable over green
 * imagery, distinct from the pond water gradient). Index = min(floor(d/0.5), 7). */
export const HEAT_RAMP = [
  "#DBEAFE", "#B3D3F8", "#8ABCEF", "#62A3E3",
  "#3F86D2", "#2A69BA", "#1D4E9B", "#153E75",
];
export const FLOODWAY_FILL = "#B91C1C"; // hard-prohibited — red is a genuine alert here
export const UNKNOWN_FILL = "#6B7280";  // grey hatch — "not priced" is visible geography

export const binIndex = (depthFt) =>
  Math.max(0, Math.min(HEAT_RAMP.length - 1, Math.floor(depthFt / DEPTH_BIN_FT)));

/* What a cell paints as. Pure. */
export function cellPaint(cell) {
  if (cell.cls === "floodway") return { kind: "floodway", color: FLOODWAY_FILL };
  if (cell.depthFt == null) return { kind: "unknown", color: UNKNOWN_FILL };
  return { kind: "depth", color: HEAT_RAMP[binIndex(cell.depthFt)] };
}

/* ---- B826: the cut/fill mode — same renderer, a diverging ramp ----
 * Cells here are the proposed-surface grid's ({ dzFt: + fill / − cut / null void }).
 * FILL reads WARM (dirt in), CUT reads COOL (dirt out — the B809 blues); the pair is a
 * colorblind-safe diverging choice that stays readable over green aerial imagery (the
 * same reason B809 avoided green). A DEM-void cell is grey hatch — "no ground data" is
 * visible geography, never a silent skip. */
export const FILL_RAMP = [
  "#FEF3C7", "#FDE68A", "#FCD34D", "#FBBF24",
  "#F59E0B", "#D97706", "#B45309", "#92400E",
];
export const CUT_RAMP = HEAT_RAMP;
export const ZERO_BAND_FT = 0.05; // |dz| under this reads "on grade", not cut or fill

export function cutFillPaint(cell) {
  if (cell.dzFt == null) return { kind: "unknown", color: UNKNOWN_FILL };
  if (Math.abs(cell.dzFt) < ZERO_BAND_FT) return { kind: "zero", color: "#D1D5DB" };
  return cell.dzFt > 0
    ? { kind: "fill", color: FILL_RAMP[binIndex(cell.dzFt)] }
    : { kind: "cut", color: CUT_RAMP[binIndex(-cell.dzFt)] };
}

/* Legend rows for the PRESENT cut/fill bins (fill shallowest→deepest, then cut, then
 * the hatch classes) — the heatmapLegend discipline: never rows for absent bins. Pure. */
export function cutFillLegend(cells) {
  const fillBins = new Set(), cutBins = new Set();
  let zero = false, unknown = false;
  for (const c of cells) {
    if (c.dzFt == null) { unknown = true; continue; }
    if (Math.abs(c.dzFt) < ZERO_BAND_FT) { zero = true; continue; }
    (c.dzFt > 0 ? fillBins : cutBins).add(binIndex(Math.abs(c.dzFt)));
  }
  const binLabel = (i) => (i === HEAT_RAMP.length - 1
    ? `≥${(i * DEPTH_BIN_FT).toFixed(1)}′`
    : `${(i * DEPTH_BIN_FT).toFixed(1)}–${((i + 1) * DEPTH_BIN_FT).toFixed(1)}′`);
  const rows = [];
  for (const i of [...fillBins].sort((a, b) => a - b)) rows.push({ kind: "fill", color: FILL_RAMP[i], label: `fill ${binLabel(i)}` });
  for (const i of [...cutBins].sort((a, b) => a - b)) rows.push({ kind: "cut", color: CUT_RAMP[i], label: `cut ${binLabel(i)}` });
  if (zero) rows.push({ kind: "zero", color: "#D1D5DB", label: "on grade (±0.05′)" });
  if (unknown) rows.push({ kind: "unknown", color: UNKNOWN_FILL, label: "no ground data" });
  return rows;
}

/* Cut/fill tie-out summed from the SAME cells the exhibit paints (the heatmapTotals
 * engine-truth rule — the overlay must equal the earthwork rows by construction). Pure. */
export function cutFillTotals(cells) {
  let cutCf = 0, fillCf = 0, gradedSf = 0, unknownSf = 0;
  for (const c of cells) {
    const a = c.wFt * c.hFt;
    gradedSf += a;
    if (c.dzFt == null) { unknownSf += a; continue; }
    if (c.dzFt > 0) fillCf += a * c.dzFt; else cutCf += a * -c.dzFt;
  }
  return {
    cutCf, fillCf, cutCy: cutCf / 27, fillCy: fillCf / 27,
    gradedAcres: gradedSf / 43560, unknownAcres: unknownSf / 43560,
  };
}

/* Bounding box of the cell rectangles, in site feet. Pure. */
export function heatmapBBox(cells) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    const hw = c.wFt / 2, hh = c.hFt / 2;
    if (c.x - hw < x0) x0 = c.x - hw;
    if (c.y - hh < y0) y0 = c.y - hh;
    if (c.x + hw > x1) x1 = c.x + hw;
    if (c.y + hh > y1) y1 = c.y + hh;
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/* Legend rows for the kinds/bins actually present (never a 8-row legend for a 2-bin
 * site). Depth rows read "0–0.5′", "0.5–1.0′", …, the top bin "≥3.5′". Pure. */
export function heatmapLegend(cells) {
  const bins = new Set();
  let floodway = false, unknown = false;
  for (const c of cells) {
    if (c.cls === "floodway") floodway = true;
    else if (c.depthFt == null) unknown = true;
    else bins.add(binIndex(c.depthFt));
  }
  const rows = [...bins].sort((a, b) => a - b).map((i) => ({
    kind: "depth",
    color: HEAT_RAMP[i],
    label: i === HEAT_RAMP.length - 1
      ? `≥${(i * DEPTH_BIN_FT).toFixed(1)}′`
      : `${(i * DEPTH_BIN_FT).toFixed(1)}–${((i + 1) * DEPTH_BIN_FT).toFixed(1)}′`,
  }));
  if (floodway) rows.push({ kind: "floodway", color: FLOODWAY_FILL, label: "FLOODWAY — fill prohibited" });
  if (unknown) rows.push({ kind: "unknown", color: UNKNOWN_FILL, label: "not priced (UNKNOWN)" });
  return rows;
}

/* The tie-out: totals summed from the SAME cells, ratio-applied like the ledger. The
 * overlay total equals the ledger by construction — computing it here (instead of
 * echoing the ledger) is the point: the user SEES the two agree. Pure. */
export function heatmapTotals(cells, ratio = 1) {
  let volumeCf = 0, fillSf = 0, floodwaySf = 0, unknownSf = 0;
  const byFp = new Map();
  for (const c of cells) {
    const a = c.wFt * c.hFt;
    if (c.cls === "floodway") { floodwaySf += a; continue; }
    if (c.depthFt == null) { unknownSf += a; continue; }
    fillSf += a;
    const v = a * c.depthFt;
    volumeCf += v;
    byFp.set(c.fpId, (byFp.get(c.fpId) || 0) + v);
  }
  volumeCf *= ratio;
  const perFpAcFt = {};
  for (const [k, v] of byFp) perFpAcFt[k] = (v * ratio) / 43560;
  return {
    volumeCf,
    volumeAcFt: volumeCf / 43560,
    fillAcres: fillSf / 43560,
    floodwayAcres: floodwaySf / 43560,
    unknownAcres: unknownSf / 43560,
    perFpAcFt,
  };
}

/* The cell under a site-feet point (hover). Linear scan — the retained set is capped
 * (≤1,500 per footprint×zone), and a miss exits on bbox arithmetic only. Pure. */
export function cellAt(cells, pt) {
  if (!pt) return null;
  for (const c of cells) {
    if (Math.abs(pt.x - c.x) <= c.wFt / 2 && Math.abs(pt.y - c.y) <= c.hFt / 2) return c;
  }
  return null;
}

/* Paint the cells to ONE offscreen canvas → data URL (the SVG then carries a single
 * <image>, so tens of thousands of cells never become DOM nodes, and the live-SVG
 * export clone carries the exhibit into print/PDF by construction). Site-feet y grows
 * DOWN on the planner screen (worldToScreen has no flip), so canvas rows map directly.
 * opts.paint swaps the classer (default cellPaint; cutFillPaint for the B826 mode) —
 * solid kinds (depth/fill/cut/zero) fill, hatch kinds (floodway/unknown) stripe.
 * Returns { dataUrl, bboxFt, pxPerFt } or null with no DOM (tests / SSR). */
export function paintHeatmap(cells, { maxPx = 1600, paint = cellPaint } = {}) {
  if (typeof document === "undefined" || !cells || !cells.length) return null;
  const bboxFt = heatmapBBox(cells);
  if (!bboxFt || !(bboxFt.w > 0) || !(bboxFt.h > 0)) return null;
  const pxPerFt = Math.min(4, maxPx / Math.max(bboxFt.w, bboxFt.h));
  const W = Math.max(1, Math.ceil(bboxFt.w * pxPerFt));
  const H = Math.max(1, Math.ceil(bboxFt.h * pxPerFt));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const px = (v) => v * pxPerFt;
  for (const c of cells) {
    const p = paint(c);
    const x = px(c.x - c.wFt / 2 - bboxFt.x), y = px(c.y - c.hFt / 2 - bboxFt.y);
    const w = Math.max(1, px(c.wFt)), h = Math.max(1, px(c.hFt));
    if (p.kind === "depth" || p.kind === "fill" || p.kind === "cut") {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y, w, h);
    } else if (p.kind === "zero") {
      // on-grade cells read faint — present, but visually quiet next to real cut/fill
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x, y, w, h);
    } else {
      // hatch classes: a light body + two diagonal strokes reads as "condition", not depth
      ctx.globalAlpha = p.kind === "floodway" ? 0.35 : 0.25;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1, w / 6);
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x + w, y);
      ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w / 2, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return { dataUrl: canvas.toDataURL("image/png"), bboxFt, pxPerFt };
}
