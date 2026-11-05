/* notesPasteModes — WORD'S AND EXCEL'S PASTE OPTIONS, AS PURE TRANSFORMS OVER THE JUST-PASTED RANGE
 * (NEW-1, owner approved "Office-style" 2026-10-29).
 *
 * THE CONTRACT, unchanged from the three-mode badge (B36051): choosing an option RE-TRANSFORMS THE
 * PASTE IN PLACE as ONE undo step — it never re-pastes from the clipboard. What is new is that the
 * choice can be made TWICE: the offer keeps `baseDoc`, the document exactly as the paste left it,
 * and every pick is "put the paste back to base, then apply THIS option". So Keep Text Only → Merge
 * Formatting → Keep Source Formatting each start from the same bytes, and none of them can compound
 * the loss of the one before (a text-only paste cannot be un-flattened any other way).
 *
 * Two SETS of options, chosen by what the paste landed:
 *   text   Keep Source Formatting (K) · Merge Formatting (M) · Keep Text Only (T)
 *   table  Paste: Keep Source Formatting (K) · Merge Formatting (M) · Keep Source Column Widths (W) · Transpose (T)
 *          Paste Values: Values (V) · Values and Source Formatting (E)
 *          Other Paste Options: Formatting only (R) · Picture (U)
 * — the table set is Excel's, with Notes' own meaning where Excel's does not apply (a Notes table carries
 * text marks, header cells, a per-cell fill and per-column widths; it has no formulas, links to a source
 * workbook or number formats). Each meaning is stated on its function below.
 *
 * ⛔ A FOREIGN TABLE'S CELL SHADING AND COLUMN WIDTHS ARE NOT IMPORTED BY THE ORDINARY PASTE
 * (notesTableFill.js: "a foreign table's own backgrounds are deliberately NOT imported"; notesTablePaste.js:
 * the table's natural width, "never the source's pixel widths"). That stays true — the DEFAULT paste is
 * unchanged. The source's fills and widths are CAPTURED at paste time (notesPastePlain.js, from the clipboard
 * HTML, before the parse discards them) and are applied only by the options that ask for them: W (widths),
 * E and R (fills).
 *
 * PURE: ProseMirror nodes and transactions only. No DOM, no editor, no React — the unit runner is node-only.
 */
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { mergeFormattingInRange } from "./notesPastePlain.js";
import { normalizeFill } from "./notesTableFill.js";
import { TABLE_COL_MIN_WIDTH } from "./notesTableWidth.js";

/* ── names, keys and the sets ─────────────────────────────────────────────────────────────── */

/** Word's and Excel's exact names, and the access key each is picked with while the flyout is open. */
export const PASTE_MODE_META = {
  source: { label: "Keep Source Formatting", key: "K" },
  merge: { label: "Merge Formatting", key: "M" },
  text: { label: "Keep Text Only", key: "T" },
  widths: { label: "Keep Source Column Widths", key: "W" },
  transpose: { label: "Transpose", key: "T" },
  values: { label: "Values", key: "V" },
  valuesFormat: { label: "Values and Source Formatting", key: "E" },
  formatting: { label: "Formatting only", key: "R" },
  picture: { label: "Picture", key: "U" },
};

/** The ordered ids the flyout may show, by group. The first group has no heading (the flyout's own "Paste Options:"
 *  header covers it) in the text set and the heading "Paste" in the table set, exactly as Excel labels them. */
export function pasteSetFor(offer) {
  const kind = offer?.kind || "text";
  const hasWidths = !!offer?.meta?.tables?.some((t) => t?.widths?.some((w) => w > 0));
  if (kind === "table") {
    return [
      { title: "Paste", modes: ["source", "merge", ...(hasWidths ? ["widths"] : []), "transpose"] },
      { title: "Paste Values", modes: ["values", "valuesFormat"] },
      { title: "Other Paste Options", modes: ["formatting", "picture"] },
    ];
  }
  if (kind === "cells") {
    return [
      { title: "Paste", modes: ["source", "merge"] },
      { title: "Paste Values", modes: ["values", "valuesFormat"] },
      { title: "Other Paste Options", modes: ["formatting"] },
    ];
  }
  if (kind === "grown") return [{ title: null, modes: ["source", "merge"] }];
  return [{ title: null, modes: ["source", "merge", "text"] }];
}

/** Every mode id in a set, flat. */
export const modesOfSet = (set) => set.flatMap((g) => g.modes);

/** The mode a key picks within a set (the same letter means different things in the two sets — T is Keep Text
 *  Only for text and Transpose for a table), or null. */
export function modeForKey(set, key) {
  const k = String(key || "").toLowerCase();
  return modesOfSet(set).find((m) => PASTE_MODE_META[m].key.toLowerCase() === k) || null;
}

