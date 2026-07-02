/* lib/roadGeometry.js — pure, dependency-free road centerline geometry (B597 / NEW-2).
 *
 * A centerline road is stored as a polyline `pts:[{x,y}…]` plus a parallel per-vertex
 * treatment list `vtx:[{treatment, radius?}…]` (same length as `pts`; the two ENDPOINT
 * entries have no corner so they are ignored). `roadCenterline` turns that sparse,
 * clicked alignment into the DENSE, TESSELLATED polyline that is actually rendered —
 * which the surface/curb renderer then offsets symmetrically (bufferPolyline /
 * offsetPolyline in metesAndBounds.js, NO new geometry dependency, B598 / NEW-3).
 *
 * Per-INTERIOR-vertex treatment:
 *   • sharp  — hard corner; the vertex passes through unchanged (output == input).
 *   • arc    — circular fillet tangent to BOTH adjacent segments. The radius is
 *              feasibility-clamped so the tangent run-up T = R·tan(θ/2) (θ = the
 *              deflection / turn angle) never exceeds HALF the shorter adjacent
 *              segment — so two neighbouring corners can never overrun each other.
 *              The default treatment for a freshly-placed vertex.
 *   • smooth — the vertex is a THROUGH-point of a Catmull-Rom-style interpolating
 *              curve (tangent at the vertex derived from its neighbours), tessellated.
 *              For tracing a curve off an aerial.
 *
 * Frame-agnostic: works in feet, +y is south (the planner canvas frame), but nothing
 * here depends on the axis sign. No React, no canvas helpers — unit-tested in
 * test/roadGeometry.test.js. */

export const DEFAULT_TESS_DEG = 6;       // ~1 tessellation point per 6° of arc / curve
export const DEFAULT_ARC_RADIUS = 50;    // ft — fallback Arc radius when none is supplied
const EPS = 1e-9;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;

/* Total length (ft) of a polyline. */
export function polylineLength(pts) {
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len(sub(pts[i], pts[i - 1]));
  return L;
}

// Treatment for interior vertex i (1..N-2). Endpoints have no corner. An unspecified
// interior vertex defaults to "arc" (NEW-2's headline default); the drawing code writes
// an explicit treatment per vertex, and the rect→centerline migration produces only
// 2-point roads (no interior vertex), so this default never disturbs a migrated road.
function treatmentAt(vtx, i) {
  const t = vtx && vtx[i] && vtx[i].treatment;
  return t === "sharp" || t === "smooth" || t === "arc" ? t : "arc";
}
function radiusAt(vtx, i, fallback) {
  const r = vtx && vtx[i] && vtx[i].radius;
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

/* The dense tessellated points of an ARC fillet at vertex P between neighbours A and C.
 * Returns { entry, exit, pts } where `pts` runs entry→…→exit (inclusive). Falls back to
 * a sharp corner ({ entry:P, exit:P, pts:[P] }) when the geometry is degenerate. */
function arcCorner(A, P, C, radius, tessDeg) {
  const vA = sub(A, P), vC = sub(C, P);
  const lA = len(vA), lC = len(vC);
  if (lA < EPS || lC < EPS) return { entry: P, exit: P, pts: [P] };
  const u1 = mul(vA, 1 / lA);              // unit P→A
  const u2 = mul(vC, 1 / lC);              // unit P→C
  let cosPhi = dot(u1, u2);
  cosPhi = Math.max(-1, Math.min(1, cosPhi));
  const phi = Math.acos(cosPhi);           // interior angle between the two segments
  const theta = Math.PI - phi;             // deflection / turn angle
  // Nearly straight (θ≈0) or folded back on itself (θ≈π) → no usable fillet, keep sharp.
  if (theta < 1e-4 || theta > Math.PI - 1e-4) return { entry: P, exit: P, pts: [P] };
  const tanHalf = Math.tan(theta / 2);
  // Feasibility clamp: the run-up T must not exceed half the shorter adjacent segment.
  const maxT = 0.5 * Math.min(lA, lC);
  let T = radius * tanHalf;
  if (T > maxT) T = maxT;
  const R = T / tanHalf;                    // radius actually used after the clamp
  if (!(R > EPS) || !(T > EPS)) return { entry: P, exit: P, pts: [P] };
  const entry = add(P, mul(u1, T));         // tangent point on the A side
  const exit = add(P, mul(u2, T));          // tangent point on the C side
  // Centre lies on the bisector, distance R/sin(phi/2) = R/cos(theta/2) from P.
  const bis = unit(add(u1, u2));
  const dCentre = R / Math.cos(theta / 2);
  const centre = add(P, mul(bis, dCentre));
  let a0 = Math.atan2(entry.y - centre.y, entry.x - centre.x);
  let a1 = Math.atan2(exit.y - centre.y, exit.x - centre.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;   // sweep the short way (|da| == theta)
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(da) * 180) / Math.PI / tessDeg));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (da * k) / n;
    pts.push({ x: centre.x + R * Math.cos(a), y: centre.y + R * Math.sin(a) });
  }
  return { entry, exit, pts };
}

// Cubic Hermite interpolation between p0 (tangent m0) and p1 (tangent m1), n steps.
// Returns points p0…p1 inclusive. Interpolates the endpoints EXACTLY (so a smoothed
// vertex is always present in the output — "the spline passes through its points").
function hermite(p0, p1, m0, m1, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out.push({
      x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
      y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    });
  }
  return out;
}

