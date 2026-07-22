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

/* ---- Control-point add/remove on a centerline road (B718) ----------------------------
 * A centerline road carries a `pts` alignment and a PARALLEL `vtx` treatment list (same
 * length; endpoints `{}`, interior `{treatment,radius?}`). These two pure helpers keep the
 * arrays in lock-step so the on-canvas add/remove (which reuses the shared B230 vertex
 * engine) can't desync them. Kept here — the module that already owns pts/vtx semantics —
 * so the splice/guard logic is unit-tested, not buried in the React component. */

// Normalize a possibly-short/absent vtx list to the same length as pts (endpoints/missing → {}).
function normVtx(pts, vtx) {
  const n = (pts || []).length;
  const out = [];
  for (let i = 0; i < n; i++) out.push((vtx && vtx[i]) || {});
  return out;
}

/* Insert a control point `pt` into the alignment, splitting the segment `edgeIndex`
 * (0-based, between pts[edgeIndex] and pts[edgeIndex+1]). Returns fresh `{ pts, vtx }`
 * with a matching `{}` treatment entry spliced in at the same index — a new INTERIOR
 * vertex, so `treatmentAt` resolves it to the default "arc" (which renders straight until
 * dragged, because the inserted point is collinear on its sparse segment → no jump).
 * Returns `null` when the edge index is out of range. */
export function insertRoadVertex(pts, vtx, edgeIndex, pt) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  if (!(edgeIndex >= 0 && edgeIndex < pts.length - 1)) return null;
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  const at = edgeIndex + 1;
  const nextPts = [...pts];
  nextPts.splice(at, 0, { x: pt.x, y: pt.y });
  const nextVtx = normVtx(pts, vtx);
  nextVtx.splice(at, 0, {});
  return { pts: nextPts, vtx: nextVtx, index: at };
}

/* Remove control point `index` from the alignment. Returns fresh `{ pts, vtx }`, or `null`
 * (a no-op) when the removal is disallowed: an ENDPOINT (index 0 or last) or a road already
 * at the 2-point minimum. Guards exactly the two conditions in the brief — "never remove an
 * endpoint, never drop below 2 points." */
export function removeRoadVertex(pts, vtx, index) {
  if (!Array.isArray(pts) || pts.length <= 2) return null;
  if (!(index > 0 && index < pts.length - 1)) return null; // interior only (blocks endpoints)
  const nextPts = pts.filter((_, j) => j !== index);
  const nextVtx = normVtx(pts, vtx).filter((_, j) => j !== index);
  return { pts: nextPts, vtx: nextVtx };
}

/* Whether control point `index` of a road may be removed (drives the context menu's
 * enabled/"min reached" state). Interior-only + above the 2-point minimum. */
export function canRemoveRoadVertex(pts, index) {
  return Array.isArray(pts) && pts.length > 2 && index > 0 && index < pts.length - 1;
}

/* ---- Snap-and-connect road endpoints (NEW-1) -----------------------------------------
 * A dragged road ENDPOINT (or a new road's final point) that lands near another road's
 * endpoint magnetically welds to it on release, forming a clean junction. Pure geometry:
 * the React layer supplies the screen-pixel tolerance, the Snap-toggle/Alt gating, and the
 * highlight; this module owns the candidate search and the pts/vtx surgery so the merge /
 * weld / tee decision is unit-tested, never buried in the component.
 *
 * Three outcomes (planRoadConnect):
 *   • merge — an unambiguous end-to-end meet of two MATCHING roads (same class + travel width
 *             + curb) → concatenate into ONE polyline; the join point becomes an interior
 *             vertex seeded with the class-default arc treatment (a real corner NEW-2 can round).
 *   • weld  — endpoints of DIFFERING roads meet (or the two ends of the SAME road close a loop)
 *             → both roads keep their identity, sharing the exact join coordinate.
 *   • tee   — an endpoint lands on another road's INTERIOR (a T/Y) → weld onto the nearest
 *             centerline point and insert a control vertex there on the through road (B718 engine).
 */

