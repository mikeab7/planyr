// Parcel-split geometry — pure, dependency-free, unit-tested in test/polygonSplit.test.js.
//
// Three ways to divide a simple polygon (a parcel boundary):
//   • splitPolygonByCut(points, path)   — THE GENERAL ENGINE (the Split tool's only caller).
//   • splitPolygonByLine(points, A, B)  — the straight infinite-line cut. Retained as an
//     INDEPENDENT ORACLE the general engine is cross-checked against in the unit suite; it is
//     no longer on the app's path.
//   • splitPolygonByPath(points, path)  — RETIRED. The old bent-cut special case, kept only so a
//     regression test can prove what it could not do. Do not call it from app code.
//
// WHY THE GENERAL ENGINE EXISTS (NEW-1). The two shipped splitters between them accepted only
// trivial cuts. `splitPolygonByPath` projected the first and last cut vertex onto the NEAREST
// polygon edge, refused when both landed on the same edge, and emitted exactly TWO rings by
// walking the boundary between them — so it could not represent a cut that crosses the boundary
// more than twice, never checked that the cut stayed inside the lot, and produced overlapping or
// area-losing "halves" whenever the lot was concave. A downstream area guard then refused the
// result with generic advice to "try a straight cut between two opposite edges". Real parcels are
// concave all the time and real splits follow real features — a creek, a road centreline, an
// easement, an existing property line with bends in it — so that guardrail refused the cuts a
// developer actually needs.
//
// HOW THE GENERAL ENGINE WORKS. It builds the PLANAR ARRANGEMENT of the boundary and the cut and
// then enumerates its faces:
//   1. Intersect every cut segment against every boundary edge; collect split parameters on both.
//   2. Snap all resulting points into a shared node registry (a hash grid, so a crossing computed
//      from the edge's side and from the cut's side becomes ONE node).
//   3. Emit boundary sub-edges (all of them) and cut sub-edges (only those whose midpoint is
//      strictly INSIDE the lot — that one test discards the parts of the cut that run outside the
//      parcel or along its boundary, so a cut may start and end anywhere).
//   4. Prune degree-1 nodes repeatedly. A cut that dead-ends inside the lot divides nothing, and
//      this is what removes it — and what makes the refusal message specific.
//   5. Trace faces by taking the next dart clockwise from the reverse dart at each node, then drop
//      the outer face by area bookkeeping.
// Everything falls out of that: a multi-segment cut, a cut crossing the boundary 2k times (k+1
// pieces), a cut that re-enters, a cut that closes a loop inside the lot. There is no "number of
// crossings" case analysis anywhere, which is the whole point.
//
// PROVENANCE. Each piece reports `edgeSrc` — for every edge of the new ring, the index of the
// PARENT ring edge it was cut from, or -1 for an edge the cut itself created. Per-edge parcel data
// (`setbacks`, `roleOverrides`) is remapped through it rather than copied stale, and a brand-new
// cut edge inherits nothing.
//
// HOLES. The parcel model is single-ring (`pc.points`), so there are no interior rings to preserve
// today. The engine is nevertheless ring-topological rather than boundary-walking, so adding hole
// rings later means feeding their sub-edges into the same arrangement — not a rewrite.

// Shoelace area (absolute).
const polyArea = (pts) => Math.abs(signedArea(pts));

// Shoelace area with sign (positive = counter-clockwise in a y-up frame).
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

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

// RETIRED (see the header). The old bent-cut special case: project the first and last vertex onto
// the nearest polygon edge and walk the boundary between them. Two pieces at most, no interior
// containment test, and wrong on any concave lot. Retained ONLY as the pre-fix oracle the unit
// suite proves the general engine against — never call it from app code.
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

/* ------------------------------------------------------------------ *
 *  The general engine.
 * ------------------------------------------------------------------ */

