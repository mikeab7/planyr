/* Takeoff geometry + unit conversion for Document Review. All measurement
 * geometry is computed in PAGE UNITS (PDF points, scale-1); calibration converts
 * page units → real feet per sheet. Real-world unit helpers come from the SHARED
 * coordinate module so the takeoff and the Site Planner speak the same units. */
import { ftToAcres } from "../../../shared/coordinates/index.js";

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts, closed) {
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

export function polyArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/* Real-world value of one measurement markup, given the sheet's calibration
 * (`ftPerUnit`, feet per page unit; 0/undefined = uncalibrated). Returns
 * { kind, calibrated, ...values }. Area in sf + acres; lengths in ft; count int. */
export function measureValue(m, ftPerUnit) {
  const cal = !!ftPerUnit;
  const pts = (m && m.pts) || []; // guard degenerate/empty point sets (was crashing on m.pts[0].x)
  if (m.kind === "distance") {
    if (pts.length < 2) return { kind: "distance", calibrated: false, lengthFt: null, raw: 0 };
    const u = dist(pts[0], pts[1]);
    return { kind: "distance", calibrated: cal, lengthFt: cal ? u * ftPerUnit : null, raw: u };
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
// One-decimal feet for LINEAR measures (distance/perimeter): whole-foot rounding hid
// sub-foot precision (a 150.6 ft line read "151 ft") and clashed with the 2-dp acres
// shown for area — takeoff wants the extra digit. (B291)
const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Human label for a measurement, e.g. "150.6 ft", "1.83 ac (79,715 sf)", "42".
export function measureLabel(m, ftPerUnit) {
  const v = measureValue(m, ftPerUnit);
  if (v.kind === "count") return `${v.count}`;
  if (!v.calibrated) return "set scale";
  if (v.kind === "area") return Number.isFinite(v.areaSf) ? `${f2(v.areaAc)} ac · ${f0(v.areaSf)} sf` : "—";
  return Number.isFinite(v.lengthFt) ? `${f1(v.lengthFt)} ft` : "—";
}

/* Roll up all measurements (across the supplied list) into yield-style totals,
 * using each markup's sheet calibration. Skips uncalibrated length/area items. */
export function rollup(markups, calByPage) {
  let areaSf = 0, perimFt = 0, distFt = 0, count = 0, uncal = 0;
  for (const m of markups) {
    const ftPerUnit = calByPage[m.page];
    const v = measureValue(m, ftPerUnit);
    if (v.kind === "count") { count += v.count; continue; }
    if (!v.calibrated) { uncal++; continue; }
    if (v.kind === "area") areaSf += v.areaSf;
    else if (v.kind === "perimeter") perimFt += v.lengthFt;
    else if (v.kind === "distance") distFt += v.lengthFt;
  }
  return { areaSf, areaAc: ftToAcres(areaSf), perimFt, distFt, count, uncal };
}
