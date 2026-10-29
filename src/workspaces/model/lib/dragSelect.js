/* Model workspace — the pure geometry behind drag-to-select with EDGE AUTOSCROLL (NEW-1, 2026-10-29).
 *
 * Why this exists: the grid used to extend a drag selection from each cell's own `mouseenter`, which only
 * fires for cells the pointer actually crosses — so the selection stopped at the last visible row and the
 * grid never scrolled (owner: "it just stops … it doesn't move the screen for me like Excel does").
 * The fix maps the POINTER POSITION to a row/column from scroll offsets + the row/column offset tables
 * (never from `elementFromPoint`, which can only name a rendered row — the grid is virtualised), and
 * drives scrolling from a timer so a pointer held still outside the edge keeps scrolling.
 *
 * DOM-free: every function takes plain numbers, so the mapping and the speed ramp are unit-tested
 * without a browser.
 */
import { rowAtOffset } from "./rowLayout.js";

/** Pixels per second of autoscroll just past the edge … */
export const AUTOSCROLL_MIN_SPEED = 220;
/** … growing by this many px/s for every pixel the pointer is beyond it … */
export const AUTOSCROLL_RAMP = 14;
/** … up to this ceiling, so a pointer thrown far off-screen is quick but never a blur. */
export const AUTOSCROLL_MAX_SPEED = 2600;
/** A pointer within this many px INSIDE the edge already counts as "at the edge" (a pointer parked on the
 *  last pixel row of the grid must scroll; it cannot be nudged further out). */
export const AUTOSCROLL_EDGE_PX = 1;

/** Signed px/s for one axis: 0 while the pointer is comfortably inside [lo, hi]; otherwise a speed that ramps
 *  with how far past the edge it is (near edge = slow, far = fast), negative toward `lo`. */
export function edgeVelocity(p, lo, hi) {
  if (!(hi > lo)) return 0;
  if (p <= lo + AUTOSCROLL_EDGE_PX) {
    const dist = lo + AUTOSCROLL_EDGE_PX - p;
    return -Math.min(AUTOSCROLL_MAX_SPEED, AUTOSCROLL_MIN_SPEED + dist * AUTOSCROLL_RAMP);
  }
  if (p >= hi - AUTOSCROLL_EDGE_PX) {
    const dist = p - (hi - AUTOSCROLL_EDGE_PX);
    return Math.min(AUTOSCROLL_MAX_SPEED, AUTOSCROLL_MIN_SPEED + dist * AUTOSCROLL_RAMP);
  }
  return 0;
}

/** The largest column index whose left offset is <= x. `colOffsets[c]` is column c's left edge and
 *  `colOffsets[n]` the right edge of the last column (same table SheetView renders from). */
export function colAtOffset(colOffsets, x) {
  const n = colOffsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0, hi = n - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (colOffsets[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * The geometry a pointer position is measured against:
 *   rect        { left, top }         — the scroll container's on-screen box
 *   viewport    { width, height }     — its clientWidth / clientHeight (excludes scrollbars)
 *   scroll      { left, top }         — its scrollLeft / scrollTop
 *   headerH     — the sticky column-header band's height
 *   rowOffsets  — row tops relative to the start of the row area (length rows+1)
 *   colOffsets  — column lefts, starting at the row-number gutter's width (length cols+1)
 *   freezeRows / freezeCols
 */

/** Which row/column is under (clientX, clientY)? Frozen rows/columns are pinned, so a pointer over them maps
 *  WITHOUT the scroll offset; everything else maps through it. Clamped to the sheet, so a pointer beyond any
 *  edge answers the nearest cell on that edge. */
export function cellAtPoint(g, clientX, clientY) {
  const relX = clientX - g.rect.left, relY = clientY - g.rect.top;
  const frozenBottom = g.headerH + (g.rowOffsets[g.freezeRows] || 0);
  const frozenRight = g.colOffsets[g.freezeCols] ?? g.colOffsets[0];
  const contentY = relY < frozenBottom ? relY - g.headerH : relY + g.scroll.top - g.headerH;
  const contentX = relX < frozenRight ? relX : relX + g.scroll.left;
  const rows = g.rowOffsets.length - 1, cols = g.colOffsets.length - 1;
  const r = Math.max(0, Math.min(rows - 1, rowAtOffset(g.rowOffsets, contentY)));
  const c = Math.max(0, Math.min(cols - 1, colAtOffset(g.colOffsets, contentX)));
  return { r, c };
}

/** The scrollable PANE in on-screen coordinates — what is left of the viewport once the sticky header band,
 *  the row-number gutter and any frozen rows/columns are taken out. A pointer over those pinned bands counts
 *  as past the pane's edge (they can never show the cell the user is reaching for). */
export function paneBounds(g) {
  return {
    top: g.rect.top + g.headerH + (g.rowOffsets[g.freezeRows] || 0),
    bottom: g.rect.top + g.viewport.height,
    left: g.rect.left + (g.colOffsets[g.freezeCols] ?? g.colOffsets[0]),
    right: g.rect.left + g.viewport.width,
  };
}

/** Scroll delta (px) for one animation frame of `dtMs`, honouring which axes this gesture may scroll.
 *  Never smaller than 1px in a scrolling direction (a fractional scrollTop rounds to nothing at a 1x display). */
export function autoscrollStep(g, clientX, clientY, dtMs, axes = { x: true, y: true }) {
  const b = paneBounds(g);
  const vx = axes.x ? edgeVelocity(clientX, b.left, b.right) : 0;
  const vy = axes.y ? edgeVelocity(clientY, b.top, b.bottom) : 0;
  const step = (v) => (v === 0 ? 0 : Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * dtMs / 1000)));
  return { dx: step(vx), dy: step(vy), vx, vy };
}
