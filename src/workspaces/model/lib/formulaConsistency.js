/* Model workspace — Stage 3 (NEW-2, owner brief 2026-09-03): inconsistent-formula detection.
 *
 * The classic modelling error this exists to catch: one cell in an otherwise-uniform row or
 * column of formulas got overtyped — with a hardcoded number, or with a formula that quietly
 * skips a column/adds a stray term — and nobody notices until the totals are wrong.
 *
 * THE COMPARISON IS STRUCTURAL, NOT TEXTUAL. `=B2*C2` and `=B3*C3` are the SAME pattern (every
 * reference moved by the exact row delta the cell itself moved by — the R1C1 shape Excel's own
 * fill-handle preserves); `=B4*C4+100` is not (an extra term); neither is a bare `12000` sitting
 * in a run of formulas. `formulaShapeSignature` below normalizes a formula's AST to exactly that
 * R1C1-style shape: every plain reference becomes a (row-delta, col-delta) PAIR relative to the
 * cell holding the formula (so the position doesn't matter, only the offset does); a $-anchored
 * coordinate stays literal on its anchored axis (an anchor is invariant by definition — a shared
 * tax-rate cell every row multiplies by should read as the SAME pattern down the whole column,
 * not a different one every row); a `[Column]`/named-range reference is compared by NAME, since
 * referencing a genuinely different column or name IS a different pattern; embedded NUMBER/
 * STRING/BOOL literals compare by TYPE only, never by value — two rows legitimately growing at
 * different rates (`=B2*1.05`, `=B3*1.06`) are the same shape, only their assumption differs.
 *
 * PRECISION OVER RECALL (per the build brief) — THREE tuning passes, each measured against a
 * realistic multi-section pro-forma fixture (`test/modelFormulaConsistency.test.js`), each
 * catching a real false positive the pass before it produced:
 *   1. A pattern is only ever asserted from a run of `MIN_RUN_LEN`+ contiguous non-blank cells
 *      whose DOMINANT shape covers a real majority (`MIN_DOMINANT_COUNT` occurrences AND
 *      `MIN_DOMINANT_FRACTION` of the run's formula cells) — a short or genuinely mixed run
 *      asserts nothing.
 *   2. A cell whose own shape (formula) or plain presence (a literal) differs from the pattern
 *      is flagged, UNLESS it sits at the very EDGE of the pattern (the first or last participating
 *      cell) — a MISMATCHED FORMULA at an edge is suppressed only when it's a top-level call to an
 *      aggregate function (SUM, SUBTOTAL, …), the ordinary shape of a subtotal/total row or
 *      column; a LITERAL at an edge is suppressed unconditionally — the ordinary shape of a
 *      growth series's own seed value ("month 1 = $1,000, every month after grows 0.3%") or a
 *      manual override total, neither a modelling error.
 *   3. A plain TEXT literal (a row/column LABEL — "Monthly NOI") is excluded from the pattern
 *      entirely, never a "hardcoded value" candidate and never counted toward edge position —
 *      without this, the label column every real sheet has (routine: the label sits immediately
 *      before the numeric run on almost every row) pushes the true first NUMBER one position in,
 *      defeating pass 2's edge check and flagging an ordinary seed value as an overtype.
 * See the realistic-pro-forma fixture for the measured false-positive count all three produce
 * TOGETHER (0, on that fixture) — the number worth citing is the combined one, not any one pass
 * in isolation.
 *
 * Runs along BOTH axes independently — a cell can be flagged on its ROW pattern, its COLUMN
 * pattern, or both; findings for the same cell from both axes merge into one entry.
 */
import { parseFormula } from "../../../shared/formula/formula.js";
import { rawAt, isFormulaText, usedRangeEnd } from "./sheetModel.js";
import { literalTypedValue } from "./sheetEngine.js";

const MIN_RUN_LEN = 3;
const MIN_DOMINANT_COUNT = 3;
const MIN_DOMINANT_FRACTION = 0.6;
const AGGREGATE_FUNCTIONS = new Set(["SUM", "SUBTOTAL", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "MEDIAN", "PRODUCT"]);

/** A single reference endpoint's own R1C1-style signature fragment — shared by "ref" and each
 *  corner of a "range", so the two can never disagree about what "the same offset" means. An
 *  anchor ($) on an axis makes that axis LITERAL (the anchored coordinate is what's invariant);
 *  an unanchored axis is a DELTA from the cell holding the formula. */
