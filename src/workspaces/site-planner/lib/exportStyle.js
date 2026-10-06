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

// GIS OVERLAY line work on the sheet (B2095745). The generic retarget above is tuned for the plan's own
// strokes (object line 0.6 pt) and was ALSO applied to the GIS layers drawn over the aerial, which print
// as thin ~0.6 pt lines at the layer's on-screen alpha (<= 0.55) — invisible over a dark aerial. An overlay
// is reference ink on a PHOTO, so it needs the opposite treatment: a firm weight, a pale casing under it,
// and an opacity floor. All numbers are physical (points on paper), independent of the zoom at print time.
export const OVERLAY_PRINT = { ptPerPx: 0.8, minPt: 1.0, maxPt: 2.4, casingExtraPt: 1.6, casingOpacity: 0.6, minOpacity: 0.85,
  pointPtPerPx: 0.8, pointMinPt: 2.4, pointMaxPt: 4.5, pointKeylinePt: 0.7 };

const unitsPerPt = (sheetScale) => 1 / (sheetScale * PT_PER_CENTI_INCH);

// Printed line weight (pt) for a GIS overlay stroke authored at `sw` screen px.
export function overlayLinePt(sw) {
  const w = Number(sw);
  const base = w > 0 ? w : 1.5;
  return Math.max(OVERLAY_PRINT.minPt, Math.min(OVERLAY_PRINT.maxPt, base * OVERLAY_PRINT.ptPerPx));
}
// Same, in clone/viewBox units, for a sheet scale. `casing` adds the pale underlay's extra width.
export function overlayStrokeWidth(sw, sheetScale, { casing = false } = {}) {
  const s = Number(sheetScale);
  if (!(s > 0)) return Number(sw);
  const pt = overlayLinePt(sw) + (casing ? OVERLAY_PRINT.casingExtraPt : 0);
  return pt * unitsPerPt(s);
}
// Printed point-marker radius (clone units) for a symbol authored at `r` screen px.
export function overlayPointRadius(r, sheetScale) {
  const s = Number(sheetScale), base = Number(r) > 0 ? Number(r) : 3.5;
  if (!(s > 0)) return base;
  const diaPt = Math.max(OVERLAY_PRINT.pointMinPt, Math.min(OVERLAY_PRINT.pointMaxPt, base * OVERLAY_PRINT.pointPtPerPx));
  return diaPt * unitsPerPt(s);
}
export const overlayKeylineWidth = (sheetScale) => (Number(sheetScale) > 0 ? OVERLAY_PRINT.pointKeylinePt * unitsPerPt(Number(sheetScale)) : 0.5);
export const overlayPrintOpacity = (op) => Math.max(OVERLAY_PRINT.minOpacity, Number.isFinite(Number(op)) ? Number(op) : 1);
