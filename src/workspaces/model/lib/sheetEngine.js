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

/** Walk a formula's parsed AST, collecting which CELLS it reads — every reference system, now
 *  across the WHOLE WORKBOOK (Stage 3, NEW-1) and including named ranges (Stage 3, NEW-1 pt 2).
 *  `addDep(sheetId, rowIndex, colIndex)` (0-based) is called for every cell the formula could
 *  possibly read; the caller (evaluateWorkbook) is responsible for bounds-checking against the
 *  TARGET sheet's own dimensions and for deciding which of those are themselves formula cells
 *  (only formula cells need ordering — a literal is already resolved). `ownerSheetId` is the
 *  sheet the FORMULA ITSELF lives on — an unqualified A1/range/name reference means "this cell
 *  on THAT sheet" (Excel semantics), and a `[Column]` bracket reference is ALWAYS same-sheet (no
 *  cross-sheet bracket syntax exists) so it resolves against `ownerSheetId` regardless of what a
 *  sibling A1 reference in the same formula names. `colNameToIndex` resolves a `[Column]`
 *  bracket name to a column index on the OWNER sheet, or null for an unknown column (the
 *  engine's own #REF! already covers reporting that at eval time). `resolveSheetId(name)`
 *  resolves a qualifier's sheet NAME to its id, or null if no sheet by that name exists
 *  (over-depending on nothing is fine — the eval itself raises the real #REF! for an
 *  unresolvable sheet). `sheetBounds(sheetId)` returns that sheet's own `{rows, cols}`, needed
 *  because a `[Column]`-whole-column dependency has to walk the OWNER sheet's row count, not
 *  whichever sheet a sibling reference in the same formula might target. `namesMap` is the OWNER
 *  sheet's own named-range table (never another sheet's — named ranges are sheet-scoped, same as
 *  formula.js's own ctx.names/resolveNamedRange contract), used to resolve a bare "name" node. */
function collectCellDeps(node, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, namesMap, addDep) {
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
    // A NAMED RANGE reference (NEW-1) — the EXISTING per-cell graph, extended, per the build
    // brief ("named-range edges go into the existing dependency graph — do not build a second
    // graph"). Resolves the name via the sheet's own `names` table (the SAME table
    // evaluateSheet below hands to evaluateFormula as ctx.names, so a formula that reads a
    // name depends on exactly the cells that name's CURRENT target names — retargeting or
    // renaming a name changes what this walks the very next time the sheet recomputes, which
    // is every commit, so "changing what a name points at recalculates its dependents" falls
    // out of this for free, no separate invalidation step needed). An undefined name adds no
    // edge — the eval-time #NAME? (formula.js's own resolveNamedRange) is what reports it;
    // over-depending on nothing is as harmless here as it already is for an unknown [Column].
    // ⛔ spreadsheet-live-data-refs — a COMPUTED (project-data) entry has no cell dep at all: its
    // value comes from outside the grid entirely (lib/projectRefs.js) and is already fully
    // resolved before this dependency graph is even built (see evaluateWorkbook below), so there
    // is nothing here for the topological sort to wait on.
    case "name": {
      const entry = namesMap && namesMap[node.name.toLowerCase()];
      if (entry && !entry.computed) for (let r = entry.r1 - 1; r <= entry.r2 - 1; r++) for (let c = entry.c1 - 1; c <= entry.c2 - 1; c++) addDep(ownerSheetId, r, c);
      return;
    }
    case "unary":
    case "percent":
      collectCellDeps(node.arg, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, namesMap, addDep);
      return;
    case "binary":
      collectCellDeps(node.left, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, namesMap, addDep);
      collectCellDeps(node.right, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, namesMap, addDep);
      return;
    case "call":
      node.args.forEach((a) => collectCellDeps(a, ownerSheetId, colNameToIndex, resolveSheetId, sheetBounds, namesMap, addDep));
      return;
    default:
      return; // num, str, bool, blankLiteral, errLiteral — leaves, no cell deps
  }
}

