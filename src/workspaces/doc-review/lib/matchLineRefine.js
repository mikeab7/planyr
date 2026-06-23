/* Raster match-line refinement for the Stitcher (B413) — the browser glue over the pure
 * pixel fitter (shared/files/matchLineFit.js).
 *
 * The label-based auto-stitch (autoStitch.js) butts two sheets along their drawing-area RECTANGLE
 * edges. On real scanned/plotted sets the true match line is inset and skewed from that edge, so
 * the seam comes out broken. This module re-derives each adjacent sheet's placement from the
 * ACTUAL match line found in the rendered pixels: it fits the line on both sheets, maps the
 * neighbor's line exactly onto the anchor's (rotation + position), then slides along the seam so
 * the crossing linework connects — producing a seamless join.
 *
 * Coordinate frames:
 *   • raster px  — the rendered sheet bitmap (what we fit on).
 *   • page units — the Stitcher's per-sheet base units (baseW/baseH); pagePerRaster = baseW/rasterW.
 *   • world      — the shared composite frame; sheet placement M maps page→world (stitchGeom.js).
 *
 * A vertical (left/right) seam is handled by transposing the raster so the line is horizontal,
 * fitting, then transposing the endpoints back — one code path for both orientations.
 *
 * Fails safe: any sheet whose line can't be confidently fit (or whose neighbor's can't) keeps its
 * label-based placement, and ultimately the manual-Align safety net. A wrong snap is worse than
 * none, so every uncertain case returns the original transform unchanged.
 */
import { solveM, fwd, alignBaselinesDegenerate } from "./stitchGeom.js";
import { fitMatchLine, colProfile, slideRefine } from "../../../shared/files/matchLineFit.js";
import { oppositeSide, buildAdjacency } from "./autoStitch.js";

const isVertical = (side) => side === "left" || side === "right";

// Convert a {lo,hi} span (fractions of the seam-parallel axis, from the drawingArea) into
// fitSeamLine options. Falls back to a conservative window that trims both ends.
const spanOpt = (span) => (span && span.hi > span.lo ? { spanLo: span.lo, spanHi: span.hi } : { spanLo: 0.06, spanHi: 0.78 });

// Threshold a rendered sheet's ImageData to a 1=ink binary (dark pixels). Returns
// { bin, W, H }. Kept here (not in the pure module) because ImageData is browser-only.
export function binarizeImageData(imageData, threshold = 140) {
  const { data, width: W, height: H } = imageData;
  const bin = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
    const lum = 0.3 * data[p] + 0.59 * data[p + 1] + 0.11 * data[p + 2];
    if (lum < threshold) bin[i] = 1;
  }
  return { bin, W, H };
}

// Transpose a binary image (x↔y). Used so a vertical seam can reuse the horizontal fitter.
function transpose(bin, W, H) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const base = y * W; for (let x = 0; x < W; x++) if (bin[base + x]) out[x * H + y] = 1; }
  return { bin: out, W: H, H: W };
}

/* Fit a sheet's match line in raster px for the given seam `side`, seeded on the label center
 * (seed = {x,y} in raster px). Returns { p1, p2 } endpoints in raster px (ordered along the seam:
 * left→right for a horizontal cut, top→bottom for a vertical one), or null.
 * `span` is the working extent fraction across the seam-parallel axis (drawing area, minus the
 * title-block corner). */
