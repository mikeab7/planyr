/* Fit-to-boundary solver — "Place on map" rung 2 (B182/NEW-3 geometry).
 *
 * Given the property boundary as drawn on the sheet (source ring, in the drawing's own
 * units) and the parcel/survey boundary Planyr already holds (target ring, in world
 * feet), solve the one similarity transform — uniform scale + rotation + translation —
 * that lands the drawing on the held geometry. This is the cascade's PREFERRED method
 * over any printed scale: a stated scale is a claim about the original plot size and
 * breaks under "fit to page"/copier resize, whereas matching the drawing's own boundary
 * to surveyed ground truth is resize-proof.
 *
 * Two paths:
 *   • Equal vertex counts → exact vertex correspondence. We don't know which drawn
 *     vertex pairs with which surveyed one (the rings can start at a different corner
 *     and run the opposite way), so we try every rotation of the index × both winding
 *     directions, solve a closed-form least-squares similarity (Procrustes) for each,
 *     and keep the lowest landing error. Tight, sub-foot fits land here.
 *   • Unequal counts (one ring digitized more finely) → an oriented-bounding-box (OBB)
 *     fallback: match centroids, scale by √(area ratio), and pick the rotation (from the
 *     two rings' principal axes, ±90°/180°) that best overlays the outlines by
 *     nearest-vertex distance. Coarser, but a sane starting placement to refine by hand.
 *
 * Returns { ok, transform:{scale,rotDeg,apply}, residual, residualFrac, confident,
 * method, reason }. `residual` is the RMS landing error in feet; `residualFrac` is that
 * over the boundary's characteristic size (√area), so a high fraction flags a distorted
 * drawing that a rigid fit can't honor (a true rubber-sheet/affine would be needed).
 *
 * Self-contained on purpose: this lives in shared/ and must not import the site-planner
 * workspace, so it carries its own small Procrustes solve (mirrors overlayAlign.js's
 * solveSimilarityLSQ — the proven B73 math — kept in sync by the parallel tests).
 */

// RMS landing error over the boundary's √area, above which a rigid fit is "not confident".
export const CONFIDENT_FRAC = 0.02; // 2%

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/* Drop a ring's duplicated closing vertex (first ≈ last) so vertex counts compare cleanly. */
function normalizeRing(ring) {
  const pts = (ring || []).filter((p) => p && isFinite(p.x) && isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }));
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) pts.pop();
  }
  return pts;
}

