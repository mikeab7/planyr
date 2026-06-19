/* Dimension-based calibration + auto-verification (B183 / NEW-4). Pure + browser-free,
 * so the geometry is unit-tested. All lengths are real-world feet unless noted.
 *
 * Three jobs, one rule — never trust a placement by eye:
 *   1. Calibration  — trace the two endpoints of a *labeled* dimension and type its
 *      value → derive scale (feet per drawn unit). Anchors to a number the drawing
 *      itself certifies, so it's preferred over two arbitrary calibration points and
 *      serves as cascade rung 4 (see placeOnMap.js).
 *   2. Verification — after ANY placement, measure a labeled dimension on the placed
 *      result and compare it to the printed value → surface a NUMBER ("column grid
 *      measures 24.0 ft, label 24'-0" — 0.1% off"), not an eyeball confirmation.
 *   3. Cross-check  — read two independent graphics (scale bar + a dimension, or two
 *      dimensions on different axes) and compare them to EACH OTHER. Agree → confident.
 *      Disagree → flag non-uniform scaling (the sheet was stretched more on one axis,
 *      so no single uniform scale is valid) as a DISTINCT state — never silently average.
 *
 * Severity: a confidently-wrong placement looks done and yields silently-wrong
 * measurements, so a failed verification is high-severity (the silent-failure rule).
 */

// Percent-off thresholds. Tight, because the whole point is catching a wrong scale.
export const OK_PCT = 0.5;    // ≤ this: confident (well within survey/plot tolerance)
export const WARN_PCT = 2;    // ≤ this: caution (re-pick endpoints or re-check the page)
export const CROSS_TOL_PCT = 1; // two independent reads within this of each other agree

/* Parse a stated dimension into feet. Handles civil/architectural forms:
 *   24'-0"  24' - 6"  570'  100'-6"  12.5'   24 ft   18 (bare → feet)
 * Returns a number (feet) or null. Bare numbers are accepted as feet only when the
 * whole string is numeric (a label like "24" with no unit is unambiguous enough). */
export function parseFeetInches(str) {
  if (typeof str === "number") return isFinite(str) ? str : null;
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  // feet + optional inches: 24'-0"  /  24' 6"  /  570'
  const fi = s.match(/^(-?\d+(?:\.\d+)?)\s*['’′](?:\s*-?\s*(\d+(?:\.\d+)?)\s*["”″]?)?/);
  if (fi) {
    const ft = parseFloat(fi[1]);
    const inch = fi[2] != null ? parseFloat(fi[2]) : 0;
    if (isFinite(ft) && isFinite(inch)) return ft + (ft < 0 ? -inch : inch) / 12;
  }
  // "100 ft" / "100 feet"
  const ft = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:ft|feet|')\b/i);
  if (ft) { const v = parseFloat(ft[1]); if (isFinite(v)) return v; }
  // bare number → feet
  if (/^-?\d+(?:\.\d+)?$/.test(s)) { const v = parseFloat(s); if (isFinite(v)) return v; }
  return null;
}

const round1 = (n) => Math.round(n * 10) / 10;

/* Calibration (cascade rung 4): feet-per-drawn-unit from a traced length whose real
 * value is known. drawnLen is in image/drawing units (px/points), realFt in feet. */
export function scaleFromDimension(drawnLen, realFt) {
  if (!(drawnLen > 0) || !(realFt > 0) || !isFinite(drawnLen) || !isFinite(realFt)) return null;
  return realFt / drawnLen;
}

/* Severity for a percent-off result. Placement accuracy is high-severity, so a frank
 * miss is flagged 'high' (it would otherwise produce silently-wrong measurements). */
export function severityFor(pctOff) {
  if (!isFinite(pctOff)) return "high";
  if (pctOff <= OK_PCT) return "none";
  if (pctOff <= WARN_PCT) return "low";
  return "high";
}

/* Verification: compare a length measured on the placed result to the printed value.
 * `stated` may be a number (feet) or a label string ("24'-0\""). Returns a result with
 * a ready-to-show one-line label, or null if either value is unusable. */
export function verifyDimension({ measuredFt, statedFt, stated, label } = {}) {
  const m = typeof measuredFt === "number" ? measuredFt : NaN;
  const sNum = typeof statedFt === "number" ? statedFt : parseFeetInches(stated);
  if (!isFinite(m) || sNum == null || !(sNum > 0)) return null;
  const deltaFt = m - sNum;
  const pctOff = Math.abs(deltaFt) / sNum * 100;
  const status = pctOff <= OK_PCT ? "ok" : pctOff <= WARN_PCT ? "warn" : "fail";
  const statedLabel = label || (typeof stated === "string" ? stated : `${round1(sNum)} ft`);
  return {
    measuredFt: m, statedFt: sNum, deltaFt, pctOff,
    status, severity: severityFor(pctOff),
    label: `measures ${round1(m)} ft, label ${statedLabel} — ${pctOff < 0.05 ? "0.0" : round1(pctOff)}% off`,
  };
}

/* Cross-check two INDEPENDENT scale reads against each other (scale bar vs a dimension,
 * or two dimensions on different axes). Each input is { scale (ft per drawn unit), axis?,
 * source? }. Agreement → one confident scale. Disagreement → a distinct 'nonuniform'
 * state carrying BOTH reads; the sheet was stretched unevenly so no single uniform scale
 * is valid — the caller must not average them. */
export function crossCheck(a, b, tolPct = CROSS_TOL_PCT) {
  const sa = a && a.scale, sb = b && b.scale;
  if (!(sa > 0) || !(sb > 0)) return { status: "insufficient", reads: [a, b].filter(Boolean) };
  const mean = (sa + sb) / 2;
  const pctDiff = Math.abs(sa - sb) / mean * 100;
  if (pctDiff <= tolPct) {
    return { status: "agree", pctDiff, scale: mean, reads: [a, b] };
  }
  // Name the axes when both reads are tagged, so the message can say which way it stretched.
  const axes = [a.axis, b.axis].filter(Boolean);
  return {
    status: "nonuniform", pctDiff, scale: null, reads: [a, b],
    note: `Two independent scale reads disagree by ${round1(pctDiff)}%${axes.length === 2 ? ` (${axes[0]} vs ${axes[1]})` : ""} — the sheet looks stretched unevenly. No single scale is valid; re-place against a boundary or pick one axis deliberately.`,
  };
}
