/* HOW AN AREA UNIT IS SPELLED — one place, every surface (B548817).
 *
 * Owner report: units read "ac" and "sf" on the drawing and in the panels; they should read
 * **AC** and **SF**. That is the convention on every civil sheet, survey and lease exhibit these
 * plans sit next to, and a lowercase "sf" next to a set of tabular figures reads as a typo.
 *
 * ⛔ WHY THIS IS A MODULE AND NOT A FIND-AND-REPLACE. The spelling was written out longhand at
 * roughly fifty call sites — the measurement chip, the parcel acreage badge, the building label,
 * the yield panel, the pond glance rows, the easement rows, MapFinder's site list, the Doc Review
 * totals — each with its own number formatter. A sweep fixes today; it does not stop the fifty-
 * first site being written in lowercase next week. So the unit TOKENS live here, the two common
 * "number + unit" forms live here, and `test/areaUnits.test.js` sweeps the source for the
 * lowercase spelling and fails the build on a new one.
 *
 * Acre-feet rides along. The owner named AC and SF; acre-feet is the same unit family and appears
 * in the same panels (a volume line right below "94.40 AC"), so leaving it lowercase would produce
 * exactly the disagreement between surfaces this item exists to remove.
 *
 * NOT in scope, deliberately: FEET. The drawing's feet convention is the prime mark (2,100′), set
 * by measureLabel.js and used by every dimension on the canvas — it is a symbol, not an
 * abbreviation, and it has no case to fix.
 *
 * Pure: no React, no DOM, no locale configuration beyond the platform default the rest of the app
 * already uses.
 */

/** The canonical unit tokens. Use these anywhere the number formatting is bespoke. */
export const AC = "AC";
export const SF = "SF";
export const AC_FT = "AC-FT";

export const SQFT_PER_ACRE = 43560;

/* The two number conventions the app already had, kept exactly: square feet to whole numbers,
 * acres to two decimals, thousands separators on both. */
const int = (n) => Math.round(Number(n) || 0).toLocaleString();
const two = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "193,007 SF" */
export const fmtSf = (n) => `${int(n)} ${SF}`;
/** "94.40 AC" */
export const fmtAc = (n) => `${two(n)} ${AC}`;
/** Square feet in, acres out: "94.40 AC" */
export const fmtAcFromSf = (sf) => fmtAc((Number(sf) || 0) / SQFT_PER_ACRE);
