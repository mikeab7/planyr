/* Model workspace — CSV round-trip (NEW-1, the deliberately lesser path — see csvIO.js's own
 * header for why it's values-only and never the default button). */
import { describe, it, expect } from "vitest";
import { parseCsv, csvRowsToSheet, sheetToCsv, addSheetFromCsvText } from "../src/workspaces/model/lib/csvIO.js";
import { createWorkbook, applyToActiveSheet, commitCellText, setNumberFormat } from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../src/workspaces/model/lib/sheetEngine.js";

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas, newlines and escaped quotes", () => {
    const rows = parseCsv('a,b,"c, with comma"\r\n1,2,"say ""hi"""\r\n"multi\nline",5,6\r\n');
    expect(rows).toEqual([
      ["a", "b", "c, with comma"],
      ["1", "2", 'say "hi"'],
      ["multi\nline", "5", "6"],
    ]);
  });
  it("drops the single wholly-blank trailing row a trailing newline produces", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("sheetToCsv", () => {
  it("exports VALUES ONLY — a formula's computed, number-formatted result, never formula text", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 0, "100"));
    wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 1, "0.5"));
    wb = applyToActiveSheet(wb, (s) => setNumberFormat(s, 0, 0, 1, 1, "0.0%"));
    wb = applyToActiveSheet(wb, (s) => commitCellText(s, 1, 0, "=A1*2"));
    const evalResult = evaluateWorkbook(wb).get(wb.activeSheetId);
    const csv = sheetToCsv(wb.sheets[0].sheet, evalResult);
    expect(csv).toBe("100,50.0%\r\n200,\r\n");
    expect(csv).not.toContain("=");
  });
  it("a blank sheet exports as empty text, never 26,000 empty commas", () => {
    const wb = createWorkbook();
    const evalResult = evaluateWorkbook(wb).get(wb.activeSheetId);
    expect(sheetToCsv(wb.sheets[0].sheet, evalResult)).toBe("");
  });
});

describe("csvRowsToSheet / addSheetFromCsvText", () => {
  it("columns are plain lettered — a header row lands as ordinary row-1 DATA, never a column name", () => {
    const sheet = csvRowsToSheet([["Name", "Cost"], ["Land", "500000"]]);
    expect(sheet.columns[0].name).toBe("A");
    expect(sheet.columns[1].name).toBe("B");
    expect(sheet.cells["c1:0"]).toBe("Name");
    expect(sheet.cells["c2:0"]).toBe("Cost");
    expect(sheet.cells["c1:1"]).toBe("Land");
  });

  it("appends a NEW sheet to the workbook, never replacing it — the other sheets are untouched", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, (s) => commitCellText(s, 0, 0, "existing"));
    const next = addSheetFromCsvText(wb, "x,y\n5,6\n", "Imported");
    expect(next.sheets.map((s) => s.name)).toEqual(["Sheet1", "Imported"]);
    expect(next.sheets[0].sheet.cells["c1:0"]).toBe("existing"); // untouched
    expect(next.sheets[1].sheet.cells["c1:0"]).toBe("x");
    expect(next.activeSheetId).toBe(next.sheets[1].id);
  });
});
