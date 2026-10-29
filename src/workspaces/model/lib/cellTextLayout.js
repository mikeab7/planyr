/* Where a cell's text starts, and whether it may spill — the ONE definition (NEW-1).
 *
 * A text cell with empty cells to its right is painted by SheetView's "spill" span (so a long row
 * label can run across the blanks, Excel's rule); every other cell is painted inside the cell's own
 * flex box. Those two paths used to position the text with their own constants (padding 6 + 14 per
 * indent step, vs a hard-coded 8 with no indent, centred, left-only), so the label jumped the moment
 * the cell beside it was cleared or refilled — the owner's "clearing a value shifts the text next
 * to it". Both paths now take their horizontal inset from `cellPadX`, and `canSpill` is the single
 * gate for the spill path, so what is painted never depends on the neighbour except for how FAR
 * a left-aligned label may run, never WHERE it starts.
 */

export const CELL_PAD_PX = 6;      // the cell's own horizontal padding at 100% zoom
export const INDENT_STEP_PX = 14;  // one Ribbon "increase indent" step at 100% zoom

/** Horizontal inset (screen px) between a cell's edge and its text, at the given zoom. */
export function cellPadX(indent, zoom) {
  return (CELL_PAD_PX + (indent || 0) * INDENT_STEP_PX) * zoom;
}

/**
 * May this cell's text run across the empty cells to its right?
 * Only left-aligned, unwrapped, plain TEXT that is neither merged nor being edited. A centred or
 * right-aligned label would have to spill LEFT or on both sides (Excel), which is a different
 * start point from its in-cell position, so it clips inside its own column instead of jumping.
 */
export function canSpill({ kind, empty, merged, editing, align, wrap }) {
  return kind === "text" && !empty && !merged && !editing && !wrap && (!align || align === "left");
}

/** Width (screen px) of the spill span: every column it covers, less the inset on both ends. */
export function spillSpanWidth(totalWidth, padX) {
  return Math.max(0, totalWidth - 2 * padX - 1); // -1 = the last covered cell's own right border
}
