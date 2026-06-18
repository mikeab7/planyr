/* Metes-and-bounds plotter — pure, client-side (no API).
 *
 * Parses surveyor's bearing/distance calls from a legal description and turns
 * them into a path of {x,y} points in PLANNER FEET (the app's internal frame —
 * +x east, +y SOUTH, matching the SVG canvas). The planner anchors the first
 * point (point of beginning, POB); everything else is dead-reckoned from it.
 *
 * Handles the common Texas forms:
 *   "THENCE N 45°30'00" E, 150.00 feet"   "S 12-15 W 1234.5 ft"
 *   "N 0° E 100'"   "S 89°59'59" W, 250.00 varas"
 * Quadrant (NE/SE/SW/NW) bearings only — the dominant convention in TX deeds.
 * Distances in feet (default) or Texas varas (1 vara = 33⅓ in = 2.77778 ft).
 */

export const VARA_FT = 100 / 36; // Texas vara = 33 1/3 inches = 2.77778 ft

// One call: quadrant1, degrees, [minutes], [seconds], quadrant2, then a distance
// value + unit somewhere just after it (skip filler like "a distance of").
const CALL_RE = new RegExp(
  "([NS])\\s*([0-9]{1,3})\\s*(?:[°ºo*:d-]|deg(?:rees)?|\\s)?\\s*" + // quadrant + degrees (incl. dash-DMS "12-15")
  "([0-9]{1,2})?\\s*(?:['’′:m-]|min(?:utes)?)?\\s*" +             // minutes
  "([0-9]{1,2}(?:\\.[0-9]+)?)?\\s*(?:[\"”″s]|sec(?:onds)?)?\\s*" + // seconds
  "([EW])" +                                                      // quadrant2
  "[^0-9NSEW]{0,18}?" +                                           // filler (", a distance of")
  "([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?)\\s*" +                // distance value
  "(feet|foot|ft\\.?|'|varas?|vrs?\\.?|vr\\.?)",                  // unit
  "gi"
);

/* Parse a legal description into structured calls.
 * Returns [{ bearing:"N45°30'00\"E", deg, az, distFt, raw }]. `az` is azimuth in
 * degrees clockwise from north; `distFt` is the distance converted to feet. */
// Curve-call indicators near a match → the matched bearing/distance is the CHORD of
// an arc, not a straight leg. We keep the chord but flag it `curve:true` (B25).
const CURVE_RE = /(curv|radius|\barc\b|\bdelta\b|radial|chord\s+bears?|central\s+angle)/i;

export function parseCalls(text) {
  if (!text) return [];
  const out = [];
  const src = String(text).replace(/ /g, " ");
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(src))) {
    const [, q1, dd, mm, ss, q2, distRaw, unitRaw] = m;
    const deg = (+dd) + (mm ? +mm / 60 : 0) + (ss ? +ss / 3600 : 0);
    if (deg > 90) continue; // a quadrant bearing can't exceed 90° — skip a bogus call ("N 145 E") rather than plot a wrong direction (B26)
    const Q1 = q1.toUpperCase(), Q2 = q2.toUpperCase();
    // quadrant bearing → azimuth (clockwise from north)
    let az;
    if (Q1 === "N" && Q2 === "E") az = deg;
    else if (Q1 === "S" && Q2 === "E") az = 180 - deg;
    else if (Q1 === "S" && Q2 === "W") az = 180 + deg;
    else az = 360 - deg; // N..W
    const unit = unitRaw.toLowerCase();
    const isVara = unit.startsWith("v");
    const distFt = parseFloat(distRaw.replace(/,/g, "")) * (isVara ? VARA_FT : 1);
    if (!isFinite(distFt) || distFt <= 0) continue;
    // Is this the chord of a curve? Look only within the current clause (since the
    // last ";" / "." / "THENCE") so a previous curve doesn't taint a later straight leg (B25).
    const before = src.slice(0, m.index), lc = before.toLowerCase();
    const clauseStart = Math.max(before.lastIndexOf(";"), before.lastIndexOf("."), lc.lastIndexOf("thence"));
    const ctx = src.slice(clauseStart >= 0 ? clauseStart : Math.max(0, m.index - 120), m.index);
    const curve = CURVE_RE.test(ctx);
    const mins = mm ? `${mm}'` : "";
    const secs = ss ? `${ss}"` : "";
    out.push({
      bearing: `${Q1}${dd}°${mins}${secs}${Q2}`,
      deg, az, distFt, isVara, curve,
      label: `${Q1} ${dd}°${mm ? ` ${mm}'` : ""}${ss ? ` ${ss}"` : ""} ${Q2}  ${fmtDist(distFt)}`,
      raw: m[0].trim(),
    });
  }
  return out;
}

