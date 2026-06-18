// Pond-expansion geometry (B157) — where to anchor the "added detention area" map label.
//
// When you enlarge an existing pond (B139), the new ground is the EXPANDED footprint minus
// the existing/baseline footprint. We want the "+X ac · +Y sf" label to sit ON that new area
// — specifically on the THICKEST part of it — so it never drifts back into the existing
// basin. That matters because the whole pond's centroid often stays inside the old pond
// (e.g. a uniform "push the banks out" expansion leaves a ring of new ground whose centre of
// mass is the old water), which is exactly the confusing case to avoid.
//
// `addedAreaLabelPoint` returns the pole-of-inaccessibility of (expanded − baseline): the
// interior point of the new ground farthest from any edge. A coarse grid finds the deepest
// cell, then a local grid refines it. Pure (world-feet in / world-feet out), no React/DOM,
// so it unit-tests without a browser. Screening-grade placement, not survey geometry.

// Even-odd ray cast: is point `pt` inside ring `ring` (array of {x,y})?
export const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

// Shortest distance from point `p` to segment a→b.
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

// Shortest distance from point `p` to the closed ring `ring` (includes the closing edge).
const distToRing = (p, ring) => {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const dd = distToSeg(p, ring[i], ring[(i + 1) % n]);
    if (dd < d) d = dd;
  }
  return d;
};

// Deepest interior point of the "added" region = inside `expanded` but outside `baseline`.
// Returns {x,y} in the same (world-feet) frame as the inputs, or null when there is no
// added ground (no expansion, a pure shrink, or a degenerate ring). `coarse`/`fine` are the
// grid subdivisions; the defaults are plenty for a screening label.
export function addedAreaLabelPoint(expanded, baseline, opts = {}) {
  if (!Array.isArray(expanded) || expanded.length < 3) return null;
  if (!Array.isArray(baseline) || baseline.length < 3) return null;
  const coarse = opts.coarse || 28, fine = opts.fine || 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of expanded) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const inAdded = (p) => pointInRing(p, expanded) && !pointInRing(p, baseline);
  // "Depth" of an added-region point = distance to the nearest edge of that region, whose
  // boundary is parts of the outer (expanded) ring and the inner (baseline) ring.
  const score = (p) => Math.min(distToRing(p, expanded), distToRing(p, baseline));
  const search = (x0, y0, x1, y1, n) => {
    let best = null, bestD = -1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      for (let j = 0; j <= n; j++) {
        const p = { x, y: y0 + ((y1 - y0) * j) / n };
        if (!inAdded(p)) continue;
        const d = score(p);
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    return best ? { x: best.x, y: best.y, d: bestD } : null;
  };
  const c = search(minX, minY, maxX, maxY, coarse);
  if (!c) return null;
  const cw = (maxX - minX) / coarse, ch = (maxY - minY) / coarse;
  const r = search(c.x - cw, c.y - ch, c.x + cw, c.y + ch, fine);
  const best = r && r.d >= c.d ? r : c;
  return { x: best.x, y: best.y };
}