/* ── what did the paste land? ─────────────────────────────────────────────────────────────── */

const isCell = (n) => n?.type?.name === "tableCell" || n?.type?.name === "tableHeader";

/** Positions (in `doc`) of the tables that are NEW in `doc` — a table node whose object identity was not in
 *  `preDoc`. ProseMirror shares unchanged nodes between document versions, so identity is the exact test for
 *  "the paste made this" (a table the paste merely sat next to keeps its identity). Nested tables are not
 *  reported separately — the outer one carries them. */
export function newTablePositions(preDoc, doc) {
  const before = new Set();
  preDoc.descendants((n) => { if (n.type.name === "table") before.add(n); return true; });
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== "table") return true;
    if (!before.has(n)) out.push(pos);
    return false;
  });
  return out;
}

/** What a paste landed, from the documents either side of it.
 *  · `text`  — no table was involved                                          → K · M · T
 *  · `table` — one or more NEW tables                                         → the full table set
 *  · `cells` — a grid pasted INTO an existing table's cells, structure unchanged → K · M · V · E · R over the cells it wrote
 *  · `grown` — pasted into a table and the table gained rows/columns           → K · M
 *  `preTablePos` is the position of the table the caret was in before the paste (or -1). `sliceHadTable` is
 *  whether the pasted slice itself held a table — a text paste into a cell is `text`, not `cells`. */
export function analyzePaste({ preDoc, postDoc, preTablePos = -1, sliceHadTable = false }) {
  if (!sliceHadTable) return { kind: "text", tables: [], cells: [] };
  if (preTablePos >= 0) {
    const was = preDoc.nodeAt(preTablePos);
    const now = postDoc.nodeAt(preTablePos);
    if (was?.type.name === "table" && now?.type.name === "table") {
      const sameShape = was.childCount === now.childCount && (() => {
        for (let r = 0; r < was.childCount; r += 1) if (was.child(r).childCount !== now.child(r).childCount) return false;
        return true;
      })();
      if (!sameShape) return { kind: "grown", tables: [], cells: [] };
      const cells = [];
      let rowPos = preTablePos + 1;
      for (let r = 0; r < now.childCount; r += 1) {
        const row = now.child(r);
        let cellPos = rowPos + 1;
        for (let c = 0; c < row.childCount; c += 1) {
          const cell = row.child(c);
          if (cell !== was.child(r).child(c)) cells.push({ pos: cellPos, row: r, col: c });
          cellPos += cell.nodeSize;
        }
        rowPos += row.nodeSize;
      }
      if (cells.length) return { kind: "cells", tables: [], cells, tablePos: preTablePos, preTable: was };
      return { kind: "grown", tables: [], cells: [] };
    }
    return { kind: "grown", tables: [], cells: [] };
  }
  const tables = newTablePositions(preDoc, postDoc).map((pos) => ({ pos }));
  return tables.length ? { kind: "table", tables, cells: [] } : { kind: "text", tables: [], cells: [] };
}

/* ── putting the paste back to base ───────────────────────────────────────────────────────── */

/** Make `tr.doc` equal `base` with the smallest replace that does it (the changed middle only, so untouched
 *  boxes — and their node views — are not rebuilt). Returns true when it had to change anything. The result is
 *  verified; a replace the schema fitter bent falls back to swapping the whole content. */
export function revertToBase(tr, base) {
  const cur = tr.doc;
  if (cur.eq(base)) return false;
  let start = cur.content.findDiffStart(base.content);
  if (start == null) return false;
  let { a: endA, b: endB } = cur.content.findDiffEnd(base.content);
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) start -= overlap;
  try { tr.replace(start, endA, base.slice(start, endB)); } catch (_) { /* fall through to the whole-content swap */ }
  if (!tr.doc.eq(base)) tr.replaceWith(0, tr.doc.content.size, base.content);
  return true;
}

/* ── cell-level transforms ────────────────────────────────────────────────────────────────── */

/** A cell's content as plain paragraphs: one per textblock, nested lists/headings/quotes flattened, pictures and
 *  other atoms dropped (a VALUE has none). `keepMarks` keeps text styling (bold, colour, size…) but never a link. */
export function flattenCell(cell, schema, { keepMarks = false } = {}) {
  const paras = [];
  cell.descendants((n) => {
    if (!n.isTextblock) return true;
    const inline = [];
    n.forEach((ch) => {
      if (ch.isText && ch.text) inline.push(schema.text(ch.text, keepMarks ? ch.marks.filter((m) => m.type.name !== "link") : []));
      else if (ch.type.name === "hardBreak") inline.push(ch);
    });
    paras.push(schema.nodes.paragraph.create(null, inline));
    return false;
  });
  return Fragment.fromArray(paras.length ? paras : [schema.nodes.paragraph.create()]);
}

