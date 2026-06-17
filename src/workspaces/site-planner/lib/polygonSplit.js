// Parcel-split geometry — pure, dependency-free, unit-tested in test/polygonSplit.test.js.
//
// Two ways to divide a simple polygon (a parcel boundary):
//   • splitPolygonByLine(points, A, B)  — the straight 2-point cut (the Split tool).
//   • splitPolygonByPath(points, path)  — a bent cut along a >=2-vertex polyline.
//
// A straight line through a CONVEX lot makes 2 pieces. Through a CONCAVE lot (L-shape,
// flag lot, U / comb) a single straight line can enter and leave the lot more than once,
// so the honest result is MORE than two pieces (a line crossing the boundary 2k times
// yields k+1 pieces). The old implementation only paired the two extreme crossings, so a
// >2-crossing concave cut produced overlapping/omitting "halves"; a downstream guard then
// refused them. splitPolygonByLine instead pairs ALL crossings even–odd along the line and
// traces every resulting piece, so concave lots split correctly into their real pieces.

// Shoelace area (absolute).
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
};

// Intersection of segment p->q with the infinite line through A,B (if within pq).
function segLineIntersect(p, q, A, B) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = B.x - A.x, sy = B.y - A.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((A.x - p.x) * sy - (A.y - p.y) * sx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return { x: p.x + t * rx, y: p.y + t * ry };
}

// Closest point on segment a-b to point p.
function nearestPointOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Split a simple polygon by the infinite line through A,B. Returns an array of the
// resulting pieces (>=2 rings) or null when the line doesn't actually divide it (misses
// it, only grazes a vertex, etc.). Pieces conserve area exactly and don't overlap; the
// caller still backstops with an area/self-intersection sanity check before saving.
function splitPolygonByLine(points, A, B) {
  const n = points.length;
  if (n < 3) return null;
  const dx = B.x - A.x, dy = B.y - A.y;
  const denom2 = dx * dx + dy * dy || 1;
  const tOf = (P) => ((P.x - A.x) * dx + (P.y - A.y) * dy) / denom2; // position along the cut line
  // Binary side per vertex (>=0 = one side, else the other). Classifying the on-line case
  // to a definite side keeps the boundary's sign sequence cyclic, so the number of crossings
  // is always even — no odd-parity tangency bug to special-case.
  const side = points.map((P) => (dx * (P.y - A.y) - dy * (P.x - A.x) >= 0 ? 1 : -1));
  // Augmented boundary ring: original vertices with a crossing node inserted on every edge
  // whose endpoints straddle the line.
  const R = [];
  for (let i = 0; i < n; i++) {
    const P = points[i], Q = points[(i + 1) % n];
    R.push({ x: P.x, y: P.y, cross: false });
    if (side[i] !== side[(i + 1) % n]) {
      const X = segLineIntersect(P, Q, A, B) || { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
      R.push({ x: X.x, y: X.y, cross: true, t: tOf(X) });
    }
  }
  const m = R.length;
  const crossIdx = [];
  for (let k = 0; k < m; k++) if (R[k].cross) crossIdx.push(k);
  if (crossIdx.length < 2 || crossIdx.length % 2 !== 0) return null;
  // Pair crossings even–odd along the line: each (c0,c1),(c2,c3)… is an interior chord
  // (the line runs inside the lot between them), i.e. one cut edge of the finished pieces.
  const order = crossIdx.slice().sort((u, v) => R[u].t - R[v].t);
  const partner = new Array(m).fill(-1);
  for (let p = 0; p + 1 < order.length; p += 2) {
    partner[order[p]] = order[p + 1];
    partner[order[p + 1]] = order[p];
  }
  const nxt = (k) => (k + 1) % m;
  // Trace pieces: walk a boundary arc forward to the next crossing, hop its interior chord
  // to the partner crossing, continue forward; a piece closes on returning to its start.
  const arcUsed = new Array(m).fill(false);
  const pieces = [];
  for (const s0 of crossIdx) {
    if (arcUsed[s0]) continue;
    const ring = [];
    let s = s0, guard = 0;
    do {
      if (partner[s] < 0) return null; // unpaired crossing — let the caller fall back/refuse
      arcUsed[s] = true;
      ring.push({ x: R[s].x, y: R[s].y });
      let k = nxt(s);
      while (!R[k].cross) { ring.push({ x: R[k].x, y: R[k].y }); k = nxt(k); }
      ring.push({ x: R[k].x, y: R[k].y }); // arrival crossing
      s = partner[k];                      // hop the interior chord to the next arc's start
      if (++guard > m + 4) return null;    // structural safety net
    } while (s !== s0);
    // Drop consecutive coincident vertices (and a coincident closing wrap).
    const dd = [];
    for (const p of ring) if (!dd.length || Math.hypot(dd[dd.length - 1].x - p.x, dd[dd.length - 1].y - p.y) > 1e-7) dd.push(p);
    if (dd.length > 1 && Math.hypot(dd[0].x - dd[dd.length - 1].x, dd[0].y - dd[dd.length - 1].y) <= 1e-7) dd.pop();
    if (dd.length >= 3) pieces.push(dd);
  }
  // Drop zero-area slivers (a cut that only grazes a vertex); a real split needs >=2 pieces.
  const whole = polyArea(points);
  const real = pieces.filter((pc) => polyArea(pc) > whole * 1e-6 + 1e-6);
  return real.length >= 2 ? real : null;
}

// Split a polygon along an open polyline cut (>=2 vertices). The first and last vertices are
// projected onto the nearest polygon edge (entry/exit); interior vertices bend the cut across
// the interior. Returns [ringA, ringB] or null. (Two-point cuts use splitPolygonByLine.)
function splitPolygonByPath(points, path) {
  const n = points.length;
  if (path.length < 2) return null;
  const projectToEdge = (pt) => {
    let best = null;
    for (let i = 0; i < n; i++) {
      const proj = nearestPointOnSeg(pt, points[i], points[(i + 1) % n]);
      const d = (proj.x - pt.x) ** 2 + (proj.y - pt.y) ** 2;
      if (!best || d < best.d) best = { edge: i, point: proj, d };
    }
    return best;
  };
  const inHit = projectToEdge(path[0]);
  const outHit = projectToEdge(path[path.length - 1]);
  if (!inHit || !outHit || inHit.edge === outHit.edge) return null;
  const interior = path.slice(1, -1); // oriented path[0] -> path[last]
  let a1, a2, midPath;
  if (inHit.edge < outHit.edge) { a1 = inHit; a2 = outHit; midPath = interior; }
  else { a1 = outHit; a2 = inHit; midPath = interior.slice().reverse(); }
  const polyA = [a1.point];
  for (let k = a1.edge + 1; k <= a2.edge; k++) polyA.push(points[k % n]);
  polyA.push(a2.point, ...midPath.slice().reverse());
  const polyB = [a2.point];
  for (let k = a2.edge + 1; k <= a1.edge + n; k++) polyB.push(points[k % n]);
  polyB.push(a1.point, ...midPath);
  if (polyA.length < 3 || polyB.length < 3) return null;
  return [polyA, polyB];
}

export { polyArea, segLineIntersect, nearestPointOnSeg, splitPolygonByLine, splitPolygonByPath };
