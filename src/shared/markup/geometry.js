/* Shared markup geometry primitives (B423 / NEW-2).
 *
 * Pure point-math used by every markup surface — the Site Planner canvas, the Document
 * Review sheet, and the Stitcher. Lifted verbatim from `doc-review/lib/takeoff.js` (the
 * measure foundation) and `SitePlanner.jsx` (the drawing helpers) so the two stop carrying
 * their own copies. No imports beyond the shared coordinate units; no React, no DOM.
 *
 * A "point" is { x, y } in WORLD units (feet in the Site Planner; PDF page-units in
 * Document Review). The unit-scale seam that turns those into real feet lives in
 * `measure.js`, never here — geometry is unit-agnostic.
 */

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Total length of a polyline; `closed` adds the wrap-around edge (perimeter loop). */
export function pathLength(pts, closed) {
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

/** Shoelace area of a closed ring (absolute value; degenerate → 0). */
export function polyArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

const avgOf = (pts) => pts.reduce((s, q) => ({ x: s.x + q.x / pts.length, y: s.y + q.y / pts.length }), { x: 0, y: 0 });

/* Midpoint ALONG a polyline by arc length — the true center of the drawn path, not a
 * vertex. `closed` walks the closing edge too. Anchors a distance/perimeter label at the
 * middle of the run, not its first endpoint (B307). */
export function midOfPath(pts, closed = false) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  const seq = closed ? [...pts, pts[0]] : pts;
  const segs = [];
  let total = 0;
  for (let i = 1; i < seq.length; i++) { const L = dist(seq[i - 1], seq[i]); segs.push(L); total += L; }
  if (total === 0) return { x: seq[0].x, y: seq[0].y };
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      return { x: seq[i].x + (seq[i + 1].x - seq[i].x) * t, y: seq[i].y + (seq[i + 1].y - seq[i].y) * t };
    }
    half -= segs[i];
  }
  const last = seq[seq.length - 1];
  return { x: last.x, y: last.y };
}

/* Ray-cast point-in-polygon. Powers centroidOf's interior clamp AND the fill-interior
 * hit-test (a click inside a filled Area selects it). Handles concave / self-touching
 * outlines. */
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/* Label anchor for a filled polygon: the AREA-weighted centroid, clamped inside the
 * shape. A concave / L-shaped region's centroid can fall outside the outline; when it
 * does we drop to the midpoint of the widest interior span on a horizontal scanline
 * through it, so the area label always sits on the shape (B307). Vertex-average fallback
 * for degenerate input. */
export function centroidOf(pts) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  if (pts.length < 3) return avgOf(pts);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return avgOf(pts);
  const c = { x: cx / (6 * a), y: cy / (6 * a) };
  if (pointInPoly(c, pts)) return c;
  const ys = c.y, xs = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y, yj = pts[j].y;
    if ((yi > ys) !== (yj > ys)) xs.push(pts[j].x + ((pts[i].x - pts[j].x) * (ys - yj)) / ((yi - yj) || 1e-12));
  }
  xs.sort((p, q) => p - q);
  let best = null, bw = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) { const w = xs[i + 1] - xs[i]; if (w > bw) { bw = w; best = (xs[i] + xs[i + 1]) / 2; } }
  return best == null ? avgOf(pts) : { x: best, y: ys };
}

/* ---- drawing helpers (from SitePlanner.jsx) ---- */

/** Rotate (x,y) about the origin by `deg` degrees. */
export const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

/** Snap point b onto the nearest 45° ray from a (Shift-constrained drawing). */
export const snap45 = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, r = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + r * Math.cos(ang), y: a.y + r * Math.sin(ang) };
};

/* Nearest point on segment a→b to p (all {x,y}); returns the point + its distance `d`.
 * Lets a Shift-/right-click drop a vertex EXACTLY where the edge was touched (B230), and
 * powers the edge hit-test. */
export const projToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + t * dx, y = a.y + t * dy;
  return { x, y, d: Math.hypot(p.x - x, p.y - y) };
};

/** Axis-aligned bounding box of a point set → { x, y, w, h } (zero box for empty input). */
export function bboxOf(pts) {
  if (!pts || !pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