/** Rebuild a table with `fn(cell, rowIndex, cellIndex)` deciding each cell's replacement (undefined = keep). */
export function mapTableCells(table, fn) {
  const rows = [];
  table.forEach((row, _o, ri) => {
    const cells = [];
    row.forEach((cell, _o2, ci) => { const next = fn(cell, ri, ci); cells.push(next === undefined ? cell : next); });
    rows.push(row.type.create(row.attrs, cells, row.marks));
  });
  return table.type.create(table.attrs, rows, table.marks);
}

/** The source fill for a table cell by position, or null. `fills` is `string|null` per cell per row, in document
 *  order — used only when the row counts line up, so a source that lost a hidden row never shifts every colour. */
export function fillAt(fills, rowCount, ri, ci) {
  if (!Array.isArray(fills) || fills.length !== rowCount) return null;
  return normalizeFill(fills[ri]?.[ci]) || null;
}

/** VALUES (Excel's "Values"): the text of every cell and nothing else — no marks, no links, no fill, no nested
 *  blocks. The grid, spans, header cells and column widths are kept. */
export function valuesTable(table, schema) {
  return mapTableCells(table, (cell) => cell.type.create({ ...cell.attrs, background: null }, flattenCell(cell, schema)));
}

/** VALUES AND SOURCE FORMATTING (Excel's "Values & Source Formatting"): the values plus the look — text styling
 *  (bold, italic, colour, size, highlight) and the source's cell fill — but no links and no nested blocks. */
export function valuesFormatTable(table, schema, fills) {
  return mapTableCells(table, (cell, ri, ci) => cell.type.create(
    { ...cell.attrs, background: fillAt(fills, table.childCount, ri, ci) ?? cell.attrs.background ?? null },
    flattenCell(cell, schema, { keepMarks: true }),
  ));
}

/** The table as the source SHOWED it: its own cells with the source's shading laid on (nothing else changes). What the
 *  Picture option draws — a picture of a spreadsheet range has its header shading, though the table pasted as a table does not. */
export function withSourceFills(table, fills) {
  return mapTableCells(table, (cell, ri, ci) => {
    const fill = fillAt(fills, table.childCount, ri, ci);
    return fill ? cell.type.create({ ...cell.attrs, background: fill }, cell.content, cell.marks) : undefined;
  });
}

/** FORMATTING ONLY on a NEW table (nothing underneath to keep the text of): the grid and its look with the text
 *  emptied — header cells, spans and the source's fills, as Excel's Paste Formatting leaves empty cells. */
export function formattingOnlyTable(table, schema, fills) {
  return mapTableCells(table, (cell, ri, ci) => cell.type.create(
    { ...cell.attrs, background: fillAt(fills, table.childCount, ri, ci) },
    Fragment.from(schema.nodes.paragraph.create()),
  ));
}

/** KEEP SOURCE COLUMN WIDTHS: stamp the source's column widths (px, one per column) onto the cells, raised to the
 *  table floor so a narrow spreadsheet column still shows a word. A column the source gave no width keeps none. */
export function applyColumnWidths(table, widths) {
  const map = TableMap.get(table);
  const seen = new Set();
  const byOffset = new Map();
  for (let i = 0; i < map.map.length; i += 1) {
    const off = map.map[i];
    if (seen.has(off)) continue;
    seen.add(off);
    byOffset.set(off, map.findCell(off));
  }
  const want = (col) => { const w = Number(widths?.[col]); return w > 0 ? Math.max(TABLE_COL_MIN_WIDTH, Math.round(w)) : null; };
  const rows = [];
  table.forEach((row, rowOff) => {
    const cells = [];
    row.forEach((cell, cellOff) => {
      const rect = byOffset.get(rowOff + 1 + cellOff);
      let colwidth = null;
      if (rect) {
        const cw = [];
        for (let c = rect.left; c < rect.right; c += 1) cw.push(want(c));
        colwidth = cw.every((w) => w != null) ? cw : null;
      }
      cells.push(cell.type.create({ ...cell.attrs, colwidth }, cell.content, cell.marks));
    });
    rows.push(row.type.create(row.attrs, cells, row.marks));
  });
  return table.type.create(table.attrs, rows, table.marks);
}

/** TRANSPOSE: rows become columns. Every cell keeps its content and its type (a header row becomes a header
 *  column); a merged cell swaps its row- and column-span; stored column widths are dropped, because a width
 *  belonged to a column that is now a row. */
