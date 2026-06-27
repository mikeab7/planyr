/* Shared MEASURE engine (B423 / NEW-2) — relocated from doc-review/lib/takeoff.js.
 *
 * Turns measurement markups (distance / polylength / perimeter / area / count) into
 * real-world values. The UNIT-SCALE SEAM is the `ftPerUnit` argument: the Document Review
 * sheet passes its per-page calibration (feet per PDF page-unit); the Site Planner, whose
 * canvas is already feet-native, passes 1 (feet in → feet out); the Stitcher passes its
 * stitched-set calibration. `0`/undefined means uncalibrated → the label reads "set scale".
 *
 * Pure: geometry comes from `geometry.js`, the acre conversion from the shared coordinate
 * units. The old path `doc-review/lib/takeoff.js` is now a thin re-export shim so existing
 * imports and tests keep working unchanged.
 */
import { ftToAcres } from "../coordinates/index.js";
import { dist, pathLength, polyArea } from "./geometry.js";

/* Minimum points needed to COMMIT each measurement kind. Area + perimeter describe a
 * polygon, so they need ≥3 distinct points — a 2-point "area" is 0 sf (shoelace) and a
 * 2-point "perimeter" is a single segment drawn back on itself, both meaningless. Distance
 * is a 2-point segment; count is ≥1 marker. (B302) `polylength` aliases the open polyline
 * measure (≥2). */
export const MIN_MEASURE_PTS = { distance: 2, polylength: 2, perimeter: 3, area: 3, count: 1 };
export const canCommitMeasure = (kind, n) => (n || 0) >= (MIN_MEASURE_PTS[kind] ?? 1);

/* Real-world value of one measurement markup, given the sheet's calibration (`ftPerUnit`,
 * feet per page unit; 0/undefined = uncalibrated). Returns { kind, calibrated, ...values }.
 * Area in sf + acres; lengths in ft; count int. */
export function measureValue(m, ftPerUnit) {
  const cal = !!ftPerUnit;
  const pts = (m && m.pts) || []; // guard degenerate/empty point sets
  if (m.kind === "distance" || m.kind === "dimension") {
    // `dimension` is distance + witness ticks (a Bluebeam-style annotation): same length
    // calc as distance, but keep its own kind so callers still render the ticked variant.
    // (B510 — without this branch a Dimension fell through and its label read "—".)
    if (pts.length < 2) return { kind: m.kind, calibrated: false, lengthFt: null, raw: 0 };
    const u = dist(pts[0], pts[1]);
    return { kind: m.kind, calibrated: cal, lengthFt: cal ? u * ftPerUnit : null, raw: u };
  }
  if (m.kind === "polylength") {
    const u = pathLength(pts, false);
    return { kind: "polylength", calibrated: cal, lengthFt: cal ? u * ftPerUnit : null, raw: u };
  }
  if (m.kind === "perimeter") {
    const u = pathLength(pts, true);
    return { kind: "perimeter", calibrated: cal, lengthFt: cal ? u * ftPerUnit : null, raw: u };
  }
  if (m.kind === "area") {
    const u = polyArea(pts);
    const sf = cal ? u * ftPerUnit * ftPerUnit : null;
    return { kind: "area", calibrated: cal, areaSf: sf, areaAc: sf == null ? null : ftToAcres(sf), raw: u };
  }
  if (m.kind === "count") return { kind: "count", calibrated: true, count: pts.length };
  return { kind: m.kind, calibrated: cal };
}

const f0 = (n) => Math.round(n).toLocaleString();
// One-decimal feet for LINEAR measures: whole-foot rounding hid sub-foot precision (a 150.6
// ft line read "151 ft") and clashed with the 2-dp acres shown for area. (B296)
const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Human label for a measurement, e.g. "150.6 ft", "1.83 ac · 79,715 sf", "42". `opts` is
 * reserved for future formatting overrides (precision, unit suffix) — defaults match the
 * historical takeoff output exactly. */
export function measureLabel(m, ftPerUnit, opts = {}) {
  const v = measureValue(m, ftPerUnit);
  if (v.kind === "count") return `${v.count}`;
  if (!v.calibrated) return "set scale";
  if (v.kind === "area") return Number.isFinite(v.areaSf) ? `${f2(v.areaAc)} ac · ${f0(v.areaSf)} sf` : "—";
  return Number.isFinite(v.lengthFt) ? `${f1(v.lengthFt)} ft` : "—";
}

const MEASURE_KINDS = new Set(Object.keys(MIN_MEASURE_PTS));

/* Roll up all measurements into yield-style totals. `cal` is either a per-page calibration
 * OBJECT (legacy `calByPage`, indexed by m.page) OR a FUNCTION (m) => ftPerUnit (the
 * generalized unit-scale seam — Site passes `() => 1`). Skips non-measure markups and
 * uncalibrated length/area items (count is always calibrated). (B351-adjacent; B423.) */
export function rollup(markups, cal) {
  const calFor = typeof cal === "function" ? cal : (m) => cal[m.page];
  let areaSf = 0, perimFt = 0, distFt = 0, count = 0, uncal = 0;
  for (const m of markups) {
    if (!m || !MEASURE_KINDS.has(m.kind)) continue; // redline shapes / text notes aren't measurements
    const v = measureValue(m, calFor(m));
    if (v.kind === "count") { count += v.count; continue; }
    if (!v.calibrated) { uncal++; continue; }
    if (v.kind === "area") areaSf += v.areaSf;
    else if (v.kind === "perimeter") perimFt += v.lengthFt;
    else if (v.kind === "distance" || v.kind === "polylength") distFt += v.lengthFt;
  }
  return { areaSf, areaAc: ftToAcres(areaSf), perimFt, distFt, count, uncal };
}
