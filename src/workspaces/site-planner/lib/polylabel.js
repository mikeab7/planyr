/* Pole of inaccessibility — the point INSIDE a polygon that is furthest from its boundary (NEW-3).
 *
 * The parcel acreage badge ("Parcel 62.7 ac") used to be painted at the ring's plain VERTEX
 * AVERAGE. That is not a centre of anything: it is pulled toward whichever side was digitized
 * with the most points. On the owner's Weld County CO parcel — a long irregular strip whose
 * subdivision edge carries dozens of short segments while the opposite side is two long ones —
 * the average landed well off the parcel, so the badge floated over the neighbour's land
 * (owner, 2026-07-30, with a screenshot). The area centroid is no better on that shape: for a
 * long bent strip it can sit outside the polygon entirely.
 *
 * The pole of inaccessibility is the right answer to "where does this label look centred": it is
 * the centre of the largest circle that fits inside the ring, so it is ALWAYS inside, it sits in
 * the visually fattest part of the shape, and it has the most clear room around it for a plate.
 *
 * This is the classic Mapbox `polylabel` quadtree search, written out here rather than added as
 * a dependency (~40 lines of arithmetic against a runtime dep + its transitive tree — the
 * repo's dependency rule). Pure, deterministic, unit-tested, and memoised per ring array so a
 * parcel with hundreds of vertices costs the search once, not once per rendered frame.
 */

const cache = new WeakMap();

// Squared distance from point p to segment a→b.
function seg2(p, a, b) {
  let x = a.x, y = a.y, dx = b.x - x, dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return (p.x - x) ** 2 + (p.y - y) ** 2;
}

/* Signed distance from p to the ring: POSITIVE inside, negative outside. The magnitude is the
 * distance to the nearest edge either way, so the search can rank an outside cell sensibly
 * instead of treating everything outside as equally bad. */
export function signedDist(p, ring) {
  let inside = false, min2 = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    min2 = Math.min(min2, seg2(p, a, b));
  }
  const d = Math.sqrt(min2);
  return inside ? d : -d;
}

const SQRT2 = Math.SQRT2;
const cellOf = (x, y, h, ring) => {
  const d = signedDist({ x, y }, ring);
  return { x, y, h, d, max: d + h * SQRT2 };   // `max` bounds the best possible d inside this cell
};

/**
 * @param ring       open ring of {x,y} (planner feet); the close is implicit
 * @param precision  stop refining once the answer can improve by less than this (ring units).
 *                   Defaults to 1/200 of the ring's smaller bbox side, floored at 0.25 — well
 *                   under a pixel at any zoom a parcel label is legible at.
 * @returns {x,y} guaranteed inside a simple ring; for a degenerate or self-crossing ring it
 *          falls back to the bounding-box centre rather than throwing.
 */
export function polylabel(ring, precision) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const cached = cache.get(ring);
  if (cached && precision == null) return cached;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  const centre = { x: minX + w / 2, y: minY + h / 2 };
  const cellSize = Math.min(w, h);
  if (!(cellSize > 0)) return centre;
  const prec = precision != null ? precision : Math.max(0.25, cellSize / 200);

  // Seed a coarse grid, then refine the most promising cell first (best-first quadtree search).
  let best = cellOf(centre.x, centre.y, 0, ring);
  const queue = [];
  const push = (c) => { queue.push(c); };
  const popBest = () => {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    const c = queue[bi];
    queue[bi] = queue[queue.length - 1];
    queue.pop();
    return c;
  };
  const half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) push(cellOf(x + half, y + half, half, ring));
  }

  let guard = 20000;                       // hard bound: a pathological ring can never spin forever
  while (queue.length && guard-- > 0) {
    const c = popBest();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= prec) continue;  // this branch can no longer beat the incumbent
    const q = c.h / 2;
    push(cellOf(c.x - q, c.y - q, q, ring));
    push(cellOf(c.x + q, c.y - q, q, ring));
    push(cellOf(c.x - q, c.y + q, q, ring));
    push(cellOf(c.x + q, c.y + q, q, ring));
  }

  const out = best.d > 0 ? { x: best.x, y: best.y } : centre;
  if (precision == null) cache.set(ring, out);
  return out;
}
