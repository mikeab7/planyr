/* B905 — CE roadmap #3: a COMPUTED time of concentration (Tc), replacing the hard-coded
 * 15-min screening assumption pondRouting.js used everywhere. Tc is the single most
 * important timing input in storm hydrology: the Rational method reads its intensity `i`
 * off the IDF curve AT A DURATION EQUAL TO Tc, and the NRCS unit-hydrograph's peak/shape
 * scale with it — every downstream number (design-storm peak, required detention volume)
 * inherits whatever Tc assumption feeds it. A flat 15-min guess can be materially off for a
 * large or flat site (flat sites have LONGER Tc → LOWER intensity → different sizing).
 *
 * KIRPICH (the screening default here, structured so a more rigorous TR-55 segmental method
 * — sheet flow + shallow concentrated + channel flow — can be added later without touching
 * callers):
 *   Tc (min) = 0.0078 · L^0.77 · S^-0.385      (L in ft, S in ft/ft)
 * — an empirical formula for small rural basins; a paved/urban area drains faster than the
 * bare-earth channels Kirpich was fit to, so a common adjustment scales Tc down toward
 * `urbanAdjustment` (≈0.4 at full imperviousness) as the site's impervious % rises.
 *
 * INPUTS the site model doesn't always carry directly:
 *   L (flow-path length) — the hydraulically longest path across the contributing area. When
 *     a real flow path isn't available (this module's callers don't yet trace one — see the
 *     module-doc's "not yet wired" note below), screening-estimate it from the contributing
 *     AREA: L ≈ k·√(area in sf), k a criteria-configurable screening factor (default 1.5 — an
 *     irregular basin's longest path runs longer than a simple square's side).
 *   S (average slope) — the site's grade. When a resolved grade isn't available (the true-
 *     grade path — sampling the 3DEP DEM along the flow path — is a larger, separate wire-up;
 *     NOT yet built here), fall back to a criteria-configurable default slope, clearly flagged.
 * Both fallbacks are explicit, labeled ESTIMATES, never silently passed off as measured.
 *
 * Every coefficient (the urban adjustment, the Tc floor, the L-from-area k-factor, the
 * default fallback slope) is CRITERIA-CONFIGURABLE (detentionCriteria.js's `tc*` fields),
 * not an inline constant — a county manual can override any of them.
 *
 * LOUD-FAILURE: a missing/non-positive length or slope returns null — never a fabricated Tc.
 * Pure + Node-testable; no DOM/network (no live DEM sampling here — see above). */

const num = (v) => (Number.isFinite(v) ? v : null);
const round = (n, p = 2) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);

export const DEFAULT_KIRPICH_URBAN_ADJUSTMENT = 0.4; // commonly-cited paved-channel reduction at full imperviousness
export const DEFAULT_TC_FLOOR_MIN = 10; // most manuals floor Tc at 5–10 min; kept near the prior 15-min placeholder
export const DEFAULT_TC_DEFAULT_SLOPE_PCT = 1.0; // flat-industrial-site screening default when grade isn't resolved
export const DEFAULT_FLOW_PATH_K_FACTOR = 1.5; // L ≈ k·√(area) — an irregular basin's longest path exceeds a square's side

/* The Kirpich formula itself, plus the impervious-scaled urban adjustment (linear blend:
 * no adjustment at 0% impervious, full `urbanAdjustment` at 100%) and a floor. Returns the
 * clamped Tc in minutes, or null on bad inputs (LOUD-FAILURE). Pure. */
