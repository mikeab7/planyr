/* notesTableMultiSelect — CTRL+CLICK ADDS CELLS TO A NOTES TABLE'S SELECTION (B2530690, owner report 2026-10-29:
 * "Using Control to click multiple cells doesn't work. It should work." — he expects Excel behaviour wherever
 * there are cells).
 *
 * WHY IT DID NOTHING. prosemirror-tables' CellSelection is ONE rectangle by construction, and its mouse handler
 * returns early on a Ctrl/Meta mousedown (`handleMouseDown`, dist/index.js: "if (startEvent.ctrlKey ||
 * startEvent.metaKey) return"). So a Ctrl+click fell through to ProseMirror's default and just moved the caret.
 *
 * THE MODEL IS THE SPREADSHEET'S, NOT A SECOND ONE. The list of ranges, "Ctrl+click adds a range / on a selected
 * cell takes it out", the active range being the newest — all of that is src/shared/selection/rangeSelection.js
 * (the code the Spreadsheet and the Schedule grid use). Here the ranges are in the TABLE'S OWN row/column grid
 * (a merged cell answers with its whole span), and this file only translates between that grid and positions.
 *
 * THE SELECTION IS A SUBCLASS OF CellSelection, SO THE EDITOR'S OWN MACHINERY DOES THE WORK. `MultiCellSelection`
 * is a CellSelection for its newest range whose `ranges` (ProseMirror's list of selected spans) holds EVERY
 * selected cell. Everything in the editor that formats "the selection" walks `selection.ranges` — toggleMark /
 * setMark (bold, italic, underline, colour, highlight, size, font), updateAttributes (alignment), setBlockType —
 * so formatting lands on every selected cell with no per-command code. `forEachCell` is overridden, which is what
 * both the blue "selectedCell" highlight and prosemirror-tables' Delete (clear every selected cell) read. Cell
 * fill reads `multiCellPositions` below. A plain click / arrow / typing replaces the selection with an ordinary
 * one, so it collapses exactly as in Excel; Shift+click extends from the newest range and drops the earlier ones.
 *
 * WHAT IT DELIBERATELY REFUSES (never a silent partial): copy, cut and paste with several ranges selected, and the
 * table-structure buttons (insert/delete row or column, merge/split, header row, delete table, select table). Each
 * says "This action won’t work on multiple selections." — the Spreadsheet's wording, for the same reason: acting on
 * only the newest rectangle would look like it worked.
 *
 * ⛔ THE BOX KEEPS ITS OWN PRESSES. This only handles a Ctrl/Cmd press on a cell of a table the caret is ALREADY in
 * (the box is entered). A press on an unentered box is still stage 1 of select-then-enter (`focusFromMat` calls
 * preventDefault, which ProseMirror honours), a border press still moves the box, and a mouse drag from a box's
 * content still pans.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { CellSelection, TableMap, cellAround } from "@tiptap/pm/tables";
import {
  MULTI_SELECTION_MESSAGE, addRange, makeSelection, rangesOf, selContains, toggleCellOut,
} from "../../../shared/selection/rangeSelection.js";

export { MULTI_SELECTION_MESSAGE };
export const NOTES_NOTICE_EVENT = "planyr-notes-notice";

const POINTS_AT_CELL = ($pos) => $pos.parent.type.spec.tableRole === "row" && !!$pos.nodeAfter;   // = prosemirror-tables' pointsAtCell
const sameTable = ($a, $b) => $a.depth === $b.depth && $a.pos >= $b.start(-1) && $a.pos <= $b.end(-1);   // = its inSameTable

/** The cells (table-relative offsets) inside one grid range, merged cells counted once. */
function cellsInGrid(map, g) {
  return map.cellsInRect({ left: g.c1, right: g.c2 + 1, top: g.r1, bottom: g.r2 + 1 });
}

/** A rectangle given by two cell positions (absolute), in the table's grid, as a model range. */
function gridOf(map, tableStart, anchorAbs, headAbs) {
  const r = map.rectBetween(anchorAbs - tableStart, headAbs - tableStart);
  return { r1: r.top, r2: r.bottom - 1, c1: r.left, c2: r.right - 1 };
}

/** The abs positions of the two corner cells of a grid range — a CellSelection over them covers the range. */
function cornersOf(map, tableStart, g) {
  const w = map.width;
  return { anchor: tableStart + map.map[g.r1 * w + g.c1], head: tableStart + map.map[g.r2 * w + g.c2] };
}

