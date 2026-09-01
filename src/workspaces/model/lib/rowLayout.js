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
 *  (never on a plain scroll).
 *
 *  `zoom` (B1007280, default 1) scales every row's height at the SOURCE — the one place this
 *  module needs to know about zoom at all. Everything downstream (which row is at a given
 *  scroll position, the visible virtualization window) consumes these offsets as plain
 *  numbers and needs no zoom-awareness of its own, because the real DOM `scrollTop` a browser
 *  reports is already in the SAME zoomed pixel units the caller renders rows at — offsets and
 *  scroll position agree by construction, not by a separate conversion step.
 *
 *  `hiddenRows` (B1007282, default none — Sort & Filter's AutoFilter) is an optional Set of row
 *  indices to give ZERO height, rather than their real height. This is the WHOLE filter
 *  mechanism, deliberately: a filtered-out row still exists (still has an index, still
 *  participates in this same offset table), it just takes no visual space, so the exact same
 *  virtualization window / sticky-freeze / scroll math every other row already uses handles a
 *  filtered row for free — no second "which rows are visible" system, no persistence of filter
 *  state needed here (it's a plain React state Set in ModelApp, gone on reload like zoom). */
export function buildRowOffsets(sheet, rowCount, zoom = 1, hiddenRows = null) {
  const offsets = new Array(rowCount + 1);
  let y = 0;
  for (let r = 0; r < rowCount; r++) { offsets[r] = y; y += hiddenRows && hiddenRows.has(r) ? 0 : rowHeightAt(sheet, r) * zoom; }
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