// Why a refusal happened, in a form the caller can turn into copy. LOUD-FAILURE: every path out of
// splitPolygonByCut that produces no pieces names its own reason — there is no generic advice.
const CUT_REASONS = {
  "bad-parcel": "That parcel's outline is too simple to divide (it needs at least three corners).",
  "bad-cut": "That cut has no length — draw a line across the parcel.",
  "outside": "That cut never crosses the parcel — draw it across the land you want to divide.",
  "dead-end": "That cut stops inside the parcel, so it doesn't divide anything — carry it all the way across to the far boundary.",
  "along-boundary": "That cut runs along the property line instead of across it, so there is nothing on both sides of it.",
  "no-division": "That cut touches the parcel but doesn't separate it into pieces — carry it across to a different part of the boundary.",
  "area-mismatch": "That cut couldn't be resolved cleanly — the pieces don't add back up to the original acreage, so nothing was changed.",
  "self-intersecting": "That cut produces a piece whose outline crosses itself, so nothing was changed.",
  "parcel-self-crossing": "That parcel's own outline crosses itself, so its acreage and the land it encloses disagree — fix the outline before splitting it.",
};

// How far a parcel's quoted (shoelace) acreage may sit from the land its outline actually
// encloses before the split refuses rather than reports it. One part in ten thousand.
const SELF_OVERLAP_TOL = 1e-4;

// A resulting piece smaller than this fraction of the parent is a scrap, not a parcel. Dropped —
// and always reported back, so nothing about the drop is silent.
const SLIVER_FRACTION = 1e-5;

const fail = (code, extra) => ({ ok: false, pieces: null, code, message: CUT_REASONS[code] || CUT_REASONS["no-division"], ...extra });

// Drop consecutive coincident points. Returns the surviving points plus, for each, the index it
// held in the input — so edge provenance can be reported against the ORIGINAL ring.
function dedupePts(pts, closed, tol) {
  const out = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) <= tol) continue;
    out.push({ x: p.x, y: p.y }); idx.push(i);
  }
  if (closed && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) { out.pop(); idx.pop(); }
  }
  return { pts: out, idx };
}

function bboxDiag(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return Math.hypot(maxx - minx, maxy - miny);
}

// Distance from p to segment a-b.
function distToSeg(p, a, b) {
  const q = nearestPointOnSeg(p, a, b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/* WHY WINDING AND NOT EVEN-ODD, which is what every other containment test in this file used to
 * do. Real recorded parcels are not textbook simple polygons. The owner's Goose Creek 95-acre lot
 * is PINCHED: its ring runs out to a point, around an interior exclusion CLOCKWISE while the rest
 * of the lot runs counter-clockwise, and back through that same point — a hole joined to the
 * outside by a zero-width slit. Under even-odd the exclusion reads as land; under the winding rule
 * it reads as the hole it is, which is also exactly what the shoelace acreage the whole app quotes
 * already assumes. Getting these two rules to agree is what makes "the pieces sum to the original
 * acreage" a real check rather than a coincidence. */
function windingNumber(p, ring) {
  const isLeft = (a, b, q) => (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y);
  let wn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a.y <= p.y) { if (b.y > p.y && isLeft(a, b, p) > 0) wn++; }
    else if (b.y <= p.y && isLeft(a, b, p) < 0) wn--;
  }
  return wn;
}

const onRing = (p, ring, tol) => {
  for (let i = 0; i < ring.length; i++) if (distToSeg(p, ring[i], ring[(i + 1) % ring.length]) <= tol) return true;
  return false;
};

// Strict interior test: enclosed by the ring AND not within `tol` of it.
const strictlyInside = (p, ring, tol) => !onRing(p, ring, tol) && windingNumber(p, ring) !== 0;

// Point-in-or-on the ring (used only to decide whether a cut END needs extending).
const insideOrOn = (p, ring, tol) => onRing(p, ring, tol) || windingNumber(p, ring) !== 0;

// A tolerance-snapping node registry. A crossing computed from the boundary edge's parameters and
// the same crossing computed from the cut segment's differ in the last bits; without this they
// would become two nodes and the arrangement would fall apart into dangling stubs.
function makeNodes(tol) {
  const cell = Math.max(tol, 1e-12) * 2;
  const grid = new Map();
  const pts = [];
  const key = (cx, cy) => `${cx},${cy}`;
  return {
    pts,
    id(x, y) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const i of bucket) if (Math.hypot(pts[i].x - x, pts[i].y - y) <= tol) return i;
      }
      const id = pts.length;
      pts.push({ x, y });
      const k = key(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(id);
      return id;
    },
  };
}

