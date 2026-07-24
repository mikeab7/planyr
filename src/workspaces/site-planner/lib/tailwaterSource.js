/* PR-N (DECISION 4) — derive the OUTFALL TAILWATER (downstream receiving-water surface elevation at
 * the outlet) from public sources, because the owner cannot supply it. Screening only; the value is
 * ALWAYS tagged EST and always names its source, and it feeds the outlet/outfall feasibility (gravity
 * vs pumped/lift — e.g. the Tsakiris pond's 153.1' receiving vs 145.1' outlet).
 *
 * PRIORITY LADDER (highest-confidence first):
 *   (a) district      — Brookshire-Katy Drainage District GIS / channel design water surface.
 *   (b) femaFis        — FEMA/USGS InFRM Base Level Engineering (estBFE) modeled 100-yr WSE for the
 *                        receiving stream (webapps.usgs.gov/infrm/estbfe/ — covers Waller County).
 *   (c) usgs           — nearest USGS gauge statistics (e.g. a high-frequency stage).
 *   (d) normalDepth    — normal-depth estimate from channel geometry + terrain (Manning's, this file).
 *   (e) channelTerrain — the receiving channel's flowline sampled from TERRAIN along the channel
 *                        centerline (channels here are cut well BELOW grade); the honest last resort.
 *
 * ⛔ O5 ROOT-CAUSE RULE: NEVER default the tailwater to SITE GRADE. A receiving channel is cut below
 * grade; setting tailwater == grade deadlocks every pond by construction (outflow can't fall below the
 * tailwater, inflow can't rise above grade → usable storage is squeezed to zero → "not buildable").
 * So there is no grade proxy in this ladder, and `deriveTailwater` REJECTS any candidate whose value
 * equals site grade (a placeholder leak). When nothing real resolves, the tailwater is UNKNOWN (null)
 * — an honest blank the UI flags, never a grade placeholder that fabricates a deadlock.
 *
 * Pure + injectable. `deriveTailwater` is the unit-testable priority pick; `resolveTailwater` is the
 * async orchestrator that tries live fetchers in order and degrades gracefully (like the K7 district
 * ingest) — the live InFRM/BKDD/USGS fetch is egress-blocked in the sandbox, so it ships behind an
 * injectable seam and is confirmed live. No DOM, no network of its own. */

// Placeholder-leak guard: a candidate within this of site grade is treated as the grade placeholder
// (not real receiving-water data) and rejected.
export const GRADE_PLACEHOLDER_EPS_FT = 0.05;

// The ordered source registry — id, priority (lower = higher confidence), a short UI label, and the
// tooltip that names WHERE the number came from. `estimated` is always true (screening tailwater).
// R1 — each source carries a REGIME: "storm" = the design-storm / 100-yr receiving level (feeds the
// routing + outfall-feasibility checks), "normal" = the dry-weather receiving level (the channel
// flowline / normal-depth — the STARTING water surface the pond recovers to between storms, which
// sets the permanent DEAD-storage floor). The dead-storage floor must use the NORMAL regime, never a
// storm level, or the pond's usable volume is wrongly squeezed by a flood it isn't sitting in.
export const TAILWATER_SOURCES = Object.freeze([
  { id: "district", priority: 1, regime: "storm", label: "district channel", tip: "Design water surface from the Brookshire-Katy Drainage District's channel data (screening)." },
  { id: "femaFis", priority: 2, regime: "storm", label: "FEMA InFRM (est BFE)", tip: "FEMA/USGS InFRM Base Level Engineering modeled 100-yr water surface for the receiving stream (webapps.usgs.gov/infrm/estbfe, screening)." },
  { id: "usgs", priority: 3, regime: "storm", label: "USGS gauge", tip: "Statistics from the nearest USGS stream gauge (screening)." },
  { id: "normalDepth", priority: 4, regime: "normal", label: "normal depth (est)", tip: "Normal-depth estimate from channel geometry and terrain slope (Manning's equation, screening) — the dry-weather receiving level." },
  { id: "channelTerrain", priority: 5, regime: "normal", label: "channel flowline (terrain est)", tip: "Receiving-channel flowline sampled from terrain along the channel centerline (below grade); the dry-weather flowline, never site grade." },
]);

const SOURCE_BY_ID = Object.fromEntries(TAILWATER_SOURCES.map((s) => [s.id, s]));
const finite = (n) => n != null && Number.isFinite(n);

/* Pure priority pick. `candidates` maps each source id → `{ valueFt, note? }` (or null/omitted when
 * that source produced nothing). Returns the highest-priority available value, tagged with its source
 * id + label + tooltip, ALWAYS `estimated: true`. `opts.gradeFt` enables the O5 placeholder guard: any
 * candidate whose value equals site grade is skipped (it's the grade placeholder, not real data), and
 * the guard's rejections are reported in `rejectedGrade`. `degraded` is true when we fell through to
 * the terrain fallback. Returns valueFt:null (UNKNOWN, never grade) when nothing real is available. */
