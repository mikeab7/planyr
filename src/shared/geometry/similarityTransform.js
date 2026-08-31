/* Best-fit 2D similarity transform (uniform scale + rotation + translation) over N>=2 point
 * pairs — closed-form least-squares (Procrustes). Promoted out of
 * site-planner/lib/overlayAlign.js (B73) so a SECOND consumer (the site-plan-overlay
 * georeferencing feature, comps) can reuse the exact same math instead of a second
 * implementation; overlayAlign.js re-exports this verbatim, so its existing behavior and
 * tests are unchanged. Pure, no DOM/React — {x,y} points in any consistent 2D unit.
 */

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
  const c = Math.cos(ang), s = Math.sin(ang);
  const apply = (pt) => {
    const dx = pt.x - Pb.x, dy = pt.y - Pb.y;
    return { x: Qb.x + scale * (c * dx - s * dy), y: Qb.y + scale * (s * dx + c * dy) };
  };
  let se = 0;
  for (const { from, to } of pairs) { const r = apply(from); se += (r.x - to.x) ** 2 + (r.y - to.y) ** 2; }
  return { scale, rotDeg: (ang * 180) / Math.PI, apply, residual: Math.sqrt(se / n) };
}
