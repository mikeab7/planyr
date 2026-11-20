/* notesTableSize — NEW-1 / NEW-2 / NEW-3 (2026-11-05, Grand Port permits table). Runs the REAL note schema and the REAL
 * plugins (size/seed adoption, new-row carry) on a bare EditorState — no DOM, no editor view.
 *
 * RED-FIRST: on main, `sizeEmptyBlocks`, `rowCarryPlugin` and `rowHeightForDrag` do not exist, and the live arm
 * (ui-audit/verify-notes-table-size.mjs) recorded 55 failures against unmodified main, every one of them a
 * reported behaviour: empty cells not sized, text typed into them reset, a new row not inheriting, no row drag.
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { history, undo } from "@tiptap/pm/history";
import { CellSelection, addRowAfter, addRowBefore, addColumnAfter, addColumnBefore } from "@tiptap/pm/tables";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { adoptEmptyBlockSize, cellSizePx, rowCarryPlugin, seedMark, sizeEmptyBlocks, updateSeed } from "../src/workspaces/notes/lib/notesTableRowStyle.js";
import { ROW_HEIGHT_MAX, rowHeightForDrag, rowsForDrag } from "../src/workspaces/notes/lib/notesTableRowHeight.js";
import { blockFontSize } from "../src/workspaces/notes/lib/notesSpacing.js";

const schema = getSchema(NOTE_EXTENSIONS);
const run = (cmd, st) => { let out = st; cmd(st, (tr) => { out = st.apply(tr); }); return out; };
/** a Tiptap-style command ({ state, tr, dispatch }) run on a bare state */
const runT = (cmd, st) => { let out = st; cmd({ state: st, tr: st.tr, dispatch: (tr) => { out = st.apply(tr); } }); return out; };

/* the same appendTransaction the app registers in `noteSpacing` (adopt BEFORE derive), built from the real exports */
function deriveLike() {
  return new Plugin({
    key: new PluginKey("testDerive"),
    appendTransaction: (trs, old, ns) => {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = ns.tr;
      const adopted = adoptEmptyBlockSize(trs, old, ns, tr);
      // derive: a non-empty sized-or-not block takes the single size of its runs (the app's deriveBlockSizes, in miniature)
      let derived = false;
      tr.doc.descendants((n, pos) => {
        if (n.type.name !== "paragraph" || n.content.size === 0) return true;
        const runs = []; n.forEach((c) => { const m = c.marks.find((x) => x.type.name === "textStyle"); runs.push({ fontSize: m?.attrs?.fontSize || null }); });
        const next = blockFontSize(runs);
        if ((n.attrs.fontSize || null) !== next) { tr.setNodeMarkup(pos, undefined, { ...n.attrs, fontSize: next }); derived = true; }
        return true;
      });
      return adopted || derived ? tr : null;
    },
  });
}

const cell = (t, extra = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, ...extra }, content: [{ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] }] });
const rowOf = (...cells) => ({ type: "tableRow", content: cells });
const mk = (rows, plugins = [rowCarryPlugin(), deriveLike(), history()]) => {
  const doc = PMNode.fromJSON(schema, { type: "doc", content: [{ type: "table", content: rows }] });
  return EditorState.create({ doc, schema, plugins });
};
const posOfCell = (doc, r, c) => { let p = -1; doc.descendants((n, pos) => { if (n.type.name === "table") { let rp = pos + 1; for (let i = 0; i < r; i += 1) rp += n.child(i).nodeSize; let cp = rp + 1; for (let j = 0; j < c; j += 1) cp += n.child(r).child(j).nodeSize; p = cp; } return false; }); return p; };
const caretIn = (st, r, c) => st.apply(st.tr.setSelection(TextSelection.create(st.doc, posOfCell(st.doc, r, c) + 2)));
const selectCells = (st, a, b) => st.apply(st.tr.setSelection(new CellSelection(st.doc.resolve(posOfCell(st.doc, ...a)), st.doc.resolve(posOfCell(st.doc, ...b)))));
const sizes = (doc) => { const o = []; doc.firstChild.forEach((r) => { const row = []; r.forEach((c) => row.push(cellSizePx(c))); o.push(row); }); return o; };
const MIXED = () => [
  rowOf(cell("A"), cell("B"), cell("C")),
  rowOf(cell("D"), cell(""), cell("F")),
  rowOf(cell(""), cell(""), cell("")),
];
const chainSize = (st, px) => {
  // the toolbar's order: sizeEmptyBlocks first, then the mark (here applied by hand to the filled text), like `pickSize`
  let s = runT(sizeEmptyBlocks(px), st);
  const mark = schema.marks.textStyle.create({ fontSize: `${px}px` });
  const tr = s.tr;
  for (const range of s.selection.ranges) tr.addMark(range.$from.pos, range.$to.pos, mark);
  return tr.docChanged ? s.apply(tr) : s;
};

