// Pure polygon intersection-area (clipping) — dependency-light, unit-tested in test/polyClip.test.js.
//
// Why (B652): the Site Planner had a polygon UNION (mergeRings) and a boolean overlap test
// (ringsOverlap), but no way to measure HOW MUCH two parcels overlap by AREA. The overlap
// safety net needs that number — warn in Yield/Analysis when two ACTIVE parcels overlap so
// their acreage is being double-counted. The intersection area of two arbitrary SIMPLE
// polygons is computed by triangulating both (ear clipping) and summing triangle∩triangle
// areas — each of those is a convex-clip, exact via Sutherland–Hodgman — so this is robust
// for convex AND concave lots, not just rectangles.

import { polyArea } from "./polygonSplit.js";
import { parcelExceptSqft } from "./parcelArea.js"; // NEW-2 — save-and-except holes come off the site area (leaf module: this file is on the boot path)
import ClipperLib from "clipper-lib";

const EPS = 1e-9;

// Signed area (CCW positive) — orientation, distinct from polygonSplit's UNSIGNED polyArea.
function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return a / 2;
}
// Return a CCW copy of a ring (positive signed area). All the tests below assume CCW.
const ccw = (ring) => (signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice());
// z of (a-o) × (b-o); > 0 ⇒ o→a→b is a left turn.
const cross3 = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Is point p inside (or on the boundary of) CCW triangle abc?
function pointInTri(p, a, b, c) {
  return cross3(a, b, p) >= -EPS && cross3(b, c, p) >= -EPS && cross3(c, a, p) >= -EPS;
}

// Ear-clipping triangulation of a simple polygon (convex or concave). Returns an array of
// triangles [[p0,p1,p2]…]. Degenerate / collinear inputs yield fewer or no triangles rather
// than throwing — this is a screening measure, so a graceful under-count beats a crash.
export function triangulate(ring) {
  const v = ccw((ring || []).map((p) => ({ x: p.x, y: p.y })));
  if (v.length < 3) return [];
  const idx = v.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = v[ia], b = v[ib], c = v[ic];
      if (cross3(a, b, c) <= EPS) continue; // reflex or collinear vertex — not an ear tip
      let blocked = false;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        if (pointInTri(v[k], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // numerically stuck — bail with what we have (screening use)
  }
  if (idx.length === 3) tris.push([v[idx[0]], v[idx[1]], v[idx[2]]]);
  return tris;
}

// Intersection of segment p→q with the infinite line through A,B (used inside the convex clip).
function segLine(p, q, A, B) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = B.x - A.x, sy = B.y - A.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return { x: q.x, y: q.y };
  const t = ((A.x - p.x) * sy - (A.y - p.y) * sx) / denom;
  return { x: p.x + t * rx, y: p.y + t * ry };
}

// Sutherland–Hodgman: clip `subject` (any simple polygon) against CONVEX `clip` (CCW).
// Exact whenever the clip window is convex — which every triangle is.
function clipByConvex(subject, clip) {
  let out = subject;
  const n = clip.length;
  for (let i = 0; i < n && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % n];
    const input = out; out = [];
    const inside = (p) => (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x) >= -EPS; // left of A→B
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j - 1 + input.length) % input.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(segLine(prev, cur, A, B)); out.push(cur); }
      else if (pi) out.push(segLine(prev, cur, A, B));
    }
  }
  return out;
}

// Intersection AREA (feet²) of two simple polygons. Triangulate both, sum triangle∩triangle
// (each a convex clip). 0 when they merely touch at an edge/vertex or are disjoint.
export function polyIntersectArea(ringA, ringB) {
  if (!Array.isArray(ringA) || !Array.isArray(ringB) || ringA.length < 3 || ringB.length < 3) return 0;
  const ta = triangulate(ringA), tb = triangulate(ringB);
  let sum = 0;
  for (const t1 of ta) {
    const s = ccw(t1);
    for (const t2 of tb) {
      const poly = clipByConvex(s, ccw(t2));
      if (poly.length >= 3) sum += polyArea(poly);
    }
  }
  return sum;
}

// Overlap tolerance for the B652 screening warning: an overlap only counts if it clears BOTH
// a small absolute floor AND a small fraction of the SMALLER parcel — so two lots that merely
// share a boundary edge (intersection area ≈ 0) never false-warn on floating-point dust.
export const PARCEL_OVERLAP_TOL = { absSqft: 10, relOfSmaller: 0.005 };