/**
 * Divide a simple polygon along an arbitrary cut polyline.
 *
 * @param {{x:number,y:number}[]} points  the parcel ring (open; the closing edge is implied)
 * @param {{x:number,y:number}[]} path    the cut, 2+ vertices, open
 * @param {object} [opts]
 * @param {boolean} [opts.extendEnds=true]  carry a cut end that stopped INSIDE the lot outward
 *        along its own bearing until it leaves. This is what makes a hand-drawn cut usable and it
 *        is the same forgiveness the straight-line splitter always had (it cut along the INFINITE
 *        line through the two clicked points). An end that already sits outside or on the boundary
 *        is left exactly where the user put it. Pass false for strict segment semantics.
 * @param {number} [opts.areaTol=1e-6]  relative area-conservation tolerance for the final check.
 * @returns {{ok:true, pieces:{ring:Array,edgeSrc:number[],area:number}[], extended:boolean}
 *          |{ok:false, pieces:null, code:string, message:string}}
 */
function splitPolygonByCut(points, path, opts = {}) {
  if (!Array.isArray(points) || !Array.isArray(path)) return fail("bad-parcel");
  const rough = bboxDiag(points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) || 1;
  const tol = Math.max(1e-9, rough * 1e-9);

  const ringD = dedupePts(points, true, tol);
  const ring = ringD.pts;
  if (ring.length < 3) return fail("bad-parcel");
  const cutD = dedupePts(path, false, tol);
  let cut = cutD.pts;
  if (cut.length < 2) return fail("bad-cut");

  const diag = bboxDiag(ring) || 1;
  const whole = polyArea(ring);
  if (!(whole > 0)) return fail("bad-parcel");

  // Carry a cut end that stopped inside the lot out past the boundary along its own bearing.
  let extended = false;
  if (opts.extendEnds !== false) {
    const reach = diag * 4;
    const push = (from, toward) => {
      const dx = toward.x - from.x, dy = toward.y - from.y;
      const L = Math.hypot(dx, dy) || 1;
      return { x: toward.x + (dx / L) * reach, y: toward.y + (dy / L) * reach };
    };
    if (strictlyInside(cut[0], ring, tol)) {
      cut = [push(cut[1], cut[0]), ...cut.slice(1)];
      extended = true;
    }
    const last = cut.length - 1;
    if (strictlyInside(cut[last], ring, tol)) {
      cut = [...cut.slice(0, last), push(cut[last - 1], cut[last])];
      extended = true;
    }
  }

  /* ---- 1/2. intersections + node registry ---- */
  const nodes = makeNodes(tol);
  const n = ring.length, m = cut.length - 1;
  const edgeParams = Array.from({ length: n }, () => [0, 1]);   // t along each boundary edge
  const cutParams = Array.from({ length: m }, () => [0, 1]);    // u along each cut segment

  const addParam = (list, v) => { if (v > 1e-12 && v < 1 - 1e-12) list.push(v); };

  /* The boundary is noded against ITSELF first. Recorded parcels carry digitizing spikes — the
   * owner's 109-acre Bain lot runs 1,296 ft out along a zero-width prong and back, and the
   * returning leg clips the outgoing one two tenths of an inch from its base. Left un-noded, that
   * hairline crossing has no node, the face walk runs through it, and the arrangement is
   * nonsense. Noding it costs one n² pass over a ring of a few dozen edges and makes the engine
   * indifferent to spikes, pinches and touching vertices alike. */
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const rx = q.x - p.x, ry = q.y - p.y;
    for (let k = i + 1; k < n; k++) {
      if (k === i || (k + 1) % n === i || (i + 1) % n === k) continue; // adjacent edges share a vertex by construction
      const a = ring[k], b = ring[(k + 1) % n];
      const sx = b.x - a.x, sy = b.y - a.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) <= 1e-12 * (Math.hypot(rx, ry) * Math.hypot(sx, sy) + 1)) continue;
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
      const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
      if (t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) {
        addParam(edgeParams[i], t);
        addParam(edgeParams[k], u);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const rx = q.x - p.x, ry = q.y - p.y;
    for (let j = 0; j < m; j++) {
      const a = cut[j], b = cut[j + 1];
      const sx = b.x - a.x, sy = b.y - a.y;
      const denom = rx * sy - ry * sx;
      if (Math.abs(denom) > 1e-12 * (Math.hypot(rx, ry) * Math.hypot(sx, sy) + 1)) {
        const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
        const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
        if (t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) {
          addParam(edgeParams[i], t);
          addParam(cutParams[j], u);
        }
      }
      // Endpoint / collinear touches: a cut vertex resting on a boundary edge, or a boundary
      // vertex resting on the cut. Proper-crossing maths misses both, and missing either is what
      // leaves an unjoined stub in the arrangement.
      for (const [pt, list, aa, bb] of [[a, edgeParams[i], p, q], [b, edgeParams[i], p, q]]) {
        if (distToSeg(pt, aa, bb) <= tol) {
          const L2 = (bb.x - aa.x) ** 2 + (bb.y - aa.y) ** 2 || 1;
          addParam(list, ((pt.x - aa.x) * (bb.x - aa.x) + (pt.y - aa.y) * (bb.y - aa.y)) / L2);
        }
      }
      for (const pt of [p, q]) {
        if (distToSeg(pt, a, b) <= tol) {
          const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
          addParam(cutParams[j], ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / L2);
        }
      }
    }
  }

  /* ---- 3. edges ---- */
  const edges = new Map(); // "a|b" (a<b) -> { a, b, src }
  const addEdge = (ia, ib, src) => {
    if (ia === ib) return;
    const k = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
    const prev = edges.get(k);
    if (prev) { if (prev.src < 0 && src >= 0) prev.src = src; return; } // a boundary edge outranks a cut edge drawn over it
    edges.set(k, { a: ia, b: ib, src });
  };

  const along = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const ts = [...new Set(edgeParams[i])].sort((u, v) => u - v);
    const src = ringD.idx[i]; // provenance against the ORIGINAL ring index
    for (let k = 0; k + 1 < ts.length; k++) {
      const A = along(p, q, ts[k]), B = along(p, q, ts[k + 1]);
      addEdge(nodes.id(A.x, A.y), nodes.id(B.x, B.y), src);
    }
  }
  let cutEdgesBefore = 0;
  for (let j = 0; j < m; j++) {
    const a = cut[j], b = cut[j + 1];
    const us = [...new Set(cutParams[j])].sort((u, v) => u - v);
    for (let k = 0; k + 1 < us.length; k++) {
      const A = along(a, b, us[k]), B = along(a, b, us[k + 1]);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      if (!strictlyInside(mid, ring, tol)) continue; // outside the lot, or running along its line
      cutEdgesBefore++;
      addEdge(nodes.id(A.x, A.y), nodes.id(B.x, B.y), -1);
    }
  }
  if (!cutEdgesBefore) {
    // Nothing of the cut lies inside the lot. Distinguish "misses it" from "hugs the line".
    let touches = false;
    for (const p of cut) if (insideOrOn(p, ring, tol)) { touches = true; break; }
    return fail(touches ? "along-boundary" : "outside");
  }

  /* ---- 4. prune dangling ends ---- */
  const deg = new Map();
  const bump = (id, d) => deg.set(id, (deg.get(id) || 0) + d);
  for (const e of edges.values()) { bump(e.a, 1); bump(e.b, 1); }
  let pruned = 0;
  for (let pass = 0; pass < 4096; pass++) {
    let removed = 0;
    for (const [k, e] of [...edges]) {
      if (deg.get(e.a) === 1 || deg.get(e.b) === 1) {
        edges.delete(k); bump(e.a, -1); bump(e.b, -1); removed++;
        if (e.src < 0) pruned++;
      }
    }
    if (!removed) break;
  }
  const cutEdgesLeft = [...edges.values()].filter((e) => e.src < 0).length;
  if (!cutEdgesLeft) return fail(pruned ? "dead-end" : "no-division");

  /* ---- 5. face tracing ---- */
  const darts = []; // { from, to, src, twin }
  for (const e of edges.values()) {
    const i = darts.length;
    darts.push({ from: e.a, to: e.b, src: e.src, twin: i + 1 });
    darts.push({ from: e.b, to: e.a, src: e.src, twin: i });
  }
  const out = new Map(); // node -> dart ids, sorted CCW by bearing
  for (let i = 0; i < darts.length; i++) {
    const d = darts[i];
    if (!out.has(d.from)) out.set(d.from, []);
    out.get(d.from).push(i);
  }
  const bearing = (i) => {
    const d = darts[i], A = nodes.pts[d.from], B = nodes.pts[d.to];
    return Math.atan2(B.y - A.y, B.x - A.x);
  };
  const rank = new Map(); // dart id -> its position in its origin node's CCW order
  for (const [, list] of out) {
    list.sort((a, b) => bearing(a) - bearing(b));
    list.forEach((id, i) => rank.set(id, i));
  }
  // Next dart of the face: from the reverse dart, step one CLOCKWISE around the arrival node.
  const nextDart = (i) => {
    const rev = darts[i].twin;
    const list = out.get(darts[rev].from);
    const r = rank.get(rev);
    return list[(r - 1 + list.length) % list.length];
  };

  const seen = new Array(darts.length).fill(false);
  const faces = [];
  for (let s = 0; s < darts.length; s++) {
    if (seen[s]) continue;
    const ringIds = [], srcs = [];
    let d = s, guard = 0;
    do {
      seen[d] = true;
      ringIds.push(darts[d].from);
      srcs.push(darts[d].src);
      d = nextDart(d);
      if (++guard > darts.length + 4) return fail("area-mismatch"); // structural safety net
    } while (d !== s);
    if (ringIds.length < 3) continue;
    const ptsR = ringIds.map((id) => ({ ...nodes.pts[id] }));
    const signed = signedArea(ptsR);
    if (Math.abs(signed) <= whole * 1e-9) continue; // the hairline face a noded spike leaves behind
    faces.push({ ring: ptsR, edgeSrc: srcs, signed });
  }

  /* Keep the faces that are LAND. A face is land when a point strictly inside it is enclosed by
   * the parent ring under the winding rule — which drops the outer face, and equally drops a
   * pinched-off interior exclusion, without either being special-cased. Classifying by orientation
   * instead (the obvious shortcut) silently readmits a hole as a piece and puts acreage on the plan
   * that the parcel never had. */
  const keep = faces.filter((f) => {
    // The traversal turns as clockwise as it can at every node, which walks BOUNDED faces
    // counter-clockwise and each component's OUTER cycle the other way — so the sign is the
    // boundedness test, and it is pinned by unit test rather than trusted.
    if (f.signed <= 0) return false;
    const probe = interiorProbe(f.ring, tol);
    return probe ? windingNumber(probe, ring) !== 0 : false;
  });

  const areaTol = Number.isFinite(opts.areaTol) ? opts.areaTol : 1e-6;
  const total = keep.reduce((s, f) => s + Math.abs(f.signed), 0);
  /* CONSERVATION, and the one honest exception. The kept faces tile the land by construction, so
   * this compares that tiling against the parcel's OWN quoted acreage — the shoelace figure the
   * badge and every yield number read. They can legitimately disagree by a hair on a recorded
   * parcel whose outline overlaps itself: the shoelace counts a doubly-wound sliver twice, the
   * land only exists once. The owner's Bain tract does exactly this — 8 sf on 109 acres, from a
   * 1,296 ft zero-width prong whose returning leg clips its own base two tenths of an inch up.
   * Refusing his largest parcel over that would be absurd; hiding it would be worse. So a
   * discrepancy the crossing EXPLAINS, and that stays microscopic, is reported as `outlineDrift`
   * for the caller to surface; anything bigger, or any discrepancy with no crossing to explain
   * it, is still a hard refusal. */
  const drift = Math.abs(total - whole);
  let outlineDrift = null;
  if (drift > whole * areaTol + 1e-9) {
    if (!polySelfIntersects(ring)) return fail("area-mismatch");
    if (drift > whole * SELF_OVERLAP_TOL) return fail("parcel-self-crossing", { sqft: drift });
    outlineDrift = { sqft: whole - total };
  }

  const traced = keep
    .map((f) => ({ ring: f.ring, edgeSrc: f.edgeSrc, area: Math.abs(f.signed) }))
    .sort((a, b) => b.area - a.area);
  /* SLIVERS. A scrap a millionth the size of the tract is not a parcel — it is either a corner
   * clipped by the cut or, on the Bain tract, the doubly-wound crumb its own broken outline
   * leaves behind. Two zero-acre "parcels" appearing on his plan would be worse than useless. So
   * they are dropped — but their count and total area are RETURNED, never swallowed, and the
   * caller says so on screen. */
  const slivered = traced.filter((p) => p.area <= whole * SLIVER_FRACTION);
  const pieces = traced.filter((p) => p.area > whole * SLIVER_FRACTION);
  const slivers = slivered.length
    ? { count: slivered.length, area: slivered.reduce((a, p) => a + p.area, 0) }
    : null;
  if (pieces.length < 2) return fail("no-division");
  if (pieces.some((p) => polySelfIntersects(p.ring))) return fail("self-intersecting");
  return { ok: true, pieces, extended, outlineDrift, slivers };
}