describe("NEW-1 — a size reaches EMPTY cells too", () => {
  it("a row selection: filled AND empty cells all take 9", () => {
    let st = selectCells(mk(MIXED()), [1, 0], [1, 2]);
    st = chainSize(st, 9);
    expect(sizes(st.doc)[1]).toEqual([9, 9, 9]);
    expect(sizes(st.doc)[0]).toEqual([null, null, null]);       // the neighbours are untouched
  });
  it("a WHOLE EMPTY row takes the size (it used to do nothing at all)", () => {
    const st = runT(sizeEmptyBlocks(9), selectCells(mk(MIXED()), [2, 0], [2, 2]));
    expect(sizes(st.doc)[2]).toEqual([9, 9, 9]);
  });
  it("several rows, a column and the whole table", () => {
    expect(sizes(chainSize(selectCells(mk(MIXED()), [0, 0], [2, 2]), 14).doc).flat()).toEqual(Array(9).fill(14));
    const col = sizes(chainSize(selectCells(mk(MIXED()), [0, 1], [2, 1]), 8).doc);
    expect(col.map((r) => r[1])).toEqual([8, 8, 8]);
    expect(col.map((r) => r[0])).toEqual([null, null, null]);
  });
  it("clearing (null) removes the block size from empty cells", () => {
    let st = runT(sizeEmptyBlocks(9), selectCells(mk(MIXED()), [2, 0], [2, 2]));
    st = runT(sizeEmptyBlocks(null), selectCells(st, [2, 0], [2, 2]));
    expect(sizes(st.doc)[2]).toEqual([null, null, null]);
  });
  it("a command that changes nothing reports false (no empty undo step)", () => {
    const st = selectCells(mk([rowOf(cell("A"), cell("B"))]), [0, 0], [0, 1]);
    expect(sizeEmptyBlocks(9)({ state: st, tr: st.tr, dispatch: () => {} })).toBe(false);
  });
});

describe("NEW-1 — typing into a cell that STARTS EMPTY keeps the size (and the formatting), not just how it is drawn", () => {
  it("text typed into a sized empty cell is marked 9 and the block keeps 9", () => {
    let st = runT(sizeEmptyBlocks(9), selectCells(mk(MIXED()), [1, 0], [1, 2]));
    st = caretIn(st, 1, 1);
    st = st.apply(st.tr.insertText("hi"));
    const c = st.doc.firstChild.child(1).child(1);
    expect(c.firstChild.firstChild.marks.find((m) => m.type.name === "textStyle")?.attrs.fontSize).toBe("9px");
    expect(c.firstChild.attrs.fontSize).toBe(9);
    expect(cellSizePx(c)).toBe(9);
  });
  it("RED-PROOF: without the adopt step the block size is reset to nothing on the first character", () => {
    let st = runT(sizeEmptyBlocks(9), selectCells(mk(MIXED(), [deriveLikeWithoutAdopt()]), [1, 0], [1, 2]));
    st = caretIn(st, 1, 1);
    st = st.apply(st.tr.insertText("hi"));
    expect(st.doc.firstChild.child(1).child(1).firstChild.attrs.fontSize ?? null).toBe(null);
  });
  it("a size that was CLEARED on purpose is not resurrected by a later edit", () => {
    let st = runT(sizeEmptyBlocks(9), selectCells(mk(MIXED()), [2, 0], [2, 2]));
    st = runT(sizeEmptyBlocks(null), selectCells(st, [2, 0], [2, 2]));
    st = caretIn(st, 2, 1); st = st.apply(st.tr.insertText("z"));
    expect(cellSizePx(st.doc.firstChild.child(2).child(1))).toBe(null);
  });
  it("bold / colour remembered on an empty cell reach what is typed there", () => {
    let st = selectCells(mk(MIXED()), [2, 0], [2, 2]);                 // the all-empty row: nothing filled to read the toggle from
    st = runT(seedMark("bold", {}, "toggle"), st);
    st = runT(seedMark("textStyle", { color: "#C0392B" }), st);
    expect(st.doc.firstChild.child(2).child(1).firstChild.attrs.seed).toEqual([{ type: "bold", attrs: {} }, { type: "textStyle", attrs: { color: "#C0392B" } }]);
    st = caretIn(st, 2, 1); st = st.apply(st.tr.insertText("x"));
    const run0 = st.doc.firstChild.child(2).child(1).firstChild.firstChild;
    expect(run0.marks.map((m) => m.type.name).sort()).toEqual(["bold", "textStyle"]);
    expect(run0.marks.find((m) => m.type.name === "textStyle").attrs.color).toBe("#C0392B");
    expect(st.doc.firstChild.child(2).child(1).firstChild.attrs.seed).toBe(null);          // the words carry it now
  });
  it("updateSeed: textStyle patches merge, null clears a key, a toggle off removes the entry", () => {
    let l = updateSeed(null, "textStyle", { color: "#111" }, true);
    l = updateSeed(l, "textStyle", { fontFamily: "Arial" }, true);
    expect(l).toEqual([{ type: "textStyle", attrs: { color: "#111", fontFamily: "Arial" } }]);
    l = updateSeed(l, "textStyle", { color: null, fontFamily: null }, true);
    expect(l).toBe(null);
    expect(updateSeed(updateSeed(null, "bold", {}, true), "bold", {}, false)).toBe(null);
  });
});
function deriveLikeWithoutAdopt() {
  return new Plugin({
    key: new PluginKey("noAdopt"),
    appendTransaction: (trs, old, ns) => {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = ns.tr; let d = false;
      tr.doc.descendants((n, pos) => {
        if (n.type.name !== "paragraph" || n.content.size === 0) return true;
        const runs = []; n.forEach((c) => { const m = c.marks.find((x) => x.type.name === "textStyle"); runs.push({ fontSize: m?.attrs?.fontSize || null }); });
        const next = blockFontSize(runs);
        if ((n.attrs.fontSize || null) !== next) { tr.setNodeMarkup(pos, undefined, { ...n.attrs, fontSize: next }); d = true; }
        return true;
      });
      return d ? tr : null;
    },
  });
}

