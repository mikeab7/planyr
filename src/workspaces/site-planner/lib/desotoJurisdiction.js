/* DeSoto County MS — WHICH GOVERNMENT A POINT FALLS IN (B2507058 / B2507059).
 *
 * The county's zoning table holds several governments' zoning with no jurisdiction field, so a zoning result is labelled by where the SITE falls: inside one of the
 * five municipal limits (BaseLayers/4 "Municipalities": Olive Branch, Southaven, Horn Lake, Hernando, Walls — MEASURED 2026-10-29) it is that city; anywhere else in the county it
 * is "Unincorporated DeSoto County". Mississippi has no ETJ, so there is no third answer.
 *
 * The five limits are a few KB, fetched ONCE (relay → the county server) and kept in memory; `jurisdictionAt` is synchronous and answers `null` until they have loaded
 * (the caller shows "Checking city limits…" — never a guess). A failed fetch is retried on the next ask and never cached as "no cities".
 *
 * `jurisdictionFrom` / `pointInGeometry` are pure (unit-tested over a recorded-shape fixture); only `ensureMunicipalities` touches the network. */

export const DESOTO_RELAY = "/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services";
export const MUNICIPALITIES_URL = `${DESOTO_RELAY}/BaseLayers/MapServer/4/query?where=1%3D1&outFields=NAME&outSR=4326&f=geojson`;
export const UNINCORPORATED = "Unincorporated DeSoto County";
/* [south, west, north, east] — a box a little larger than the county (measured parcel extent 34.711–34.997 N, −90.312 – −89.688 W). Only a guard against asking a far-away point. */
const COUNTY_BOX = [34.68, -90.35, 35.01, -89.65];

const inRing = (ring, x, y) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/* GeoJSON Polygon / MultiPolygon containment, holes honoured (ring 0 is the outer, the rest are holes). */
export function pointInGeometry(geometry, lng, lat) {
  if (!geometry) return false;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polys.some((p) => p && p.length && inRing(p[0], lng, lat) && !p.slice(1).some((h) => inRing(h, lng, lat)));
}

/* "OLIVE BRANCH" → "Olive Branch" */
export const titleCase = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* The jurisdiction label for a point over a FeatureCollection of municipal limits: the city's name inside it, UNINCORPORATED outside every one; `null` when no limits are
 * in hand (not loaded yet — unknown, never "unincorporated"). Pure. */
export function jurisdictionFrom(fc, lat, lng) {
  const feats = fc && Array.isArray(fc.features) ? fc.features : null;
  if (!feats || !feats.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < COUNTY_BOX[0] || lat > COUNTY_BOX[2] || lng < COUNTY_BOX[1] || lng > COUNTY_BOX[3]) return null; // not DeSoto County at all — "unincorporated DeSoto County" would be a false answer
  for (const f of feats) if (pointInGeometry(f && f.geometry, lng, lat)) return titleCase(f.properties && f.properties.NAME) || "City limits";
  return UNINCORPORATED;
}

let CACHE = null;
let LOADING = null;
const subs = new Set();
export const municipalitiesReady = () => !!CACHE;
export const subscribeMunicipalities = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function _setMunicipalities(fc) { CACHE = fc; LOADING = fc ? Promise.resolve(fc) : null; } // tests / harness seam

export function ensureMunicipalities(fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (CACHE) return Promise.resolve(CACHE);
  if (LOADING) return LOADING;
  if (!fetchImpl) return Promise.resolve(null);
  LOADING = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchImpl(MUNICIPALITIES_URL);
        if (!r || !r.ok) continue;
        const j = await r.json();
        if (j && Array.isArray(j.features) && j.features.length) { CACHE = j; subs.forEach((cb) => { try { cb(); } catch (_) { /* a subscriber never breaks the loader */ } }); return j; }
      } catch (_) { /* retry once, then give up loudly below */ }
    }
    if (typeof console !== "undefined") console.error("[desotoJurisdiction] the county's municipal limits did not load — zoning results will say they cannot name the city");
    LOADING = null; // a failure is never cached as "no cities": the next ask tries again
    return null;
  })();
  return LOADING;
}

/* Synchronous: the jurisdiction label at a point, or null while the limits are not loaded (and it starts loading them). */
export function jurisdictionAt(lat, lng) {
  if (!CACHE) { ensureMunicipalities(); return null; }
  return jurisdictionFrom(CACHE, Number(lat), Number(lng));
}
