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
