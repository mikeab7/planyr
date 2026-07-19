/* B904 — CE roadmap #2, stage 1: the NRCS TYPE III design-storm HYETOGRAPH (the *shape* of
 * a design storm over time — how intensity rises and falls across the storm's duration —
 * distinct from a single peak intensity). Reservoir routing (pondRouting.js, #712) is only
 * as good as the inflow hydrograph feeding it; the Modified-Rational trapezoid the engine
 * uses today is a reasonable proxy for a SMALL, quick-responding drainage area, but a real
 * NRCS unit-hydrograph analysis (the correct method once a watershed outgrows the Rational
 * method — see detentionMethod.js) needs the REAL time-distributed rainfall a Type III storm
 * produces, not a flat/triangular stand-in.
 *
 * NRCS (SCS) publishes four standardized 24-hr dimensionless rainfall distributions (Type I,
 * IA, II, III) as a CUMULATIVE FRACTION of the storm's total depth vs. a cumulative FRACTION
 * of its duration. **Type III** is the Gulf Coast / Texas coastal distribution — a broader,
 * more gradual peak than Type II's sharp spike, reflecting the region's slower-moving,
 * longer-duration tropical rain systems. The table below is a standard transcription of the
 * published NRCS Type III mass curve (TR-55 / NEH-630 Ch. 4) — secondarySource, like every
 * other transcribed rainfall table in this codebase (DESIGN_STORMS, detentionRules.js):
 * confirm against the primary NRCS/TxDOT publication before a stamped design.
 *
 * Because the distribution is DIMENSIONLESS (fraction of duration → fraction of depth), it
 * scales to any storm duration, not just 24 hr — though Type III is specifically CALIBRATED
 * for a 24-hr storm; using it at a materially different duration is a documented screening
 * simplification (flagged in the returned `caveat`), not a first-choice practice.
 *
 * LOUD-FAILURE: a missing/non-positive total depth or duration returns null — never a
 * fabricated hyetograph. Pure + Node-testable; no DOM/network. */

// Cumulative fraction of the 24-hr Type III storm's TOTAL DEPTH that has fallen by each
// cumulative fraction of its DURATION (t/24hr). Denser near the storm's broad peak
// (roughly hour 9–14, where Type III concentrates its heaviest rainfall) than in the long,
// gentle tails. [timeFraction, depthFraction], ascending, both 0..1.
export const TYPE_III_MASS_CURVE = [
  [0.00, 0.000],
  [0.08, 0.020], // hr 2
  [0.17, 0.041], // hr 4
  [0.25, 0.061], // hr 6
  [0.29, 0.074], // hr 7
  [0.33, 0.089], // hr 8
  [0.35, 0.102], // hr 8.5
  [0.375, 0.115], // hr 9
  [0.396, 0.130], // hr 9.5
  [0.4375, 0.167], // hr 10.5 start of the steep rise
  [0.458, 0.257], // hr 11
  [0.479, 0.360], // hr 11.5
  [0.4896, 0.425], // hr 11.75
  [0.500, 0.500], // hr 12 — the storm's center of mass
  [0.5104, 0.575], // hr 12.25
  [0.521, 0.640], // hr 12.5
  [0.542, 0.705], // hr 13
  [0.583, 0.751], // hr 14
  [0.667, 0.811], // hr 16
  [0.75, 0.854], // hr 18
  [0.833, 0.886], // hr 20
  [0.917, 0.957], // hr 22
  [1.00, 1.000], // hr 24
];

const num = (v) => (Number.isFinite(v) ? v : null);
const round = (n, p = 4) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);

/* Clamped, piecewise-linear interpolation over TYPE_III_MASS_CURVE — the cumulative
 * fraction of total depth that has fallen by time fraction `tFrac` (0..1). Pure. */
export function typeIIIFraction(tFrac) {
  const t = num(tFrac);
  if (t == null) return null;
  const table = TYPE_III_MASS_CURVE;
  if (t <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i + 1 < table.length; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (t >= x0 && t <= x1) return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0 || 1);
  }
  return last[1];
}

/* Build a time-distributed NRCS Type III rainfall hyetograph: a total design-storm depth
 * (inches, from the Atlas-14 IDF lookup for the return period — detentionRules.js
 * designStorm24hrDepthIn) spread over `durationHr` (default 24, the distribution's native
 * calibration) at `dtMin`-minute increments. Returns
 * { series:[{tMin, cumulativeIn, incrementalIn}], totalDepthIn, durationHr, dtMin, caveat }
 * or null on bad inputs (LOUD-FAILURE — never a fabricated storm). Pure. */
export function buildTypeIIIHyetograph({ totalDepthIn, durationHr = 24, dtMin = 15 } = {}) {
  const P = num(totalDepthIn), durHr = num(durationHr), dt = num(dtMin);
  if (P == null || P <= 0 || durHr == null || durHr <= 0 || dt == null || dt <= 0) return null;
  const durMin = durHr * 60;
  const steps = Math.max(1, Math.round(durMin / dt));
  const series = [];
  let prevCum = 0;
  for (let i = 0; i <= steps; i++) {
    const tMin = Math.min(durMin, round(i * dt, 3));
    const cumFrac = typeIIIFraction(tMin / durMin);
    const cumulativeIn = round(cumFrac * P, 4);
    const incrementalIn = round(Math.max(0, cumulativeIn - prevCum), 4);
    series.push({ tMin, cumulativeIn, incrementalIn });
    prevCum = cumulativeIn;
  }
  return {
    series,
    totalDepthIn: P,
    durationHr: durHr,
    dtMin: dt,
    caveat: durHr !== 24
      ? "NRCS Type III is calibrated for a 24-hr storm; this rescales the same dimensionless mass curve to a different duration — a screening simplification, confirm with HEC-HMS for a duration far from 24 hr."
      : "NRCS Type III 24-hr distribution (Gulf Coast) — screening transcription; confirm against the primary NRCS/TxDOT publication.",
  };
}
