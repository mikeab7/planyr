/* lib/roadGeometry.js — pure road centerline geometry (B597 / NEW-2). Its only import is the
 * equally pure `pureCache.js` (see `roadCenterlineTagged` for why the tessellation is cached).
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
import { boundedCache, pointsSignature } from "./pureCache.js";


export const DEFAULT_TESS_DEG = 6;       // ~1 tessellation point per 6° of arc / curve
export const DEFAULT_ARC_RADIUS = 50;    // ft — fallback Arc radius when none is supplied
// NEW-3 — a connect that lands within this distance of an existing control point REUSES it instead of
// appending a near-duplicate, and the load migration (dedupeRoadVertices) collapses stored near-dup
// clutter to the same tolerance. The B1005/B1006 root cause: the owner's through road carried a run of
// near-duplicate vertices left by earlier connect attempts (some byte-identical, others within ~2 ft),
// which starved the curb-return reach clamp to ~1.9 ft and squared off every corner. B1005/B1006 taught
// the reach walk to STEP OVER sub-1.5 ft clutter; this stops the clutter being created / kept at all.
export const ROAD_VERTEX_COLLAPSE_FT = 1.5;
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
/* How much of each adjacent leg a corner at interior vertex `i` may consume (NEW-2).
 *
 * A leg BETWEEN two interior vertices is shared by two corners, so each may take at most half —
 * that is the invariant that keeps neighbouring fillets from overlapping. A leg that runs to the
 * road's own ENDPOINT has no neighbouring corner to share with, so the whole leg is available.
 * The old code halved every leg unconditionally, which silently cut the achievable radius of any
 * corner near the end of a road IN HALF — on the owner's real plan a 28 ft fire-lane corner drew
 * at 11 ft purely because of this, and the app then flagged the geometry rather than the clamp. */
export function cornerShares(i, n) {
  return { a: i - 1 <= 0 ? 1 : 0.5, c: i + 1 >= n - 1 ? 1 : 0.5 };
}

function arcCorner(A, P, C, radius, tessDeg, shareA = 0.5, shareC = 0.5) {
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
  // Feasibility clamp: the run-up T must not exceed each leg's share (half of a leg shared with a
  // neighbouring corner; ALL of a leg that runs to the road's own endpoint — see cornerShares).
  const maxT = Math.min(shareA * lA, shareC * lC);
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

/* Drop consecutive duplicate points (within `tol` ft), keeping `tags` index-aligned. */
function dedupe(pts, tol = 1e-6, tags = null) {
  const out = [], keptTags = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) { out.push(p); if (tags) keptTags.push(tags[i]); }
  }
  return tags ? { pts: out, tags: keptTags } : out;
}

/* roadCenterlineTagged(pts, vtx, opts) — the rendered, tessellated centerline PLUS, for each
 * dense SEGMENT i (dense[i] → dense[i+1]), the index of the SPARSE control-point segment that
 * owns it (`segOwn[i]`, an index into the caller's own `pts`).
 *
 *   pts  — the clicked alignment (≥2 points).
 *   vtx  — parallel per-vertex treatment list (optional; defaults to "arc" per interior).
 *   opts.defaultRadius — Arc radius for a vertex that carries none (the class default).
 *   opts.tessDeg       — degrees of arc per tessellation step (smaller = denser).
 *   opts.sharpAt       — vertex indices (into `pts`) forced to a HARD corner regardless of their
 *                        stored treatment. This is how a JUNCTION vertex is rendered: a road that
 *                        another road tees into must physically pass THROUGH the junction node, and
 *                        a fillet cuts the corner off it — on the owner's Goose Creek plan the arc
 *                        at the split carried the pavement ~10 ft clear of the node the branch was
 *                        welded to, so the branch's edges stepped against the through road's. At a
 *                        real intersection the centerlines meet at a point and the CURB RETURNS do
 *                        the rounding; that is what this restores. (It is a no-op on a collinear
 *                        vertex — the overwhelmingly common junction — because `arcCorner` already
 *                        degenerates to a pass-through there.)
 *
 * The `segOwn` map is what lets a click on the DRAWN road be turned back into "insert a control
 * point into segment k": the pavement follows the dense curve, not the chords between control
 * points, so projecting a cursor onto the chords misses wherever the road actually bends.
 *
 * A 2-point road returns its two points unchanged (the degenerate "straight road" — it
 * MUST render identically to the legacy rect road). Sharp-only input returns the input
 * polyline. Every corner consumes at most half of each adjacent segment, so the dense
 * result is always simple (no self-overlap from neighbouring corners). */
/* VIEW-INDEPENDENT-ONCE (NEW-2, 2026-08-06) — the tessellation is cached on its own inputs.
 *
 * The alignment a road renders is a function of its control points, its per-vertex treatments and
 * two scalars. Nothing about it moves when the map does. But every consumer re-derives it —
 * `roadStripRing`, `roadCurbLines`, the label pass, the hit test — and each of those is called
 * per road per render, so a 60-move pan of the reference plan produced 1,140 calls of
 * `roadCenterline` and 1,140 of `roadCenterlineTagged` for SIX roads, measured by
 * ui-audit/detect-view-recompute.mjs (28 ms, scaling with element count).
 *
 * The signature is O(control points) — five to twenty per road — while the work it replaces
 * tessellates every corner into hundreds of dense points, so the ratio is not close.
 *
 * ⛔ A CALLER THAT PASSES `shareAt` BYPASSES THE CACHE ENTIRELY. It is a FUNCTION, so it cannot
 * be put in a key, and guessing that two callers' closures agree is exactly the kind of
 * assumption that turns a cache into a wrong answer. The one caller that uses it
 * (`fitRadiusToLegs`, in a solver loop) simply does not benefit. */
const _clCache = boundedCache(96);

function centerlineKey(pts, vtx, opts) {
  let v = "";
  for (const t of vtx || []) v += t ? `|${t.treatment || ""}:${t.radius ?? ""}` : "|-";
  const sharp = opts.sharpAt instanceof Set ? [...opts.sharpAt] : Array.isArray(opts.sharpAt) ? opts.sharpAt : [];
  return `${pointsSignature(pts)}#${v}#${opts.defaultRadius ?? ""}#${opts.tessDeg ?? ""}#${sharp.slice().sort((a, b) => a - b).join(",")}`;
}

export function roadCenterlineTagged(pts, vtx, opts = {}) {
  const key = typeof opts.shareAt === "function" ? null : centerlineKey(pts, vtx, opts);
  if (key != null) { const hit = _clCache.get(key); if (hit) return hit; }
  const res = roadCenterlineTaggedUncached(pts, vtx, opts);
  return key == null ? res : _clCache.set(key, res);
}

