/* Edge "runs" — group a parcel's boundary edges into logical SIDES (B197).
 *
 * A surveyed/imported parcel side is often digitized as many near-collinear
 * segments (Mesa's east side ≈ 10 edges). Editing a setback per-edge is tedious
 * and stacks one dimension label per segment (B198). A "run" is a maximal chain
 * of CONTIGUOUS edges whose bearing stays within a small tolerance of the run's
 * first edge — i.e. one logical side. Clicking any edge then selects its whole
 * run, a setback applies uniformly across the run, and the run gets ONE length
 * dimension instead of one per segment.
 *
 * Pure + dependency-free + unit-tested. All math is planar feet (the app's
 * EPSG:2278 frame); the same code works on any {x,y} ring. Edge i is the segment
 * points[i] → points[(i+1) % n] (the standard parcel/markup convention).
 */

// Directed bearing of segment a→b, degrees in [0,360). Planar; +x = 0°, CCW positive.
export function segBearing(a, b) {
  const d = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

// Smallest absolute difference between two bearings, in [0,180].
export function bearingDelta(p, q) {
  const d = (((p - q) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

// Point at arc-length `target` along an open polyline of vertices (clamped to its ends).
function pointAtArcLen(verts, target) {
  if (!verts.length) return { x: 0, y: 0 };
  if (verts.length === 1) return { x: verts[0].x, y: verts[0].y };
  let acc = 0;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i], b = verts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (i === verts.length - 2 || acc + seg >= target) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (target - acc) / seg)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }
  const last = verts[verts.length - 1];
  return { x: last.x, y: last.y };
}

/* Partition a closed polygon's edges into runs (logical sides).
 *
 * `points`  — ring of {x,y} (not repeated; the close is implicit).
 * `tolDeg`  — bearing tolerance; an edge joins the current run only while its
 *             bearing is within `tolDeg` of the run's FIRST edge (anchoring to the
 *             run start, not the previous edge, so a long gentle curve splits into
 *             several runs instead of being swallowed as one side). Default 8°.
 *
 * Returns runs covering every edge exactly once. A run that straddles the index-0
 * seam is merged (the digitizer may have started mid-side). Each run:
 *   { edges:[i…], vertices:[{x,y}…], lengthFt, mid:{x,y} }
 * where `edges` is the ordered chain (may wrap, e.g. [n-1, 0, 1]), `vertices` is
 * start-of-first-edge … end-of-last-edge, `lengthFt` is the run's total length, and
 * `mid` is its arc-length midpoint (for placing one label/pill per side, B198).
 */
export function edgeRuns(points, tolDeg = 8) {
  const n = points ? points.length : 0;
  if (n < 2) return [];
  const bearings = [];
  for (let i = 0; i < n; i++) bearings.push(segBearing(points[i], points[(i + 1) % n]));

  // For a 2-point "ring" there's a single edge (the back edge is degenerate); 1 run.
  const edgeCount = n === 2 ? 1 : n;

  // Greedy partition over edges 0..edgeCount-1, anchored to each run's first bearing.
  const runsIdx = [];
  let cur = [0], anchor = bearings[0];
  for (let i = 1; i < edgeCount; i++) {
    if (bearingDelta(bearings[i], anchor) <= tolDeg) cur.push(i);
    else { runsIdx.push(cur); cur = [i]; anchor = bearings[i]; }
  }
  runsIdx.push(cur);

  // Wrap-merge: if the last and first runs are collinear (and they're different
  // runs, and there are ≥3 of them so we never collapse a thin 2-sided sliver),
  // the side straddles index 0 — fold the last run's edges onto the front of the first.
  if (runsIdx.length >= 3) {
    const first = runsIdx[0], last = runsIdx[runsIdx.length - 1];
    if (bearingDelta(bearings[first[0]], bearings[last[0]]) <= tolDeg) {
      runsIdx[0] = [...last, ...first];
      runsIdx.pop();
    }
  }

  return runsIdx.map((edges) => {
    const verts = [points[edges[0]]];
    let lengthFt = 0;
    for (const e of edges) {
      const a = points[e], b = points[(e + 1) % n];
      lengthFt += Math.hypot(b.x - a.x, b.y - a.y);
      verts.push(b);
    }
    return { edges, vertices: verts, lengthFt, mid: pointAtArcLen(verts, lengthFt / 2) };
  });
}

// The run object containing edge `edgeIndex`, or null.
export function runOfEdge(runs, edgeIndex) {
  return (runs || []).find((r) => r.edges.includes(edgeIndex)) || null;
}

/* The single setback value shared across a run, or null if its edges disagree
 * ("mixed" — a per-segment override is in play). `sb` is the per-edge setback
 * array (one value per edge); `eps` is the feet tolerance for "equal". */
export function runSetbackValue(run, sb, eps = 0.05) {
  if (!run || !run.edges.length || !Array.isArray(sb)) return null;
  const first = sb[run.edges[0]];
  if (first == null) return null;
  return run.edges.every((i) => Math.abs((sb[i] ?? 0) - first) <= eps) ? first : null;
}
