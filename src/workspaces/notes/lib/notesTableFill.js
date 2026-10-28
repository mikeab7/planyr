/* notesTableFill — HEADER ROWS ON ANY ROW, AND CELL FILL (NEW-1 / NEW-2, owner report 2026-10-28).
 *
 * THE REPORT. A Notes table's SECOND row looked bold and grey (it was all `tableHeader` cells), the
 * Bold button read "off", the size box read the same as everything else, and the only control —
 * "Header" — did nothing to it. Tiptap's own `toggleHeaderRow` is prosemirror-tables'
 * `toggleHeader("row")`, whose rectangle is hard-wired to ROW 0 (`top: 0, bottom: 1`), so a header row
 * anywhere else could not be undone from the UI at all.
 *
 * ⛔ HOW THE STRAY HEADER ROW FORMED — MEASURED, NOT INFERRED (the brief said "inference; confirm with a
 * red test"). prosemirror-tables 1.8.5's `addRow` does NOT copy header-ness into a new row beside a lone
 * header row: Row ↑ above a header row and Row ↓ below one both insert a PLAIN row (the matrix is a test:
 * test/notesTableFill.test.js). What happens is the header row is PUSHED DOWN — Header on row 1, then
 * Row ↑ (a plain row appears above it), and the same header row is now row 2. That is the whole mechanism,
 * which is why the fix is a toggle that acts on the caret's row, not a change to row insertion. (The only
 * time a new row IS header is between two header rows — it joins the header block — which is correct.)
 *
 * ⛔ THE HEADER LOOK IS CSS, NOT A MARK. `th { font-weight: 650; background: var(--surface-page) }` makes
 * header text look bold with no bold mark on it, so `editor.isActive("bold")` is false on text that is
 * visibly bold. `boldTruth` below is the one rule that makes the B button tell the truth there.
 *
 * ⛔ FILL IS A SOLID CELL ATTRIBUTE, NEVER OPACITY. `background` on tableCell / tableHeader:
 *   null            no fill of its own (a plain cell: none; a header cell: the default header shade)
 *   "#rrggbb"       a solid fill
 *   "transparent"   "No fill" on a HEADER cell — removes the shade without un-headering it
 * It rides the HTML as `data-cell-fill` (what Notes reads back on paste — a foreign table's own
 * backgrounds are deliberately NOT imported) plus an inline `background-color` (what Excel / Word / the
 * printed sheet read). One definition: the editor's serializer is also the print path (notesDocHtml.js).
 */
import { Extension } from "@tiptap/core";
import { CellSelection, TableMap, isInTable, selectedRect } from "@tiptap/pm/tables";
import { normalizeHex } from "../../../shared/ui/colorRecents.js";
import { TABLE_FILLS } from "./notesFormatPalette.js";

/* The palette itself lives with the module's other CONTENT colours (notesFormatPalette.js). */
export { TABLE_FILLS };

export const FILL_NONE = "transparent";

/** The ONE validator for a stored / parsed fill: a solid hex, or the explicit "transparent", else null.
 *  `rgb(r,g,b)` (a browser's own spelling of a computed colour) folds to hex; anything with alpha, a
 *  named colour, or junk is refused rather than guessed at (solid fills only). */
