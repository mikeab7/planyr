/* NEW-A4 — screening-tier reservoir routing (modified-Puls / storage-indication) that
 * proves Post ≤ Pre peak discharge per storm — the RATE-control answer a district like
 * Brookshire–Katy, FBCDD or Waller actually regulates, which a volume band cannot give.
 *
 * The chain, all screening grade:
 *   1. INFLOW — a Modified-Rational trapezoidal hydrograph per design storm (rising limb
 *      over the time of concentration Tc, plateau to the storm duration, falling limb over
 *      Tc), built from the SAME transcribed NOAA Atlas-14 IDF + runoff-coefficient machinery
 *      the existing computeRateBasedDetention uses (detentionRules.js) — so this can't drift
 *      from the rate cross-check.
 *   2. ROUTING — level-pool storage-indication: (2S/Δt + O)_{i+1} = (I_i + I_{i+1}) +
 *      (2S/Δt − O)_i, with O and S read back from the stage-storage-discharge curve. Routed
 *      over candidate durations; the governing (max) peak outflow is the storm's post-dev peak.
 *   3. VERDICT — compare the routed post-development peak to the PRE-development peak
 *      (Rational Q = C_pre·i(Tc)·A). PASS when routed ≤ pre (within tolerance), SHORT otherwise.
 *
 * Honesty (LOUD-FAILURE): a missing outlet / unanchored pond / missing inputs returns
 * kind:"unknown" with the reason — NEVER a fabricated PASS. The pre-development runoff
 * coefficient is a screening ASSUMPTION (default 0.3, undeveloped Houston-area pasture) and
 * is surfaced as such. Overtopping (inflow exceeds what the basin + outlet can pass below
 * top of bank) is flagged, never silently clamped to a pass. Screening only — a real Post ≤
 * Pre demonstration is the district engineer's HEC-HMS/HEC-RAS hydrograph routing.
 * Pure + Node-testable; no DOM/network. */
import { stormIntensity, runoffCoefficient, DESIGN_STORMS } from "./detentionRules.js";
import { buildStageStorageDischarge } from "./stageStorageDischarge.js";
import { outletProblems } from "./outletStructure.js";

export const DEFAULT_TC_MIN = 15;           // screening time of concentration (small industrial site)
export const DEFAULT_PRE_RUNOFF_C = 0.3;    // undeveloped Houston-area pasture, screening assumption
const PASS_TOL = 1e-6;
// Candidate storm durations to route (minutes) — the critical duration is the one whose
// routed peak outflow governs. Bounded by the transcribed IDF's range.
const ROUTE_DURATIONS_MIN = [15, 30, 60, 120, 180];

const num = (v) => (Number.isFinite(v) ? v : null);
const round = (n, p = 2) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);

/* Rational-method peak (cfs): Q = C·i·A, i at the time of concentration (the max-intensity
 * duration for a Rational peak), A in acres (the 1.008 ≈ 1 unit convention). Null on bad
 * inputs. Pure. */
export function rationalPeakCfs({ runoffC, returnPeriodYr, tcMin = DEFAULT_TC_MIN, areaAcres } = {}) {
  const C = num(runoffC), A = num(areaAcres), tc = num(tcMin);
  if (C == null || A == null || A <= 0 || tc == null || tc <= 0) return null;
  const si = stormIntensity(returnPeriodYr, tc);
  if (!si) return null;
  return C * si.inPerHr * A;
}

/* B902 — AUTO-SUGGEST the allowable release: the pre-development peak discharge across a
 * jurisdiction's required design storms, at the standard screening pre-development runoff
 * coefficient (undeveloped/pasture, DEFAULT_PRE_RUNOFF_C). This is what makes "Propose outlet"
 * self-sufficient in a Post ≤ Pre district that publishes no cfs/ac cap (Waller, BKDD): the
 * allowable release IS the site's own pre-development peak, which this app can already compute
 * with the SAME rationalPeakCfs() the routing pass itself uses for the pre-dev side of every
 * PASS/SHORT check — so a suggested release can never disagree with what routing later verifies
 * against.
 *
 * Sized to the MOST RESTRICTIVE (smallest) governing storm's peak — a defensible, conservative
 * screening seed for the initial orifice; Post ≤ Pre is a PER-STORM check (10-yr AND 100-yr, not
 * one number), so the routing step this feeds into re-verifies every required storm regardless of
 * which one seeded the sizing. Returns null when nothing to compute from (no required storms / no
 * drainage area) — never a fabricated release. Pure. */
