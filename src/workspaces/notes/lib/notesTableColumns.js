/* notesTableColumns — THE EDITOR-SIDE HALF OF notesTableWidth.js: reading a live table's
 * per-column widths off the real ProseMirror node, and writing normalized ones back.
 *
 * Split out of notesTableWidth.js because THIS file pulls the schema (`@tiptap/core`,
 * `@tiptap/pm/tables`) and that one must not — notesPrint.js imports the pure half directly, the
 * same split `notesBoxResize.js`/`notesAnchorNode.js` already use for the identical reason.
 *
 * ⛔ TWO DEFENCES, NOT ONE, FOR THE SAME REASON `notesExtensions.js`'s `noteSpacingBlockSize`
 * ALREADY NEEDS TWO — read that extension's own header before changing either of these:
 *
 *  (a) an `appendTransaction` PLUGIN, for every LIVE edit. This is what makes a resize's own
 *      repair ride the SAME undo step as the resize itself — appendTransaction's result is
 *      folded into the SAME state transition prosemirror-history records, so Ctrl+Z reverts
 *      the dragged column AND whatever this normalized in one press, not two. A first version
 *      of this ran the repair from a `useEffect` keyed on every `docTick` instead, and it
 *      LOOKED right until undo was actually pressed: reverting the drag left the OTHER columns
 *      explicit (from a separate, `addToHistory:false` repair transaction), which is itself a
 *      "touched, one column null" table — so the SAME repair fired again and silently refilled
 *      the column the user had just asked to go back to unset, defeating the undo in total
 *      silence. Bundling the repair into the resize's own transaction removes the SEPARATE step
 *      that could be undone independently of it.
 *  (b) the COMMAND below, called once on MOUNT (never on every `docTick`) — because
 *      `appendTransaction` never runs for Tiptap's initial `setContent`, an already-broken
 *      table that is opened and never edited would stay broken forever without this. Marked
 *      `addToHistory:false`, the same reasoning `ensureNoteAnchorIds` already uses: the first
 *      Ctrl+Z after opening an old note must undo what the owner actually did, not a repair he
 *      never asked for.
 *
 * ⛔ NEITHER DEFENCE MEASURES THE LIVE DOM. A flat default (`TABLE_DEFAULT_COL_WIDTH`) is used
 * for every still-unset column, not "whatever it currently renders at" — `appendTransaction`
 * runs mid-transaction-resolution, before the view re-renders, so there is no reliable rendered
 * width to read for the NEW state, and reading the OLD one risks measuring a table that is about
 * to look different anyway. The trade-off is real and is stated rather than hidden: the other
 * columns get a normal, readable width, not necessarily the EXACT pixel they had a moment ago —
 * see notesTableWidth.js's own header for why that is an acceptable, honestly-reported cost
 * against the alternative (undo silently not undoing).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { normalizedColumnWidths } from "./notesTableWidth.js";

/** One table node's widths, one entry per column, `null` where a column has never been resized.
 *  Mirrors `@tiptap/extension-table`'s own `updateColumns`/`createColGroup` walk exactly — a
 *  cell's `colwidth` is an array of one width per column it spans, so a `colspan` cell
 *  contributes that many slots. Reading only the FIRST row is the same convention the library's
 *  own rendering already relies on: ProseMirror keeps a column's width consistent across every
 *  row through `fixTables`, so the first row is authoritative. */
export function tableColumnWidths(tableNode) {
  const row = tableNode.firstChild;
  const widths = [];
  if (!row) return widths;
  for (let i = 0, col = 0; i < row.childCount; i += 1) {
    const { colspan, colwidth } = row.child(i).attrs;
    for (let j = 0; j < colspan; j += 1, col += 1) {
      widths[col] = colwidth && colwidth[j] ? colwidth[j] : null;
    }
  }
  return widths;
}

/** THE ONE WALK, shared by the plugin and the command below — mirrors `deriveBlockSizes`'s own
 *  shape in `notesExtensions.js` exactly (a plain `(doc, tr) => touched` function, not a Tiptap
 *  command), which is what lets an `appendTransaction` plugin call it directly with no command
 *  machinery in between. Mutates `tr` in place; returns whether it changed anything. */
