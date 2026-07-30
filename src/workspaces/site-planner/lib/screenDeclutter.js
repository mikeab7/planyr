/* Shared SCREEN-SPACE declutter (NEW-1 / NEW-2).
 *
 * The label engine in `labelLayout.js` decides which *reflowable* labels survive a frame by
 * boxes-and-importance. This module is its small sibling for the layers that are NOT reflowable
 * and not labels at all — fixed-size chrome painted one-per-geometry-feature: the parcel setback
 * value chips, the parcel-side length dimensions, and the square vertex handles.
 *
 * Those layers share one failure mode: their count is set by how finely the geometry was
 * DIGITIZED, not by how much room the screen has. A subdivision boundary that follows a curve
 * carries dozens of short segments, so a per-segment chip or per-vertex handle piles into an
 * illegible stack the moment the segments project to a few pixels apart (owner report,
 * 2026-07-30, Weld County CO: "how many dots show up… it's obviously overwhelming the screen").
 *
 * The rule is deliberately the same one a cartographer uses: keep the most important marks,
 * drop the ones that would land on top of a kept mark, and re-decide EVERY frame off the
 * current zoom — so zooming in progressively reveals detail instead of showing everything at
 * every scale. Nothing here edits geometry; a dropped mark is hidden, never deleted.
 *
 * Pure + dependency-free + unit-tested (no React, no DOM), so both the canvas and any headless
 * harness run the identical decision.
 */

/**
 * Greedy minimum-separation thinning in SCREEN pixels.
 *
 * @param items     [{ id, x, y, priority }] — screen positions; `priority` higher = kept first.
 *                  Items missing a finite x/y are dropped (a degenerate projection never wins).
 * @param minSepPx  centres closer together than this (Euclidean px) may not both be kept.
 * @returns the kept items, in the ORDER THEY WERE GIVEN (stable — the caller's render order and
 *          any index-based selection stay intact; only membership changes).
 *
 * Ties on `priority` break on the item's position in the input, so the result is deterministic
 * and testable. Uses a uniform grid hash (cell = minSepPx, 3×3 neighbourhood probe) so a parcel
 * digitized with hundreds of vertices costs O(n) rather than O(n²).
 */
export function spaceOut(items, minSepPx) {
  const list = (items || []).filter((it) => it && Number.isFinite(it.x) && Number.isFinite(it.y));
  if (!list.length) return [];
  const sep = Number.isFinite(minSepPx) && minSepPx > 0 ? minSepPx : 0;
  if (!sep) return list;
  const order = list.map((it, i) => ({ it, i }));
  order.sort((a, b) => (b.it.priority || 0) - (a.it.priority || 0) || a.i - b.i);

  const grid = new Map();                       // "col,row" -> [{x,y}…] of already-kept centres
  const key = (c, r) => `${c},${r}`;
  const keptIdx = new Set();
  const sep2 = sep * sep;
  for (const { it, i } of order) {
    const c = Math.floor(it.x / sep), r = Math.floor(it.y / sep);
    let clash = false;
    for (let dc = -1; dc <= 1 && !clash; dc++) {
      for (let dr = -1; dr <= 1 && !clash; dr++) {
        const cell = grid.get(key(c + dc, r + dr));
        if (!cell) continue;
        for (const p of cell) {
          if ((p.x - it.x) ** 2 + (p.y - it.y) ** 2 < sep2) { clash = true; break; }
        }
      }
    }
    if (clash) continue;
    keptIdx.add(i);
    const k = key(c, r);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x: it.x, y: it.y });
  }
  return order.length === keptIdx.size ? list : list.filter((_, i) => keptIdx.has(i));
}

/* Smallest absolute difference between two bearings (degrees), in [0,180]. Shared by the
 * chip grouper and the handle "corner-ness" score so both read a turn the same way. */
export const turnBetween = (p, q) => {
  const d = (((p - q) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * How much a ring "turns" at each vertex, in degrees — the CORNER-NESS score (NEW-2).
 *
 * Vertex i is the join between edge (i-1 → i) and edge (i → i+1). A real corner of the lot
 * turns hard; a point in the middle of a digitized curve barely turns at all, which is exactly
 * the vertex a user cannot meaningfully drag when its neighbours are a few pixels away. Feeding
 * this as `priority` into `spaceOut` therefore keeps the lot's actual corners and thins the arc.
 *
 * @param points ring of {x,y} (open — the close is implicit), planner feet.
 * @returns number[] parallel to `points`; 0 for a degenerate ring.
 */
export function cornerTurns(points) {
  const n = points ? points.length : 0;
  if (n < 3) return new Array(Math.max(0, n)).fill(0);
  const bear = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n], here = points[i], next = points[(i + 1) % n];
    out[i] = turnBetween(bear(here, next), bear(prev, here));
  }
  return out;
}
