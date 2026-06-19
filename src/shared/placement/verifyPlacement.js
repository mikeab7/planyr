/* Placement calibration + auto-verification (B179 / NEW-4).
 *
 * Pure, browser-free geometry. Three jobs, all high-severity because a confidently-wrong
 * placement LOOKS done and then produces silently-wrong measurements forever after:
 *
 *  1. Calibration from a labeled dimension — derive feet-per-unit by tracing the two
 *     endpoints of a dimension the drawing itself certifies (preferred over two arbitrary
 *     points: it anchors to a value the sheet vouches for). This is cascade rung 4.
 *  2. Auto-verification probe — after ANY placement method, measure a labeled dimension on
 *     the placed result and compare to its printed value, surfacing a NUMBER
 *     ("measures 24.0 ft, label 24'-0" — 0.1% off"), never an eyeball confirmation.
 *  3. Cross-check — read two independent graphics (scale bar + a dimension, or two
 *     dimensions on different axes) and compare them to EACH OTHER. Agreement → confident.
 *     Disagreement → flag non-uniform scaling (the sheet was stretched more in one axis,
 *     so no single uniform scale is valid) as its own state — never silently averaged.
 */

// Percent thresholds. Tight because takeoff rides on these. Tunable in one place.
export const VERIFY_OK_PCT = 1;        // ≤1% off → good
export const VERIFY_WARN_PCT = 3;      // 1–3% off → check; >3% → bad
export const CROSS_DISAGREE_PCT = 2;   // axes differing by >2% → non-uniform scaling

const pctOff = (measured, labeled) => Math.abs(measured - labeled) / Math.abs(labeled) * 100;

/* Calibration: the real-world feet a drawn length represents → a scale multiplier.
 * `drawnLen` and `labeledFt` are the traced length and the dimension's certified value
 * (any consistent unit for drawnLen; the result `feetPerUnit` converts it to feet).
 * Returns { feetPerUnit, labeledFt, drawnLen } or null on bad input. */
export function calibrateFromDimension(drawnLen, labeledFt) {
  if (!(drawnLen > 0) || !(labeledFt > 0)) return null;
  return { feetPerUnit: labeledFt / drawnLen, labeledFt, drawnLen };
}

/* Auto-verification probe: compare a dimension MEASURED on the placed result against its
 * printed LABEL. Returns a number + a graded severity so the UI shows the discrepancy
 * instead of asking for a thumbs-up.
 *   { measuredFt, labeledFt, pct, deltaFt, ok, severity: "ok"|"warn"|"bad", message } */
export function verifyDimension(measuredFt, labeledFt) {
  if (!(measuredFt > 0) || !(labeledFt > 0)) return null;
  const pct = pctOff(measuredFt, labeledFt);
  const severity = pct <= VERIFY_OK_PCT ? "ok" : pct <= VERIFY_WARN_PCT ? "warn" : "bad";
  return {
    measuredFt, labeledFt,
    deltaFt: measuredFt - labeledFt,
    pct,
    ok: severity === "ok",
    severity,
    message: `measures ${round1(measuredFt)} ft, label ${round1(labeledFt)} ft — ${round1(pct)}% off`,
  };
}

/* Cross-check two independent scale readings against each other. Each sample is
 * { feetPerUnit, axis? } (a scale derived from a graphic — a bar, or a dimension on an
 * axis). With ≥2 samples we compare the spread:
 *   - spread ≤ CROSS_DISAGREE_PCT → "confident" (they agree; report the mean scale)
 *   - spread >  CROSS_DISAGREE_PCT → "non-uniform" (flag stretched-in-one-axis; do NOT
 *     average — surface both so the user knows a single uniform scale is invalid)
 *   - <2 samples → "insufficient"
 * Returns { state, spreadPct, samples, meanScale|null, axes? }. */
export function crossCheckScales(samples = []) {
  const valid = samples.filter((s) => s && s.feetPerUnit > 0);
  if (valid.length < 2) return { state: "insufficient", spreadPct: 0, samples: valid, meanScale: null };
  const vals = valid.map((s) => s.feetPerUnit);
  const min = Math.min(...vals), max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spreadPct = (max - min) / mean * 100;
  if (spreadPct > CROSS_DISAGREE_PCT) {
    return {
      state: "non-uniform",
      spreadPct,
      samples: valid,
      meanScale: null, // deliberately null — averaging a non-uniform scale would be wrong
      axes: valid.map((s) => ({ axis: s.axis || null, feetPerUnit: s.feetPerUnit })),
      message: `Scale disagrees by ${round1(spreadPct)}% between graphics — the sheet looks non-uniformly scaled (stretched more in one direction). No single scale is valid.`,
    };
  }
  return {
    state: "confident",
    spreadPct,
    samples: valid,
    meanScale: mean,
    message: `Two graphics agree within ${round1(spreadPct)}% — scale is consistent.`,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