export function applyTableColumnNormalization(doc, tr) {
  let touched = false;
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const widths = tableColumnWidths(node);
    const next = normalizedColumnWidths(widths);
    if (!next) return false;                     // untouched, or already normalized
    const map = TableMap.get(node);
    for (let col = 0; col < next.length; col += 1) {
      for (let row = 0; row < map.height; row += 1) {
        const mapIndex = row * map.width + col;
        // A rowspan continuation names the SAME cell its row above already named — skip it, or
        // the same cell's colwidth would be rewritten (harmlessly, but repeatedly) once per row
        // it spans.
        if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;
        const cellRelPos = map.map[mapIndex];
        const cellNode = node.nodeAt(cellRelPos);
        if (!cellNode) continue;
        const { colspan, colwidth } = cellNode.attrs;
        const localIndex = colspan === 1 ? 0 : col - map.colCount(cellRelPos);
        if (colwidth && colwidth[localIndex] === next[col]) continue;
        const newColwidth = colwidth ? colwidth.slice() : new Array(colspan).fill(0);
        newColwidth[localIndex] = next[col];
        // `start` is the position right after the table's own opening tag — the same convention
        // `updateColumnWidth` in `@tiptap/pm/tables` uses, so a cell's position here matches
        // exactly what a real drag would have written.
        tr.setNodeMarkup(pos + 1 + cellRelPos, undefined, { ...cellNode.attrs, colwidth: newColwidth });
        touched = true;
      }
    }
    return false;                                  // tables do not nest in this schema
  });
  return touched;
}

/** ⛔ THE ON-LOAD RECOVERY COMMAND FOR NEW-2 (chosen over a manual "fit to content" button or
 *  leaving it manual-only) — called ONCE per editor mount (never on every `docTick`; see this
 *  file's header for why), so an already-squeezed table repairs itself the moment the note is
 *  opened, with no action on the owner's part and no interference with undo/redo on any LATER
 *  edit (the appendTransaction plugin owns those).
 *
 *  ⛔ EXPORTED AS A PLAIN PROSEMIRROR COMMAND, the same shape `notesListIndent.js`'s `shiftIndent`
 *  uses, so a test can drive the real code path against a hand-built `EditorState` with no DOM —
 *  this repo's unit runner is node-only. */
export const normalizeTableColumnWidths = () => ({ tr, dispatch, state }) => {
  const touched = applyTableColumnNormalization(state.doc, tr);
  if (touched && dispatch) {
    // Bookkeeping, not an edit the owner made — matches `ensureNoteAnchorIds`'s own reasoning:
    // the first Ctrl+Z after opening an old note must undo what he actually did, not silently
    // put a table's stale narrow columns back.
    dispatch(tr.setMeta("addToHistory", false));
  }
  return touched;
};

/** ⛔ EVERY `<col>` GETS BOTH ITS PROPERTIES DECIDED, EVERY TIME — NEVER ONLY THE ONE THAT
 *  CURRENTLY APPLIES (B1554272/B1554273, found live). `@tiptap/extension-table`'s own
 *  `updateColumns` only ever calls `col.style.setProperty` for whichever ONE of `width`/
 *  `min-width` the CURRENT state wants, and never clears the OTHER — so a column that goes from
 *  explicit (say, dragged to 260px) back to unset (an undo) gets a freshly-set `min-width: 100px`
 *  ALONGSIDE its already-present, now-stale `width: 260px`, and CSS `width` wins over `min-width`
 *  whenever both are set: the column keeps rendering at the old size forever. Measured directly:
 *  after undo, the STORED document correctly read `colwidth: null` — the model was never wrong —
 *  while the live `<col>` element still carried `width: 260px`, so the table looked completely
 *  unchanged and Ctrl+Z read as broken. Setting BOTH properties on every call (one to a real
 *  value, the other explicitly removed) makes every transition self-correcting regardless of
 *  which property the PREVIOUS render happened to leave behind. */
function applyColStyle(col, cellMinWidth, width) {
  if (width) {
    col.style.width = `${Math.max(width, cellMinWidth)}px`;
    col.style.removeProperty("min-width");
  } else {
    col.style.removeProperty("width");
    col.style.minWidth = `${cellMinWidth}px`;
  }
}

