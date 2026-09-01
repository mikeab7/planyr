/* Model workspace — pure row-layout math for SheetView's virtualization (Stage 1).
 *
 * Rows used to all be a fixed ROW_H, so "row r's top" was just `r * ROW_H` — no layout table
 * needed. Stage 1 adds drag-resizable row heights (sheetModel.js's rowHeights map), so a row's
 * top is now a running total of every row before it, and finding "which row is at this scroll
 * position" needs a search over that running total rather than one division. Kept here, pure
 * and DOM-free, so the virtualization math is unit-testable without mounting SheetView.
 */
import { rowHeightAt } from "./sheetModel.js";

/** Cumulative top offset of every row, PLUS one trailing entry for the total height —
 *  `offsets[r]` is row r's own top (relative to the start of the row area), `offsets[n]`
 *  (n = rowCount) is the total height of all `rowCount` rows. O(rowCount); cheap even at a
 *  few thousand rows, and only recomputed when the row count or a height actually changes
 *  (never on a plain scroll). */
export function buildRowOffsets(sheet, rowCount) {
  const offsets = new Array(rowCount + 1);
  let y = 0;
  for (let r = 0; r < rowCount; r++) { offsets[r] = y; y += rowHeightAt(sheet, r); }
  offsets[rowCount] = y;
  return offsets;
}

/** The largest row index whose top offset is <= `y` (binary search — offsets is monotonically
 *  non-decreasing by construction). Clamped to [0, rowCount-1]; an empty sheet (rowCount 0)
 *  returns 0 by convention (callers already guard totalRows > 0 before rendering rows). */
export function rowAtOffset(offsets, y) {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0) return 0;
  let lo = 0, hi = rowCount - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The [startIdx, endIdx) row range to actually render for a scrolled, buffered viewport —
 *  the same BUF-padded window SheetView already used when every row was a fixed height, just
 *  computed against the real per-row offsets instead of a division.
 *
 *  `offsets` is always the FULL sheet's row-offset array (0..rowCount) — frozen rows don't need
 *  their own rebased sub-array, because they render as separate STICKY (not absolute) elements
 *  outside this virtualized window entirely (see SheetView.jsx). The only freeze-awareness this
 *  function needs is `minIdx`: the scrolling window must never start before the frozen band ends
 *  (a frozen row is never ALSO rendered as an absolute-positioned scrolling row underneath it). */
export function visibleRowRange(offsets, scrollTop, viewportH, buf, minIdx = 0) {
  const rowCount = offsets.length - 1;
  if (rowCount <= minIdx) return { startIdx: minIdx, endIdx: minIdx };
  const startIdx = Math.max(minIdx, rowAtOffset(offsets, scrollTop) - buf);
  const endIdx = Math.min(rowCount, rowAtOffset(offsets, scrollTop + viewportH) + buf + 1);
  return { startIdx, endIdx };
}
