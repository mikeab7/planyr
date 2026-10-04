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

import { inCaliforniaEnvelope } from "./californiaJurisdiction.js";

/* Coarse state envelopes. Generous on purpose — this decides which RULES may apply, so a false
 * "unknown" (pre-Colorado behaviour, safe) is far better than a false confident answer. */
export const STATE_ENVELOPES = {
  TX: [25.5, -107.0, 36.8, -93.3],
  CO: [36.9, -109.2, 41.1, -101.9],
  /* NEW-1 (Georgia). Generous like the others, so it also holds edges of SC / AL / FL / NC / TN — which
   * is fine HERE: this answers "which state's RULES may apply", and a wrong "GA" only ever HIDES a Texas
   * number (fail-closed). Which counties/cities a point is IN is decided by point-in-polygon in
   * `jurisdiction.js`, never by this box. It overlaps neither TX nor CO. Keep in sync with
   * `georgiaJurisdiction.GA_ENVELOPE_BOX` (test/georgiaJurisdiction.test.js asserts it). */
  GA: [30.3, -85.7, 35.1, -80.7],
  /* NEW-1 (California). Generous like the others, so it also holds edges of NV / OR / AZ / Baja California —
   * fine HERE for the same fail-closed reason as Georgia's (a wrong "CA" only ever HIDES a Texas number).
   * Which counties/cities a point is IN is decided by point-in-polygon in `jurisdiction.js`, never by this
   * box. It overlaps none of TX / CO / GA. Keep in sync with `californiaJurisdiction.CA_ENVELOPE_BOX`
   * (test/californiaJurisdiction.test.js asserts it). */
  CA: [32.5, -124.5, 42.0, -114.1],
};

/* NEW-1 (FL/GA pipelines) — Florida and Georgia are POLYGONS, not boxes. A box generous enough to
 * hold Florida also holds south Alabama, and one for Georgia holds half of South Carolina; those
 * states would then be told they are FL/GA and offered a pipeline layer and a "Florida 811" pointer
 * that are wrong for them. These are hand-simplified outlines, [lng, lat], padded ~0.1° out to sea
 * so a shoreline site is never "unknown" — screening-grade, and a false "unknown" is safe (the
 * pre-FL/GA behaviour) where a false state is not. Order matters only along the shared FL/GA line. */
export const STATE_POLYGONS = {
  FL: [
    [-87.6, 31.02], [-85.0, 31.02], [-84.88, 30.72], [-83.1, 30.63], [-82.23, 30.58], [-82.05, 30.36],
    [-81.4, 30.72], [-81.2, 29.9], [-80.4, 28.4], [-79.95, 26.8], [-79.95, 25.8], [-80.3, 25.1],
    [-80.4, 24.85], [-81.0, 24.4], [-81.95, 24.35], [-82.1, 24.6], [-81.9, 25.3], [-82.15, 26.0],
    [-82.4, 26.9], [-82.9, 27.6], [-82.85, 28.9], [-83.45, 29.45], [-84.05, 29.85], [-84.65, 29.6],
    [-85.45, 29.45], [-86.55, 30.15], [-87.5, 30.15],
  ],
  GA: [
    [-85.65, 35.02], [-83.1, 35.02], [-83.15, 34.5], [-82.85, 34.3], [-82.5, 33.9], [-82.15, 33.6],
    [-81.9, 33.45], [-81.65, 33.2], [-81.4, 32.8], [-81.1, 32.35], [-80.85, 32.3], [-80.7, 31.98], [-81.0, 31.45], [-81.35, 30.95],
    [-81.4, 30.7], [-82.05, 30.36], [-82.23, 30.58], [-83.1, 30.63], [-84.88, 30.72], [-85.0, 31.02],
    [-85.05, 31.6], [-85.15, 32.3], [-85.19, 32.87],
  ],
};

function inPolygon(lng, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* "TX" | "CO" | "FL" | "GA" | "CA" | null. Null for a site with no coordinates (every legacy saved plan) and
 * for one outside every region — and null behaves exactly as the app did before Colorado existed. The
 * guard fires on a POSITIVE answer, never on the absence of one.
 *
 * ORDER (NEW-1 FL/GA pipelines): the FL/GA OUTLINES are asked FIRST. Georgia's routing box (below, B1990960)
 * is deliberately generous and reaches south of 30.3°N — it holds Jacksonville and Tallahassee — so asked
 * first it would call north Florida "GA" and hand a Florida parcel Georgia's 811 pointer. The outlines are
 * disjoint from the TX / CO / CA boxes, so asking them first moves nobody else. A point inside the GA BOX
 * but outside both outlines (the SC / AL / TN edges) still answers "GA", exactly as main decided: a wrong
 * "GA" there only ever HIDES a Texas number (fail-closed). */
export function siteState({ lat = null, lng = null, lon = null } = {}) {
  const la = Number(lat), lo = Number(lng != null ? lng : lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  for (const [st, poly] of Object.entries(STATE_POLYGONS)) {
    if (inPolygon(lo, la, poly)) return st;
  }
  for (const [st, b] of Object.entries(STATE_ENVELOPES)) {
    if (la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3]) {
      // NEW-1 — California's box is only the pre-filter; its diagonal east edge is refined by an outline (see californiaJurisdiction.js)
      if (st === "CA" && !inCaliforniaEnvelope(la, lo)) continue;
      return st;
    }
  }
  return null;
}

export const isColorado = (pt) => siteState(pt) === "CO";
export const isGeorgia = (pt) => siteState(pt) === "GA";
export const isCalifornia = (pt) => siteState(pt) === "CA";