export function fitSeamLine(bin, W, H, side, seed, { spanLo = 0.06, spanHi = 0.94, halfBand = null } = {}) {
  const vert = isVertical(side);
  const img = vert ? transpose(bin, W, H) : { bin, W, H };
  // In the (horizontalized) frame: the line runs across `iW`, seeded at row = seed along the
  // OTHER axis. For vertical, after transpose the seam-parallel axis is the original Y.
  const iW = img.W, iH = img.H;
  const yCen = vert ? Math.round(seed.x) : Math.round(seed.y);
  const x0 = Math.round(iW * spanLo), x1 = Math.round(iW * spanHi);
  // band half-height around the seed: generous enough to tolerate the OCR label sitting a little
  // off the actual line, tight enough to exclude unrelated linework above/below.
  const hb = halfBand || Math.max(24, Math.round(iH * 0.018));
  const fit = fitMatchLine(img.bin, iW, iH, { yCen, x0, x1, halfBand: hb, closeR: 7, openR: 20 });
  if (!fit) return null;
  // endpoints in the horizontalized frame → map back to raster px
  const e1 = fit.p1, e2 = fit.p2; // {x: along-seam, y: across-seam}
  if (vert) return { p1: { x: e1.y, y: e1.x }, p2: { x: e2.y, y: e2.x } }; // transpose back
  return { p1: e1, p2: e2 };
}

/* Compute the refined placement matrix Mb (page→world) for neighbor B so its match line coincides
 * with anchor A's. Inputs:
 *   A: { bin,W,H, pagePerRaster, seed, M }   — anchor (already placed; M is its page→world)
 *   B: { bin,W,H, pagePerRaster, seed }      — neighbor to place
 *   sideA: the seam side on A ('top'|'bottom'|'left'|'right'); B is on oppositeSide(sideA).
 * Returns Mb or null (caller keeps B's label-based placement on null). */
export function refineSeamPlacement(A, B, sideA) {
  const sideB = oppositeSide(sideA);
  if (!sideB) return null;
  // The working window across the seam must EXCLUDE the title-block strip — its border/notes are
  // long horizontal/vertical lines that corrupt the match-line fit. Each sheet's `span` ({lo,hi}
  // fractions along the seam-parallel axis) is derived from its drawingArea by the caller.
  const la = fitSeamLine(A.bin, A.W, A.H, sideA, A.seed, spanOpt(A.span));
  const lb = fitSeamLine(B.bin, B.W, B.H, sideB, B.seed, spanOpt(B.span));
  if (!la || !lb) return null;
  // raster px → page units
  const toPageA = (p) => ({ x: p.x * A.pagePerRaster, y: p.y * A.pagePerRaster });
  const toPageB = (p) => ({ x: p.x * B.pagePerRaster, y: p.y * B.pagePerRaster });
  const aP1 = toPageA(la.p1), aP2 = toPageA(la.p2);
  const bP1 = toPageB(lb.p1), bP2 = toPageB(lb.p2);
  // anchor endpoints → world
  const aW1 = fwd(A.M, aP1), aW2 = fwd(A.M, aP2);
  if (alignBaselinesDegenerate(bP1, bP2, aW1, aW2)) return null;
  let Mb = solveM(bP1, bP2, aW1, aW2);
  // Slide along the seam so crossing features connect. Build column ink profiles just on each
  // sheet's DRAWING side of its line (anchor: opposite of sideA; neighbor: opposite of sideB),
  // in the horizontalized frame, and cross-correlate.
  const slide = seamSlide(A, B, sideA, la, lb, A.span, B.span);
  if (slide) {
    // shift B by `slide` page-units along the seam tangent (≈ the seam direction in world)
    const t = seamTangentWorld(aW1, aW2);
    Mb = { ...Mb, e: Mb.e + t.x * slide, f: Mb.f + t.y * slide };
  }
  return Mb;
}

// Unit tangent of the seam in world space (direction A1→A2).
function seamTangentWorld(A1, A2) {
  const dx = A2.x - A1.x, dy = A2.y - A1.y, L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}

/* Cross-correlate the crossing-feature profiles on each side of the seam to get the along-seam
 * slide (in PAGE units). Returns a number (may be 0) or null when it can't sample. */
