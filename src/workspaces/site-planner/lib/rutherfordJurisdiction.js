/* Rutherford County TN — WHICH GOVERNMENT A POINT FALLS IN (NEW-1, 2026-11-12; the DeSoto precedent, desotoJurisdiction.js).
 *
 * The county's zoning table is OLDER than the cities' annexations (measured 2026-11-12: 155 county "district" polygons have their middle inside Murfreesboro's current limits, 10 inside Smyrna's), so a zoning
 * result is labelled by where the SITE falls, from the State of Tennessee's city-limits layer (GIS_SOURCES.cityTn — the same layer the City Limits row draws): inside Murfreesboro / Smyrna / La Vergne /
 * Eagleville it is that city; anywhere else in the county it is "Unincorporated Rutherford County". Tennessee has no ETJ (owner rule: the word never appears on a Tennessee site), so there is no third answer.
 *
 * The four limits are ~150 KB, fetched ONCE and kept in memory; `jurisdictionAt` is synchronous and answers `null` until they have loaded (the caller shows "Checking city limits…" — never a guess). A
 * failed fetch is retried on the next ask and never cached as "no cities". `jurisdictionFrom` is pure (unit-tested); only `ensureLimits` touches the network. */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { pointInGeometry } from "./desotoJurisdiction.js";
import { UNINCORPORATED } from "./rutherfordZoning.js";

/* The four incorporated places in Rutherford County, as the State's layer spells them → the name a person reads. */
export const CITY_NAMES = Object.freeze({ Murfreesboro: "Murfreesboro", Smyrna: "Smyrna", LaVergne: "La Vergne", Eagleville: "Eagleville" });
export const LIMITS_URL = `${GIS_SOURCES.cityTn.serviceUrl}/query?where=${encodeURIComponent("NAME IN ('Murfreesboro','Smyrna','LaVergne','Eagleville')")}&outFields=NAME&outSR=4326&geometryPrecision=5&f=geojson`;
/* [south, west, north, east] — a box a little larger than the county. Only a guard against asking a far-away point. */
const COUNTY_BOX = [35.55, -86.75, 36.1, -86.0];

/* The jurisdiction label for a point over a FeatureCollection of the city limits: the city's name inside it, UNINCORPORATED outside every one; `null` when no limits are in hand (unknown, never
 * "unincorporated") or the point is not near the county at all. Pure. */
export function jurisdictionFrom(fc, lat, lng) {
  const feats = fc && Array.isArray(fc.features) ? fc.features : null;
  if (!feats || !feats.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < COUNTY_BOX[0] || lat > COUNTY_BOX[2] || lng < COUNTY_BOX[1] || lng > COUNTY_BOX[3]) return null; // not Rutherford County at all — "unincorporated Rutherford County" would be a false answer
  for (const f of feats) if (pointInGeometry(f && f.geometry, lng, lat)) return CITY_NAMES[f.properties && f.properties.NAME] || String(f.properties && f.properties.NAME || "City limits");
  return UNINCORPORATED;
}

let CACHE = null;
let LOADING = null;
const subs = new Set();
export const limitsReady = () => !!CACHE;
export const subscribeLimits = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function _setLimits(fc) { CACHE = fc; LOADING = fc ? Promise.resolve(fc) : null; } // tests / harness seam

export function ensureLimits(fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (CACHE) return Promise.resolve(CACHE);
  if (LOADING) return LOADING;
  if (!fetchImpl) return Promise.resolve(null);
  LOADING = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchImpl(LIMITS_URL);
        if (!r || !r.ok) continue;
        const j = await r.json();
        if (j && Array.isArray(j.features) && j.features.length) { CACHE = j; subs.forEach((cb) => { try { cb(); } catch (_) { /* a subscriber never breaks the loader */ } }); return j; }
      } catch (_) { /* retry once, then give up loudly below */ }
    }
    if (typeof console !== "undefined") console.error("[rutherfordJurisdiction] the State's city limits did not load — zoning results will say they cannot name the city");
    LOADING = null; // a failure is never cached as "no cities": the next ask tries again
    return null;
  })();
  return LOADING;
}

/* Synchronous: the jurisdiction label at a point, or null while the limits are not loaded (and it starts loading them). */
export function jurisdictionAt(lat, lng) {
  if (!CACHE) { ensureLimits(); return null; }
  return jurisdictionFrom(CACHE, Number(lat), Number(lng));
}
