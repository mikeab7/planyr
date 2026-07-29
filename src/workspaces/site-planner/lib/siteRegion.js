/* Which STATE a site is in — the tiny synchronous half of the Colorado tier.
 *
 * WHY THIS IS ITS OWN MODULE (perf budget, 2026-07-29). `coloradoRegions.js` carries the regime
 * records, the CWCB standard and the capability matrix — and those are mostly PROSE. A Texas user
 * has no use for a byte of it, but importing `siteState` from there dragged the whole thing onto
 * the Site route's chunk and breached `bundle.siteRouteJsBytes` / `bundle.largestChunkBytes`. The
 * standing rule is that a feature which breaches a budget ships with a matching optimization, so
 * the Colorado copy is now loaded ON DEMAND (a dynamic import, only once a site resolves to CO —
 * the `lib/exportSheet.js` precedent) and this module is the piece that has to stay synchronous.
 *
 * It has to stay synchronous because it is what the GUARD keys off, and the guard must hold
 * even when nothing has loaded and every GIS endpoint is down — which is exactly when a site is
 * most likely to fall through to a default. Geometry only: no network, no prose, no registry.
 *
 * Pure. Node-testable.
 */

/* Coarse state envelopes. Generous on purpose — this decides which RULES may apply, so a false
 * "unknown" (pre-Colorado behaviour, safe) is far better than a false confident answer. */
export const STATE_ENVELOPES = {
  TX: [25.5, -107.0, 36.8, -93.3],
  CO: [36.9, -109.2, 41.1, -101.9],
};

/* "TX" | "CO" | null. Null for a site with no coordinates (every legacy saved plan) and for one
 * outside both envelopes — and null behaves exactly as the app did before Colorado existed. The
 * guard fires on a POSITIVE Colorado answer, never on the absence of one. */
export function siteState({ lat = null, lng = null, lon = null } = {}) {
  const la = Number(lat), lo = Number(lng != null ? lng : lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  for (const [st, b] of Object.entries(STATE_ENVELOPES)) {
    if (la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3]) return st;
  }
  return null;
}

export const isColorado = (pt) => siteState(pt) === "CO";
