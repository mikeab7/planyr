/* B904 — CE roadmap #2's GUARDRAIL: pick the right runoff METHOD for the tributary area.
 *
 * The Rational method (Q = C·i·A, what pondRouting.js uses today) is a peak-flow-only
 * screening tool valid for SMALL, quick-responding drainage areas — the industry rule of
 * thumb is roughly up to 200 ac, tighter in some manuals. It produces no runoff HYDROGRAPH
 * (a flow-vs-time curve), so it can't properly represent storage routing once a watershed
 * is big enough that timing/attenuation across the basin actually matters. Past that, an
 * NRCS unit-hydrograph analysis (curve number + a design-storm hyetograph — hyetograph.js,
 * curveNumber.js's excessRainfallSeries — convolved into a hydrograph) is the correct tool.
 *
 * The ceiling is CRITERIA-CONFIGURABLE (detentionCriteria.js's `rationalMethodMaxAcres`,
 * same override mechanism as every other criterion), not a hardcoded magic number, so a
 * different county manual can set its own threshold.
 *
 * This selector only picks the method and raises the flag — it does NOT (yet) wire a full
 * NRCS unit-hydrograph inflow into the level-pool routing (#712's assessRoutedDetention
 * still routes a Modified-Rational hydrograph regardless of the selected method). That's
 * flagged honestly in the result, not silently glossed over: `method:"nrcs"` alongside
 * `routingIsProxy:true` means "NRCS is the indicated method, but the routed numbers you're
 * looking at are still the Rational proxy — confirm with a real HEC-HMS model." Wiring the
 * true NRCS hydrograph into the routing pass is a separate, larger follow-on.
 *
 * LOUD-FAILURE: no contributing area returns method:null, never a fabricated pick. Pure. */

export const DEFAULT_RATIONAL_METHOD_MAX_ACRES = 200;

/* Pick Rational vs. NRCS by tributary area against the jurisdiction's (or the default)
 * ceiling. Returns { method:"rational"|"nrcs"|null, ceilingAcres, areaAcres, overThreshold,
 * routingIsProxy, source, verified }. `criteria` is a criteriaFor() result — its
 * `rationalMethodMaxAcres` carrier supplies the ceiling when present. Pure. */
export function selectDetentionMethod({ areaAcres, criteria = null } = {}) {
  const A = Number(areaAcres);
  const carrier = criteria?.rationalMethodMaxAcres;
  const ceilingAcres = Number.isFinite(carrier?.value) ? carrier.value : DEFAULT_RATIONAL_METHOD_MAX_ACRES;
  if (!Number.isFinite(A) || A <= 0) {
    return { method: null, ceilingAcres, areaAcres: null, overThreshold: false, routingIsProxy: false, source: carrier?.source ?? null, verified: !!carrier?.verified };
  }
  const overThreshold = A > ceilingAcres;
  return {
    method: overThreshold ? "nrcs" : "rational",
    ceilingAcres,
    areaAcres: A,
    overThreshold,
    // NRCS is indicated but the routing pass hasn't been wired to a real unit-hydrograph
    // inflow yet (CE roadmap #2, stage 2) — the routed numbers still ride the Rational proxy.
    routingIsProxy: overThreshold,
    source: carrier?.source ?? null,
    verified: !!carrier?.verified,
  };
}