export class MultiCellSelection extends CellSelection {
  /** `others` — the EARLIER ranges, each `{ anchor, head }` (absolute cell positions); this selection's own
   *  anchor/head cells are the NEWEST (active) range. */
  constructor($anchorCell, $headCell, others = []) {
    super($anchorCell, $headCell);
    this.others = others.map((o) => ({ anchor: o.anchor, head: o.head }));
    const doc = $anchorCell.node(0);
    const seen = new Set(this.ranges.map((r) => r.$from.pos));
    const all = [...this.ranges];
    for (const o of this.others) {
      const sub = new CellSelection(doc.resolve(o.anchor), doc.resolve(o.head));
      for (const r of sub.ranges) if (!seen.has(r.$from.pos)) { seen.add(r.$from.pos); all.push(r); }
    }
    this.ranges = all;
  }

  /** Every selected cell once: `f(cellNode, absPos)`. */
  forEachCell(f) {
    const table = this.$anchorCell.node(-1);
    const map = TableMap.get(table);
    const tableStart = this.$anchorCell.start(-1);
    const seen = new Set();
    const visit = (anchor, head) => {
      for (const rel of map.cellsInRect(map.rectBetween(anchor - tableStart, head - tableStart))) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        f(table.nodeAt(rel), tableStart + rel);
      }
    };
    for (const o of this.others) visit(o.anchor, o.head);
    visit(this.$anchorCell.pos, this.$headCell.pos);
  }

  map(doc, mapping) {
    const $anchorCell = doc.resolve(mapping.map(this.$anchorCell.pos));
    const $headCell = doc.resolve(mapping.map(this.$headCell.pos));
    const others = this.others.map((o) => ({ anchor: mapping.map(o.anchor), head: mapping.map(o.head) }));
    const ok = POINTS_AT_CELL($anchorCell) && POINTS_AT_CELL($headCell) && sameTable($anchorCell, $headCell)
      && others.every((o) => { const a = doc.resolve(o.anchor), h = doc.resolve(o.head); return POINTS_AT_CELL(a) && POINTS_AT_CELL(h) && sameTable(a, $anchorCell) && sameTable(h, $anchorCell); });
    // The table node is a new object after ANY edit inside it (a fill, a mark), so "same table" means the same GRID:
    // rows inserted/deleted or cells merged change the grid, and the earlier ranges' corners would mean something
    // else — then only the newest range survives.
    const oldMap = TableMap.get(this.$anchorCell.node(-1));
    const sameGrid = ok && (() => { const m = TableMap.get($anchorCell.node(-1)); return m.width === oldMap.width && m.height === oldMap.height; })();
    if (sameGrid) return new MultiCellSelection($anchorCell, $headCell, others);
    return super.map(doc, mapping);
  }

  eq(other) {
    return other instanceof MultiCellSelection
      && other.$anchorCell.pos === this.$anchorCell.pos && other.$headCell.pos === this.$headCell.pos
      && JSON.stringify(other.others) === JSON.stringify(this.others);
  }

  toJSON() {
    return { type: "multiCell", anchor: this.$anchorCell.pos, head: this.$headCell.pos, others: this.others };
  }

  static fromJSON(doc, json) {
    return new MultiCellSelection(doc.resolve(json.anchor), doc.resolve(json.head), json.others || []);
  }
}
MultiCellSelection.prototype.visible = false;
Selection.jsonID("multiCell", MultiCellSelection);

export const isMultiCell = (state) => !!state && state.selection instanceof MultiCellSelection;

/** Table-relative offsets of every selected cell when SEVERAL ranges are selected, else null (callers keep their
 *  single-rectangle path). */
export function multiCellPositions(state) {
  const sel = state && state.selection;
  if (!(sel instanceof MultiCellSelection)) return null;
  const table = sel.$anchorCell.node(-1);
  const map = TableMap.get(table);
  const tableStart = sel.$anchorCell.start(-1);
  const out = new Set();
  sel.forEachCell((_n, abs) => out.add(abs - tableStart));
  return { positions: [...out], map, table, tableStart };
}

