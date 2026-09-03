/* Model workspace — wires the sheet data model to the shared formula engine
 * (src/shared/formula/formula.js). Imported DIRECTLY, no mirror/copy, per the build brief.
 *
 * ⛔ B891184-FOLLOWUP (live production finding, 2026-08-31): this file used to evaluate
 * FORMULA COLUMNS (one formula, applied identically to every row) because the engine had no
 * cell addressing at all when this module first shipped. A concurrent session has since added
 * real A1-style cell/range references to the SAME engine (commit 0d2d1b3e, merged the same
 * day) — `ctx.grid`, a 2D array where `grid[row-1][col-1]` is that cell. This file now wires
 * that grid from the sheet's own cells, and evaluates a dependency graph across CELLS, not
 * columns, so a formula belongs to the one cell it was typed into — never the whole column.
 *
 * A formula can freely mix BOTH reference systems in one expression (the engine's own header
 * comment says so explicitly): `[Column]` same-row structured refs (unchanged from before —
 * still the only thing the Schedule module uses) AND A1/A1:B10 grid refs. Both are walked by
 * `collectCellDeps` below so the dependency order is correct either way.
 *
 * MEASURED, NOT ASSUMED, that wiring the grid is the WHOLE fix for the "silent zero" defect
 * this replaces: with no grid ever wired, `readGridCell` (formula.js) returns `undefined` for
 * EVERY A1 reference — its own header says this is deliberately never a crash or a #REF!, it
 * reads as BLANK — and a SUM of nothing-but-blanks is a genuine, correct 0. That is exactly
 * the reported defect ("=SUM(B1:B2) with 100/200 in those cells gave 0", "=A1 rendered
 * completely blank"). Once the grid holds real values, both resolve correctly with NO special
 * casing needed — the engine's own #NAME?/#REF! paths (an out-of-bounds address, an unknown
 * [Column] name) already fire for a GENUINELY unresolvable reference; verified live below.
 *
 * A DEPENDENCY-GRAPH SAFETY CHOICE: a `[Column]` reference makes a formula cell depend on
 * EVERY row of that column (not just its own row), even where the engine's own AST shape
 * would let a bare (non-aggregate) `[Column]` read as a same-row scalar. This is deliberately
 * the SAME conservatism the old per-column engine already had (a whole formula column could
 * only run after every column it read was fully computed) — over-depending is always SAFE
 * (never reads a not-yet-computed value), and only risks an occasional over-strict #CIRC! in a
 * contrived case, never a wrong number. An A1 ref/range depends on exactly the cell(s) it
 * names, which the address itself already gives precisely.
 */
import {
  evaluateFormula, formatValue, formatValueColor, parseFormula, errVal, isErrVal, isFormulaError, isBlank, BLANK, isDate,
  DEFAULT_CALENDAR, parseLooseDate, makeDate, colNumToLetters,
} from "../../../shared/formula/formula.js";
import { formatAt, isFormulaText } from "./sheetModel.js";

const lower = (s) => String(s || "").trim().toLowerCase();

/** Strip the UI-convention leading "=" a cell's stored formula text carries. */
export const formulaSource = (formulaText) => String(formulaText || "").replace(/^=\s*/, "");

/** "C4" — the A1 address SheetView's (rowIndex, colIndex) pair names. 1-based, matching the
 *  engine's own address convention (colNumToLetters expects a 1-based column number). */
export const cellAddressText = (rowIndex, colIndex) => `${colNumToLetters(colIndex + 1)}${rowIndex + 1}`;

/** A number/percent/currency/boolean/date the way a person types it, coerced to the engine's
 *  typed-value model. This is INPUT coercion only — how a computed value later DISPLAYS is
 *  formatValue's job (numberFormat), which this never anticipates or auto-applies.
 *
 *  ⛔ B891184-FOLLOWUP: date recognition added (was missing entirely — "1/15/2027" round-
 *  tripped as the plain STRING "1/15/2027", so date arithmetic on a typed date silently failed
 *  with a text-vs-number type error instead of computing a day count). Storage still keeps the
 *  raw text as typed (round-tripping, per the brief) — this is purely how a read of that text
 *  is INTERPRETED for computation, exactly the same layering the number/percent/currency path
 *  already had. */
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
  if (!pct) {
    const serial = parseLooseDate(s);
    if (serial !== null) return makeDate(serial);
  }
  return s;
}

