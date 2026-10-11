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
/* Identity is the cheap hit (a render that holds the same array). It MISSES whenever the ring is rebuilt with identical coordinates — and a plan
 * open/switch re-seeds every parcel from its rows (new arrays, same points), so the identity cache alone paid the whole search again on every
 * open and every revisit (NEW-1, B2224000). The second tier is keyed by the COORDINATES, so identical geometry is answered without a search no
 * matter which array carries it. Bounded (FIFO) — a long session across many plans cannot grow it without limit. */
const byContent = new Map();
const CONTENT_CACHE_MAX = 512;
const ringKey = (ring) => { let k = String(ring.length); for (const p of ring) k += `|${p.x},${p.y}`; return k; };

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
const cellOf = (x, y, h, ring, dist = signedDist) => {
  const d = dist({ x, y }, ring);
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
  return search(ring, precision, signedDist, true);
}

/* Same search over a ring WITH HOLES (a parcel's save-and-except carve-outs): a point inside a hole
 * is outside the land, and the clearance is measured to the nearest edge of the outer ring OR any
 * hole. Memoised per outer-ring array + holes array identity, so callers should pass stable arrays. */
const holeCache = new WeakMap();
export function signedDistWithHoles(p, ring, holes) {
  const dOuter = signedDist(p, ring);
  let d = dOuter;
  for (const h of holes) {
    const dh = signedDist(p, h);            // >0 inside the hole = outside the land
    d = Math.min(d, -dh);
  }
  return d;
}
export function polylabelWithHoles(ring, holes) {
  const hs = (holes || []).filter((h) => Array.isArray(h) && h.length >= 3);
  if (!hs.length) return polylabel(ring);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const c = holeCache.get(ring);
  if (c && c.holes === holes) return c.out;
  const out = search(ring, undefined, (p, r) => signedDistWithHoles(p, r, hs), false);
  holeCache.set(ring, { holes, out });
  return out;
}

function search(ring, precision, dist, useCache) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const cached = useCache ? cache.get(ring) : null;
  if (cached && precision == null) return cached;
  const key = useCache && precision == null ? ringKey(ring) : null;
  if (key !== null) { const hit = byContent.get(key); if (hit) { cache.set(ring, hit); return hit; } }

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
  let best = cellOf(centre.x, centre.y, 0, ring, dist);
  /* A binary MAX-heap on `max` (ties: earliest pushed first, so the answer is deterministic). The first version rescanned the whole queue on every
   * pop (O(queue) per step): a long thin strip has a FLAT ridge, so every cell along its spine stays above the incumbent until it is refined to
   * `prec`, the queue runs to thousands, and the rescan made two 83 × 1,705 ft parcels cost ~155 ms each — 416 ms for Concept A's 16 parcels,
   * all inside one React render on every plan open (NEW-1, B2224000). Same search, same stop rule; only the pop is O(log n). */
  const heap = []; let seq = 0;
  const before = (a, b) => a.max > b.max || (a.max === b.max && a.seq < b.seq);
  const push = (c) => {
    c.seq = seq++; let i = heap.length; heap.push(c);
    while (i > 0) { const p = (i - 1) >> 1; if (!before(c, heap[p])) break; heap[i] = heap[p]; i = p; }
    heap[i] = c;
  };
  const popBest = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0; const n = heap.length;
      for (;;) {
        let k = 2 * i + 1; if (k >= n) break;
        if (k + 1 < n && before(heap[k + 1], heap[k])) k++;
        if (!before(heap[k], last)) break;
        heap[i] = heap[k]; i = k;
      }
      heap[i] = last;
    }
    return top;
  };
  const half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) push(cellOf(x + half, y + half, half, ring, dist));
  }

  let guard = 20000;                       // hard bound: a pathological ring can never spin forever
  while (heap.length && guard-- > 0) {
    const c = popBest();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= prec) continue;  // this branch can no longer beat the incumbent
    const q = c.h / 2;
    push(cellOf(c.x - q, c.y - q, q, ring, dist));
    push(cellOf(c.x + q, c.y - q, q, ring, dist));
    push(cellOf(c.x - q, c.y + q, q, ring, dist));
    push(cellOf(c.x + q, c.y + q, q, ring, dist));
  }

  const out = best.d > 0 ? { x: best.x, y: best.y } : centre;
  if (useCache && precision == null) {
    cache.set(ring, out);
    if (key !== null) { if (byContent.size >= CONTENT_CACHE_MAX) byContent.delete(byContent.keys().next().value); byContent.set(key, out); }
  }
  return out;
}