export function normalizeFill(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (s === FILL_NONE) return FILL_NONE;
  const hex = normalizeHex(s);
  if (hex) return hex;
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** What "No fill" / a swatch writes onto a cell of this type. "No fill" on a header cell is the explicit
 *  transparent (the shade is the header's default and only an explicit value overrides it); on a plain
 *  cell it is simply null. */
export function fillForCell(cellTypeName, choice) {
  const v = normalizeFill(choice);
  if (v == null) return cellTypeName === "tableHeader" ? FILL_NONE : null;
  return v;
}

/** The colour a cell visibly shows from its own `background` — `null` for none OR the default header shade
 *  (the swatch on the Fill button shows only a fill somebody chose). */
export function chosenFill(background) {
  const v = normalizeFill(background);
  return v && v !== FILL_NONE ? v : null;
}

/* ── reading the table around the selection ───────────────────────────────────────────────────── */

const isHeaderType = (n) => n?.type?.name === "tableHeader";

/** Positions (relative to the table start) of the cells whose anchor lies in rows [top, bottom) — a cell
 *  that spans in from a row above is included, which is what makes a merged header row toggle whole. */
function cellsInRows(map, top, bottom) {
  return map.cellsInRect({ left: 0, top, right: map.width, bottom });
}

/** The rows the caret / selection touches, as a rectangle: a cell selection is exactly its rectangle; a
 *  caret or text range is the cell(s) it sits in. `null` outside a table. */
export function tableTarget(state) {
  if (!state || !isInTable(state)) return null;
  const rect = selectedRect(state);
  return { rect, map: rect.map, table: rect.table, tableStart: rect.tableStart, isCells: state.selection instanceof CellSelection };
}

const rowIsAllHeader = (table, map, r) => {
  const cells = cellsInRows(map, r, r + 1);
  return cells.length > 0 && cells.every((pos) => isHeaderType(table.nodeAt(pos)));
};

/** Is the row (or every row) under the caret a header row? "true" · "false" · "mixed" · null (not in a table). */
export function headerRowsState(state) {
  const t = tableTarget(state);
  if (!t) return null;
  let yes = 0; let no = 0;
  for (let r = t.rect.top; r < t.rect.bottom; r += 1) { if (rowIsAllHeader(t.table, t.map, r)) yes += 1; else no += 1; }
  if (yes && no) return "mixed";
  return yes ? "true" : "false";
}

/* ── the header-row toggle, on the CARET'S row(s) ─────────────────────────────────────────────── */

/** Toggle header-ness of every row the caret / selection touches. All header → plain; anything else →
 *  header. A header COLUMN (the first cell of every other row is a header) is left alone when turning a row
 *  plain, so un-headering a row never strips a column heading the rest of the table still has. */
export function toggleHeaderRows(state, dispatch) {
  const t = tableTarget(state);
  if (!t) return false;
  const { map, table, tableStart, rect } = t;
  const rows = []; for (let r = rect.top; r < rect.bottom; r += 1) rows.push(r);
  const makePlain = rows.every((r) => rowIsAllHeader(table, map, r));
  if (!dispatch) return true;

  const inRows = new Set(rows);
  let headerColumn = false;
  if (makePlain) {
    let others = 0; let allHeader = true;
    for (let r = 0; r < map.height; r += 1) {
      if (inRows.has(r)) continue;
      others += 1;
      if (!isHeaderType(table.nodeAt(map.map[r * map.width]))) { allHeader = false; break; }
    }
    headerColumn = others > 0 && allHeader;
  }
  const types = table.type.schema.nodes;
  const tr = state.tr;
  const seen = new Set();
  for (const r of rows) {
    for (const pos of cellsInRows(map, r, r + 1)) {
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cell = table.nodeAt(pos);
      if (!cell) continue;
      if (makePlain) {
        if (headerColumn && pos === map.map[r * map.width]) continue;      // the column heading stays
        const bg = cell.attrs.background === FILL_NONE ? null : cell.attrs.background;
        tr.setNodeMarkup(tableStart + pos, types.tableCell, { ...cell.attrs, background: bg });
      } else if (!isHeaderType(cell)) {
        tr.setNodeMarkup(tableStart + pos, types.tableHeader, cell.attrs);
      }
    }
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/* ── fill ──────────────────────────────────────────────────────────────────────────────────────── */

/** Positions (table-relative) a fill applies to: a cell selection → exactly those cells; otherwise the
 *  caret cell's whole ROW (the brief: "the caret cell's whole ROW when nothing is selected"). */
function fillTargets(t) {
  const { map, rect, isCells } = t;
  return isCells ? map.cellsInRect(rect) : cellsInRows(map, rect.top, rect.bottom);
}

/** Paint every target cell with `choice` (null = No fill). Refuses (false) a value that is not a solid
 *  colour, so a malformed value can never reach the document. */
export function setCellFill(choice) {
  return (state, dispatch) => {
    const t = tableTarget(state);
    if (!t) return false;
    if (choice != null && normalizeFill(choice) == null) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    for (const pos of fillTargets(t)) {
      const cell = t.table.nodeAt(pos);
      if (!cell) continue;
      const next = fillForCell(cell.type.name, choice);
      if ((cell.attrs.background ?? null) === next) continue;
      tr.setNodeMarkup(t.tableStart + pos, undefined, { ...cell.attrs, background: next });
    }
    dispatch(tr);
    return true;
  };
}

/** The fill the Fill button should show for the current target: a hex, `null` (none), "mixed", or
 *  `undefined` outside a table. */
export function currentFill(state) {
  const t = tableTarget(state);
  if (!t) return undefined;
  const seen = new Set();
  for (const pos of fillTargets(t)) seen.add(chosenFill(t.table.nodeAt(pos)?.attrs.background));
  if (seen.size > 1) return "mixed";
  return seen.size ? [...seen][0] : null;
}

/* ── Bold tells the truth inside a header cell ────────────────────────────────────────────────── */

/** Is the selection's text inside header cells? "all" · "some" · "none". A header cell's text is bold by
 *  STYLE, so it carries no bold mark — the B button has to know. */
export function selectionInHeaderCells(state) {
  if (!state) return "none";
  let inHeader = 0; let outside = 0;
  const check = ($pos) => {
    for (let d = $pos.depth; d > 0; d -= 1) if (isHeaderType($pos.node(d))) return true;
    return false;
  };
  if (state.selection.empty) return check(state.selection.$from) ? "all" : "none";
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) return true;
      if (check(state.doc.resolve(pos + 1))) inHeader += 1; else outside += 1;
      return false;
    });
  }
  if (inHeader && !outside) return "all";
  return inHeader ? "some" : "none";
}

/** ⛔ THE ONE RULE for the B button: it must never read "off" on text that is visibly bold. `base` is the
 *  mark-derived state ("true"/"false"/"mixed"); `header` is `selectionInHeaderCells`. */
export function boldTruth(base, header) {
  if (base === "true") return "true";
  if (header === "all") return "true";
  if (header === "some") return "mixed";
  return base;
}

export const BOLD_TITLE = "Bold";
export const BOLD_TITLE_IN_HEADER = "Bold (header row: use Header row to change)";

/* ── the Tiptap extension ──────────────────────────────────────────────────────────────────────── */

export const NoteTableFill = Extension.create({
  name: "noteTableFill",
  addGlobalAttributes() {
    return [{
      types: ["tableCell", "tableHeader"],
      attributes: {
        background: {
          default: null,
          parseHTML: (el) => normalizeFill(el.getAttribute("data-cell-fill")),
          renderHTML: (attrs) => {
            const v = normalizeFill(attrs.background);
            return v ? { "data-cell-fill": v, style: `background-color: ${v}` } : {};
          },
        },
      },
    }];
  },
  addCommands() {
    return {
      toggleHeaderRows: () => ({ state, dispatch }) => toggleHeaderRows(state, dispatch),
      setCellFill: (choice) => ({ state, dispatch }) => setCellFill(choice)(state, dispatch),
    };
  },
});
