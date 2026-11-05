/* Model workspace — "does a drag on a selected row / column header MOVE it?" for the Univer grid (NEW-1, 2026-10-30).
 *
 * Excel moves a selected row / column only when SHIFT is held during the drag; a plain drag across headers extends the
 * selection. Univer's header-move controller moves on ANY drag that starts on an already-selected header. UniverSheet.jsx
 * puts this gate in front of that controller's own permission check (its documented interceptor point), so the controller
 * itself is never patched.
 *
 * Pure: imports nothing. The one fact the gate needs — was Shift held when the press landed? — is fed to it from capture
 * listeners on the grid host (the interceptor itself is handed no event). It is read at pointer-down, which is also when
 * Univer decides whether a drag is a move, and again on hover, which is what draws its "grab" cursor. */

export function createShiftGate() {
  let shift = false;
  return {
    /** from any pointer / mouse event over the grid: `event.shiftKey` is the truth at that instant */
    pointer(shiftKey) { shift = !!shiftKey; },
    /** from window key events: Shift going down / up while the pointer is still (so the cursor tracks it) */
    key(event) {
      if (!event || event.key !== "Shift") return;
      shift = event.type === "keydown";
    },
    /** a window losing focus can swallow the Shift keyup; never leave the gate open on a guess */
    reset() { shift = false; },
    /** Univer's HEADER_MOVE_PERMISSION_CHECK handler: `next` is "let the next check (the permission check) decide" */
    handler(value, _ctx, next) { return shift ? next(value) : false; },
    allows: () => shift,
  };
}

/** Higher than the default 0 so it runs BEFORE Univer's own permission check and can end the chain. */
export const HEADER_MOVE_GATE_PRIORITY = 1000;

/* ---- a plain press on a header that is ALREADY selected --------------------------------------------------------------
 * Univer's selection controller ignores a press on an already-selected header (it leaves it to the move controller). With
 * the move gated off, that press would do nothing at all — but Excel starts a fresh header selection there, and a drag
 * extends it. So the press is first turned into "a press on an unselected header" by collapsing the selection to one cell
 * (the controller then builds the new header selection from the pressed header). Never when:
 *   · a modifier is down — Shift is the move (or Shift+click extend), Ctrl/Cmd+click ADDS a range and must keep the others;
 *   · it is not the primary button (a right-click keeps the selection for the context menu);
 *   · the press is on a header's resize border (the caller checks the resize cursor) — that press resizes. */
export const RANGE_TYPE_ROW = 1;
export const RANGE_TYPE_COLUMN = 2;

/** @param {{ button?: number, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, kind: "row"|"column", index: number,
 *           ranges: Array<{ rangeType: number, startRow: number, endRow: number, startColumn: number, endColumn: number }> }} p */
export function pressOnSelectedHeader(p) {
  if ((p.button || 0) !== 0 || p.shiftKey || p.ctrlKey || p.metaKey) return false;
  const row = p.kind === "row";
  return (p.ranges || []).some((r) => r.rangeType === (row ? RANGE_TYPE_ROW : RANGE_TYPE_COLUMN)
    && (row ? r.startRow <= p.index && p.index <= r.endRow : r.startColumn <= p.index && p.index <= r.endColumn));
}