// Nearest point on segment a→b to point p (clamped to the segment). Pure, module-local.
function nearestOnSeg(p, a, b) {
  const d = sub(b, a);
  const L2 = dot(d, d) || 1;
  let t = dot(sub(p, a), d) / L2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

/* Two roads can MERGE into one polyline iff they share a road class and match on travel width
 * and curb (within `tol` ft). Differing roads stay separate (welded at the shared node). */
export function roadsMergeCompatible(a, b, tol = 0.5) {
  if (!a || !b) return false;
  if ((a.roadClass || "") !== (b.roadClass || "")) return false;
  if (Math.abs((+a.travelW || 0) - (+b.travelW || 0)) > tol) return false;
  if (Math.abs((+a.curb || 0) - (+b.curb || 0)) > tol) return false;
  return true;
}

/* Find the nearest connectable target for a moving endpoint at `movePt`.
 *   roads   — candidate roads [{ id, pts, halfW? }] (centerline roads only; the caller excludes
 *             dock-bonded rect roads, which have no `pts`). MAY include the moving road itself
 *             (for closing a loop) — `exclude` skips only the moving vertex. `halfW` (travelW/2 +
 *             curb) is the distance from the centerline to the OUTER pavement edge (back of curb).
 *   exclude — { id, index } of the moving vertex (never a candidate → "never snap to itself").
 *   opts.tolFt        — world tolerance (ft), measured to the pavement EDGE (B961/NEW-3), not the
 *             hidden centerline: the effective centerline tolerance is `tolFt + halfW`, so you connect
 *             by bringing the point to the visible curb line. The hit still RESOLVES to the centerline
 *             (endpoint weld / tee vertex). `dist` is the edge distance, so it compares fairly with a
 *             parking/court edge hit. The caller sets tolFt = min(screen-px budget, world Snap cap).
 *   opts.allowInterior — also consider a T/Y onto another road's centerline (endpoint→interior).
 * Returns the nearest hit within tolerance, endpoints preferred on ties (an interior projection
 * that coincides with an endpoint defers to the endpoint case), or null. */
export function findRoadConnect(movePt, exclude, roads, opts = {}) {
  if (!movePt || !Number.isFinite(movePt.x) || !Number.isFinite(movePt.y)) return null;
  const tolFt = opts.tolFt > 0 ? opts.tolFt : 10;
  const list = Array.isArray(roads) ? roads : [];
  let best = null;
  // Endpoint candidates (both ends of every road), skipping the moving vertex itself. Distance is
  // measured to the CENTERLINE but the tolerance and the returned `dist` are EDGE-relative (B961).
  for (const r of list) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2) continue;
    const hw = r.halfW > 0 ? r.halfW : 0;
    const last = r.pts.length - 1;
    for (const idx of last === 0 ? [0] : [0, last]) {
      if (exclude && r.id === exclude.id && idx === exclude.index) continue;
      const p = r.pts[idx];
      const d = Math.hypot(p.x - movePt.x, p.y - movePt.y);
      const edgeD = Math.max(0, d - hw);
      if (d <= tolFt + hw && (!best || edgeD < best.dist)) best = { roadId: r.id, kind: "endpoint", index: idx, pt: { x: p.x, y: p.y }, dist: edgeD };
    }
  }
  // Interior (T/Y) candidates — only on OTHER roads, and only when strictly closer than any
  // endpoint hit (so a near-endpoint press connects end-to-end, not as a tee beside it).
  if (opts.allowInterior) {
    for (const r of list) {
      if (!r || !Array.isArray(r.pts) || r.pts.length < 2) continue;
      if (exclude && r.id === exclude.id) continue;          // never tee onto self
      const hw = r.halfW > 0 ? r.halfW : 0;
      const last = r.pts.length - 1;
      for (let i = 0; i < last; i++) {
        const q = nearestOnSeg(movePt, r.pts[i], r.pts[i + 1]);
        const d = Math.hypot(q.x - movePt.x, q.y - movePt.y);
        const edgeD = Math.max(0, d - hw);
        if (d > tolFt + hw || (best && edgeD >= best.dist - 1e-6)) continue;
        // Defer to the endpoint pass when the projection lands within (edge) tolerance of either end —
        // near a road's end you want a clean end-to-end join, not a tee just inside it.
        const nearEnd = Math.hypot(q.x - r.pts[0].x, q.y - r.pts[0].y) <= tolFt + hw ||
                        Math.hypot(q.x - r.pts[last].x, q.y - r.pts[last].y) <= tolFt + hw;
        if (!nearEnd) best = { roadId: r.id, kind: "interior", index: i, pt: { x: q.x, y: q.y }, dist: edgeD };
      }
    }
  }
  return best;
}

