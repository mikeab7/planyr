/* Model workspace — THE formula evaluator: Univer's engine, run headless (NEW-1, cutover step 7 of
 * docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * ONE SOURCE OF TRUTH FOR COMPUTED VALUES. The grid the person sees is Univer's, so every other reader of a
 * computed value (the Excel export, the CSV export, the audits, the live-data names) asks THIS module instead of
 * Planyr's own older engine (src/shared/formula/formula.js + lib/sheetEngine.js, which is deprecated and kept
 * only as the reference the differential tests compare against). It builds the SAME Univer workbook the grid
 * mounts (`workbookToUniver` + the project names as defined names), lets Univer's formula engine calculate it with
 * no screen at all, and hands the numbers back in the SHAPE the old evaluator returned —
 * `result.get(sheetId).get(row, col) → { ok, value, error, detail } | null` — so `displayFor`, the CSV writer and the
 * export need no change beyond where the numbers come from.
 *
 * LAZY BY DESIGN: this is the only non-grid module that imports @univerjs/*, and every caller reaches it through a
 * dynamic `import()` (a first export downloads the engine; nothing eager does). Same exact pin as the grid (1.3.1),
 * open-source packages only, no network, no licence key.
 *
 * `[Column]` references: Univer cannot read them. They are rewritten to plain cell references by
 * lib/planyrSyntax.js BEFORE the workbook reaches Univer (in memory here; on load in the grid, with a visible note).
 *
 * Planyr-only functions (those the older engine had and Univer does not — see CUSTOM_FUNCTIONS below) are registered
 * as custom functions on the headless instance, and on the grid's instance by `registerPlanyrFunctions`. */
import { Univer, LocaleType, UniverInstanceType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets/facade";
import { UniverFormulaEnginePlugin, IFormulaRuntimeService } from "@univerjs/engine-formula";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin, CalculationMode } from "@univerjs/sheets-formula";
import { migrateWorkbook } from "./sheetModel.js";
import { workbookToUniver, projectNamesToDefinedNames } from "./univerBridge.js";
import { migratePlanyrSyntaxInWorkbook } from "./planyrSyntax.js";
import { BLANK, makeDate } from "../../../shared/formula/formula.js";
import { evalToPlain } from "./evalValues.js";

const DEFINED_NAME_RESOURCE = "SHEET_DEFINED_NAME_PLUGIN";
/** Days between Excel's serial epoch (1899-12-30) and the Unix epoch — Planyr's older engine counted days from 1970. */
const EXCEL_TO_UNIX_DAYS = 25569;
const T_STRING = 1, T_NUMBER = 2, T_BOOL = 3;
/** Univer's own error strings (engine-formula `ErrorType`). A formula result is an error only when it is one of these
 *  AND Univer typed it as an ordinary string (t = 1) — a formula that returns the TEXT "#N/A" is typed t = 4. */