function refSig(sheetPrefix, row, col, rowAbs, colAbs, ownRow1, ownCol1) {
  const rowPart = rowAbs ? `=${row}` : `+${row - ownRow1}`;
  const colPart = colAbs ? `=${col}` : `+${col - ownCol1}`;
  return `${sheetPrefix}R${rowPart}C${colPart}`;
}

function sig(node, ownRow1, ownCol1) {
  if (!node || typeof node !== "object") return "?";
  switch (node.type) {
    case "num": return "NUM";
    case "str": return "STR";
    case "bool": return "BOOL";
    case "errLiteral": return "ERRLIT";
    case "blankLiteral": return "BLANKLIT";
    case "col": return `COL(${node.name.trim().toLowerCase()})`;
    case "name": return `NAME(${node.name.trim().toLowerCase()})`;
    case "ref": {
      const prefix = node.sheet ? `${node.sheet.trim().toLowerCase()}!` : "";
      return refSig(prefix, node.row, node.col, node.rowAbs, node.colAbs, ownRow1, ownCol1);
    }
    case "range": {
      const prefix = node.sheet ? `${node.sheet.trim().toLowerCase()}!` : "";
      const from = refSig(prefix, node.from.row, node.from.col, node.from.rowAbs, node.from.colAbs, ownRow1, ownCol1);
      const to = refSig("", node.to.row, node.to.col, node.to.rowAbs, node.to.colAbs, ownRow1, ownCol1);
      return `RANGE(${from}:${to})`;
    }
    case "unary": return `UN(${node.op},${sig(node.arg, ownRow1, ownCol1)})`;
    case "percent": return `PCT(${sig(node.arg, ownRow1, ownCol1)})`;
    case "binary": return `BIN(${node.op},${sig(node.left, ownRow1, ownCol1)},${sig(node.right, ownRow1, ownCol1)})`;
    case "call": return `CALL(${node.name},${node.args.map((a) => sig(a, ownRow1, ownCol1)).join(",")})`;
    default: return "?";
  }
}

/** The R1C1-style structural shape of the formula in `raw` (its stored "=" text) as if it were
 *  typed into (rowIndex, colIndex) — 0-based, matching every other coordinate in this module.
 *  `null` for anything that doesn't parse cleanly (a formula already showing #ERROR! has nothing
 *  useful to compare). */
function shapeSignature(raw, rowIndex, colIndex) {
  const src = String(raw).replace(/^=\s*/, "");
  const { ast, error } = parseFormula(src);
  if (error || !ast) return null;
  return sig(ast, rowIndex + 1, colIndex + 1);
}

/** True if `ast`'s TOP-LEVEL node is a call to a recognized aggregate function — the shape a
 *  legitimate subtotal/total cell takes, used only to suppress a shape-mismatch flag at the EDGE
 *  of a run (see the file header). */
function isTopLevelAggregateCall(raw) {
  const src = String(raw).replace(/^=\s*/, "");
  const { ast, error } = parseFormula(src);
  return !error && ast && ast.type === "call" && AGGREGATE_FUNCTIONS.has(String(ast.name).toUpperCase());
}

/** Every maximal contiguous run of non-blank cells along one axis, as arrays of {row, col} in
 *  order. Bounded to the sheet's actual USED extent (never the full padded row/column count —
 *  a 1000-row default sheet with 40 real rows of data costs 40, not 1000). */