/* Concatenate road A (its shared endpoint at `aIndex` ∈ {0,last}) with road B (shared endpoint
 * `bIndex` ∈ {0,last}) into ONE alignment that keeps A's identity. The shared point becomes a
 * single INTERIOR vertex seeded with `joinRadius` (class-default arc). Returns { pts, vtx,
 * joinIndex } or null when either endpoint index is not an actual endpoint. */
export function concatRoads(aPts, aVtx, aIndex, bPts, bVtx, bIndex, joinRadius) {
  if (!Array.isArray(aPts) || !Array.isArray(bPts) || aPts.length < 2 || bPts.length < 2) return null;
  const aLast = aPts.length - 1, bLast = bPts.length - 1;
  if (aIndex !== 0 && aIndex !== aLast) return null;
  if (bIndex !== 0 && bIndex !== bLast) return null;
  let ap = aPts.map((p) => ({ x: p.x, y: p.y })), av = normVtx(aPts, aVtx);
  if (aIndex === 0) { ap.reverse(); av.reverse(); }          // orient A so the shared point is LAST
  let bp = bPts.map((p) => ({ x: p.x, y: p.y })), bv = normVtx(bPts, bVtx);
  if (bIndex === bLast) { bp.reverse(); bv.reverse(); }      // orient B so the shared point is FIRST
  const joinIndex = ap.length - 1;
  const pts = ap.concat(bp.slice(1));
  const vtx = av.concat(bv.slice(1)).map((v) => ({ ...(v || {}) }));
  vtx[joinIndex] = { treatment: "arc", radius: joinRadius > 0 ? joinRadius : DEFAULT_ARC_RADIUS };
  return { pts, vtx, joinIndex };
}

/* Decide + build the connect action for a moving road endpoint welding onto `candidate`.
 *   movingEl / targetEl — { pts, vtx, id, roadClass, travelW, curb }.
 *   movingIndex         — the moving endpoint (0 or last) being welded.
 *   candidate           — a findRoadConnect() hit ({ roadId, kind, index, pt }).
 *   joinRadius          — the merged road's class-default arc radius (merge only).
 * Returns one of:
 *   { action:"merge", moving:{pts,vtx}, deleteTarget:true }        — target absorbed into moving
 *   { action:"weld",  moving:{pts,vtx} }                           — endpoints share a coord; both kept
 *   { action:"tee",   moving:{pts,vtx}, target:{pts,vtx} }         — endpoint onto interior; vertex inserted
 * or null when the inputs are unusable. Callers own the id bookkeeping (delete/patch). */
export function planRoadConnect(movingEl, movingIndex, targetEl, candidate, joinRadius) {
  if (!movingEl || !Array.isArray(movingEl.pts) || !candidate) return null;
  const mPts = movingEl.pts, mLast = mPts.length - 1;
  if (movingIndex !== 0 && movingIndex !== mLast) return null;
  const weldPt = candidate.pt;
  const weldMoving = () => ({
    pts: mPts.map((p, i) => (i === movingIndex ? { x: weldPt.x, y: weldPt.y } : { x: p.x, y: p.y })),
    vtx: normVtx(mPts, movingEl.vtx),
  });
  if (candidate.kind === "interior") {
    if (!targetEl || !Array.isArray(targetEl.pts)) return null;
    const ins = insertRoadVertex(targetEl.pts, targetEl.vtx, candidate.index, weldPt);
    if (!ins) return { action: "weld", moving: weldMoving() };   // out-of-range → fall back to a plain weld
    return { action: "tee", moving: weldMoving(), target: { pts: ins.pts, vtx: ins.vtx } };
  }
  // Endpoint candidate: merge two MATCHING, DIFFERENT roads end-to-end; else weld (incl. loop close).
  const sameRoad = targetEl && candidate.roadId === movingEl.id;
  if (!sameRoad && targetEl && roadsMergeCompatible(movingEl, targetEl)) {
    const merged = concatRoads(mPts, movingEl.vtx, movingIndex, targetEl.pts, targetEl.vtx, candidate.index, joinRadius);
    if (merged) return { action: "merge", moving: { pts: merged.pts, vtx: merged.vtx }, deleteTarget: true, joinIndex: merged.joinIndex };
  }
  return { action: "weld", moving: weldMoving() };
}

