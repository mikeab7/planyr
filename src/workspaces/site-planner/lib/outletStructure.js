/* NEW-A2 — the pond OUTLET STRUCTURE concept + its stage→discharge rating curve.
 *
 * A detention pond releases through an outlet: a low-flow ORIFICE (a hole/pipe near the
 * floor), a WEIR (an overflow crest), a flow-RESTRICTOR (a vortex valve / plate that
 * holds a near-constant release), or a MULTISTAGE stack of these. Given a water-surface
 * elevation the outlet passes a discharge; that stage→discharge relationship is exactly
 * what a reservoir-routing pass needs to prove Post ≤ Pre (pondRouting.js).
 *
 * The per-pond model lives on the additive `det.outlet` field (persisted through the
 * existing setDet path — no siteModel version bump):
 *   det.outlet = { stages: [ Stage, … ] }
 *   Stage (orifice)    = { kind:"orifice",    invertElevFt, diameterIn, count?, coeff? }
 *   Stage (weir)       = { kind:"weir",       crestElevFt,  lengthFt,   coeff? }
 *   Stage (restrictor) = { kind:"restrictor", invertElevFt, maxCfs }
 * A missing coeff falls back to the jurisdiction criteria (orificeC / weirC).
 *
 * US-customary hydraulics, screening grade:
 *   orifice  Q = C·A·√(2g·h)      (sharp-edged, C≈0.6; g=32.174 ft/s²)
 *   weir     Q = C·L·h^1.5        (rectangular, C≈3.33)
 *   restrictor  Q = maxCfs        (idealized flow-control device holding its rate)
 * Submergence: when a tailwater elevation is supplied and sits above the outlet, the
 * ORIFICE uses the differential (submerged) head — the drowned-outlet case the B632
 * hydraulic-regime gate flags. This is SCREENING ONLY — a real outlet needs an engineer's
 * hydraulic design (inlet/outlet losses, submergence transitions, clogging, tailwater
 * hydrograph). LOUD-FAILURE: a stage missing its size/invert contributes NOTHING and is
 * reported as a problem, never a fabricated flow. Pure + Node-testable; no DOM/network. */

export const OUTLET_KINDS = ["orifice", "weir", "restrictor"];

const G_FT_S2 = 32.174;
const SQRT_2G = Math.sqrt(2 * G_FT_S2); // ≈ 8.0217
const DEFAULT_ORIFICE_C = 0.6;
const DEFAULT_WEIR_C = 3.33;

const num = (v) => (Number.isFinite(v) ? v : null);
const clampCount = (n) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);

/* Circular-orifice area (ft²) from a diameter in INCHES. */
export function orificeAreaSf(diameterIn) {
  const d = num(diameterIn);
  if (d == null || d <= 0) return 0;
  const dFt = d / 12;
  return (Math.PI * dFt * dFt) / 4;
}

/* Discharge (cfs) of ONE stage at a water-surface elevation `wsElevFt`. `tailwaterElevFt`
 * (optional) submerges an orifice: the effective head is measured to max(outlet, tailwater).
 * `orificeC`/`weirC` supply the coefficient when the stage carries none. Returns a finite
 * cfs (0 when the stage isn't engaged) or null when the stage is malformed (missing size /
 * invert) — the caller surfaces that as a problem, never a silent 0. Pure. */