/** The DISPLAY kind of a resolved value — number/date right-align, everything else left-aligns
 *  (item 5). A stable, small vocabulary rather than raw typeof, since a formula error is an
 *  object and a date is an object too. */
export function kindOf(value) {
  if (isFormulaError(value) || isErrVal(value)) return "error";
  if (isBlank(value)) return "blank";
  if (typeof value === "boolean") return "bool";
  if (isDate(value)) return "date";
  if (typeof value === "number") return "number";
  return "text";
}

/** Walk a formula's parsed AST, collecting which CELLS it reads — both reference systems, now
 *  across the WHOLE WORKBOOK (Stage 3, NEW-1). `addDep(sheetId, rowIndex, colIndex)` (0-based)
 *  is called for every cell the formula could possibly read; the caller (evaluateWorkbook) is
 *  responsible for bounds-checking against the TARGET sheet's own dimensions and for deciding
 *  which of those are themselves formula cells (only formula cells need ordering — a literal
 *  is already resolved). `ownerSheetId` is the sheet the FORMULA ITSELF lives on — an
 *  unqualified A1/range reference means "this cell on THAT sheet" (Excel semantics), and a
 *  `[Column]` bracket reference is ALWAYS same-sheet (no cross-sheet bracket syntax exists) so
 *  it resolves against `ownerSheetId` regardless of what a sibling A1 reference in the same
 *  formula names. `colNameToIndex` resolves a `[Column]` bracket name to a column index on the
 *  OWNER sheet, or null for an unknown column (the engine's own #REF! already covers reporting
 *  that at eval time). `resolveSheetId(name)` resolves a qualifier's sheet NAME to its id, or
 *  null if no sheet by that name exists (over-depending on nothing is fine — the eval itself
 *  raises the real #REF! for an unresolvable sheet). `sheetBounds(sheetId)` returns that
 *  sheet's own `{rows, cols}`, needed because a `[Column]`-whole-column dependency has to walk
 *  the OWNER sheet's row count, not whichever sheet a sibling reference in the same formula
 *  might target. */
function collectCellDeps(node, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, addDep) {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "col": {
      const idx = colNameToIndex(node.name);
      const bounds = sheetBounds(ownerSheetId);
      if (idx != null && bounds) for (let r = 0; r < bounds.rows; r++) addDep(ownerSheetId, r, idx);
      return;
    }
    case "ref": {
      const sheetId = node.sheet ? resolveSheetId(node.sheet) : ownerSheetId;
      if (sheetId == null) return; // unresolvable sheet name — nothing to depend on; eval raises #REF!
      addDep(sheetId, node.row - 1, node.col - 1);
      return;
    }
    case "range": {
      const sheetId = node.sheet ? resolveSheetId(node.sheet) : ownerSheetId;
      if (sheetId == null) return;
      const r1 = Math.min(node.from.row, node.to.row) - 1, r2 = Math.max(node.from.row, node.to.row) - 1;
      const c1 = Math.min(node.from.col, node.to.col) - 1, c2 = Math.max(node.from.col, node.to.col) - 1;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) addDep(sheetId, r, c);
      return;
    }
    case "unary":
    case "percent":
      collectCellDeps(node.arg, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, addDep);
      return;
    case "binary":
      collectCellDeps(node.left, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, addDep);
      collectCellDeps(node.right, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, addDep);
      return;
    case "call":
      node.args.forEach((a) => collectCellDeps(a, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, addDep));
      return;
    default:
      return; // num, str, bool, blankLiteral, errLiteral — leaves, no cell deps
  }
}

const EMPTY_SHEET_EVAL = { get: () => null };