export function suggestedPreDevReleaseCfs({ requiredStorms, areaAcres, runoffC = DEFAULT_PRE_RUNOFF_C, tcMin = DEFAULT_TC_MIN } = {}) {
  const storms = Array.isArray(requiredStorms) ? requiredStorms : [];
  const A = num(areaAcres);
  if (!storms.length || A == null || A <= 0) return null;
  const perStorm = storms
    .map((T) => ({ returnPeriodYr: T, peakCfs: rationalPeakCfs({ runoffC, returnPeriodYr: T, tcMin, areaAcres: A }) }))
    .filter((p) => Number.isFinite(p.peakCfs) && p.peakCfs > 0);
  if (!perStorm.length) return null;
  const governing = perStorm.reduce((min, p) => (p.peakCfs < min.peakCfs ? p : min));
  return {
    cfs: round(governing.peakCfs, 2),
    governingStormYr: governing.returnPeriodYr,
    runoffC,
    tcMin,
    perStorm: perStorm.map((p) => ({ returnPeriodYr: p.returnPeriodYr, peakCfs: round(p.peakCfs, 2) })),
  };
}

/* Modified-Rational trapezoidal inflow hydrograph for one storm+duration. Returns
 * { series:[{tSec,qCfs}], peakCfs, durationMin } sampled at dtSec, extended with a falling
 * limb of length Tc (and the caller pads recession). For D < Tc the hydrograph is a triangle
 * peaking at C·i·A·(D/Tc) at t=D. Null on bad inputs. Pure. */
export function modifiedRationalHydrograph({ returnPeriodYr, durationMin, tcMin = DEFAULT_TC_MIN, runoffC, areaAcres, dtSec = 60 } = {}) {
  const C = num(runoffC), A = num(areaAcres), tc = num(tcMin), D = num(durationMin), dt = num(dtSec);
  if (C == null || A == null || A <= 0 || tc == null || tc <= 0 || D == null || D <= 0 || dt == null || dt <= 0) return null;
  const si = stormIntensity(returnPeriodYr, D);
  if (!si) return null;
  const qFull = C * si.inPerHr * A; // rational peak for this duration's intensity
  const tcS = tc * 60, dS = D * 60;
  const q = (t) => {
    if (D >= tc) {
      // trapezoid: rise 0→qFull over [0,tc], plateau over [tc,D], fall qFull→0 over [D,D+tc]
      if (t <= 0) return 0;
      if (t < tcS) return qFull * (t / tcS);
      if (t <= dS) return qFull;
      if (t < dS + tcS) return qFull * (1 - (t - dS) / tcS);
      return 0;
    }
    // triangle peaking at t=D with reduced peak qFull*(D/tc)
    const qp = qFull * (D / tc);
    if (t <= 0) return 0;
    if (t < dS) return qp * (t / dS);
    if (t < dS + tcS) return qp * (1 - (t - dS) / tcS);
    return 0;
  };
  const end = dS + tcS;
  const series = [];
  let peak = 0;
  for (let t = 0; t <= end + 1e-6; t += dt) {
    const v = q(t);
    series.push({ tSec: round(t, 1), qCfs: v });
    if (v > peak) peak = v;
  }
  return { series, peakCfs: peak, durationMin: D };
}

/* Storage-indication table from a stage-storage-discharge curve: phi = 2S/Δt + O, paired
 * with O (discharge) and S (storage), monotonic in storage. Pure. */
function storageIndication(ssdCurve, dtSec) {
  return ssdCurve.map((p) => ({ phi: (2 * p.storageCf) / dtSec + p.dischargeCfs, O: p.dischargeCfs, S: p.storageCf, elevFt: p.elevFt }));
}
// Clamped interpolation of field `yKey` at phi=x over a phi-sorted table.
function lookupByPhi(table, x, yKey) {
  if (x <= table[0].phi) return table[0][yKey];
  const last = table[table.length - 1];
  if (x >= last.phi) return { over: true, val: last[yKey] };
  for (let i = 0; i + 1 < table.length; i++) {
    const a = table[i], b = table[i + 1];
    if (x >= a.phi && x <= b.phi) {
      const span = b.phi - a.phi;
      const val = span <= 0 ? a[yKey] : a[yKey] + ((b[yKey] - a[yKey]) * (x - a.phi)) / span;
      return { over: false, val };
    }
  }
  return { over: true, val: last[yKey] };
}

