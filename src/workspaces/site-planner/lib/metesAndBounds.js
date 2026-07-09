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

// A quadrant bearing: N/North … E/East, with optional DMS. Handles the compact form
// (N 45°30'00" E, dash-DMS 12-15, letters 45d30m00s) AND the spelled-out survey form
// (NORTH 02 DEG. 29 MIN. 38 SEC. WEST, North 87 degrees 04 minutes 16 seconds East).
// Each unit separator matches its spelled-out word (optional trailing period) BEFORE the
// single-char fallbacks — else the bare `d` ate the "D" of "DEG" and the "E" was misread as
// the East quadrant, so a "…SEC. WEST" call silently plotted East, dropping minutes/seconds.
const BEARING_SRC =
  "(N(?:orth)?|S(?:outh)?)\\s*([0-9]{1,3})" +
  "\\s*(?:deg(?:rees)?\\.?|[°ºo*:d-])?\\s*" +                          // degrees + separator
  "([0-9]{1,2})?\\s*(?:min(?:utes)?\\.?|['’′:m-])?\\s*" +              // minutes + separator
  "([0-9]{1,2}(?:\\.[0-9]+)?)?\\s*(?:sec(?:onds)?\\.?|[\"”″s])?\\s*" + // seconds + separator
  "(E(?:ast)?|W(?:est)?)";                                                           // quadrant2
const BEARING_RE = new RegExp(BEARING_SRC, "gi");
// A distance value + unit. The trailing (?![0-9]) stops a bearing's minute tick
// ("13'45") from being misread as "13 feet".
const DIST_SRC = "([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(feet|foot|ft\\.?|'|varas?|vrs?\\.?|vr\\.?)(?![0-9])";

// Quadrant bearing → azimuth (deg clockwise from north). null if degrees > 90
// (a quadrant bearing can't exceed 90° — a bogus "N 145 E" is rejected, B26).
function bearingToAz(q1, dd, mm, ss, q2) {
  if ((mm && +mm >= 60) || (ss && +ss >= 60)) return null; // malformed DMS (minutes/seconds must be < 60)
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
    // last leg-end / "distance of" wins — but a "passing at X" waypoint or a
    // monument tie ("…bears …, X feet to a found rod") can also be followed by
    // "to", so the leg-end rule must exclude those too (not just the fallback).
    if ((legEnd && !passing && !tie) || distOf) leg = v;
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
// Allow a few filler words between "chord" and the bearing — "long chord bearing
// N…", "chord which bears N…", "chord of said curve bears N…", "chord bearing of N…".
const CHORD_RE = new RegExp("chord\\s+(?:\\w+\\s+){0,3}?(?:bearing|bears?|of)?\\s*" + BEARING_SRC + "\\s*[, ]\\s*" + DIST_SRC, "i");
const curveMetaOf = (clean) => ({
  radiusFt: numAfter(clean, /radius\s+of\s+/i),
  arcFt: numAfter(clean, /arc\s+(?:length|distance)\s+of\s+/i),
  centralAngleDeg: dmsAfter(clean, /(?:central\s+angle|delta)\s*(?:of\s+)?/i),
  turn: /curve\s+to\s+the\s+right/i.test(clean) ? "R" : /curve\s+to\s+the\s+left/i.test(clean) ? "L" : "",
});
function parseCurveCourse(clean) {
  const meta = curveMetaOf(clean);
  const c = CHORD_RE.exec(clean);
  if (c) {
    const ba = bearingToAz(c[1], c[2], c[3], c[4], c[5]);
    const distFt = distVal(c[6], c[7]);
    if (ba && distFt != null) {
      return mkCall({ A: ba.A, B: ba.B, dd: c[2], mm: c[3], ss: c[4], deg: ba.deg, az: ba.az, distFt, curve: true, curveMeta: meta, raw: clean });
    }
  }
  // No readable chord clause — fall back to the first bearing + governing distance,
  // but still FLAG it a curve (and keep the arc meta) so the UI warns to verify.
  const s = parseStraightCourse(clean);
  if (s) { s.curve = true; s.curveMeta = meta; }
  return s;
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
  // Cut at a REAL "SAVE AND EXCEPT" tract header only — an uppercase phrase at a
  // line start that is actually followed by a new tract (a COMMENCING/BEGINNING
  // course within the next breath). This rejects both lower-case prose
  // ("…save and except a 12.584 acre tract…") and an upper-case phrase used in
  // prose with no tract after it (which would otherwise steal the boundary's
  // remaining legs into a phantom exception).
  const HDR = /(?:\r?\n)[ \t]*SAVE\s+(?:AND|&)\s+EXCEPT\b/g;
  const cand = [];
  let hm;
  while ((hm = HDR.exec(norm))) cand.push(hm.index);
  // A candidate is a REAL exception header iff its segment (to the next candidate
  // or the end) actually starts a new traverse — a "COMMENCING" or "BEGINNING at"
  // — not merely the phrase used in prose ("…BEGINNING," / "POINT OF BEGINNING"
  // closings don't count), which would otherwise steal the boundary's own legs.
  const cuts = [0];
  for (let k = 0; k < cand.length; k++) {
    const segEnd = k + 1 < cand.length ? cand[k + 1] : norm.length;
    if (/\bCOMMENCING\b|\bBEGINNING\s+at\b/i.test(norm.slice(cand[k], segEnd))) cuts.push(cand[k]);
  }
  cuts.push(norm.length);
  const tracts = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const piece = norm.slice(cuts[i], cuts[i + 1]);
    let body = piece, tie = [];
    if (/\bCOMMENCING\b/i.test(piece)) {
      const pobIdx = piece.search(/POINT\s+OF\s+BEGINNING/i);
      if (pobIdx >= 0) { tie = coursesOf(piece.slice(0, pobIdx)); body = piece.slice(pobIdx); }
    }
    const calls = coursesOf(body);
    if (!calls.length) continue;
    // Label from a real heading ("Tract 1 – 94.91 Acres") or the stated acreage —
    // never a stray "tract 6 & 7" from body prose.
    const hdr = piece.match(/(?:^|\n)[ \t]*(Tract\s+\d[^\n]*?(?:[–-]|Acre)[^\n]{0,30})/i);
    const acre = piece.match(/([0-9]+(?:\.[0-9]+)?)\s*acre/i);
    const label = (hdr ? hdr[1].trim() : null) || (acre ? `${acre[1]} acres` : (i === 0 ? "Boundary" : `Exception ${i}`));
    tracts.push({ role: i === 0 ? "boundary" : "except", label, calls, tie });
  }
  return tracts;
}