function seamSlide(A, B, sideA, la, lb, spanA, spanB, bandPx = null) {
  const vertA = isVertical(sideA);
  const imgA = vertA ? transpose(A.bin, A.W, A.H) : { bin: A.bin, W: A.W, H: A.H };
  const imgB = vertA ? transpose(B.bin, B.W, B.H) : { bin: B.bin, W: B.W, H: B.H };
  // line row (across-seam coord) at mid-span in each horizontalized frame
  const midA = lineMidRow(la, vertA), midB = lineMidRow(lb, vertA);
  const bandA = bandPx || Math.max(8, Math.round(imgA.H * 0.06));
  const bandB = bandPx || Math.max(8, Math.round(imgB.H * 0.06));
  // anchor draws on the opposite side of sideA; in the horizontalized frame 'bottom'/'right'
  // (line near high coord, drawing above) vs 'top'/'left' (drawing below).
  const aAbove = sideA === "bottom" || sideA === "right";
  const profAraw = aAbove ? colProfile(imgA.bin, imgA.W, imgA.H, midA - bandA, midA)
                          : colProfile(imgA.bin, imgA.W, imgA.H, midA, midA + bandA);
  const profBraw = aAbove ? colProfile(imgB.bin, imgB.W, imgB.H, midB, midB + bandB)
                          : colProfile(imgB.bin, imgB.W, imgB.H, midB - bandB, midB);
  // Zero the title-block columns so they don't dominate the crossing-feature correlation.
  maskSpan(profAraw, spanOpt(spanA));
  maskSpan(profBraw, spanOpt(spanB));
  // resample both to page-x so the correlation shift comes out in page units
  const profA = resample(profAraw, A.pagePerRaster);
  const profB = resample(profBraw, B.pagePerRaster);
  if (!profA.length || !profB.length) return null;
  const range = Math.round(Math.min(profA.length, profB.length) * 0.06);
  return slideRefine(profA, profB, range);
}

// Zero a profile outside [lo,hi]·length so only the drawing area contributes.
function maskSpan(prof, { spanLo, spanHi }) {
  const lo = Math.round(prof.length * spanLo), hi = Math.round(prof.length * spanHi);
  for (let i = 0; i < prof.length; i++) if (i < lo || i >= hi) prof[i] = 0;
}

/* The match-line SEED (across-seam coordinate) + working span for one sheet/side, in raster px.
 * Prefers the read "MATCH LINE" label position; falls back to the drawing-area edge when this
 * sheet didn't carry its own label on that side. Returns { seed:{x,y}, span:{lo,hi}, fromLabel }. */
function seedAndSpan(sheet, side, pagePerRaster) {
  const da = sheet.drawingArea || { x: 0, y: 0, w: sheet.baseW || 0, h: sheet.baseH || 0 };
  const ml = (sheet.matchLines || []).find((m) => m.side === side);
  let page;
  if (ml) page = { x: ml.x, y: ml.y };
  else if (side === "bottom") page = { x: da.x + da.w / 2, y: da.y + da.h };
  else if (side === "top") page = { x: da.x + da.w / 2, y: da.y };
  else if (side === "left") page = { x: da.x, y: da.y + da.h / 2 };
  else page = { x: da.x + da.w, y: da.y + da.h / 2 };
  const seed = { x: page.x / pagePerRaster, y: page.y / pagePerRaster };
  // span runs along the seam-parallel axis (x for a horizontal cut, y for a vertical one)
  const span = isVertical(side)
    ? { lo: (sheet.baseH ? da.y / sheet.baseH : 0.06), hi: (sheet.baseH ? (da.y + da.h) / sheet.baseH : 0.94) }
    : { lo: (sheet.baseW ? da.x / sheet.baseW : 0.06), hi: (sheet.baseW ? (da.x + da.w) / sheet.baseW : 0.94) };
  return { seed, span, fromLabel: !!ml };
}

/* Refine an ENTIRE group's placements from the rendered pixels. Walks the seam graph from the
 * anchor (same BFS order as autoPlaceGroup) and, for each edge, re-derives the neighbor's matrix
 * so its true match line lands on the parent's. Any edge that can't be fit confidently keeps the
 * label-based placement — so this only ever improves a seam, never breaks one.
 *   sheets: [{ id, sheetNumber, drawingArea, matchLines, baseW, baseH }]
 *   placements: Map(id → M) from autoPlaceGroup
 *   rasterOf(id) → { bin, W, H, pagePerRaster } | null
 * Returns a NEW Map(id → M). */
