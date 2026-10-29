/* Spreadsheet file reader — bytes + a file name in, a Planyr workbook + an honest list of what did
 * NOT carry over out (NEW-1, "open an uploaded Excel in Spreadsheet").
 *
 * This is the ONE entry point for turning a user's file into a workbook, whichever door it came
 * through (a Library row, the Spreadsheet's own "Open file…"). It runs inside the parse Web Worker
 * (`spreadsheetWorker.js`) so the main thread never freezes on a big file, and falls back to the
 * main thread only where no Worker exists. It owns NO parser of its own:
 *   · .xlsx / .xlsm → lib/xlsxIO.js (ExcelJS) — the parser the Spreadsheet's File ▸ Import already uses
 *   · .xls (old BIFF)  → SheetJS (`xlsx`, already a dependency) converts it to .xlsx bytes, then the
 *                        SAME xlsxIO path reads it. SheetJS Community Edition does not read cell
 *                        styles out of .xls, so bold/fills are not carried for that one format — the
 *                        banner says so.
 *   · .csv             → lib/csvIO.js (the module's own reader) as a one-sheet workbook
 *
 * Every failure is a `SpreadsheetFileError` whose message names the FILE and says what to do — a
 * dependency's own message is never shown (the NEW-2 / owner-chat-block rule xlsxIO.js states).
 */
import { inspectSpreadsheetBytes, describeUnsupported, stripNonCellParts } from "./xlsxInspect.js";
import { importXlsxToWorkbook } from "./xlsxIO.js";
import { parseCsv, csvRowsToSheet } from "./csvIO.js";
import { migrateWorkbook } from "./sheetModel.js";
import { SpreadsheetFileError, spreadsheetKindOf, isSpreadsheetName, savesInPlace, xlsxNameFor } from "./spreadsheetKind.js";
// Static (not a dynamic import): this module runs inside a Vite IIFE worker, which cannot
// code-split. SheetJS therefore lives in the worker's own bundle — fetched only when a file is
// actually parsed, never by the Spreadsheet's eager chunk.
import * as XLSX from "xlsx";

/** Same ceiling the Word/text editor and the Library's "large file" flag use (reviewStore.MAX_BYTES,
 *  50 MB) — no new limit is invented; a test pins the two together. Uploading is NOT capped (the
 *  Library accepts any size); only OPENING one in the in-browser grid is. */
export const MAX_OPEN_BYTES = 50 * 1024 * 1024;

export { SpreadsheetFileError, spreadsheetKindOf, isSpreadsheetName, savesInPlace, xlsxNameFor };

const q = (name) => `“${name || "this file"}”`;

function decodeCsv(u8) {
  let start = 0;
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) start = 3; // UTF-8 BOM
  const body = start ? u8.subarray(start) : u8;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch (_) { return new TextDecoder("windows-1252").decode(body); } // an Excel "CSV (Comma delimited)" save
}

function xlsToXlsxBytes(u8, fileName) {
  try {
    const wb = XLSX.read(u8, { type: "array", cellDates: true, cellNF: true, cellFormula: true });
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) // no cellDates: it would write ISO t="d" cells, which ExcelJS misreads as the number 2024;
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/password|encrypt/i.test(msg)) throw passwordError(fileName);
    console.error("spreadsheetFile: .xls conversion failed", e);
    throw new SpreadsheetFileError("corrupt", `${q(fileName)} couldn’t be read as an Excel file. It may be damaged — try opening it in Excel and saving it as .xlsx, then upload that.`);
  }
}

const passwordError = (fileName) => new SpreadsheetFileError(
  "encrypted",
  `${q(fileName)} is password-protected, so Planyr can’t open it. In Excel choose File ▸ Info ▸ Protect Workbook ▸ Encrypt with Password, clear the password, save, and upload the file again.`,
);

/** Parse a spreadsheet file. Resolves
 *    { workbook, kind, notes: [{ key, text }], unsupportedCount }
 *  `notes` is the "what did not carry over" list — empty when the file came across whole. Rejects with a
 *  SpreadsheetFileError (code: encrypted | not-spreadsheet | too-big | empty | corrupt). */
