/* notesTablePaste — NEW-1 (owner report 2026-10-05: a table copied from OneNote "did not copy well
 * at all, or didn't copy at all"). The PURE halves of the fix, driven against the real Notes schema
 * with no DOM (this repo's unit runner is node-only). The browser half — the committed OneNote /
 * Word / Excel / Sheets / Outlook clipboards pasted into every landing spot — is
 * ui-audit/verify-notes-table-paste.mjs (266 checks; 111 red on main).
 *
 * Each describe names the cause it pins and fails on the code that shipped before this change. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import {
  parseTabular, rowsToTableHtml, tabularFromClipboard, tableRowsToText, htmlHasTable, clipboardHasTable,
  tableOwnsClipboard, tableBoxWidth, isBorderedTable, isSingleColumn, fillEmptyCells,
} from "../src/workspaces/notes/lib/notesTablePaste.js";
import { tidyPastedFragment, textOfNode, isLayoutTable, keepCaretInBox } from "../src/workspaces/notes/lib/notesPastePlain.js";

const schema = getSchema(NOTE_EXTENSIONS);
const FX = path.resolve(__dirname, "fixtures/clipboard-tables");
const manifest = JSON.parse(fs.readFileSync(path.join(FX, "manifest.json"), "utf8")).fixtures;
const dt = (map) => ({ getData: (k) => map[k] || "" });

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (...paras) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: paras.length ? paras : [p("")] });
const row = (...cells) => ({ type: "tableRow", content: cells });
const table = (rows, attrs = {}) => ({ type: "table", attrs, content: rows });
const node = (json) => PMNode.fromJSON(schema, json);

describe("cause 1 — a picture beside the table must not win", () => {
  it("a clipboard whose html carries a <table> owns the paste", () => {
    expect(tableOwnsClipboard(dt({ "text/html": "<html><body><table><tr><td>a</td></tr></table></body></html>" }))).toBe(true);
    expect(clipboardHasTable(dt({ "text/html": "<TABLE border=1>" }))).toBe(true);
  });
  it("a picture copied from a web page (html is just an <img>) is NOT a table", () => {
    expect(tableOwnsClipboard(dt({ "text/html": '<img src="x.png">' }))).toBe(false);
    expect(tableOwnsClipboard(dt({}))).toBe(false);
  });
  it("never throws on a hostile clipboard", () => {
    expect(clipboardHasTable({ getData() { throw new Error("denied"); } })).toBe(false);
    expect(clipboardHasTable(null)).toBe(false);
  });
  it("every committed fixture really is a table clipboard", () => {
    for (const name of Object.keys(manifest)) {
      expect(htmlHasTable(fs.readFileSync(path.join(FX, `${name}.html`), "utf8")), name).toBe(true);
    }
  });
});

describe("cause 2 — an empty cell must never reach the schema childless", () => {
  const withEmptyCell = [
    row(cell(p("Unit")), cell(p("Area"))),
    row(cell(p("A-100")), cell(p(""))),                    // Excel's <td></td> → one empty paragraph
  ];
  it("the old tidy trimmed the lone empty paragraph and left the cell with NO content", () => {
    const frag = node({ type: "doc", content: [table(withEmptyCell)] }).content;
    const out = tidyPastedFragment(frag, schema);
    let childless = 0;
    out.descendants((n) => { if (n.type.name === "tableCell" && n.childCount === 0) childless += 1; });
    expect(childless).toBe(0);
  });
  it("…and every cell of the result is schema-valid", () => {
    const frag = node({ type: "doc", content: [table(withEmptyCell)] }).content;
    const out = tidyPastedFragment(frag, schema);
    out.descendants((n) => { if (n.type.name === "tableCell") expect(n.type.validContent(n.content)).toBe(true); });
  });
  it("fillEmptyCells repairs a genuinely childless cell, recursing through rows", () => {
    const bad = schema.nodes.table.create(null, [schema.nodes.tableRow.create(null, [schema.nodes.tableCell.create(null, null)])]);
    const fixed = fillEmptyCells(bad.type.schema.nodes.doc.create(null, [bad]).content, schema);
    let n = 0; fixed.descendants((x) => { if (x.type.name === "tableCell") { n += 1; expect(x.childCount).toBe(1); } });
    expect(n).toBe(1);
  });
});

describe("cause 4 — a bordered one-column table is data, an Outlook layout table is not", () => {
  const oneCol = (attrs) => node(table([row(cell(p("a"))), row(cell(p("b")))], attrs));
  it("an unmarked single-column table is still unwrapped (the Outlook signature rule is unchanged)", () => {
    expect(isLayoutTable(oneCol({}))).toBe(true);
  });
  it("a `keep` table is never treated as layout scaffolding", () => {
    expect(isLayoutTable(oneCol({ keep: true }))).toBe(false);
  });
  it("tidy leaves a keep table alone and flattens the unmarked one", () => {
    const keep = tidyPastedFragment(node({ type: "doc", content: [table([row(cell(p("a"))), row(cell(p("b")))], { keep: true })] }).content, schema);
    const flat = tidyPastedFragment(node({ type: "doc", content: [table([row(cell(p("a"))), row(cell(p("b")))])] }).content, schema);
    expect(keep.firstChild.type.name).toBe("table");
    expect(flat.firstChild.type.name).toBe("paragraph");
  });
  const fakeCell = (style) => ({ getAttribute: (k) => (k === "style" ? style : null) });
  const fakeTable = ({ border = null, cells = [], rows = 2 }) => ({
    getAttribute: (k) => (k === "border" ? border : null),
    querySelectorAll: (sel) => {
      if (sel === "td,th") return cells;
      if (sel === "tr") return Array.from({ length: rows }, () => ({ querySelectorAll: () => [1] }));
      return [];
    },
  });
  it("border=1 or a solid cell border is bordered; border=0 with padding only is not", () => {
    expect(isBorderedTable(fakeTable({ border: "1" }))).toBe(true);
    expect(isBorderedTable(fakeTable({ border: "0", cells: [fakeCell("padding:0in 5.4pt 0in 5.4pt")] }))).toBe(false);
    expect(isBorderedTable(fakeTable({ border: "0", cells: [fakeCell("border:solid #A3A3A3 1.0pt;padding:0in")] }))).toBe(true);
    expect(isBorderedTable(fakeTable({ border: "0", cells: [fakeCell("border:none")] }))).toBe(false);
  });
  it("isSingleColumn reads rows", () => {
    expect(isSingleColumn(fakeTable({ rows: 3 }))).toBe(true);
  });
});

describe("cause 5 — plain tab-separated text is a grid", () => {
  const excel = (name) => fs.readFileSync(path.join(FX, `${name}.txt`), "utf8");
  it("Excel's text/plain parses to the same grid the manifest expects (multi-line cell quoted)", () => {
    const rows = parseTabular(excel("excel"));
    expect(rows).toEqual([["Unit", "Area (SF)", "Notes"], ["A-100", "12,500", "Dock high and cross-docked"], ["A-200", "", "Line one\nLine two"], ["B-300", "8,200", "Survey"]]);
  });
  it("Google Sheets' text/plain keeps the empty cell and the quoted line break", () => {
    const rows = parseTabular(excel("google-sheets"));
    expect(rows[2]).toEqual(["A-200", "", "Line one\nLine two"]);
    expect(rows[3]).toEqual(["B-300 (merged across two columns)", "", "Survey"]);
  });
  it("CRLF, a trailing newline and a trailing empty cell are all handled", () => {
    expect(parseTabular("a\tb\r\nc\t\r\n")).toEqual([["a", "b"], ["c", ""]]);
  });
  it('a doubled quote is a literal quote; a mid-field quote is literal; an unclosed quote is text', () => {
    expect(parseTabular('"say ""hi"""\tb\nc\td')).toEqual([['say "hi"', "b"], ["c", "d"]]);
    expect(parseTabular('5" pipe\tb\nc\td')).toEqual([['5" pipe', "b"], ["c", "d"]]);
    expect(parseTabular('"open\tb\nc\td')).toEqual([['"open', "b"], ["c", "d"]]);
  });
  it("prose is NOT a table: no tab · one record · one column · ragged", () => {
    expect(parseTabular("just words\nmore words")).toBeNull();
    expect(parseTabular("a\tb")).toBeNull();                       // a single record
    expect(parseTabular("a\nb\nc")).toBeNull();
    expect(parseTabular("a\tb\nc\nd\te\tf")).toBeNull();           // ragged
    expect(parseTabular("")).toBeNull();
    expect(parseTabular(null)).toBeNull();
  });
  it("a clipboard that already has an html table is not re-gridded from its text", () => {
    expect(tabularFromClipboard(dt({ "text/html": "<table><tr><td>x</td></tr></table>", "text/plain": "a\tb\nc\td" }))).toBeNull();
    expect(tabularFromClipboard(dt({ "text/plain": "a\tb\nc\td" }))).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("rowsToTableHtml escapes markup and splits a cell's lines into paragraphs", () => {
    const html = rowsToTableHtml([["<b>&", "x\ny"], ["", "z"]]);
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<p>x</p><p>y</p>");
    expect(html).toContain("<td><p></p></td>");
  });
  it("every committed text/plain fixture that claims to be a table parses to the manifest's cell count", () => {
    for (const [name, m] of Object.entries(manifest)) {
      if (!m.plainTable) continue;
      const rows = parseTabular(excel(name));
      expect(rows, name).not.toBeNull();
      expect(rows.length, name).toBe(m.grid.length);
    }
  });
});

describe('"Keep text only" on a table is tab-separated rows (the stated choice)', () => {
  it("one line per ROW, cells joined by a tab — not one line per cell", () => {
    const t = node(table([row(cell(p("Unit")), cell(p("Area"))), row(cell(p("A-100")), cell(p("12,500")))]));
    expect(textOfNode(t)).toBe("Unit\tArea\nA-100\t12,500\n");
  });
  it("a cell holding two paragraphs stays on its row's line", () => {
    const t = node(table([row(cell(p("x")), cell(p("one"), p("two")))]));
    expect(textOfNode(t).trim()).toBe("x\tone two");
  });
  it("tableRowsToText round-trips parseTabular for an unquoted grid", () => {
    const rows = [["a", "b"], ["c", "d"]];
    expect(parseTabular(tableRowsToText(rows))).toEqual(rows);
  });
});

describe("a new box made for a pasted table is wide enough for its columns", () => {
  it("three columns outgrow a sticky note, but never the writing column", () => {
    expect(tableBoxWidth({ cols: 3, current: 180 })).toBe(480);
    expect(tableBoxWidth({ cols: 12, current: 180 })).toBe(560);
    expect(tableBoxWidth({ cols: 1, current: 400 })).toBe(400);   // never narrows
  });
});

describe("a paste must not leave the caret outside the box it started in", () => {
  const boxWithText = () => node({ type: "doc", content: [
    { type: "noteAnchor", attrs: { aid: "b1", x: 0, y: 0, w: 360, h: null }, content: [p("Intro")] }, p(""),
  ] });
  const stateAtBoxEnd = () => {
    const doc = boxWithText();
    const inside = TextSelection.create(doc, 7);                       // inside "Intro"
    return EditorState.create({ schema, doc, selection: inside });
  };
  it("a paste that ends in the structural paragraph is pulled back, with a line under the table", () => {
    const old = stateAtBoxEnd();
    // simulate ProseMirror's own result: table appended in the box, caret parked in the trailing paragraph
    const tbl = node(table([row(cell(p("a")), cell(p("b")))]));
    let tr = old.tr.setMeta("paste", true);
    const endInside = 1 + old.doc.firstChild.content.size + 1;
    tr = tr.insert(endInside - 1, tbl);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1), -1));
    const after = old.apply(tr);
    expect(after.selection.$from.node(1).type.name).not.toBe("noteAnchor");     // the defect, reproduced
    const fix = keepCaretInBox([tr], old, after);
    expect(fix).not.toBeNull();
    const fixed = after.apply(fix);
    expect(fixed.selection.$from.node(1).type.name).toBe("noteAnchor");
    expect(fixed.doc.firstChild.lastChild.type.name).toBe("paragraph");
    expect(fixed.doc.firstChild.child(1).type.name).toBe("table");
  });
  it("does nothing for a paste that stays in the box, or for a non-paste transaction", () => {
    const old = stateAtBoxEnd();
    const tr = old.tr.setMeta("paste", true).insertText("x", 7);
    expect(keepCaretInBox([tr], old, old.apply(tr))).toBeNull();
    const tr2 = old.tr.insertText("y", 7);
    expect(keepCaretInBox([tr2], old, old.apply(tr2))).toBeNull();
  });
});
