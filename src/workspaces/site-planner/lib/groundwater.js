/* NEW-B3 — depth-to-water screen for pond feasibility. A high seasonal water table turns a
 * dry detention basin into a WET pond: the permanent pool below the water table stores nothing
 * creditable for detention (the existing bandedStorage pool-dead band), and excavation runs
 * into groundwater. This module combines TWO independent depth-to-water signals — SSURGO's
 * seasonal-high water table (soils.js) and the nearest TWDB observation well (twdbWells.js) —
 * each carrying its provenance, and screens the pond.
 *
 * Screening only — a desktop groundwater read, NOT a geotech investigation; the seasonal high
 * water table varies with rainfall/season and the two sources measure different things (a soil
 * map-unit estimate vs a point well reading). LOUD-FAILURE: no signal → an honest "unknown",
 * never a fabricated depth. Pure + Node-testable; no DOM/network. */

const num = (v) => (Number.isFinite(v) ? v : null);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/* Combine the SSURGO + TWDB depth-to-water signals into one screening reading. Each input is
 * a depth BELOW EXISTING GRADE in feet (or null). Returns { depthToWaterFt, governing, signals }
 * where `governing` is the SHALLOWER (conservative wet case) of the available signals, and
 * `signals` lists each with its provenance so the UI shows both. Null depthToWaterFt when
 * neither is available. Pure. */
export function combineDepthToWater({ ssurgoFt = null, twdbFt = null, twdbWellId = null, twdbDistFt = null } = {}) {
  const signals = [];
  if (num(ssurgoFt) != null) signals.push({ source: "SSURGO seasonal-high water table", depthFt: r2(ssurgoFt), kind: "ssurgo" });
  if (num(twdbFt) != null) signals.push({ source: `TWDB observation well${twdbWellId ? ` ${twdbWellId}` : ""}${twdbDistFt != null ? ` (~${Math.round(twdbDistFt)} ft away)` : ""}`, depthFt: r2(twdbFt), kind: "twdb" });
  if (!signals.length) return { depthToWaterFt: null, governing: null, signals: [] };
  const governing = signals.reduce((a, s) => (s.depthFt < a.depthFt ? s : a), signals[0]);
  return { depthToWaterFt: governing.depthFt, governing, signals };
}

/* Screen a pond against the water table. Inputs (feet / ft NAVD88):
 *   depthToWaterFt — seasonal-high depth to water BELOW existing grade (from combineDepthToWater)
 *   gradeElevFt    — existing grade at the pond (3DEP)
 *   tobElevFt, pondDepthFt — the pond's top-of-bank + design depth (basin floor = tob − depth)
 * Returns { known, wetPond, waterTableElevFt, floorElevFt, poolDepthFt, suggestedPoolElevFt,
 *           severity, message } — poolDepthFt is how deep the permanent pool sits in the basin
 * (feeds the bandedStorage poolElev / usable-volume split), 0 for a dry pond. Never fabricates:
 * missing inputs → known:false with the reason. Pure. */
export function pondGroundwaterScreen({ depthToWaterFt = null, gradeElevFt = null, tobElevFt = null, pondDepthFt = 8 } = {}) {
  const dtw = num(depthToWaterFt), grade = num(gradeElevFt), tob = num(tobElevFt), depth = num(pondDepthFt) ?? 8;
  if (dtw == null) return { known: false, wetPond: null, message: "Depth to water unknown — soils / well data not available; wet-vs-dry pond feasibility unscreened.", severity: "muted" };
  if (grade == null || tob == null) {
    return { known: false, wetPond: null, waterTableDepthFt: dtw, message: `Seasonal-high water table ≈ ${r2(dtw)} ft below grade. Anchor the pond (top-of-bank + grade) to screen wet-vs-dry feasibility.`, severity: "muted" };
  }
  const waterTableElev = grade - dtw;
  const floorElev = tob - depth;
  const poolDepthFt = Math.max(0, Math.min(depth, waterTableElev - floorElev));
  const wetPond = poolDepthFt > 0.25;
  if (!wetPond) {
    return { known: true, wetPond: false, waterTableElevFt: r2(waterTableElev), floorElevFt: r2(floorElev), poolDepthFt: 0, suggestedPoolElevFt: null, severity: "ok",
      message: `Dry pond feasible: seasonal-high water table (≈ ${r2(dtw)} ft below grade, elev ${r2(waterTableElev)}) sits below the basin floor (${r2(floorElev)}). Confirm with a boring.` };
  }
  return {
    known: true, wetPond: true, waterTableElevFt: r2(waterTableElev), floorElevFt: r2(floorElev),
    poolDepthFt: r2(poolDepthFt), suggestedPoolElevFt: r2(waterTableElev), severity: "warn",
    message: `Wet pond: the seasonal-high water table (≈ ${r2(dtw)} ft below grade, elev ${r2(waterTableElev)}) rises ~${r2(poolDepthFt)} ft ABOVE the basin floor (${r2(floorElev)}). That depth is a permanent pool — it stores nothing creditable for dry detention, and excavation hits groundwater. Set a permanent-pool elevation ≈ ${r2(waterTableElev)} ft, or shallow the basin. Confirm with a geotech boring.`,
  };
}