// Pairwise overlap detection among ACTIVE parcels (active !== false, ring of ≥3 points).
// Returns [{ aId, bId, area }] for every pair whose intersection area clears the tolerance —
// the safety net that catches a superseded parent + child both active (the B651 class) OR any
// two hand-drawn lots that overlap, regardless of how the overlap arose.
export function overlappingParcelPairs(parcels, tol = PARCEL_OVERLAP_TOL) {
  const act = (Array.isArray(parcels) ? parcels : []).filter(
    (p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3);
  const out = [];
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const area = polyIntersectArea(act[i].points, act[j].points);
      if (area <= 0) continue;
      const minA = Math.min(polyArea(act[i].points), polyArea(act[j].points));
      if (area > Math.max(tol.absSqft, tol.relOfSmaller * minA)) out.push({ aId: act[i].id, bId: act[j].id, area });
    }
  }
  return out;
}

// Clipper works on an integer grid → scale feet to centi-feet (~1/8" precision), matching pondOffset.js.
const UNION_SCALE = 100;
const isValidRing = (r) =>
  Array.isArray(r) && r.length >= 3 && r.every((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y));

// True DISSOLVED (union) area in feet² of a site's ACTIVE parcels — overlapping ground counted
// ONCE (B715). The old `parcels.reduce((s,p) => s + polyArea(p.points))` was purely additive, so
// any overlap double-counted the shared ground: a hand-drawn boundary sitting over the real
// parcels (the Martini repro: 176.6 ac vs ~88.6 geometric), a superseded parent left active, a
// duplicated county import. This is the corrective companion to the B652 overlap WARNING (which
// only flags the condition, by design).
//
// FAST PATH — the common, non-overlapping site returns the EXACT additive sum (byte-identical to
// the old number, no clipper rounding jitter): 0/1 valid ring, or no overlapping pair (adjacent
// lots share only an edge = zero-area intersection, below PARCEL_OVERLAP_TOL). Clipper (ctUnion,
// the same engine pondOffset.js uses) runs ONLY when parcels genuinely overlap. Callers on the
// hot render path may pass a precomputed `overlapPairs` (from overlappingParcelPairs) to avoid
// re-running the O(n²) overlap scan twice per render.
export function dissolvedParcelSqft(parcels, overlapPairs) {
  const active = (Array.isArray(parcels) ? parcels : [])
    .filter((p) => p && p.active !== false && isValidRing(p.points));
  const rings = active.map((p) => p.points);
  if (rings.length === 0) return 0;
  /* NEW-2 — SAVE-AND-EXCEPT holes come off the site area. A deed promoted to a parcel carries its
   * carved-out tracts as `exceptions`; that land is inside the outline but is not part of the
   * property, so counting it would overstate the site — and every yield, coverage, detention and
   * mitigation number is computed off this one figure. Deducted from the union too (an exception
   * is interior to its own parcel, so it survives any dissolve of overlapping neighbours). */
  const except = active.reduce((s, p) => s + parcelExceptSqft(p), 0);
  const lessExcept = (a) => Math.max(0, a - except);
  const sum = rings.reduce((s, r) => s + polyArea(r), 0);
  if (rings.length === 1) return lessExcept(sum);
  const pairs = overlapPairs !== undefined ? overlapPairs : overlappingParcelPairs(parcels);
  if (!pairs || !pairs.length) return lessExcept(sum); // no genuine overlap → the sum already counts each once
  try {
    const clip = new ClipperLib.Clipper();
    for (const r of rings) {
      clip.AddPath(
        r.map((pt) => ({ X: Math.round(pt.x * UNION_SCALE), Y: Math.round(pt.y * UNION_SCALE) })),
        ClipperLib.PolyType.ptSubject, true);
    }
    const sol = new ClipperLib.Paths();
    clip.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    // Sum SIGNED areas so any holes (opposite winding) net out; the union can never exceed the
    // additive sum, so clamp — and never silently report 0 for rings that clearly have area.
    let signed = 0;
    for (const p of sol) signed += ClipperLib.Clipper.Area(p);
    const area = Math.abs(signed) / (UNION_SCALE * UNION_SCALE);
    return lessExcept(area > 0 ? Math.min(area, sum) : sum);
  } catch {
    return lessExcept(sum); // degenerate/self-intersecting geometry → the honest additive sum, never a crash or false 0
  }
}