/** Evaluate every formula CELL of a WHOLE WORKBOOK, once, in ONE combined dependency order
 *  across every sheet (Stage 3, NEW-1 — cross-sheet references, `SheetName!A1`). This is the
 *  workbook-wide generalization of the single-sheet algorithm below (evaluateSheet): the same
 *  seed-grid / build-deps / topo-sort / evaluate-in-order shape, just keyed by
 *  `sheetId:row:col` instead of `row:col`, so a formula on ANY sheet that reads another
 *  sheet's cell sees that cell's CURRENT (possibly itself formula-computed) value, and a
 *  circular reference that loops THROUGH another sheet is caught exactly like one that stays
 *  on one sheet. Must always evaluate every sheet, even the ones not currently visible — a
 *  hidden sheet's formulas are still live inputs to whichever sheet the user IS looking at.
 *  Returns `{ get(sheetId) }` -> `{ get(rowIndex, colIndex) }` -> `{ok, value, error, detail}
 *  | null`, so `displayFor`/`displayColorFor`/`displayKindFor` below (unchanged, per-sheet)
 *  keep working exactly as before once handed the right sheet's own slice. */
export function evaluateWorkbook(workbook) {
  const entries = workbook.sheets;
  const nameToId = new Map();
  for (const s of entries) nameToId.set(s.name.trim().toLowerCase(), s.id);
  const resolveSheetId = (name) => (nameToId.has(String(name).trim().toLowerCase()) ? nameToId.get(String(name).trim().toLowerCase()) : null);

  const grids = {};          // sheetId -> grid[][]
  const gridsByName = {};    // lowercased sheet name -> the SAME grid[][] object (for ctx.grids)
  const rowMapsBySheet = {}; // sheetId -> rowMaps[]
  const colsBySheet = {};    // sheetId -> columns[]
  const formulaCells = new Map(); // "sheetId:r:c" -> { sheetId, rowIndex, colIndex, src, ast, parseErr }

  for (const s of entries) {
    const sheet = s.sheet;
    const rows = sheet.rowCount;
    const cols = sheet.columns;
    const numCols = cols.length;
    const grid = Array.from({ length: rows }, () => new Array(numCols).fill(BLANK));
    const rowMaps = Array.from({ length: rows }, () => ({}));
    grids[s.id] = grid;
    gridsByName[s.name.trim().toLowerCase()] = grid;
    rowMapsBySheet[s.id] = rowMaps;
    colsBySheet[s.id] = cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < numCols; c++) {
        const col = cols[c];
        const raw = sheet.cells[`${col.id}:${r}`];
        if (raw != null && isFormulaText(raw)) {
          const src = formulaSource(raw);
          const { ast, error, detail } = parseFormula(src);
          formulaCells.set(`${s.id}:${r}:${c}`, { sheetId: s.id, rowIndex: r, colIndex: c, src, ast, parseErr: error ? { error, detail } : null });
        } else {
          const v = literalTypedValue(raw);
          grid[r][c] = v;
          rowMaps[r][lower(col.name)] = v;
        }
      }
    }
  }

  const nameToIndexFor = (sheetId) => {
    const cols = colsBySheet[sheetId] || [];
    return (name) => { const nk = lower(name); const idx = cols.findIndex((c) => lower(c.name) === nk); return idx < 0 ? null : idx; };
  };
  const sheetBounds = (sheetId) => {
    const cols = colsBySheet[sheetId];
    return cols ? { rows: rowMapsBySheet[sheetId].length, cols: cols.length } : null;
  };

  // ⛔ A SELF-REFERENCE MUST STAY IN ITS OWN DEPENDENCY SET — see evaluateSheet's own note
  // below, unchanged reasoning, now over the combined key space.
  const deps = new Map(); // key -> Set<key>
  for (const [key, cell] of formulaCells) {
    const set = new Set();
    if (cell.ast) {
      const colNameToIndex = nameToIndexFor(cell.sheetId);
      collectCellDeps(cell.ast, cell.sheetId, colNameToIndex, resolveSheetId, sheetBounds, (sheetId, r, c) => {
        const bounds = sheetBounds(sheetId);
        if (!bounds || r < 0 || r >= bounds.rows || c < 0 || c >= bounds.cols) return; // off-sheet: nothing to depend on
        const dk = `${sheetId}:${r}:${c}`;
        if (formulaCells.has(dk)) set.add(dk);
      });
    }
    deps.set(key, set);
  }

  // Topological order + cycle detection — 3-color DFS, unchanged shape from evaluateSheet
  // below, now walking the combined sheetId:row:col key space so a cycle THROUGH another
  // sheet is caught exactly like one that never leaves the current sheet.
  const order = [];
  const cyclic = new Set();
  const state = new Map();
  const stack = [];
  const visit = (key) => {
    const st = state.get(key);
    if (st === 2) return;
    if (st === 1) {
      const idx = stack.indexOf(key);
      for (let i = idx; i < stack.length; i++) cyclic.add(stack[i]);
      cyclic.add(key);
      return;
    }
    state.set(key, 1);
    stack.push(key);
    for (const dep of deps.get(key)) visit(dep);
    stack.pop();
    state.set(key, 2);
    order.push(key);
  };
  for (const key of formulaCells.keys()) visit(key);

  const results = new Map(); // "sheetId:r:c" -> {ok, value, error, detail}
  const today = Math.floor(Date.now() / 86400000);
  for (const key of order) {
    const cell = formulaCells.get(key);
    let res;
    if (cell.parseErr) res = { ok: false, error: cell.parseErr.error || "#ERROR!", detail: cell.parseErr.detail };
    else if (cyclic.has(key)) res = { ok: false, error: "#CIRC!", detail: "circular reference between cells" };
    else {
      res = evaluateFormula(cell.src, {
        columns: rowMapsBySheet[cell.sheetId][cell.rowIndex], rows: rowMapsBySheet[cell.sheetId], rowIndex: cell.rowIndex,
        grid: grids[cell.sheetId], grids: gridsByName,
        calendar: DEFAULT_CALENDAR, today,
      });
    }
    const value = res.ok ? res.value : errVal(res.error);
    grids[cell.sheetId][cell.rowIndex][cell.colIndex] = value;
    rowMapsBySheet[cell.sheetId][cell.rowIndex][lower(colsBySheet[cell.sheetId][cell.colIndex].name)] = value;
    results.set(key, res);
  }

  const bySheet = new Map();
  for (const s of entries) bySheet.set(s.id, { get: (rowIndex, colIndex) => results.get(`${s.id}:${rowIndex}:${colIndex}`) || null });
  return { get: (sheetId) => bySheet.get(sheetId) || EMPTY_SHEET_EVAL };
}

