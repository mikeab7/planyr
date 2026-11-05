/* notesTableRowStyle — THE SIZE AN EMPTY CELL IS GIVEN, AND A NEW ROW / COLUMN TAKING ITS NEIGHBOUR'S
 * (NEW-1 / NEW-2, owner report 2026-11-05, Grand Port permits table). Runs against the real note schema; no DOM.
 *
 * ⛔ THE DEFECT (measured, ui-audit/verify-notes-table-size.mjs): a text size lives on RUNS OF TEXT
 * (`textStyle.fontSize`). An EMPTY cell has no run, so highlighting a row and picking 9 sized the filled cells
 * and left every empty one exactly as it was — and a row made entirely of empty cells (the one you just
 * added) took nothing at all: "nothing happens". `sizeEmptyBlocks` gives an empty paragraph the size on the
 * BLOCK (`paragraph.attrs.fontSize`, the same attribute `deriveBlockSizes` already writes for sized text), which
 * is also what gives its caret the right height.
 *
 * ⛔ A BLOCK SIZE ALONE IS NOT ENOUGH — "this must hold for typing into a cell that starts empty, not just for
 * how the empty cell is drawn". The block size is DERIVED from the runs (`deriveBlockSizes`), so the first
 * character typed into a sized empty cell (no mark on it) would have reset the block to the default one
 * transaction later: the cell LOOKED 9 and the word typed into it came out 11. `adoptEmptyBlockSize` closes
 * that: a block that was EMPTY before the transaction, carries a size, and now holds unsized text gets the
 * size written onto that text as a mark. It is keyed on "was empty before" (via the transaction mapping), NOT
 * on "size set and text unsized", because the latter also describes a block whose size was just CLEARED on
 * purpose and would resurrect it.
 *
 * ⛔ A NEW ROW / COLUMN INHERITS FORMATTING, NEVER TEXT. prosemirror-tables' addRow/addColumn insert
 * brand-new empty cells with default attributes. `rowCarryPlugin` finds the inserted rows/cells from the
 * transaction's own step maps (so it covers every route: Row ↑ / Row ↓ / Col ← / Col →, Tab out of the last
 * cell, and any later "add row" control — they all end in the same ReplaceStep), and copies, cell by cell, the
 * SIZE (and, for a row, the HEIGHT) of the row/column it was added from. Undo/redo and paste are left alone
 * (an undo already restores exactly what was recorded; a paste brings its own formatting).
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TableMap, isInTable, selectedRect } from "@tiptap/pm/tables";
import { fontSizePx } from "./notesSpacing.js";

const isBlock = (n) => n.type.name === "paragraph" || n.type.name === "heading";
const isCell = (n) => n.type.name === "tableCell" || n.type.name === "tableHeader";

/** The size (px, a number) a cell's text carries: its first run's size, else its first block's own size. */
export function cellSizePx(cell) {
  let found = null;
  cell.descendants((node) => {
    if (found != null) return false;
    if (node.isText) {
      const m = node.marks.find((x) => x.type.name === "textStyle");
      const px = fontSizePx(m?.attrs?.fontSize);
      if (px) found = px;
    }
    return true;
  });
  if (found != null) return found;
  let block = null;
  cell.descendants((node) => { if (block == null && isBlock(node) && node.attrs.fontSize) block = fontSizePx(node.attrs.fontSize); return block == null; });
  return block;
}

/** A cell with no words and no size of its own — the only kind of cell a row/column insert may colour. */
const isPlainEmptyCell = (cell) => cell.textContent === "" && cellSizePx(cell) == null;

/* ── the command: size the EMPTY blocks inside the selection ─────────────────────────────────── */
/** `px` a number, or `null` to clear. Walks every selection RANGE, so a CellSelection (one range per cell),
 *  Ctrl+click multi-selection and a plain caret in an empty paragraph are all handled by the one rule. */
