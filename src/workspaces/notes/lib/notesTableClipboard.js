/* notesTableClipboard — A TABLE THAT IS ALREADY ON A NOTES PAGE COPIES, CUTS AND PASTES (NEW-1,
 * owner report 2026-10-06: "I'm trying to copy a table that's already in the notebook module, and I can't
 * paste it.") — the OUTBOUND half; lib/notesTablePaste.js is the inbound half (a table from another app).
 *
 * ⛔ WHAT WAS WRONG, measured with real keys and the real clipboard (ui-audit/verify-notes-table-copy-paste.mjs):
 *   1. **A BOX THAT IS MERELY SELECTED COPIES NOTHING.** On desktop the first press on a box only SELECTS it
 *      and takes focus off the editor, so Ctrl+C / Ctrl+X reached no `copy` handler at all — the clipboard kept
 *      whatever it held before, and the next Ctrl+V pasted THAT (or nothing). The window-level handler for a
 *      selected box lives in NoteEditor.jsx and uses `contentOfBoxes` below.
 *   2. **CUTTING A WHOLE TABLE LEFT AN EMPTY TABLE BEHIND.** A select-every-cell range is a cell selection, and
 *      deleting a cell selection clears the cells but keeps the table. Cut of the WHOLE table now removes it
 *      (`wholeTableSelection`, `cutWholeTable`); a partial range still just clears its cells, as in Excel.
 *   3. **THE PLAIN-TEXT HALF OF THE CLIPBOARD WAS ONE CELL PER LINE.** Excel / Sheets / Word read `text/plain` as
 *      a grid only when it is tab-separated; ours put every cell on its own line, so a Notes table pasted into a
 *      spreadsheet's plain-text route became one column. `clipboardTextForSlice` writes rows as lines and cells
 *      as tabs (a cell holding a tab / newline / quote is quoted, as Excel writes it).
 *   4. **THERE WAS NO CLEAR WAY TO SELECT A WHOLE TABLE** once the caret was in it (a drag from an unfocused
 *      table pans the page, by design), so `selectWholeTable` is a command behind a toolbar button.
 *
 * Pure ProseMirror-model functions where possible (no DOM), so the node runner can exercise them.
 */
import { Extension } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { CellSelection, TableMap } from "@tiptap/pm/tables";

const isTable = (n) => !!n && n.type?.name === "table";

function hasTable(node) {
  if (isTable(node)) return true;
  let found = false;
  node.descendants((c) => { if (found) return false; if (isTable(c)) { found = true; return false; } return true; });
  return found;
}

/** One cell's text as a spreadsheet writes it: paragraphs joined by a newline, quoted when it holds a tab, a
 *  newline or a quote (`"` doubled). */
export function cellToTsv(cell) {
  const raw = cell.textBetween(0, cell.content.size, "\n", " ");
  return /[\t\n"]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** A table as tab-separated text: a row per line, a tab between cells. */
export function tableToTsv(table) {
  const rows = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cellToTsv(cell)));
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}

function fragmentText(frag) {
  const parts = [];
  frag.forEach((node) => {
    if (isTable(node)) parts.push(tableToTsv(node));
    else if (hasTable(node)) parts.push(fragmentText(node.content));        // a box / list / quote holding a table
    else parts.push(node.textBetween(0, node.content.size, "\n\n"));
  });
  return parts.join("\n\n");
}

/** `clipboardTextSerializer`: ProseMirror's own text for a slice, EXCEPT that every table in it becomes a
 *  tab-separated grid. A slice with no table gets exactly the text it always did. */
export function clipboardTextForSlice(slice) {
  const frag = slice.content;
  let any = false;
  frag.forEach((n) => { if (hasTable(n)) any = true; });
  if (!any) return frag.textBetween(0, frag.size, "\n\n");
  return fragmentText(frag);
}

