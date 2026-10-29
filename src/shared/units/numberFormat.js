/* HOW A NUMBER IS ROUNDED AND SPELLED — one home for the formatters (NEW-1, refactor).
 *
 * Twenty-eight modules each carried a private `f0` / `f1` / `f2`, in three styles that already
 * produce DIFFERENT strings for the same number:
 *   • COMMA — thousands separators, browser locale (`toLocaleString`): "1,235"
 *   • PLAIN — no separators (`toFixed`): "1234.5"
 *   • US    — separators pinned to en-US, so a comma-decimal browser cannot change a panel: "1,235"
 * plus two small variants (a coerce-to-zero pair in areaUnits, and a toString-trim pair that drops
 * a trailing ".0" and prints an em dash for a non-number).
 *
 * ⛔ THIS FILE DOES NOT UNIFY THEM. Each export is the body a call site ALREADY used, kept
 * character for character, so moving a site here changes no output. Which style a surface should
 * use is a product decision (what Michael sees); it is a separate change. `test/numberFormat
 * .test.js` pins every body against a verbatim copy of the old one.
 *
 * Pure: no React, no DOM. `test/areaUnits.test.js` fails the build on a new private f0/f1/f2 —
 * pick the variant here, or add a named one.
 */

/* ---- COMMA: thousands separators, browser locale ---- */
export const commaInt = (n) => Math.round(n).toLocaleString();
export const commaDec1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const commaDec2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- COMMA, but a non-number reads as 0 instead of "NaN" (areaUnits' SF / AC strings) ---- */
export const commaIntOrZero = (n) => Math.round(Number(n) || 0).toLocaleString();
export const commaDec2OrZero = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- US: separators pinned to en-US (pond verdict + ledger balancer) ---- */
export const usInt = (n) => Math.round(n).toLocaleString("en-US");

/* ---- PLAIN: no separators ---- */
export const plainDec1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
export const plainDec2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
/** `toFixed` with no rounding step first — differs from plainDec1 on a binary-half like 1.45. */
export const fixedDec1 = (n) => n.toFixed(1);

/* ---- TRIM: toString, so a whole number drops its ".0"; non-numbers read as an em dash ---- */
export const trimInt = (n) => (Number.isFinite(n) ? Math.round(n).toString() : "—");
export const trimDec1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—");