/* A SMOOTH corner at vertex P (neighbours A, C): a curve that PASSES THROUGH P with a
 * Catmull-Rom tangent (∝ C−A), blending the incoming and outgoing segments. Consumes up
 * to half of each adjacent segment (same no-overrun guarantee as the arc). */
function smoothCorner(A, P, C, tessDeg) {
  const vA = sub(A, P), vC = sub(C, P);
  const lA = len(vA), lC = len(vC);
  if (lA < EPS || lC < EPS) return { entry: P, exit: P, pts: [P] };
  const dirIn = unit(sub(P, A));            // travel direction into P
  const dirOut = unit(sub(C, P));           // travel direction out of P
  const d1 = 0.5 * lA, d2 = 0.5 * lC;       // entry/exit anchors at the segment midpoints
  const S = add(P, mul(unit(vA), d1));      // on the A side, before P
  const E = add(P, mul(unit(vC), d2));      // on the C side, after P
  const mDir = unit(sub(C, A));             // Catmull-Rom tangent direction at P
  const nA = Math.max(2, Math.ceil((d1 / Math.max(d1, d2)) * 6) + tessDeg);
  const nB = Math.max(2, Math.ceil((d2 / Math.max(d1, d2)) * 6) + tessDeg);
  // Half 1: S→P, tangent S along the incoming segment, tangent P along mDir.
  const h1 = hermite(S, P, mul(dirIn, 2 * d1), mul(mDir, 2 * d1), nA);
  // Half 2: P→E, tangent P along mDir, tangent E along the outgoing segment.
  const h2 = hermite(P, E, mul(mDir, 2 * d2), mul(dirOut, 2 * d2), nB);
  return { entry: S, exit: E, pts: [...h1, ...h2.slice(1)] };
}

/* Drop consecutive duplicate points (within `tol` ft). */
function dedupe(pts, tol = 1e-6) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) out.push(p);
  }
  return out;
}

/* roadCenterline(pts, vtx, opts) — the rendered, tessellated centerline.
 *
 *   pts  — the clicked alignment (≥2 points).
 *   vtx  — parallel per-vertex treatment list (optional; defaults to "arc" per interior).
 *   opts.defaultRadius — Arc radius for a vertex that carries none (the class default).
 *   opts.tessDeg       — degrees of arc per tessellation step (smaller = denser).
 *
 * A 2-point road returns its two points unchanged (the degenerate "straight road" — it
 * MUST render identically to the legacy rect road). Sharp-only input returns the input
 * polyline. Every corner consumes at most half of each adjacent segment, so the dense
 * result is always simple (no self-overlap from neighbouring corners). */
export function roadCenterline(pts, vtx, opts = {}) {
  const clean = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) return clean.map((p) => ({ x: p.x, y: p.y }));
  if (clean.length === 2) return [{ x: clean[0].x, y: clean[0].y }, { x: clean[1].x, y: clean[1].y }];
  const tessDeg = opts.tessDeg > 0 ? opts.tessDeg : DEFAULT_TESS_DEG;
  const defR = opts.defaultRadius > 0 ? opts.defaultRadius : DEFAULT_ARC_RADIUS;
  const N = clean.length;
  // Per interior vertex, compute its corner geometry (entry anchor, dense pts, exit anchor).
  const corners = [];
  for (let i = 1; i < N - 1; i++) {
    const A = clean[i - 1], P = clean[i], C = clean[i + 1];
    const t = treatmentAt(vtx, i);
    if (t === "arc") corners.push(arcCorner(A, P, C, radiusAt(vtx, i, defR), tessDeg));
    else if (t === "smooth") corners.push(smoothCorner(A, P, C, tessDeg));
    else corners.push({ entry: P, exit: P, pts: [P] }); // sharp
  }
  // Stitch: start point → straight to corner1.entry → corner1 dense → straight to
  // corner2.entry → … → straight to end point.
  const out = [{ x: clean[0].x, y: clean[0].y }];
  for (let i = 0; i < corners.length; i++) {
    for (const p of corners[i].pts) out.push({ x: p.x, y: p.y });
  }
  out.push({ x: clean[N - 1].x, y: clean[N - 1].y });
  return dedupe(out);
}

/* The minimum radius of curvature (ft) anywhere along a dense polyline — the circumradius
 * of each consecutive triple of points (a nearly-straight triple → ∞, ignored). Used by
 * the non-blocking civil min-radius check (B599 / NEW-4): it measures the RESULTING
 * alignment, so it works uniformly for arc fillets and traced/smooth runs. Returns
 * Infinity for a straight or <3-point line. */
export function minRadiusOfCurvature(dense) {
  const pts = dedupe(dense || [], 1e-6);
  if (pts.length < 3) return Infinity;
  let min = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ab = len(sub(b, a)), bc = len(sub(c, b)), ca = len(sub(a, c));
    const area2 = Math.abs(cross(sub(b, a), sub(c, a))); // 2·triangle area
    if (area2 < EPS) continue;                            // collinear → infinite radius
    const R = (ab * bc * ca) / (2 * area2);               // circumradius
    if (R < min) min = R;
  }
  return min;
}

/* Convenience: the min radius of curvature of a road's tessellated centerline, taking the
 * raw `pts`/`vtx` directly. */
export function roadMinRadius(pts, vtx, opts = {}) {
  return minRadiusOfCurvature(roadCenterline(pts, vtx, opts));
}