describe("NEW-2 — a new row takes the size of the row it was added from (cell by cell, formatting only)", () => {
  const sized = (px = 9) => runT(sizeEmptyBlocks(px), selectCells(chainSize(selectCells(mk(MIXED()), [1, 0], [1, 2]), px), [1, 0], [1, 2]));
  it("add row BELOW: the new row (empty) takes the size of the row it came from", () => {
    let st = caretIn(sized(), 1, 1);
    st = run(addRowAfter, st);
    expect(st.doc.firstChild.childCount).toBe(4);
    expect(sizes(st.doc)[2]).toEqual([9, 9, 9]);
    expect(st.doc.firstChild.child(2).textContent).toBe("");                // no text carried over
  });
  it("add row ABOVE a sized row: the new row takes the size of the row it was added FROM (the one below it)", () => {
    let st = caretIn(sized(), 1, 1);
    st = run(addRowBefore, st);
    expect(sizes(st.doc)[1]).toEqual([9, 9, 9]);
    expect(sizes(st.doc)[2]).toEqual([9, 9, 9]);
    expect(sizes(st.doc)[0]).toEqual([null, null, null]);
  });
  it("a new TOP row uses the row below it", () => {
    let st = chainSize(selectCells(mk(MIXED()), [0, 0], [0, 2]), 14);
    st = caretIn(st, 0, 1);
    st = run(addRowBefore, st);
    expect(sizes(st.doc)[0]).toEqual([14, 14, 14]);
  });
  it("Tab out of the last cell (addRowAfter on the last row) follows the last row", () => {
    let st = chainSize(selectCells(mk(MIXED()), [2, 0], [2, 2]), 9);
    st = caretIn(st, 2, 2);
    st = run(addRowAfter, st);
    expect(st.doc.firstChild.childCount).toBe(4);
    expect(sizes(st.doc)[3]).toEqual([9, 9, 9]);
  });
  it("typing into the new row's cell keeps the size", () => {
    let st = run(addRowAfter, caretIn(sized(), 1, 1));
    st = caretIn(st, 2, 0); st = st.apply(st.tr.insertText("abc"));
    expect(cellSizePx(st.doc.firstChild.child(2).child(0))).toBe(9);
    expect(st.doc.firstChild.child(2).child(0).firstChild.firstChild.marks.find((m) => m.type.name === "textStyle").attrs.fontSize).toBe("9px");
  });
  it("one undo takes the added row AND its size away together", () => {
    const base = caretIn(sized(), 1, 1);
    let st = run(addRowAfter, base);
    st = run(undo, st);
    expect(st.doc.firstChild.childCount).toBe(3);
    expect(sizes(st.doc)).toEqual(sizes(base.doc));
  });
  it("a new row next to an UNSIZED row stays unsized (nothing is invented)", () => {
    const st = run(addRowAfter, caretIn(mk(MIXED()), 0, 0));
    expect(sizes(st.doc)[1]).toEqual([null, null, null]);
  });
  it("a new row takes the HEIGHT of its source row too (NEW-2 tie-in)", () => {
    const doc = PMNode.fromJSON(schema, { type: "doc", content: [{ type: "table", content: [{ ...rowOf(cell("A"), cell("B")), attrs: { rowHeight: 80 } }, rowOf(cell("C"), cell("D"))] }] });
    let st = EditorState.create({ doc, schema, plugins: [rowCarryPlugin(), history()] });
    st = caretIn(st, 0, 0);
    expect(run(addRowAfter, st).doc.firstChild.child(1).attrs.rowHeight).toBe(80);
    expect(run(addRowBefore, st).doc.firstChild.child(0).attrs.rowHeight).toBe(80);
  });
});

