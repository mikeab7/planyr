/* Metro Nashville & Davidson County — WHICH GOVERNMENT ZONES A POINT (NEW-1, 2026-11-12; owner constraints #41 / #46).
 *
 * Metro's zoning layer covers the whole county, but six cities inside it — Belle Meade, Berry Hill, Forest Hills, Goodlettsville, Oak Hill and Ridgetop — run their own zoning. Metro's layer reads
 * "Satellite City" on that land, and the parcel roll's zoning column carries a placeholder code (3ZZ … 9ZZ). So a zoning result is labelled by where the SITE falls: inside a satellite city's limits it is
 * "zoned by City of X — not Metro"; anywhere else in Davidson County it is Metro's.
 *
 * The eight satellite polygons (Ridgetop is three pieces; ~4,400 vertices) are fetched ONCE straight from Metro's ArcGIS Online org (CORS-open) and kept in memory. `satelliteCityAt` is synchronous and
 * answers `null` until they have loaded AND for a point outside every one — the two are told apart by `satellitesReady()` where it matters. A failed fetch is retried on the next ask and never cached as
 * "no satellite cities". `satelliteFrom` is pure (unit-tested over a recorded-shape fixture); only `ensureSatellites` touches the network. */

import { pointInGeometry, titleCase } from "./desotoJurisdiction.js";

export const SATELLITES_URL = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Satellite_Cities_view/FeatureServer/0/query?where=1%3D1&outFields=Name&outSR=4326&f=geojson";
/* [south, west, north, east] — a box a little larger than Davidson County (extent 35.99–36.41 N, −87.06 – −86.52 W). Only a guard against asking a far-away point. */
const COUNTY_BOX = [35.9, -87.15, 36.45, -86.45];

/* "CITY OF BELLE MEADE" → "City of Belle Meade" */
export const cityName = (raw) => titleCase(raw).replace(/\bOf\b/g, "of");

/* The satellite city a point is in ("City of Belle Meade"), or null when it is in none of them — or outside Davidson County altogether, or no limits are in hand. Pure. */
export function satelliteFrom(fc, lat, lng) {
  const feats = fc && Array.isArray(fc.features) ? fc.features : null;
  if (!feats || !feats.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < COUNTY_BOX[0] || lat > COUNTY_BOX[2] || lng < COUNTY_BOX[1] || lng > COUNTY_BOX[3]) return null;
  for (const f of feats) if (pointInGeometry(f && f.geometry, lng, lat)) return cityName(f.properties && f.properties.Name) || "a satellite city";
  return null;
}

let CACHE = null;
let LOADING = null;
const subs = new Set();
export const satellitesReady = () => !!CACHE;
export const subscribeSatellites = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function _setSatellites(fc) { CACHE = fc; LOADING = fc ? Promise.resolve(fc) : null; } // tests / harness seam

export function ensureSatellites(fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (CACHE) return Promise.resolve(CACHE);
  if (LOADING) return LOADING;
  if (!fetchImpl) return Promise.resolve(null);
  LOADING = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchImpl(SATELLITES_URL);
        if (!r || !r.ok) continue;
        const j = await r.json();
        if (j && Array.isArray(j.features) && j.features.length) { CACHE = j; subs.forEach((cb) => { try { cb(); } catch (_) { /* a subscriber never breaks the loader */ } }); return j; }
      } catch (_) { /* retry once, then give up loudly below */ }
    }
    if (typeof console !== "undefined") console.error("[nashvilleJurisdiction] Metro's satellite-city limits did not load — a zoning result inside Belle Meade, Goodlettsville … cannot name its city");
    LOADING = null; // a failure is never cached as "no satellite cities": the next ask tries again
    return null;
  })();
  return LOADING;
}

/* Synchronous: the satellite city at a point, or null (none, or not loaded yet — and it starts loading them). */
export function satelliteCityAt(lat, lng) {
  if (!CACHE) { ensureSatellites(); return null; }
  return satelliteFrom(CACHE, Number(lat), Number(lng));
}