function roadCenterlineTaggedUncached(pts, vtx, opts = {}) {
  const clean = [], keep = [];                       // `keep[j]` = the ORIGINAL index of clean[j]
  (pts || []).forEach((p, i) => { if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { clean.push(p); keep.push(i); } });
  if (clean.length < 2) return { dense: clean.map((p) => ({ x: p.x, y: p.y })), segOwn: [] };
  if (clean.length === 2) return { dense: [{ x: clean[0].x, y: clean[0].y }, { x: clean[1].x, y: clean[1].y }], segOwn: [keep[0]] };
  const tessDeg = opts.tessDeg > 0 ? opts.tessDeg : DEFAULT_TESS_DEG;
  const defR = opts.defaultRadius > 0 ? opts.defaultRadius : DEFAULT_ARC_RADIUS;
  const sharp = opts.sharpAt instanceof Set ? opts.sharpAt : new Set(Array.isArray(opts.sharpAt) ? opts.sharpAt : []);
  const N = clean.length;
  // Per interior vertex, compute its corner geometry (entry anchor, dense pts, exit anchor).
  const corners = [];
  const shareAt = typeof opts.shareAt === "function" ? opts.shareAt : (i) => cornerShares(i, N);
  for (let i = 1; i < N - 1; i++) {
    const A = clean[i - 1], P = clean[i], C = clean[i + 1];
    const t = sharp.has(keep[i]) ? "sharp" : treatmentAt(vtx, i);
    const sh = shareAt(i) || { a: 0.5, c: 0.5 };
    if (t === "arc") corners.push(arcCorner(A, P, C, radiusAt(vtx, i, defR), tessDeg, sh.a, sh.c));
    else if (t === "smooth") corners.push(smoothCorner(A, P, C, tessDeg));
    else corners.push({ entry: P, exit: P, pts: [P] }); // sharp
  }
  // Stitch: start point → straight to corner1.entry → corner1 dense → straight to
  // corner2.entry → … → straight to end point. `inOwn[k]` records which SPARSE segment owns the
  // dense segment ENDING at point k: a corner at interior vertex v straddles segments v−1 and v,
  // so its first half is charged to v−1 and its second half to v.
  const out = [{ x: clean[0].x, y: clean[0].y }];
  const inOwn = [-1];
  for (let c = 0; c < corners.length; c++) {
    const v = c + 1, P = corners[c].pts, m = P.length;
    for (let k = 0; k < m; k++) { out.push({ x: P[k].x, y: P[k].y }); inOwn.push(keep[k <= (m - 1) / 2 ? v - 1 : v]); }
  }
  out.push({ x: clean[N - 1].x, y: clean[N - 1].y });
  inOwn.push(keep[N - 2]);
  const d = dedupe(out, 1e-6, inOwn);
  return { dense: d.pts, segOwn: d.tags.slice(1) };   // segOwn[i] owns dense[i]→dense[i+1]
}

/* The rendered, tessellated centerline (see roadCenterlineTagged for the options). */
export function roadCenterline(pts, vtx, opts = {}) {
  return roadCenterlineTagged(pts, vtx, opts).dense;
}

/* Nearest point on an OPEN polyline to `p`. Returns { i, pt, d } (segment index + the clamped
 * projection + its distance), or null for a degenerate line. */
export function projectToPolyline(line, p) {
  if (!Array.isArray(line) || line.length < 2 || !p) return null;
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 > EPS ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { i, pt: q, d };
  }
  return best;
}

/* Hit-test a point against the road as DRAWN, mapped back to the control-point segment that owns
 * the hit. Returns { index, pt, d } where `index` is exactly the `edgeIndex` insertRoadVertex
 * expects and `pt` lies ON the rendered centerline.
 *
 * Why this exists (the "right-click misses wherever the road is curved" bug): the pavement is
 * generated from the dense, tessellated centerline, but the on-canvas hit test projected onto the
 * straight CHORD between consecutive control points. On a curve the chord cuts the corner, so the
 * drawn pavement on the outside of a bend sits further from the chord than the click tolerance —
 * no edge hit, no "Add control point", and the road's own menu opened instead. Projecting onto the
 * curve the renderer actually draws makes a click anywhere on the pavement land. */
