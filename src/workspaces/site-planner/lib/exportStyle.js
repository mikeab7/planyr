// Export-time presentation tuning (NEW-2 / NEW-3, 2026-06-29).
//
// Why this exists: the live planner canvas authors element strokes in SCREEN pixels
// (a building/parcel outline at weight 2, surfaces 1.25, parking/dock hairlines
// 0.5–0.75). When the plan SVG is cloned and nested into the print sheet, those
// pixel weights are scaled by the sheet's "fit" transform — a factor that depends on
// the zoom the user happened to be at when they hit print. The result: line work that
// bakes in heavy and inconsistent, reading "cartoonish / unprofessional" on the PDF.
//
// The fix is to retarget every stroke to a real PHYSICAL drafting weight on paper,
// independent of zoom. `printStrokeWidth` is the pure core: given a stroke's authored
// width (in clone/viewBox units) and the sheet-fit scale (centi-inches of paper per
// viewBox unit), it returns the width that makes the stroke print at a target point
// weight — preserving the existing hierarchy (object lines heaviest, striping
// hairline) while bringing the whole drawing down to a crisp, professional weight.

// One centi-inch (1/100 in) is 0.72 pt (1 in = 72 pt). A stroke `sw` viewBox-units
// wide, scaled by `sheetScale` centi-inches/unit, prints at `sw·sheetScale·0.72` pt.
export const PT_PER_CENTI_INCH = 0.72;

// Target physical weights (points) for the print/PDF line work. `refSw` is the
// authored width that maps to `objectPt` (the building/parcel object line, weight 2);
// everything else scales proportionally and is clamped to [minPt, maxPt] so the
// thinnest striping never disappears and a stray heavy stroke never over-darkens.
export const PRINT_WEIGHTS = { objectPt: 0.6, refSw: 2, minPt: 0.32, maxPt: 1.5 };

// Compute the printed-stroke width (in clone/viewBox units) for an authored stroke.
// `sheetScale` = centi-inches of paper per one viewBox unit (the sheet-fit factor).
// Returns the input unchanged when either input is non-positive (defensive).
export function printStrokeWidth(sw, sheetScale, opts = {}) {
  const w = Number(sw), s = Number(sheetScale);
  if (!(w > 0) || !(s > 0)) return w;
  const { objectPt, refSw, minPt, maxPt } = { ...PRINT_WEIGHTS, ...opts };
  const desiredPt = Math.max(minPt, Math.min(maxPt, (w / refSw) * objectPt));
  return desiredPt / (s * PT_PER_CENTI_INCH);
}

// The sheet-fit scale (centi-inches per viewBox unit) a clone of viewBox `w×h` gets
// when nested into a plan box of `planW×planH` (centi-inches) with preserveAspectRatio
// "meet". `min` because "meet" fits the limiting dimension. Pure → testable, and the
// single source both export paths use so PNG and PDF thin identically.
export function sheetFitScale(viewW, viewH, planW, planH) {
  const sx = planW / viewW, sy = planH / viewH;
  return Math.min(sx, sy);
}
