/* Model workspace — the real .xlsx round-trip (NEW-1, owner chat block).
 *
 * The owner's own VERIFY spec, implemented literally: build a workbook with two sheets, a
 * cross-sheet formula, a named range, a percent cell, a currency cell and a merged cell. Export
 * it. Read the produced file back with the library (ExcelJS, directly — not through this app's
 * own reader) and assert FORMULA STRINGS, not just values. Then re-import the same file into
 * Planyr and confirm same values AND same formulas. Also test the unsupported-function path
 * explicitly with a function this engine does not implement (VLOOKUP is not in
 * shared/formula/formula.js's FUNCTIONS table — confirmed by this suite's own first test).
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  createWorkbook, addSheet, applyToActiveSheet, commitCellText, setNumberFormat, setCellStyle,
  mergeRange, unsupportedFormulaAt,
} from "../src/workspaces/model/lib/sheetModel.js";
import { defineName } from "../src/workspaces/model/lib/namedRanges.js";
import { exportWorkbookToXlsxBlob, importXlsxToWorkbook, checkFormulaSupport } from "../src/workspaces/model/lib/xlsxIO.js";
import { FUNCTION_NAMES } from "../src/shared/formula/formula.js";

function buildFixtureWorkbook() {
  let wb = createWorkbook(); // Sheet1
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 0, "100")); // A1
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 1, 0, "200")); // A2
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 2, 0, "=SUM(A1:A2)")); // A3
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 1, "0.15")); // B1 — percent
  wb = applyToActiveSheet(wb, (s) => setNumberFormat(s, 0, 0, 1, 1, "0.0%"));
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 2, "1234.5")); // C1 — currency
  wb = applyToActiveSheet(wb, (s) => setNumberFormat(s, 0, 0, 2, 2, "$#,##0.00"));
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 3, "Quarterly Model")); // D1 — merged title
  wb = applyToActiveSheet(wb, (s) => mergeRange(s, 0, 0, 3, 5)); // D1:F1
  wb = applyToActiveSheet(wb, (s) => setCellStyle(s, 4, 4, 0, 0, { bold: true, italic: true, underline: true, strike: true, color: "#c62828" })); // A5
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 4, 0, "styled"));
  wb = applyToActiveSheet(wb, (s) => defineName(s, "LandCost", { r1: 1, c1: 2, r2: 1, c2: 2 })); // names B1 (1-based: row1, col2)

  wb = addSheet(wb); // Sheet2, made active
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 0, "10")); // Sheet2!A1
  wb = applyToActiveSheet(wb, (s) => commitCellText(s, 1, 0, "=Sheet1!A1+A1")); // Sheet2!A2 — cross-sheet formula
  return wb;
}

describe("checkFormulaSupport", () => {
  it("VLOOKUP is not implemented by this engine — the deliberate unsupported-function fixture", () => {
    expect(FUNCTION_NAMES).not.toContain("VLOOKUP");
    expect(checkFormulaSupport("VLOOKUP(A1,B1:C10,2,FALSE)").supported).toBe(false);
  });
  it("SUM and a cross-sheet reference are supported", () => {
    expect(checkFormulaSupport("SUM(A1:A2)").supported).toBe(true);
    expect(checkFormulaSupport("Sheet1!A1+A1").supported).toBe(true);
  });
  it("strips the _xlfn./_xlws. compatibility prefix real Excel files carry for newer functions", () => {
    const r = checkFormulaSupport("_xlfn.IFS(A1>0,\"pos\",TRUE,\"other\")");
    expect(r.supported).toBe(true);
    expect(r.stripped).toBe('IFS(A1>0,"pos",TRUE,"other")');
  });
});

describe("exportWorkbookToXlsxBlob + re-read with ExcelJS directly (the owner's VERIFY spec)", () => {
  it("writes formulas as FORMULA STRINGS, not flattened values, and carries formatting/merges/names", async () => {
    const wb = buildFixtureWorkbook();
    const blob = await exportWorkbookToXlsxBlob(wb);
    expect(blob.size).toBeGreaterThan(0);

    const raw = new ExcelJS.Workbook();
    await raw.xlsx.load(Buffer.from(await blob.arrayBuffer()));
    expect(raw.worksheets.map((s) => s.name)).toEqual(["Sheet1", "Sheet2"]);

    const s1 = raw.worksheets[0];
    // The formula cell is a real FORMULA, not a value — this is the crux of the owner's ask.
    expect(s1.getCell("A3").type).toBe(ExcelJS.ValueType.Formula);
    expect(s1.getCell("A3").formula).toBe("SUM(A1:A2)");
    expect(s1.getCell("A3").result).toBe(300);

    // Percent cell: underlying number + a real Excel percent format.
    expect(s1.getCell("B1").value).toBeCloseTo(0.15);
    expect(s1.getCell("B1").numFmt).toBe("0.0%");
    // Currency cell.
    expect(s1.getCell("C1").value).toBeCloseTo(1234.5);
    expect(s1.getCell("C1").numFmt).toBe("$#,##0.00");
    // Merged cell — a real Excel merge, anchored at D1.
    expect(s1.model.merges).toEqual(["D1:F1"]);
    expect(s1.getCell("D1").value).toBe("Quarterly Model");
    // Style — bold/italic/underline/strike/colour all survive as real Excel cell formatting.
    const a5font = s1.getCell("A5").font;
    expect(a5font.bold).toBe(true);
    expect(a5font.italic).toBe(true);
    expect(a5font.underline).toBe(true);
    expect(a5font.strike).toBe(true);
    expect(a5font.color.argb.slice(-6).toLowerCase()).toBe("c62828");

    // Cross-sheet formula, as a real formula string.
    const s2 = raw.worksheets[1];
    expect(s2.getCell("A2").type).toBe(ExcelJS.ValueType.Formula);
    expect(s2.getCell("A2").formula).toBe("Sheet1!A1+A1");
    // Sheet1!A1 (100) + this SHEET's own (bare, unqualified) A1 (10) — Excel's own semantics for
    // a bare reference inside a formula that also carries an explicit cross-sheet qualifier.
    expect(s2.getCell("A2").result).toBe(110);

    // Named range — a real Excel defined name, sheet-qualified to where it lives.
    const names = raw.definedNames.model;
    expect(names).toEqual(expect.arrayContaining([expect.objectContaining({ name: "LandCost" })]));
    const landCost = names.find((n) => n.name === "LandCost");
    expect(landCost.ranges[0]).toMatch(/^Sheet1!\$B\$1$/);
  });

  it("re-imports the SAME file into Planyr with the same values AND the same formulas", async () => {
    const wb = buildFixtureWorkbook();
    const blob = await exportWorkbookToXlsxBlob(wb);
    const { workbook: wb2, unsupportedCount } = await importXlsxToWorkbook(Buffer.from(await blob.arrayBuffer()));

    expect(unsupportedCount).toBe(0);
    expect(wb2.sheets.map((s) => s.name)).toEqual(["Sheet1", "Sheet2"]);
    const s1 = wb2.sheets[0].sheet;
    expect(s1.cells["c1:0"]).toBe("100");
    expect(s1.cells["c1:1"]).toBe("200");
    expect(s1.cells["c1:2"]).toBe("=SUM(A1:A2)"); // still a real formula, not a flattened 300
    expect(s1.cells["c2:0"]).toBe("0.15");
    expect(s1.formats["c2:0"]).toBe("0.0%");
    expect(s1.cells["c3:0"]).toBe("1234.5");
    expect(s1.formats["c3:0"]).toBe("$#,##0.00");
    expect(s1.cells["c4:0"]).toBe("Quarterly Model");
    expect(s1.merges).toEqual([{ r: 0, c1Id: "c4", c2Id: "c6" }]);
    expect(s1.styles["c1:4"]).toMatchObject({ bold: true, italic: true, underline: true, strike: true, color: "#c62828" });
    expect(s1.names.landcost).toMatchObject({ name: "LandCost", r1: 1, r2: 1, c1: 2, c2: 2 }); // B1

    const s2 = wb2.sheets[1].sheet;
    expect(s2.cells["c1:0"]).toBe("10");
    expect(s2.cells["c1:1"]).toBe("=Sheet1!A1+A1"); // cross-sheet formula, still a formula
  });
});

describe("the unsupported-function path — VLOOKUP, explicitly (owner's VERIFY ask)", () => {
  it("keeps the FILE'S OWN cached value and records the original formula text, never drops it or fails the whole import", async () => {
    // Built with raw ExcelJS directly — simulating a real Excel-authored file where REAL Excel
    // (not Planyr) already evaluated VLOOKUP to a genuine number, exactly what this app would
    // receive from a lender's or partner's real workbook.
    const raw = new ExcelJS.Workbook();
    const ws = raw.addWorksheet("Sheet1");
    ws.getCell("A1").value = "key";
    ws.getCell("B1").value = 2;
    ws.getCell("C1").value = 3;
    ws.getCell("D1").value = { formula: "VLOOKUP(A1,A1:C1,3,FALSE)", result: 3 };
    ws.getCell("D2").value = { formula: "SUM(B1:C1)", result: 5 }; // a supported formula in the SAME file must be unaffected
    const buf = await raw.xlsx.writeBuffer();

    const { workbook, unsupportedCount } = await importXlsxToWorkbook(Buffer.from(buf));
    expect(unsupportedCount).toBe(1);
    const sheet = workbook.sheets[0].sheet;

    // The cached VALUE is kept as a plain literal — nothing silently dropped or zeroed.
    expect(sheet.cells["c4:0"]).toBe("3");
    // isFormulaText must be FALSE now — this is a value cell, never re-evaluated as "=VLOOKUP(...)"
    // (which would show a confident, wrong #NAME? on the very next recalc).
    expect(sheet.cells["c4:0"].startsWith("=")).toBe(false);
    // The original formula text is preserved for the user to find, via the pure reader SheetView
    // itself calls to paint the corner marker.
    expect(unsupportedFormulaAt(sheet, 0, 3)).toBe("=VLOOKUP(A1,A1:C1,3,FALSE)");

    // The supported formula elsewhere in the same file imported normally — one unsupported
    // cell never fails (or degrades) the rest of the sheet.
    expect(sheet.cells["c4:1"]).toBe("=SUM(B1:C1)");
    expect(unsupportedFormulaAt(sheet, 1, 3)).toBe(null);
  });

  it("an edit to the cell clears the marker (sheetModel.js's setRaw contract)", async () => {
    const raw = new ExcelJS.Workbook();
    const ws = raw.addWorksheet("Sheet1");
    ws.getCell("A1").value = { formula: "VLOOKUP(1,A1:B1,2,FALSE)", result: 42 };
    const buf = await raw.xlsx.writeBuffer();
    const { workbook } = await importXlsxToWorkbook(Buffer.from(buf));
    const sheet = workbook.sheets[0].sheet;
    expect(unsupportedFormulaAt(sheet, 0, 0)).not.toBeNull();

    const { commitCellText } = await import("../src/workspaces/model/lib/sheetModel.js");
    const edited = commitCellText(sheet, 0, 0, "99");
    expect(unsupportedFormulaAt(edited, 0, 0)).toBeNull();
    expect(edited.cells["c1:0"]).toBe("99");
  });
});