/* ---- Auto-fix sub-minimum road radius (NEW-2) ----------------------------------------
 * Upgrade the B602 min-radius CHECK from warn-only to a corrective ACTION. Adjusts the road's
 * per-vertex arc treatments — and, where a corner is pinched, a small bounded vertex nudge — so
 * the rendered centerline meets the class minimum, matching B602's own measurement
 * (`minRadiusOfCurvature(roadCenterline(pts,vtx))`). Radius/treatment stay per-vertex parametric
 * and editable; a later vertex drag re-solves. Tiers, greedy from the tightest corner outward:
 *   1  run-up room       → set an Arc at the feasible target radius (class default, clamped down
 *                          toward the floor only as the adjacent segments allow).
 *   3  pinched corner    → a small BOUNDED nudge of the vertex toward the A–C chord opens the
 *                          deflection until the min radius fits (a run of adjacent tight corners is
 *                          handled by nudging its members greedily — no separate spline pass).
 *   4  truly impossible  → fixed endpoints too close for any min-radius arc; left as a LOCATED
 *                          residual ({ index, reason }) for a specific, placed warning — never a blanket flag.
 * Sharp corners read as ∞ (a hard corner is not a "sub-min radius" in this model — matches B602
 * not flagging hard corners) so a deliberate sharp corner is left alone. Truck off-tracking /
 * swept-path widening is explicitly out of scope for v1. External-element collision on a tier-3
 * nudge is not checked here (the nudge is bounded small + kept from self-folding); the caller
 * decides whether to surface that.
 * Returns { pts, vtx, fixed:[idx…], residual:[{index,reason,achievable}…], changed }. */
export function fixRoadRadii(pts, vtx, threshold, opts = {}) {
  const clean = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const N = clean.length;
  const passthrough = { pts: (pts || []).map((p) => ({ x: p.x, y: p.y })), vtx: normVtx(pts || [], vtx), fixed: [], residual: [], changed: false };
  if (N < 3 || !(threshold > 0)) return passthrough;
  const target = opts.targetRadius > 0 ? opts.targetRadius : threshold;
  const tessDeg = opts.tessDeg > 0 ? opts.tessDeg : DEFAULT_TESS_DEG;
  const allowNudge = opts.allowNudge !== false;
  const work = clean.map((p) => ({ x: p.x, y: p.y }));
  const wvtx = normVtx(clean, vtx);
  const fixed = new Set();
  const residual = [];

  // The radius corner i currently contributes, measured the way B602 does (the rendered local
  // triple). Sharp corners → ∞ (deliberate hard corners are not "sub-min radius" here).
  const cornerR = (i) => {
    if (treatmentAt(wvtx, i) === "sharp") return Infinity;
    const local = roadCenterline([work[i - 1], work[i], work[i + 1]], [{}, wvtx[i], {}], { defaultRadius: target, tessDeg });
    return minRadiusOfCurvature(local);
  };
  // Max feasible arc radius at i given the current adjacent SPARSE segments + deflection.
  const feasR = (i) => {
    const A = work[i - 1], P = work[i], C = work[i + 1];
    const vA = sub(A, P), vC = sub(C, P);
    const lA = len(vA), lC = len(vC);
    if (lA < EPS || lC < EPS) return Infinity;
    const cosPhi = Math.max(-1, Math.min(1, dot(mul(vA, 1 / lA), mul(vC, 1 / lC))));
    const theta = Math.PI - Math.acos(cosPhi);
    if (theta < 1e-4) return Infinity;                     // ~straight → no corner
    return (0.5 * Math.min(lA, lC)) / Math.tan(theta / 2);
  };
  // Foot of the perpendicular from P onto the infinite line A→C (the nudge target direction).
  const perpFoot = (P, A, C) => {
    const d = sub(C, A), L2 = dot(d, d) || 1;
    const t = dot(sub(P, A), d) / L2;
    return add(A, mul(d, t));
  };

  // Tier 1 — set every violating arc/smooth corner to an arc at the feasible target radius.
  // Point positions are untouched here, so the corners are independent.
  for (let i = 1; i < N - 1; i++) {
    if (cornerR(i) >= threshold - 1e-6) continue;          // already fine, or a sharp corner → leave
    const maxR = feasR(i);
    wvtx[i] = { treatment: "arc", radius: Math.min(target, maxR) };
    if (maxR >= threshold - 1e-6) fixed.add(i);
  }

  // Tier 3 — bounded vertex nudge for corners the arc alone can't reach (segments too short).
  if (allowNudge) {
    let guard = 0;
    while (guard++ < N * 3) {
      let worst = -1, worstR = Infinity;
      for (let i = 1; i < N - 1; i++) {
        if (fixed.has(i) || residual.some((r) => r.index === i)) continue;
        if (feasR(i) >= threshold - 1e-6) continue;         // arc alone suffices (handled in tier 1)
        const r = cornerR(i);
        if (r < worstR) { worstR = r; worst = i; }
      }
      if (worst < 0) break;
      const i = worst, A = work[i - 1], P = work[i], C = work[i + 1];
      const foot = perpFoot(P, A, C);
      const toFoot = sub(foot, P), dFoot = len(toFoot);
      const cap = Math.min(
        opts.maxNudgeFt > 0 ? opts.maxNudgeFt : Infinity,
        0.9 * dFoot,                                        // stop short of the chord (never fold/cross it)
      );
      if (!(cap > EPS)) { residual.push({ index: i, reason: "segments too short", achievable: feasR(i) }); continue; }
      const dir = mul(toFoot, 1 / (dFoot || 1));
      let applied = 0;
      for (let s = 1; s <= 12; s++) {
        const dcand = (cap * s) / 12;
        const saved = work[i];
        work[i] = add(P, mul(dir, dcand));
        const ok = feasR(i) >= threshold - 1e-6;
        work[i] = saved;
        if (ok) { applied = dcand; break; }
      }
      if (applied > 0) {
        work[i] = add(P, mul(dir, applied));
        wvtx[i] = { treatment: "arc", radius: Math.min(target, feasR(i)) };
        fixed.add(i);
      } else {
        wvtx[i] = { treatment: "arc", radius: Math.min(target, feasR(i)) }; // best-effort widest arc
        residual.push({ index: i, reason: "segments too short", achievable: feasR(i) });
      }
    }
  } else {
    for (let i = 1; i < N - 1; i++) {
      if (fixed.has(i)) continue;
      if (feasR(i) < threshold - 1e-6 && cornerR(i) < threshold - 1e-6) residual.push({ index: i, reason: "segments too short", achievable: feasR(i) });
    }
  }

  // Final verification against the real rendered centerline (a neighbour's nudge can re-tighten a
  // corner tier 1 thought fixed): demote any still-violating "fixed" corner to a located residual.
  for (const i of [...fixed]) {
    if (cornerR(i) < threshold - 1e-6) {
      fixed.delete(i);
      if (!residual.some((r) => r.index === i)) residual.push({ index: i, reason: "segments too short", achievable: feasR(i) });
    }
  }

  return {
    pts: work,
    vtx: wvtx,
    fixed: [...fixed].sort((a, b) => a - b),
    residual: residual.sort((a, b) => a.index - b.index),
    changed: fixed.size > 0 || residual.length > 0,
  };
}

