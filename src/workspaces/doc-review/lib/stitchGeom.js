/* Pure geometry for the multi-sheet Stitcher (Document Review). Each placed sheet
 * carries a page-units→world similarity matrix M = {A,B,e,f}:
 *   world.x = A*x − B*y + e ;  world.y = B*x + A*y + f   (SVG matrix(A,B,−B,A,e,f))
 * Kept out of the component so the math is unit-testable on its own — the alignment
 * transform is subtle and a bad one silently flings a sheet off-canvas (B300/B301). */

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

// B300 — a similarity transform needs two DISTINCT points on each sheet. If the moving
// sheet's baseline (b1→b2) OR the reference baseline (A1→A2) collapses to ~0, solveM's
// `hypot()||1` masks the zero and returns an extreme scale/offset that throws the sheet
// far off-canvas at huge scale — silently, with no undo. Callers must reject the alignment
// when this is true (mirrors DocReview's calibrate "line too short" guard).
export const MIN_ALIGN_BASE = 1; // page/world units — far below any real two-point baseline
// B350 — a NON-FINITE endpoint (NaN/Infinity from a bad PDF read or a mis-built drawingArea) must
// also be rejected. `Math.hypot(NaN,…) < 1` is `NaN < 1` → false, so a NaN baseline used to slip
// PAST the length guard, reach solveM, and produce a NaN matrix that silently poisons the sheet's
// transform and the whole composite's bbox (every Math.min/max over it goes NaN). Treat any
// non-finite point as degenerate so the same "reject + fall back to manual Align" path catches it.
const finitePt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
export const alignBaselinesDegenerate = (b1, b2, A1, A2) =>
  !(finitePt(b1) && finitePt(b2) && finitePt(A1) && finitePt(A2)) ||
  Math.hypot(b2.x - b1.x, b2.y - b1.y) < MIN_ALIGN_BASE ||
  Math.hypot(A2.x - A1.x, A2.y - A1.y) < MIN_ALIGN_BASE;

// Is a world point inside a placed sheet's page rectangle?
export const sheetContains = (s, w) => {
  const p = inv(s.M, w);
  return p.x >= 0 && p.x <= s.baseW && p.y >= 0 && p.y <= s.baseH;
};

// B301 — does a measurement (its world points) touch any sheet that isn't aligned yet? A
// freshly added sheet drops at identity scale; measuring over it before Align silently
// applies the composite (sheet-1) calibration, so the reading can be wrong when the
// sheets' real scales differ. Only sheets explicitly flagged aligned:false count.
export const measureOverUnaligned = (placed, pts) =>
  (pts || []).some((w) => (placed || []).some((s) => s.aligned === false && sheetContains(s, w)));

// B630 / NEW-1 — is this a REFERENCE SET (a stack of schedule/legend/notes sheets), not a plan to
// stitch? Such a set has NOTHING to tile — no match-line seam on any sheet — was never calibrated
// (no composite scale), AND carries at least one sheet we can POSITIVELY tell is not to scale (a
// legend / notes / schedule / explicit-"NTS" sheet, via the persisted `notToScale` flag). For it
// the "Align before measuring" gate is a demand that can never be satisfied, so we drop the nag.
//
// The `some(notToScale)` requirement is the guard against a real plan set: two genuine to-scale
// plan sheets aligned by a shared property corner are also seam-less and (until Calibrate)
// scale-less, but NONE of their sheets reads not-to-scale — so they are NEVER misclassified and
// keep the manual-Align affordance (B630 review finding). A resumed save is classified from
// persisted fields (matchLines + notToScale + ftPerUnit); loadStitch back-fills notToScale for
// pre-B631 saves so the owner's JACINTOPORT set (whose legend/notes sheets read not-to-scale) is
// still caught. Needs ≥2 sheets. Fail open: any seam OR any calibration OR no not-to-scale sheet ⇒
// treated as a real plan. Pure so it's unit-locked against reference + plan-set fixtures.
export function isReferenceSet(placed = [], ftPerUnit = 0) {
  const arr = placed || [];
  if (arr.length < 2) return false;
  if (Number.isFinite(ftPerUnit) && ftPerUnit) return false;                     // calibrated ⇒ a real plan
  if (arr.some((s) => s && s.matchLines && s.matchLines.length)) return false;   // any seam ⇒ a real plan
  return arr.some((s) => s && s.notToScale);                                     // at least one positively not-to-scale sheet
}

// B632 / NEW-3 — size the "⚠ Not aligned" badge to the sheet's ON-SCREEN footprint so it can
// never balloon over a small sheet at low zoom. The overlay lives inside the zoomed world group,
// where a constant on-screen size (n / zoom) means the warning text + dashed border stay a fixed
// pixel size regardless of how tiny the sheet has become — so at the ~1–15% zoom needed to see a
// whole set, the badge blankets each sheet and reads as "broken" rather than as a to-do. Given the
// sheet's smaller on-screen side in px, return the on-screen font/border px (capped to a fraction
// of the sheet) and whether to show text at all: below a floor the badge collapses to an
// outline-only chip (a dashed border with no text still says "to-do" without covering the drawing).
// Pure so the clamp is unit-locked. `text` shortens before it would overflow a small sheet.
export function alignBadgeMetrics(screenMin) {
  const m = Math.max(0, Number.isFinite(screenMin) ? screenMin : 0);
  // Font never exceeds ~11% of the sheet's on-screen min side (so it can't dominate the sheet),
  // and never exceeds the previous fixed 22px on a large sheet. Floor keeps it from vanishing to 0.
  const fontPx = Math.max(7, Math.min(22, m * 0.11));
  const borderPx = Math.max(0.75, Math.min(2.5, m * 0.02));
  // Below this the full label can't fit inside the sheet's width, so drop the text (outline only).
  const showText = m >= 54;
  // A short label for a small sheet, the full call-to-action once there's room for it.
  const text = m < 150 ? "⚠ Not aligned" : "⚠ Not aligned — click “Align”";
  return { fontPx, borderPx, showText, text };
}

// B325 — pan the view from a CAPTURED drag origin {sx,sy,panX,panY} + the live pointer
// position. Pure (and kept here) so the capture contract is unit-testable: the caller MUST
// snapshot the drag ref into a local and pass it in — never let the deferred setView updater
// read the ref. That updater runs in React's render phase, which for a continuous pointermove
// can be deferred a tick, and the gesture may be aborted first (pointerup / pointercancel /
// the blur-abort recovery), nulling the ref. Reading the ref inside the updater then
// dereferenced null and crashed the whole stitcher ("Cannot read properties of null (reading
// 'panX')"). Closing over the captured origin survives an aborted gesture untouched.
export const panTo = (view, origin, clientX, clientY) =>
  ({ ...view, panX: origin.panX + (clientX - origin.sx), panY: origin.panY + (clientY - origin.sy) });
