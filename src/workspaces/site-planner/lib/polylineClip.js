/* Polyline ↔ polygon clipping + smoothing (ROUND 5 — proposed contours, NEW-2/NEW-3).
 *
 * Pure, dependency-free, worker-safe: used by the terrain worker's proposed-contour tracer (contourTrace.js —
 * clip the traced lines to the daylight line, cut them out of the building pads) AND by the main-thread existing
 * contour paint (contours.js / terrainLayers.js — keep the existing lines OUTSIDE the same daylight line). ONE
 * clipper on both sides is what makes the two families meet at the line: the proposed contour of level E ends
 * exactly where the existing contour of level E starts, because both are cut by the same ring at the same
 * crossing point.
 *
 * Points are [x, y] pairs in ANY planar frame (lattice pixels, feet, or degrees — the arithmetic is affine), rings
 * are arrays of [x, y] (closed implicitly). `inside` is the even-odd rule over the ring SET (a hole ring toggles). */

/* Even-odd point-in-ring-set. */
export function pointInRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

/* Parameters t ∈ (0,1) along segment a→b where it crosses any ring edge, sorted ascending. */
function crossings(a, b, rings) {
  const ts = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const c = ring[j], d = ring[i];
      const ex = d[0] - c[0], ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((p, q) => p - q);
  return ts;
}

/* Split a polyline at every ring crossing and keep the pieces that are INSIDE (keepInside) or OUTSIDE the ring set.
 * Each kept piece starts/ends exactly on the crossing point. A piece with < 2 points is dropped. */
export function clipPolyline(line, rings, { keepInside = true } = {}) {
  if (!line || line.length < 2) return [];
  if (!rings || !rings.length) return keepInside ? [] : [line.map((p) => [p[0], p[1]])];
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length >= 2) out.push(cur); cur = []; };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    // the segment, split at every ring crossing: every sub-segment is wholly inside or wholly outside, so its
    // MIDPOINT classifies it (never a toggle count — a tangent touch would miscount)
    const pts = [[a[0], a[1]]];
    for (const t of crossings(a, b, rings)) pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    pts.push([b[0], b[1]]);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      const keep = pointInRings([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], rings) === keepInside;
      if (!keep) { flush(); continue; }
      if (!cur.length) cur.push(p);
      cur.push(q);
    }
  }
  flush();
  return out;
}

/* Chaikin corner cutting, `passes` times. An open polyline keeps its two endpoints; a closed ring (first == last)
 * stays closed. Every output vertex is a 1:3 / 3:1 blend of two inputs, so no vertex lies on an input vertex
 * (and so, after tracing, none sits on a lattice cell edge). */
export function chaikin(line, passes = 2) {
  if (!line || line.length < 3) return line ? line.map((p) => [p[0], p[1]]) : [];
  let pts = line.map((p) => [p[0], p[1]]);
  const closed = pts.length > 3 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9;
  if (closed) pts = pts.slice(0, -1);
  for (let k = 0; k < passes; k++) {
    const next = [];
    const n = pts.length;
    const segs = closed ? n : n - 1;
    if (!closed) next.push(pts[0]);
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) next.push(pts[n - 1]);
    pts = next;
  }
  if (closed) pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

export function polylineLength(line) {
  let L = 0;
  for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return L;
}

/* The point at arc-length fraction `f` along the line, plus the local direction (radians) there. */
export function pointAlong(line, f = 0.5) {
  const L = polylineLength(line);
  if (!(L > 0)) return { x: line[0][0], y: line[0][1], angle: 0 };
  let want = L * Math.max(0, Math.min(1, f)), acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + d >= want || i === line.length - 1) {
      const t = d > 0 ? Math.max(0, Math.min(1, (want - acc) / d)) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    acc += d;
  }
  return { x: line[0][0], y: line[0][1], angle: 0 };
}

/* The STAIRCASE signature: consecutive vertices on lattice cell edges that step between the two edge orientations (an
 * x-grid-line vertex, then a y-grid-line vertex, …) — what marching squares without interpolation draws. A straight
 * contour lying along ONE grid line is not a staircase and does not count. Returns the longest such run; interpolation +
 * smoothing leaves none longer than 2. Lattice in the LINE's own frame. */
export function longestCellEdgeRun(line, { x0 = 0, y0 = 0, dx = 1, dy = 1, eps = 1e-6 } = {}) {
  let run = 0, best = 0, prev = 0;      // prev: 1 = on an x grid line, 2 = on a y grid line, 0 = off
  for (const [x, y] of line) {
    const fx = Math.abs(((x - x0) / dx) % 1), fy = Math.abs(((y - y0) / dy) % 1);
    const onX = Math.min(fx, 1 - fx) < eps, onY = Math.min(fy, 1 - fy) < eps;
    const kind = onX && !onY ? 1 : onY && !onX ? 2 : onX && onY ? 3 : 0;
    if (kind && prev && kind !== prev) run += 1; else run = kind ? 1 : 0;
    if (run > best) best = run;
    prev = kind;
  }
  return best;
}

/* The longest run of CONSECUTIVE vertices sitting on a cell CORNER (on an x grid line AND a y grid line). A cell-edge
   outline is nothing but such vertices — a staircase — while a traced, interpolated, smoothed line almost never lands
   on one. Stricter than `longestCellEdgeRun` (which resets at every corner, so a pure staircase reads 1). */
export function longestCornerRun(line, { x0 = 0, y0 = 0, dx = 1, dy = 1, eps = 1e-6 } = {}) {
  let run = 0, best = 0;
  for (const [x, y] of line) {
    const fx = Math.abs(((x - x0) / dx) % 1), fy = Math.abs(((y - y0) / dy) % 1);
    run = Math.min(fx, 1 - fx) < eps && Math.min(fy, 1 - fy) < eps ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/* Does the polyline cross itself? O(n²) on the segment pairs — contour lines are short. */
export function selfIntersects(line) {
  const n = line.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (i === 0 && j === n - 2 && line[0][0] === line[n - 1][0] && line[0][1] === line[n - 1][1]) continue; // closing edge of a ring
      const a = line[i], b = line[i + 1], c = line[j], d = line[j + 1];
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true;
    }
  }
  return false;
}

/* Push a ring outward by `d` (vertex normals averaged from the two edges; outward decided by the signed area), for a
 * cut that has to take the one-cell interpolation band around a flat pad with it. Convex-ish rings only (a building). */
export function expandRing(ring, d) {
  const n = ring.length;
  if (n < 3 || !d) return ring.map((p) => [p[0], p[1]]);
  let area = 0;
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], q = ring[i], r = ring[(i + 1) % n];
    const e1 = [q[0] - p[0], q[1] - p[1]], e2 = [r[0] - q[0], r[1] - q[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    // outward normal of each edge for this winding, averaged
    const n1 = [sgn * e1[1] / l1, -sgn * e1[0] / l1], n2 = [sgn * e2[1] / l2, -sgn * e2[0] / l2];
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) { nx = n1[0]; ny = n1[1]; } else { const dot = Math.max(0.5, (n1[0] * n2[0] + n1[1] * n2[1] + 1) / 2); nx = nx / nl / Math.sqrt(dot); ny = ny / nl / Math.sqrt(dot); }
    out.push([q[0] + nx * d, q[1] + ny * d]);
  }
  return out;
}