/* ───────────────────────── B2090352 — MERGE PARCELS: A REAL UNION ─────────────────────────
 * `SitePlanner.mergeParcels` used to fuse two lots only when an edge of one had an exact reversed
 * twin in the other (both endpoints within 0.75 ft). Six of seven realistic adjacencies were
 * refused with "parcels don't share a boundary": a neighbour shorter than the lot beside it, one
 * extra vertex on the common line, opposite winding, a 1 ft survey gap or overlap, a 1 ft slide.
 *
 * The merge is now a polygon UNION with a small morphological CLOSE (grow every ring, union, shrink
 * back) so ordinary county-data slop fuses, and a separate CONTACT test so two lots that merely
 * touch at a point, or are genuinely apart, are still refused — and the odd one out is NAMED.
 *
 *   MERGE_GAP_FT  1.5 ft  the widest gap/overlap-slop that still fuses. Each ring grows by half of
 *                         it (+ a hair), so a gap up to ~1.5 ft closes. Far below any street, alley
 *                         or ROW (≥ 20 ft), so two lots across a road are never joined. The price of
 *                         the close is bounded: the merged area can exceed the dissolved area of the
 *                         inputs by at most gap × contact length (0.75% on two 200×100 lots), which
 *                         `mergeParcelRings` enforces and reports.
 *   MERGE_MIN_CONTACT_FT 5 ft  how much common boundary two lots need to count as "touching". A point
 *                         contact measures ~3 ft here (the slop distance either side of the corner), so
 *                         corner-only neighbours stay refused.
 */
export const MERGE_GAP_FT = 1.5;
export const MERGE_MIN_CONTACT_FT = 5;
const MERGE_CLOSE_FT = MERGE_GAP_FT / 2 + 0.05;
const MERGE_MITER = 10; // keeps a sharp convex lot corner exact through grow→shrink (≥ ~12° angles)
const MERGE_SAMPLE_FT = 0.5;

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Length of ringA's boundary that lies within `tol` of ringB's boundary (sampled along A's edges).
function boundaryNear(ringA, ringB, tol) {
  const nb = ringB.length;
  const eb = [];
  for (let i = 0; i < nb; i++) {
    const a = ringB[i], b = ringB[(i + 1) % nb];
    eb.push({ a, b, x0: Math.min(a.x, b.x) - tol, x1: Math.max(a.x, b.x) + tol, y0: Math.min(a.y, b.y) - tol, y1: Math.max(a.y, b.y) + tol });
  }
  let total = 0;
  for (let i = 0; i < ringA.length; i++) {
    const a = ringA[i], b = ringA[(i + 1) % ringA.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const ex0 = Math.min(a.x, b.x), ex1 = Math.max(a.x, b.x), ey0 = Math.min(a.y, b.y), ey1 = Math.max(a.y, b.y);
    const cand = eb.filter((e) => e.x1 >= ex0 && e.x0 <= ex1 && e.y1 >= ey0 && e.y0 <= ey1);
    if (!cand.length) continue;
    const n = Math.max(1, Math.ceil(len / MERGE_SAMPLE_FT));
    const step = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (cand.some((e) => segDist(p, e.a, e.b) <= tol)) total += step;
    }
  }
  return total;
}

/** How much boundary two lots have in common, in feet (gap/overlap slop up to MERGE_GAP_FT counts). */
export function ringContactFt(ringA, ringB, tol = MERGE_GAP_FT + 0.1) {
  if (!isValidRing(ringA) || !isValidRing(ringB)) return 0;
  return Math.max(boundaryNear(ringA, ringB, tol), boundaryNear(ringB, ringA, tol));
}

// The merge works on a MILLI-foot grid (county rings carry 3 decimals), so a lot's own corners and area survive the
// union exactly; the 0.01 ft grid dissolvedParcelSqft uses shifts a 2,000 ft perimeter's area by ~10 sq ft.
const MERGE_SCALE = 1000;
const toClip = (ring) => ring.map((pt) => ({ X: Math.round(pt.x * MERGE_SCALE), Y: Math.round(pt.y * MERGE_SCALE) }));
const fromClip = (path) => path.map((q) => ({ x: q.X / MERGE_SCALE, y: q.Y / MERGE_SCALE }));
const GRID_FT = 1 / MERGE_SCALE;
/* Rebuild a union outline for output. Every vertex lying within half a grid cell of an INPUT vertex becomes
 * that input vertex exactly (the union ran on a centi-foot grid, so a corner can come back 0.004 ft off), and
 * only coincident points and EXACTLY collinear leftovers (≤ 0.1 mm off the neighbours' chord — the
 * debris of a removed shared edge) are dropped. A vertex the union itself CREATED (an intersection, a closed
 * sliver's corner) is still tidied at the old ~0.1 ft tolerance, so closing jitter does not become corners —
 * but an input corner, spike tip or curve facet is never flattened (NEW-1 amendment). */
function tidyRing(ring, inputVerts = [], rings = []) {
  // A kept input vertex that is exactly collinear is debris of the REMOVED shared edge only if it lies on ANOTHER lot's
  // boundary; one sitting on a straight stretch of its own lot's edge is the county's own vertex and stays.
  const onOtherLot = (v) => rings.some((r, k) => k !== v.ri && r.some((a, i) => segDist(v, a, r[(i + 1) % r.length]) <= 0.02));
  const snapped = ring.map((p) => {
    let best = null, bd = GRID_FT * 0.75;
    for (const q of inputVerts) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d <= bd) { bd = d; best = q; } }
    return best ? { x: best.x, y: best.y, kept: true, src: best.src, ri: best.ri } : { x: p.x, y: p.y, kept: false };
  });
  const dedup = [];
  for (const p of snapped) {
    const q = dedup[dedup.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) dedup.push(p);
  }
  if (dedup.length > 1 && Math.hypot(dedup[0].x - dedup[dedup.length - 1].x, dedup[0].y - dedup[dedup.length - 1].y) <= 1e-6) dedup.pop();
  const out = [];
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i - 1 + dedup.length) % dedup.length], b = dedup[i], c = dedup[(i + 1) % dedup.length];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const base = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    const dev = Math.abs(cr) / base;
    if (dev > (b.kept ? 1e-4 : 0.005) || (b.kept && !onOtherLot(b))) out.push({ x: b.x, y: b.y, src: b.src, ri: b.ri });
  }
  return out.length >= 3 ? out : dedup.map((p) => ({ x: p.x, y: p.y, src: p.src, ri: p.ri }));
}