/* ---- Clean T-intersection geometry at a road tee (B953/NEW-1) -------------------------
 * When a road tees into another (the B945/B949 tee: a side road's endpoint welded onto a
 * through road's centerline), render a real intersection instead of the side road's pavement
 * strip butting into the through road. This pure module computes, in world feet:
 *   • two CURB RETURN fillets (tangent arcs) rounding the corners where the side road's
 *     pavement edges meet the through road's near edge — radius from the road class, clamped;
 *   • a WIDENED THROAT (the return radii push the opening on the through road wider than the
 *     side road's pavement; an extra `flare` widens it further);
 *   • a merged pavement COVER polygon (opaque) that unifies the junction and hides the raw
 *     butting curbs (through near-curb across the throat + the side road's mouth curbs), so the
 *     caller redraws only the clean returns on top;
 *   • the throat span on the through road whose near curb must be INTERRUPTED.
 * The renderer supplies screen scale; this owns the geometry so tangency / throat / clamp are
 * unit-tested. v1 scope: the T/Y tee (one road into another's side); 4-way + heavy skew deferred.
 * A very acute tee clamps the returns (down to a near-sharp corner) so pavement never self-crosses. */

// Intersection of two infinite lines (point p1 dir d1) × (point p2 dir d2). Null if parallel.
function lineX(p1, d1, p2, d2) {
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}
const leftNormal = (d) => ({ x: -d.y, y: d.x }); // rotate +90°

/* A fillet of radius R in the wedge at corner P between unit ray dirs u1,u2. Returns
 * { R, t, tan1, tan2, arc } (t = corner→tangent distance along each ray) or null if degenerate. */