/** The cell selection covers EVERY cell of its table (select-table button, or a drag corner to corner). */
export function wholeTableSelection(sel) {
  if (!(sel instanceof CellSelection)) return null;
  try {
    if (!(sel.isRowSelection() && sel.isColSelection())) return null;
    const $a = sel.$anchorCell;
    const table = $a.node(-1);
    if (!isTable(table)) return null;
    /* A rectangle that touches all four edges is the whole table; check it by counting cells so a merged
     * layout cannot fool the edge test. */
    const map = TableMap.get(table);
    const seen = new Set();
    sel.forEachCell((_n, pos) => seen.add(pos - $a.start(-1)));
    const all = new Set(map.map);
    if (seen.size !== all.size) return null;
    return { table, pos: $a.before(-1) };
  } catch (_) { return null; }
}

/** The contents (not the box wrapper) of the selected boxes as a Slice — what Ctrl+C on a selected box puts on
 *  the clipboard, so pasting it into a box inserts the contents and onto blank paper makes a new box. */
export function contentOfBoxes(doc, ids) {
  const want = new Set([...ids].map(String));
  const kids = [];
  doc.forEach((node) => {
    if (node.type.name !== "noteAnchor" || !want.has(String(node.attrs.aid || ""))) return;
    node.forEach((c) => kids.push(c));
  });
  return kids.length ? new Slice(Fragment.from(kids), 0, 0) : null;
}

/** Delete a whole table that was just copied (a cut). One transaction → one undo.
 *  ⛔ A BOX THAT HELD NOTHING BUT THAT TABLE GOES WITH IT, IN THE SAME STEP. Left behind empty, the box is
 *  pruned later by a transaction kept OUT of the undo history, and an undo of the cut then has no box to
 *  restore the table into — "cut, click elsewhere, undo" silently did nothing (measured). */
function cutWholeTable(view, hit, editor) {
  const $t = view.state.doc.resolve(hit.pos);
  const owner = $t.parent;
  if (owner?.type?.name === "noteAnchor" && owner.childCount === 1 && owner.attrs.aid && editor?.commands?.removeNoteAnchors) {
    if (editor.commands.removeNoteAnchors([String(owner.attrs.aid)])) return;
  }
  const tr = view.state.tr.delete(hit.pos, hit.pos + hit.table.nodeSize);
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(hit.pos, tr.doc.content.size)), -1)); } catch (_) { /* the near() is a nicety */ }
  tr.setMeta("uiEvent", "cut");
  view.dispatch(tr.scrollIntoView());
}

export const tableClipboardKey = new PluginKey("noteTableClipboard");

export const NoteTableClipboard = Extension.create({
  name: "noteTableClipboard",

  addCommands() {
    return {
      /** Select every cell of the table the caret is in. */
      selectWholeTable: () => ({ state, dispatch }) => {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d -= 1) {
          const node = $from.node(d);
          if (!isTable(node)) continue;
          const start = $from.start(d);
          const map = TableMap.get(node);
          if (!map.map.length) return false;
          const first = start + map.map[0];
          const last = start + map.map[map.map.length - 1];
          if (dispatch) dispatch(state.tr.setSelection(CellSelection.create(state.doc, first, last)));
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: tableClipboardKey,
        props: {
          clipboardTextSerializer: (slice) => clipboardTextForSlice(slice),
          handleDOMEvents: {
            /* ⛔ CUT OF A WHOLE TABLE REMOVES THE TABLE. ProseMirror's own cut would clear the cells and leave
             * an empty table; this writes the same clipboard it would (its own serializer, so `data-pm-slice`
             * and the formatting ride along) and deletes the table instead. */
            cut(view, e) {
              const hit = wholeTableSelection(view.state.selection);
              if (!hit || !e.clipboardData) return false;
              try {
                const { dom, text } = view.serializeForClipboard(view.state.selection.content());
                e.clipboardData.clearData();
                e.clipboardData.setData("text/html", dom.innerHTML);
                e.clipboardData.setData("text/plain", text);
              } catch (_) { return false; }               // could not write the clipboard: let the default cut run
              e.preventDefault();
              cutWholeTable(view, hit, editor);
              return true;
            },
          },
        },
      }),
    ];
  },
});

export default NoteTableClipboard;
