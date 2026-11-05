/* Univer's formula engine, run in a Web Worker (NEW-1, B2587264 — docs/SPREADSHEET-UNIVER-SPIKE.md cutover step 4).
 *
 * WHY. Measured on a 1,000-row sheet with a formula per row: about half of the time from navigation to a finished grid was the
 * formula engine calculating ON THE PAGE'S MAIN THREAD — long tasks during which the grid could not be scrolled or typed in.
 * Univer's sheets-core preset supports a worker for exactly this: the main thread keeps the grid, the editor and the formula
 * BAR (function help, reference highlighting), and hands the calculation to this file; results come back as ordinary
 * Univer mutations, so the rest of the grid cannot tell the difference. Same import discipline as lib/spreadsheetWorker.js:
 * this file may import ONLY the two Univer worker entry points below — anything that touches the DOM, React or Supabase crashes
 * at WORKER RUNTIME, not at build time. Pinned by the repo-root `test/` suite **modelUniverWorker**.
 *
 * Open-source @univerjs/* only; no network, no Univer host. Started by UniverSheet.jsx, which passes the Worker to the preset. */
import { Univer, LogLevel } from "@univerjs/core";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";

const univer = new Univer({ logLevel: LogLevel.WARN });
for (const plugin of UniverSheetsCoreWorkerPreset().plugins) {
  const [ctor, config] = Array.isArray(plugin) ? plugin : [plugin];
  univer.registerPlugin(ctor, config);
}