function runsAlongAxis(sheet, axis) {
  const used = usedRangeEnd(sheet);
  if (!used) return [];
  const runs = [];
  if (axis === "col") {
    for (let c = 0; c <= used.col; c++) {
      let run = [];
      for (let r = 0; r <= used.row; r++) {
        if (rawAt(sheet, r, c) !== "") run.push({ row: r, col: c });
        else { if (run.length) runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
    }
  } else {
    for (let r = 0; r <= used.row; r++) {
      let run = [];
      for (let c = 0; c <= used.col; c++) {
        if (rawAt(sheet, r, c) !== "") run.push({ row: r, col: c });
        else { if (run.length) runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
    }
  }
  return runs;
}

/** The dominant (most common) shape among `formulaCells` (each `{ ...cell, shape }`), or `null`
 *  if no shape reaches the majority threshold (a genuinely mixed run — nothing to assert). */
function dominantShape(formulaCells) {
  if (formulaCells.length === 0) return null;
  const counts = new Map();
  for (const c of formulaCells) counts.set(c.shape, (counts.get(c.shape) || 0) + 1);
  let best = null, bestCount = 0;
  for (const [shape, count] of counts) if (count > bestCount) { best = shape; bestCount = count; }
  if (bestCount < MIN_DOMINANT_COUNT) return null;
  if (bestCount / formulaCells.length < MIN_DOMINANT_FRACTION) return null;
  return best;
}

function flagsForRun(sheet, run, axis) {
  if (run.length < MIN_RUN_LEN) return [];
  const cells = run.map((c) => {
    const raw = rawAt(sheet, c.row, c.col);
    const formula = isFormulaText(raw);
    return { ...c, raw, formula, shape: formula ? shapeSignature(raw, c.row, c.col) : null };
  });
  const formulaCells = cells.filter((c) => c.formula && c.shape != null);
  const dominant = dominantShape(formulaCells);
  if (!dominant) return [];
  // A plain TEXT literal (a row/column LABEL — "Monthly NOI", "Total cost") is never a candidate
  // for "hardcoded value in a formula run": it was never masquerading as computed data, so it is
  // excluded entirely, from both edge-position bookkeeping and the flag loop below. Without this,
  // a real underwriting sheet's own row-label column (routine — the label sits immediately before
  // the numeric run on almost every row) pushes the run's true first NUMBER one position in,
  // defeating the edge check below and flagging an ordinary growth-series seed value.
  const patternCells = cells.filter((c) => c.formula || typeof literalTypedValue(c.raw) === "number");
  if (patternCells.length === 0) return [];
  const out = [];
  const first = patternCells[0], last = patternCells[patternCells.length - 1];
  for (const c of patternCells) {
    const isEdge = (c.row === first.row && c.col === first.col) || (c.row === last.row && c.col === last.col);
    if (!c.formula) {
      // A literal at the very START or END of the pattern is ordinarily a deliberate seed value
      // (the "month 1" a growth series builds from) or a manual override total — both routine,
      // not errors. The MIDDLE is where an accidental overtype actually breaks a pattern.
      if (isEdge) continue;
      out.push({ row: c.row, col: c.col, kind: "hardcoded", axis, message: `A plain value sits among ${axis === "col" ? "column" : "row"} neighbours that are all formulas.` });
    } else if (c.shape !== dominant) {
      if (isEdge && isTopLevelAggregateCall(c.raw)) continue; // a subtotal/total at the run's edge — not an error
      out.push({ row: c.row, col: c.col, kind: "shape-mismatch", axis, message: `This formula's structure differs from the other ${axis === "col" ? "column" : "row"} neighbours.` });
    }
  }
  return out;
}

/** Every inconsistency flag on `sheet` — hardcoded constants inside a formula run, and formulas
 *  whose shape breaks the row/column pattern around them. Findings for the SAME cell from both
 *  axes merge into one entry (`axes` lists every axis that flagged it). Does not know about
 *  dismissal — `sheetModel.js`'s `isInconsistencyDismissed` filters this list at the UI boundary,
 *  the same "pure model, view decides what's shown" split the rest of this module uses. */
export function findInconsistencies(sheet) {
  const byCell = new Map(); // "row:col" -> { row, col, kind, axes: Set, messages: Set }
  for (const axis of ["col", "row"]) {
    for (const run of runsAlongAxis(sheet, axis)) {
      for (const f of flagsForRun(sheet, run, axis)) {
        const key = `${f.row}:${f.col}`;
        const entry = byCell.get(key) || { row: f.row, col: f.col, kind: f.kind, axes: new Set(), messages: new Set() };
        // "hardcoded" always wins over "shape-mismatch" if a cell somehow qualifies for both —
        // it never can today (a cell is either a formula or a literal), kept for clarity only.
        if (f.kind === "hardcoded") entry.kind = "hardcoded";
        entry.axes.add(f.axis);
        entry.messages.add(f.message);
        byCell.set(key, entry);
      }
    }
  }
  return [...byCell.values()]
    .map((e) => ({ row: e.row, col: e.col, kind: e.kind, axes: [...e.axes], message: [...e.messages].join(" ") }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}