export const sizeEmptyBlocks = (px) => ({ state, tr, dispatch }) => {
  const next = px == null ? null : Math.round(Number(px));
  let touched = false;
  const seen = new Set();
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!isBlock(node) || node.content.size !== 0 || seen.has(pos)) return true;
      seen.add(pos);
      if ((node.attrs.fontSize ?? null) === next) return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: next });
      touched = true;
      return true;
    });
  }
  if (touched && dispatch) dispatch(tr);
  return touched;
};

/* ── formatting an EMPTY block remembers (NEW-1, the same class as size) ─────────────────────── */
/* A bold / italic / underline / strike / colour / highlight / font applied to a selection reaches every cell
 * that has TEXT; an empty cell has nothing to mark, so what is typed there afterwards came out plain. The
 * block carries `seed` — a short list of `{type, attrs}` marks (textStyle's attrs merged: colour, font) — and
 * the first text typed into the block takes them (`adoptEmptyBlockSize`, below). A caret (empty selection) keeps
 * ProseMirror's ordinary stored marks: this is only for a RANGE (a row, column, cell range, a table). */
const seedList = (b) => (Array.isArray(b.attrs.seed) ? b.attrs.seed : []);
const sameSeed = (x, y) => JSON.stringify(x || null) === JSON.stringify(y || null);

/** PURE — the seed list after `name` is set / cleared. For textStyle `patch` is a PATCH (null clears a key). */
export function updateSeed(list, name, patch, on) {
  const out = (list || []).map((e) => ({ type: e.type, attrs: { ...(e.attrs || {}) } }));
  const at = out.findIndex((e) => e.type === name);
  if (name === "textStyle") {
    const attrs = at >= 0 ? out[at].attrs : {};
    for (const [k, v] of Object.entries(patch || {})) { if (v == null) delete attrs[k]; else attrs[k] = v; }
    if (at >= 0) out.splice(at, 1);
    if (Object.keys(attrs).length) out.push({ type: "textStyle", attrs });
  } else {
    if (at >= 0) out.splice(at, 1);
    if (on) out.push({ type: name, attrs: patch || {} });
  }
  return out.length ? out : null;
}

function emptyBlocksIn(state) {
  const out = []; const seen = new Set();
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (isBlock(node) && node.content.size === 0 && !seen.has(pos)) { seen.add(pos); out.push({ node, pos }); }
      return true;
    });
  }
  return out;
}

/** `mode`: "set" | "unset" | "toggle". Run AFTER the ordinary mark command in the same chain. */
export const seedMark = (name, patch, mode = "set") => ({ state, tr, dispatch }) => {
  if (state.selection.empty) return false;
  const blocks = emptyBlocksIn(state);
  if (!blocks.length) return false;
  let on = mode !== "unset";
  if (mode === "toggle") {
    // what the filled text in the selection reads NOW (the toggle has just run), else flip the first empty cell
    let seen = null;
    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => { if (seen == null && node.isText) seen = node.marks.some((m) => m.type.name === name); return seen == null; });
      if (seen != null) break;
    }
    on = seen != null ? seen : !seedList(blocks[0].node).some((e) => e.type === name);
  }
  let touched = false;
  for (const { node, pos } of blocks) {
    const next = updateSeed(seedList(node), name, patch, on);
    if (sameSeed(next, node.attrs.seed)) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, seed: next });
    touched = true;
  }
  if (touched && dispatch) dispatch(tr);
  return touched;
};

