/* Spreadsheet file KIND helpers — deliberately tiny and dependency-free (NEW-1).
 *
 * The Shell (to route a clicked Library row), the Library, the Spreadsheet module's chunk and the
 * parse worker all need to ask "is this name a spreadsheet?" and "does it save in place?". They must
 * be able to do that WITHOUT pulling ExcelJS / SheetJS (lib/spreadsheetFile.js owns those and is only
 * ever loaded inside the parse worker), so the answers live here.
 */

export class SpreadsheetFileError extends Error {
  constructor(code, message) { super(message); this.name = "SpreadsheetFileError"; this.code = code; }
}

/** The file's kind from its NAME ("xlsx" | "xlsm" | "xls" | "csv" | null). */
export function spreadsheetKindOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || "").trim());
  const ext = m ? m[1].toLowerCase() : "";
  return ["xlsx", "xlsm", "xls", "csv"].includes(ext) ? ext : null;
}
export const isSpreadsheetName = (name) => spreadsheetKindOf(name) !== null;

/** Does saving edits back keep the file's own format? Only a real .xlsx can be written back in place
 *  (as a new version, the original kept). .xls / .xlsm / .csv would lose formatting, macros or
 *  formulas if overwritten, so their edits go to a NEW .xlsx next to the original (see fileWorkbook.js). */
export const savesInPlace = (name) => spreadsheetKindOf(name) === "xlsx";

/** "Budget.xls" -> "Budget.xlsx"; a name with no known extension just gets ".xlsx". */
export function xlsxNameFor(name) {
  const base = String(name || "Workbook").replace(/\.[A-Za-z0-9]+$/, "") || "Workbook";
  return `${base}.xlsx`;
}

