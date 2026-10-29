/* Model workspace — pure math for drag-select AUTOSCROLL (B2452528, NEW-1).
 *
 * While the mouse button is held on the grid, the pointer's position — not which cell happened to
 * fire a mouseenter — decides both (a) which cell the selection reaches and (b) how fast the grid
 * scrolls to bring more cells under it. Kept DOM-free so the geometry is unit-tested without
 * mounting SheetView. Everything is in the scroll container's VIEWPORT space (px from its top-left,
 * the same units `scrollTop`/`clientHeight` use), so the maths is already zoom-correct.
 *
 * Layout the maths assumes (see SheetView.jsx): a sticky header band `headerH` tall, a sticky
 * row-number gutter that is `offsets[0]` wide for columns, `frozenCount` leading rows/columns
 * pinned at their resting offsets, and the remaining rows/columns scrolling underneath.
 */
import { rowAtOffset } from "./rowLayout.js";

/** Scroll starts when the pointer is within this many px of the edge of the cell area (or past it). */
export const EDGE_SLOP = 2;
/** px/second right at the edge — slow enough to land on one row. */
export const MIN_SPEED = 240;
/** Extra px/second per px the pointer is past the edge — Excel's near = slow, far = fast ramp. */
export const SPEED_PER_PX = 14;
export const MAX_SPEED = 2600;

/** Signed px/second to scroll along ONE axis. `pos` is the pointer in viewport px, `lo` the near
 *  edge of the scrolling cell area (just past the sticky header / frozen band), `hi` its far edge
 *  (the viewport size). Negative = toward the start. 0 = pointer comfortably inside. */
export function axisVelocity(pos, lo, hi) {
  if (pos < lo + EDGE_SLOP) return -Math.min(MAX_SPEED, MIN_SPEED + Math.max(0, lo - pos) * SPEED_PER_PX);
  if (pos > hi - EDGE_SLOP) return Math.min(MAX_SPEED, MIN_SPEED + Math.max(0, pos - hi) * SPEED_PER_PX);
  return 0;
}

/** The row/column index the selection should reach for a pointer at `pos` (viewport px) on one axis.
 *  `offsets` is the cumulative table (rowOffsets, or colOffsets — whose [0] is already the gutter
 *  width), `origin` how far the table's zero sits from the viewport edge when scrollTop/Left is 0
 *  (headerH for rows, 0 for columns), `frozenCount` the pinned leading entries, `viewSize` the
 *  viewport's size on this axis. A pointer past the far edge reaches the last cell that is VISIBLE
 *  (the autoscroll then brings the next one); over the header/gutter it reaches the first visible
 *  scrolling cell, or index 0 once scrolled all the way back. */
export function axisIndexAt({ offsets, pos, scroll, origin, frozenCount, viewSize }) {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  const frozenEdge = origin + offsets[Math.min(frozenCount, count)];
  const itemsStart = origin + offsets[0];
  let idx;
  if (pos >= frozenEdge) {
    const p = Math.min(pos, Math.max(frozenEdge, viewSize - 1));
    idx = rowAtOffset(offsets, p + scroll - origin);
  } else if (pos >= itemsStart) {
    idx = rowAtOffset(offsets, pos - origin); // over a frozen row/column — it IS that one
  } else {
    idx = scroll > 0 ? rowAtOffset(offsets, frozenEdge + scroll - origin) : 0;
  }
  return Math.max(0, Math.min(count - 1, idx));
}
