/* Test helper (NEW-1): the Excel writer no longer has an evaluator of its own — the caller hands it Univer's answer. This is the same two
 * calls the app makes (lib/spreadsheetClient.js exportWorkbookInWorker), without the Web Worker. */
import { exportWorkbookToXlsxBlob } from "../../../src/workspaces/model/lib/xlsxIO.js";
import { evaluateForExport } from "../../../src/workspaces/model/lib/univerEval.js";

export async function exportViaUniver(workbook, { projectNames } = {}) {
  const evaluated = await evaluateForExport(workbook, { projectNames });
  return exportWorkbookToXlsxBlob(evaluated.workbook, { projectNames, evaluated });
}