describe("NEW-2 — a new column follows the same rule, row by row", () => {
  it("Col → on a sized row: the new cell in THAT row is sized; other rows follow their own neighbour", () => {
    let st = chainSize(selectCells(mk(MIXED()), [1, 0], [1, 2]), 9);
    st = caretIn(st, 1, 1);
    st = run(addColumnAfter, st);
    const g = sizes(st.doc);
    expect(g[1]).toEqual([9, 9, 9, 9]);
    expect(g[0]).toEqual([null, null, null, null]);
  });
  it("Col ← on a sized row", () => {
    let st = chainSize(selectCells(mk(MIXED()), [1, 0], [1, 2]), 9);
    st = caretIn(st, 1, 0);
    st = run(addColumnBefore, st);
    expect(sizes(st.doc)[1]).toEqual([9, 9, 9, 9]);
  });
});

describe("NEW-3 — the row-height rules", () => {
  it("taller and shorter store the dragged height", () => {
    expect(rowHeightForDrag({ startH: 40, dy: 30, natural: 30 })).toEqual({ px: 70, stored: 70 });
    expect(rowHeightForDrag({ startH: 70, dy: -20, natural: 30 })).toEqual({ px: 50, stored: 50 });
  });
  it("a row never goes shorter than its text — dragging there stores NOTHING (auto)", () => {
    expect(rowHeightForDrag({ startH: 70, dy: -200, natural: 30.2 })).toEqual({ px: 31, stored: null });
    expect(rowHeightForDrag({ startH: 40, dy: -9, natural: 31 })).toEqual({ px: 31, stored: null });
  });
  it("is capped", () => {
    expect(rowHeightForDrag({ startH: 40, dy: 99999, natural: 30 }).stored).toBe(ROW_HEIGHT_MAX);
  });
  it("a garbage drag cannot store NaN", () => {
    expect(rowHeightForDrag({ startH: 40, dy: NaN, natural: 30 }).stored).toBe(null);
  });
  it("with whole rows selected a drag on one of them applies to all of them; otherwise to just that row", () => {
    expect(rowsForDrag({ idx: 1, selectedTop: 1, selectedBottom: 3, wholeRows: true })).toEqual([1, 2]);
    expect(rowsForDrag({ idx: 2, selectedTop: 1, selectedBottom: 3, wholeRows: true })).toEqual([1, 2]);
    expect(rowsForDrag({ idx: 0, selectedTop: 1, selectedBottom: 3, wholeRows: true })).toEqual([0]);
    expect(rowsForDrag({ idx: 1, selectedTop: 0, selectedBottom: 0, wholeRows: false })).toEqual([1]);
  });
  it("rowHeight round-trips through the schema's HTML (copy / paste / print)", () => {
    const type = schema.nodes.tableRow;
    expect(type.spec.attrs.rowHeight.default).toBe(null);
    const node = type.create({ rowHeight: 64 }, [schema.nodes.tableCell.create(null, schema.nodes.paragraph.create())]);
    const spec = schema.nodes.tableRow.spec.toDOM(node);
    expect(JSON.stringify(spec)).toMatch(/"data-row-height":"64"/);
    expect(JSON.stringify(spec)).toMatch(/height: 64px/);
    const plain = schema.nodes.tableRow.spec.toDOM(type.create(null, [schema.nodes.tableCell.create(null, schema.nodes.paragraph.create())]));
    expect(JSON.stringify(plain)).not.toMatch(/height/);
  });
});
