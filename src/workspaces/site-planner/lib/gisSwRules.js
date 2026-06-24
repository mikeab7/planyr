/* Pure rules for the GIS imagery service worker (B438).
 *
 * The service worker (`public/gis-sw.js`) caches the county/agency map IMAGERY so saved sites
 * paint instantly and survive a server outage. The cross-origin block (those hosts don't send
 * CORS headers — see layers.js:370) means only a service worker, storing the OPAQUE export
 * responses in the Cache API, can do this. To keep the live-site risk contained, the SW touches
 * ONLY cross-origin ArcGIS imagery/tile requests and passes EVERYTHING else (the app's own HTML,
 * JS, CSS, API calls) straight through — so it can never serve a stale app bundle.
 *
 * This module is the canonical, unit-tested copy of those rules. The SW inlines an identical
 * copy (a plain public/ file can't import bundled modules); keep the two in sync — the test
 * `test/gisSwRules.test.js` locks the behaviour down.
 */

/* True only for a cross-origin ArcGIS image EXPORT or map TILE request — the gov layers
 * (`/MapServer/export`, `/ImageServer/exportImage`) and raster basemap/tile endpoints
 * (`/MapServer/tile/{z}/{y}/{x}`). Same-origin requests (the app itself) are never cacheable,
 * so the SW leaves all app assets untouched. */
export function isCacheableGisRequest(urlStr, selfOrigin) {
  let u;
  try { u = new URL(urlStr); } catch (_) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.origin === selfOrigin) return false; // never the app's own origin
  const p = u.pathname;
  return (
    /\/(MapServer|ImageServer)\/(export|exportImage)\b/i.test(p) || // dynamic / image exports
    /\/(MapServer|ImageServer)\/tile\/\d+\/\d+\/\d+/i.test(p) ||     // ArcGIS cached tiles
    /\/tile\/\d+\/\d+\/\d+(?:$|[.?])/i.test(p)                       // generic {z}/{y}/{x} tiles
  );
}

/* Oldest-first trim plan to bound the cache. `keys` are in insertion order (oldest first);
 * returns the keys to delete so at most `max` remain. Opaque responses are storage-heavy, so
 * the SW keeps the cap modest. Pure for unit-testing. */
export function trimPlan(keys, max) {
  if (!Array.isArray(keys) || keys.length <= max) return [];
  return keys.slice(0, keys.length - max);
}

/* Cache name with a version tag — bumping CACHE_VERSION makes `activate` drop the old caches,
 * so a rules change can't strand stale entries. */
export const CACHE_PREFIX = "planyr-gis-";
export const CACHE_VERSION = "v1";
export const GIS_CACHE = CACHE_PREFIX + CACHE_VERSION;
export const MAX_ENTRIES = 120; // ~modest; opaque responses pad quota heavily