/* ── typing into a sized / seeded empty block ────────────────────────────────────────────────── */
/** Mutates `tr` (marks + the seed attr — no positions move). Returns whether it wrote anything. */
export function adoptEmptyBlockSize(trs, oldState, newState, tr) {
  const { schema } = newState;
  const textStyle = schema.marks.textStyle;
  if (!textStyle) return false;
  const maps = [];
  for (const t of trs) for (const m of t.mapping.maps) maps.push(m);
  let touched = false;
  newState.doc.descendants((node, pos) => {
    if (!isBlock(node)) return true;
    const seeds = seedList(node);
    if (!node.content.size || (!node.attrs.fontSize && !seeds.length)) return false;
    let hasText = false;
    node.forEach((c) => { if (c.isText) hasText = true; });
    if (!hasText) return false;
    // …and the SAME block was empty, with the same size/seed, before this transaction
    let back = pos;
    for (let i = maps.length - 1; i >= 0; i -= 1) back = maps[i].invert().map(back, -1);
    const before = oldState.doc.nodeAt(back);
    if (!before || before.type !== node.type || before.content.size !== 0 || before.attrs.fontSize !== node.attrs.fontSize || !sameSeed(before.attrs.seed, node.attrs.seed)) return false;
    const sizePx = node.attrs.fontSize ? fontSizePx(node.attrs.fontSize) : null;
    let at = pos + 1;
    node.forEach((c) => {
      if (c.isText) {
        const have = c.marks.find((m) => m.type === textStyle);
        const merged = {};
        for (const e of seeds) {
          if (e.type === "textStyle") Object.assign(merged, e.attrs || {});
          else if (schema.marks[e.type] && !c.marks.some((m) => m.type.name === e.type)) tr.addMark(at, at + c.nodeSize, schema.marks[e.type].create(e.attrs || {}));
        }
        if (sizePx) merged.fontSize = `${sizePx}px`;
        for (const [k, v] of Object.entries(have?.attrs || {})) if (v != null) merged[k] = v;       // what the run already says wins
        if (Object.keys(merged).length) { tr.addMark(at, at + c.nodeSize, textStyle.create(merged)); touched = true; }
        else if (seeds.length) touched = true;
      }
      at += c.nodeSize;
    });
    if (seeds.length) tr.setNodeMarkup(pos, undefined, { ...node.attrs, seed: null });             // the words carry it now
    return false;
  });
  return touched;
}

/* ── a new row / column takes its neighbour's size (and a row its height) ────────────────────── */
/** Ranges of the FINAL doc that the transactions inserted (an insertion = an empty old range). */
export function insertedRanges(trs) {
  let ins = [];
  for (const t of trs) {
    for (const map of t.mapping.maps) {
      ins = ins.map((r) => ({ from: map.map(r.from, 1), to: map.map(r.to, -1) }));
      map.forEach((os, oe, ns, ne) => { if (oe === os && ne > ns) ins.push({ from: ns, to: ne }); });
    }
  }
  return ins.filter((r) => r.to > r.from);
}

const skipsCarry = (trs) => trs.some((t) => t.getMeta("history$") || t.getMeta("paste") || t.getMeta("uiEvent") === "paste" || t.getMeta("uiEvent") === "drop" || t.getMeta("addToHistory") === false);

function mapForward(trs, pos) { let p = pos; for (const t of trs) p = t.mapping.map(p, -1); return p; }

/** Where did the row/column come FROM? The old selection says which edge the command was run on. */
function sourceIndex(inserted, count, edge, hint, axis) {
  // `inserted` = first new index, `count` = how many, `edge` = {lo, hi} of the selection on that axis (old table)
  if (hint) {
    if (inserted === hint[axis].lo) return inserted + count;       // added BEFORE the selection → the one it was added from is now after
    if (inserted === hint[axis].hi) return inserted - 1;           // added AFTER → the one before it
  }
  return inserted > 0 ? inserted - 1 : inserted + count;
}

