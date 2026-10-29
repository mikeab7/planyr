/* Model workspace — the in-cell editor's OWN undo history (NEW-1, 2026-10-29).
 *
 * WHY THIS EXISTS. Ctrl+Z while a cell editor is open used to reach the app's window-level
 * sheet undo (ModelApp.jsx) and start reverting OTHER, earlier cells. The editor's text is
 * unsaved component state — not a committed sheet edit — so it must have its own, tiny undo that
 * never touches the sheet's undo stack. Excel's contract: Ctrl+Z/Y act on the text in the editor
 * only; with nothing left to undo, Ctrl+Z abandons the edit back to the cell's original value.
 * Once the edit is committed (Enter/Tab/click away) the sheet-level Ctrl+Z undoes that whole
 * committed edit as ONE step (that path is unchanged: one `commit` = one frame).
 *
 * Pure and DOM-free so the contract is unit-testable without a browser. A history is
 * `{ stack, index }`; stack[0] is the cell's value when the editor opened.
 */

export function createEditHistory(original) {
  return { stack: [String(original ?? "")], index: 0 };
}

/** Record a new editor value. Typing after an undo drops the redo tail; an unchanged value
 *  mints nothing. */
export function recordEdit(history, value) {
  if (!history) return createEditHistory(value);
  if (history.stack[history.index] === value) return history;
  const stack = history.stack.slice(0, history.index + 1);
  stack.push(value);
  return { stack, index: stack.length - 1 };
}

/** One step back. `atStart: true` means there was nothing left to undo — the caller abandons the
 *  edit (cell keeps its original value), exactly like Excel. */
export function undoEdit(history) {
  if (!history || history.index <= 0) return { history, value: history ? history.stack[0] : "", atStart: true };
  const next = { stack: history.stack, index: history.index - 1 };
  return { history: next, value: next.stack[next.index], atStart: false };
}

/** One step forward; a no-op (`changed: false`) with nothing to redo. */
export function redoEdit(history) {
  if (!history || history.index >= history.stack.length - 1) return { history, value: history ? history.stack[history.index] : "", changed: false };
  const next = { stack: history.stack, index: history.index + 1 };
  return { history: next, value: next.stack[next.index], changed: true };
}