const ERROR_CODES = new Set(["#DIV/0!", "#NAME?", "#VALUE!", "#NUM!", "#N/A", "#CYCLE!", "#REF!", "#SPILL!", "#CALC!", "#ERROR!", "#GETTING_DATA", "#NULL!"]);
const isDatePattern = (p) => typeof p === "string" && /[ymd]{1,4}/i.test(p.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^(0|#|General)/.test(p);

/** One Univer cell result (`{ v, t }` + the engine's own number-format pattern) → the old evaluator's result record. */
export function toEvalRecord(cell, pattern) {
  if (!cell || (cell.v === undefined && cell.t === undefined)) return { ok: true, value: BLANK };
  const { v, t } = cell;
  if (v === undefined || v === null) return { ok: true, value: BLANK };
  if (t === T_BOOL || typeof v === "boolean") return { ok: true, value: v === true || v === 1 || v === "1" || String(v).toUpperCase() === "TRUE" };
  if (typeof v === "number" || t === T_NUMBER) {
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: "#NUM!", detail: "result is not a finite number" };
    if (isDatePattern(pattern) && Number.isInteger(n) && n > 0) return { ok: true, value: makeDate(n - EXCEL_TO_UNIX_DAYS) };
    return { ok: true, value: n };
  }
  const s = String(v);
  if (t === T_STRING && ERROR_CODES.has(s)) return { ok: false, error: s, detail: "" };
  return { ok: true, value: s };
}

/** The workbook exactly as the grid would load it (Planyr → Univer), plus the project names. Pure; used by the headless
 *  evaluation and by the tests that want to inspect what Univer is handed. */
export function univerDataFor(workbookIn, { projectNames } = {}) {
  const { workbook, rewritten } = migratePlanyrSyntaxInWorkbook(migrateWorkbook(workbookIn));
  const { data, sidecar } = workbookToUniver(workbook);
  const defs = projectNamesToDefinedNames(projectNames);
  if (Object.keys(defs).length) {
    const res = data.resources.find((r) => r.name === DEFINED_NAME_RESOURCE);
    if (res) res.data = JSON.stringify({ ...JSON.parse(res.data), ...defs });
    else data.resources.push({ name: DEFINED_NAME_RESOURCE, data: JSON.stringify(defs) });
  }
  return { data, sidecar, workbook, rewritten };
}

const countFormulas = (data) => {
  let n = 0;
  for (const sh of Object.values(data.sheets)) for (const row of Object.values(sh.cellData || {})) for (const c of Object.values(row)) if (c && c.f) n++;
  return n;
};

/**
 * Evaluate every formula of a Planyr workbook with Univer's engine, headless. Resolves to
 * `{ get(sheetId) → { get(row, col) }, rewritten, ms }`; rejects (LOUD-FAILURE) if the engine never reports a result,
 * rather than returning a quietly empty answer.
 */
export async function evaluateWorkbookUniver(workbookIn, { projectNames, timeoutMs = 20000 } = {}) {
  const t0 = Date.now();
  const { data, workbook, rewritten } = univerDataFor(workbookIn, { projectNames });
  const bySheet = new Map();
  const empty = { get: () => null };
  const circular = [];     // cells Univer found in a circular reference (it shows 0 for them, as Excel does — said out loud, never silent)
  const done = { circular, get: (sheetId) => bySheet.get(sheetId) || empty, cellsOf: (sheetId) => (bySheet.get(sheetId) ? bySheet.get(sheetId).cells : new Map()), rewritten, workbook, ms: 0 };
  for (const entry of workbook.sheets) bySheet.set(entry.id, { cells: new Map(), get(r, c) { return this.cells.get(`${r}:${c}`) || null; } });
  if (countFormulas(data) === 0) return done;

  const univer = new Univer({ locale: LocaleType.EN_US });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.FORCED });
    const api = FUniver.newAPI(univer);
    const formula = api.getFormula();
    const patterns = new Map();      // "sheetId:r:c" → the engine's own number-format pattern for a date-returning formula
    const results = new Map();       // "sheetId:r:c" → { v, t }
    let finished = null;
    const finish = new Promise((resolve, reject) => { finished = { resolve, reject }; });
    const timer = setTimeout(() => finished.reject(new Error("Univer's formula engine did not report a result in time")), timeoutMs);
    const sub1 = formula.calculationResultApplied((res) => {
      const unit = res && res.unitData && res.unitData[data.id];
      for (const [sheetId, rows] of Object.entries(unit || {})) for (const [r, cols] of Object.entries(rows)) for (const [c, cell] of Object.entries(cols)) {
        results.set(`${sheetId}:${r}:${c}`, { v: cell.v, t: cell.t });
        const p = cell.s && cell.s.n && cell.s.n.pattern;
        if (p) patterns.set(`${sheetId}:${r}:${c}`, p);
      }
    });
    const sub2 = formula.calculationEnd((state) => { if (state === 3 /* SUCCESS */) setTimeout(() => finished.resolve(), 0); });
    const fWb = api.createWorkbook(data);
    await finish.finally(() => clearTimeout(timer));
    // The snapshot is the authority for a value (the applied message can arrive in pieces); the message supplies the pattern.
    const snap = fWb.save();
    for (const entry of workbook.sheets) {
      const sheet = snap.sheets[entry.id];
      const store = bySheet.get(entry.id);
      for (const [r, row] of Object.entries((sheet && sheet.cellData) || {})) for (const [c, cell] of Object.entries(row)) {
        if (!cell || !cell.f) continue;
        const key = `${entry.id}:${r}:${c}`;
        const fromMsg = results.get(key);
        const cellOut = (cell.v !== undefined || cell.t !== undefined) ? cell : fromMsg;
        store.cells.set(`${r}:${c}`, toEvalRecord(cellOut, patterns.get(key)));
      }
    }
    try {
      const runtime = univer.__getInjector().get(IFormulaRuntimeService);
      for (const c of (runtime.getAllRuntimeData().circularReferences || [])) {
        const entry = workbook.sheets.find((e) => e.id === c.sheetId);
        if (entry) circular.push({ sheetId: c.sheetId, sheetName: entry.name, row: c.row, col: c.column });
      }
    } catch (_) { /* a Univer build without the runtime read: circular cells just are not listed */ }
    sub1.dispose(); sub2.dispose();
  } finally {
    try { univer.dispose(); } catch (_) { /* already gone */ }
  }
  done.ms = Date.now() - t0;
  return done;
}

/** What the Excel / CSV writers need, in one call: the workbook as Univer was handed it (`[Column]` names rewritten) and its computed
 *  values as plain data that can cross into the export worker. */
export async function evaluateForExport(workbook, { projectNames } = {}) {
  const ev = await evaluateWorkbookUniver(workbook, { projectNames });
  const cellsBySheet = {};
  for (const entry of ev.workbook.sheets) cellsBySheet[entry.id] = ev.cellsOf(entry.id);
  return { workbook: ev.workbook, values: evalToPlain(cellsBySheet), rewritten: ev.rewritten, circular: ev.circular, ms: ev.ms };
}