const fmtDist = (ft) => `${ft.toFixed(2).replace(/\.00$/, "")}′`;

/* Dead-reckon the calls from a POB into a path of feet points (planner frame:
 * +y is south, so north subtracts y). Returns [{x,y}, ...] incl. the POB. */
export function callsToPath(calls, pob) {
  const pts = [{ x: pob.x, y: pob.y }];
  let cur = { ...pob };
  for (const c of calls) {
    const a = (c.az * Math.PI) / 180;
    cur = { x: cur.x + c.distFt * Math.sin(a), y: cur.y - c.distFt * Math.cos(a) };
    pts.push(cur);
  }
  return pts;
}

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* Does the traverse close back on the POB? (within `tol` ft, or 2% of the run). */
export function pathCloses(pts, tol) {
  if (pts.length < 4) return false;
  let perim = 0;
  for (let i = 1; i < pts.length; i++) perim += dist2(pts[i - 1], pts[i]);
  const t = tol ?? Math.max(5, perim * 0.02); // honest closure: drop the 25-ft absolute floor that let a small lot "close" with 25 ft of misclosure (B26)
  return dist2(pts[0], pts[pts.length - 1]) <= t;
}

// The misclosure (gap from last point back to POB), in feet.
export const misclosure = (pts) => (pts.length >= 2 ? dist2(pts[0], pts[pts.length - 1]) : 0);

/* Offset an OPEN polyline by `dist` feet along its left-hand normal (a NEGATIVE
 * `dist` offsets to the right side). Joins are mitered and the miter is clamped so
 * a tight corner doesn't blow out into a spike. Returns a polyline with one point
 * per input vertex (or null if < 2 points).
 *
 * This is the SHARED offset primitive behind every easement/setback strip: the
 * symmetric corridor (bufferPolyline, ±half each side) and the one-sided
 * parcel-edge / building-line strip (offset to a single side). Built once here so
 * the centerline tool, the parcel-edge tool, and a future setback tool reuse the
 * exact same corner math (NEW-1 / NEW-3). */
export function offsetPolyline(pts, dist) {
  if (!pts || pts.length < 2) return null;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    seg.push({ nx: -dy / len, ny: dx / len }); // left normal of this segment
  }
  const normalAt = (i) => {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i)];
    let nx = a.nx + b.nx, ny = a.ny + b.ny;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    // miter length grows in tight corners; clamp so it doesn't blow out
    const cos = a.nx * b.nx + a.ny * b.ny;
    const scale = Math.min(1 / Math.max(0.3, Math.sqrt((1 + cos) / 2)), 3);
    return { nx: nx * scale, ny: ny * scale };
  };
  return pts.map((p, i) => { const n = normalAt(i); return { x: p.x + n.nx * dist, y: p.y + n.ny * dist }; });
}

/* Buffer an open polyline into a closed strip ring of total width `w` (a corridor
 * easement). Offsets each vertex by ±w/2 along the averaged segment normals
 * (miter join, clamped) and returns left-side-forward + right-side-back ring, with
 * flat end caps.
 *
 * ASYMMETRY-READY: pass `{ leftW, rightW }` to offset a different distance on each
 * side of the centerline. The default (no opts) stays the exact ±w/2 symmetric
 * strip every existing caller relies on, so a future asymmetric-easement UI needs
 * no geometry rework — just supply the two half-widths (NEW-1 engine note). */
export function bufferPolyline(pts, w, opts = {}) {
  if (!pts || pts.length < 2) return null;
  const leftW = opts.leftW != null ? opts.leftW : w / 2;
  const rightW = opts.rightW != null ? opts.rightW : w / 2;
  const left = offsetPolyline(pts, leftW);
  const right = offsetPolyline(pts, -rightW);
  if (!left || !right) return null;
  return [...left, ...right.reverse()];
}

/* --- overlap test: do two convex-ish polygons (rings of {x,y}) intersect? ---
 * Uses vertex-containment + edge-crossing (handles partial overlaps the bbox
 * test would miss). Good enough for "warn me if this easement crosses a
 * building/paving footprint". */
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, xi = ring[i].x, yj = ring[j].y, xj = ring[j].x;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

export function ringsOverlap(A, B) {
  if (!A?.length || !B?.length) return false;
  if (A.some((p) => pointInRing(p, B)) || B.some((p) => pointInRing(p, A))) return true;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const c = B[j], d = B[(j + 1) % B.length];
      if (segCross(a, b, c, d)) return true;
    }
  }
  return false;
}
