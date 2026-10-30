/* The building's FFE (finished floor elevation) on its on-map label — owner 2026-10-30 ("we should show the FFE of the
 * building, also"). Pure.
 *
 * ONE answer, read at label time and never copied: a TYPED finish elevation (`el.padElevFt`, the same field the Grading
 * panel's box writes) wins, else the SUGGESTED one GradingController publishes in `grModel.autoFfe` (id → ft). When grading is
 * off for the plan there is nothing to show, and the label is exactly what it was. A bump-out (`dogEar`) is a pad member of
 * its host and shows nothing of its own.
 */

/** "FFE 790.3" — one decimal, no thousands separator (an elevation, not an area); null for anything that is not a number. */
export function ffeLineText(ffeFt) {
  return typeof ffeFt === "number" && Number.isFinite(ffeFt) ? `FFE ${ffeFt.toFixed(1)}` : null;
}

/** The FFE a building's label shows, or null (grading off · not a building · a bump-out · no value yet). */
export function buildingFfeFt(el, { grOn, autoFfe } = {}) {
  if (!grOn || !el || el.type !== "building" || el.dogEar) return null;
  if (Number.isFinite(el.padElevFt)) return el.padElevFt;
  const a = autoFfe && typeof autoFfe.get === "function" ? autoFfe.get(el.id) : null;
  return Number.isFinite(a) ? a : null;
}
