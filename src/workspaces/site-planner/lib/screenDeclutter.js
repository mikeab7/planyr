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
 * @param items     [{ id, x, y, priority, w?, h? }] — screen positions; `priority` higher = kept
 *                  first. Items missing a finite x/y are dropped (a degenerate projection never
 *                  wins). `w`/`h` are OPTIONAL plate dimensions — see the two metrics below.
 * @param minSepPx  centres closer together than this (Euclidean px) may not both be kept.
 * @param gapPx     clear gap required between two PLATES, for the box metric only.
 * @returns the kept items, in the ORDER THEY WERE GIVEN (stable — the caller's render order and
 *          any index-based selection stay intact; only membership changes).
 *
 * TWO METRICS, one helper (NEW-1). A mark with no size is a point and is thinned RADIALLY by
 * `minSepPx` — the original behaviour, unchanged, and what the vertex handles and side-length
 * dimensions still use. A mark that declares `w`/`h` is a PLATE and is thinned by whether the two
 * plates' boxes (each inflated by `gapPx / 2`) intersect. The setback chip needed this the moment
 * it started carrying its role: "Front · 25′" is three times the width of "25′" but exactly as
 * tall, so a single radial threshold either lets two wide chips overlap side-by-side or throws
 * away chips that were stacked vertically with plenty of air between them.
 *
 * Ties on `priority` break on the item's position in the input, so the result is deterministic
 * and testable. Uses a uniform grid hash (3×3 neighbourhood probe) so a parcel digitized with
 * hundreds of vertices costs O(n) rather than O(n²).
 */
export function spaceOut(items, minSepPx, gapPx = 0) {
  const list = (items || []).filter((it) => it && Number.isFinite(it.x) && Number.isFinite(it.y));
  if (!list.length) return [];
  const sep = Number.isFinite(minSepPx) && minSepPx > 0 ? minSepPx : 0;
  const gap = Number.isFinite(gapPx) && gapPx > 0 ? gapPx : 0;
  const sized = (it) => Number.isFinite(it.w) && Number.isFinite(it.h);
  if (!sep && !list.some(sized)) return list;
  const order = list.map((it, i) => ({ it, i }));
  order.sort((a, b) => (b.it.priority || 0) - (a.it.priority || 0) || a.i - b.i);

  // The grid cell must be at least as large as the widest clash reach in EITHER axis, so a
  // clashing pair can never fall outside the 3×3 probe.
  const reach = list.reduce((m, it) => (sized(it) ? Math.max(m, it.w + gap, it.h + gap) : m), sep);
  const cell = reach > 0 ? reach : 1;
  const grid = new Map();                       // "col,row" -> [kept item] in that cell
  const key = (c, r) => `${c},${r}`;
  const keptIdx = new Set();
  const sep2 = sep * sep;
  const clashes = (a, b) => {
    if (sized(a) && sized(b)) {
      return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
    }
    return sep > 0 && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < sep2;
  };
  for (const { it, i } of order) {
    const c = Math.floor(it.x / cell), r = Math.floor(it.y / cell);
    let clash = false;
    for (let dc = -1; dc <= 1 && !clash; dc++) {
      for (let dr = -1; dr <= 1 && !clash; dr++) {
        const bucket = grid.get(key(c + dc, r + dr));
        if (!bucket) continue;
        for (const p of bucket) {
          if (clashes(it, p)) { clash = true; break; }
        }
      }
    }
    if (clash) continue;
    keptIdx.add(i);
    const k = key(c, r);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
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
