/* B881 — "challenge the estimate" layer for the screening estimated BFE.
 *
 * Deal go/no-go decisions ride on the estimated flood elevation, and a screening estimate
 * (FEMA InFRM EBFE or the grade-@-boundary fallback) can be wrong in EITHER direction. This
 * pure module gives the UI three honest challenge signals so a deal is never killed or bought
 * on a screening number alone:
 *
 *   (a) sanityCheckEstimate — sanity-check the estimated 1% WSE against site grade (the 3DEP
 *       DEM). If the implied inundation depth is implausible (WSE far above the general pad
 *       grade, or below the site's drainage invert), the value is flagged SUSPECT rather than
 *       silently priced off.
 *   (b) sensitivityBand — recompute the estimate-driven outputs at BFE −1 / BFE / +1 ft. If a
 *       verdict or a headline cost materially flips inside that band, the estimate is
 *       ESTIMATE-SENSITIVE (a site-specific H&H / Atlas-14 study could settle or lower it).
 *   (c) compareEstimates — when the EBFE value and the grade-based estimate disagree by more
 *       than a small threshold, both values + the delta are surfaced (disagreement is itself
 *       the challenge signal).
 *
 * Everything here is SCREENING language only — it changes no regulatory caveat and no
 * downstream formula. The sensitivity band RE-RUNS the caller's existing pure engines at
 * perturbed inputs; it does not alter them. Pure — no I/O, no mutation. */

// An implied inundation depth (WSE − median pad grade) deeper than this is implausible for a
// screening pad in this market — the estimate is more likely a datum/units error than a real
// 30-ft-deep flood over the building pad. Screening threshold; tune-safe.
export const IMPLAUSIBLE_DEPTH_FT = 30;
// A WSE this far BELOW the site's drainage invert (or, absent an explicit invert, the lowest
// sampled grade) can't be the governing flood surface for the site — flag it.
export const BELOW_INVERT_TOL_FT = 0.5;
// EBFE vs grade estimates within this band agree for screening; beyond it, show both.
export const DISAGREE_THRESHOLD_FT = 1.0;
// The ± band width the sensitivity sweep uses.
export const SENSITIVITY_DELTA_FT = 1.0;
// A numeric headline that moves more than this fraction across the band is "material".
export const MATERIAL_REL = 0.15;
// …but ignore moves smaller than this absolute floor (avoids flagging trivial cent-level noise).
export const MATERIAL_ABS_FLOOR = 1e-6;

/* Implied inundation depth (feet) of a water surface over a grade. Pure. */
export function impliedDepthFt(wseFt, gradeFt) {
  if (!Number.isFinite(wseFt) || !Number.isFinite(gradeFt)) return null;
  return wseFt - gradeFt;
}

/* (a) Sanity-check an estimated 1% WSE against site grade stats.
 *   wseFt        — the estimated BFE (ft-NAVD88)
 *   gradeStats   — { medianFt, minFt, maxFt } from the DEM over the site/footprints; null ⇒
 *                  can't check (no DEM) → { checked:false }
 *   drainageInvertFt — an explicit low/outfall invert if known; else the lowest sampled grade
 * Returns { checked, suspect, impliedDepthFt, reasons:[{code,label,detail}] }. Pure. */
export function sanityCheckEstimate({ wseFt = null, gradeStats = null, drainageInvertFt = null } = {}) {
  if (!Number.isFinite(wseFt) || !gradeStats || !Number.isFinite(gradeStats.medianFt)) {
    return { checked: false, suspect: false, impliedDepthFt: null, reasons: [] };
  }
  const depth = wseFt - gradeStats.medianFt;
  const reasons = [];
  if (depth > IMPLAUSIBLE_DEPTH_FT) {
    reasons.push({
      code: "deep",
      label: "WSE far above pad grade",
      detail: `Estimated flood surface sits ${depth.toFixed(1)}′ above the median site grade (${gradeStats.medianFt.toFixed(1)}′) — deeper than a screening pad plausibly floods; likely a datum/units mismatch. Confirm against the effective FIS before pricing off it.`,
    });
  }
  const invert = Number.isFinite(drainageInvertFt) ? drainageInvertFt
    : (Number.isFinite(gradeStats.minFt) ? gradeStats.minFt : null);
  if (invert != null && wseFt < invert - BELOW_INVERT_TOL_FT) {
    reasons.push({
      code: "below-invert",
      label: "WSE below the site's low point",
      detail: `Estimated flood surface (${wseFt.toFixed(1)}′) is below the site's ${Number.isFinite(drainageInvertFt) ? "drainage invert" : "lowest sampled grade"} (${invert.toFixed(1)}′) — it can't be the governing flood elevation here. Confirm the reach/datum.`,
    });
  }
  return { checked: true, suspect: reasons.length > 0, impliedDepthFt: depth, reasons };
}