/* Route one inflow hydrograph through a stage-storage-discharge curve (level-pool storage
 * indication). Pond starts empty. Returns { peakInflowCfs, peakOutflowCfs, peakStorageCf,
 * maxElevFt, overtopped }. `padSteps` extends the run with zero inflow to capture the lagged
 * outflow peak. Pure. */
export function routeHydrograph(series, ssdCurve, dtSec, { padSteps = null } = {}) {
  if (!Array.isArray(series) || series.length < 2 || !Array.isArray(ssdCurve) || ssdCurve.length < 2) return null;
  const table = storageIndication(ssdCurve, dtSec);
  const maxPhi = table[table.length - 1].phi;
  const I = series.map((s) => s.qCfs);
  const pad = padSteps == null ? series.length : padSteps; // generous recession tail
  for (let k = 0; k < pad; k++) I.push(0);

  let phiMinusO = 0; // 2S/Δt − O, starts at 0 (empty pond)
  let peakOut = 0, peakStore = 0, peakInflow = 0, maxElev = ssdCurve[0].elevFt, overtopped = false;
  for (let i = 0; i + 1 < I.length; i++) {
    if (I[i] > peakInflow) peakInflow = I[i];
    const phiNew = I[i] + I[i + 1] + phiMinusO;
    if (phiNew > maxPhi + 1e-9) overtopped = true;
    const o = lookupByPhi(table, phiNew, "O");
    const s = lookupByPhi(table, phiNew, "S");
    const e = lookupByPhi(table, phiNew, "elevFt");
    const O = Math.max(0, o.val);
    phiMinusO = phiNew - 2 * O;
    if (O > peakOut) peakOut = O;
    if (s.val > peakStore) peakStore = s.val;
    if (e.val > maxElev) maxElev = e.val;
  }
  return { peakInflowCfs: peakInflow, peakOutflowCfs: peakOut, peakStorageCf: peakStore, maxElevFt: maxElev, overtopped };
}

/* Route all candidate durations for one storm and return the governing (max routed peak
 * outflow) result. `runoffC` is the POST-development coefficient; `areaAcres` the drainage
 * area. Returns { routedPeakCfs, criticalDurationMin, maxElevFt, overtopped, peakStorageCf }
 * or null. Pure. */
export function routeStorm({ returnPeriodYr, ssdCurve, runoffC, areaAcres, tcMin = DEFAULT_TC_MIN, durationsMin = ROUTE_DURATIONS_MIN } = {}) {
  if (!Array.isArray(ssdCurve) || ssdCurve.length < 2) return null;
  const dtSec = Math.max(30, Math.min(300, Math.round((tcMin * 60) / 4)));
  let best = null;
  for (const D of durationsMin) {
    if (D < tcMin) continue; // trapezoid form needs D ≥ Tc; shorter storms don't govern volume
    const hyd = modifiedRationalHydrograph({ returnPeriodYr, durationMin: D, tcMin, runoffC, areaAcres, dtSec });
    if (!hyd) continue;
    const r = routeHydrograph(hyd.series, ssdCurve, dtSec);
    if (!r) continue;
    if (!best || r.peakOutflowCfs > best.routedPeakCfs) {
      best = { routedPeakCfs: r.peakOutflowCfs, criticalDurationMin: D, maxElevFt: r.maxElevFt, overtopped: r.overtopped, peakStorageCf: r.peakStorageCf, peakInflowCfs: r.peakInflowCfs };
    }
  }
  return best;
}

/* THE top-level per-storm PASS/SHORT engine. Builds the stage-storage-discharge curve
 * (or takes a pre-built `ssd`), routes each required storm, and compares the routed
 * post-development peak to the pre-development Rational peak.
 *
 * Inputs (site feet / ft NAVD88 / acres):
 *   ring, det, outlet, criteria — the pond + outlet + the jurisdiction criteria (criteriaFor)
 *   ssd                         — optional pre-built buildStageStorageDischarge() result
 *   areaAcres                   — the pond's contributing drainage area (screening: the site)
 *   impPct                      — post-development % impervious (→ post runoff C)
 *   preRunoffC                  — pre-development coefficient (default 0.3, a screening assumption)
 *   tcMin                       — time of concentration (default 15, a screening assumption)
 *   requiredStorms              — return periods to prove (criteria.requiredStorms)
 *   tailwaterElevFt             — submerges the outlet (drowned-outlet regime)
 * Returns { kind:"routed"|"unknown", perStorm:[…], allPass, flags, assumptions, caveat }.
 * Pure. */