/* A point strictly inside a traced face. Its centroid is not usable — a face can be any shape at
 * all — so this steps a short way off each edge along that edge's inward normal (inward being the
 * side the face's own orientation puts it on) and returns the first probe the face genuinely
 * contains. Faces here can be long and thin, so the offset is tried at three depths before an edge
 * is given up on. */
function interiorProbe(ringPts, tol) {
  const N = ringPts.length;
  const sign = signedArea(ringPts) >= 0 ? 1 : -1;
  for (const frac of [0.25, 0.05, 0.005]) {
    for (let i = 0; i < N; i++) {
      const a = ringPts[i], b = ringPts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L <= tol) continue;
      const step = Math.max(L * frac, tol * 4);
      // Left of the travel direction is inside for a counter-clockwise ring.
      const px = (a.x + b.x) / 2 - (dy / L) * step * sign;
      const py = (a.y + b.y) / 2 + (dx / L) * step * sign;
      const probe = { x: px, y: py };
      if (!onRing(probe, ringPts, tol) && windingNumber(probe, ringPts) !== 0) return probe;
    }
  }
  return null;
}

// Proper-crossing self-intersection test (a ring that merely TOUCHES itself at a node — which a
// legitimate pinch-point cut produces — is not an intersection).
function polySelfIntersects(pts) {
  const n = pts.length;
  const cross = (p1, p2, p3, p4) => {
    const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
    return !!o1 && !!o2 && !!o3 && !!o4 && o1 !== o2 && o3 !== o4;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((i + 1) % n === j || (j + 1) % n === i) continue;
    if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

/**
 * Carry a per-edge vector (pc.setbacks, pc.roleOverrides) from the parent ring onto a piece.
 * An edge the CUT created has no parent, so it takes `fresh` — never a stale neighbour's value.
 * Returns null when the parent had nothing, so an untouched parcel gains no keys.
 */
function remapEdgeVector(vec, edgeSrc, fresh = null) {
  if (!Array.isArray(vec) || !vec.length) return null;
  const out = edgeSrc.map((s) => (s >= 0 && s < vec.length ? vec[s] : fresh));
  return out.some((v) => v != null) ? out : null;
}

export {
  polyArea, signedArea, segLineIntersect, nearestPointOnSeg,
  splitPolygonByLine, splitPolygonByPath,
  splitPolygonByCut, remapEdgeVector, polySelfIntersects, CUT_REASONS,
};
