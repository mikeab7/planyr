/* Pure geometry for the Document Review multi-sheet stitcher. Each placed sheet has a
 * page-units → world matrix M = {A,B,e,f} (an SVG matrix(A,B,−B,A,e,f) similarity):
 *   world.x = A*x − B*y + e ;  world.y = B*x + A*y + f
 * Kept out of the React component (no DOM, no state) so the transform + alignment math is
 * unit-testable in the node test env — the same pattern as the Site Planner's overlayAlign. */

// page-units → world, and the inverse (world → page units)
export const fwd = (M, p) => ({ x: M.A * p.x - M.B * p.y + M.e, y: M.B * p.x + M.A * p.y + M.f });
export const inv = (M, w) => {
  const det = M.A * M.A + M.B * M.B || 1;
  const dx = w.x - M.e, dy = w.y - M.f;
  return { x: (M.A * dx + M.B * dy) / det, y: (-M.B * dx + M.A * dy) / det };
};

// Smallest click-to-click baseline (page or world units) we'll accept for an alignment.
// Below this the two points are effectively coincident and the similarity solve divides by
// ~0 → a wild scale/translation. Mirrors DocReview's calibrate "line too short" floor.
export const MIN_BASELINE = 1;

// True when either the moving-sheet baseline |b2−b1| or the reference baseline |A2−A1| is
// too short to define a stable similarity transform. Guard with this BEFORE calling solveM
// — otherwise a coincident pair flings the sheet off-canvas at a garbage scale (B297).
export const degenerateAlign = (b1, b2, A1, A2, min = MIN_BASELINE) =>
  Math.hypot(b2.x - b1.x, b2.y - b1.y) < min || Math.hypot(A2.x - A1.x, A2.y - A1.y) < min;

// Similarity transform mapping b1→A1, b2→A2 (page-units → world). The caller MUST reject a
// degenerate baseline first (see degenerateAlign): a ~0 |b2−b1| here divides by `lb || 1`
// and returns an extreme scale/translation.
export function solveM(b1, b2, A1, A2) {
  const vb = { x: b2.x - b1.x, y: b2.y - b1.y }, vA = { x: A2.x - A1.x, y: A2.y - A1.y };
  const lb = Math.hypot(vb.x, vb.y) || 1, scale = Math.hypot(vA.x, vA.y) / lb;
  const theta = Math.atan2(vA.y, vA.x) - Math.atan2(vb.y, vb.x);
  const A = scale * Math.cos(theta), B = scale * Math.sin(theta);
  return { A, B, e: A1.x - (A * b1.x - B * b1.y), f: A1.y - (B * b1.x + A * b1.y) };
}

// World-space bounding box of a placed sheet's four page corners.
export function sheetBBox(s) {
  const c = [{ x: 0, y: 0 }, { x: s.baseW, y: 0 }, { x: s.baseW, y: s.baseH }, { x: 0, y: s.baseH }].map((p) => fwd(s.M, p));
  return { minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxY: Math.max(...c.map((p) => p.y)) };
}

// Is world point w inside placed sheet s's page footprint [0..baseW] × [0..baseH]?
export const pointInSheet = (s, w) => {
  const p = inv(s.M, w);
  return p.x >= 0 && p.x <= s.baseW && p.y >= 0 && p.y <= s.baseH;
};

// Does world point w land on a placed sheet that still needs alignment? The first placed
// sheet (index 0) is the world anchor and is always "aligned"; any later sheet is unaligned
// until its Align completes (s.aligned === true). Measuring there would score the point with
// the shared (sheet-1) calibration → a silently wrong quantity when scales differ (B298).
export const overUnaligned = (placed, w) =>
  placed.some((s, i) => i > 0 && s.aligned !== true && pointInSheet(s, w));
