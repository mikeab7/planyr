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

export { EDGE_SLOP, MIN_SPEED, SPEED_PER_PX, MAX_SPEED, axisVelocity } from "../../../shared/selection/edgeScroll.js";

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
