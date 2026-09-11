/* notesTableColumns — the editor-side command that keeps NEW-1/NEW-2 true on the real document:
 * once a table has any explicitly resized column, every other column gets one too (defaulted or
 * floored), so the STORED document is exactly what `notesTableWidth.test.js` proves the pure
 * decision should be. Driven against a real ProseMirror `EditorState`, no DOM — the same shape
 * `notesListIndent.test.js` already uses for `shiftIndent`. */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { normalizeTableColumnWidths, tableColumnWidths } from "../src/workspaces/notes/lib/notesTableColumns.js";
import { TABLE_COL_MIN_WIDTH, TABLE_DEFAULT_COL_WIDTH } from "../src/workspaces/notes/lib/notesTableWidth.js";

const schema = getSchema(NOTE_EXTENSIONS);

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (colwidth = null, colspan = 1, rowspan = 1) =>
  ({ type: "tableCell", attrs: { colspan, rowspan, colwidth, align: null }, content: [p("x")] });
const row = (cells) => ({ type: "tableRow", content: cells });

function run(rows) {
  const docJSON = { type: "doc", content: [{ type: "table", content: rows }] };
  const doc = PMNode.fromJSON(schema, docJSON);
  const state = EditorState.create({ schema, doc });
  let after = null;
  const changed = normalizeTableColumnWidths()({
    state,
    tr: state.tr,
    dispatch: (tr) => { after = state.apply(tr); },
  });
  return { changed, doc: after ? after.doc.toJSON() : null };
}

function widthsOfFirstTable(docJSON) {
  const schemaDoc = PMNode.fromJSON(schema, docJSON);
  return tableColumnWidths(schemaDoc.firstChild);
}

describe("normalizeTableColumnWidths — untouched tables are left alone", () => {
  it("makes no change and returns false for a table with no resized column", () => {
    const { changed, doc } = run([row([cell(), cell(), cell()])]);
    expect(changed).toBe(false);
    expect(doc).toBeNull();
  });
});

describe("normalizeTableColumnWidths — the owner's exact repro", () => {
  it("defaults the untouched columns and never narrows the two he dragged wide", () => {
    // AHJ / Permit / Number untouched, two trailing columns dragged to 300 each.
    const { changed, doc } = run([row([cell(), cell(), cell(), cell([300]), cell([300])])]);
    expect(changed).toBe(true);
    const widths = widthsOfFirstTable(doc);
    expect(widths).toEqual([
      TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_COL_WIDTH, 300, 300,
    ]);
  });

  it("only the dragged column's own number changes — a single resize touches one column", () => {
    // A table that is ALREADY fully explicit except for one column just dragged: normalizing
    // must not rewrite the columns that already had a real, above-floor width.
    const { changed, doc } = run([row([cell([180]), cell([220]), cell([400])])]);
    expect(changed).toBe(false);
    void doc;
  });
});

describe("normalizeTableColumnWidths — the floor (NEW-2)", () => {
  it("raises an already-stored sliver column to the floor, and leaves a healthy one alone", () => {
    const { changed, doc } = run([row([cell([12]), cell([400]), cell([8])])]);
    expect(changed).toBe(true);
    const widths = widthsOfFirstTable(doc);
    expect(widths).toEqual([TABLE_COL_MIN_WIDTH, 400, TABLE_COL_MIN_WIDTH]);
  });
});

describe("normalizeTableColumnWidths — multi-row and colspan tables", () => {
  it("keeps every row's cell in the same column consistent, reading the first row as authoritative", () => {
    // The first row decides each column's width (the same convention this module's own
    // `updateColumns` walk already relies on for rendering); every OTHER row's cell in that
    // column is brought into line with it, not read independently.
    const { changed, doc } = run([
      row([cell([300]), cell([12]), cell()]),
      row([cell(), cell([999]), cell()]),
    ]);
    expect(changed).toBe(true);
    const widths = widthsOfFirstTable(doc);
    // Column 0: 300 (explicit). Column 1: 12 → floored. Column 2: default.
    expect(widths[0]).toBe(300);
    expect(widths[1]).toBe(TABLE_COL_MIN_WIDTH);
    expect(widths[2]).toBe(TABLE_DEFAULT_COL_WIDTH);
    // Every row's own cell in column 1 must agree, not just the first row's — the second row's
    // stale 999 is corrected to match, not left to disagree with what is actually rendered.
    const rows = doc.content[0].content;
    expect(rows[0].content[1].attrs.colwidth[0]).toBe(TABLE_COL_MIN_WIDTH);
    expect(rows[1].content[1].attrs.colwidth[0]).toBe(TABLE_COL_MIN_WIDTH);
  });

  it("handles a colspan-2 cell as two column slots", () => {
    const wide = { type: "tableCell", attrs: { colspan: 2, rowspan: 1, colwidth: [250, null], align: null }, content: [p("x")] };
    const { changed, doc } = run([row([wide, cell([90])])]);
    expect(changed).toBe(true);
    const widths = widthsOfFirstTable(doc);
    expect(widths).toEqual([250, TABLE_DEFAULT_COL_WIDTH, TABLE_COL_MIN_WIDTH]);
    const wideAttrs = doc.content[0].content[0].content[0].attrs;
    expect(wideAttrs.colwidth).toEqual([250, TABLE_DEFAULT_COL_WIDTH]);
  });
});