export function deriveTailwater(candidates = {}, { gradeFt = null, regime = null } = {}) {
  const rejectedGrade = [];
  for (const src of TAILWATER_SOURCES) {
    // R1 — a regime filter ("normal" for the dead-storage floor, "storm" for routing/outfall) lets
    // the caller pick the dry-weather receiving level distinctly from the design-storm level.
    if (regime && src.regime !== regime) continue;
    const c = candidates[src.id];
    if (!c || !finite(c.valueFt)) continue;
    if (finite(gradeFt) && Math.abs(c.valueFt - gradeFt) < GRADE_PLACEHOLDER_EPS_FT) {
      rejectedGrade.push(src.id); // O5 — a value equal to site grade is a placeholder, not data
      continue;
    }
    return {
      valueFt: c.valueFt,
      source: src.id,
      sourceLabel: src.label,
      sourceTip: src.tip,
      regime: src.regime,
      estimated: true,
      degraded: src.id === "channelTerrain",
      belowGrade: finite(gradeFt) ? c.valueFt < gradeFt : null,
      rejectedGrade,
      note: c.note || null,
    };
  }
  return { valueFt: null, source: null, sourceLabel: null, sourceTip: null, regime: null, estimated: true, degraded: true, belowGrade: null, rejectedGrade, note: null };
}

/* Source (e) — the receiving-channel flowline estimated from terrain. The caller samples the DEM along
 * the channel centerline (near the outfall) and passes the resulting invert; this just packages it,
 * refusing any value at/above grade (a channel cut below grade must read below grade). Pure. */
export function channelTerrainWse({ channelInvertFt = null, gradeFt = null } = {}) {
  if (!finite(channelInvertFt)) return null;
  if (finite(gradeFt) && channelInvertFt >= gradeFt - GRADE_PLACEHOLDER_EPS_FT) return null; // not below grade → not a valid channel flowline
  return { valueFt: channelInvertFt, note: "flowline from terrain along the channel centerline" };
}

/* Manning's NORMAL DEPTH for a trapezoidal channel (English units), source (d). Solves
 *   Q = (1.49/n) · A · R^(2/3) · S^(1/2),  A = (b + z·y)·y,  P = b + 2y·√(1+z²),  R = A/P
 * for the depth y by bisection, then WSE = invert + y. Screening only. Returns
 * `{ valueFt, depthFt }` or null when the inputs are insufficient / non-physical. Pure. */
export function normalDepthWse({ channelInvertFt = null, dischargeCfs = null, bottomWidthFt = null, sideSlope = 2, manningN = 0.035, channelSlope = null, maxDepthFt = 40 } = {}) {
  if (![channelInvertFt, dischargeCfs, bottomWidthFt, channelSlope].every(finite)) return null;
  if (dischargeCfs <= 0 || channelSlope <= 0 || bottomWidthFt < 0 || manningN <= 0) return null;
  const z = Math.max(0, sideSlope);
  const capacity = (y) => {
    const A = (bottomWidthFt + z * y) * y;
    const P = bottomWidthFt + 2 * y * Math.sqrt(1 + z * z);
    if (A <= 0 || P <= 0) return 0;
    const R = A / P;
    return (1.49 / manningN) * A * Math.pow(R, 2 / 3) * Math.sqrt(channelSlope);
  };
  // bisection on y ∈ (0, maxDepthFt]; capacity is monotonic increasing in y.
  let lo = 0, hi = maxDepthFt;
  if (capacity(hi) < dischargeCfs) return null; // channel too small at maxDepth → out of screening range
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (capacity(mid) < dischargeCfs) lo = mid; else hi = mid;
  }
  const depthFt = (lo + hi) / 2;
  return { valueFt: channelInvertFt + depthFt, depthFt };
}

/* Async orchestrator: try each live source's fetcher in priority order, catch failures, and fall
 * through to the local candidates (normalDepth, proxy) already computed by the caller. `fetchers` maps
 * a source id → `async (ctx) => ({ valueFt, note? }) | null` (only the network sources need one). Any
 * fetcher that throws or returns null is skipped and logged. Returns the `deriveTailwater` result plus
 * an `attempts` log (graceful degradation). Pure over its injected fetchers. */
export async function resolveTailwater({ ctx = {}, fetchers = {}, localCandidates = {} } = {}) {
  const attempts = [];
  const candidates = { ...localCandidates };
  for (const id of ["district", "femaFis", "usgs"]) {
    const fn = fetchers[id];
    if (typeof fn !== "function") continue;
    try {
      const r = await fn(ctx);
      if (r && finite(r.valueFt)) { candidates[id] = r; attempts.push({ id, ok: true }); }
      else attempts.push({ id, ok: false, reason: "no value" });
    } catch (e) {
      attempts.push({ id, ok: false, reason: String((e && e.message) || e) });
    }
  }
  return { ...deriveTailwater(candidates, { gradeFt: ctx.gradeFt }), attempts };
}

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/* Plain-English one-liner for the panel: names the value, the source, and the EST caveat. Pure,
 * em-dash-free. */
export function tailwaterNote(result) {
  if (!result || !finite(result.valueFt)) return "Receiving-water level at the outfall is unknown; enter it to check gravity discharge.";
  const src = SOURCE_BY_ID[result.source];
  const from = src ? ` from ${src.label}` : "";
  return `Receiving water about ${f1(result.valueFt)}' at the outfall${from} (estimated). ${src ? src.tip : ""}`.trim();
}