export function refineGroupPlacements({ sheets, placements, anchorId, rasterOf }) {
  const byId = new Map(sheets.map((s) => [s.id, s]));
  const adj = buildAdjacency(sheets);
  const refined = new Map(placements);
  const start = anchorId && placements.has(anchorId) ? anchorId : (sheets.find((s) => placements.has(s.id)) || {}).id;
  if (!start) return refined;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const aId = queue.shift();
    const a = byId.get(aId), Ma = refined.get(aId), ra = rasterOf(aId);
    for (const link of adj.get(aId) || []) {
      const bId = link.other.id;
      if (seen.has(bId) || !placements.has(bId)) continue;
      seen.add(bId); queue.push(bId);
      const b = byId.get(bId), rb = rasterOf(bId);
      if (!a || !b || !Ma || !ra || !rb) continue; // missing pixels → keep label placement
      const sa = seedAndSpan(a, link.side, ra.pagePerRaster);
      const sb = seedAndSpan(b, link.otherSide, rb.pagePerRaster);
      const Mb = refineSeamPlacement(
        { ...ra, seed: sa.seed, span: sa.span, M: Ma },
        { ...rb, seed: sb.seed, span: sb.span },
        link.side
      );
      // Accept only a PLAUSIBLE correction (a nudge, not a fling). A confident-but-wrong line fit
      // could otherwise throw the sheet across the canvas; if the refined placement strays far from
      // the label-based one, keep the label placement. This keeps the refiner strictly additive.
      if (Mb && plausibleRefine(placements.get(bId), Mb, b.baseW || 0, b.baseH || 0)) refined.set(bId, Mb);
    }
  }
  return refined;
}

/* Is the refined placement a reasonable nudge of the label placement (not a wild jump)? Guards
 * against a confident-but-wrong line fit flinging the sheet. Compares scale, rotation, and how far
 * the sheet center moves. */
export function plausibleRefine(labelM, Mb, baseW, baseH) {
  if (!labelM) return true; // no baseline to compare → trust the fit (it passed the line guards)
  const sL = Math.hypot(labelM.A, labelM.B) || 1, sB = Math.hypot(Mb.A, Mb.B) || 1;
  const ratio = sB / sL;
  if (ratio < 0.8 || ratio > 1.25) return false;
  const rot = Math.abs(Math.atan2(Mb.B, Mb.A) - Math.atan2(labelM.B, labelM.A)) * 180 / Math.PI;
  if (Math.min(rot, 360 - rot) > 6) return false;
  const c = { x: baseW / 2, y: baseH / 2 };
  const pL = fwd(labelM, c), pB = fwd(Mb, c);
  const diag = Math.hypot(baseW, baseH) || 1;
  return Math.hypot(pB.x - pL.x, pB.y - pL.y) <= 0.5 * diag;
}

// Across-seam coordinate of the line at mid-span, in the horizontalized frame.
function lineMidRow(line, vert) {
  // in horizontalized frame: across-seam coord is y for horizontal, x-after-transpose handled by caller
  const p1 = vert ? { x: line.p1.y, y: line.p1.x } : line.p1;
  const p2 = vert ? { x: line.p2.y, y: line.p2.x } : line.p2;
  return Math.round((p1.y + p2.y) / 2);
}

// Downsample a per-raster-px profile to per-page-unit (bin by pagePerRaster).
function resample(prof, pagePerRaster) {
  if (pagePerRaster >= 1) return prof; // raster coarser than page — already fine
  const factor = 1 / pagePerRaster; // raster px per page unit
  const n = Math.round(prof.length / factor);
  const out = new Float64Array(n);
  for (let i = 0; i < prof.length; i++) { const j = Math.min(n - 1, Math.floor(i / factor)); out[j] += prof[i]; }
  return out;
}