/** Evaluate every formula CELL of a SINGLE sheet, once, in dependency order — the ORIGINAL,
 *  single-sheet entry point (unit tests and any future single-sheet caller). Returns
 *  { get(rowIndex, colIndex) } -> {ok, value, error, detail} | null. Implemented as a thin
 *  wrapper over evaluateWorkbook (Stage 3, NEW-1), wrapping `sheet` in an ephemeral one-sheet
 *  workbook — no reference resolution can ever behave differently between the two, because
 *  there is only ever one real algorithm now. */
export function evaluateSheet(sheet) {
  return evaluateWorkbook({ sheets: [{ id: "sheet1", name: "Sheet1", sheet }], activeSheetId: "sheet1" }).get("sheet1");
}

/** What the cell actually shows — a formula's computed, formatted value; a plain cell's raw
 *  text, run through ITS OWN number format if it parses as a number (per-cell — see
 *  sheetModel.js's header on why formatting is no longer a column-level field). */
export function displayFor(sheet, evalResult, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return "";
  const raw = sheet.cells[`${col.id}:${rowIndex}`];
  const format = formatAt(sheet, rowIndex, colIndex);
  if (raw != null && isFormulaText(raw)) {
    const r = evalResult.get(rowIndex, colIndex);
    if (!r) return "";
    return r.ok ? formatValue(r.value, { numberFormat: format }) : r.error;
  }
  if (raw == null || raw === "") return "";
  const v = literalTypedValue(raw);
  return typeof v === "number" && format ? formatValue(v, { numberFormat: format }) : raw;
}

/** The colour a cell's own number format wants for what's currently showing there ([Red] etc —
 *  "negatives in red"), or `null`. Mirrors displayFor's own two branches (formula result vs.
 *  literal) exactly, since the colour has to agree with whichever VALUE actually got formatted. */