// The TRUE union area of the inputs as drawn — no sliver closing, and none of dissolvedParcelSqft's
// overlap-tolerance fast path (a 1 ft overlap of two 200 ft lots sits under it and would read as additive).
function rawUnionSqft(paths) {
  const clip = new ClipperLib.Clipper();
  clip.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const sol = new ClipperLib.Paths();
  clip.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  let signed = 0;
  for (const q of sol) signed += ClipperLib.Clipper.Area(q);
  return Math.abs(signed) / (MERGE_SCALE * MERGE_SCALE);
}

/**
 * Union a set of parcel rings into ONE outline.
 *  ok:true  → { ring, areaSqft, dissolvedSqft, growthSqft }
 *  ok:false → { code, message, ... } where code is
 *    "invalid"  a ring was not a ≥3-point polygon
 *    "apart"    the lots form more than one touching group → `groups` (index arrays, biggest first)
 *    "hole"     the union would enclose ground that is not in the selection (an out-parcel)
 *    "area"     the sliver-closing changed the area by more than the stated allowance (safety net)
 * Winding-independent; partial shared edges, mid-edge corners and extra collinear points all fuse.
 */
export function mergeParcelRings(rings) {
  let list = Array.isArray(rings) ? rings : [];
  if (list.length < 2 || !list.every(isValidRing)) {
    return { ok: false, code: "invalid", message: "Pick at least two parcels with a closed outline." };
  }
  // 1. Who touches whom (contact ≥ MERGE_MIN_CONTACT_FT), then the connected groups.
  const n = list.length, parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  let totalContact = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const c = ringContactFt(list[i], list[j]);
    if (c >= MERGE_MIN_CONTACT_FT) { totalContact += c; parent[find(i)] = find(j); }
  }
  const byRoot = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); }
  const groups = [...byRoot.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  if (groups.length > 1) {
    return { ok: false, code: "apart", groups, message: "Those parcels don't all touch edge-to-edge." };
  }
  // 2. The outline comes from the ORIGINAL rings. Plain union first — no offsetting at all.
  // Work in a frame centred on the first lot: clipper-lib's integer range is ~1.5e9 before it falls back to
  // emulated 128-bit maths, and a state-plane coordinate (1.4e7 ft) × 1000 is far past it — such rings came out
  // "apart". Translating by a constant is exact, and the planner's own local-feet rings are already near zero.
  const org = { x: Math.round(list[0][0].x), y: Math.round(list[0][0].y) };
  const shifted = list;
  list = shifted.map((r) => r.map((pt) => ({ x: pt.x - org.x, y: pt.y - org.y })));
  try {
    const paths = list.map((r) => { const p = toClip(r); if (!ClipperLib.Clipper.Orientation(p)) p.reverse(); return p; });
    const union = (subject, clipPaths) => {
      const c = new ClipperLib.Clipper();
      c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
      if (clipPaths) c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
      const sol = new ClipperLib.Paths();
      c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      return sol;
    };
    // A hole under a square foot is grid dust where two rings meet (measured: 0.00002 sq ft on a real pair), not an out-parcel.
    const splitOH = (sol) => ({
      outers: sol.filter((q) => ClipperLib.Clipper.Orientation(q)),
      holes: sol.filter((q) => !ClipperLib.Clipper.Orientation(q) && Math.abs(ClipperLib.Clipper.Area(q)) / (MERGE_SCALE * MERGE_SCALE) >= 1),
    });
    const offsetPaths = (src, delta) => {
      const o = new ClipperLib.ClipperOffset(MERGE_MITER, 0.25 * MERGE_SCALE);
      o.AddPaths(src, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const out = new ClipperLib.Paths();
      o.Execute(out, delta);
      return out;
    };
    const close = (src, r) => offsetPaths(offsetPaths(src, r * MERGE_SCALE), -r * MERGE_SCALE);
    let { outers, holes } = splitOH(union(paths));
    if (outers.length !== 1 || holes.length) {
      // Clipper does not always fuse two rings that share an exact edge (measured on a real Harris pair at the milli-foot
      // grid: two outers back for a perfect twin edge). A hairline close — two grid cells, far under anything visible —
      // overlaps them just enough to join, and UNIONING it with the untouched rings keeps every input vertex.
      const eps = union(paths, close(paths, 2 * GRID_FT));
      ({ outers, holes } = splitOH(eps));
      if (outers.length !== 1 || holes.length) {
        // Still more than one piece, or sliver holes along the contact: bring in the full gap-tolerant close, but ONLY
        // to ADD bridging slivers (closed − what we hold, kept where within the gap tolerance of at least two lots).
        // Original ground is never removed.
        const closed = close(paths, MERGE_CLOSE_FT);
        const diff = new ClipperLib.Clipper();
        diff.AddPaths(closed, ClipperLib.PolyType.ptSubject, true);
        diff.AddPaths(eps, ClipperLib.PolyType.ptClip, true);
        const extra = new ClipperLib.Paths();
        diff.Execute(ClipperLib.ClipType.ctDifference, extra, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        const tol = MERGE_GAP_FT + 0.1;
        const bridges = extra.filter((q) => {
          const pts = fromClip(q);
          return pts.some((pt) => list.filter((r) => r.some((a, k) => segDist(pt, a, r[(k + 1) % r.length]) <= tol)).length >= 2);
        });
        ({ outers, holes } = splitOH(union(eps, bridges)));
      }
    }
    if (outers.length !== 1) {
      return { ok: false, code: "apart", groups: list.map((_, i) => [i]), message: "Those parcels don't all touch edge-to-edge." };
    }
    if (holes.length) {
      const holeSqft = holes.reduce((s, h) => s + Math.abs(ClipperLib.Clipper.Area(h)), 0) / (MERGE_SCALE * MERGE_SCALE);
      return { ok: false, code: "hole", holeSqft, message: "Merging these would leave a gap enclosed inside the new parcel (a lot that isn't picked sits in the middle)." };
    }
    const inputVerts = list.flatMap((r, ri) => r.map((pt, k) => ({ x: pt.x, y: pt.y, src: shifted[ri][k], ri })));
    const ring = tidyRing(fromClip(outers[0]), inputVerts, list).map((pt) => (pt.src ? { x: pt.src.x, y: pt.src.y } : { x: pt.x + org.x, y: pt.y + org.y }));
    const areaSqft = polyArea(ring);
    const dissolvedSqft = rawUnionSqft(paths);
    const growthSqft = areaSqft - dissolvedSqft;
    // The safety net compares like with like — the union's own grid outline against the grid union — so the
    // snap-back to unrounded input corners (±half a milli-foot per vertex) can never read as lost ground.
    const checkGrowth = polyArea(fromClip(outers[0])) - dissolvedSqft;
    const allowance = MERGE_GAP_FT * totalContact * 1.05 + 5;
    const gridNoise = list.reduce((sm, r) => sm + r.reduce((q, a, k) => q + Math.hypot(r[(k + 1) % r.length].x - a.x, r[(k + 1) % r.length].y - a.y), 0), 0) * GRID_FT;
    // Never give back less ground than the lots contain (float/grid noise only); growth stays bounded.
    if (ring.length < 3 || checkGrowth > allowance || checkGrowth < -(0.5 + gridNoise)) {
      return { ok: false, code: "area", areaSqft, dissolvedSqft, growthSqft, message: "Merging would have changed the combined area by more than survey slop allows, so nothing was merged." };
    }
    return { ok: true, ring, areaSqft, dissolvedSqft, growthSqft };
  } catch {
    return { ok: false, code: "invalid", message: "Those outlines couldn't be combined." };
  }
}