export async function parseSpreadsheetFile(bytes, fileName) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kind = spreadsheetKindOf(fileName);
  if (!u8.length) throw new SpreadsheetFileError("empty", `${q(fileName)} is empty (0 bytes), so there is nothing to open.`);
  if (u8.length > MAX_OPEN_BYTES) {
    throw new SpreadsheetFileError("too-big", `${q(fileName)} is ${(u8.length / 1048576).toFixed(0)} MB, more than the ${Math.round(MAX_OPEN_BYTES / 1048576)} MB the in-browser spreadsheet can open. It is safe in your Library — download it to use it in Excel.`);
  }

  if (kind === "csv") {
    const rows = parseCsv(decodeCsv(u8));
    if (!rows.length) throw new SpreadsheetFileError("empty", `${q(fileName)} has no rows in it, so there is nothing to open.`);
    const name = String(fileName || "Sheet1").replace(/\.csv$/i, "").slice(0, 31) || "Sheet1";
    const workbook = migrateWorkbook({ sheets: [{ id: "sheet1", name, sheet: csvRowsToSheet(rows) }], activeSheetId: "sheet1" });
    return { workbook, kind, notes: [{ key: "csv", text: "A CSV file has no formulas, formatting or extra tabs — it opens as one plain sheet." }], unsupportedCount: 0 };
  }

  if (!kind) throw new SpreadsheetFileError("not-spreadsheet", `${q(fileName)} isn’t an Excel or CSV file, so Spreadsheet can’t open it. Use a .xlsx, .xls or .csv file.`);

  const info = inspectSpreadsheetBytes(u8);
  if (info.encrypted) throw passwordError(fileName);
  if (info.tooBig) throw new SpreadsheetFileError("too-big", `${q(fileName)} expands to more than Spreadsheet can safely open. It is safe in your Library — download it to use it in Excel.`);

  let xlsxBytes = u8;
  const notes = [];
  if (info.kind === "cfb") {
    // A real old-format workbook (whatever its extension says).
    xlsxBytes = xlsToXlsxBytes(u8, fileName);
    notes.push({ key: "xls", text: "This is an old-format Excel (.xls) file. Values, formulas, number formats and merged cells came across; cell colours and bold/italic did not." });
  } else if (info.kind !== "zip") {
    throw new SpreadsheetFileError("corrupt", `${q(fileName)} doesn’t look like a valid Excel file. Make sure it opens correctly in Excel, then upload it again.`);
  } else {
    const sentence = describeUnsupported(info.features);
    if (sentence) notes.push({ key: "unsupported", text: sentence });
    if (kind === "xlsm" || info.features.some((f) => f.key === "macros")) {
      // the macros line is already inside `sentence`; this one says what happens on save
      notes.push({ key: "macros-save", text: "Macros are not run or kept in the edited copy." });
    }
  }

  let parsed;
  try {
    try { parsed = await importXlsxToWorkbook(xlsxBytes); }
    catch (first) {
      // ExcelJS throws on some perfectly good workbooks that carry a chart/drawing. Retry once on a
      // parse-only copy without those parts (the original is never touched); if that is no better,
      // the first failure is the honest one.
      const stripped = stripNonCellParts(xlsxBytes);
      if (!stripped) throw first;
      try { parsed = await importXlsxToWorkbook(stripped); } catch (_) { throw first; }
    }
  } catch (e) {
    if (e && /no worksheets/i.test(e.message || "")) throw new SpreadsheetFileError("empty", `${q(fileName)} has no sheets in it, so there is nothing to open.`);
    throw new SpreadsheetFileError("corrupt", `${q(fileName)} doesn’t look like a valid Excel file. Make sure it opens correctly in Excel, then upload it again.`);
  }

  if (parsed.unsupportedCount > 0) {
    notes.push({ key: "formulas", text: `${parsed.unsupportedCount} formula${parsed.unsupportedCount === 1 ? "" : "s"} use a function Spreadsheet doesn’t have yet; they show the value Excel last saved (hover the marked cells).` });
  }
  if (parsed.blockMerges > 0) {
    notes.push({ key: "merges", text: `${parsed.blockMerges} merged block${parsed.blockMerges === 1 ? "" : "s"} spanning several rows show unmerged; their text is kept.` });
  }
  if (parsed.hiddenSheets > 0) {
    notes.push({ key: "hidden", text: `${parsed.hiddenSheets} hidden sheet${parsed.hiddenSheets === 1 ? "" : "s"} show as normal tabs.` });
  }
  return { workbook: parsed.workbook, kind, notes, unsupportedCount: parsed.unsupportedCount };
}