/* (c) Compare the EBFE estimate and the grade-based estimate. Pure. */
export function compareEstimates({ ebfeFt = null, gradeFt = null, thresholdFt = DISAGREE_THRESHOLD_FT } = {}) {
  if (!Number.isFinite(ebfeFt) || !Number.isFinite(gradeFt)) {
    return { comparable: false, disagree: false, deltaFt: null, absDeltaFt: null, higher: null };
  }
  const deltaFt = ebfeFt - gradeFt;
  const absDeltaFt = Math.abs(deltaFt);
  return {
    comparable: true,
    disagree: absDeltaFt > thresholdFt,
    deltaFt,
    absDeltaFt,
    higher: deltaFt > 0 ? "ebfe" : deltaFt < 0 ? "grade" : "equal",
  };
}

/* Did a single numeric headline change materially between two samples? A value that appears
 * or vanishes (null ↔ number) is material; otherwise a relative move past MATERIAL_REL (and
 * above the absolute floor). Pure. */
function numMaterial(base, other) {
  const a = Number.isFinite(base), b = Number.isFinite(other);
  if (!a && !b) return false;
  if (a !== b) return true; // appeared or vanished
  const abs = Math.abs(other - base);
  if (abs <= MATERIAL_ABS_FLOOR) return false;
  const denom = Math.abs(base);
  return denom > MATERIAL_ABS_FLOOR ? abs / denom > MATERIAL_REL : true;
}

/* (b) Sensitivity band. `evalFn(wseFt)` returns a flat metrics object for that WSE — STRING
 * values are treated as categorical verdicts (a flip = the three samples aren't all equal),
 * NUMBER values as headline costs (a flip = a material move from mid to either edge). Returns
 *   { sensitive, deltaFt, samples:{low,mid,high}, flips:[{key,kind,values}] }
 * or null when it can't run. The heavy engine calls live in evalFn (injected by the caller /
 * a test); this function only sweeps and diffs. Pure. */
export function sensitivityBand(evalFn, baseWseFt, { deltaFt = SENSITIVITY_DELTA_FT } = {}) {
  if (typeof evalFn !== "function" || !Number.isFinite(baseWseFt)) return null;
  const low = evalFn(baseWseFt - deltaFt) || {};
  const mid = evalFn(baseWseFt) || {};
  const high = evalFn(baseWseFt + deltaFt) || {};
  const keys = new Set([...Object.keys(low), ...Object.keys(mid), ...Object.keys(high)]);
  const flips = [];
  for (const key of keys) {
    const vLow = low[key], vMid = mid[key], vHigh = high[key];
    const anyNum = [vLow, vMid, vHigh].some((v) => typeof v === "number");
    const anyStr = [vLow, vMid, vHigh].some((v) => typeof v === "string");
    if (anyStr && !anyNum) {
      // Categorical verdict — flip if the three aren't all identical.
      if (!(vLow === vMid && vMid === vHigh)) {
        flips.push({ key, kind: "verdict", values: { low: vLow, mid: vMid, high: vHigh } });
      }
    } else if (anyNum) {
      if (numMaterial(vMid, vLow) || numMaterial(vMid, vHigh)) {
        flips.push({ key, kind: "cost", values: { low: vLow, mid: vMid, high: vHigh } });
      }
    }
  }
  return { sensitive: flips.length > 0, deltaFt, samples: { low, mid, high }, flips };
}
