/* notesSelectAll — CTRL+A BELONGS TO THE THING YOU ARE IN (NEW-1, owner 2026-11-15: "approved PowerPoint behaviour").
 *
 * Before this, Ctrl+A in a box was the browser's own: it selected the WHOLE PAGE's text (every box), and a Ctrl+C then copied
 * every box's words. PowerPoint's rule is the one adopted:
 *   · CARET INSIDE A BOX → Ctrl+A selects the text of THAT box only. In a table cell it steps outward — the cell's own text,
 *     then the whole table, then the box's text — and never escapes into another box. Pressing it again on the whole box text
 *     does nothing (it is already everything this box owns). Ctrl+C then copies TEXT (the text-copy path; no box, no outline).
 *   · NO CARET IN ANY BOX (a box selected by its outline, or blank paper) → Ctrl+A selects every BOX on the page as boxes
 *     (`NoteEditor.jsx`, window handler), and Ctrl+C then copies them as boxes with the moving outline.
 *
 * This file is the DOCUMENT half: the pure target (`selectAllTarget`) and the keymap that applies it (priority above the engine's
 * own Mod-a, which is the whole-document `AllSelection` that made the old behaviour). The "no caret in a box" half needs the page's
 * box selection state (React), so it lives in the editor component and decides with `selectAllScope` below.
 * PURE where it can be: `selectAllTarget` takes an EditorState, `selectAllScope` takes plain facts. */
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";

const ANCHOR = "noteAnchor";
const CELLS = new Set(["tableCell", "tableHeader"]);

/** Who owns this Ctrl+A? `"text"` = the caret is inside a box (the keymap handles it) · `"boxes"` = no caret in any box, so every box
 *  on the page is selected as a box · `"none"` = nothing for us to do (no boxes; the browser's own behaviour stands).
 *  `editing` — a box is entered (`editingId`); `boxSelected` — one or more boxes are selected by their outline; `caretInBox` — the
 *  editor holds focus with its selection inside a box; `hasBoxes` — the page has any box. */
export function selectAllScope({ editing = false, boxSelected = false, caretInBox = false, hasBoxes = false } = {}) {
  if (editing) return "text";
  if (boxSelected) return hasBoxes ? "boxes" : "none";
  if (caretInBox) return "text";
  return hasBoxes ? "boxes" : "none";
}

function depthOf(sel, names) {
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d -= 1) if (names.has ? names.has($f.node(d).type.name) : $f.node(d).type.name === names) return d;
  return -1;
}
const same = (a, b) => !!a && !!b && a.from === b.from && a.to === b.to && a.constructor === b.constructor;

/** The selection one Ctrl+A press moves to, or `null` when the caret is not inside a box (the caller declines and lets the other route
 *  decide). May return the CURRENT selection when it already is the widest this box owns — the key is still consumed, so it cannot
 *  escape into the page. */
export function selectAllTarget(state) {
  const { doc, selection } = state;
  const isCells = selection instanceof CellSelection;
  const anchorD = depthOf(selection, ANCHOR);
  if (anchorD < 0) return null;
  const $f = selection.$from;
  const boxStart = $f.start(anchorD); const boxEnd = $f.end(anchorD);
  const boxText = () => {
    const $a = doc.resolve(boxStart); const $b = doc.resolve(boxEnd);
    const s = TextSelection.between($a, $b);
    return s;
  };
  /* A box that holds a table and the caret is in one of its cells: cell text → whole table → the box's text. */
  const cellD = isCells ? -1 : depthOf(selection, CELLS);
  const tableD = isCells ? depthOf(selection, new Set(["table"])) : (cellD > 0 ? cellD - 2 : -1);
  if (isCells || (cellD > 0 && tableD > 0 && $f.node(tableD)?.type.name === "table")) {
    const tableNode = $f.node(tableD);
    const tableStart = $f.start(tableD);
    const map = TableMap.get(tableNode);
    const whole = CellSelection.create(doc, tableStart + map.map[0], tableStart + map.map[map.map.length - 1]);
    if (!isCells) {
      const cs = $f.start(cellD); const ce = $f.end(cellD);
      const cell = TextSelection.between(doc.resolve(cs), doc.resolve(ce));
      const covers = selection.from <= cell.from && selection.to >= cell.to;
      if (!covers && cell.to > cell.from) return cell;          // 1 — the cell's own text
      return whole;                                              // 2 — the whole table
    }
    if (!same(selection, whole) && !(selection.from <= whole.from && selection.to >= whole.to)) return whole;
    return boxText();                                            // 3 — the box's text
  }
  const target = boxText();
  return target;
}

/** Ctrl+A / Cmd+A while the caret is in a box. At priority 200 so it runs before the engine's own Mod-a (the whole-document selection). */
export const NoteSelectAll = Extension.create({
  name: "noteSelectAll",
  priority: 200,
  addKeyboardShortcuts() {
    return {
      "Mod-a": () => {
        const { state, view } = this.editor;
        const t = selectAllTarget(state);
        if (!t) return false;
        if (!same(t, state.selection)) view.dispatch(state.tr.setSelection(t).scrollIntoView());
        return true;
      },
    };
  },
});
