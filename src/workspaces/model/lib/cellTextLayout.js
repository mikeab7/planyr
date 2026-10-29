/* Where a cell's text starts, and whether it may spill — the ONE definition (NEW-1).
 *
 * A text cell with empty cells to its right is painted by SheetView's "spill" span (so a long row
 * label can run across the blanks, Excel's rule); every other cell is painted inside the cell's own
 * flex box. Those two paths used to position the text with their own constants (padding 6 + 14 per
 * indent step, vs a hard-coded 8 with no indent, centred, left-only), so the label jumped the moment
 * the cell beside it was cleared or refilled — the owner's "clearing a value shifts the text next
 * to it". Both paths now take their horizontal padding from `cellPadding`, and `canSpill` is the single
 * gate for the spill path, so what is painted never depends on the neighbour except for how FAR
 * a left-aligned label may run, never WHERE it starts.
 */

export const CELL_PAD_PX = 6;      // the cell's own horizontal padding at 100% zoom
export const INDENT_STEP_PX = 14;  // one Ribbon "increase indent" step at 100% zoom

/* Room kept for the cell's own borders (a thin/double border is up to 3 px a side at 100% zoom, plus the
 * 1 px grid line), so padding can never push the box past its column. */
const BORDER_ALLOWANCE_PX = 6;

/**
 * Horizontal padding (screen px) between a cell's edges and its text, at the given zoom.
 *
 * An indent only INSETS THE TEXT inside the cell (NEW-2): Excel's indent is on the reading side only —
 * the left for left-aligned text, the right for right-aligned, none for centred — so it is never
 * mirrored onto the far edge. And the total can never exceed the column: a box cannot be narrower than
 * its own padding, so an unclamped indent (the owner pressed it until it grew) stretches the cell and
 * shoves every cell to its right out of line with the header. A deep indent in a narrow column simply
 * leaves the text no room (clipped), exactly as Excel does — the grid never moves.
 */
export function cellPadding({ indent, align, zoom, width }) {
  const base = CELL_PAD_PX * zoom;
  const wanted = Math.max(0, indent || 0) * INDENT_STEP_PX * zoom;
  const room = Number.isFinite(width) ? Math.max(0, width - 2 * base - BORDER_ALLOWANCE_PX * zoom) : wanted;
  const extra = Math.min(wanted, room);
  if (align === "center") return { left: base, right: base };
  if (align === "right") return { left: base, right: base + extra };
  return { left: base + extra, right: base };
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

/** Width (screen px) of the spill span: every column it covers, less the padding at both ends. */
export function spillSpanWidth(totalWidth, padLeft, padRight) {
  return Math.max(0, totalWidth - padLeft - padRight - 1); // -1 = the last covered cell's own right border
}