export function assessRoutedDetention({
  ring = null, det = null, outlet = null, criteria = null, ssd = null,
  areaAcres = null, impPct = null, preRunoffC = DEFAULT_PRE_RUNOFF_C, tcMin = DEFAULT_TC_MIN,
  requiredStorms = null, tailwaterElevFt = null,
} = {}) {
  const flags = [];
  const caveat = "Screening reservoir routing — confirm Post ≤ Pre with the reviewing authority's hydrograph model (HEC-HMS).";
  const assumptions = [];

  // Validate the outlet up front (the validator flags an EMPTY outlet, which a discharge
  // probe reads as a legitimate all-zero curve). Routing needs a real outlet — no outlet is a
  // LOUD failure, never a pond that "passes" by holding everything until it overtops.
  if (outlet != null) {
    const oProbs = outletProblems(outlet);
    if (oProbs.length) return { kind: "unknown", perStorm: [], allPass: false, flags: ["outlet-incomplete"], reason: oProbs.join("; "), caveat };
  }
  const built = ssd || buildStageStorageDischarge({ ring, det, outlet, criteria, tailwaterElevFt });
  if (!built || !built.ok) return { kind: "unknown", perStorm: [], allPass: false, flags: ["ssd-unavailable"], reason: (built && built.reason) || "no stage-storage-discharge curve", caveat };
  if (built.outletProblems && built.outletProblems.length) {
    return { kind: "unknown", perStorm: [], allPass: false, flags: ["outlet-incomplete"], reason: built.outletProblems.join("; "), caveat };
  }
  const A = num(areaAcres);
  if (A == null || A <= 0) return { kind: "unknown", perStorm: [], allPass: false, flags: ["area-unknown"], reason: "no contributing drainage area", caveat };
  const postC = runoffCoefficient(impPct);
  if (postC == null) flags.push("impervious-unknown");
  const storms = (Array.isArray(requiredStorms) && requiredStorms.length ? requiredStorms : (criteria && criteria.requiredStorms) || []).filter((n) => DESIGN_STORMS.periods[n]);
  if (!storms.length) return { kind: "unknown", perStorm: [], allPass: false, flags: ["no-required-storms"], reason: "no modeled required storms for this jurisdiction", caveat };

  assumptions.push(`Pre-development runoff coefficient C = ${preRunoffC} (screening assumption — undeveloped condition).`);
  assumptions.push(`Time of concentration Tc = ${tcMin} min (screening assumption).`);
  if (DESIGN_STORMS.secondarySource) assumptions.push("Rainfall from the area-representative Atlas-14 IDF (confirm against the point grid for the site).");

  const effPostC = postC == null ? runoffCoefficient(100) : postC; // impervious unknown → conservative upper bound
  const perStorm = [];
  let allPass = true;
  for (const T of storms) {
    const preCfs = rationalPeakCfs({ runoffC: preRunoffC, returnPeriodYr: T, tcMin, areaAcres: A });
    const postUnrouted = rationalPeakCfs({ runoffC: effPostC, returnPeriodYr: T, tcMin, areaAcres: A });
    const routed = routeStorm({ returnPeriodYr: T, ssdCurve: built.curve, runoffC: effPostC, areaAcres: A, tcMin });
    if (preCfs == null || !routed) { perStorm.push({ returnPeriodYr: T, status: "unknown" }); allPass = false; continue; }
    const pass = routed.routedPeakCfs <= preCfs + PASS_TOL;
    if (!pass) allPass = false;
    if (routed.overtopped) flags.push("overtopping");
    perStorm.push({
      returnPeriodYr: T,
      preCfs: round(preCfs),
      postUnroutedCfs: round(postUnrouted),
      routedPeakCfs: round(routed.routedPeakCfs),
      shortByCfs: pass ? 0 : round(routed.routedPeakCfs - preCfs),
      attenuationPct: postUnrouted > 0 ? round((1 - routed.routedPeakCfs / postUnrouted) * 100, 0) : null,
      criticalDurationMin: routed.criticalDurationMin,
      maxElevFt: round(routed.maxElevFt),
      peakStorageAcFt: round(routed.peakStorageCf / 43560, 3),
      overtopped: routed.overtopped,
      status: pass ? "pass" : "short",
    });
  }
  if (postC == null) flags.push("impervious-conservative");
  return {
    kind: "routed",
    perStorm,
    allPass,
    designWsElevFt: built.designWsElevFt,
    tobElevFt: built.tobElevFt,
    flags: [...new Set(flags)],
    assumptions,
    caveat,
  };
}
