/* Model workspace — Excel-style column-width fit for General-format numbers (NEW-1).
 *
 * General format shows a number at full precision (`numToGeneralStr`, shared/formula/formula.js)
 * only while that precision fits the column. Excel narrows the DISPLAYED precision as the column
 * narrows — rounding, never truncating — and falls back to a column-filling run of "#" once even
 * a bare integer / scientific form won't fit. Neither the stored cell value nor the formula bar
 * are touched by any of this — it decides only what gets PAINTED.
 *
 * Measurement is pluggable, the same `(text) => px` shape textWrap.js's callout fitter uses —
 * SheetView.jsx passes its real <canvas> measurer; unit tests pass a small deterministic
 * stand-in (e.g. character count) so the ladder logic is provable without a DOM.
 *
 * Only ever called for a General (unformatted) NUMBER cell — an explicit format (Currency,
 * Percent, …) keeps its own formatNumberToken rules untouched (SheetView.jsx gates the call on
 * `formatAt(...) == null`).
 */
import { numToGeneralStr } from "../../../shared/formula/formula.js";

// How many mantissa digits of scientific notation to try before giving up and falling back to
// the "#" fill below — generous; a real column is rarely narrow enough to need more than a
// handful, and each rejected candidate costs one cheap width measurement.
const MAX_EXP_DIGITS = 10;

function decimalCountOf(str) {
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : str.length - dot - 1;
}

/** The best-fitting display string for `value` (a finite number, General/unformatted) inside
 *  `availableWidthPx` (the cell's own content box, padding already subtracted), using `measure`
 *  to ask how wide a candidate string renders. Ladder, matching Excel's own order of retreat:
 *  1) full precision as-is; 2) fewer decimal places (never touching the integer part, and never
 *  rounding a genuinely nonzero value down to a bare "0"); 3) scientific notation, narrowed the
 *  same way; 4) a column-filling run of "#" when nothing legible fits. */
export function fitGeneralNumber(value, availableWidthPx, measure) {
  if (!Number.isFinite(value)) return numToGeneralStr(value); // defensive — callers only ever pass a resolved finite number

  const full = numToGeneralStr(value);
  if (measure(full) <= availableWidthPx) return full;

  // 1) Reduce DECIMAL PLACES, most precision first — the integer part is never touched here.
  const naturalDecimals = decimalCountOf(full);
  for (let d = naturalDecimals - 1; d >= 0; d--) {
    const rounded = Number(value.toFixed(d));
    if (rounded === 0 && value !== 0) break; // would erase a real number to nothing — stop, try scientific instead
    const candidate = numToGeneralStr(rounded);
    if (measure(candidate) <= availableWidthPx) return candidate;
  }

  // 2) Still too wide (or the integer part alone is the problem, e.g. 1E20) — scientific
  // notation, starting from ITS OWN natural (loss-free) precision and narrowing the same way.
  const naturalExp = value.toExponential().toUpperCase();
  if (measure(naturalExp) <= availableWidthPx) return naturalExp;
  const naturalExpDecimals = Math.min(MAX_EXP_DIGITS, decimalCountOf(naturalExp.split("E")[0]));
  for (let d = naturalExpDecimals - 1; d >= 0; d--) {
    const candidate = value.toExponential(d).toUpperCase();
    if (measure(candidate) <= availableWidthPx) return candidate;
  }

  // 3) Nothing legible fits — Excel's own "column too narrow" marker, filled to the width.
  const hashW = measure("#") || 1;
  const count = Math.max(1, Math.floor(availableWidthPx / hashW));
  return "#".repeat(count);
}