/* ── STAGE 3 (NEW-1, owner brief 2026-09-03) — TRACE PRECEDENTS/DEPENDENTS AUDITING ──
 * A READ-ONLY walk of the SAME AST `collectCellDeps` above already walks to build the per-cell
 * dependency graph — this never adds an edge, it just groups the ones `collectCellDeps` would
 * expand to individual cells back into the reference the user actually TYPED (a range, a name, a
 * `[Column]`), so the UI can label a trace with "Revenue" instead of seven separate arrows to
 * C4..C10. `collectRefHops` mirrors collectCellDeps's own node-type switch one-for-one; the only
 * difference is the LEAF action — push a labeled, grouped "hop" instead of calling `addDep` once
 * per cell. `idToName` resolves a target sheet id back to its display name, needed only to label a
 * cross-sheet hop ("Sheet2!C4"); `cellAddressText` (this file, already used by SheetView) is reused
 * for the address text so a hop's label can never disagree with what the formula bar itself shows. */
function collectRefHops(node, ownerSheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesMap, out) {
  if (!node || typeof node !== "object") return out;
  switch (node.type) {
    case "col": {
      const idx = colNameToIndex(node.name);
      const bounds = sheetBounds(ownerSheetId);
      if (idx != null && bounds) {
        const cells = [];
        for (let r = 0; r < bounds.rows; r++) cells.push({ row: r, col: idx });
        out.push({ kind: "column", sheetId: ownerSheetId, crossSheet: false, label: `[${node.name}]`, cells });
      }
      return out;
    }
    case "ref": {
      const sheetId = node.sheet ? resolveSheetId(node.sheet) : ownerSheetId;
      if (sheetId == null) return out;
      const crossSheet = sheetId !== ownerSheetId;
      const addr = cellAddressText(node.row - 1, node.col - 1);
      out.push({ kind: "cell", sheetId, crossSheet, label: crossSheet ? `${idToName.get(sheetId) || node.sheet}!${addr}` : addr, cells: [{ row: node.row - 1, col: node.col - 1 }] });
      return out;
    }
    case "range": {
      const sheetId = node.sheet ? resolveSheetId(node.sheet) : ownerSheetId;
      if (sheetId == null) return out;
      const crossSheet = sheetId !== ownerSheetId;
      const r1 = Math.min(node.from.row, node.to.row), r2 = Math.max(node.from.row, node.to.row);
      const c1 = Math.min(node.from.col, node.to.col), c2 = Math.max(node.from.col, node.to.col);
      const addr = `${cellAddressText(r1 - 1, c1 - 1)}:${cellAddressText(r2 - 1, c2 - 1)}`;
      const cells = [];
      for (let r = r1 - 1; r <= r2 - 1; r++) for (let c = c1 - 1; c <= c2 - 1; c++) cells.push({ row: r, col: c });
      out.push({ kind: "range", sheetId, crossSheet, label: crossSheet ? `${idToName.get(sheetId) || node.sheet}!${addr}` : addr, cells });
      return out;
    }
    // A NAMED RANGE reference — resolved against the OWNER sheet's own names table, same
    // sheet-scoping evaluateWorkbook already uses below for the eval-time "name" case. The
    // hop's label is the name's own display text ("Revenue"), which is the whole point: this
    // is the ONE reference kind whose typed form is already more legible than its address.
    //
    // ⛔ spreadsheet-live-data-refs — a COMPUTED (project-data) entry gets its own hop KIND
    // ("project"), with an EMPTY `cells` list (there is no grid cell behind it to reveal or jump
    // to) and a `sourceLabel` naming where the number actually came from. Without this a project
    // reference would silently vanish from every trace — `cells.length === 0` skips it in
    // evaluateWorkbook's dependents-graph build below (correctly: nothing depends FROM it), but
    // renderableTrace (traceAudit.js) special-cases `kind === "project"` so it is never dropped
    // from PRECEDENTS the same way (see that file's own header on why `revealed.length === 0`
    // would otherwise make it invisible — the exact "trace precedents does not silently
    // under-report" requirement this feature was built to satisfy).
    case "name": {
      const entry = namesMap && namesMap[node.name.toLowerCase()];
      if (entry && entry.computed) {
        out.push({ kind: "project", sheetId: ownerSheetId, crossSheet: false, label: entry.name, sourceLabel: entry.sourceLabel || null, cells: [] });
        return out;
      }
      const rect = entry;
      if (rect) {
        const cells = [];
        for (let r = rect.r1 - 1; r <= rect.r2 - 1; r++) for (let c = rect.c1 - 1; c <= rect.c2 - 1; c++) cells.push({ row: r, col: c });
        out.push({ kind: "name", sheetId: ownerSheetId, crossSheet: false, label: rect.name, cells });
      }
      return out;
    }
    case "unary":
    case "percent":
      return collectRefHops(node.arg, ownerSheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesMap, out);
    case "binary":
      collectRefHops(node.left, ownerSheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesMap, out);
      collectRefHops(node.right, ownerSheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesMap, out);
      return out;
    case "call":
      node.args.forEach((a) => collectRefHops(a, ownerSheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesMap, out));
      return out;
    default:
      return out; // num, str, bool, blankLiteral, errLiteral — leaves, nothing to trace
  }
}

