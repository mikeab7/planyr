/* NEW-1 — open an uploaded Excel in Spreadsheet: the PARSE side (lib/spreadsheetFile.js + xlsxInspect.js).
 *
 * Real files are built in the test with ExcelJS / SheetJS / fflate, parsed through the module's one
 * entry point, and asserted on what a person would SEE (displayFor) — not just on the stored text —
 * because the failure this guards against is "the cell holds 45292 and shows 45292" for a date.
 * Each edge case the owner named has its own test; the red-proof for every one is that it asserts a
 * concrete value a broken reader could not produce by accident. */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { evaluateWorkbook, displayFor } from "../src/workspaces/model/lib/sheetEngine.js";
import {
  parseSpreadsheetFile, spreadsheetKindOf, savesInPlace, xlsxNameFor, SpreadsheetFileError, MAX_OPEN_BYTES,
} from "../src/workspaces/model/lib/spreadsheetFile.js";
import { inspectSpreadsheetBytes, describeUnsupported, CFB_MAGIC } from "../src/workspaces/model/lib/xlsxInspect.js";

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/spreadsheet/${name}`, import.meta.url)));
const u8 = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));
async function build(fn) {
  const wb = new ExcelJS.Workbook();
  fn(wb);
  return u8(await wb.xlsx.writeBuffer());
}
/** What the sheet SHOWS at (row, col), 0-based, on the sheet at `idx`. */
function shown(workbook, idx, r, c) {
  const ev = evaluateWorkbook(workbook, {});
  const entry = workbook.sheets[idx];
  return displayFor(entry.sheet, ev.get(entry.id), r, c);
}
const raw = (workbook, idx, r, c) => {
  const e = workbook.sheets[idx];
  return e.sheet.cells[`${e.sheet.columns[c].id}:${r}`];
};
async function expectRejects(promise, code, text) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  expect(err, "expected a rejection").toBeInstanceOf(SpreadsheetFileError);
  expect(err.code).toBe(code);
  if (text) expect(err.message).toContain(text);
  return err;
}

describe("file kind helpers", () => {
  it("reads the kind from the name only", () => {
    expect(spreadsheetKindOf("a.XLSX")).toBe("xlsx");
    expect(spreadsheetKindOf("a.xls")).toBe("xls");
    expect(spreadsheetKindOf("a.csv")).toBe("csv");
    expect(spreadsheetKindOf("a.xlsm")).toBe("xlsm");
    expect(spreadsheetKindOf("a.pdf")).toBeNull();
    expect(spreadsheetKindOf("noext")).toBeNull();
  });
  it("only a real .xlsx saves back in place; everything else gets an .xlsx copy", () => {
    expect(savesInPlace("a.xlsx")).toBe(true);
    for (const n of ["a.xls", "a.csv", "a.xlsm"]) expect(savesInPlace(n)).toBe(false);
    expect(xlsxNameFor("Broker Comps.xls")).toBe("Broker Comps.xlsx");
    expect(xlsxNameFor("noext")).toBe("noext.xlsx");
  });
  it("the open ceiling is the Library's own 50 MB, not a new number", async () => {
    const { MAX_BYTES } = await import("../src/workspaces/doc-review/lib/reviewStore.js");
    expect(MAX_OPEN_BYTES).toBe(MAX_BYTES);
  });
});

describe("multi-sheet workbook with a cross-sheet formula", () => {
  it("keeps every sheet as a tab, in order, and the formula as a formula with its computed value", async () => {
    const bytes = await build((wb) => {
      const a = wb.addWorksheet("Assumptions");
      a.getCell("A1").value = "Land";
      a.getCell("B1").value = 1000000;
      const m = wb.addWorksheet("Model");
      m.getCell("A1").value = "Total";
      m.getCell("B1").value = { formula: "Assumptions!B1*2", result: 2000000 };
      wb.addWorksheet("Notes").getCell("A1").value = "hello";
    });
    const r = await parseSpreadsheetFile(bytes, "pro forma.xlsx");
    expect(r.workbook.sheets.map((s) => s.name)).toEqual(["Assumptions", "Model", "Notes"]);
    expect(raw(r.workbook, 1, 0, 1)).toBe("=Assumptions!B1*2");
    expect(shown(r.workbook, 1, 0, 1)).toBe("2000000");
    expect(r.notes).toEqual([]); // nothing to apologise for
  });
});

describe("dates stored as Excel serial numbers", () => {
  it("shows a date, not a 45,000-style number, when the cell has a date format", async () => {
    const bytes = await build((wb) => {
      const ws = wb.addWorksheet("D");
      // 45292 is 2024-01-01 as an Excel serial; a number + a date numFmt is exactly how Excel stores a date.
      ws.getCell("A1").value = 45292; ws.getCell("A1").numFmt = "m/d/yyyy";
      ws.getCell("A2").value = 45292; // control: a plain number must stay a number
      ws.getCell("A3").value = new Date(Date.UTC(2026, 2, 15)); ws.getCell("A3").numFmt = "mmm d, yyyy";
    });
    const r = await parseSpreadsheetFile(bytes, "dates.xlsx");
    expect(shown(r.workbook, 0, 0, 0)).toBe("1/1/2024");
    expect(shown(r.workbook, 0, 1, 0)).toBe("45292");
    expect(shown(r.workbook, 0, 2, 0)).toBe("Mar 15, 2026");
  });
});

describe("merged header cells, a leading blank column, stray whitespace in headers", () => {
  it("keeps the merge, the blank column A, and the exact header text (spaces and all)", async () => {
    const bytes = await build((wb) => {
      const ws = wb.addWorksheet("Comps");
      ws.getCell("B1").value = "Houston Lease Comps";
      ws.mergeCells("B1:E1");
      ws.getCell("B2").value = "  Building  ";
      ws.getCell("C2").value = "Rent PSF ";
      ws.getCell("B3").value = "Alpha"; ws.getCell("C3").value = 7.25;
      ws.views = [{ state: "frozen", ySplit: 2 }];
      ws.getColumn(2).width = 30;
    });
    const r = await parseSpreadsheetFile(bytes, "broker.xlsx");
    const sheet = r.workbook.sheets[0].sheet;
    expect(shown(r.workbook, 0, 0, 0)).toBe(""); // blank column A survives as a blank column
    expect(raw(r.workbook, 0, 1, 1)).toBe("  Building  "); // whitespace is data; never trimmed away
    expect(raw(r.workbook, 0, 1, 2)).toBe("Rent PSF ");
    expect(sheet.merges).toHaveLength(1);
    expect(sheet.merges[0]).toMatchObject({ r: 0 });
    expect(sheet.freezeRows).toBe(2);
    expect(sheet.columns[1].width).toBeGreaterThan(sheet.columns[0].width);
  });
  it("reports a multi-row merge it cannot draw, instead of dropping it silently", async () => {
    const bytes = await build((wb) => {
      const ws = wb.addWorksheet("S");
      ws.getCell("A1").value = "tall"; ws.mergeCells("A1:A3");
    });
    const r = await parseSpreadsheetFile(bytes, "tall.xlsx");
    expect(r.notes.map((n) => n.key)).toContain("merges");
    expect(raw(r.workbook, 0, 0, 0)).toBe("tall"); // the text is kept
  });
});

describe("empty workbook", () => {
  it("a file with one blank sheet opens as a blank sheet (it is not an error)", async () => {
    const bytes = await build((wb) => wb.addWorksheet("Blank"));
    const r = await parseSpreadsheetFile(bytes, "blank.xlsx");
    expect(r.workbook.sheets).toHaveLength(1);
    expect(r.workbook.sheets[0].name).toBe("Blank");
  });
  it("a zero-byte file is refused by name, not opened blank", async () => {
    await expectRejects(parseSpreadsheetFile(new Uint8Array(0), "nothing.xlsx"), "empty", "nothing.xlsx");
  });
  it("a package with no worksheets says so", async () => {
    const bytes = await build((wb) => wb.addWorksheet("x"));
    const files = unzipSync(bytes);
    for (const k of Object.keys(files)) if (/^xl\/worksheets\//.test(k)) delete files[k];
    const err = await parseSpreadsheetFile(zipSync(files), "hollow.xlsx").catch((e) => e);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err.message).toContain("hollow.xlsx");
  });
});

describe(".csv", () => {
  it("opens as one plain sheet; quotes, embedded commas and a BOM are handled", async () => {
    const text = "﻿Name,Rent\r\n\"Smith, J\",12.5\r\nB,\"say \"\"hi\"\"\"\r\n";
    const r = await parseSpreadsheetFile(new TextEncoder().encode(text), "list.csv");
    expect(r.kind).toBe("csv");
    expect(r.workbook.sheets).toHaveLength(1);
    expect(r.workbook.sheets[0].name).toBe("list");
    expect(raw(r.workbook, 0, 0, 0)).toBe("Name");
    expect(raw(r.workbook, 0, 1, 0)).toBe("Smith, J");
    expect(raw(r.workbook, 0, 2, 1)).toBe('say "hi"');
    expect(shown(r.workbook, 0, 1, 1)).toBe("12.5");
  });
  it("a Windows-1252 CSV (an Excel 'CSV (Comma delimited)' save) keeps its accents", async () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x0a]); // "Café,1\n" in cp1252
    const r = await parseSpreadsheetFile(bytes, "cafe.csv");
    expect(raw(r.workbook, 0, 0, 0)).toBe("Café");
  });
  it("an empty CSV is refused by name", async () => {
    await expectRejects(parseSpreadsheetFile(new TextEncoder().encode("\n"), "e.csv"), "empty", "e.csv");
  });
});

describe(".xls (old Excel format)", () => {
  it("a REAL .xls (written by LibreOffice) opens with its formulas, dates and second sheet", async () => {
    const r = await parseSpreadsheetFile(fixture("legacy.xls"), "legacy.xls");
    expect(r.workbook.sheets.map((s) => s.name)).toEqual(["Data", "Second"]);
    expect(raw(r.workbook, 0, 1, 3)).toBe("=B2*C2");
    expect(shown(r.workbook, 0, 1, 3)).toBe("2.5");
    expect(shown(r.workbook, 0, 1, 4)).toBe("1/1/2024"); // a date, not 45292
    expect(raw(r.workbook, 1, 0, 0)).toBe("=Data!D2+1"); // a formula that reads another sheet
    expect(shown(r.workbook, 1, 0, 0)).toBe("3.5");
    expect(r.notes.map((n) => n.key)).toContain("xls");
  });
  it("values and a merge come across from a generated .xls, and the banner says styles did not", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Item", "Qty", "Price"], ["Pipe", 3, 4.5], ["Total", null, null]]);
    ws.D1 = { t: "d", v: new Date(Date.UTC(2024, 0, 1)), z: "m/d/yyyy" };
    ws["!merges"] = [{ s: { r: 4, c: 0 }, e: { r: 4, c: 2 } }];
    ws["!ref"] = "A1:D5";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "Takeoff");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["second"]]), "Second");
    const bytes = u8(XLSX.write(book, { bookType: "biff8", type: "array" }));
    expect(inspectSpreadsheetBytes(bytes).kind).toBe("cfb");
    const r = await parseSpreadsheetFile(bytes, "old takeoff.xls");
    expect(r.workbook.sheets.map((s) => s.name)).toEqual(["Takeoff", "Second"]);
    expect(raw(r.workbook, 0, 1, 0)).toBe("Pipe");
    expect(r.workbook.sheets[0].sheet.merges.length).toBeGreaterThan(0);
    expect(r.notes.map((n) => n.key)).toContain("xls");
  });
});

describe("password-protected files", () => {
  it("a REAL encrypted .xlsx (Excel's own scheme, written by msoffcrypto) is refused with how to fix it", async () => {
    const bytes = fixture("locked.xlsx");
    expect(inspectSpreadsheetBytes(bytes)).toMatchObject({ kind: "cfb", encrypted: true });
    const err = await expectRejects(parseSpreadsheetFile(bytes, "locked.xlsx"), "encrypted", "locked.xlsx");
    expect(err.message).toMatch(/password/i);
  });
  it("an encrypted .xlsx (an OLE container holding EncryptedPackage) is refused with how to fix it", async () => {
    const needle = []; for (const ch of "EncryptedPackage") needle.push(ch.charCodeAt(0), 0);
    const bytes = new Uint8Array(4096);
    bytes.set(CFB_MAGIC, 0); bytes.set(needle, 1024);
    const err = await expectRejects(parseSpreadsheetFile(bytes, "secret.xlsx"), "encrypted", "secret.xlsx");
    expect(err.message).toMatch(/password/i);
    expect(err.message).toMatch(/Encrypt with Password/);
  });
  it("a plain old .xls is NOT mistaken for an encrypted file", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[1]]), "S");
    const info = inspectSpreadsheetBytes(u8(XLSX.write(book, { bookType: "biff8", type: "array" })));
    expect(info.kind).toBe("cfb");
    expect(info.encrypted).toBe(false);
  });
});

describe("content the module cannot represent is listed, never silently dropped", () => {
  it("a REAL workbook with a chart (written by openpyxl) opens, with the chart named in the note", async () => {
    const r = await parseSpreadsheetFile(fixture("chart.xlsx"), "dashboard.xlsx");
    expect(r.notes.find((n) => n.key === "unsupported").text).toContain("1 chart");
    expect(raw(r.workbook, 0, 1, 3)).toBe("=B2*C2");
    expect(shown(r.workbook, 0, 4, 3)).toBe("40"); // 4 * 10
    expect(shown(r.workbook, 0, 1, 4)).toBe("1/1/2024");
  });
  async function withParts(parts) {
    const bytes = await build((wb) => { wb.addWorksheet("S").getCell("A1").value = "x"; });
    const files = unzipSync(bytes);
    for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
    return zipSync(files);
  }
  it("a chart and a pivot table are named in a note, and the cells still open", async () => {
    const bytes = await withParts({ "xl/charts/chart1.xml": "<c/>", "xl/charts/chart2.xml": "<c/>", "xl/pivotTables/pivotTable1.xml": "<p/>", "xl/media/image1.png": "x" });
    const info = inspectSpreadsheetBytes(bytes);
    expect(info.features.map((f) => f.label)).toEqual(expect.arrayContaining(["2 charts", "1 pivot table", "1 picture"]));
    const r = await parseSpreadsheetFile(bytes, "dash.xlsx");
    const note = r.notes.find((n) => n.key === "unsupported");
    expect(note.text).toContain("2 charts");
    expect(note.text).toContain("1 pivot table");
    expect(raw(r.workbook, 0, 0, 0)).toBe("x");
  });
  it("macros, data validation and conditional formatting are named too", async () => {
    const bytes = await build((wb) => {
      const ws = wb.addWorksheet("S");
      ws.getCell("A1").value = 5;
      ws.getCell("A1").dataValidation = { type: "list", allowBlank: true, formulae: ['"a,b"'] };
      ws.addConditionalFormatting({ ref: "A1", rules: [{ type: "cellIs", operator: "greaterThan", formulae: [1], style: { font: { bold: true } } }] });
    });
    const files = unzipSync(bytes); files["xl/vbaProject.bin"] = new Uint8Array([1, 2, 3]);
    const info = inspectSpreadsheetBytes(zipSync(files));
    const keys = info.features.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["macros", "validation", "conditional"]));
  });
  it("a clean workbook has no features and no sentence", async () => {
    const bytes = await build((wb) => { wb.addWorksheet("S").getCell("A1").value = 1; });
    expect(inspectSpreadsheetBytes(bytes).features).toEqual([]);
    expect(describeUnsupported([])).toBe("");
  });
  it("describeUnsupported joins a list in plain words", () => {
    expect(describeUnsupported([{ label: "1 chart" }])).toBe("This file also contains 1 chart, which Spreadsheet can't show or keep.");
    expect(describeUnsupported([{ label: "1 chart" }, { label: "2 macros" }, { label: "3 pictures" }])).toContain("1 chart, 2 macros and 3 pictures");
  });
});

describe("files that are not what they claim", () => {
  it("a text file renamed .xlsx is refused by name with no dependency jargon", async () => {
    const err = await expectRejects(parseSpreadsheetFile(new TextEncoder().encode("just some words, not a workbook"), "fake.xlsx"), "corrupt", "fake.xlsx");
    expect(err.message).not.toMatch(/zip|jszip|central directory/i);
  });
  it("a PDF is refused as the wrong type, saying what to use instead", async () => {
    await expectRejects(parseSpreadsheetFile(new TextEncoder().encode("%PDF-1.7"), "plan.pdf"), "not-spreadsheet", "plan.pdf");
  });
  it("a file over the open ceiling is refused by name and says it is safe in the Library", async () => {
    const big = new Uint8Array(MAX_OPEN_BYTES + 1);
    const err = await expectRejects(parseSpreadsheetFile(big, "huge.xlsx"), "too-big", "huge.xlsx");
    expect(err.message).toMatch(/Library/);
  });
});
