/* Best-fit 2D similarity transform (uniform scale + rotation + translation) over N>=2 point
 * pairs — closed-form least-squares (Procrustes). Promoted out of
 * site-planner/lib/overlayAlign.js (B73) so a SECOND consumer (the site-plan-overlay
 * georeferencing feature, comps) can reuse the exact same math instead of a second
 * implementation; the overlay placement module surfaces this verbatim, so its existing behavior and
 * tests are unchanged. Pure, no DOM/React — {x,y} points in any consistent 2D unit.
 *
 * NEW-1 (overlay engine): this file is the ONE home of the similarity math — `makeSimilarity`
 * (the apply closure), `solveSimilarityLSQ` (N-point fit), and `similarityFromTwoPoints` (the exact
 * 2-point case). `shared/overlay/overlayPlacement.js` (both overlay surfaces) and
 * `shared/placement/fitToBoundary.js` call these; neither carries a private copy any more.
 */

/** The similarity (uniform scale `scale`, rotation `angRad`) that maps `from` onto `to`:
 * apply(pt) = to + scale·R(angRad)·(pt − from). */
export function makeSimilarity(scale, angRad, from, to) {
  const c = Math.cos(angRad), s = Math.sin(angRad);
  return (pt) => {
    const dx = pt.x - from.x, dy = pt.y - from.y;
    return { x: to.x + scale * (c * dx - s * dy), y: to.y + scale * (s * dx + c * dy) };
  };
}

/** Similarity mapping p1→q1 and p2→q2 exactly. Returns { scale, rotDeg, apply(pt) } or null when
 * p1≈p2 (a zero-length source vector fixes neither scale nor rotation). */
export function similarityFromTwoPoints(p1, p2, q1, q2) {
  const vPx = p2.x - p1.x, vPy = p2.y - p1.y, vQx = q2.x - q1.x, vQy = q2.y - q1.y;
  const lP = Math.hypot(vPx, vPy);
  if (!(lP > 1e-9)) return null;
  const scale = Math.hypot(vQx, vQy) / lP;
  const ang = Math.atan2(vQy, vQx) - Math.atan2(vPy, vPx);
  return { scale, rotDeg: (ang * 180) / Math.PI, apply: makeSimilarity(scale, ang, p1, q1) };
}

/** Best-fit similarity over N>=2 pairs [{from:{x,y}, to:{x,y}}], least-squares. Returns
 * { scale, rotDeg, apply(pt), residual } or null when fewer than 2 pairs are given or every
 * `from` point coincides. `residual` is the RMS landing error in the `to` units (~0 for an
 * exact fit or exactly 2 points) — a high residual means the points don't fit a rigid
 * (non-distorted) transform. */
export function solveSimilarityLSQ(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  let Px = 0, Py = 0, Qx = 0, Qy = 0;
  for (const { from, to } of pairs) { Px += from.x; Py += from.y; Qx += to.x; Qy += to.y; }
  const Pb = { x: Px / n, y: Py / n }, Qb = { x: Qx / n, y: Qy / n };
  let C = 0, S = 0, Spp = 0;
  for (const { from, to } of pairs) {
    const px = from.x - Pb.x, py = from.y - Pb.y, qx = to.x - Qb.x, qy = to.y - Qb.y;
    C += px * qx + py * qy;       // Σ p·q
    S += px * qy - py * qx;       // Σ p×q
    Spp += px * px + py * py;     // Σ |p|²
  }
  if (!(Spp > 1e-12)) return null;  // all source points coincide
  const scale = Math.hypot(C, S) / Spp;
  const ang = Math.atan2(S, C);
  const apply = makeSimilarity(scale, ang, Pb, Qb);
  let se = 0;
  for (const { from, to } of pairs) { const r = apply(from); se += (r.x - to.x) ** 2 + (r.y - to.y) ** 2; }
  return { scale, rotDeg: (ang * 180) / Math.PI, apply, residual: Math.sqrt(se / n) };
}