/** The selection as the shared model: grid ranges, newest range active. Null outside a table. */
export function modelOf(state) {
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    const table = sel.$anchorCell.node(-1);
    const map = TableMap.get(table);
    const tableStart = sel.$anchorCell.start(-1);
    const active = gridOf(map, tableStart, sel.$anchorCell.pos, sel.$headCell.pos);
    const extra = sel instanceof MultiCellSelection ? sel.others.map((o) => gridOf(map, tableStart, o.anchor, o.head)) : [];
    return { sel: makeSelection(active, extra), map, tableStart, table };
  }
  const $cell = cellAround(sel.$anchor);
  if (!$cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const c = map.findCell($cell.pos - tableStart);
  return { sel: makeSelection({ r1: c.top, r2: c.bottom - 1, c1: c.left, c2: c.right - 1 }, []), map, tableStart, table };
}

/** A selection (plain CellSelection when only one range, else a MultiCellSelection) for a model + its table. */
export function selectionFromModel(doc, ctx, sel) {
  const ranges = rangesOf(sel);
  const active = ranges[ranges.length - 1];
  const a = cornersOf(ctx.map, ctx.tableStart, active);
  const others = ranges.slice(0, -1).map((g) => cornersOf(ctx.map, ctx.tableStart, g));
  const $a = doc.resolve(a.anchor), $h = doc.resolve(a.head);
  return others.length ? new MultiCellSelection($a, $h, others) : new CellSelection($a, $h);
}

/** What Ctrl+click on the cell at absolute position `cellPos` does to the selection of `state`: add the cell as
 *  a new range, or — when it is already selected — take it out. Returns a Selection, or null when this click is
 *  not ours (the caret is not already in that table). */
export function ctrlClickSelection(state, cellPos) {
  const cur = modelOf(state);
  if (!cur) return null;
  const $cell = state.doc.resolve(cellPos);
  if (!POINTS_AT_CELL($cell) || $cell.start(-1) !== cur.tableStart) return null;
  const c = cur.map.findCell(cellPos - cur.tableStart);
  const span = { r1: c.top, r2: c.bottom - 1, c1: c.left, c2: c.right - 1 };
  let next;
  if (selContains(cur.sel, span.r1, span.c1)) {
    // already selected: take the whole cell (every grid square of a merged one) out; the last cell is never removable
    next = cur.sel;
    for (let r = span.r1; r <= span.r2; r++) for (let k = span.c1; k <= span.c2; k++) next = toggleCellOut(next, r, k);
  } else {
    next = addRange(cur.sel, span);
  }
  return selectionFromModel(state.doc, cur, next);
}

/** Tell the person, out loud, that an action won't run on several ranges (LOUD-FAILURE). */
export function refuseMultiCell(editor) {
  try {
    editor.view.dom.dispatchEvent(new CustomEvent(NOTES_NOTICE_EVENT, { bubbles: true, detail: { message: MULTI_SELECTION_MESSAGE } }));
  } catch { /* a missing DOM is a test — the refusal itself (return value) still holds */ }
  return false;
}

export const NoteTableMultiSelect = Extension.create({
  name: "noteTableMultiSelect",
  priority: 1000,            // ahead of prosemirror-tables' own handlers
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey("noteTableMultiSelect"),
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
            if (view.dom.classList.contains("resize-cursor")) return false;          // on a column border
            // The box must be ENTERED: stage 1 of select-then-enter blurs the editor, and a Ctrl press on a box that is
            // not entered is the box's own (this native handler runs before the mat's, so it cannot rely on the mat's
            // preventDefault having happened yet).
            if (!view.hasFocus()) return false;
            const target = event.target;
            if (!(target instanceof Element) || !target.closest("td, th")) return false;
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!hit) return false;
            const $cell = cellAround(view.state.doc.resolve(hit.pos));
            if (!$cell) return false;
            const next = ctrlClickSelection(view.state, $cell.pos);
            if (!next) return false;                                                   // not entered into this table yet: ordinary press
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(next));
            if (!view.hasFocus()) view.focus();
            return true;
          },
          copy(view, event) { if (view.state.selection instanceof MultiCellSelection) { event.preventDefault(); refuseMultiCell(editor); return true; } return false; },
          cut(view, event) { if (view.state.selection instanceof MultiCellSelection) { event.preventDefault(); refuseMultiCell(editor); return true; } return false; },
        },
        handlePaste(view) {
          if (view.state.selection instanceof MultiCellSelection) { refuseMultiCell(editor); return true; }
          return false;
        },
      },
    })];
  },
});

