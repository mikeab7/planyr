/* Model workspace — keep a formula TYPED (or pasted) into the Univer grid in the spelling Univer's engine calculates correctly
 * (NEW-1, one formula engine; the load-time half is lib/planyrSyntax.js `migratePlanyrSyntaxInWorkbook`).
 *
 * Two spellings need it, measured against Univer 1.3.1: `=-Rate` (a minus sign straight before a name or TRUE/FALSE) answers #NAME?, and
 * Planyr's own interleaved `XIRR(v1,d1,v2,d2)` is not Excel's shape. A person typing either in the grid gets the same rewrite a loaded
 * workbook gets — `=-(Rate)`, `XIRR(CHOOSE({1,2},…),CHOOSE({1,2},…))` — BEFORE the cell is written, so the grid, the saved workbook, the
 * Excel file and the CSV all hold one formula and calculate one answer. It rewrites the mutation's own parameters in place (one
 * undo step, as typed); it adds no command and touches nothing but `f` text. `[Column]` names are NOT handled here: the grid has no
 * column names to resolve them against, and the bridge already reports such a formula out loud on save.
 *
 * Pure apart from the two Univer services the host passes in (UniverSheet.jsx is the only file that imports @univerjs/*). */
import { rewriteInterleavedPairs, rewriteUnaryMinusBeforeName } from "./planyrSyntax.js";

export const SET_RANGE_VALUES_MUTATION_ID = "sheet.mutation.set-range-values";

/** One formula's text as Univer wants it; `changed` says whether anything moved. */
export function univerSpelling(formula) {
  const f = String(formula ?? "");
  const a = rewriteInterleavedPairs(f);
  const b = rewriteUnaryMinusBeforeName(a.text);
  return { text: b.text, changed: a.count > 0 || b.count > 0 };
}

/** Rewrite every formula in a `cellValue` matrix ({ [row]: { [col]: { f } } }) in place. Returns how many cells changed. */
export function guardCellValue(cellValue) {
  let n = 0;
  if (!cellValue || typeof cellValue !== "object") return 0;
  for (const row of Object.values(cellValue)) {
    if (!row || typeof row !== "object") continue;
    for (const cell of Object.values(row)) {
      if (!cell || typeof cell.f !== "string") continue;
      const { text, changed } = univerSpelling(cell.f);
      if (changed) { cell.f = text; n++; }
    }
  }
  return n;
}

/** Install on Univer's command service. Returns a dispose function. */
export function installFormulaGuard({ injector, ICommandService, onRewrite }) {
  const commands = injector.get(ICommandService);
  const sub = commands.beforeCommandExecuted((info) => {
    if (!info || info.id !== SET_RANGE_VALUES_MUTATION_ID || !info.params) return;
    const n = guardCellValue(info.params.cellValue);
    if (n && onRewrite) onRewrite(n);
  });
  return () => { try { sub.dispose(); } catch (_) { /* already gone */ } };
}
