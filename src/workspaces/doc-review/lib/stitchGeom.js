/* Pure geometry for the multi-sheet Stitcher (Document Review). Each placed sheet
 * carries a page-units→world similarity matrix M = {A,B,e,f}:
 *   world.x = A*x − B*y + e ;  world.y = B*x + A*y + f   (SVG matrix(A,B,−B,A,e,f))
 * Kept out of the component so the math is unit-testable on its own — the alignment
 * transform is subtle and a bad one silently flings a sheet off-canvas (B288/B289). */

// page-units → world, and the inverse (world → page-units)
export const fwd = (M, p) => ({ x: M.A * p.x - M.B * p.y + M.e, y: M.B * p.x + M.A * p.y + M.f });
export const inv = (M, w) => {
  const det = M.A * M.A + M.B * M.B || 1;
  const dx = w.x - M.e, dy = w.y - M.f;
  return { x: (M.A * dx + M.B * dy) / det, y: (-M.B * dx + M.A * dy) / det };
};

// similarity transform mapping b1→A1, b2→A2 (page-units → world)
export function solveM(b1, b2, A1, A2) {
  const vb = { x: b2.x - b1.x, y: b2.y - b1.y }, vA = { x: A2.x - A1.x, y: A2.y - A1.y };
  const lb = Math.hypot(vb.x, vb.y) || 1, scale = Math.hypot(vA.x, vA.y) / lb;
  const theta = Math.atan2(vA.y, vA.x) - Math.atan2(vb.y, vb.x);
  const A = scale * Math.cos(theta), B = scale * Math.sin(theta);
  return { A, B, e: A1.x - (A * b1.x - B * b1.y), f: A1.y - (B * b1.x + A * b1.y) };
}

// world-space axis-aligned bbox of a placed sheet (its 4 page corners pushed to world)
export function sheetBBox(s) {
  const c = [{ x: 0, y: 0 }, { x: s.baseW, y: 0 }, { x: s.baseW, y: s.baseH }, { x: 0, y: s.baseH }].map((p) => fwd(s.M, p));
  return { minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxY: Math.max(...c.map((p) => p.y)) };
}

// B288 — a similarity transform needs two DISTINCT points on each sheet. If the moving
// sheet's baseline (b1→b2) OR the reference baseline (A1→A2) collapses to ~0, solveM's
// `hypot()||1` masks the zero and returns an extreme scale/offset that throws the sheet
// far off-canvas at huge scale — silently, with no undo. Callers must reject the alignment
// when this is true (mirrors DocReview's calibrate "line too short" guard).
export const MIN_ALIGN_BASE = 1; // page/world units — far below any real two-point baseline
export const alignBaselinesDegenerate = (b1, b2, A1, A2) =>
  Math.hypot(b2.x - b1.x, b2.y - b1.y) < MIN_ALIGN_BASE ||
  Math.hypot(A2.x - A1.x, A2.y - A1.y) < MIN_ALIGN_BASE;

// Is a world point inside a placed sheet's page rectangle?
export const sheetContains = (s, w) => {
  const p = inv(s.M, w);
  return p.x >= 0 && p.x <= s.baseW && p.y >= 0 && p.y <= s.baseH;
};

// B289 — does a measurement (its world points) touch any sheet that isn't aligned yet? A
// freshly added sheet drops at identity scale; measuring over it before Align silently
// applies the composite (sheet-1) calibration, so the reading can be wrong when the
// sheets' real scales differ. Only sheets explicitly flagged aligned:false count.
export const measureOverUnaligned = (placed, pts) =>
  (pts || []).some((w) => (placed || []).some((s) => s.aligned === false && sheetContains(s, w)));
