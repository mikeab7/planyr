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
  evaluateFormula, formatValue, parseFormula, errVal, isErrVal, isFormulaError, isBlank, BLANK, isDate,
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

/** Walk a formula's parsed AST, collecting which CELLS it reads — both reference systems.
 *  `addDep(rowIndex, colIndex)` (0-based) is called for every cell the formula could possibly
 *  read; the caller (evaluateSheet) is responsible for bounds-checking and for deciding which
 *  of those are themselves formula cells (only formula cells need ordering — a literal is
 *  already resolved). `colNameToIndex` resolves a `[Column]` bracket name to a column index,
 *  or null for an unknown column (the engine's own #REF! already covers reporting that at
 *  eval time — this walker just skips a dependency it can't resolve, over-depending on nothing
 *  is fine since the eval itself will raise the real error). */
function collectCellDeps(node, rowCount, colNameToIndex, addDep) {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "col": {
      const idx = colNameToIndex(node.name);
      if (idx != null) for (let r = 0; r < rowCount; r++) addDep(r, idx);
      return;
    }
    case "ref":
      addDep(node.row - 1, node.col - 1);
      return;
    case "range": {
      const r1 = Math.min(node.from.row, node.to.row) - 1, r2 = Math.max(node.from.row, node.to.row) - 1;
      const c1 = Math.min(node.from.col, node.to.col) - 1, c2 = Math.max(node.from.col, node.to.col) - 1;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) addDep(r, c);
      return;
    }
    case "unary":
    case "percent":
      collectCellDeps(node.arg, rowCount, colNameToIndex, addDep);
      return;
    case "binary":
      collectCellDeps(node.left, rowCount, colNameToIndex, addDep);
      collectCellDeps(node.right, rowCount, colNameToIndex, addDep);
      return;
    case "call":
      node.args.forEach((a) => collectCellDeps(a, rowCount, colNameToIndex, addDep));
      return;
    default:
      return; // num, str, bool, blankLiteral, errLiteral — leaves, no cell deps
  }
}

/** Evaluate every formula CELL of a sheet, once, in dependency order. Returns
 *  { get(rowIndex, colIndex) } -> {ok, value, error, detail} | null (null = not a formula cell,
 *  or a row past sheet.rowCount). */
export function evaluateSheet(sheet) {
  const rows = sheet.rowCount;
  const cols = sheet.columns;
  const numCols = cols.length;
  if (!rows || !numCols) return { get: () => null };

  const nameToIndex = (name) => {
    const nk = lower(name);
    const idx = cols.findIndex((c) => lower(c.name) === nk);
    return idx < 0 ? null : idx;
  };

  // ONE shared, mutable-during-eval representation of the sheet's current typed values —
  // grid[r][c] (0-based) for A1 refs, rowMaps[r][lowerColName] for [Column] refs. Seeded from
  // every literal cell; formula cells fill themselves in as they resolve, in topological
  // order, so a formula that reads another formula cell always sees a real value.
  const grid = Array.from({ length: rows }, () => new Array(numCols).fill(BLANK));
  const rowMaps = Array.from({ length: rows }, () => ({}));
  const formulaCells = new Map(); // "r:c" -> { rowIndex, colIndex, src, ast, parseErr }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < numCols; c++) {
      const col = cols[c];
      const raw = sheet.cells[`${col.id}:${r}`];
      if (raw != null && isFormulaText(raw)) {
        const src = formulaSource(raw);
        const { ast, error, detail } = parseFormula(src);
        formulaCells.set(`${r}:${c}`, { rowIndex: r, colIndex: c, src, ast, parseErr: error ? { error, detail } : null });
      } else {
        const v = literalTypedValue(raw);
        grid[r][c] = v;
        rowMaps[r][lower(col.name)] = v;
      }
    }
  }

  // Dependency graph, formula cells only (a literal is already resolved above).
  //
  // ⛔ A SELF-REFERENCE MUST STAY IN ITS OWN DEPENDENCY SET — do not filter `dk !== key` here.
  // Measured live in this session's own test suite: excluding it meant a cell referencing
  // itself (e.g. "=A1+1" typed into A1) had an EMPTY dependency set, so the cycle-detection DFS
  // below never revisited it and never flagged it — it evaluated against its own still-BLANK
  // grid slot (BLANK+1) and silently returned a plausible-looking 1 instead of #CIRC!. Exactly
  // the class of defect this whole rewrite exists to prevent: a wrong number that looks right.
  const deps = new Map(); // key -> Set<key>
  for (const [key, cell] of formulaCells) {
    const set = new Set();
    if (cell.ast) {
      collectCellDeps(cell.ast, rows, nameToIndex, (r, c) => {
        if (r < 0 || r >= rows || c < 0 || c >= numCols) return; // off-sheet: nothing to depend on
        const dk = `${r}:${c}`;
        if (formulaCells.has(dk)) set.add(dk);
      });
    }
    deps.set(key, set);
  }

  // Topological order + cycle detection — 3-color DFS. Any node revisited while still
  // "visiting" (gray) means every node on the stack from its first occurrence onward is part
  // of a cycle; all of them get marked, not just the one that closed the loop.
  const order = [];
  const cyclic = new Set();
  const state = new Map(); // key -> 1 visiting | 2 done (absent = unvisited)
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

  const results = new Map(); // "r:c" -> {ok, value, error, detail}
  const today = Math.floor(Date.now() / 86400000);
  for (const key of order) {
    const cell = formulaCells.get(key);
    let res;
    // ⛔ B891184-FOLLOWUP: propagate the engine's OWN parse-error code (e.g. "#NAME?" for an
    // unrecognized token/address, "#ERROR!" for a genuine syntax error) rather than flattening
    // every parse failure to a generic "#ERROR!" — measured live: "=ZQXW123" (an out-of-bounds
    // address, out-of-bounds beyond XFD) showed the vague #ERROR! instead of the #NAME? the
    // engine itself determined, which is exactly the "never a silent/generic wrong-looking
    // error" bar the brief holds this to.
    if (cell.parseErr) res = { ok: false, error: cell.parseErr.error || "#ERROR!", detail: cell.parseErr.detail };
    else if (cyclic.has(key)) res = { ok: false, error: "#CIRC!", detail: "circular reference between cells" };
    else res = evaluateFormula(cell.src, { columns: rowMaps[cell.rowIndex], rows: rowMaps, rowIndex: cell.rowIndex, grid, calendar: DEFAULT_CALENDAR, today });
    const value = res.ok ? res.value : errVal(res.error);
    grid[cell.rowIndex][cell.colIndex] = value;
    rowMaps[cell.rowIndex][lower(cols[cell.colIndex].name)] = value;
    results.set(key, res);
  }

  return { get: (rowIndex, colIndex) => results.get(`${rowIndex}:${colIndex}`) || null };
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
