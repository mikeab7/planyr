/* Model workspace — CSV round-trip (NEW-1, owner chat block). Deliberately the LESSER path: a
 * plain values-only single table, never the default/primary action next to the real .xlsx
 * round-trip (lib/xlsxIO.js) — see FileMenu.jsx for how the two are ordered in the UI.
 *
 * EXPORT writes the ACTIVE SHEET's DISPLAYED values — formulas already computed, numbers
 * already run through their own number format — never formula text, matching what "values-
 * only CSV" means and what a person opening the file in a spreadsheet expects to see (a CSV has
 * no concept of a formula at all). IMPORT reads a CSV as a single NEW SHEET appended to the
 * open workbook (never replaces it, unlike an .xlsx import) — a CSV is inherently one flat
 * table, not "the user's whole model."
 *
 * Hand-rolled RFC4180-ish encode/decode rather than pulling ExcelJS in for this: a values-only
 * single table needs no library at all, and keeping this file dependency-free means a user who
 * only ever touches CSV never pays for the (lazy) .xlsx chunk either.
 */
import { SHEET_VERSION, migrateSheet, colLetterName, addSheetWithContent } from "./sheetModel.js";
import { displayFor } from "./sheetEngine.js";

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The ACTIVE sheet's displayed values as CSV text. Trims to the sheet's own used range (a
 *  blank 1000×26 canvas must not export as 26,000 empty commas) — "used" here means "displays
 *  something," so a formatted-but-empty cell (a fill color with no value) correctly contributes
 *  nothing, matching what a person actually sees as "the data." `evalResultForSheet` is the
 *  same per-sheet eval result ModelApp/SheetView already compute every render — passed in
 *  rather than recomputed here. */
export function sheetToCsv(sheet, evalResultForSheet) {
  let maxRow = -1, maxCol = -1;
  for (let r = 0; r < sheet.rowCount; r++) {
    for (let c = 0; c < sheet.columns.length; c++) {
      if (displayFor(sheet, evalResultForSheet, r, c) !== "") { maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c); }
    }
  }
  if (maxRow < 0) return "";
  const lines = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) row.push(csvEscape(displayFor(sheet, evalResultForSheet, r, c)));
    lines.push(row.join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** A minimal RFC4180 reader: quoted fields (embedded commas/newlines/escaped `""`), bare
 *  fields, `\r\n` or bare `\n` line endings. Returns rows of string cells — never types them
 *  (that's `csvRowsToSheet`'s job, reusing the SAME per-cell literal typing every other cell
 *  commit in this app goes through, via the stored raw text). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r") { /* the matching \n (or EOF) closes the row */ }
    else if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // A trailing newline produces one wholly-blank final row — drop it, it isn't data.
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

/** Parsed CSV rows -> a real Planyr sheet (via `migrateSheet`, same entry point every other
 *  foreign blob in this module reads through — floors row/column capacity, defaults every
 *  newer field). Columns are plain lettered (A, B, C…), never named from the CSV's own first
 *  row — a header row lands as ordinary row-1 DATA like any other row (the scope guard: this
 *  moves the user's own cells, it invents no column identity of its own). */
export function csvRowsToSheet(rows) {
  const numCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const columns = Array.from({ length: numCols }, (_, i) => ({ id: `c${i + 1}`, name: colLetterName(i), width: 120 }));
  const cells = {};
  rows.forEach((row, r) => {
    row.forEach((val, c) => { if (val !== "") cells[`c${c + 1}:${r}`] = val; });
  });
  const raw = {
    version: SHEET_VERSION, nextColId: numCols + 1, columns, rowCount: rows.length,
    cells, formats: {}, styles: {}, rowHeights: {}, freezeRows: 0, freezeCols: 0, merges: [],
    names: {}, dismissedInconsistencies: {}, unsupportedFormulas: {},
  };
  return migrateSheet(raw);
}

/** Import a CSV as a brand-new sheet appended to the open workbook (never replaces it — see the
 *  file header). `desiredName` is usually the dropped file's own name, minus its extension. */
export function addSheetFromCsvText(workbook, csvText, desiredName) {
  const sheet = csvRowsToSheet(parseCsv(csvText));
  return addSheetWithContent(workbook, desiredName, sheet);
}