/** Merge hops that name the SAME reference more than once in one formula (`=A1+A1`, or a
 *  function called with the same range twice) — same (kind, sheetId, label) signature — so a
 *  trace draws ONE arrow per reference the user typed, not one per AST occurrence. */
function dedupeHops(hops) {
  const seen = new Map();
  for (const h of hops) {
    const sig = `${h.kind}|${h.sheetId}|${h.label}`;
    if (!seen.has(sig)) seen.set(sig, h);
  }
  return [...seen.values()];
}

const EMPTY_SHEET_EVAL = { get: () => null };

/** Evaluate every formula CELL of a WHOLE WORKBOOK, once, in ONE combined dependency order
 *  across every sheet (Stage 3, NEW-1 — cross-sheet references, `SheetName!A1` — and Stage 3,
 *  NEW-1 pt 2 — named ranges, sheet-scoped). This is the workbook-wide generalization of the
 *  single-sheet algorithm below (evaluateSheet): the same seed-grid / build-deps / topo-sort /
 *  evaluate-in-order shape, just keyed by `sheetId:row:col` instead of `row:col`, so a formula
 *  on ANY sheet that reads another sheet's cell sees that cell's CURRENT (possibly itself
 *  formula-computed) value, and a circular reference that loops THROUGH another sheet is caught
 *  exactly like one that stays on one sheet. Must always evaluate every sheet, even the ones
 *  not currently visible — a hidden sheet's formulas are still live inputs to whichever sheet
 *  the user IS looking at. Returns `{ get(sheetId) }` -> `{ get(rowIndex, colIndex) }` ->
 *  `{ok, value, error, detail} | null`, so `displayFor`/`displayColorFor`/`displayKindFor`
 *  below (unchanged, per-sheet) keep working exactly as before once handed the right sheet's
 *  own slice.
 *
 * `projectNames` (spreadsheet-live-data-refs, optional) — the CALLER's own already-resolved
 * project-derived name map (lib/projectRefs.js's `buildProjectNames`), merged into EVERY sheet's
 * own names table below. These are workbook/project-level facts (the open project's site plan,
 * its comps), not sheet-scoped ones, so unlike `sheet.names` they are the SAME map on every
 * sheet — a user's own sheet-scoped name still wins on the rare case its text collides (defensive
 * only: `namedRanges.js`'s reserved-prefix check stops a NEW collision from ever being created). */
