/* PR-I — COMPUTE, don't interrogate. A real-estate developer (not a civil engineer) must never
 * face an empty input box demanding an expert value. Every engineering criterion the solver needs
 * gets a COMPUTED / ESTIMATED screening default derived from data the app already holds, shown
 * pre-filled with an EST tag. These are honest ESTIMATES (screening-grade), never surveyed or
 * regulatory truth — the UI always tags them EST and the tooltip says "refine later". Pure.
 *
 * The defaults still FEED the PR-H buildable envelope (so an estimate can't let Optimize buy back a
 * false green past a physical limit); the plain-English reason names the estimated criterion as an
 * assumption when the verdict depends on it.
 */

// Screening seasonal-high depth to water (ft below existing grade) when neither a SSURGO nor a TWDB
// signal is available. The Houston / Gulf-Coast coastal plain has a characteristically shallow
// seasonal-high water table; ~5 ft below grade is a conservative screening assumption (deep enough
// not to false-alarm every basin, shallow enough to flag a deep cut). A real value from
// combineDepthToWater (SSURGO/TWDB) always wins over this constant. Confirm with a geotech boring.
export const REGIONAL_SEASONAL_HIGH_DTW_FT = 5;

// Fallback soft max-excavation screen (ft of water depth) when groundwater can't even be estimated.
export const DEFAULT_MAX_EXCAV_DEPTH_FT = 12;

const fin = (n) => (Number.isFinite(n) ? n : null);

/* Depth to water (ft below existing grade). A measured/derived value (SSURGO/TWDB) wins; else the
 * regional screening constant. Never null — the whole point is "no blank". */
export function estDepthToWaterFt({ measuredFt = null } = {}) {
  const m = fin(measuredFt);
  return { valueFt: m != null ? m : REGIONAL_SEASONAL_HIGH_DTW_FT, source: m != null ? "measured" : "regional-est", estimated: m == null };
}

/* Receiving-water (tailwater) elevation the outfall must discharge above by gravity.
 * ⛔ PR-N / O5 ROOT-CAUSE FIX: this is NEVER site grade and NEVER the floodplain-sheet flood WSE. The
 * old default (flood WSE, else grade) set tailwater ≈ grade on a Zone A site, which DEADLOCKS every
 * pond by construction (outflow can't fall below tailwater, inflow can't rise above grade → usable
 * storage squeezed to zero → "not buildable"). The outfall discharges into the receiving CHANNEL,
 * which is cut BELOW grade — so a real below-grade channel value is required (district / FEMA InFRM /
 * USGS / terrain flowline, resolved by lib/tailwaterSource.js). `channelWseFt` is that value; it is
 * accepted only when it sits below grade. With none, the tailwater is UNKNOWN (null) — an honest blank
 * the UI flags, never a grade placeholder that fabricates a deadlock. */
export function estTailwaterElevFt({ channelWseFt = null, gradeFt = null } = {}) {
  const c = fin(channelWseFt);
  const g = fin(gradeFt);
  if (c != null && (g == null || c < g - 0.05)) return { valueFt: c, source: "channel", estimated: true };
  return { valueFt: null, source: null, estimated: true };
}

/* Max excavation depth (ft of water depth) before the cut likely hits groundwater — default to the
 * seasonal-high depth to water ("don't dig below groundwater"), else the fallback soft screen. */
export function estMaxExcavDepthFt({ depthToWaterFt = null } = {}) {
  const d = fin(depthToWaterFt);
  return { valueFt: d != null && d > 0 ? d : DEFAULT_MAX_EXCAV_DEPTH_FT, source: d != null && d > 0 ? "depth-to-water" : "fallback", estimated: true };
}

/* A permanent pool is only meaningful for a WET pond (retention) — a dry Detention basin has no
 * standing water, so the "Permanent pool elev." input must not render for it (PR-I / I3). Wet =
 * the resolved purpose includes retention: Mitigation or Hybrid (dual). */
export function poolRelevantForRole(role) {
  return role === "mitigation" || role === "dual";
}
