/* Model workspace — WHO OWNS Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z right now (NEW-1, 2026-10-29).
 *
 * ⛔ THE DEFECT. ModelApp binds ONE `window` keydown listener for the sheet-level undo/redo, and
 * it asked nothing about where the key came from. So Ctrl+Z pressed inside a cell editor (or the
 * formula bar, the Name Box, a column-rename box, the Find bar…) ran the SHEET undo — reverting
 * earlier committed edits — and its `preventDefault()` also killed the text field's native undo.
 * Excel's rule, and the one enforced here: while text is being typed, undo/redo belong to THAT
 * text. The sheet-level stack only fires when no text control owns the keyboard.
 *
 * Plain facts in, verdict out — never a DOM node — so it is unit-testable without a browser. The
 * caller reads `isTextControl(e.target)` and `target.closest('[data-cell-editing]')`.
 *   textControl      — the event target is an input/textarea/contentEditable
 *   cellEditorOpen   — the sheet reports an open cell editor, even if the editor has not yet
 *                      taken DOM focus (the B1287888 window, when the key lands on the grid
 *                      container instead of the input)
 */

/** "undo" | "redo" | null for a keydown. */
export function undoKeyKind(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey || typeof e.key !== "string") return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y" && !e.shiftKey) return "redo";
  return null;
}

/** "text" when undo/redo belong to the text being typed; "sheet" when the app's undo stack does. */
export function undoKeyOwner({ textControl = false, cellEditorOpen = false } = {}) {
  return textControl || cellEditorOpen ? "text" : "sheet";
}

export const CELL_EDITING_ATTR = "data-cell-editing";
