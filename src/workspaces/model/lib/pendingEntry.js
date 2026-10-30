/* Model workspace — "is there typed-but-uncommitted text?" rules shared by the sheet-change paths.
 *
 * The cell editor and the formula bar both hold typed text as component state until Enter / Tab /
 * click-away. Changing which sheet is showing must COMMIT that text to the sheet it was typed on
 * first (Excel's contract) — never drop it, and never let it carry over to the next sheet.
 * ModelApp calls `commitPending()` on both (SheetView + FormulaBar refs) before it changes the
 * active sheet; this file is the one rule for what "pending" means in the formula bar.
 */

/** The formula bar's draft is pending only when it differs from what the cell holds right now. */
export function hasPendingFormulaText(draft, committed) {
  return String(draft ?? "") !== String(committed ?? "");
}
