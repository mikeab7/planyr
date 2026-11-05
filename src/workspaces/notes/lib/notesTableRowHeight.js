/* notesTableRowHeight — DRAG THE LINE UNDER A ROW TO CHANGE ITS HEIGHT (NEW-3, owner report 2026-11-05:
 * "it doesn't let me change row height"). MEASURED FIRST: there was no way at all — `tableRow` carried no
 * attribute, no handle and no cursor; only column widths could be dragged. So this builds the drag, modelled on
 * Excel and Word:
 *   · the line between two rows (and under the last row) is a hot zone; the cursor becomes ↕ over it;
 *   · dragging it sets that row's height — taller AND shorter — live, as one undo step on release;
 *   · with whole rows selected, dragging any selected row's line sets them ALL to the same height;
 *   · a row can never be dragged shorter than its text needs: dragging back down to that point stores NO
 *     height at all (the row is "auto" again and follows its text — it shrinks when the text size is reduced);
 *   · double-clicking the line is Excel's AutoFit: the stored height is cleared.
 *
 * STORED as `rowHeight` (CSS px, a MINIMUM — a row can still grow to fit longer text) on the `tableRow` node;
 * rendered as `style="height: Npx"` + `data-row-height`, so it saves, syncs, prints and copies with the table
 * (PDF-PARITY: the print sheet is serialised from the editor's own schema). `null` = auto.
 *
 * ⛔ HOW IT STAYS OUT OF THE COLUMN DRAG'S WAY: prosemirror-tables owns the vertical lines. This handler
 * declines inside the column-handle zone (by x, and by the library's own `resize-cursor` class) and runs at a
 * higher plugin priority so its mousedown wins the row line before the library starts a cell selection there.
 * ⛔ SCREEN vs CSS PIXELS: the Notes workspace is scaled by a CSS transform, so a screen delta is divided by
 * the element's measured scale (rect height / offsetHeight) — never an assumed 1.
 * Mouse only; touch keeps its page pan (the same limit the column drag has).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { CellSelection, selectedRect } from "@tiptap/pm/tables";

export const ROW_HEIGHT_MAX = 1600;
/** Half-width (screen px) of the hot zone either side of a row line. */
export const ROW_LINE_ZONE = 4;
/** Keep the cell-edge column zone (screen px) for the column drag. */
export const COLUMN_EDGE_ZONE = 6;
export const ROW_RESIZE_CLASS = "planyr-row-resize";

/** PURE — the height a drag asks for → what to store. `natural` is the height the row's text needs. */
export function rowHeightForDrag({ startH, dy, natural }) {
  const want = Math.round(Math.min(ROW_HEIGHT_MAX, startH + dy));
  if (!Number.isFinite(want)) return { px: natural, stored: null };
  if (want <= Math.ceil(natural)) return { px: Math.ceil(natural), stored: null };      // as short as the text allows → auto
  return { px: want, stored: want };
}

/** PURE — the rows a drag on row `idx` applies to: every selected row when whole rows are selected. */
export function rowsForDrag({ idx, selectedTop, selectedBottom, wholeRows }) {
  if (wholeRows && idx >= selectedTop && idx < selectedBottom) {
    const out = []; for (let i = selectedTop; i < selectedBottom; i += 1) out.push(i); return out;
  }
  return [idx];
}