/* Back-compatible: the flat call list for the MAIN boundary tract. Existing
 * callers (single-tract paste, the preview, the simple plot) keep working; a
 * multi-tract deed plots its main boundary by default. */
export function parseCalls(text) {
  const tracts = parseTracts(text);
  return tracts.length ? tracts[0].calls : [];
}

/* Tessellate the TRUE circular arc of a curve course into points (planner frame).
 * Given the arc's start (p0) and end (p1 = the chord endpoint) plus the curve's
 * stated radius / central angle / turn direction, reconstruct the circle and walk
 * the minor arc from p0 to p1 — so a plotted boundary follows the real curve, not a
 * straight chord. Returns the intermediate points ENDING at p1 (so the next course
 * continues from the chord endpoint exactly). Falls back to [p1] (a straight chord)
 * when there's no usable radius/angle or the geometry is degenerate (chord > 2R).
 *
 * Frame: +x east, +y south. `turn:"R"` (curve to the right) puts the centre on the
 * traveller's right; `turn:"L"` on the left. The minor arc bulges away from centre. */
export function arcChordPoints(p0, p1, meta) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const c = Math.hypot(dx, dy);
  let R = meta && meta.radiusFt ? +meta.radiusFt : 0;
  const deltaDeg = meta && meta.centralAngleDeg ? +meta.centralAngleDeg : 0;
  if ((!R || R <= 0) && deltaDeg > 0) {
    const half = (deltaDeg * Math.PI) / 360;
    if (Math.sin(half) > 1e-9) R = c / (2 * Math.sin(half)); // derive R from chord + delta
  }
  if (!R || R <= 0 || c <= 1e-9 || c > 2 * R + 1e-6) return [{ x: p1.x, y: p1.y }];
  const m = Math.sqrt(Math.max(0, R * R - (c / 2) * (c / 2))); // apothem (centre↔chord midpoint)
  const px = -dy / c, py = dx / c;                              // left normal of p0→p1
  const sign = meta && meta.turn === "L" ? -1 : 1;              // R → centre on the right
  const cx = (p0.x + p1.x) / 2 + sign * m * px;
  const cy = (p0.y + p1.y) / 2 + sign * m * py;
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;   // sweep the minor arc (the deed's central angle)
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(8, Math.min(48, Math.round(Math.abs(da) / (4 * Math.PI / 180)))); // ~1 pt / 4°
  const out = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (da * i) / n;
    out.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return out; // last point ≈ p1 exactly
}

/* Dead-reckon the calls from a POB into a path of feet points (planner frame:
 * +y is south, so north subtracts y). Curve courses are tessellated into their
 * true arc; straight courses add one vertex. Returns [{x,y}, ...] incl. the POB. */
export function callsToPath(calls, pob) {
  const pts = [{ x: pob.x, y: pob.y }];
  let cur = { ...pob };
  for (const c of calls) {
    const a = (c.az * Math.PI) / 180;
    const end = { x: cur.x + c.distFt * Math.sin(a), y: cur.y - c.distFt * Math.cos(a) };
    if (c.curve && c.curveMeta && ((c.curveMeta.radiusFt > 0) || (c.curveMeta.centralAngleDeg > 0))) {
      for (const p of arcChordPoints(cur, end, c.curveMeta)) pts.push(p);
    } else {
      pts.push(end);
    }
    cur = end; // the next course starts at the chord endpoint either way
  }
  return pts;
}

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* Does the traverse close back on the POB? (within `tol` ft, or 2% of the run). */
export function pathCloses(pts, tol) {
  if (pts.length < 4) return false;
  let perim = 0;
  for (let i = 1; i < pts.length; i++) perim += dist2(pts[i - 1], pts[i]);
  const t = tol ?? Math.min(Math.max(5, perim * 0.005), 50); // ≤0.5% of run, capped at 50 ft — keeps the 5-ft floor for small lots (B26) but stays honest on a big rural tract (2% of a 10k-ft perimeter was ~200 ft, masking real misclosure)
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
