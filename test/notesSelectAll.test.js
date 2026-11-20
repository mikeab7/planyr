/* notesSelectAll — NEW-1 (2026-11-15): Ctrl+A belongs to the thing you are in (PowerPoint). Pure decisions; the browser half is ui-audit/verify-notes-select-all.mjs. */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { selectAllScope, selectAllTarget } from "../src/workspaces/notes/lib/notesSelectAll.js";

describe("selectAllScope — who owns the key", () => {
  it("a caret in an entered box is the text's, whatever else is selected", () => {
    expect(selectAllScope({ editing: true, boxSelected: true, hasBoxes: true })).toBe("text");
    expect(selectAllScope({ editing: true, hasBoxes: true })).toBe("text");
  });
  it("a box selected by its outline selects every box as boxes", () => {
    expect(selectAllScope({ boxSelected: true, hasBoxes: true })).toBe("boxes");
    expect(selectAllScope({ boxSelected: true, caretInBox: true, hasBoxes: true })).toBe("boxes");   // a stale caret behind a selected box does not win
  });
  it("blank paper selects every box; a live caret in a box is the text's", () => {
    expect(selectAllScope({ hasBoxes: true })).toBe("boxes");
    expect(selectAllScope({ caretInBox: true, hasBoxes: true })).toBe("text");
  });
  it("no boxes on the page: nothing for us to do (the browser's own Ctrl+A stands)", () => {
    expect(selectAllScope({})).toBe("none");
    expect(selectAllScope({ boxSelected: true })).toBe("none");
  });
});

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    noteAnchor: { group: "block", content: "block+", attrs: { aid: { default: null } }, toDOM: () => ["div", 0] },
    /* The app's table nodes (Tiptap's names: table / tableRow / tableCell / tableHeader), with the structure prosemirror-tables needs. */
    table: { group: "block", content: "tableRow+", tableRole: "table", isolating: true, toDOM: () => ["table", ["tbody", 0]] },
    tableRow: { content: "(tableCell | tableHeader)*", tableRole: "row", toDOM: () => ["tr", 0] },
    tableCell: { content: "block+", attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }, tableRole: "cell", isolating: true, toDOM: () => ["td", 0] },
    tableHeader: { content: "block+", attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } }, tableRole: "header_cell", isolating: true, toDOM: () => ["th", 0] },
    text: { group: "inline" },
  },
});
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
const cell = (t) => schema.nodes.tableCell.create(null, p(t));
const table = (...rows) => schema.nodes.table.create(null, rows.map((r) => schema.nodes.tableRow.create(null, r.map(cell))));
const box = (aid, ...kids) => schema.nodes.noteAnchor.create({ aid }, kids);
const at = (doc, needle, off = 0) => { let pos = -1; doc.descendants((n, ps) => { if (pos < 0 && n.isText && n.text.includes(needle)) pos = ps + n.text.indexOf(needle) + off; }); return pos; };
const stateAt = (doc, pos) => EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
const textOf = (state, sel) => state.doc.textBetween(sel.from, sel.to, "|");

describe("selectAllTarget — the box's own text, never the page's", () => {
  const doc = schema.nodes.doc.create(null, [box("a", p("Alpha one"), p("Alpha two")), box("b", p("Bravo")), p("")]);
  it("a caret in box A selects exactly A's two lines", () => {
    const st = stateAt(doc, at(doc, "Alpha one", 3));
    const t = selectAllTarget(st);
    expect(textOf(st, t)).toBe("Alpha one|Alpha two");
  });
  it("…and the same in box B is B's alone", () => {
    const st = stateAt(doc, at(doc, "Bravo", 2));
    expect(textOf(st, selectAllTarget(st))).toBe("Bravo");
  });
  it("a caret outside every box is not ours (null)", () => {
    expect(selectAllTarget(stateAt(doc, doc.content.size - 1))).toBeNull();
  });
  it("already selecting the whole box: the same range comes back (the key is still consumed)", () => {
    const st = stateAt(doc, at(doc, "Alpha one", 3));
    const first = selectAllTarget(st);
    const st2 = EditorState.create({ doc, selection: first });
    const again = selectAllTarget(st2);
    expect([again.from, again.to]).toEqual([first.from, first.to]);
  });
});

describe("selectAllTarget — a table cell steps outward and stays in the box", () => {
  const doc = schema.nodes.doc.create(null, [
    box("a", p("Alpha")),
    box("c", p("Intro"), table(["c11", "c12"], ["c21", "c22"])),
    p(""),
  ]);
  it("cell text → whole table → the box's text → the same", () => {
    let st = stateAt(doc, at(doc, "c11", 1));
    const s1 = selectAllTarget(st);
    expect(textOf(st, s1)).toBe("c11");
    st = EditorState.create({ doc, selection: s1 });
    const s2 = selectAllTarget(st);
    expect(s2).toBeInstanceOf(CellSelection);
    expect(s2.ranges.length).toBe(4);
    st = EditorState.create({ doc, selection: s2 });
    const s3 = selectAllTarget(st);
    const txt = textOf(st, s3);
    expect(txt).toContain("Intro"); expect(txt).toContain("c22"); expect(txt).not.toContain("Alpha");
    st = EditorState.create({ doc, selection: s3 });
    const s4 = selectAllTarget(st);
    expect(s4 && !(s4 instanceof CellSelection)).toBeTruthy();
    expect(textOf(st, s4)).not.toContain("Alpha");
  });
});
