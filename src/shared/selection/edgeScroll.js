/* Edge-scroll speed for a held drag-select (B2452528; shared by the Spreadsheet, the Schedule grid — inlined by
 * scripts/sync-sequence-selection.mjs — and the Notes tables, B2530690). Pure and DOM-free. All positions are in
 * the scroll container's VIEWPORT space.
 */
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
