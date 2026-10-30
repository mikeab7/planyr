/* lib/selection.js — THE selection model for whole rows / columns / sheet, plus the header-is-a-label guard.
 * (Owner brief 2026-10-29, NEW-1 / NEW-2.) These fail on main: the module and the header behaviour do not exist there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  wholeColumns, wholeRows, wholeSheet, selectionKind, clampSelection, extendFromHeader, wholeSelectionLabel,
  parseWholeAddress, columnHeaderLabel, rowHeaderLabel, currentRegion, selectAllStep,
} from "../src/workspaces/model/lib/selection.js";
import { createSheet, commitCellText, insertColumnAt, renameColumn, setRaw } from "../src/workspaces/model/lib/sheetModel.js";

const sheet = createSheet(); // 26 columns, 1000 rows

describe("a whole column / row is a RANGE, never a walk over cells", () => {
  it("wholeColumns spans every row of the sheet and starts the active cell at the anchor column's first cell", () => {
    expect(wholeColumns(sheet, 2)).toEqual({ r1: 0, r2: 999, c1: 2, c2: 2 });
    expect(wholeColumns(sheet, 5, 3)).toEqual({ r1: 0, r2: 999, c1: 5, c2: 3 }); // anchor first, either direction
  });
  it("wholeRows spans every column", () => {
    expect(wholeRows(sheet, 4)).toEqual({ r1: 4, r2: 4, c1: 0, c2: 25 });
    expect(wholeRows(sheet, 6, 2)).toEqual({ r1: 6, r2: 2, c1: 0, c2: 25 });
  });
  it("wholeSheet is both", () => expect(wholeSheet(sheet)).toEqual({ r1: 0, r2: 999, c1: 0, c2: 25 }));
  it("indices are clamped into the sheet", () => {
    expect(wholeColumns(sheet, 99).c1).toBe(25);
    expect(wholeRows(sheet, 5000).r1).toBe(999);
  });
});

describe("selectionKind", () => {
  it("classifies columns, rows, sheet and plain cells", () => {
    expect(selectionKind(sheet, wholeColumns(sheet, 1, 3))).toBe("columns");
    expect(selectionKind(sheet, wholeRows(sheet, 1, 3))).toBe("rows");
    expect(selectionKind(sheet, wholeSheet(sheet))).toBe("sheet");
    expect(selectionKind(sheet, { r1: 0, r2: 4, c1: 0, c2: 4 })).toBe("cells");
  });
  it("a header selection made against padded rows (r2 past the last row) still reads as a whole column", () => {
    expect(selectionKind(sheet, { r1: 0, r2: 1019, c1: 2, c2: 2 })).toBe("columns");
  });
  it("clampSelection trims a padded selection to the sheet", () => {
    expect(clampSelection(sheet, { r1: 0, r2: 1019, c1: 2, c2: 2 }).r2).toBe(999);
  });
});

describe("Shift+click / drag extend from the anchor header", () => {
  it("extends a column run from the anchor in both directions", () => {
    const start = wholeColumns(sheet, 3);
    expect(extendFromHeader(sheet, start, "col", 6)).toEqual({ r1: 0, r2: 999, c1: 3, c2: 6 });
    expect(extendFromHeader(sheet, start, "col", 1)).toEqual({ r1: 0, r2: 999, c1: 3, c2: 1 });
  });
  it("extends a row run", () => {
    expect(extendFromHeader(sheet, wholeRows(sheet, 2), "row", 5)).toEqual({ r1: 2, r2: 5, c1: 0, c2: 25 });
  });
});

describe("the Name Box text", () => {
  it("reads C:C, A:C, 5:5, 2:7 and A:Z; a plain range reads null (the active cell's address is shown instead)", () => {
    expect(wholeSelectionLabel(sheet, wholeColumns(sheet, 2))).toBe("C:C");
    expect(wholeSelectionLabel(sheet, wholeColumns(sheet, 2, 0))).toBe("A:C");
    expect(wholeSelectionLabel(sheet, wholeRows(sheet, 4))).toBe("5:5");
    expect(wholeSelectionLabel(sheet, wholeRows(sheet, 1, 6))).toBe("2:7");
    expect(wholeSelectionLabel(sheet, wholeSheet(sheet))).toBe("A:Z");
    expect(wholeSelectionLabel(sheet, { r1: 0, r2: 3, c1: 0, c2: 3 })).toBeNull();
  });
  it("typing C:C / a:c / 5:5 / 7:2 into the Name Box selects the whole column / row run; junk is refused", () => {
    expect(parseWholeAddress("C:C", sheet)).toEqual(wholeColumns(sheet, 2));
    expect(parseWholeAddress("a:c", sheet)).toEqual(wholeColumns(sheet, 0, 2));
    expect(parseWholeAddress("5:5", sheet)).toEqual(wholeRows(sheet, 4));
    expect(parseWholeAddress("7:2", sheet)).toEqual(wholeRows(sheet, 1, 6));
    expect(parseWholeAddress("A1:B2", sheet)).toBeNull();
    expect(parseWholeAddress("AAA:AAA", sheet)).toBeNull(); // past the last column
    expect(parseWholeAddress("0:3", sheet)).toBeNull();
    expect(parseWholeAddress("1:99999", sheet)).toBeNull();
  });
});

describe("header labels are positions, not stored text (NEW-1)", () => {
  it("columnHeaderLabel / rowHeaderLabel come from the index alone", () => {
    expect([0, 1, 25, 26, 27].map(columnHeaderLabel)).toEqual(["A", "B", "Z", "AA", "AB"]);
    expect(rowHeaderLabel(0)).toBe("1");
    expect(rowHeaderLabel(41)).toBe("42");
  });
  it("a column's STORED name can never change what the header shows — and an insert recomputes the letters", () => {
    let s = renameColumn(sheet, 1, "Revenue");
    expect(s.columns[1].name).toBe("Revenue"); // the stored name (kept so existing [Revenue] formulas keep resolving)
    expect(columnHeaderLabel(1)).toBe("B");
    s = insertColumnAt(s, 1);
    expect([0, 1, 2, 3].map(columnHeaderLabel).join("")).toBe("ABCD");
  });
  it("RED ON MAIN: SheetView has no rename route, no rename input and prints the computed label", () => {
    const src = readFileSync(new URL("../src/workspaces/model/components/SheetView.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/setRenaming|renameCommit|onRenameColumn/);
    expect(src).not.toMatch(/onDoubleClick=\{\(\) => setRenaming/);
    expect(src).toContain("columnHeaderLabel(c)");
    expect(src).not.toMatch(/\{col\.name\}/);
  });
  it("RED ON MAIN: headers select on press (mousedown), through the one selection helper", () => {
    const src = readFileSync(new URL("../src/workspaces/model/components/SheetView.jsx", import.meta.url), "utf8");
    expect(src).toContain('onMouseDown={(e) => headerPress("col", c, e)}');
    expect(src).toContain('onMouseDown={(e) => headerPress("row", r, e)}');
    expect(src).toContain("onMouseDown={cornerPress}");
  });
});

describe("Ctrl+A: region first, whole sheet on the second press", () => {
  const filled = (() => { let s = createSheet(); for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1], [5, 5]]) s = setRaw(s, r, c, "x"); return s; })();
  const has = (r, c) => (filled.cells[`${filled.columns[c].id}:${r}`] || "") !== "";
  it("currentRegion grows over adjacent content only", () => {
    expect(currentRegion(has, 1000, 26, 0, 0)).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
    expect(currentRegion(has, 1000, 26, 5, 5)).toEqual({ r1: 5, r2: 5, c1: 5, c2: 5 });
  });
  it("first press -> region, second press -> everything; a blank cell with nothing around it goes straight to everything", () => {
    const first = selectAllStep(filled, { r1: 0, r2: 0, c1: 0, c2: 0 }, has);
    expect(first).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
    expect(selectAllStep(filled, first, has)).toEqual(wholeSheet(filled));
    expect(selectAllStep(filled, { r1: 20, r2: 20, c1: 20, c2: 20 }, has)).toEqual(wholeSheet(filled));
  });
});