function centroidOf(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/* Shoelace area magnitude (sign-independent — winding handled by the direction search). */
function areaOf(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* Closed-form least-squares similarity over paired points [{from,to}] (Procrustes).
 * Returns { scale, rotDeg, apply, residual } (residual = RMS feet) or null. Identical in
 * form to overlayAlign.solveSimilarityLSQ; duplicated here to keep shared/ self-contained. */
function solveSimilarity(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  let Px = 0, Py = 0, Qx = 0, Qy = 0;
  for (const { from, to } of pairs) { Px += from.x; Py += from.y; Qx += to.x; Qy += to.y; }
  const Pb = { x: Px / n, y: Py / n }, Qb = { x: Qx / n, y: Qy / n };
  let C = 0, S = 0, Spp = 0;
  for (const { from, to } of pairs) {
    const px = from.x - Pb.x, py = from.y - Pb.y, qx = to.x - Qb.x, qy = to.y - Qb.y;
    C += px * qx + py * qy;
    S += px * qy - py * qx;
    Spp += px * px + py * py;
  }
  if (!(Spp > 1e-12)) return null;
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

/* Principal-axis angle (radians) of a point set, from the 2×2 covariance. */
function principalAngle(pts, c) {
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/* Build a similarity transform from explicit (scale, angle, source→target centroid). */
function makeTransform(scale, angRad, srcC, tgtC) {
  const c = Math.cos(angRad), s = Math.sin(angRad);
  const apply = (pt) => {
    const dx = pt.x - srcC.x, dy = pt.y - srcC.y;
    return { x: tgtC.x + scale * (c * dx - s * dy), y: tgtC.y + scale * (s * dx + c * dy) };
  };
  return { scale, rotDeg: ((((angRad * 180) / Math.PI) % 360) + 360) % 360, apply };
}

/* Symmetric nearest-vertex RMS distance (feet) after applying a transform to source —
 * a vertex-count-independent fit measure for the OBB fallback. */
function nearestVertexRms(srcPts, tgtPts, apply) {
  const moved = srcPts.map(apply);
  const nearest = (p, set) => {
    let best = Infinity;
    for (const q of set) { const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (d < best) best = d; }
    return best;
  };
  let se = 0, cnt = 0;
  for (const p of moved) { se += nearest(p, tgtPts); cnt++; }
  for (const q of tgtPts) { se += nearest(q, moved); cnt++; }
  return Math.sqrt(se / cnt);
}

/* Main entry. source/target are rings of {x,y}; target is in world feet.
 * opts.confidentFrac overrides CONFIDENT_FRAC; opts.maxVertices caps the O(n²)
 * correspondence search (default 64) — above it, fall to the OBB path. */
export function fitToBoundary(source, target, opts = {}) {
  const confidentFrac = opts.confidentFrac != null ? opts.confidentFrac : CONFIDENT_FRAC;
  const maxVertices = opts.maxVertices || 64;

  const S = normalizeRing(source), T = normalizeRing(target);
  if (S.length < 3 || T.length < 3)
    return fail("Need at least 3 boundary vertices on both the drawing and the held parcel.");

  const tArea = areaOf(T);
  const charLen = Math.sqrt(tArea) || 1;
  const tgtC = centroidOf(T);

  // Path 1 — equal vertex counts: exact correspondence search (rotations × directions).
  if (S.length === T.length && S.length <= maxVertices) {
    const n = S.length;
    let best = null;
    for (const dir of [1, -1]) {
      for (let k = 0; k < n; k++) {
        const pairs = [];
        for (let i = 0; i < n; i++) {
          const j = dir === 1 ? (i + k) % n : ((k - i) % n + n) % n;
          pairs.push({ from: S[i], to: T[j] });
        }
        const sol = solveSimilarity(pairs);
        if (sol && (!best || sol.residual < best.residual)) best = sol;
      }
    }
    if (best) {
      const residualFrac = best.residual / charLen;
      return {
        ok: true,
        transform: { scale: best.scale, rotDeg: best.rotDeg, apply: best.apply },
        residual: best.residual,
        residualFrac,
        confident: residualFrac <= confidentFrac,
        method: "correspondence",
        reason: residualFrac <= confidentFrac
          ? "Drawing boundary matched the held parcel vertex-for-vertex."
          : `Best rigid fit leaves ${(residualFrac * 100).toFixed(1)}% landing error — the drawing may be distorted; verify or refine by hand.`,
      };
    }
  }

  // Path 2 — OBB fallback: centroids, √area scale, best of the principal-axis rotations.
  const srcC = centroidOf(S);
  const sArea = areaOf(S);
  if (!(sArea > 1e-12)) return fail("The drawing boundary has no area to fit.");
  const scale = Math.sqrt(tArea / sArea);
  const base = principalAngle(T, tgtC) - principalAngle(S, srcC);
  let best = null;
  for (const turn of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const tf = makeTransform(scale, base + turn, srcC, tgtC);
    const residual = nearestVertexRms(S, T, tf.apply);
    if (!best || residual < best.residual) best = { tf, residual };
  }
  const residualFrac = best.residual / charLen;
  return {
    ok: true,
    transform: best.tf,
    residual: best.residual,
    residualFrac,
    confident: residualFrac <= confidentFrac,
    method: "obb",
    reason: `Vertex counts differ (${S.length} vs ${T.length}); fit by outline orientation — a starting placement to verify or refine by hand.`,
  };
}

function fail(reason) {
  return { ok: false, transform: null, residual: null, residualFrac: null, confident: false, method: null, reason };
}
