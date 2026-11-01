/* Main-thread half of the spreadsheet worker (NEW-1). `parseSpreadsheetInWorker` and
 * `exportWorkbookInWorker` post a job to lib/spreadsheetWorker.js and resolve its answer; every
 * failure — a worker that crashes or can't start, a job that never answers — REJECTS with a
 * SpreadsheetFileError that says what happened in plain words, so the caller always shows a message and
 * never a blank grid or a spinner that doesn't end.
 *
 * There is deliberately NO main-thread fallback: it would drag a second copy of ExcelJS and SheetJS
 * into the bundle for a browser that cannot exist (every browser Planyr supports has Web Workers).
 * The worker module is imported lazily, so none of it rides the Spreadsheet's eager chunk. */
import { SpreadsheetFileError } from "./spreadsheetKind.js";

let worker = null, seq = 0;
const pending = new Map();

async function getWorker() {
  if (worker) return worker;
  if (typeof Worker === "undefined") throw new Error("no Worker");
  const { default: SpreadsheetWorker } = await import("./spreadsheetWorker.js?worker");
  worker = new SpreadsheetWorker();
  worker.onmessage = (e) => {
    const d = e.data || {};
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    p.resolve(d);
  };
  worker.onerror = (e) => {
    // A crashed worker stays crashed — reject everything in flight and rebuild on the next call.
    pending.forEach((p) => p.reject(new Error(`the reader stopped${e && e.message ? `: ${e.message}` : ""}`)));
    pending.clear();
    try { worker.terminate(); } catch (_) { /* already gone */ }
    worker = null;
  };
  return worker;
}

const GIVE_UP_MS = 90000;

async function run(message, transfer, { label, timeoutMs = GIVE_UP_MS }) {
  let w;
  try { w = await getWorker(); } catch (e) {
    console.error("spreadsheetClient: could not start the spreadsheet worker", e);
    throw new SpreadsheetFileError("worker", `Your browser couldn’t start the spreadsheet reader, so ${label} wasn’t handled. Try reloading the page.`);
  }
  const id = ++seq;
  const d = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new SpreadsheetFileError("timeout", `${label} is taking too long, so Spreadsheet stopped. Your file is safe in your Library — try again, or download it to use it in Excel.`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (err) => { clearTimeout(timer); reject(new SpreadsheetFileError("corrupt", `${label} couldn’t be handled (${(err && err.message) || "the reader stopped"}). Try again, or download it to use it in Excel.`)); },
    });
    w.postMessage({ id, ...message }, transfer);
  });
  if (!d.ok) throw new SpreadsheetFileError(d.code || "corrupt", d.error);
  return d;
}

/** bytes + file name -> { workbook, kind, notes, unsupportedCount } (see lib/spreadsheetFile.js). */
export async function parseSpreadsheetInWorker(buffer, fileName, opts = {}) {
  const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const d = await run({ op: "parse", name: fileName, buffer: ab }, [ab], { label: `“${fileName}”`, ...opts });
  return { workbook: d.workbook, kind: d.kind, notes: d.notes || [], unsupportedCount: d.unsupportedCount || 0 };
}

/** A Planyr workbook -> a real .xlsx Blob (formulas as formulas, formats, merges, widths, freeze panes). */
export async function exportWorkbookInWorker(workbook, { projectNames, evaluated, ...opts } = {}) {
  // NEW-1 — the cached values in the file come from Univer's engine, run HERE on the main thread (the worker never imports Univer);
  // the answer is plain data and rides along with the workbook it was computed for.
  const ev = evaluated || await (await import("./univerEval.js")).evaluateForExport(workbook, { projectNames });
  const d = await run({ op: "export", workbook: ev.workbook, projectNames: projectNames || null, evaluated: { workbook: ev.workbook, values: ev.values } }, [], { label: "The Excel download", ...opts });
  return d.blob;
}