export function displayColorFor(sheet, evalResult, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return null;
  const raw = sheet.cells[`${col.id}:${rowIndex}`];
  const format = formatAt(sheet, rowIndex, colIndex);
  if (!format) return null;
  if (raw != null && isFormulaText(raw)) {
    const r = evalResult.get(rowIndex, colIndex);
    return r && r.ok ? formatValueColor(r.value, { numberFormat: format }) : null;
  }
  if (raw == null || raw === "") return null;
  const v = literalTypedValue(raw);
  return formatValueColor(v, { numberFormat: format });
}

/** The resolved typed-value KIND for a cell — drives right/left alignment (item 5). */
export function displayKindFor(sheet, evalResult, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return "blank";
  const raw = sheet.cells[`${col.id}:${rowIndex}`];
  if (raw != null && isFormulaText(raw)) {
    const r = evalResult.get(rowIndex, colIndex);
    if (!r) return "blank";
    return r.ok ? kindOf(r.value) : "error";
  }
  if (raw == null || raw === "") return "blank";
  return kindOf(literalTypedValue(raw));
}

/** The formula-bar text for the active cell: the raw text verbatim (a formula WITH its "=",
 *  or a literal's raw typed text) — never the displayed/formatted value. */
export function formulaBarText(sheet, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return "";
  return sheet.cells[`${col.id}:${rowIndex}`] ?? "";
}

/* ── STAGE 3 (NEW-2, owner brief 2026-09-03) — INPUT / FORMULA / CROSS-SHEET-LINK COLOUR ──
 * The financial-modelling convention: BLUE for a hardcoded input the user typed, BLACK for a
 * formula computed on this sheet, GREEN for a formula whose value comes from ANOTHER sheet.
 * Derived automatically from the cell's own raw content and its PARSED reference shape — never
 * from the eval RESULT, so it costs nothing extra to compute (parseFormula's own LRU cache
 * makes a repeat call here a lookup, not a re-parse) and never disagrees with what the formula
 * bar shows for the same cell. A blank cell classifies as `null` (nothing to colour). */

/** Does this formula's AST read a reference qualified to a sheet OTHER than `ownSheetName`
 *  (case-insensitively)? A `[Column]` bracket ref is always same-sheet by construction and
 *  never counts. Per the brief: "even if it also references this sheet" — mixing a bare/
 *  same-sheet-qualified ref with a genuinely cross-sheet one still counts as cross-sheet. */
function astHasCrossSheetRef(node, ownSheetName) {
  if (!node || typeof node !== "object") return false;
  switch (node.type) {
    case "ref":
    case "range":
      return !!node.sheet && node.sheet.trim().toLowerCase() !== ownSheetName.trim().toLowerCase();
    case "unary":
    case "percent":
      return astHasCrossSheetRef(node.arg, ownSheetName);
    case "binary":
      return astHasCrossSheetRef(node.left, ownSheetName) || astHasCrossSheetRef(node.right, ownSheetName);
    case "call":
      return node.args.some((a) => astHasCrossSheetRef(a, ownSheetName));
    default:
      return false; // num, str, bool, blankLiteral, errLiteral, col — no A1 reference to check
  }
}

/** "input" | "formula" | "cross-sheet" | null (blank — nothing to colour) for one cell.
 *  `sheetName` is the sheet THIS cell lives on (needed only to tell a genuinely cross-sheet
 *  reference apart from a redundant explicit self-qualifier, e.g. `Sheet1!A5` typed while
 *  sitting on Sheet1 — that reads as an ordinary same-sheet "formula", not "cross-sheet"). */
export function cellColorKind(sheet, sheetName, rowIndex, colIndex) {
  const col = sheet.columns[colIndex];
  if (!col) return null;
  const raw = sheet.cells[`${col.id}:${rowIndex}`];
  if (raw == null || raw === "") return null;
  if (!isFormulaText(raw)) return "input";
  const { ast } = parseFormula(formulaSource(raw));
  return ast && astHasCrossSheetRef(ast, sheetName || "") ? "cross-sheet" : "formula";
}
