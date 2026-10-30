/* sheetModel hidden rows / columns (Ctrl+9, Ctrl+0, header menu) — the data model, structural relocation and Excel round-trip. */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  createSheet, createWorkbook, applyToActiveSheet, commitCellText, setRowsHidden, setColumnsHidden, isRowHidden, isColumnHidden,
  insertRowAt, deleteRowAt, migrateSheet, activeSheetEntry,
} from "../src/workspaces/model/lib/sheetModel.js";
import { exportWorkbookToXlsxBlob, importXlsxToWorkbook } from "../src/workspaces/model/lib/xlsxIO.js";

describe("hidden rows", () => {
  it("hide / unhide a run; a no-op returns the SAME sheet (no undo frame minted)", () => {
    const s = createSheet();
    const h = setRowsHidden(s, 2, 4, true);
    expect([1, 2, 3, 4, 5].map((r) => isRowHidden(h, r))).toEqual([false, true, true, true, false]);
    expect(setRowsHidden(h, 3, 3, true)).toBe(h);
    const back = setRowsHidden(h, 0, 10, false);
    expect(Object.keys(back.hiddenRows)).toEqual([]);
    expect(setRowsHidden(s, 0, 10, false)).toBe(s);
  });
  it("rows hidden below an insert move down with their content; a deleted hidden row disappears", () => {
    let s = setRowsHidden(createSheet(), 5, 5, true);
    expect(isRowHidden(insertRowAt(s, 2), 6)).toBe(true);
    expect(isRowHidden(insertRowAt(s, 2), 5)).toBe(false);
    expect(isRowHidden(deleteRowAt(s, 5), 5)).toBe(false);
    expect(isRowHidden(deleteRowAt(s, 1), 4)).toBe(true);
  });
  it("survives migration (a saved sheet keeps its hidden rows)", () => {
    const s = setRowsHidden(createSheet(), 3, 3, true);
    expect(isRowHidden(migrateSheet(JSON.parse(JSON.stringify(s))), 3)).toBe(true);
  });
});

describe("hidden columns", () => {
  it("hide keeps the stored width so unhide restores it; the last visible column can never be hidden", () => {
    const s = createSheet();
    const w = s.columns[2].width;
    const h = setColumnsHidden(s, 2, 2, true);
    expect(isColumnHidden(h, 2)).toBe(true);
    expect(setColumnsHidden(h, 2, 2, false).columns[2].width).toBe(w);
    expect(setColumnsHidden(s, 0, 25, true)).toBe(s);
    expect(setColumnsHidden(s, 0, 24, true).columns.filter((c) => c.hidden)).toHaveLength(25);
  });
});

describe("Excel round-trip keeps hidden rows and columns", () => {
  it("export -> read with ExcelJS -> import", async () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, (s) => commitCellText(commitCellText(s, 0, 0, "a"), 0, 3, "d")); // a value in D so column B sits inside the used range
    wb = applyToActiveSheet(wb, (s) => setRowsHidden(s, 2, 2, true));
    wb = applyToActiveSheet(wb, (s) => setColumnsHidden(s, 1, 1, true));
    const blob = await exportWorkbookToXlsxBlob(wb);
    const buf = await blob.arrayBuffer();
    const x = new ExcelJS.Workbook(); await x.xlsx.load(buf);
    const ws = x.worksheets[0];
    expect(ws.getRow(3).hidden).toBe(true);
    expect(ws.getColumn(2).hidden).toBe(true);
    const imported = await importXlsxToWorkbook(buf);
    const s = activeSheetEntry(imported.workbook || imported).sheet;
    expect(isRowHidden(s, 2)).toBe(true);
    expect(isColumnHidden(s, 1)).toBe(true);
  });
});
