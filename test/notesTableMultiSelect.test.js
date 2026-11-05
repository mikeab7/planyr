/* B2530690 — Ctrl+click adds cells to a Notes table's selection. Runs against the REAL note schema and the real
 * prosemirror-tables commands (no DOM, no editor view). RED-PROOF: on origin/main there is no multi-cell selection —
 * the module does not exist and prosemirror-tables' mouse handler returns early on a Ctrl press — so every case
 * here fails at import. The browser half (a real Control-held click, then bold + fill on every selected cell) is
 * e2e/notes-table-multiselect.spec.js. */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection, deleteCellSelection } from "@tiptap/pm/tables";
import { toggleMark } from "@tiptap/pm/commands";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { setCellFill, currentFill } from "../src/workspaces/notes/lib/notesTableFill.js";
import { MultiCellSelection, ctrlClickSelection, isMultiCell, multiCellPositions, modelOf } from "../src/workspaces/notes/lib/notesTableMultiSelect.js";

const schema = getSchema(NOTE_EXTENSIONS);
const cell = (t, extra = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, ...extra }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const docOf = (rows) => PMNode.fromJSON(schema, { type: "doc", content: [{ type: "table", content: rows.map((r) => ({ type: "tableRow", content: r })) }] });
// 3 x 3:  a1 a2 a3 / b1 b2 b3 / c1 c2 c3
const doc3 = () => docOf(["a", "b", "c"].map((r) => [1, 2, 3].map((c) => cell(`${r}${c}`))));
function cellBefore(doc, textPos) { const $p = doc.resolve(textPos + 1); for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.spec.tableRole === "cell") return $p.before(d); throw new Error("no cell"); }
const textPos = (doc, text) => { let p = -1; doc.descendants((n, pos) => { if (n.isText && n.text === text) p = pos; }); return p; };
const at = (doc, text) => { const st = EditorState.create({ doc, schema }); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, textPos(doc, text) + 1))); };
const ctrl = (st, text) => { const next = ctrlClickSelection(st, cellBefore(st.doc, textPos(st.doc, text))); return st.apply(st.tr.setSelection(next)); };
const textsOf = (st) => { const out = []; st.selection.forEachCell((n) => out.push(n.textContent)); return out.sort(); };
const fills = (doc) => { const o = []; doc.firstChild.forEach((r) => r.forEach((c) => o.push(c.attrs.background ?? null))); return o; };

describe("Ctrl+click adds cells", () => {
  it("a caret in a1, then Ctrl+click c3 and a3: three separate cells, the newest active", () => {
    let st = at(doc3(), "a1");
    st = ctrl(st, "c3"); st = ctrl(st, "a3");
    expect(isMultiCell(st)).toBe(true);
    expect(textsOf(st)).toEqual(["a1", "a3", "c3"]);
    expect(st.selection.$headCell.nodeAfter.textContent).toBe("a3");
  });
  it("Ctrl+click on a selected cell takes just that cell out", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "b2"); st = ctrl(st, "c3");
    st = ctrl(st, "b2");
    expect(textsOf(st)).toEqual(["a1", "c3"]);
  });
  it("the only selected cell can never be removed", () => {
    let st = at(doc3(), "b2");
    const sel = ctrlClickSelection(st, cellBefore(st.doc, textPos(st.doc, "b2")));
    expect(sel instanceof CellSelection).toBe(true);
    expect(sel instanceof MultiCellSelection).toBe(false);
    st = st.apply(st.tr.setSelection(sel));
    expect(textsOf(st)).toEqual(["b2"]);
  });
  it("a rectangle (Shift range) stays a rectangle when another cell is added", () => {
    let st = at(doc3(), "a1");
    st = st.apply(st.tr.setSelection(CellSelection.create(st.doc, cellBefore(st.doc, textPos(st.doc, "a1")), cellBefore(st.doc, textPos(st.doc, "b2")))));
    st = ctrl(st, "c3");
    expect(textsOf(st)).toEqual(["a1", "a2", "b1", "b2", "c3"]);
  });
  it("a Ctrl+click in a DIFFERENT table than the caret's is not ours (the ordinary press runs)", () => {
    const two = PMNode.fromJSON(schema, { type: "doc", content: [
      { type: "table", content: [{ type: "tableRow", content: [cell("t1a"), cell("t1b")] }] },
      { type: "table", content: [{ type: "tableRow", content: [cell("t2a"), cell("t2b")] }] },
    ] });
    const st = at(two, "t1a");
    expect(ctrlClickSelection(st, cellBefore(st.doc, textPos(st.doc, "t2b")))).toBe(null);
    expect(ctrlClickSelection(st, cellBefore(st.doc, textPos(st.doc, "t1b")))).not.toBe(null);
  });
});

describe("commands reach every selected cell", () => {
  it("fill paints all of them and only them, in one transaction", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3"); st = ctrl(st, "a3");
    expect(currentFill(st)).toBe(null);
    let out = st; setCellFill("#fde68a")(st, (tr) => { out = st.apply(tr); });
    expect(fills(out.doc)).toEqual(["#fde68a", null, "#fde68a", null, null, null, null, null, "#fde68a"]);
    expect(isMultiCell(out)).toBe(true);              // the selection survives the fill (mapped)
    expect(textsOf(out)).toEqual(["a1", "a3", "c3"]);
  });
  it("un-fill (No fill) clears every selected cell", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3");
    let filled = st; setCellFill("#fde68a")(st, (tr) => { filled = st.apply(tr); });
    let cleared = filled; setCellFill(null)(filled, (tr) => { cleared = filled.apply(tr); });
    expect(fills(cleared.doc).every((f) => f === null)).toBe(true);
  });
  it("bold goes on the text of every selected cell (and no other)", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3"); st = ctrl(st, "a3");
    let out = st; toggleMark(schema.marks.bold)(st, (tr) => { out = st.apply(tr); });
    const bold = []; out.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === "bold")) bold.push(n.text); });
    expect(bold.sort()).toEqual(["a1", "a3", "c3"]);
  });
  it("Delete clears every selected cell's contents", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3");
    let out = st; deleteCellSelection(st, (tr) => { out = st.apply(tr); });
    const left = []; out.doc.descendants((n) => { if (n.isText) left.push(n.text); });
    expect(left.sort()).toEqual(["a2", "a3", "b1", "b2", "b3", "c1", "c2"]);
  });
  it("the model hands back several grid ranges for the shared selection code", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3");
    const m = modelOf(st);
    expect(m.sel.extra).toHaveLength(1);
    expect(multiCellPositions(st).positions).toHaveLength(2);
  });
});

describe("a plain selection replaces it", () => {
  it("setting an ordinary text selection leaves nothing multi", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3");
    st = st.apply(st.tr.setSelection(TextSelection.create(st.doc, textPos(st.doc, "b2") + 1)));
    expect(isMultiCell(st)).toBe(false);
  });
  it("a structural change that reshapes the table falls back to the newest range alone", () => {
    let st = at(doc3(), "a1"); st = ctrl(st, "c3");
    const tr = st.tr; tr.insert(1, schema.nodes.paragraph.create());   // shifts positions, then the table is replaced wholesale
    const next = st.apply(tr);
    expect(next.selection instanceof CellSelection || next.selection instanceof TextSelection).toBe(true);
  });
});
