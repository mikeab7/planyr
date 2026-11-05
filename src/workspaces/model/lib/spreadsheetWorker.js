/* Spreadsheet-file Web Worker (NEW-1, "open an uploaded Excel in Spreadsheet"). ALL the heavy xlsx
 * work runs here — unzipping, ExcelJS's XML parse and write, SheetJS's .xls conversion — so a big
 * workbook never freezes the tab (the standing "heavy parsing off the main thread" rule), and so
 * ExcelJS lives in exactly ONE lazy bundle (this one) instead of one for the worker and another for
 * the File menu.
 *
 * ⚠ IMPORT DISCIPLINE: this file may import ONLY lib/spreadsheetFile.js (parse) and lib/xlsxIO.js
 * (export). Anything that touches the DOM, React or Supabase crashes at WORKER RUNTIME, not build time —
 * test/spreadsheetFileWiring.test.js pins the whole reachable import graph.
 *
 * Protocol:
 *   in:  { id, op:"parse",  name, buffer }                (buffer is TRANSFERRED, not copied)
 *        { id, op:"export", workbook, projectNames, evaluated }   (evaluated = { workbook, values } from univerEval.evaluateForExport — computed on the MAIN thread; this worker never imports Univer)
 *   out: { id, ok:true, workbook, kind, notes, unsupportedCount }   (parse)
 *        { id, ok:true, blob }                                     (export)
 *   or   { id, ok:false, code, error }                              (LOUD — the client rejects with `error` verbatim) */
import { parseSpreadsheetFile } from "./spreadsheetFile.js";
import { exportWorkbookToXlsxBlob } from "./xlsxIO.js";

self.onmessage = async (e) => {
  const { id, op, name, buffer, workbook, projectNames, evaluated } = e.data || {};
  try {
    if (op === "export") {
      const blob = await exportWorkbookToXlsxBlob(workbook, { projectNames, evaluated });
      self.postMessage({ id, ok: true, blob });
      return;
    }
    const out = await parseSpreadsheetFile(buffer, name);
    self.postMessage({ id, ok: true, ...out });
  } catch (err) {
    self.postMessage({ id, ok: false, code: (err && err.code) || "corrupt", error: String((err && err.message) || err) });
  }
};
