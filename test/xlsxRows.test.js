import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { countyRowsFromXlsx, streamXlsxRows, zipEntries } from "../functions/api/lib/xlsxRows.js";
import { extractCountyRows } from "../functions/api/lib/comptrollerRates.js";

// B2158064 — the streaming reader must agree with SheetJS (the reader it replaces) on a real
// .xlsx container (zip + shared strings + numbers + empty cells), and keep only the wanted county.
const HEADER = ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "SPECIAL DISTRICT NAME", "SPLIT", "VERSION NAME", "VERSION DATE", "TOTAL TAX RATE"];
const aoa = [
  ["SPECIAL DISTRICT RATES AND LEVIES"], ["2025 REPORT"], HEADER,
  [101, "Harris", "101", "Harris", "a", "Harris County Hospital District & Co <x>", "", "Working", "01/28/2026", 0.18761],
  [102, "Fort Bend", "102", "Fort Bend", "b", "Fort Bend ESD 1", "X", "Working", "01/28/2026", 0.1],
  [101, "Harris", "101", "Harris", "c", "HC Emerg Srv Dist 14", "X", "Working", "01/28/2026", 0.085],
];
const wbBytes = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Detail");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", bookSST: true, compression: true }));
};

describe("xlsxRows", () => {
  it("lists the zip entries of a real workbook", () => {
    expect(Object.keys(zipEntries(wbBytes()))).toContain("xl/sharedStrings.xml");
  });
  it("streams every row identically to SheetJS", async () => {
    const bytes = wbBytes();
    const ws = XLSX.read(bytes, { type: "array" });
    const want = XLSX.utils.sheet_to_json(ws.Sheets[ws.SheetNames[0]], { header: 1, raw: true });
    const got = [];
    await streamXlsxRows(bytes, (r) => got.push(r));
    expect(got.length).toBe(want.length);
    got.forEach((r, i) => want[i].forEach((v, j) => expect(r[j]).toBe(v)));
  });
  it("keeps head rows + only the wanted county, and the pure extractor reads unit names off it", async () => {
    const kept = await countyRowsFromXlsx(wbBytes(), "harris");
    expect(kept.length).toBe(aoa.length); // 6 rows total, head window covers all; county filter exercised below
    const big = await countyRowsFromXlsx(wbBytes(), "harris", 3);
    expect(big.length).toBe(3 + 2); // title, title, header + the two Harris rows
    const ex = extractCountyRows(big, "Harris");
    expect(ex.rows.map((r) => r.name)).toEqual(["Harris County Hospital District & Co <x>", "HC Emerg Srv Dist 14"]);
    expect(ex.rows.map((r) => r.rate)).toEqual([0.18761, 0.085]);
  });
  it("rejects non-xlsx bytes loudly", async () => {
    await expect(streamXlsxRows(new Uint8Array([1, 2, 3, 4]), () => {})).rejects.toThrow(/zip/);
  });
});