export function projectToRoadCenterline(pts, vtx, p, opts = {}) {
  const { dense, segOwn } = roadCenterlineTagged(pts, vtx, opts);
  const hit = projectToPolyline(dense, p);
  if (!hit) return null;
  const maxEdge = Math.max(0, (pts || []).length - 2);
  const own = Number.isFinite(segOwn[hit.i]) ? segOwn[hit.i] : hit.i;
  return { index: Math.max(0, Math.min(maxEdge, own)), pt: hit.pt, d: hit.d };
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
export function insertRoadVertex(pts, vtx, edgeIndex, pt, opts = {}) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  if (!(edgeIndex >= 0 && edgeIndex < pts.length - 1)) return null;
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  // NEW-3 — when the caller opts in (opts.collapseFt, the connect path), a point landing within collapse
  // distance of THIS segment's endpoint REUSES that existing vertex instead of splicing a near-duplicate.
  // Returns the arrays unchanged (endpoint treatment preserved) with `index` pointing at the reused vertex
  // + `collapsed:true`. The interactive "add a control point" path passes no opts, so a user placing a
  // point deliberately still always gets one.
  const collapseFt = opts.collapseFt > 0 ? opts.collapseFt : 0;
  if (collapseFt > 0) {
    const a = pts[edgeIndex], b = pts[edgeIndex + 1];
    const da = Math.hypot(a.x - pt.x, a.y - pt.y);
    const db = Math.hypot(b.x - pt.x, b.y - pt.y);
    if ((da <= collapseFt || db <= collapseFt)) {
      const reuse = da <= db ? edgeIndex : edgeIndex + 1;   // nearer existing endpoint wins
      return { pts: pts.map((p) => ({ x: p.x, y: p.y })), vtx: normVtx(pts, vtx), index: reuse, collapsed: true };
    }
  }
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

/* ---- One-shot near-duplicate vertex cleanup (NEW-3) ----------------------------------
 * Collapse runs of near-coincident control points on a stored centerline road, keeping the parallel
 * `pts` and `vtx` arrays INDEX-ALIGNED. Earlier connect attempts left clutter on the owner's real plan —
 * a run of vertices within ~1.5 ft of one another (some byte-identical) — which starved the curb-return
 * reach clamp to a couple of feet and squared off every corner (the B1005/B1006 root cause). ENDPOINTS
 * are always preserved (they anchor welds + other roads' tees); only INTERIOR near-dups are dropped, each
 * collapsing onto the previous KEPT point (whose treatment survives). If the last kept interior point
 * hugs the far endpoint within tol, the endpoint wins (that clutter is dropped too) — but index 0 never
 * goes. Idempotent: a cleaned road has no sub-tol interior gap, so a re-run returns null (no churn).
 * Returns a fresh { pts, vtx } when it collapsed anything, else null. Pure — unit-tested. */
export function dedupeRoadVertices(pts, vtx, tol = ROAD_VERTEX_COLLAPSE_FT, opts = {}) {
  if (!Array.isArray(pts) || pts.length < 3) return null;   // a 2-pt road has no interior to collapse
  const t = tol > 0 ? tol : ROAD_VERTEX_COLLAPSE_FT;
  // NEW-5 — DISTANCE IS THE WRONG TEST on its own. B1008 collapsed vertices within ~1.5 ft, and the
  // owner's very next connect dropped one 3.4 ft away — through which the alignment swung 37°. A 40 ft
  // truck road cannot bend 37° in 3.4 ft, so that is not a segment, it is connect debris: it starved the
  // corner to a 5 ft radius (against a 50 ft class minimum) and, because the junction reads its tangent
  // off whatever segment it is standing on, aimed the entrance 37° wrong and threw a spike. Meanwhile
  // the SAME road carries harmless 2 ft stubs further east — harmless precisely because it runs dead
  // straight through them. What makes a stub dangerous is a stub CARRYING A TURN. So the second test is
  // geometric: a segment shorter than a quarter of the road's own width, across which the alignment
  // deflects materially, collapses too. `pinned` protects any point another road welds to, so cleaning
  // debris can never break a tee.
  const dfl = opts.deflectFt > 0 ? opts.deflectFt : 0;
  const pinned = Array.isArray(opts.pinned) ? opts.pinned : [];
  const isPinned = (p) => pinned.some((q) => q && Math.hypot(q.x - p.x, q.y - p.y) <= Math.max(t, 0.75));
  const bearing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const deflectAt = (i) => {
    if (i <= 0 || i >= pts.length - 1) return 0;
    let d = bearing(pts[i], pts[i + 1]) - bearing(pts[i - 1], pts[i]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };
  const MIN_DEFLECT = (5 * Math.PI) / 180;                  // below this the stub is collinear → harmless
  const v = normVtx(pts, vtx);
  const last = pts.length - 1;
  const keep = [0];
  for (let i = 1; i < last; i++) {
    const prev = pts[keep[keep.length - 1]];
    const gap = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
    if (gap <= t) continue;                                                  // near-duplicate (B1008)
    if (dfl > 0 && gap < dfl && deflectAt(i) > MIN_DEFLECT && !isPinned(pts[i])) continue; // turning stub
    keep.push(i);
  }
  // The far endpoint always survives; peel back any kept interior clutter hugging it (never index 0).
  while (keep.length >= 2 && keep[keep.length - 1] !== 0 && !isPinned(pts[keep[keep.length - 1]]) &&
         Math.hypot(pts[last].x - pts[keep[keep.length - 1]].x, pts[last].y - pts[keep[keep.length - 1]].y) <= t) {
    keep.pop();
  }
  keep.push(last);
  if (keep.length === pts.length) return null;              // nothing collapsed → no new object
  return { pts: keep.map((i) => ({ x: pts[i].x, y: pts[i].y })), vtx: keep.map((i) => ({ ...(v[i] || {}) })) };
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
  // NEW-1 — EDGE distance SATURATES, so it cannot order candidates on its own. `edgeD` is
  // max(0, d − halfW), and on a 100 ft road that is 0 for EVERY point within ~50 ft of the centerline:
  // a strict `edgeD < best.dist` comparison then resolves a 50 ft-wide band of ties by SCAN ORDER, not
  // by proximity. Sliding a tee along a wide host that way kept resolving to the first segment scanned —
  // whose clamped projection is the shared vertex itself — so the junction sat still while the cursor
  // moved. Keep `dist` edge-relative (B961: it has to compare fairly against a parking/court edge hit)
  // and break its ties on the RAW centerline distance, which does not saturate.
  const better = (edgeD, raw) => !best || edgeD < best.dist - 1e-6 || (edgeD <= best.dist + 1e-6 && raw < best.raw - 1e-6);
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
      if (d <= tolFt + hw && better(edgeD, d)) best = { roadId: r.id, kind: "endpoint", index: idx, pt: { x: p.x, y: p.y }, dist: edgeD, raw: d };
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
        // An interior hit must be STRICTLY better than any endpoint hit (so a near-endpoint press joins
        // end-to-end), which under saturation means: closer at the edge, or — when the edge distances
        // tie — genuinely closer to the centerline.
        if (d > tolFt + hw || !better(edgeD, d)) continue;
        // Defer to the endpoint pass when the projection lands within (edge) tolerance of either end —
        // near a road's end you want a clean end-to-end join, not a tee just inside it.
        const nearEnd = Math.hypot(q.x - r.pts[0].x, q.y - r.pts[0].y) <= tolFt + hw ||
                        Math.hypot(q.x - r.pts[last].x, q.y - r.pts[last].y) <= tolFt + hw;
        if (!nearEnd) best = { roadId: r.id, kind: "interior", index: i, pt: { x: q.x, y: q.y }, dist: edgeD, raw: d };
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

/* NEW-1 — the index of the INTERIOR control point of `pts` coincident with `pt` (within `tol`), or -1.
 * This is how a junction node is RECOGNISED: a road that tees into this one shares the exact coordinate
 * of one of its control points, so "which of my vertices is this endpoint already welded to" is a plain
 * coincidence test. Endpoints are deliberately excluded — an endpoint meet is a WELD (both roads keep
 * their extent), not a tee node that may be slid along a host. */
export function teeNodeIndex(pts, pt, tol = ROAD_VERTEX_COLLAPSE_FT) {
  if (!Array.isArray(pts) || pts.length < 3 || !pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return -1;
  const t = tol > 0 ? tol : ROAD_VERTEX_COLLAPSE_FT;
  let best = -1, bestD = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const q = pts[i];
    if (!q) continue;
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d <= t && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/* NEW-1 — SLIDE an existing junction node along its own host road to `pt`.
 *
 * This is the operation the owner was missing. A tee stores the junction as a control point spliced
 * into the HOST's alignment; dragging the side road's endpoint therefore has to MOVE that control
 * point, not look for somewhere to put a new one. `planRoadConnect` used to route every tee — including
 * one that already existed — through `insertRoadVertex`'s reuse rule, whose tolerance scales with the
 * host's width (travelW/4). On a 100 ft host that is 25 ft, so any slide shorter than that "reused" the
 * node the endpoint was already welded to and the junction snapped straight back to where it started;
 * a longer slide moved it but left the old node behind as clutter.
 *
 * Mechanically: drop the held node, re-project onto what is left (so a slide PAST a neighbouring control
 * point re-sequences correctly instead of folding the alignment back on itself), then splice the node in
 * at its new home. The reuse tolerance here is the TIGHT `ROAD_VERTEX_COLLAPSE_FT`, never the width-scaled
 * one: a slide is a deliberate repositioning of a node that already exists, so the only thing worth
 * collapsing onto is a true coincidence — anything wider is the dead zone this exists to remove.
 *
 * Returns { pts, vtx, index } (index = the node's new position) or null when `heldIndex` is not a
 * slidable interior node. Pure — unit-tested. */
export function slideTeeNode(pts, vtx, heldIndex, pt) {
  if (!Array.isArray(pts) || pts.length < 3) return null;
  if (!(heldIndex > 0 && heldIndex < pts.length - 1)) return null;   // interior only — an endpoint is a weld
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  const v = normVtx(pts, vtx);
  const rPts = pts.filter((_, i) => i !== heldIndex).map((p) => ({ x: p.x, y: p.y }));
  const rVtx = v.filter((_, i) => i !== heldIndex);
  const hit = projectToPolyline(rPts, pt);
  if (!hit) return null;
  const ins = insertRoadVertex(rPts, rVtx, hit.i, pt, { collapseFt: ROAD_VERTEX_COLLAPSE_FT });
  if (!ins) return null;
  return { pts: ins.pts, vtx: ins.vtx, index: ins.index };
}

/* NEW-2 — the road's ABSOLUTE BEARING, and the cardinal lock that lets a tee drag set it.
 *
 * Owner, correcting an earlier reading: the connecting road is "not square to the host road, it's just
 * more angled with respect to N/S than I'd like." So the thing he is aiming at is a CARDINAL bearing —
 * a property of the road alone — not a relationship to the road it tees into.
 *
 * The planner's feet frame is axis-aligned to true north (`mapLock.feetToLatLngPair`: −y is north, +x is
 * east, no rotation), so page angles here ARE true bearings. `roadBearingDeg` reports one the way a plan
 * reads it: degrees clockwise from north, 0–360.
 *
 * `cardinalTeePoint` is the LOCK. Holding Shift while dragging a road vertex already locks its leg to 45°
 * increments (`snap45` — due N/S/E/W plus the diagonals); that lock was simply dead on a junction drag,
 * because the connect magnet overwrote the locked point. Here the two compose instead: take the leg's
 * bearing from `pivot`, round it to the nearest 45°, and slide the connection to where THAT ray crosses
 * the host segment — so the endpoint stays welded to the host and the leg lands on an exact cardinal.
 * Releasing Shift is the override.
 *
 *   hostPts — the host's WHOLE alignment, not just the chord the cursor is over. That distinction is
 *            load-bearing: the cardinal crossing routinely sits on a DIFFERENT segment from the free
 *            connect point (on the owner's plan the crossing is 18 ft up the host, one control point
 *            back from where his cursor was), and a single-segment intersection simply refuses there.
 *   pivot  — the connecting road's next vertex back from the moving endpoint: the point its last leg
 *            swings about, and therefore what the bearing is measured from.
 *   pt     — the connection point as it stands (the free projection onto the host); the crossing
 *            NEAREST it wins, so the lock tracks the drag rather than jumping to a far one.
 * Returns { pt, bearing, index } (index = the host segment the locked point lands on, which is what
 * the tee is spliced into) or null when the locked ray misses the host entirely / the geometry is
 * degenerate — in which case the caller keeps the free point rather than inventing one.
 * Pure — unit-tested. */
export function roadBearingDeg(from, to) {
  if (!from || !to) return null;
  const dx = to.x - from.x, dy = to.y - from.y;              // −y is north
  if (Math.hypot(dx, dy) < EPS) return null;
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

export const TEE_CARDINAL_STEP_DEG = 45;
export function cardinalTeePoint(hostPts, pivot, pt, opts = {}) {
  if (!Array.isArray(hostPts) || hostPts.length < 2 || !pivot || !pt) return null;
  const step = opts.stepDeg > 0 ? opts.stepDeg : TEE_CARDINAL_STEP_DEG;
  if (len(sub(pt, pivot)) < EPS) return null;
  const rad = (step * Math.PI) / 180;
  const ang = Math.round(Math.atan2(pt.y - pivot.y, pt.x - pivot.x) / rad) * rad;
  const d = { x: Math.cos(ang), y: Math.sin(ang) };           // the locked ray, from the pivot
  let best = null;
  for (let i = 0; i < hostPts.length - 1; i++) {
    const a = hostPts[i], b = hostPts[i + 1];
    if (!a || !b) continue;
    const seg = sub(b, a);
    // Ray/segment intersection: pivot + t·d = a + s·seg, solved by cross products.
    const den = cross(d, seg);
    if (Math.abs(den) < 1e-9) continue;                       // this leg is parallel to the locked ray
    const w = sub(a, pivot);
    const t = cross(w, seg) / den;
    const s = cross(w, d) / den;
    if (!(t > EPS) || !(s >= -1e-9 && s <= 1 + 1e-9)) continue;   // behind the pivot / off this leg
    const q = { x: pivot.x + d.x * t, y: pivot.y + d.y * t };
    const away = len(sub(q, pt));
    if (!best || away < best.away) best = { pt: q, index: i, away };
  }
  if (!best) return null;
  return { pt: best.pt, index: best.index, bearing: roadBearingDeg(pivot, best.pt) };
}

/* Decide + build the connect action for a moving road endpoint welding onto `candidate`.
 *   movingEl / targetEl — { pts, vtx, id, roadClass, travelW, curb }.
 *   movingIndex         — the moving endpoint (0 or last) being welded.
 *   candidate           — a findRoadConnect() hit ({ roadId, kind, index, pt }).
 *   joinRadius          — the merged road's class-default arc radius (merge only).
 *   opts.fromPt         — (NEW-1) where the moving endpoint sat BEFORE the gesture. When that point is
 *                         an existing junction node on `targetEl`, the tee is SLID (the node moves) —
 *                         see slideTeeNode. Omitting it keeps the original fresh-connect behaviour.
 * Returns one of:
 *   { action:"merge", moving:{pts,vtx}, deleteTarget:true }        — target absorbed into moving
 *   { action:"weld",  moving:{pts,vtx} }                           — endpoints share a coord; both kept
 *   { action:"tee",   moving:{pts,vtx}, target:{pts,vtx} }         — endpoint onto interior; vertex inserted
 *                         (`slid` = the node's new index when an existing junction was moved)
 * or null when the inputs are unusable. Callers own the id bookkeeping (delete/patch). */
export function planRoadConnect(movingEl, movingIndex, targetEl, candidate, joinRadius, opts = {}) {
  if (!movingEl || !Array.isArray(movingEl.pts) || !candidate) return null;
  const mPts = movingEl.pts, mLast = mPts.length - 1;
  if (movingIndex !== 0 && movingIndex !== mLast) return null;
  const weldPt = candidate.pt;
  const weldMovingTo = (wp) => ({
    pts: mPts.map((p, i) => (i === movingIndex ? { x: wp.x, y: wp.y } : { x: p.x, y: p.y })),
    vtx: normVtx(mPts, movingEl.vtx),
  });
  const weldMoving = () => weldMovingTo(weldPt);
  if (candidate.kind === "interior") {
    if (!targetEl || !Array.isArray(targetEl.pts)) return null;
    // NEW-1 — a junction this endpoint is ALREADY welded to is MOVED, never re-reused in place. Without
    // this the collapse rule below (25 ft on a 100 ft host) swallowed every short slide whole: the ghost
    // followed the cursor the entire drag and the junction reverted the instant you let go.
    const held = teeNodeIndex(targetEl.pts, opts.fromPt, ROAD_VERTEX_COLLAPSE_FT);
    if (held > 0) {
      const slid = slideTeeNode(targetEl.pts, targetEl.vtx, held, weldPt);
      if (slid) return { action: "tee", moving: weldMovingTo(slid.pts[slid.index]), target: { pts: slid.pts, vtx: slid.vtx }, slid: slid.index };
    }
    // NEW-3 — reuse an existing through-road vertex within collapse distance instead of near-duplicating
    // one, and weld the moving endpoint to that RESOLVED node so both roads meet at a single point.
    // NEW-5 — reuse an existing control point far more readily than B1008's flat 1.5 ft. A tee node
    // dropped a few feet from one already there creates a stub the road then has to turn through, which
    // starves the corner and mis-aims the junction tangent (the owner's spike). The tolerance scales with
    // the road, because that is what decides whether a stub can carry a bend at all.
    const collapseFt = Math.max(ROAD_VERTEX_COLLAPSE_FT, (+targetEl.travelW || 0) / 4);
    const ins = insertRoadVertex(targetEl.pts, targetEl.vtx, candidate.index, weldPt, { collapseFt });
    if (!ins) return { action: "weld", moving: weldMoving() };   // out-of-range → fall back to a plain weld
    const teePt = ins.pts[ins.index];
    return { action: "tee", moving: weldMovingTo(teePt), target: { pts: ins.pts, vtx: ins.vtx } };
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
    // Measure the triple with THIS road's real leg shares (NEW-2) — a 3-point probe would
    // otherwise grant both legs in full and over-report a corner in the middle of a long road.
    const sh = cornerShares(i, N);
    const local = roadCenterline([work[i - 1], work[i], work[i + 1]], [{}, wvtx[i], {}], { defaultRadius: target, tessDeg, shareAt: () => sh });
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
    const sh = cornerShares(i, N);
    return Math.min(sh.a * lA, sh.c * lC) / Math.tan(theta / 2);
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


/* Per-INTERIOR-VERTEX corner radius: what the vertex ASKED for vs what actually gets DRAWN (NEW-4).
 *
 * `arcCorner` silently feasibility-clamps a corner's radius to half the shorter adjacent leg, so a
 * corner set to a code minimum (a fire lane's 28 ft inside radius, a truck route's 50 ft) can render
 * far tighter with nothing said. On the owner's real plan a 28 ft fire-lane corner was drawing at 11 —
 * not a cosmetic difference but a compliance one, and the visible cause of "that shape is wrong".
 * This exposes the clamp so the app can SAY SO instead of quietly drawing a corner no engineer would.
 *
 * Returns one row per interior vertex: { i, treatment, requested, rendered, limited }.
 *   requested — the radius the vertex carries (or the class default).
 *   rendered  — the radius the tessellated centerline actually turns at (Infinity for a straight or
 *               folded vertex — nothing is being clamped there).
 *   limited   — true when the leg length forced `rendered` below `requested`.
 * A `smooth` vertex has no circular radius, so it reports rendered: null and never flags. */
export function roadCornerRadii(pts, vtx, opts = {}) {
  const P = Array.isArray(pts) ? pts : [];
  if (P.length < 3) return [];
  const fallback = opts.defaultRadius > 0 ? opts.defaultRadius : DEFAULT_ARC_RADIUS;
  const P_LEN = P.length;
  const out = [];
  for (let i = 1; i < P.length - 1; i++) {
    const treatment = treatmentAt(vtx, i);
    const requested = radiusAt(vtx, i, fallback);
    if (treatment !== "arc") { out.push({ i, treatment, requested, rendered: null, limited: false }); continue; }
    const vA = sub(P[i - 1], P[i]), vC = sub(P[i + 1], P[i]);
    const lA = len(vA), lC = len(vC);
    if (lA < EPS || lC < EPS) { out.push({ i, treatment, requested, rendered: Infinity, limited: false }); continue; }
    const c = Math.max(-1, Math.min(1, dot(mul(vA, 1 / lA), mul(vC, 1 / lC))));
    const theta = Math.PI - Math.acos(c);                 // deflection / turn angle
    if (theta < 1e-4 || theta > Math.PI - 1e-4) { out.push({ i, treatment, requested, rendered: Infinity, limited: false }); continue; }
    const tanHalf = Math.tan(theta / 2);
    const sh = cornerShares(i, P_LEN);                    // same leg-share rule arcCorner applies
    const maxT = Math.min(sh.a * lA, sh.c * lC);
    const T = Math.min(requested * tanHalf, maxT);
    const rendered = tanHalf > EPS ? T / tanHalf : Infinity;
    // NEW-4 — carry the raw ingredients so a caller can say WHAT WOULD FIX IT ("needs ~6 ft more
    // approach") instead of only that it's wrong. `tight` names the leg doing the clamping, and
    // `terminal` says whether that leg runs to a road END (extendable) or into another corner.
    const availA = sh.a * lA, availC = sh.c * lC;
    const tight = availA <= availC ? "a" : "c";
    out.push({
      i, treatment, requested, rendered, limited: rendered < requested - 1e-6,
      tanHalf, legA: lA, legC: lC, shareA: sh.a, shareC: sh.c, maxT, tight,
      terminalA: i - 1 <= 0, terminalC: i + 1 >= P_LEN - 1,
    });
  }
  return out;
}

/* Extra length the TIGHT leg of corner `c` would need for it to hold `minRadius` (ft, ≥0).
 * The clamp is T ≤ share × legLength, so leg = minRadius·tan(θ/2) / share. Pure arithmetic on a
 * roadCornerRadii row — this is the number the owner asked the app to TELL him. */
export function cornerApproachShortfall(c, minRadius) {
  if (!c || !(minRadius > 0) || !(c.tanHalf > EPS)) return 0;
  const share = c.tight === "a" ? c.shareA : c.shareC;
  const have = c.tight === "a" ? c.legA : c.legC;
  const need = (minRadius * c.tanHalf) / (share > 0 ? share : 0.5);
  return Math.max(0, need - have);
}

/* Interior vertices whose DRAWN corner falls below `minRadius` (a road class's civil threshold).
 * `minRadius <= 0` (the Custom class) never flags. Each row carries `shortfallFt` — how much
 * more approach the tight leg needs — and `extendable` (that leg runs to a road end, so the
 * one-click fix can simply lengthen it). */
export function roadRadiusConflicts(pts, vtx, minRadius, opts = {}) {
  if (!(minRadius > 0)) return [];
  return roadCornerRadii(pts, vtx, opts)
    .filter((c) => c.rendered !== null && Number.isFinite(c.rendered) && c.rendered < minRadius - 1e-6)
    .map((c) => ({
      ...c,
      shortfallFt: cornerApproachShortfall(c, minRadius),
      extendable: c.tight === "a" ? c.terminalA : c.terminalC,
    }))
    .map((c) => ({ ...c, minRadius, pt: pts[c.i] }));
}

/* ---- Make a road HOLD its class radius (NEW-3, the owner's "it should just self-fix") -------
 *
 * Owner rule, 2026-07-25: "the exclamation point should never become exclamation points, the
 * software should self fix … if it's on truck route, it should auto go to whatever the minimum
 * radius is." So picking a class is an INSTRUCTION, not an assertion to be graded. This is the
 * pure engine behind it; it runs on a class change, on the flag's one-click fix, and on migrate.
 *
 * Three moves, in the order a designer would make them:
 *   1. ASK for the class radius at every interior corner. (An earlier auto-fix used to BAKE the
 *      clamped value back onto the vertex — so the road then looked like the user had chosen a
 *      sub-standard corner and nothing would ever raise it again. Never write below-class.)
 *   2. LENGTHEN THE APPROACH where a corner is starved by a leg that runs to a road END — the
 *      geometry a site designer actually adjusts. Bounded by `maxExtendFt` (default 25 ft) so a
 *      road never grows an arbitrary tail; extension runs along the existing leg direction, so
 *      the alignment's bearing is unchanged and any weld at that end simply slides along it.
 *   3. Report what's LEFT — per corner, the achievable radius and the approach still missing —
 *      so the UI can name the remedy instead of drawing a bare "!".
 *
 * Pure. `pts` are never moved, only the two ENDPOINTS may be pushed outward along their own leg.
 * Returns { pts, vtx, extended:[{index, ft}], residual:[{index, achievable, shortfallFt}], changed }. */
/* ---- Undo a radius the old auto-fixer BAKED IN (NEW-6) --------------------------------
 *
 * Owner, 2026-07-25, looking at his live plan: "it seems like it's not shaped right." He was right,
 * and the cause is stored data, not the renderer. The pre-B1013 auto-fixer wrote the *clamped* value
 * back onto the vertex — his fire lane carries `radius: 11.532635922052066` — so the corner draws as
 * a blob no matter how much room the fix later frees up, and nothing ever raises it again. It reads
 * as a radius he chose. He never chose it; a person types 12, not 11.532635922052066.
 *
 * That non-roundness IS the signature, and it is what makes this safe to repair automatically. A
 * stored radius is treated as machine-written only when BOTH hold:
 *   • it sits below the class minimum (a compliant radius is never "damage"), and
 *   • it is not a round value — every path a HUMAN radius can arrive by lands on a whole or half
 *     foot (typed into the vertex editor, or seeded from a class default like 25 / 50 / 120). Only
 *     the old clamp produced numbers like 11.532635922052066.
 * Deliberately NOT keyed on "does it equal the clamp for the CURRENT geometry" — the owner has moved
 * points since the bake, so the baked number no longer matches any clamp, which is precisely why it
 * is stuck. Repaired vertices are re-asked at the class radius; the render still clamps to whatever
 * fits, so this can only IMPROVE a drawn corner and it NEVER moves a point.
 * Returns a fresh { pts, vtx, repaired:[i] } or null when nothing matched. Pure — unit-tested. */
export function repairBakedRadii(pts, vtx, minRadius, opts = {}) {
  const P = Array.isArray(pts) ? pts : [];
  if (P.length < 3 || !(minRadius > 0)) return null;
  const target = opts.targetRadius > 0 ? opts.targetRadius : minRadius;
  const v = normVtx(P, vtx);
  const repaired = [];
  for (let i = 1; i < P.length - 1; i++) {
    const cur = v[i] || {};
    if (cur.treatment !== "arc" || !(cur.radius > 0)) continue;   // no stored radius → nothing baked
    if (cur.radius >= minRadius - 1e-6) continue;                 // already at/above the standard
    if (Math.abs(cur.radius * 2 - Math.round(cur.radius * 2)) <= 1e-6) continue; // a round, human value
    v[i] = { ...cur, radius: target };
    repaired.push(i);
  }
  if (!repaired.length) return null;
  return { pts: P.map((p) => ({ x: p.x, y: p.y })), vtx: v, repaired };
}

export function fitRoadCorners(pts, vtx, minRadius, opts = {}) {
  const clean = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const N = clean.length;
  const base = { pts: clean.map((p) => ({ x: p.x, y: p.y })), vtx: normVtx(clean, vtx), extended: [], residual: [], changed: false };
  if (N < 3 || !(minRadius > 0)) return base;
  const target = opts.targetRadius > 0 ? opts.targetRadius : minRadius;
  const maxExtend = opts.maxExtendFt >= 0 ? opts.maxExtendFt : 25;
  const work = base.pts;
  const wvtx = base.vtx;
  let changed = false;

  // 1 — ask for the class radius wherever the vertex isn't a deliberate sharp corner.
  for (let i = 1; i < N - 1; i++) {
    if (treatmentAt(wvtx, i) === "sharp") continue;
    const cur = wvtx[i] || {};
    if (cur.treatment !== "arc" || !(cur.radius >= target - 1e-6)) {
      wvtx[i] = { ...cur, treatment: "arc", radius: target };
      changed = true;
    }
  }

  // 2 — lengthen a starved END approach (bounded), re-measuring after each move.
  const extended = [];
  for (let pass = 0; pass < 2; pass++) {
    const rows = roadCornerRadii(work, wvtx, { defaultRadius: target });
    let moved = false;
    for (const c of rows) {
      if (c.rendered === null || !Number.isFinite(c.rendered)) continue;
      if (c.rendered >= minRadius - 1e-6) continue;
      const isA = c.tight === "a";
      if (!(isA ? c.terminalA : c.terminalC)) continue;         // interior leg — not ours to stretch
      const end = isA ? c.i - 1 : c.i + 1;                      // the road endpoint on the tight leg
      const prior = extended.find((e) => e.index === end);
      const spent = prior ? prior.ft : 0;                       // maxExtend is a TOTAL per end, not per pass
      const ft = Math.min(cornerApproachShortfall(c, minRadius), maxExtend - spent);
      if (!(ft > 1e-6)) continue;
      const from = work[c.i], to = work[end];
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      if (!(d > EPS)) continue;
      work[end] = { x: to.x + ((to.x - from.x) / d) * ft, y: to.y + ((to.y - from.y) / d) * ft };
      if (prior) prior.ft += ft; else extended.push({ index: end, ft });
      moved = true; changed = true;
    }
    if (!moved) break;
  }

  // 3 — whatever the two moves could not reach.
  const residual = roadCornerRadii(work, wvtx, { defaultRadius: target })
    .filter((c) => c.rendered !== null && Number.isFinite(c.rendered) && c.rendered < minRadius - 1e-6)
    .map((c) => ({ index: c.i, achievable: c.rendered, shortfallFt: cornerApproachShortfall(c, minRadius) }));

  return { pts: work, vtx: wvtx, extended, residual, changed };
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
    // NEW-1 — how far the through edge RUNS from T in each direction (+throughDir / -throughDir).
    // A single symmetric `throughAvail` is wrong whenever the two sides differ, and the difference is
    // not academic: a drive meeting a parking field near the END of its edge has ~50 ft of edge one way
    // and a couple of feet the other, so a symmetric clamp let the short-side return sweep off the end
    // of the field and hang in open ground. Defaults keep the old symmetric behaviour for old callers.
    throughAvailPos = undefined, throughAvailNeg = undefined,
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
  // ---- REACH-CAP the curb return (B1005 / NEW-1 — supersedes B989) ----------------------
  // B989 capped the fillet run t to ~one FULL drive-width (capW ≈ 2·phS), so the throat still opened to
  // 2·(phS + t) ≈ THREE drive-widths even at a PERPENDICULAR tee, and at an oblique/acute armpit
  // (phi small) t = R/tan(phi/2) still blew up — together the owner's giant concave scoop / batwing.
  // The real fix is to tie the run to the REQUESTED radius R itself, not the drive width: at a 90° tee
  // the natural run is exactly R, and at an acute armpit (where t would blow up) it is held to R too.
  // So the return reach is ALWAYS ≤ R at ANY angle — a small default seed reads as a tidy rounded
  // corner, and a user who needs a genuine WB-62 turn dials returnR up per-junction. Still bounded by
  // the actual road/drive run available (a short drive shrinks the return further).
  const availPos = Number.isFinite(throughAvailPos) ? throughAvailPos : throughAvail;
  const availNeg = Number.isFinite(throughAvailNeg) ? throughAvailNeg : throughAvail;
  // Fillet one corner: rays go ALONG the through edge away from the throat, and ALONG the side edge into
  // the body. Clamp R down so the tangent run fits tMax (acute angle → tiny arc, never a sweep).
  const fillet = (corner) => {
    const awaySign = Math.sign(dot(sub(corner, E0), u)) || 1;
    const awayThrough = mul(u, awaySign);
    // The corner already sits `along` feet toward that end of the through edge, so only what is LEFT
    // beyond it can carry the return's tangent run.
    const along = Math.abs(dot(sub(corner, E0), u));
    const tMax = Math.max(0, Math.min(((awaySign > 0 ? availPos : availNeg) - along) * 0.9, sideAvail * 0.9, R > 0 ? R : 0));
    const cAng = Math.max(-1, Math.min(1, dot(awayThrough, d)));
    const phi = Math.acos(cAng);
    // No run left past the corner (the drive is as wide as the edge it lands on, or wider) → an honest
    // SHARP corner. The old code only applied the clamp when tMax > 0, so a zero reach silently fell
    // through and kept the FULL requested radius — the one case where "no room" produced the biggest
    // possible return.
    if (!(tMax > EPS)) return { tan1: corner, tan2: corner, arc: [corner], R: 0, t: 0, centre: null, u1: awayThrough };
    if (phi < 1e-3 || phi > Math.PI - 1e-3) return { tan1: corner, tan2: corner, arc: [corner], R: 0, t: 0, centre: null, u1: awayThrough };
    let Rc = R > 0 ? R : 0;
    let f = rayFillet(corner, awayThrough, d, Rc, tessDeg);
    if (f && f.t > tMax && tMax > EPS) { Rc = tMax * Math.tan(phi / 2); f = rayFillet(corner, awayThrough, d, Rc, tessDeg); }
    if (!f || !(Rc > EPS)) return { tan1: corner, tan2: corner, arc: [corner], R: 0, t: 0, centre: null, u1: awayThrough }; // degenerate → sharp corner
    return { ...f, u1: awayThrough };
  };
  const fA = fillet(cornerA);
  const fB = fillet(cornerB);
  // ---- ADDITIVE curb-return WEDGES (NEW-1, supersedes the B1006 "mouth cover") -----------
  // Every cover shipped from B953 through B1006 was a patch PAINTED OVER the seam: a mouth polygon
  // whose base sat exactly ON the through road's near edge and whose top was a straight chord between
  // the two tangent points. Three defects fell out of that shape and none of them could be tuned away:
  //   • the base stopped at the near edge, so the side road's stub between that edge and the through
  //     CENTERLINE — its flat end cap and both back-of-curb strokes — stayed painted on the through
  //     road ("a rectangle intersecting a rectangle");
  //   • the top chord joined tangent points that sit at DIFFERENT distances along the side road at any
  //     skew, so the cover crossed the drive on a slant — the chamfer / chevron / notch;
  //   • traced on its own the fillet arc is concave toward the corner, so the patch read as a scooped
  //     lobe in the armpit instead of a corner being rounded.
  // The fix is to stop patching and hand the renderer an ADDITIVE piece instead: the wedge bounded by
  // corner→tan1, the arc, and tan2→corner. That wedge is exactly the pavement a curb return ADDS to the
  // 270° reflex corner where the two strips meet. Unioned with the two strip rings (roadNetwork.js), the
  // junction becomes one dissolved surface with one continuous outline — no seam to hide, nothing to
  // knock out, no translucent fill stacking. The wedge is a simple polygon at EVERY angle (a triangle
  // with one concave side), so the union is always well-defined: straight, curved, or acute road-road.
  // The wedge is deliberately THICK: past the two tangent points it continues INTO both pavements by
  // `deep` before closing. Only the arc side is a real boundary — everything behind it is interior to
  // the union and therefore invisible — and the depth is what makes the union robust on a CURVED
  // through road, which is the case that broke every previous attempt. The corner math treats the
  // through edge as the straight tangent line at T; on a curve the real (tessellated) strip edge
  // departs from that line by up to a foot within the return's reach, and a wedge that stopped at the
  // assumed line left an uncovered band along the real edge — a hair-thin hole that strokes as exactly
  // the faint curved seam the owner kept reporting. Reaching well inside both strips bridges that, and
  // any tessellation mismatch with it, without changing the rendered outline by so much as an inch.
  // `deep` is capped at half the pavement so it can never punch out the far side of a narrow drive,
  // and is 0 on the through side of a DRIVE junction (phT = 0 there — the "through edge" is a parking
  // field / truck-court boundary, and pavement pushed past it would paint road over the court).
  const deepT = phT > EPS ? Math.min(phT * 0.5, 12) : 0;
  const deepS = Math.max(1, Math.min(phS * 0.5, 12));
  const inT = mul(nTee, -1);                            // through near edge → through centerline
  const wedge = (f, corner, inS) => {
    if (!f || !(f.R > EPS) || !Array.isArray(f.arc) || f.arc.length < 2) return null;
    const back1 = add(f.tan1, mul(inT, deepT));         // tan1 pushed into the through pavement
    const back2 = add(f.tan2, mul(inS, deepS));         // tan2 pushed into the side pavement
    const heel = add(add(corner, mul(inT, deepT)), mul(inS, deepS));
    const poly = [...f.arc.map((p) => ({ x: p.x, y: p.y })), back2, heel, back1];
    return poly.length >= 3 ? poly : null;
  };
  // Corner A sits on the +perpS edge, so its pavement lies toward -perpS; corner B is the mirror.
  const wedges = [wedge(fA, cornerA, mul(perpS, -1)), wedge(fB, cornerB, perpS)].filter(Boolean);
  // Legacy mouth polygon — no longer painted, kept so older consumers/tests still resolve.
  const mouth = [...fA.arc, ...fB.arc.slice().reverse()].map((p) => ({ x: p.x, y: p.y }));
  const coverPolys = mouth.length >= 3 ? [mouth] : [];
  const throatWidth = len(sub(fA.tan1, fB.tan1));
  return {
    R: Math.max(fA.R, fB.R),
    throatWidth,
    corners: [cornerA, cornerB],
    throughTangents: [fA.tan1, fB.tan1],
    sideTangents: [fA.tan2, fB.tan2],
    returns: [fA.arc, fB.arc],
    wedges,                            // ADDITIVE curb-return pavement — union these, don't overpaint
    coverPolys,                        // legacy (pre-union) cover — retained for old consumers
    cover: mouth,                      // legacy single-polygon field
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

/* ---- A junction as N ARMS around a NODE (B1011) --------------------------------------
 *
 * `teeGeometry` privileges one road as "the through road" and takes a SINGLE `throughDir`. That is a
 * fine model for a tee onto a straight run and a wrong one the moment the tee node is also a BEND: the
 * through road has TWO tangents there (incoming and outgoing), the caller could only hand over their
 * bisector, and both curb returns were then built against a line the pavement never follows — one
 * return sits proud of the real edge (a thin dart), the other falls shy of it (a notch). That is the
 * artifact left at the owner's pond-west junction after B1010 cleaned the vertex debris.
 *
 * The honest model has no "through road" at all. A junction is a NODE with N ARMS radiating from it,
 * each with its own bearing, its own pavement half-width and its own run. Sort the arms by bearing and
 * every ADJACENT PAIR defines one corner — the reflex armpit where those two pavements meet — which
 * gets one curb-return fillet. That single rule reproduces the straight tee (two 90° corners plus one
 * 180° gap that needs nothing), and also handles the Y, the bend-with-branch, and a 4-way, without any
 * arm being special. Each fillet is built against the arm's OWN edge, so nothing is measured against a
 * line the pavement doesn't follow — which is precisely the dart and the notch, gone by construction.
 *
 * arms: [{ dir, half, avail, deep? }] — dir points AWAY from the node into that road's body (need not
 * be unit); half is the pavement half-width at BACK OF CURB; avail is how far that arm runs before it
 * must stop (its next vertex, or a building); `road` identifies which road the arm belongs to, so the
 * two arms of one road's own bend are not treated as a corner (its polyline buffer already joins them). opts.R is the desired return radius, clamped per corner
 * exactly as teeGeometry clamps: never more than R, never more than what either arm has room for.
 *
 * Returns { wedges, corners, gaps, R } where `gaps[k] = { a, b, corner, tanA, tanB, arc, R }` names the
 * two ARM INDICES it joins, so a caller can find (say) the two arms of one road and read the throat
 * span between them. `wedges` are ADDITIVE pavement polygons for the boolean union — same contract as
 * teeGeometry.wedges: never painted over a seam, always unioned. Pure — unit-tested. */
export function nodeJunction(params) {
  const { node, arms, R = 0, tessDeg = DEFAULT_TESS_DEG, flatDeg = 178, roundOwnCorner = false } = params || {};
  if (!node || !Array.isArray(arms) || arms.length < 2) return null;
  const prepped = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i];
    if (!a || !a.dir) continue;
    const L = len(a.dir);
    if (!(L > EPS)) continue;
    prepped.push({
      i, u: mul(a.dir, 1 / L), half: Math.max(0, +a.half || 0), road: a.road != null ? a.road : null,
      avail: Number.isFinite(a.avail) ? Math.max(0, a.avail) : Infinity,
      deep: Number.isFinite(a.deep) ? a.deep : Math.max(1, Math.min(Math.max(0, +a.half || 0) * 0.5, 12)),
      bearing: Math.atan2(a.dir.y, a.dir.x),
    });
  }
  if (prepped.length < 2) return null;
  prepped.sort((p, q) => p.bearing - q.bearing);
  const TAU = Math.PI * 2;
  const flat = (flatDeg * Math.PI) / 180;
  const wedges = [], gaps = [], corners = [];

  for (let k = 0; k < prepped.length; k++) {
    const A = prepped[k], B = prepped[(k + 1) % prepped.length];
    if (prepped.length === 2 && k === 1) break;              // two arms share ONE gap on each side; do both
    let sweep = B.bearing - A.bearing;
    while (sweep <= 0) sweep += TAU;
    // A gap at/beyond `flatDeg` is a straight run-through (or the outside of the fan): the two strips
    // already meet flush there, so there is no armpit to round and nothing to add.
    if (sweep >= flat) continue;
    // Two arms of the SAME road are the two sides of that road's own bend — its polyline buffer already
    // joins them. Adding a return there would stack pavement on a corner that is not a junction at all.
    // …UNLESS the caller has FLATTENED that bend to a hard corner so the centerlines meet at the node
    // (`roundOwnCorner`, the junction-vertex case). Then the buffer joins them with a square miter and
    // the junction owns ALL the rounding at this node — including the through road's own turn, which
    // would otherwise read as the one squared-off corner in an intersection full of curb returns.
    if (!roundOwnCorner && A.road != null && A.road === B.road) continue;
    // Each arm's edge FACING this gap: A's left (+90° CCW), B's right (−90°).
    const nA = { x: -A.u.y, y: A.u.x }, nB = { x: B.u.y, y: -B.u.x };
    const corner = lineX(add(node, mul(nA, A.half)), A.u, add(node, mul(nB, B.half)), B.u);
    if (!corner) continue;
    corners.push(corner);
    // Room left along each arm BEYOND the corner (the corner already sits some way out).
    const alongA = dot(sub(corner, node), A.u), alongB = dot(sub(corner, node), B.u);
    const tMax = Math.max(0, Math.min((A.avail - alongA) * 0.9, (B.avail - alongB) * 0.9, R > 0 ? R : 0));
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(A.u, B.u))));
    let f = null;
    if (tMax > EPS && phi > 1e-3 && phi < Math.PI - 1e-3) {
      let Rc = R > 0 ? R : 0;
      f = rayFillet(corner, A.u, B.u, Rc, tessDeg);
      if (f && f.t > tMax) { Rc = tMax * Math.tan(phi / 2); f = rayFillet(corner, A.u, B.u, Rc, tessDeg); }
      if (f && !(Rc > EPS)) f = null;
    }
    if (!f) { gaps.push({ a: A.i, b: B.i, corner, tanA: corner, tanB: corner, arc: [corner], R: 0 }); continue; }
    // The ADDITIVE wedge, thick into BOTH pavements — same shape and the same reason as teeGeometry's:
    // only the arc is a real boundary, and reaching well inside both strips bridges any tessellation
    // mismatch on a curved arm instead of leaving a hair-thin hole that strokes as a seam.
    // OVERSHOOT past each tangent point (B1011 round 2). The fillet is tangent to the arm's STRAIGHT
    // edge line at the node, but a real strip edge is the tessellated buffer of a polyline that may BEND
    // right here — so a wedge that stopped exactly at the tangent point ended a hair off the real edge
    // and the union outline showed a sub-foot STEP there. Running the flank a little further along the
    // arm, and a hair INSIDE the edge, tucks it under the strip: the two boundaries now CROSS instead of
    // one stopping, so the outline stays continuous. Everything inside the union is invisible, so the
    // overshoot costs nothing; the inward bias is what guarantees it can never poke out past the edge.
    const ovA = Math.min(Math.max(1, A.half * 0.25), Math.max(0, A.avail - alongA), 6);
    const ovB = Math.min(Math.max(1, B.half * 0.25), Math.max(0, B.avail - alongB), 6);
    const tuckA = Math.min(0.35, A.deep * 0.5), tuckB = Math.min(0.35, B.deep * 0.5);
    const lipA = add(add(f.tan1, mul(A.u, ovA)), mul(nA, -tuckA));
    const lipB = add(add(f.tan2, mul(B.u, ovB)), mul(nB, -tuckB));
    const back1 = add(lipA, mul(nA, -A.deep));
    const back2 = add(lipB, mul(nB, -B.deep));
    const heel = add(add(corner, mul(nA, -A.deep)), mul(nB, -B.deep));
    const poly = [...f.arc.map((p) => ({ x: p.x, y: p.y })), lipB, back2, heel, back1, lipA];
    if (poly.length >= 3) wedges.push(poly);
    gaps.push({ a: A.i, b: B.i, corner, tanA: f.tan1, tanB: f.tan2, arc: f.arc, R: f.R });
  }
  return { wedges, corners, gaps, R: gaps.reduce((m, g) => Math.max(m, g.R || 0), 0) };
}

/* ---- Control points the owner never placed (B1052) -----------------------------------
 *
 * Owner, 2026-07-25, off a screenshot of his truck loop: "I don't remember adding this many control
 * points." He didn't. Every road-to-road connect SPLICES a vertex into the target road at the tee
 * point, and nothing has ever taken one back out: redraw the side road, drag its end, reconnect it a
 * foot over, and each attempt leaves its own vertex behind. On his plan the 40 ft truck loop carries
 * ten interior vertices that sit 0.00–0.25 ft off the chord between their own neighbours — they bend
 * the alignment by nothing, they are simply grips he has to look at and avoid dragging.
 *
 * B1008 and B1010 both attacked this and both missed THIS mode by design: B1008 collapsed vertices
 * within ~1.5 ft of each other, B1010 added "a short stub the alignment TURNS through", and both
 * explicitly judged a COLLINEAR stub harmless because it doesn't distort the geometry. It doesn't —
 * and it is still clutter the user never authored, which is the actual complaint.
 *
 * So the test here is contribution, not distance or deflection: drop an interior vertex when the road
 * WITHOUT it still traces where it was drawn. Greedy — remove the least-contributing vertex, then
 * re-measure EVERY ORIGINAL point against the simplified polyline and stop the moment any of them
 * would sit more than `tolFt` off it. That check is against the ORIGINAL, not the previous step, so
 * error cannot accumulate across a long run: the guarantee is absolute — the road never moves more
 * than `tolFt` from where the owner drew it, however many points come out.
 *
 * For each `pinned` point (another road's endpoint) the NEAREST vertex within `pinTolFt` is protected —
 * exactly one per junction, so the tee survives while the debris that collected around it does not.
 * Endpoints never go. `opts.reference` (default: `pts`) is the polyline the movement bound is measured
 * against — pass the pre-cleanup original when an earlier pass has already touched the road, so the
 * total drift across every pass stays inside `tolFt` rather than each pass getting its own budget. Idempotent: a clean road returns null.
 * Returns { pts, vtx, dropped:[originalIndex] } or null. Pure — unit-tested. */
export const ROAD_SIMPLIFY_TOL_FT = 1.5;

function distToSegment(p, a, b) {
  const d = sub(b, a), L2 = dot(d, d);
  if (L2 < EPS) return len(sub(p, a));
  let t = dot(sub(p, a), d) / L2;
  t = Math.max(0, Math.min(1, t));
  return len(sub(p, add(a, mul(d, t))));
}
// Farthest any point of `orig` sits from the polyline `keep` (both arrays of points).
function maxOffset(orig, keep) {
  let worst = 0;
  for (const p of orig) {
    let best = Infinity;
    for (let i = 0; i < keep.length - 1; i++) best = Math.min(best, distToSegment(p, keep[i], keep[i + 1]));
    if (best > worst) worst = best;
  }
  return worst;
}

export function simplifyRoadVertices(pts, vtx, tolFt = ROAD_SIMPLIFY_TOL_FT, opts = {}) {
  const P = Array.isArray(pts) ? pts.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  if (P.length < 3) return null;
  const tol = tolFt > 0 ? tolFt : ROAD_SIMPLIFY_TOL_FT;
  const pinned = Array.isArray(opts.pinned) ? opts.pinned : [];
  const pinTol = opts.pinTolFt > 0 ? opts.pinTolFt : 0.75;
  // Protect exactly ONE vertex per junction — the vertex NEAREST each pin, not every vertex within
  // tolerance of it. The distinction matters: the debris clusters precisely AROUND a junction (each
  // reconnect left its own vertex a foot or two from the last), so a generous radius that pinned the
  // whole cluster would protect the very clutter this exists to remove, while a radius tight enough to
  // isolate one vertex would fail to recognise a junction drawn with a little slack — and dropping THAT
  // vertex silently breaks the tee. Nearest-wins gives both: the junction keeps its node, the debris goes.
  const pinIdx = new Set();
  for (const q of pinned) {
    if (!q) continue;
    let bestI = -1, bestD = pinTol;
    for (let i = 0; i < P.length; i++) {
      const dd = Math.hypot(q.x - P[i].x, q.y - P[i].y);
      if (dd <= bestD) { bestD = dd; bestI = i; }
    }
    if (bestI >= 0) pinIdx.add(bestI);
  }
  const isPinnedIdx = (i) => pinIdx.has(i);
  const v = normVtx(P, vtx);
  // Measure against the road AS THE OWNER DREW IT, not against this function's own input. migrateRoad
  // runs a dedupe pass first, and two stages each inside their own budget can total more than either —
  // that is how a "never more than tol" promise quietly becomes "never more than tol, per stage".
  // Passing the pre-cleanup polyline as `reference` makes the bound absolute end to end.
  const orig = (Array.isArray(opts.reference) && opts.reference.length >= 2 ? opts.reference : P)
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }));
  let keepIdx = P.map((_, i) => i);

  for (;;) {
    // The least-contributing removable vertex this round: smallest offset from the chord between the
    // neighbours it would leave behind. (A `sharp` vertex is a deliberate hard corner — never touched.)
    let best = -1, bestOff = Infinity;
    for (let k = 1; k < keepIdx.length - 1; k++) {
      const i = keepIdx[k];
      if (isPinnedIdx(i)) continue;
      if (treatmentAt(v, i) === "sharp") continue;
      const off = distToSegment(P[i], P[keepIdx[k - 1]], P[keepIdx[k + 1]]);
      if (off < bestOff) { bestOff = off; best = k; }
    }
    if (best < 0) break;
    const trial = keepIdx.filter((_, k) => k !== best);
    // Measure the WHOLE original road against the trial — this is what bounds the total movement.
    if (maxOffset(orig, trial.map((i) => P[i])) > tol) break;
    keepIdx = trial;
  }

  if (keepIdx.length === P.length) return null;
  const dropped = P.map((_, i) => i).filter((i) => !keepIdx.includes(i));
  return {
    pts: keepIdx.map((i) => ({ x: P[i].x, y: P[i].y })),
    vtx: keepIdx.map((i) => ({ ...(v[i] || {}) })),
    dropped,
  };
}
