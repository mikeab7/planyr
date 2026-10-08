/* notesTableClipboard — the pure halves of copying a table that is already on a Notes page (NEW-1,
 * 2026-10-06). The browser half (real keys, real clipboard) is ui-audit/verify-notes-table-copy-paste.mjs. */
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { CellSelection, tableNodes } from "@tiptap/pm/tables";
import { cellToTsv, tableToTsv, clipboardTextForSlice, wholeTableSelection, contentOfBoxes } from "../src/workspaces/notes/lib/notesTableClipboard.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: { group: "inline" },
    noteAnchor: { group: "block", content: "block+", attrs: { aid: { default: null } }, toDOM: () => ["div", 0] },
    ...tableNodes({ tableGroup: "block", cellContent: "block+", cellAttributes: {} }),
  },
});
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
const cell = (t) => schema.nodes.table_cell.create(null, p(t));
const row = (...ts) => schema.nodes.table_row.create(null, ts.map(cell));
const table = (...rows) => schema.nodes.table.create(null, rows);

describe("tab-separated text for a table", () => {
  it("rows are lines, cells are tabs", () => {
    expect(tableToTsv(table(row("Item", "Qty"), row("Slab", "12")))).toBe("Item\tQty\nSlab\t12");
  });
  it("a cell holding a tab, newline or quote is quoted the way Excel writes it", () => {
    expect(cellToTsv(cell('say "hi"'))).toBe('"say ""hi"""');
    expect(cellToTsv(cell("a\tb"))).toBe('"a\tb"');
    expect(cellToTsv(schema.nodes.table_cell.create(null, [p("one"), p("two")]))).toBe('"one\ntwo"');
    expect(cellToTsv(cell("plain"))).toBe("plain");
  });
  it("a slice with no table keeps ProseMirror's own text exactly", () => {
    const frag = schema.nodes.doc.create(null, [p("alpha"), p("beta")]).content;
    expect(clipboardTextForSlice({ content: frag })).toBe("alpha\n\nbeta");
  });
  it("a table inside a box, beside a paragraph, is still a grid", () => {
    const frag = schema.nodes.doc.create(null, [p("before"), schema.nodes.noteAnchor.create({ aid: "a" }, [table(row("x", "y"))])]).content;
    expect(clipboardTextForSlice({ content: frag })).toBe("before\n\nx\ty");
  });
});

describe("whole-table selection", () => {
  const doc = schema.nodes.doc.create(null, [table(row("a", "b"), row("c", "d"))]);
  const state = EditorState.create({ doc });
  const cellPos = (i) => { const out = []; doc.firstChild.forEach((r, ro) => r.forEach((c, co) => out.push(1 + ro + 1 + co))); return out[i]; };
  it("every cell → whole table", () => {
    const sel = CellSelection.create(state.doc, cellPos(0), cellPos(3));
    expect(wholeTableSelection(sel)?.table.childCount).toBe(2);
  });
  it("a partial range is NOT the whole table (cut only clears those cells)", () => {
    expect(wholeTableSelection(CellSelection.create(state.doc, cellPos(0), cellPos(1)))).toBeNull();
    expect(wholeTableSelection(CellSelection.create(state.doc, cellPos(0), cellPos(2)))).toBeNull();
  });
  it("anything that is not a cell selection is ignored", () => {
    expect(wholeTableSelection(state.selection)).toBeNull();
  });
});

describe("contentOfBoxes — what Ctrl+C on a selected box copies", () => {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.noteAnchor.create({ aid: "a" }, [table(row("x"))]),
    schema.nodes.noteAnchor.create({ aid: "b" }, [p("keep out")]),
    p(""),
  ]);
  it("the contents of the selected box only, not the wrapper", () => {
    const s = contentOfBoxes(doc, new Set(["a"]));
    expect(s.content.childCount).toBe(1);
    expect(s.content.firstChild.type.name).toBe("table");
  });
  it("two boxes → both contents in order; none → null", () => {
    expect(contentOfBoxes(doc, ["a", "b"]).content.childCount).toBe(2);
    expect(contentOfBoxes(doc, ["zzz"])).toBeNull();
  });
});