export function applyCarry(trs, oldState, newState, tr) {
  if (skipsCarry(trs)) return false;
  const ranges = insertedRanges(trs);
  if (!ranges.length) return false;
  const doc = newState.doc;
  let hint = null;
  if (isInTable(oldState)) {
    try {
      const r = selectedRect(oldState);
      hint = { tableStart: mapForward(trs, r.tableStart), row: { lo: r.top, hi: r.bottom }, col: { lo: r.left, hi: r.right } };
    } catch { hint = null; }
  }
  let touched = false;
  const setSize = (cellPos, px) => {
    const cell = doc.nodeAt(cellPos);
    if (!cell || !isCell(cell) || px == null) return;
    let at = cellPos + 1;
    cell.forEach((b) => {
      if (isBlock(b) && b.content.size === 0 && b.attrs.fontSize !== px) { tr.setNodeMarkup(at, undefined, { ...b.attrs, fontSize: px }); touched = true; }
      at += b.nodeSize;
    });
  };
  const doneCells = new Set();
  for (const range of ranges) {
    if (range.to > doc.content.size) continue;
    const $f = doc.resolve(range.from);
    const parent = $f.parent;
    const after = $f.nodeAfter;
    if (!after) continue;
    /* rows inserted into a table */
    if (parent.type.name === "table" && after.type.name === "tableRow") {
      const tableStart = $f.start();
      const map = TableMap.get(parent);
      const first = $f.index();
      let count = 0; let pos = range.from;
      while (pos < range.to) { const n = doc.nodeAt(pos); if (!n || n.type.name !== "tableRow") break; count += 1; pos += n.nodeSize; }
      if (!count || pos !== range.to) continue;
      const h = hint && hint.tableStart === tableStart ? hint : null;
      const srcRow = sourceIndex(first, count, null, h, "row");
      if (srcRow < 0 || srcRow >= parent.childCount || (srcRow >= first && srcRow < first + count)) continue;
      const srcNode = parent.child(srcRow);
      for (let i = 0; i < count; i += 1) {
        const rowIdx = first + i;
        const rowNode = parent.child(rowIdx);
        let rowPos = tableStart; for (let k = 0; k < rowIdx; k += 1) rowPos += parent.child(k).nodeSize;
        // only an all-plain row is ours to dress (a pasted row brings its own words and formatting)
        let plain = true; rowNode.forEach((c) => { if (!isPlainEmptyCell(c)) plain = false; });
        if (!plain) continue;
        if ((srcNode.attrs.rowHeight ?? null) !== (rowNode.attrs.rowHeight ?? null)) { tr.setNodeMarkup(rowPos, undefined, { ...rowNode.attrs, rowHeight: srcNode.attrs.rowHeight ?? null }); touched = true; }
        for (let c = 0; c < map.width; c += 1) {
          const rel = map.map[rowIdx * map.width + c];
          const cellPos = tableStart + rel;
          if (cellPos < rowPos || cellPos >= rowPos + rowNode.nodeSize) continue;       // a rowspan from above
          if (doneCells.has(cellPos)) continue; doneCells.add(cellPos);
          const src = doc.nodeAt(tableStart + map.map[srcRow * map.width + c]);
          if (src && isCell(src)) setSize(cellPos, cellSizePx(src));
        }
      }
      continue;
    }
    /* cells inserted into a row (a new column) */
    if (parent.type.name === "tableRow" && isCell(after)) {
      const rowStart = $f.start();
      const table = $f.node(-1);
      if (!table || table.type.name !== "table") continue;
      const tableStart = $f.start(-1);
      const map = TableMap.get(table);
      const rowIdx = $f.index(-1);
      let count = 0; let pos = range.from;
      while (pos < range.to) { const n = doc.nodeAt(pos); if (!n || !isCell(n)) break; count += 1; pos += n.nodeSize; }
      if (!count || pos !== range.to) continue;
      const firstCol = map.findCell(range.from - tableStart).left;
      const h = hint && hint.tableStart === tableStart ? hint : null;
      const srcCol = sourceIndex(firstCol, count, null, h, "col");
      if (srcCol < 0 || srcCol >= map.width || (srcCol >= firstCol && srcCol < firstCol + count)) continue;
      const src = doc.nodeAt(tableStart + map.map[rowIdx * map.width + srcCol]);
      if (!src || !isCell(src)) continue;
      const px = cellSizePx(src);
      let cp = range.from;
      for (let i = 0; i < count; i += 1) { const cell = doc.nodeAt(cp); if (cell && isPlainEmptyCell(cell)) setSize(cp, px); cp += cell.nodeSize; }
      void rowStart;
    }
  }
  return touched;
}

export function rowCarryPlugin() {
  return new Plugin({
    key: new PluginKey("noteTableRowCarry"),
    appendTransaction: (trs, oldState, newState) => {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = newState.tr;
      if (!applyCarry(trs, oldState, newState, tr)) return null;
      tr.setStoredMarks(newState.storedMarks);
      return tr;
    },
  });
}
