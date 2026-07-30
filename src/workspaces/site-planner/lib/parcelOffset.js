/* The SETBACK RING geometry — the inward offset a parcel's buildable envelope is measured from.
 *
 * Lifted verbatim out of `SitePlanner.jsx` (NEW-1) so it can be exercised without a browser. It
 * had lived as a private function in a 20,000-line component, which meant the one geometric
 * statement this app cannot get wrong — "these points and these per-edge setbacks produce THIS
 * envelope" — was only ever provable by rendering. The NON-NEGOTIABLE on the setback role layer
 * ("no site's computed buildable area may change") needs to be checked against the real
 * production function, against a real production parcel, in a unit test; that is why this moved.
 *
 * Pure. Behaviour is unchanged from the shipped version — this is a move, not a rewrite.
 * Planar feet, the app's usual open-ring convention: edge i is pts[i] → pts[i+1].
 */

/* Shoelace area of a ring. Private: the component keeps its own `polyArea` with the B690
 * empty-ring guard for its ~30 other callers; the two rings this one compares are already
 * validated (n ≥ 3), so it stays the bare primitive. */
const ringArea = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
};

/* Intersection of the infinite lines through (x1,y1)→(x2,y2) and (x3,y3)→(x4,y4), or null when
 * they are parallel (within 1e-9). */
export function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/* Inward offset of a polygon. `d` is a scalar OR a per-edge array (one value per
 * edge i = segment pts[i]→pts[i+1]). Robust: offsets each edge by its left normal
 * × sign; where adjacent offset edges don't intersect cleanly (concave spikes) it
 * falls back to a beveled corner instead of bailing on the whole ring. Never
 * returns null for a valid lot. Self-checks the sign by shrink (area) test. */
export function offsetPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  const dist = (i) => (Array.isArray(d) ? (d[i] ?? 0) : d);
  const build = (sign) => {
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let ex = -(b.y - a.y), ey = b.x - a.x; // left normal of edge a→b
      const len = Math.hypot(ex, ey);
      if (len === 0) { off.push(null); continue; }
      const k = (sign * dist(i)) / len;
      off.push({ ax: a.x + ex * k, ay: a.y + ey * k, bx: b.x + ex * k, by: b.y + ey * k });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e1 = off[(i - 1 + n) % n], e2 = off[i];
      if (!e1 && !e2) { out.push(pts[i]); continue; }
      if (!e1) { out.push({ x: e2.ax, y: e2.ay }); continue; }
      if (!e2) { out.push({ x: e1.bx, y: e1.by }); continue; }
      const p = lineIntersect(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
      // Parallel / failed miter → bevel: use the two offset endpoints at this corner.
      if (!p) { out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay }); continue; }
      // Reject a runaway spike (miter way past a sane bevel); bevel instead.
      const lim = Math.max(Math.abs(dist(i)), Math.abs(dist((i - 1 + n) % n))) * 6 + 1;
      if (Math.hypot(p.x - e1.bx, p.y - e1.by) > lim) out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay });
      else out.push(p);
    }
    return out.length >= 3 ? out : null;
  };
  const a1 = build(1);
  if (!a1) return build(-1);
  // Inward offset must shrink the ring; if it grew, we offset the wrong way.
  return ringArea(a1) <= ringArea(pts) ? a1 : (build(-1) || a1);
}

/* Area of the buildable envelope a parcel's per-edge setbacks leave behind, in square feet.
 * This is what "the computed buildable area" means for a lot; 0 when the setbacks consume it. */
export function setbackRingArea(points, setbacks) {
  const ring = offsetPolygon(points || [], setbacks);
  return ring ? ringArea(ring) : 0;
}
