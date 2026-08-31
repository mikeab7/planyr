/* Precise-alignment + trace-scale math for the site-plan overlay (B73 fallbacks).
 * Pure + browser-free, so the geometry is unit-tested. All points are world feet
 * {x,y}. The overlay's image→world placement (mirrored from the SVG render) is:
 * translate an image point by ftPerPx out of the top-left (x,y), then rotate the whole
 * sheet about its center by `rotation`°. `imagePointToWorld` reproduces that exactly so
 * the alignment can be checked end-to-end. */
import { solveSimilarityLSQ as _solveSimilarityLSQ } from "../../../shared/geometry/similarityTransform.js";

// Re-exported verbatim (moved to shared/geometry so the comps site-plan-overlay feature can
// reuse the exact same N-point Procrustes solve instead of a second implementation) — this
// module's own behavior and its unit tests are unchanged.
export const solveSimilarityLSQ = _solveSimilarityLSQ;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const centerOf = (o) => ({ x: o.x + (o.imgW * o.ftPerPx) / 2, y: o.y + (o.imgH * o.ftPerPx) / 2 });
// Top-left {x,y} that puts the sheet's center at C (given size + ftPerPx).
const tlFromCenter = (C, imgW, imgH, ftPerPx) => ({ x: C.x - (imgW * ftPerPx) / 2, y: C.y - (imgH * ftPerPx) / 2 });

/* Map an image-space point (px, in [0..imgW]×[0..imgH]) to world feet under the
 * overlay's current placement. */
export function imagePointToWorld(o, ix, iy) {
  const C = centerOf(o);
  const pre = { x: o.x + ix * o.ftPerPx, y: o.y + iy * o.ftPerPx };
  const a = ((o.rotation || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const d = sub(pre, C);
  return { x: C.x + c * d.x - s * d.y, y: C.y + s * d.x + c * d.y };
}

/* Uniform-scale an overlay by factor k about a fixed world point p0 (rotation kept) —
 * the trace-a-known-dimension result. Returns changed fields {ftPerPx,x,y} or null. */
export function scaleOverlayAbout(o, p0, k) {
  if (!(k > 0) || !isFinite(k)) return null;
  const ftPerPx = o.ftPerPx * k;
  const C = centerOf(o);
  const C2 = { x: p0.x + (C.x - p0.x) * k, y: p0.y + (C.y - p0.y) * k };
  return { ftPerPx, ...tlFromCenter(C2, o.imgW, o.imgH, ftPerPx) };
}

/* Similarity (uniform scale + rotation + translation) mapping p1→q1 and p2→q2.
 * Returns { scale, rotDeg, apply(pt) } or null when p1≈p2. */
export function similarityTransform(p1, p2, q1, q2) {
  const vP = sub(p2, p1), vQ = sub(q2, q1);
  const lP = len(vP);
  if (!(lP > 1e-9)) return null;
  const scale = len(vQ) / lP;
  const ang = Math.atan2(vQ.y, vQ.x) - Math.atan2(vP.y, vP.x);
  const c = Math.cos(ang), s = Math.sin(ang);
  const apply = (pt) => {
    const d = sub(pt, p1);
    return { x: q1.x + scale * (c * d.x - s * d.y), y: q1.y + scale * (s * d.x + c * d.y) };
  };
  return { scale, rotDeg: (ang * 180) / Math.PI, apply };
}

/* Apply a similarity transform S (from similarityTransform / solveSimilarityLSQ) to an
 * overlay: scales ftPerPx, adds rotation, repositions via the center. Returns changed
 * fields {ftPerPx,rotation,x,y} or null. */
export function applySimilarityToOverlay(o, S) {
  if (!S) return null;
  const ftPerPx = o.ftPerPx * S.scale;
  const C2 = S.apply(centerOf(o));
  return {
    ftPerPx,
    rotation: ((((o.rotation || 0) + S.rotDeg) % 360) + 360) % 360,
    ...tlFromCenter(C2, o.imgW, o.imgH, ftPerPx),
  };
}

/* 2-point alignment: lands the two drawing points (p1,p2) on the two map points (q1,q2). */
export function alignOverlaySimilarity(o, p1, p2, q1, q2) {
  return applySimilarityToOverlay(o, similarityTransform(p1, p2, q1, q2));
}

/* Aerial-underlay trace calibration (B654) — the shared-calibration port of the old
 * inline `applyCalibration`: two clicked world points (a,b) a known real length apart
 * → rescale the underlay about point `a` (pinned in world space). The underlay is
 * axis-aligned (no rotation) but may carry independent x/y scales (`ftPerPxY` on a
 * georeferenced map capture), so BOTH axes scale by the same factor. Returns the
 * changed fields { ftPerPx, ftPerPxY?, x, y, calibrated:true } or null when the input
 * can't calibrate: a from-map underlay (already georeferenced — a diagonal-derived
 * scalar would mis-size it, B57a), a non-positive known length, or a zero-length pick. */
export function calibrateUnderlayScale(u, a, b, knownFt) {
  if (!u || u.fromMap || !a || !b || !(knownFt > 0) || !(u.ftPerPx > 0)) return null;
  const measured = len(sub(b, a));
  if (!(measured > 0)) return null;
  const factor = knownFt / measured;
  const sy = u.ftPerPxY || u.ftPerPx;
  const ftPerPx = u.ftPerPx * factor;
  const newSy = sy * factor;
  // image-pixel coords of point a under the current placement — kept pinned after rescale
  const aPxX = (a.x - u.x) / u.ftPerPx;
  const aPxY = (a.y - u.y) / sy;
  return {
    ftPerPx,
    ftPerPxY: u.ftPerPxY ? newSy : undefined,
    x: a.x - aPxX * ftPerPx,
    y: a.y - aPxY * newSy,
    calibrated: true,
  };
}