function rayFillet(P, u1, u2, R, tessDeg) {
  const c = Math.max(-1, Math.min(1, dot(u1, u2)));
  const phi = Math.acos(c);                       // wedge angle between the rays
  if (phi < 1e-3 || phi > Math.PI - 1e-3) return null; // straight / folded → no fillet
  const half = phi / 2;
  const t = R / Math.tan(half);                    // tangent length from the corner
  const tan1 = add(P, mul(u1, t));
  const tan2 = add(P, mul(u2, t));
  const bis = unit(add(u1, u2));
  const centre = add(P, mul(bis, R / Math.sin(half)));
  let a0 = Math.atan2(tan1.y - centre.y, tan1.x - centre.x);
  const a1 = Math.atan2(tan2.y - centre.y, tan2.x - centre.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(da) * 180) / Math.PI / (tessDeg > 0 ? tessDeg : DEFAULT_TESS_DEG)));
  const arc = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (da * k) / n; arc.push({ x: centre.x + R * Math.cos(a), y: centre.y + R * Math.sin(a) }); }
  return { R, t, tan1, tan2, arc, centre };
}

/* teeGeometry(params) — the clean-tee primitives.
 *   T          — the tee point (side endpoint on the through centerline).
 *   throughDir — unit tangent of the through centerline at T.
 *   sideDir    — unit direction of the side road at T, pointing INTO the side road body.
 *   phT, phS   — through / side pavement half-widths (travelW/2, face of curb).
 *   R          — desired curb return radius (class turning radius). flare — extra throat widening (ft).
 *   curbT, curbS — curb band widths (so the cover hides the back-of-curb edge rings too).
 *   throughAvail — min distance the through road runs each way from T (clamps the returns).
 *   sideAvail  — distance the side road runs from T (clamps the returns).
 * Returns { R, throatWidth, throughTangents:[a,b], sideTangents:[a,b], returns:[arcA,arcB],
 *           cover:[polygon], throatMid, nTee } or null when it isn't a real tee (side ∥ through). */