/** The library's `updateColumns` (`@tiptap/extension-table`), corrected at the one line above —
 *  otherwise an exact mirror: same total-width accumulation, same col-count/create/reuse/trim
 *  walk, same `table.style.width`-vs-`minWidth` decision for whether every column is explicit. */
function syncTableColumns(node, colgroup, table, cellMinWidth) {
  let totalWidth = 0;
  let fixedWidth = true;
  let nextDOM = colgroup.firstChild;
  const row = node.firstChild;
  if (row) {
    for (let i = 0, col = 0; i < row.childCount; i += 1) {
      const { colspan, colwidth } = row.child(i).attrs;
      for (let j = 0; j < colspan; j += 1, col += 1) {
        const hasWidth = colwidth && colwidth[j];
        totalWidth += hasWidth || cellMinWidth;
        if (!hasWidth) fixedWidth = false;
        if (!nextDOM) {
          const colEl = document.createElement("col");
          applyColStyle(colEl, cellMinWidth, hasWidth);
          colgroup.appendChild(colEl);
        } else {
          applyColStyle(nextDOM, cellMinWidth, hasWidth);
          nextDOM = nextDOM.nextSibling;
        }
      }
    }
  }
  while (nextDOM) {
    const after = nextDOM.nextSibling;
    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after;
  }
  const hasUserWidth = typeof node.attrs.style === "string" && /\bwidth\s*:/i.test(node.attrs.style);
  if (fixedWidth && !hasUserWidth) {
    table.style.width = `${totalWidth}px`;
    table.style.minWidth = "";
  } else {
    table.style.width = "";
    table.style.minWidth = `${totalWidth}px`;
  }
}

/** ⛔ THE NODE VIEW ITSELF — an exact structural mirror of `@tiptap/extension-table`'s own
 *  `TableView` (wrapper div, table, colgroup, tbody-as-contentDOM, the same `ignoreMutation`
 *  scope), so the live-drag preview (`displayColumnWidth` in `@tiptap/pm/tables`, which finds
 *  and patches this exact `<table>` through `view.domAtPos`) and the resize plugin's decorations
 *  work exactly as they do against the library's own view. The only change is calling
 *  `syncTableColumns` instead of the library's `updateColumns`. See `notesExtensions.js`'s
 *  `NoteTable` for why a table never goes without this node view, resizable or not. */
export class NoteTableView {
  constructor(node, cellMinWidth, _view, HTMLAttributes = {}) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    for (const [key, value] of Object.entries(HTMLAttributes)) {
      if (value == null) continue;
      if (key === "style") this.table.style.cssText = String(value);
      else this.table.setAttribute(key, String(value));
    }
    if (node.attrs.style) this.table.style.cssText = node.attrs.style;
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    syncTableColumns(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    syncTableColumns(node, this.colgroup, this.table, this.cellMinWidth);
    return true;
  }

  ignoreMutation(mutation) {
    const target = mutation.target;
    const insideWrapper = this.dom.contains(target);
    const insideContent = this.contentDOM.contains(target);
    if (insideWrapper && !insideContent) {
      return mutation.type === "attributes" || mutation.type === "childList" || mutation.type === "characterData";
    }
    return false;
  }
}

export const NoteTableColumns = Extension.create({
  name: "noteTableColumns",

  addCommands() {
    return { normalizeTableColumnWidths };
  },

  /* ⛔ THE LIVE-EDIT DEFENCE — see this file's header, clause (a). Runs on every doc-changing
   * transaction, so a resize's own repair rides the SAME undo step as the resize. Idempotent
   * (matches `noteSpacingBlockSize`'s identical shape): `applyTableColumnNormalization` returns
   * `false` the moment nothing needs changing, so this is safe as a standing plugin rather than
   * a one-shot reaction. */
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("noteTableColumnsAppend"),
      appendTransaction: (trs, _old, newState) => {
        if (!trs.some((t) => t.docChanged)) return null;
        const tr = newState.tr;
        if (!applyTableColumnNormalization(newState.doc, tr)) return null;
        return tr;
      },
    })];
  },
});

export default NoteTableColumns;
