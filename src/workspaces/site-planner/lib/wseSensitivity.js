/* NEW-4 — FLOOD-LEVEL SENSITIVITY: how far does the obligation move if the flood level is higher
 * than we think?
 *
 * WHY THIS EXISTS. On Tsakiris the entire floodplain-mitigation requirement is 0.2 ac-ft, and it
 * is 0.2 only because the estimated flood surface sits about a quarter foot above existing ground
 * (B1036). That site is in unstudied Zone A — FEMA mapped a floodplain boundary but never
 * published a base flood elevation — so the number doing all the work is Planyr's own estimate
 * standing in for one that does not exist. A quarter-foot input driving the whole obligation is
 * not a design question, it is an UNDERWRITING question: does a flood level two feet higher make
 * that 2 ac-ft, or 20?
 *
 * AUDIT-FIRST. This is NOT a new derivation. `estimateChallenge.sensitivityBand` already sweeps a
 * caller-injected `evalAtWse(wseFt)` at ±1 ft to flag whether the estimate is challengeable, and
 * SitePlanner already builds exactly such an `evalAtWse` (it re-runs computeMitigation,
 * assessBuildability and usablePondVolume at a candidate WSE). This module generalises that ONE
 * sweep from a 3-sample band to an N-step ladder and shapes it for reading. Feeding both from the
 * same injected `evalAtWse` is the point: a scenario row physically cannot disagree with the live
 * panel, because it is the same function.
 *
 * PRESENTATION CONTRACT (owner: "a deal-underwriting answer, not a design answer"):
 *   • one row per scenario, absolute numbers, never percentages — a percentage against a near-zero
 *     requirement is noise (B1034's rule, and 0.2 ac-ft is exactly that denominator);
 *   • the CURRENT estimate is always a row, so every other row reads as a delta from something;
 *   • an UNKNOWN stays unknown — a scenario whose engine returns null renders as unknown, never
 *     as a zero (LOUD-FAILURE; a fabricated 0.0 ac-ft obligation is the worst possible output).
 *
 * Pure; no DOM, no network, no engine imports — the caller injects the evaluator. */

const CF_PER_ACFT = 43560;

/* Default steps if a jurisdiction supplies none. The real list is criteria-configurable
 * (`criteriaFor(...).wseSensitivityStepsFt`) — this is only the last-resort floor. */
export const DEFAULT_STEPS_FT = [0, 1, 2, 5];

const num = (v) => (Number.isFinite(v) ? v : null);
const acFt = (cf) => (Number.isFinite(cf) ? Math.round((cf / CF_PER_ACFT) * 100) / 100 : null);

/* Normalise a steps list: finite, >= 0, sorted, de-duplicated, and always containing 0 (the
 * current estimate) so the ladder has a baseline to be read against. */
export function normalizeSteps(steps) {
  const list = (Array.isArray(steps) ? steps : DEFAULT_STEPS_FT).filter((s) => Number.isFinite(s) && s >= 0);
  const withBase = list.includes(0) ? list : [0, ...list];
  return [...new Set(withBase)].sort((a, b) => a - b);
}

/* Sweep `evalAtWse` across the steps above `baseWseFt`.
 *
 * `evalAtWse(wseFt)` must return the flat metrics object SitePlanner already produces:
 *   { mitigationCf, detUsableCf, detDeadCf, ffeVerdict, requiredFfeFt }
 *
 * Returns { ok, baseWseFt, rows: [...], movesWith } or { ok:false, reason }. Each row:
 *   { stepFt, wseFt, mitigationAcFt, mitigationDeltaAcFt, creditedAcFt, creditedDeltaAcFt,
 *     ffeVerdict, requiredFfeFt, unknown }
 *
 * `movesWith` names which quantities actually respond over the swept range, so the caller can say
 * "flat across this range" instead of drawing a table of identical rows. */
export function wseSensitivity(evalAtWse, baseWseFt, { stepsFt = DEFAULT_STEPS_FT } = {}) {
  if (typeof evalAtWse !== "function") return { ok: false, reason: "no evaluator" };
  if (!Number.isFinite(baseWseFt)) return { ok: false, reason: "no governing flood level to sweep from" };

  const steps = normalizeSteps(stepsFt);
  const samples = steps.map((stepFt) => ({ stepFt, wseFt: Math.round((baseWseFt + stepFt) * 100) / 100, m: evalAtWse(baseWseFt + stepFt) || {} }));
  const base = samples.find((s) => s.stepFt === 0);

  const baseMit = acFt(num(base?.m?.mitigationCf));
  const baseCredited = acFt(num(base?.m?.detUsableCf));

  const rows = samples.map(({ stepFt, wseFt, m }) => {
    const mitigationAcFt = acFt(num(m.mitigationCf));
    const creditedAcFt = acFt(num(m.detUsableCf));
    return {
      stepFt,
      wseFt,
      mitigationAcFt,
      // Absolute deltas only. A percentage against a 0.2 ac-ft requirement is the "+18420%"
      // defect B1034 already fixed once; it must not reappear in a new surface.
      mitigationDeltaAcFt: mitigationAcFt != null && baseMit != null ? Math.round((mitigationAcFt - baseMit) * 100) / 100 : null,
      creditedAcFt,
      creditedDeltaAcFt: creditedAcFt != null && baseCredited != null ? Math.round((creditedAcFt - baseCredited) * 100) / 100 : null,
      ffeVerdict: typeof m.ffeVerdict === "string" ? m.ffeVerdict : null,
      requiredFfeFt: num(m.requiredFfeFt),
      // An engine that could not price this scenario says so. Never a zero standing in for a gap.
      unknown: mitigationAcFt == null && creditedAcFt == null,
    };
  });

  const varies = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v != null);
    return vals.length > 1 && vals.some((v) => v !== vals[0]);
  };
  const movesWith = {
    mitigation: varies("mitigationAcFt"),
    credited: varies("creditedAcFt"),
    ffe: (() => {
      const vals = rows.map((r) => r.ffeVerdict).filter(Boolean);
      return vals.length > 1 && vals.some((v) => v !== vals[0]);
    })(),
  };

  return {
    ok: true,
    baseWseFt: Math.round(baseWseFt * 100) / 100,
    stepsFt: steps,
    rows,
    movesWith,
    // "Nothing in this range changes anything" is a genuine, useful answer — and a short one.
    flat: !movesWith.mitigation && !movesWith.credited && !movesWith.ffe,
    // The headline an underwriter actually wants: the worst obligation across the swept range.
    worstMitigationAcFt: rows.reduce((mx, r) => (r.mitigationAcFt != null && (mx == null || r.mitigationAcFt > mx) ? r.mitigationAcFt : mx), null),
    anyUnknown: rows.some((r) => r.unknown),
  };
}

export default wseSensitivity;