export function stageDischarge(stage, wsElevFt, { tailwaterElevFt = null, orificeC = DEFAULT_ORIFICE_C, weirC = DEFAULT_WEIR_C } = {}) {
  if (!stage || !OUTLET_KINDS.includes(stage.kind)) return null;
  const ws = num(wsElevFt);
  if (ws == null) return null;
  const tw = num(tailwaterElevFt);

  if (stage.kind === "orifice") {
    const invert = num(stage.invertElevFt);
    const A = orificeAreaSf(stage.diameterIn);
    if (invert == null || A <= 0) return null;
    const count = clampCount(stage.count);
    const C = num(stage.coeff) ?? orificeC ?? DEFAULT_ORIFICE_C;
    const centroid = invert + (stage.diameterIn / 12) / 2;
    // Effective downstream water level: the higher of the orifice centroid and the tailwater.
    const down = tw != null && tw > centroid ? tw : centroid;
    const h = ws - down;
    if (h <= 0) return 0;
    return count * C * A * SQRT_2G * Math.sqrt(h);
  }

  if (stage.kind === "weir") {
    const crest = num(stage.crestElevFt);
    const L = num(stage.lengthFt);
    if (crest == null || L == null || L <= 0) return null;
    const C = num(stage.coeff) ?? weirC ?? DEFAULT_WEIR_C;
    const h = ws - crest;
    if (h <= 0) return 0;
    // Submerged-weir screening reduction (Villemonte) when tailwater tops the crest — keeps
    // a drowned weir from over-crediting outflow. Free weir otherwise.
    let q = C * L * Math.pow(h, 1.5);
    if (tw != null && tw > crest) {
      const hd = tw - crest;
      const ratio = Math.min(1, hd / h);
      q *= Math.pow(1 - Math.pow(ratio, 1.5), 0.385);
    }
    return q;
  }

  // restrictor — idealized flow-control device holding a near-constant release once engaged.
  const invert = num(stage.invertElevFt);
  const maxCfs = num(stage.maxCfs);
  if (invert == null || maxCfs == null || maxCfs < 0) return null;
  return ws > invert ? maxCfs : 0;
}

/* Total outlet discharge (cfs) at a water-surface elevation — the sum over every engaged
 * stage. Returns { cfs, byStage:[{ kind, cfs, problem? }], problems:[…] } where a malformed
 * stage lands in `problems` (and contributes 0), so the routing pass never mistakes a broken
 * outlet for a closed one. `criteria` is a criteriaFor() result (its orificeC/weirC feed
 * coefficient fallbacks); `tailwaterElevFt` submerges the outlet. Pure. */
export function outletDischarge(wsElevFt, outlet, { criteria = null, tailwaterElevFt = null } = {}) {
  const stages = (outlet && Array.isArray(outlet.stages) ? outlet.stages : []);
  const orificeC = criteria?.orificeC?.value ?? DEFAULT_ORIFICE_C;
  const weirC = criteria?.weirC?.value ?? DEFAULT_WEIR_C;
  let cfs = 0;
  const byStage = [];
  const problems = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const q = stageDischarge(s, wsElevFt, { tailwaterElevFt, orificeC, weirC });
    if (q == null) {
      const label = `${s && s.kind ? s.kind : "stage"} #${i + 1}`;
      problems.push(`${label}: missing size/invert — contributes no flow`);
      byStage.push({ kind: s && s.kind, cfs: 0, problem: true });
      continue;
    }
    cfs += q;
    byStage.push({ kind: s.kind, cfs: q, problem: false });
  }
  return { cfs, byStage, problems };
}

/* Size a single sharp-edged orifice to pass `targetCfs` at head `headFt`. Inverse of the
 * orifice equation: A = Q/(C·√(2g·h)); diameter = 2·√(A/π). Returns { diameterIn, areaSf }
 * or null on bad inputs. Used to PROPOSE a default outlet at the jurisdiction's allowable
 * release (never auto-committed). Pure. */
export function sizeOrificeForRelease({ targetCfs, headFt, coeff = DEFAULT_ORIFICE_C } = {}) {
  const q = num(targetCfs), h = num(headFt), C = num(coeff) ?? DEFAULT_ORIFICE_C;
  if (q == null || q <= 0 || h == null || h <= 0 || !(C > 0)) return null;
  const areaSf = q / (C * SQRT_2G * Math.sqrt(h));
  const dFt = 2 * Math.sqrt(areaSf / Math.PI);
  return { diameterIn: Math.round(dFt * 12 * 100) / 100, areaSf: Math.round(areaSf * 1000) / 1000 };
}