export function teeGeometry(params) {
  const {
    T, throughDir, sideDir, phT, phS, R, flare = 0,
    curbT = 0, curbS = 0, throughAvail = Infinity, sideAvail = Infinity, tessDeg = DEFAULT_TESS_DEG,
  } = params || {};
  if (!T || !throughDir || !sideDir || !(phT >= 0) || !(phS >= 0)) return null;
  const u = unit(throughDir), d = unit(sideDir);
  const nrm = leftNormal(u);
  const sideSign = Math.sign(dot(d, nrm));
  if (sideSign === 0) return null;                  // side road parallel to the through road → not a tee
  const nTee = mul(nrm, sideSign);                  // unit normal from through centerline toward the side road
  const perpS = leftNormal(d);
  const E0 = add(T, mul(nTee, phT));                // mouth centre on the through near (face-of-curb) edge
  const phSm = phS + Math.max(0, flare);            // flared mouth half-width
  // The side road's two flared face edges, and where each meets the through near edge (the corners).
  const cornerA = lineX(add(T, mul(perpS, phSm)), d, E0, u);
  const cornerB = lineX(add(T, mul(perpS, -phSm)), d, E0, u);
  if (!cornerA || !cornerB) return null;
  const tMax = Math.max(0, Math.min(throughAvail, sideAvail) * 0.9);
  // Fillet one corner: rays go ALONG the through edge away from the throat, and ALONG the side edge
  // into the body. Clamp R down so the tangent run fits the available road (acute angle → tiny arc).
  const fillet = (corner) => {
    const awayThrough = mul(u, Math.sign(dot(sub(corner, E0), u)) || 1);
    const cAng = Math.max(-1, Math.min(1, dot(awayThrough, d)));
    const phi = Math.acos(cAng);
    if (phi < 1e-3 || phi > Math.PI - 1e-3) return { tan1: corner, tan2: corner, arc: [corner], R: 0, t: 0, centre: null };
    let Rc = R > 0 ? R : 0;
    let f = rayFillet(corner, awayThrough, d, Rc, tessDeg);
    if (f && f.t > tMax && tMax > EPS) { Rc = tMax * Math.tan(phi / 2); f = rayFillet(corner, awayThrough, d, Rc, tessDeg); }
    if (!f || !(Rc > EPS)) return { tan1: corner, tan2: corner, arc: [corner], R: 0, t: 0, centre: null }; // degenerate → sharp corner
    return f;
  };
  const fA = fillet(cornerA);
  const fB = fillet(cornerB);
  // Cover polygon (B962 rewrite). The old code inserted perpendicular "ears" (outA/outB) at the mouth,
  // whose polygon order folded back on itself — a spike + concave notch + a self-overlapping top edge
  // (a star/blob). A curb return is LEGITIMATELY concave where it rounds the reflex corner between the
  // two roads, so the apron is NOT convex — the fix is a SIMPLE, SMOOTH outline with no fold-back cusps.
  // Walk: throat-left (on the through/court edge, pushed a hair INTO that pavement) → left return fillet
  // (the exact face arc) → mouth-left (up the side road AND out to back-of-curb) → mouth-right → right
  // return fillet → throat-right. The mouth corners extend ALONG the side road (never a perpendicular
  // ear), so the outline can't fold back; the small into-court / up-road / out-to-curb pushes make the
  // opaque fill reach back-of-curb on every side → it hides each butting edge stroke (seamless). The
  // return arcs are still drawn on top at the pavement FACE (the visible curb line).
  const mT = curbT * 1.75 + 0.05, mS = curbS * 1.75 + 0.05;
  const intoThrough = mul(nTee, -mT);                        // push the throat edge INTO the through/court pavement, past its near curb
  // The mouth is the DIRECT edge between the two return tangent points (tan2_A → tan2_B): the cover's
  // interior already includes the side road's wedge below the tangent height, so it overlaps the road
  // strip (same fill) — no collar, hence no fold-back cusp at any tee angle. The road strip (opaque, to
  // back-of-curb) covers the road part; this covers the throat + flares + the wedge, hiding the butting
  // cap/curb strokes across the junction. (An up-the-road "collar" folded back on a skewed tee — B962.)
  const cover = [
    add(fA.tan1, intoThrough),
    ...fA.arc,                                              // left return (face fillet), tan1 → tan2
    ...[...fB.arc].reverse(),                               // right return (face fillet), tan2 → tan1 (mouth = the tan2_A→tan2_B edge between them)
    add(fB.tan1, intoThrough),
  ];
  // STEM — the side road's real (un-flared) pavement footprint where it overlaps INTO the through
  // road (from the near edge down to just past the tee point). Filling it opaque hides the side
  // road's curb stubs that otherwise draw across the through pavement (the little "box" at the mouth).
  const realCornerA = lineX(add(T, mul(perpS, phS)), d, E0, u);
  const realCornerB = lineX(add(T, mul(perpS, -phS)), d, E0, u);
  const stem = (realCornerA && realCornerB) ? [
    add(realCornerA, mul(perpS, mS)),
    add(realCornerB, mul(perpS, -mS)),
    add(add(T, mul(perpS, -(phS + mS))), mul(nTee, -mS)),
    add(add(T, mul(perpS, phS + mS)), mul(nTee, -mS)),
  ] : null;
  const throatWidth = len(sub(fA.tan1, fB.tan1));
  return {
    R: Math.max(fA.R, fB.R),
    throatWidth,
    throughTangents: [fA.tan1, fB.tan1],
    sideTangents: [fA.tan2, fB.tan2],
    returns: [fA.arc, fB.arc],
    cover,
    stem,
    throatMid: E0,
    nTee,
  };
}

/* ---- Road → parking-drive / truck-court connect targets (B955/NEW-1) ------------------
 * A road can tee not only into another road (teeGeometry) but into a PARKING field's drive-aisle
 * mouth or a TRUCK COURT's access edge. Those are rectangle elements, so the connect TARGET is one
 * of the rectangle's edges (the one facing the road). The intersection itself reuses teeGeometry —
 * the target edge plays the "through" edge (half-width 0, no through curb to interrupt) and the
 * return radius scales by target type (car ≈ 20 ft for a parking drive, truck ≈ 50 ft + a wide
 * throat flare for a dock-court drive). These two pure helpers own the rectangle-edge math. */

/* The 4 world-space edges of a rect element {cx,cy,w,h,rot}. Each edge =
 * { a, b, dir (unit a→b), outN (unit outward normal, away from centre), mid, len, axis, sign }. */