export function evaluateWorkbook(workbook, { projectNames } = {}) {
  const entries = workbook.sheets;
  const nameToId = new Map();
  const idToName = new Map();
  for (const s of entries) { nameToId.set(s.name.trim().toLowerCase(), s.id); idToName.set(s.id, s.name); }
  const resolveSheetId = (name) => (nameToId.has(String(name).trim().toLowerCase()) ? nameToId.get(String(name).trim().toLowerCase()) : null);

  const grids = {};          // sheetId -> grid[][]
  const gridsByName = {};    // lowercased sheet name -> the SAME grid[][] object (for ctx.grids)
  const rowMapsBySheet = {}; // sheetId -> rowMaps[]
  const colsBySheet = {};    // sheetId -> columns[]
  const namesBySheet = {};   // sheetId -> that sheet's OWN named-range table (never another sheet's)
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
    // NEW-1 — this sheet's own named ranges (lib/namedRanges.js's `sheet.names`), already stored
    // keyed by lowercased name with a 1-based {r1,c1,r2,c2} rect — exactly the shape formula.js's
    // own ctx.names/resolveNamedRange contract expects, so it's handed straight through with no
    // translation. Named ranges are sheet-scoped (resolved against the OWNER sheet's own grid,
    // never a cross-sheet lookup), so this is keyed by sheetId, not shared workbook-wide.
    //
    // spreadsheet-live-data-refs — `projectNames` spreads in FIRST so a genuine (pre-feature)
    // user name collision wins over it; see this function's own header note.
    namesBySheet[s.id] = { ...(projectNames || null), ...(sheet.names || {}) };
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
      collectCellDeps(cell.ast, cell.sheetId, colNameToIndex, resolveSheetId, sheetBounds, namesBySheet[cell.sheetId], (sheetId, r, c) => {
        const bounds = sheetBounds(sheetId);
        if (!bounds || r < 0 || r >= bounds.rows || c < 0 || c >= bounds.cols) return; // off-sheet: nothing to depend on
        const dk = `${sheetId}:${r}:${c}`;
        if (formulaCells.has(dk)) set.add(dk);
      });
    }
    deps.set(key, set);
  }

  // STAGE 3 (NEW-1) — every formula cell's own GROUPED, LABELED precedent hops (see
  // collectRefHops's header above) plus the DEPENDENTS graph, which is nothing but `deps`
  // reversed — the exact same edges, walked backwards, never a second graph built from the AST.
  // Both are O(formula cell count) / O(edge count) — the same cost class `deps` itself already
  // pays — so tracing a cell costs nothing extra beyond the recalc that already ran this pass.
  const hopsByKey = new Map();
  for (const [key, cell] of formulaCells) {
    const colNameToIndex = nameToIndexFor(cell.sheetId);
    hopsByKey.set(key, cell.ast ? dedupeHops(collectRefHops(cell.ast, cell.sheetId, colNameToIndex, resolveSheetId, idToName, sheetBounds, namesBySheet[cell.sheetId], [])) : []);
  }
  // ⛔ Built from `hopsByKey`, NOT from `deps` above — `deps` exists purely to order EVAL (a
  // literal cell needs no ordering, so `addDep` there only ever records an edge INTO another
  // FORMULA cell), so inverting it would silently drop "trace dependents" starting from an
  // ordinary INPUT cell — exactly the classic case ("who uses this number"). Every cell a hop's
  // own `cells` list names is a genuine dependent target, formula or literal alike.
  const dependents = new Map(); // key -> Set<formulaKey>
  for (const [key, hops] of hopsByKey) {
    for (const hop of hops) {
      for (const c of hop.cells) {
        const dk = `${hop.sheetId}:${c.row}:${c.col}`;
        if (!dependents.has(dk)) dependents.set(dk, new Set());
        dependents.get(dk).add(key);
      }
    }
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
        grid: grids[cell.sheetId], grids: gridsByName, names: namesBySheet[cell.sheetId],
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

  // STAGE 3 (NEW-1) — the trace-audit surface (lib/traceAudit.js is the pure stepping/rendering
  // layer over this; it never re-derives any of it). `hopsFor` returns `null` for a non-formula
  // cell (nothing to trace FROM) vs. `[]` for a formula with no references (SUM of literals) —
  // the two are deliberately distinct so a caller can tell "not a formula" from "a formula that
  // reads nothing."
  const graph = {
    hopsFor: (sheetId, rowIndex, colIndex) => hopsByKey.get(`${sheetId}:${rowIndex}:${colIndex}`) ?? null,
    dependentsOf: (sheetId, rowIndex, colIndex) => dependents.get(`${sheetId}:${rowIndex}:${colIndex}`) || new Set(),
  };
  return { get: (sheetId) => bySheet.get(sheetId) || EMPTY_SHEET_EVAL, graph };
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