export function kirpichTcMin({
  lengthFt, slopeFtPerFt, imperviousPct = 0,
  urbanAdjustment = DEFAULT_KIRPICH_URBAN_ADJUSTMENT, floorMin = DEFAULT_TC_FLOOR_MIN,
} = {}) {
  const L = num(lengthFt), S = num(slopeFtPerFt);
  if (L == null || L <= 0 || S == null || S <= 0) return null;
  const raw = 0.0078 * Math.pow(L, 0.77) * Math.pow(S, -0.385);
  const impFrac = Math.max(0, Math.min(100, num(imperviousPct) ?? 0)) / 100;
  const adj = num(urbanAdjustment) ?? DEFAULT_KIRPICH_URBAN_ADJUSTMENT;
  const factor = 1 - impFrac * (1 - adj);
  const floor = num(floorMin) ?? DEFAULT_TC_FLOOR_MIN;
  return Math.max(floor, round(raw * factor, 2));
}

/* Screening-estimate the flow-path length from the contributing AREA alone (no real flow
 * path traced): L ≈ k·√(area in square feet). Returns feet, or null on bad input. Pure. */
export function estimateFlowPathLengthFt({ areaAcres, kFactor = DEFAULT_FLOW_PATH_K_FACTOR } = {}) {
  const A = num(areaAcres);
  if (A == null || A <= 0) return null;
  const k = num(kFactor) ?? DEFAULT_FLOW_PATH_K_FACTOR;
  return round(k * Math.sqrt(A * 43560), 1);
}

/* THE top-level call: compute Tc for a site, resolving L and S from whatever real inputs
 * are supplied (an explicit lengthFt / a resolved slopePct — a future flow-path-tracing or
 * DEM-grade wire-up feeds these), falling back to the area-based / default-slope screening
 * estimates otherwise — each fallback flagged, never silently substituted. `criteria` is a
 * criteriaFor() result; its `tc*` carriers (added B905) supply the coefficients when
 * present. Returns
 *   { tcMin, lengthFt, lengthEstimated, slopePct, slopeEstimated, floored, method, basis }
 * or null when there's nothing to compute from (no area AND no explicit length). Pure. */
export function computeTimeOfConcentration({ areaAcres, impPct = 0, lengthFt = null, slopePct = null, criteria = null } = {}) {
  const kFactor = criteria?.tcFlowPathKFactor?.value ?? DEFAULT_FLOW_PATH_K_FACTOR;
  const defaultSlopePct = criteria?.tcDefaultSlopePct?.value ?? DEFAULT_TC_DEFAULT_SLOPE_PCT;
  const urbanAdjustment = criteria?.tcUrbanAdjustment?.value ?? DEFAULT_KIRPICH_URBAN_ADJUSTMENT;
  const floorMin = criteria?.tcFloorMin?.value ?? DEFAULT_TC_FLOOR_MIN;

  const lengthEstimated = !(Number.isFinite(lengthFt) && lengthFt > 0);
  const L = lengthEstimated ? estimateFlowPathLengthFt({ areaAcres, kFactor }) : lengthFt;
  if (L == null) return null;

  const slopeEstimated = !(Number.isFinite(slopePct) && slopePct > 0);
  const S = slopeEstimated ? defaultSlopePct : slopePct;

  const tcMin = kirpichTcMin({ lengthFt: L, slopeFtPerFt: S / 100, imperviousPct: impPct, urbanAdjustment, floorMin });
  if (tcMin == null) return null;

  const raw = 0.0078 * Math.pow(L, 0.77) * Math.pow(S / 100, -0.385);
  return {
    tcMin,
    lengthFt: round(L, 1),
    lengthEstimated,
    slopePct: round(S, 2),
    slopeEstimated,
    floored: tcMin <= floorMin + 1e-9 && raw * (1 - (Math.max(0, Math.min(100, impPct ?? 0)) / 100) * (1 - urbanAdjustment)) < floorMin,
    method: "kirpich",
    basis: `Kirpich: Tc = 0.0078·L^0.77·S^-0.385, L=${round(L, 0)} ft${lengthEstimated ? " (screening estimate, L≈k√area)" : ""}, S=${round(S, 2)}%${slopeEstimated ? " (screening default, grade not resolved)" : ""}${impPct > 0 ? `, urban-adjusted for ${round(impPct, 0)}% impervious` : ""}.`,
  };
}
