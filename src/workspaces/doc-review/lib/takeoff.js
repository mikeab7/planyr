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

const avgOf = (pts) => pts.reduce((s, q) => ({ x: s.x + q.x / pts.length, y: s.y + q.y / pts.length }), { x: 0, y: 0 });

/* Midpoint ALONG a polyline by arc length — the true center of the drawn path,
 * not a vertex. `closed` walks the closing edge too (for a perimeter loop). Used
 * to anchor distance/perimeter labels so a 2-point line labels at its middle, not
 * its first endpoint (B303). */
export function midOfPath(pts, closed = false) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  const seq = closed ? [...pts, pts[0]] : pts;
  const segs = [];
  let total = 0;
  for (let i = 1; i < seq.length; i++) { const L = dist(seq[i - 1], seq[i]); segs.push(L); total += L; }
  if (total === 0) return { x: seq[0].x, y: seq[0].y };
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      return { x: seq[i].x + (seq[i + 1].x - seq[i].x) * t, y: seq[i].y + (seq[i + 1].y - seq[i].y) * t };
    }
    half -= segs[i];
  }
  const last = seq[seq.length - 1];
  return { x: last.x, y: last.y };
}

// Ray-cast point-in-polygon (helper for centroidOf's interior clamp).
function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/* Label anchor for a filled polygon: the AREA-weighted centroid, clamped to lie
 * inside the shape. A concave / L-shaped region's centroid can fall outside the
 * outline; when it does we drop to the midpoint of the widest interior span on a
 * horizontal scanline through it, so the area label always sits on the shape (B303).
 * Falls back to the vertex average for degenerate input. */
export function centroidOf(pts) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  if (pts.length < 3) return avgOf(pts);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return avgOf(pts);
  const c = { x: cx / (6 * a), y: cy / (6 * a) };
  if (pointInPoly(c, pts)) return c;
  // Centroid sits outside (concave) → take the widest interior span at y = c.y.
  const ys = c.y, xs = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y, yj = pts[j].y;
    if ((yi > ys) !== (yj > ys)) xs.push(pts[j].x + ((pts[i].x - pts[j].x) * (ys - yj)) / ((yi - yj) || 1e-12));
  }
  xs.sort((p, q) => p - q);
  let best = null, bw = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) { const w = xs[i + 1] - xs[i]; if (w > bw) { bw = w; best = (xs[i] + xs[i + 1]) / 2; } }
  return best == null ? avgOf(pts) : { x: best, y: ys };
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
// shown for area — takeoff wants the extra digit. (B296)
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