/* Propose a default single-orifice outlet for a pond: a low-flow orifice at the basin
 * FLOOR sized to the jurisdiction's allowable release at roughly half the design-water
 * head (a screening midpoint). Returns an outlet object + the target it was sized to, or
 * a { reason } when the inputs to size it aren't there — never a fabricated hole. Pure.
 *
 *   floorElevFt   — basin floor (tobElev − min(depth, maxDepth))
 *   designWsElevFt— design water surface (tobElev − freeboard)
 *   allowableReleaseCfs — the target release (criteria release-rate × acres, or the
 *                         pre-development peak the routing must not exceed)
 */
export function defaultOutletForPond({ floorElevFt = null, designWsElevFt = null, allowableReleaseCfs = null, orificeC = DEFAULT_ORIFICE_C } = {}) {
  const floor = num(floorElevFt), ws = num(designWsElevFt), rel = num(allowableReleaseCfs);
  if (floor == null || ws == null || !(ws > floor)) return { outlet: null, reason: "pond not anchored — set the top-of-bank elevation and depth first" };
  if (rel == null || rel <= 0) return { outlet: null, reason: "no allowable release available — set a release rate (or the criteria don't publish one)" };
  const headFt = (ws - floor) / 2; // screening midpoint head over the design column
  const sized = sizeOrificeForRelease({ targetCfs: rel, headFt, coeff: orificeC });
  if (!sized) return { outlet: null, reason: "could not size an orifice for the target release" };
  return {
    outlet: { stages: [{ kind: "orifice", invertElevFt: Math.round(floor * 100) / 100, diameterIn: sized.diameterIn, count: 1, coeff: orificeC }] },
    targetCfs: rel,
    headFt: Math.round(headFt * 100) / 100,
    estimated: true,
  };
}

/* Validate an outlet model — every stage well-formed (kind + the fields its kind needs).
 * Returns a list of problem strings (empty = OK). Pure. */
export function outletProblems(outlet) {
  const out = [];
  const stages = outlet && Array.isArray(outlet.stages) ? outlet.stages : null;
  if (!stages || !stages.length) return ["no outlet stages defined"];
  stages.forEach((s, i) => {
    const at = `stage #${i + 1}`;
    if (!s || !OUTLET_KINDS.includes(s.kind)) { out.push(`${at}: unknown kind "${s && s.kind}"`); return; }
    if (s.kind === "orifice") {
      if (num(s.invertElevFt) == null) out.push(`${at} (orifice): invertElevFt required`);
      if (!(num(s.diameterIn) > 0)) out.push(`${at} (orifice): diameterIn must be > 0`);
    } else if (s.kind === "weir") {
      if (num(s.crestElevFt) == null) out.push(`${at} (weir): crestElevFt required`);
      if (!(num(s.lengthFt) > 0)) out.push(`${at} (weir): lengthFt must be > 0`);
    } else if (s.kind === "restrictor") {
      if (num(s.invertElevFt) == null) out.push(`${at} (restrictor): invertElevFt required`);
      if (!(num(s.maxCfs) >= 0)) out.push(`${at} (restrictor): maxCfs must be ≥ 0`);
    }
  });
  return out;
}

/* The lowest engaged elevation of an outlet (its lowest invert/crest) — the stage at which
 * it first releases. Used to seat the rating curve's bottom. Returns null when empty. Pure. */
export function outletLowestElev(outlet) {
  const stages = outlet && Array.isArray(outlet.stages) ? outlet.stages : [];
  let lo = null;
  for (const s of stages) {
    const e = s.kind === "weir" ? num(s.crestElevFt) : num(s.invertElevFt);
    if (e != null && (lo == null || e < lo)) lo = e;
  }
  return lo;
}
