/* Model workspace — wires the sheet data model to the shared formula engine
 * (src/shared/formula/formula.js). Imported DIRECTLY, no mirror/copy, per the build brief.
 *
 * THE ENGINE'S ACTUAL SHAPE, measured against this file rather than assumed: it has no A1 /
 * cell-reference syntax at all — a formula reads OTHER COLUMNS IN THE SAME ROW by name in
 * brackets ([Revenue] - [Cost]) via ctx.columns, and a whole-column aggregate (SUM([Cost]))
 * reads ctx.rows, an array of every row's column-map, shared BY REFERENCE across one recompute
 * pass so the engine's own row-invariant memoization (formula.js's rngResultCache/colArrayCache)
 * actually fires. A formula is typed WITHOUT a leading "=" at the engine boundary; this module
 * adds that convention at the UI edge (sheetModel.js stores the column's formula WITH its "="
 * so the formula bar round-trips verbatim) and strips it once, here, before calling the engine.
 *
 * FORMULAS ARE PER-COLUMN (see sheetModel.js's header for why), which is what lets this file
 * evaluate a whole sheet in ONE pass, column-by-column in dependency order
 * (planFormulaColumns — the exact function the Schedule module's computeFormulaValues uses),
 * rather than needing a two-pass or per-row fixed-point trick: by the time a column that
 * depends on another formula column is evaluated, that other column has ALREADY been computed
 * for every row, so an aggregate over it sees real numbers, not placeholders. This is a direct
 * port of computeFormulaValues' shape (public/sequence/index.html:3811) to a plain columns x
 * rows grid instead of a task tree — no ADD to the engine, no fork of it.
 */
import {
  evaluateFormula, formatValue, planFormulaColumns, errVal, BLANK, DEFAULT_CALENDAR,
} from "../../../shared/formula/formula.js";

const lower = (s) => String(s || "").trim().toLowerCase();

/** Strip the UI-convention leading "=" a column's stored formula carries. */
export const formulaSource = (formulaText) => String(formulaText || "").replace(/^=\s*/, "");

/** A number the way a person types it, coerced to the engine's typed-value model:
 *  "$1,000" / "1,000" -> 1000, "12%" -> 0.12, "TRUE"/"FALSE" -> boolean, "" -> BLANK, else text.
 *  This is INPUT coercion only — how a computed value later DISPLAYS is formatValue's job
 *  (numberFormat), which this never anticipates or auto-applies. */
export function literalTypedValue(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return BLANK;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  let t = s, pct = false;
  if (t.endsWith("%")) { pct = true; t = t.slice(0, -1).trim(); }
  t = t.replace(/^\$\s*/, "").replace(/,/g, "");
  if (t !== "" && Number.isFinite(Number(t)) && /^-?(\d+(\.\d+)?|\.\d+)$/.test(t)) {
    const n = Number(t);
    return pct ? n / 100 : n;
  }
  return s;
}

/** Evaluate every formula column of a sheet, once, for every row. Returns { get(colId, row) }
 *  — null for a cell the pass never wrote (a plain column, or a row past rowCount asked for
 *  a formula column's blank padding — sheetEngine only computes sheet.rowCount real rows). */
export function evaluateSheet(sheet) {
  const rows = sheet.rowCount;
  const cols = sheet.columns;
  const formulaCols = cols.filter((c) => c.formula);
  const results = new Map(); // "colId:row" -> {ok, value, error, detail}
  if (!formulaCols.length || !rows) return { get: (colId, r) => results.get(`${colId}:${r}`) || null };

  const nameToKey = (name) => {
    const hit = cols.find((c) => lower(c.name) === lower(name));
    return hit ? hit.id : null;
  };
  const plan = planFormulaColumns(
    formulaCols.map((c) => ({ key: c.id, formula: formulaSource(c.formula) })),
    nameToKey,
  );

  // One context object PER ROW, seeded from every PLAIN column's typed value. Formula columns
  // are filled in below, column by column in `plan.order` — by construction every column a
  // later one depends on is already resolved for every row before that later one runs.
  const rowMaps = Array.from({ length: rows }, (_, r) => {
    const m = {};
    for (const c of cols) if (!c.formula) m[lower(c.name)] = literalTypedValue(sheet.cells[`${c.id}:${r}`]);
    return m;
  });

  const byKey = new Map(formulaCols.map((c) => [c.id, c]));
  const today = Math.floor(Date.now() / 86400000);

  for (const key of plan.order) {
    const col = byKey.get(key);
    const nameKey = lower(col.name);
    const src = formulaSource(col.formula);
    const parseErr = plan.parseError.get(key);
    const cyclic = plan.cyclic.has(key);
    for (let r = 0; r < rows; r++) {
      let res;
      if (parseErr) res = { ok: false, error: "#ERROR!", detail: parseErr };
      else if (cyclic) res = { ok: false, error: "#CIRC!", detail: "circular reference between formula columns" };
      else res = evaluateFormula(src, { columns: rowMaps[r], rows: rowMaps, rowIndex: r, calendar: DEFAULT_CALENDAR, today });
      // Store as an ERROR VALUE (never BLANK) so a downstream SUM/COUNT over this column
      // PROPAGATES the error instead of silently treating an errored row as empty.
      rowMaps[r][nameKey] = res.ok ? res.value : errVal(res.error);
      results.set(`${key}:${r}`, res);
    }
  }
  return { get: (colId, r) => results.get(`${colId}:${r}`) || null };
}

/** What the cell actually shows — a formula's computed, formatted value; a plain cell's raw
 *  text, run through the column's number format if it parses as a number. */
export function displayFor(sheet, evalResult, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return "";
  if (col.formula) {
    const r = evalResult.get(col.id, rowIndex);
    if (!r) return "";
    return r.ok ? formatValue(r.value, { numberFormat: col.format }) : r.error;
  }
  const raw = sheet.cells[`${col.id}:${rowIndex}`] ?? "";
  if (raw === "") return "";
  const v = literalTypedValue(raw);
  return typeof v === "number" && col.format ? formatValue(v, { numberFormat: col.format }) : raw;
}

/** The formula-bar text for the active cell: the column's formula verbatim (with its "="),
 *  or the cell's raw typed text. Never the DISPLAYED/formatted value — the brief is explicit
 *  that the formula bar shows the underlying formula, not what the cell shows on screen. */
export function formulaBarText(sheet, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return "";
  if (col.formula) return col.formula;
  return sheet.cells[`${col.id}:${rowIndex}`] ?? "";
}