export function transposeTable(table) {
  const schema = table.type.schema;
  const map = TableMap.get(table);
  const seen = new Set();
  const placed = [];
  for (let i = 0; i < map.map.length; i += 1) {
    const off = map.map[i];
    if (seen.has(off)) continue;
    seen.add(off);
    const rect = map.findCell(off);
    const cell = table.nodeAt(off);
    if (!isCell(cell)) continue;
    placed.push({
      row: rect.left, col: rect.top,
      node: cell.type.create({ ...cell.attrs, colspan: rect.bottom - rect.top, rowspan: rect.right - rect.left, colwidth: null }, cell.content, cell.marks),
    });
  }
  const rows = [];
  for (let r = 0; r < map.width; r += 1) {
    const cells = placed.filter((p) => p.row === r).sort((a, b) => a.col - b.col).map((p) => p.node);
    rows.push(schema.nodes.tableRow.create(null, cells));
  }
  return table.type.create(table.attrs, rows, table.marks);
}

/* ── applying a mode to a transaction ─────────────────────────────────────────────────────── */

/**
 * Put the paste back to base, then apply `mode` to it. `offer` carries the base document and what the paste landed
 * (`kind`, `tables`, `cells`) and the range (`from`, `to`, in BASE positions). Returns `{ ok, end }` — `end` is where
 * the transformed paste now ends, so the tab can follow it — or `{ ok: false, reason }`. The text mode and the
 * picture mode are not done here (one needs the editor's own insert, the other an async render).
 */
export function applyPasteModeToTr(tr, mode, offer) {
  if (!PASTE_MODE_META[mode] || mode === "text" || mode === "picture") return { ok: false, reason: `not a transaction mode: ${mode}` };
  revertToBase(tr, offer.baseDoc);
  const mark = tr.steps.length;
  const schema = tr.doc.type.schema;
  const tablesDesc = [...(offer.tables || [])].sort((a, b) => b.pos - a.pos);
  const cellsDesc = [...(offer.cells || [])].sort((a, b) => b.pos - a.pos);
  const tableMeta = (i) => offer.meta?.tables?.[i] || null;
  const ordinal = (pos) => (offer.tables || []).findIndex((t) => t.pos === pos);
  const replaceAt = (pos, make) => {
    const node = tr.doc.nodeAt(pos);
    if (!node) return;
    const next = make(node);
    if (next && next !== node) tr.replaceWith(pos, pos + node.nodeSize, next);
  };

  if (mode === "merge") {
    let lo = offer.from; let hi = offer.to;
    for (const t of offer.tables || []) { const n = tr.doc.nodeAt(t.pos); if (n) { lo = Math.min(lo, t.pos); hi = Math.max(hi, t.pos + n.nodeSize); } }
    for (const c of offer.cells || []) { const n = tr.doc.nodeAt(c.pos); if (n) { lo = Math.min(lo, c.pos); hi = Math.max(hi, c.pos + n.nodeSize); } }
    mergeFormattingInRange(tr, Math.max(0, lo), Math.min(tr.doc.content.size, hi));
  } else if (offer.kind === "table") {
    for (const t of tablesDesc) {
      const meta = tableMeta(ordinal(t.pos));
      if (mode === "widths") replaceAt(t.pos, (n) => applyColumnWidths(n, meta?.widths));
      else if (mode === "transpose") replaceAt(t.pos, (n) => transposeTable(n));
      else if (mode === "values") replaceAt(t.pos, (n) => valuesTable(n, schema));
      else if (mode === "valuesFormat") replaceAt(t.pos, (n) => valuesFormatTable(n, schema, meta?.fills));
      else if (mode === "formatting") replaceAt(t.pos, (n) => formattingOnlyTable(n, schema, meta?.fills));
    }
  } else if (offer.kind === "cells") {
    const fills = offer.meta?.tables?.[0]?.fills;
    const top = Math.min(...(offer.cells || []).map((c) => c.row));
    const left = Math.min(...(offer.cells || []).map((c) => c.col));
    const pre = offer.preTable;
    for (const c of cellsDesc) {
      const srcFill = Array.isArray(fills) ? normalizeFill(fills[c.row - top]?.[c.col - left]) || null : null;
      replaceAt(c.pos, (cell) => {
        if (mode === "values") return cell.type.create({ ...cell.attrs, background: null }, flattenCell(cell, schema));
        if (mode === "valuesFormat") return cell.type.create({ ...cell.attrs, background: srcFill ?? cell.attrs.background ?? null }, flattenCell(cell, schema, { keepMarks: true }));
        if (mode === "formatting") {
          // keep what was in the cell BEFORE the paste; take only the look
          const was = pre?.child(c.row)?.child(c.col);
          return was ? was.type.create({ ...was.attrs, background: srcFill }, was.content, was.marks) : cell;
        }
        return cell;
      });
    }
  }

  const end = Math.min(tr.doc.content.size, tr.mapping.slice(mark).map(Math.min(offer.to, offer.baseDoc.content.size), 1));
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1)); } catch (_) { /* a selection is a nicety */ }
  return { ok: true, end };
}
