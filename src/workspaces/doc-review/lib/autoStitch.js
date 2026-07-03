/* Automatic match-line stitching (B337) — the roadmap's "automatic match-line detection,"
 * now specified. PURE geometry layered on the EXISTING similarity fit (`solveM`, stitchGeom.js,
 * B300): from each sheet's match-line labels (read by sheetMeta, B336) it builds the sheet
 * adjacency, then places each sheet by feeding the two endpoints of a shared match line as the
 * correspondence pair into `solveM` — no shared property corner needed. Per-sheet stated scale
 * (B339) handles calibration; the transform itself comes straight from the seam endpoints.
 *
 * Safety net (owner rule): when labels are missing/unreadable a sheet is left UNPLACED and the
 * caller drops back to the proven 2-point manual Align — pre-seeded with `detectedEndpointsFor`
 * when we at least know the seam side. Manual align stays the fallback, never the primary path.
 */
import { solveM, fwd, alignBaselinesDegenerate } from "./stitchGeom.js";
import { fitEdgeLine, orderEndpoints } from "../../../shared/files/edgeGeomMatch.js";

const normNum = (s) => (s || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
const OPP = { left: "right", right: "left", top: "bottom", bottom: "top" };
export const oppositeSide = (side) => OPP[side] || null;

/* The two endpoints of a sheet's match-line seam, in page units, in a CONSISTENT order so two
 * sheets that share the seam correspond endpoint-for-endpoint (vertical cut → [top, bottom];
 * horizontal cut → [left, right]). The seam is taken as the drawing-area edge on that side
 * (B336's drawingArea = page minus the title block), which is reproducible on both sheets. */
export function detectedEndpointsFor(drawingArea, side) {
  if (!drawingArea || !side) return null;
  const x0 = drawingArea.x, x1 = drawingArea.x + drawingArea.w;
  const y0 = drawingArea.y, y1 = drawingArea.y + drawingArea.h;
  switch (side) {
    case "right": return [{ x: x1, y: y0 }, { x: x1, y: y1 }];
    case "left": return [{ x: x0, y: y0 }, { x: x0, y: y1 }];
    case "top": return [{ x: x0, y: y0 }, { x: x1, y: y0 }];
    case "bottom": return [{ x: x0, y: y1 }, { x: x1, y: y1 }];
    default: return null;
  }
}

// Resolve a match-line target to a sheet within the group. A vector set names a real sheet code
// ("SEE SHEET C-3") which we match by sheet NUMBER. A SCANNED set's OCR-recovered labels (B413)
// instead reference by SEQUENCE — "MATCH LINE ~ SHEET 2" means the 2nd sheet of the set, whose own
// code might be "C-3" — so when a bare-numeric target names no sheet code, fall back to the Nth
// sheet in group/page order. The sequence fallback fires ONLY for a purely-numeric target that
// matches no code AND is a valid 1-based index, so it can never hijack a real code like "C-2"
// (normNum("C-2") = "C2" ≠ "2"); code lookup always wins first.
function resolveTarget(rawTarget, byNum, sheets) {
  const key = normNum(rawTarget);
  if (!key) return null;
  const byCode = byNum.get(key);
  if (byCode) return byCode;
  if (/^\d+$/.test(key)) {
    const n = parseInt(key, 10);
    if (n >= 1 && n <= sheets.length) return sheets[n - 1];
  }
  return null;
}

/* Build the undirected seam graph. A sheet that names another via a match-line target makes an
 * edge; if the named sheet doesn't independently name a side, we assume the opposite side.
 * Returns Map(id → [{ other, side, otherSide }]). */
export function buildAdjacency(sheets) {
  const byNum = new Map();
  for (const s of sheets) if (s.sheetNumber) byNum.set(normNum(s.sheetNumber), s);
  const adj = new Map(sheets.map((s) => [s.id, []]));
  const seen = new Set();
  const add = (a, b, aSide, bSide) => {
    const key = a.id + "|" + b.id;
    if (seen.has(key)) return;
    seen.add(key);
    adj.get(a.id).push({ other: b, side: aSide, otherSide: bSide });
  };
  for (const a of sheets) {
    for (const ml of a.matchLines || []) {
      if (!ml.target) continue;
      const b = resolveTarget(ml.target, byNum, sheets);
      if (!b || b.id === a.id) continue;
      // For two sheets that share a seam, the geometry is fixed: B sits on the OPPOSITE edge of
      // the side A points to (A says "B is on my right" ⇒ B's left edge meets A's right edge).
      // So the opposite side is the source of truth, not B's own label.
      const geomSide = oppositeSide(ml.side);
      if (!geomSide) continue; // A's side unreadable (bare match line) → no usable seam here
      // B350 — CONTRADICTION guard. If B also names A but on a side that is NOT that opposite
      // (e.g. both sheets claim the seam is on their "right"), the two reads disagree about how
      // they fit together — a sign one label was mis-read. Stitching anyway would overlap/mirror
      // the sheet; per "a wrong stitch is worse than an unstitched one," drop the edge and let the
      // sheet fall to the manual-Align safety net instead of auto-guessing.
      const back = (b.matchLines || []).find((m) => resolveTarget(m.target, byNum, sheets) === a);
      if (back && back.side && back.side !== geomSide) continue;
      add(a, b, ml.side, geomSide);
      add(b, a, geomSide, ml.side);
    }
  }
  return adj;
}

// Choose the anchor (the world frame): most seam connections wins (the central sheet), ties
// broken by the lowest sheet ordinal so placement is deterministic.
function pickAnchor(sheets, adj) {
  const numOf = (s) => { const m = normNum(s.sheetNumber).match(/(\d+)/); return m ? +m[1] : Infinity; };
  return [...sheets].sort((a, b) => (adj.get(b.id).length - adj.get(a.id).length) || (numOf(a) - numOf(b)))[0];
}

const ID = { A: 1, B: 0, e: 0, f: 0 };

/* The seam endpoints to feed the similarity solve for `sheet` on `side` (B340 tail #2). Prefers the
 * DRAWN match line's geometry when it was extracted for this side (sheet.seamGeom[side] = candidate
 * vector segments) — landing the seam on the true, possibly-inset line — and falls back to the
 * drawing-area RECTANGLE edge (the label-based default, detectedEndpointsFor). Improve-only + fail
 * open: a missing or low-confidence geometry fit silently keeps the rectangle edge, so this is a
 * DORMANT enhancement until the vector extractor populates seamGeom (verified live). */
export function seamEndpointsFor(sheet, side) {
  const segs = sheet && sheet.seamGeom && sheet.seamGeom[side];
  if (segs && segs.length) {
    const fit = fitEdgeLine(segs);
    if (fit && fit.straightness >= 0.985 && fit.span >= 40) return orderEndpoints(fit.p1, fit.p2);
  }
  return detectedEndpointsFor(sheet && sheet.drawingArea, side);
}

// B350 — sheets in one real plan set are the SAME plot size, so a seam-to-seam fit should place a
// neighbor at ~1× scale (the anchor is identity, both endpoints are page points). A similarity fit
// from two endpoints, though, will happily RESCALE a sheet to make the seams meet — so a half-size
// detail page (or a portrait sheet mis-grouped with landscape ones) gets silently shrunk/blown up
// to fit. Reject a placement whose implied scale strays past this tolerance and leave the sheet
// UNPLACED (→ manual Align), rather than auto-stitch it at the wrong size.
export const MAX_STITCH_SCALE = 1.25; // ±25% — comfortably past plot-rounding, well short of a half/double-size sheet
const scaleOf = (M) => Math.hypot(M.A, M.B);
const scaleInBand = (M) => { const s = scaleOf(M); return s >= 1 / MAX_STITCH_SCALE && s <= MAX_STITCH_SCALE; };

/* Place a group of sheets on one world frame from their match-line seams. Each `sheet` =
 * { id, sheetNumber, drawingArea, matchLines, scale? }. Returns
 *   { placements: Map(id→M), placed:[id], unplaced:[id], ok, anchorId }
 * where M is the page-units→world similarity matrix the Stitcher already consumes. A sheet that
 * can't be reached through a seam stays UNPLACED (caller → manual Align). Fails safe: a
 * degenerate seam is skipped, never allowed to fling a sheet (mirrors the B300 guard). */
export function autoPlaceGroup(sheets = []) {
  const placements = new Map();
  if (!sheets.length) return { placements, placed: [], unplaced: [], ok: false, anchorId: null };
  const adj = buildAdjacency(sheets);
  const anchor = pickAnchor(sheets, adj);
  placements.set(anchor.id, { ...ID });
  const seen = new Set([anchor.id]);
  const queue = [anchor];
  while (queue.length) {
    const a = queue.shift();
    const Ma = placements.get(a.id);
    for (const link of adj.get(a.id) || []) {
      const b = link.other;
      if (seen.has(b.id)) continue;
      const aEnds = seamEndpointsFor(a, link.side);       // B340 tail #2 — drawn-geometry seam when present, else the rectangle edge
      const bEnds = seamEndpointsFor(b, link.otherSide);
      if (!aEnds || !bEnds) continue;
      const wA1 = fwd(Ma, aEnds[0]), wA2 = fwd(Ma, aEnds[1]);
      if (alignBaselinesDegenerate(bEnds[0], bEnds[1], wA1, wA2)) continue;
      const Mb = solveM(bEnds[0], bEnds[1], wA1, wA2);
      if (!scaleInBand(Mb)) continue; // B350 — size mismatch ⇒ would rescale wrongly; leave for manual Align
      placements.set(b.id, Mb);
      seen.add(b.id);
      queue.push(b);
    }
  }
  const placed = sheets.filter((s) => seen.has(s.id)).map((s) => s.id);
  const unplaced = sheets.filter((s) => !seen.has(s.id)).map((s) => s.id);
  return { placements, placed, unplaced, ok: unplaced.length === 0, anchorId: anchor.id };
}