/** The boundary under the pointer: { idx (row whose BOTTOM line it is), table, rows } or null. */
export function rowLineAt(view, event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const cell = target.closest("td,th");
  if (!cell && view.dom.contains(target)) {
    /* the LAST row's bottom line sits on the table's outer edge — a pointer there is over the wrapper, not a cell */
    for (const table of view.dom.querySelectorAll("table")) {
      const last = table.rows[table.rows.length - 1];
      if (!last) continue;
      const tr = table.getBoundingClientRect(); const lr = last.getBoundingClientRect();
      if (event.clientX - tr.left < COLUMN_EDGE_ZONE || tr.right - event.clientX < COLUMN_EDGE_ZONE || event.clientX > tr.right || event.clientX < tr.left) continue;
      if (Math.abs(event.clientY - lr.bottom) <= ROW_LINE_ZONE) return { idx: table.rows.length - 1, table };
    }
    return null;
  }
  if (!cell || !view.dom.contains(cell)) return null;
  const tr = cell.parentElement;
  const table = tr?.closest("table");
  if (!tr || !table) return null;
  const rect = cell.getBoundingClientRect();
  if (event.clientX - rect.left < COLUMN_EDGE_ZONE || rect.right - event.clientX < COLUMN_EDGE_ZONE) return null;   // the column drag's
  const dBottom = rect.bottom - event.clientY;
  const dTop = event.clientY - rect.top;
  let idx = null;
  if (dBottom <= ROW_LINE_ZONE && dBottom >= -ROW_LINE_ZONE) idx = tr.rowIndex + (cell.rowSpan || 1) - 1;
  else if (dTop <= ROW_LINE_ZONE && dTop >= -ROW_LINE_ZONE && tr.rowIndex > 0) idx = tr.rowIndex - 1;
  if (idx == null || idx < 0 || idx >= table.rows.length) return null;
  return { idx, table };
}

/** Document position of the `tableRow` whose DOM node is `trEl`, or -1. */
function rowPosOf(view, trEl) {
  try {
    const $p = view.state.doc.resolve(view.posAtDOM(trEl, 0));
    for (let d = $p.depth; d > 0; d -= 1) if ($p.node(d).type.name === "tableRow") return $p.before(d);
  } catch { /* detached */ }
  return -1;
}

const scaleOf = (el) => { const h = el.offsetHeight; const r = el.getBoundingClientRect().height; return h > 0 && r > 0 ? r / h : 1; };

function selectedRowSpan(view, tableEl) {
  const sel = view.state.selection;
  if (!(sel instanceof CellSelection) || !sel.isRowSelection()) return null;
  try {
    const rect = selectedRect(view.state);
    const tr0 = tableEl.rows[rect.top];
    if (!tr0) return null;
    return { top: rect.top, bottom: rect.bottom };
  } catch { return null; }
}

export function rowHeightPlugin() {
  const key = new PluginKey("noteTableRowHeight");
  let drag = null;

  const clearCursor = (view) => view.dom.classList.remove(ROW_RESIZE_CLASS);

  const finish = (view, ev, commit) => {
    const d = drag; drag = null;
    window.removeEventListener("mousemove", d.move, true);
    window.removeEventListener("mouseup", d.up, true);
    document.body.style.removeProperty("cursor");
    clearCursor(view);
    if (!commit) { d.trs.forEach((t) => { t.style.height = d.prev.get(t) || ""; }); return; }
    const dy = (ev.clientY - d.startY) / d.scale;
    // natural height of each row = what its text needs with no explicit height
    const edits = [];
    for (const t of d.trs) {
      const keep = t.style.height; t.style.height = "";
      const natural = t.getBoundingClientRect().height / d.scale;
      t.style.height = keep;
      const { stored } = rowHeightForDrag({ startH: d.startH, dy, natural });
      const pos = rowPosOf(view, t);
      if (pos >= 0) edits.push({ pos, stored });
    }
    let tr = view.state.tr;
    let changed = false;
    for (const e of edits) {
      const node = tr.doc.nodeAt(e.pos);
      if (!node || node.type.name !== "tableRow" || (node.attrs.rowHeight ?? null) === e.stored) continue;
      tr = tr.setNodeMarkup(e.pos, undefined, { ...node.attrs, rowHeight: e.stored });
      changed = true;
    }
    d.trs.forEach((t) => { t.style.height = d.prev.get(t) || ""; });       // the view re-renders the stored value
    if (changed) view.dispatch(tr);
  };

  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (drag) return false;
          const edit = view.editable;
          if (!edit) return false;
          if (view.dom.classList.contains("resize-cursor")) { clearCursor(view); return false; }
          const hit = rowLineAt(view, event);
          if (hit) view.dom.classList.add(ROW_RESIZE_CLASS); else clearCursor(view);
          return false;
        },
        mouseleave(view) { if (!drag) clearCursor(view); return false; },
        mousedown(view, event) {
          if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !view.editable) return false;
          if (view.dom.classList.contains("resize-cursor")) return false;
          const hit = rowLineAt(view, event);
          if (!hit) return false;
          const span = selectedRowSpan(view, hit.table);
          const idxs = rowsForDrag({ idx: hit.idx, selectedTop: span?.top ?? 0, selectedBottom: span?.bottom ?? 0, wholeRows: !!span });
          const trs = idxs.map((i) => hit.table.rows[i]).filter(Boolean);
          const lead = hit.table.rows[hit.idx];
          if (!lead) return false;
          const scale = scaleOf(lead);
          const prev = new Map(trs.map((t) => [t, t.style.height]));
          const startH = lead.getBoundingClientRect().height / scale;
          const startY = event.clientY;
          const move = (e) => {
            e.preventDefault();
            const dy = (e.clientY - startY) / scale;
            const px = Math.max(1, Math.min(ROW_HEIGHT_MAX, Math.round(startH + dy)));
            trs.forEach((t) => { t.style.height = `${px}px`; });
          };
          const up = (e) => { e.preventDefault(); finish(view, e, true); };
          drag = { startY, startH, scale, trs, prev, move, up };
          window.addEventListener("mousemove", move, true);
          window.addEventListener("mouseup", up, true);
          document.body.style.setProperty("cursor", "row-resize");
          event.preventDefault();
          return true;
        },
        dblclick(view, event) {
          if (!view.editable || event.button !== 0) return false;
          const hit = rowLineAt(view, event);
          if (!hit) return false;
          const span = selectedRowSpan(view, hit.table);
          const idxs = rowsForDrag({ idx: hit.idx, selectedTop: span?.top ?? 0, selectedBottom: span?.bottom ?? 0, wholeRows: !!span });
          let tr = view.state.tr; let changed = false;
          for (const i of idxs) {
            const pos = rowPosOf(view, hit.table.rows[i]);
            const node = pos >= 0 ? tr.doc.nodeAt(pos) : null;
            if (node && node.type.name === "tableRow" && node.attrs.rowHeight != null) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, rowHeight: null }); changed = true; }
          }
          if (changed) view.dispatch(tr);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

