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
 *   plus whole spelled-out survey descriptions ("North 87°04'16" East, … for a
 *   total distance of 1773.49 feet;"), curve courses, and SAVE-AND-EXCEPT tracts.
 * Quadrant (NE/SE/SW/NW) bearings only — the dominant convention in TX deeds.
 * Distances in feet (default) or Texas varas (1 vara = 33⅓ in = 2.77778 ft).
 */

export const VARA_FT = 100 / 36; // Texas vara = 33 1/3 inches = 2.77778 ft

const fmtDist = (ft) => `${ft.toFixed(2).replace(/\.00$/, "")}′`;

/* ── Real-deed metes-and-bounds parser ───────────────────────────────────────
 * Built to read a whole surveyed legal description (Word/PDF/pasted), not just a
 * tidy "N 45 E, 150 ft" string. It copes with how Texas surveys are actually
 * written:
 *   • spelled-out bearings ("North 87°04'16" East") as well as "N 87°04'16" E";
 *   • a governing leg distance that sits a PARAGRAPH away from its bearing
 *     ("…for a total distance of 1773.49 feet") with intervening "passing at X"
 *     waypoints and "(0.14 feet left)" offset notes that are NOT the leg length;
 *   • curve courses given as a chord ("a long chord bearing N69°56'26" W, 17.15
 *     feet") with radius / central angle / arc length;
 *   • multiple tracts — a main boundary plus "SAVE AND EXCEPT" exception tracts,
 *     each possibly located by a "COMMENCING" tie traverse.
 * Misclosure-tolerant by design: it returns whatever it can read; the caller
 * decides closure and shows the gap honestly. */

// A quadrant bearing: N/North … E/East, with optional DMS (dash-DMS "12-15" too).
const BEARING_SRC =
  "(N(?:orth)?|S(?:outh)?)\\s*([0-9]{1,3})\\s*(?:[°ºo*:d-]|deg(?:rees)?|\\s)?\\s*" + // quadrant + degrees
  "([0-9]{1,2})?\\s*(?:['’′:m-]|min(?:utes)?)?\\s*" +                                // minutes
  "([0-9]{1,2}(?:\\.[0-9]+)?)?\\s*(?:[\"”″s]|sec(?:onds)?)?\\s*" +                    // seconds
  "(E(?:ast)?|W(?:est)?)";                                                           // quadrant2
const BEARING_RE = new RegExp(BEARING_SRC, "gi");
// A distance value + unit. The trailing (?![0-9]) stops a bearing's minute tick
// ("13'45") from being misread as "13 feet".
const DIST_SRC = "([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(feet|foot|ft\\.?|'|varas?|vrs?\\.?|vr\\.?)(?![0-9])";

// Quadrant bearing → azimuth (deg clockwise from north). null if degrees > 90
// (a quadrant bearing can't exceed 90° — a bogus "N 145 E" is rejected, B26).
function bearingToAz(q1, dd, mm, ss, q2) {
  const deg = (+dd) + (mm ? +mm / 60 : 0) + (ss ? +ss / 3600 : 0);
  if (deg > 90) return null;
  const A = q1[0].toUpperCase(), B = q2[0].toUpperCase();
  let az;
  if (A === "N" && B === "E") az = deg;
  else if (A === "S" && B === "E") az = 180 - deg;
  else if (A === "S" && B === "W") az = 180 + deg;
  else az = 360 - deg; // N..W
  return { deg, az, A, B };
}

const distVal = (numStr, unit) => {
  const v = parseFloat(String(numStr).replace(/,/g, "")) * (unit[0].toLowerCase() === "v" ? VARA_FT : 1);
  return isFinite(v) && v > 0 ? v : null;
};

function mkCall({ A, B, dd, mm, ss, deg, az, distFt, curve, curveMeta, raw }) {
  const mins = mm ? `${mm}'` : "", secs = ss ? `${ss}"` : "";
  return {
    bearing: `${A}${dd}°${mins}${secs}${B}`,
    deg, az, distFt, curve: !!curve, curveMeta: curveMeta || null,
    label: `${A} ${dd}°${mm ? ` ${mm}'` : ""}${ss ? ` ${ss}"` : ""} ${B}  ${fmtDist(distFt)}`,
    raw: String(raw || "").trim().replace(/\s+/g, " ").slice(0, 140),
  };
}

// The governing leg length within a course's text AFTER its bearing: prefer a
// distance introduced by "…distance of X" or one that ends the leg ("X feet to a
// corner"); skip "passing at X" waypoints, "(… feet …)" offset notes (already
// stripped), and monument tie calls ("…bears … , X feet").
function governingDist(after) {
  const D = new RegExp(DIST_SRC, "gi");
  let m, leg = null, fallback = null;
  while ((m = D.exec(after))) {
    const v = distVal(m[1], m[2]);
    if (v == null) continue;
    const pre = after.slice(Math.max(0, m.index - 26), m.index).toLowerCase();
    const post = after.slice(m.index + m[0].length, m.index + m[0].length + 8).toLowerCase();
    const passing = /passing/.test(pre);
    const tie = /\bbears?\b/.test(pre);
    const legEnd = /^[\s,;]*to\b/.test(post);
    const distOf = /distance\s+of\s*$/.test(pre.replace(/\s+/g, " "));
    if (legEnd || distOf) leg = v;        // last leg-end / "distance of" wins
    if (!passing && !tie) fallback = v;   // else the last plain distance
  }
  return leg != null ? leg : fallback;
}

const num = (s) => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) ? v : null; };
function numAfter(text, re) {
  const i = text.search(re);
  if (i < 0) return null;
  const m = text.slice(i).match(/([0-9][0-9,]*(?:\.[0-9]+)?)/);
  return m ? num(m[1]) : null;
}
function dmsAfter(text, re) {
  const i = text.search(re);
  if (i < 0) return null;
  const m = text.slice(i, i + 70).match(/([0-9]{1,3})\s*[°ºo*:d]\s*([0-9]{1,2})?\s*['’′:m]?\s*([0-9]{1,2}(?:\.[0-9]+)?)?/);
  if (!m) return null;
  return (+m[1]) + (m[2] ? +m[2] / 60 : 0) + (m[3] ? +m[3] / 3600 : 0);
}

// A straight course: first bearing + its governing distance.
function parseStraightCourse(clean) {
  BEARING_RE.lastIndex = 0;
  const b = BEARING_RE.exec(clean);
  if (!b) return null;
  const ba = bearingToAz(b[1], b[2], b[3], b[4], b[5]);
  if (!ba) return null;
  const distFt = governingDist(clean.slice(b.index + b[0].length));
  if (distFt == null) return null;
  return mkCall({ A: ba.A, B: ba.B, dd: b[2], mm: b[3], ss: b[4], deg: ba.deg, az: ba.az, distFt, curve: false, raw: clean });
}

// A curve course: use the long-chord bearing + chord distance as the straight
// approximation, and keep radius / central angle / arc length / turn alongside.
const CHORD_RE = new RegExp("chord\\s+(?:bearing|bears?|of)?\\s*" + BEARING_SRC + "\\s*[, ]\\s*" + DIST_SRC, "i");
function parseCurveCourse(clean) {
  const c = CHORD_RE.exec(clean);
  if (!c) return parseStraightCourse(clean); // a curve with no readable chord → best-effort straight
  const ba = bearingToAz(c[1], c[2], c[3], c[4], c[5]);
  const distFt = distVal(c[6], c[7]);
  if (!ba || distFt == null) return null;
  const curveMeta = {
    radiusFt: numAfter(clean, /radius\s+of\s+/i),
    arcFt: numAfter(clean, /arc\s+(?:length|distance)\s+of\s+/i),
    centralAngleDeg: dmsAfter(clean, /(?:central\s+angle|delta)\s*(?:of\s+)?/i),
    turn: /curve\s+to\s+the\s+right/i.test(clean) ? "R" : /curve\s+to\s+the\s+left/i.test(clean) ? "L" : "",
  };
  return mkCall({ A: ba.A, B: ba.B, dd: c[2], mm: c[3], ss: c[4], deg: ba.deg, az: ba.az, distFt, curve: true, curveMeta, raw: clean });
}

const isCurveCourse = (clean) => /\bradius\s+of\s+[0-9]/i.test(clean) || /\balong\s+the\s+arc\b/i.test(clean);

function parseCourse(seg) {
  const clean = seg.replace(/\([^()]*\)/g, " "); // drop offset notes / volume refs
  return isCurveCourse(clean) ? parseCurveCourse(clean) : parseStraightCourse(clean);
}

const normalize = (text) => String(text).replace(/^﻿/, "").replace(/[   ]/g, " ");

// Split a tract's text into courses. Each THENCE leg and each sub-course in a
// "the following N courses and distances:" list is its own segment — surveys put
// them on their own line/sentence, so splitting on THENCE + line breaks isolates
// each course (a blob with no line breaks still splits on THENCE).
function coursesOf(text) {
  const out = [];
  for (const seg of text.split(/\bTHENCE\b|[\r\n]+/i)) {
    if (!seg || seg.length < 4) continue;
    const c = parseCourse(seg);
    if (c) out.push(c);
  }
  return out;
}

/* Parse a legal description into its tracts. The first tract is the main
 * `boundary`; each "SAVE AND EXCEPT" tract is an `except` (a hole). An exception
 * located by a "COMMENCING" tie keeps that tie's courses separately (so the
 * caller can place the hole relative to the main POB). Returns
 *   [{ role:"boundary"|"except", label, calls:[…], tie:[…] }]. */
export function parseTracts(text) {
  if (!text) return [];
  const norm = normalize(text);
  // Split only on a real tract header — an uppercase "SAVE AND EXCEPT" at line
  // start — never the lower-case "save and except" inside a prose sentence.
  const pieces = norm.split(/(?:\r?\n)[ \t]*SAVE\s+(?:AND|&)\s+EXCEPT\b/);
  const tracts = [];
  pieces.forEach((piece, i) => {
    let body = piece, tie = [];
    if (/\bCOMMENCING\b/i.test(piece)) {
      const pobIdx = piece.search(/POINT\s+OF\s+BEGINNING/i);
      if (pobIdx >= 0) { tie = coursesOf(piece.slice(0, pobIdx)); body = piece.slice(pobIdx); }
    }
    const calls = coursesOf(body);
    if (!calls.length) return;
    const acre = piece.match(/([0-9]+(?:\.[0-9]+)?)\s*acre/i);
    const label = (piece.match(/Tract\s+\d[^\n]{0,40}/i) || [])[0]?.trim()
      || (acre ? `${acre[1]} acres` : (i === 0 ? "Boundary" : `Exception ${i}`));
    tracts.push({ role: i === 0 ? "boundary" : "except", label, calls, tie });
  });
  return tracts;
}

/* Back-compatible: the flat call list for the MAIN boundary tract. Existing
 * callers (single-tract paste, the preview, the simple plot) keep working; a
 * multi-tract deed plots its main boundary by default. */
export function parseCalls(text) {
  const tracts = parseTracts(text);
  return tracts.length ? tracts[0].calls : [];
}

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