export function rectEdges(cx, cy, w, h, rot = 0) {
  const rad = (rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const rp = (x, y) => ({ x: cx + (x * c - y * s), y: cy + (x * s + y * c) });
  const hw = w / 2, hh = h / 2;
  const cs = [rp(-hw, -hh), rp(hw, -hh), rp(hw, hh), rp(-hw, hh)];
  const centre = { x: cx, y: cy };
  const mk = (a, b, axis, sign) => {
    const dir = unit(sub(b, a));
    const mid = mul(add(a, b), 0.5);
    let outN = { x: dir.y, y: -dir.x };
    if (dot(outN, sub(centre, mid)) > 0) outN = mul(outN, -1); // point AWAY from the centre
    return { a, b, dir, outN, mid, len: len(sub(b, a)), axis, sign };
  };
  return [mk(cs[0], cs[1], "y", -1), mk(cs[1], cs[2], "x", 1), mk(cs[2], cs[3], "y", 1), mk(cs[3], cs[0], "x", -1)];
}

/* Nearest rect edge to point P among `edges`, considering only edges P sits OUTSIDE of (P on the
 * edge's outward side) unless facingOnly:false. Returns { edge, pt (clamped nearest point on the
 * edge), dist } or null. */
export function nearestRectEdge(P, edges, opts = {}) {
  let best = null;
  for (const e of edges || []) {
    if (opts.facingOnly !== false && dot(e.outN, sub(P, e.mid)) <= 0) continue;
    const q = nearestOnSeg(P, e.a, e.b);
    const dd = Math.hypot(q.x - P.x, q.y - P.y);
    if (!best || dd < best.dist) best = { edge: e, pt: q, dist: dd };
  }
  return best;
}

/* Curb / border stroke width in PIXELS for a true real-world curb of `curbFt` feet at the
 * current `ppf` (pixels-per-foot), floored to `minPx` so it stays visible when the true
 * width goes sub-pixel at overview zoom. NO ceiling — a 6" curb SHOULD read thicker as you
 * zoom in (tied to the drawing's real scale, B719). */
export function curbStrokePx(curbFt, ppf, minPx = 0.75) {
  const w = (Number.isFinite(curbFt) ? curbFt : 0) * (Number.isFinite(ppf) ? ppf : 0);
  return Math.max(minPx, w);
}

/* Convex hull (monotone chain) of a point cloud → CCW-ish ring, or null if < 3 distinct points. */
function convexHull(points) {
  const pts = (points || [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const n = pts.length;
  if (n < 3) return null;
  const crossz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && crossz(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && crossz(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : null;
}

/* ---- Seamless road-to-road weld cover (B960/NEW-2) ------------------------------------
 * Where two roads connect END-TO-END (endpoint welded onto endpoint — a plain weld or a loop
 * close, NOT a tee onto an interior vertex), each road renders its own strip with a FLAT end cap,
 * so the back-of-curb edge stroke traces perpendicularly across the join and the two caps butt —
 * a visible SEAM. This mirrors the B953 tee "cover": an opaque pavement patch painted over the
 * join hides those butting cap strokes so the welded surface reads as one continuous pavement.
 *   P     — the weld point (world ft).
 *   arms  — [{ dir, halfW }] per road meeting at P; `dir` points from the road body TOWARD P
 *           (neighbor→P), `halfW` = travelW/2 + curb (centerline → back-of-curb, the outer edge).
 *           A loop-close weld passes the SAME road twice (its two end tangents).
 *   opts.back — how far to extend the patch back into each arm (ft); default scales with width.
 * Returns the convex hull of each arm's cross-section (at P and backed off by `back`) — a patch
 * that spans the join, bridges a width step, and miters a bent weld — or null if under-specified. */
export function weldCoverPolygon(P, arms, opts = {}) {
  if (!P || !Number.isFinite(P.x) || !Number.isFinite(P.y) || !Array.isArray(arms) || arms.length < 2) return null;
  const halfMax = arms.reduce((m, a) => Math.max(m, a && a.halfW > 0 ? a.halfW : 0), 0);
  if (!(halfMax > 0)) return null;
  const back = opts.back > 0 ? opts.back : Math.max(2, halfMax * 0.75);
  const cloud = [];
  for (const a of arms) {
    if (!a || !a.dir) continue;
    const d = unit(a.dir);
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || (d.x === 0 && d.y === 0)) continue;
    const n = leftNormal(d);
    const hw = a.halfW > 0 ? a.halfW : halfMax;
    const base = { x: P.x - d.x * back, y: P.y - d.y * back };   // step back INTO the road body from P
    cloud.push({ x: base.x + n.x * hw, y: base.y + n.y * hw });
    cloud.push({ x: base.x - n.x * hw, y: base.y - n.y * hw });
    cloud.push({ x: P.x + n.x * hw, y: P.y + n.y * hw });        // the cap corners AT P (bridge a width step)
    cloud.push({ x: P.x - n.x * hw, y: P.y - n.y * hw });
  }
  return convexHull(cloud);
}