export const NoteTableRowHeight = Extension.create({
  name: "noteTableRowHeight",
  priority: 500,                                   // before the table plugins: the row line is ours, the column line is theirs
  addGlobalAttributes() {
    return [{
      types: ["tableRow"],
      attributes: {
        rowHeight: {
          default: null,
          parseHTML: (el) => {
            const n = Number(el.getAttribute("data-row-height"));
            return Number.isFinite(n) && n > 0 ? Math.min(ROW_HEIGHT_MAX, Math.round(n)) : null;
          },
          renderHTML: (attrs) => (attrs.rowHeight ? { "data-row-height": String(attrs.rowHeight), style: `height: ${attrs.rowHeight}px` } : {}),
        },
      },
    }];
  },
  addProseMirrorPlugins() { return [rowHeightPlugin()]; },
});

/** The row's node view (wired onto the table-row extension in `notesExtensions.js`, the ONE declaration of what a note may
 *  contain): a live drag patches `style.height` on the `<tr>` for a smooth preview, and without `ignoreMutation`
 *  ProseMirror reads that as an edit to the row and redraws it from the document — wiping the preview on the next mouse
 *  move (measured: the stored height stayed null and the row never moved). `update` re-applies the stored height, so an
 *  undo/redo/sync repaints it. */
export function rowNodeView({ node: first }) {
  let node = first;
  const dom = document.createElement("tr");
  const apply = (n) => {
    const h = n.attrs.rowHeight;
    if (h) { dom.setAttribute("data-row-height", String(h)); dom.style.height = `${h}px`; }
    else { dom.removeAttribute("data-row-height"); dom.style.removeProperty("height"); if (!dom.getAttribute("style")) dom.removeAttribute("style"); }
  };
  apply(node);
  return {
    dom,
    contentDOM: dom,
    update(next) { if (next.type !== node.type) return false; node = next; apply(next); return true; },
    ignoreMutation(m) { return m.type === "attributes" && (m.attributeName === "style" || m.attributeName === "data-row-height"); },
  };
}
