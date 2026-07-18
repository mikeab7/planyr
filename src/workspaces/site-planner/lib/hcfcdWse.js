/* B882 (scope note 2) — HCFCD MAAPnext model WSE sampler (Harris County).
 *
 * Harris County Flood Control District's MAAPnext program publishes public ArcGIS ImageServer
 * rasters of model results. Its GROUND-ELEVATION raster is confirmed live:
 *   https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/GroundElevation/ImageServer
 * The companion 1% (100-yr) and 0.2% (500-yr) WSE rasters are published in the same MAAPNext
 * folder, but their exact service leaf names must be read from the LIVE services directory — the
 * build sandbox's egress policy blocks fximgservices.hcfcd.org (403), so those endpoints are
 * carried as PROVISIONAL config in the registry (femaEbfe sibling row `hcfcdMaapnext`) and this
 * sampler is a NO-OP (returns null → the provider is simply absent, and the resolver falls
 * through to EBFE) until the endpoints are confirmed and filled in (live-verify V363).
 *
 * MAAPnext model elevations often run HIGHER than the effective FIRM and Harris-area reviewers
 * enforce them, so in Harris County this WSE OUTRANKS EBFE and effective-style data (the
 * precedence in wseProviders.js). It is still a SCREENING value here — never a regulatory BFE.
 *
 * Same ImageServer getSamples contract as fbcdWse.js: FEET (ft-NAVD88), an empty value out of
 * coverage → honest null, an HTTP/service error THROWS (LOUD-FAILURE). Bounded + injectable. */
import { gisSource } from "../../../shared/gis/sources.js";

/* One getSamples read at a WGS84 point against ONE ImageServer. FEET, null on empty, throws on
 * HTTP/service error. (Mirror of the fbcdWse core — kept local so this module is self-contained.) */
async function getSampleValue(serviceUrl, lat, lng, { timeoutMs = 8000, fetchImpl, signal } = {}) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const u = `${serviceUrl}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPoint` +
    `&interpolation=RSP_BilinearInterpolation&returnFirstValueOnly=true&f=json`;
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(u, { signal: signal || (ctrl && ctrl.signal) || undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`HCFCD MAAPnext HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "HCFCD MAAPnext error");
  const raw = j.samples && j.samples[0] ? j.samples[0].value : undefined;
  const v = parseFloat(raw);
  return isFinite(v) ? v : null; // empty value = outside coverage → honest null
}

/* Per-location cache (same discipline as ebfe.js). */
const _maapCache = new Map();
const MAAP_CACHE_MAX = 300;
const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
export function clearMaapnextCache() { _maapCache.clear(); }

/* The confirmed/provisional WSE ImageServer endpoints from the registry. `wseLayers.wse1pct`
 * and `.wse02` are null until the live directory probe fills them (V363). */
export function maapnextEndpoints() {
  return gisSource("hcfcdMaapnext").wseLayers || { wse1pct: null, wse02: null };
}

/* Sample the HCFCD MAAPnext 1% + 0.2% WSE at ONE point (WGS84). Returns
 *   { wse1pctFt, wse02Ft } — feet-NAVD88, either null when that raster has no coverage; both
 *   null (or no configured endpoints) ⇒ the provider is absent and the caller falls through.
 * THROWS on HTTP/service errors (→ the caller records failed and falls through). `endpoints`
 * injectable for tests; `fetchImpl`/`signal`/`timeoutMs`/`useCache` as ebfe.js. */
export async function sampleMaapnextWse(lat, lng, { timeoutMs, fetchImpl, signal, useCache = true, endpoints } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const eps = endpoints || maapnextEndpoints();
  if (!eps || (!eps.wse1pct && !eps.wse02)) return null; // provisional — endpoints not yet confirmed
  const key = cacheKey(lat, lng);
  if (useCache && _maapCache.has(key)) {
    const hit = _maapCache.get(key);
    _maapCache.delete(key); _maapCache.set(key, hit);
    return hit;
  }
  const [wse1pctFt, wse02Ft] = await Promise.all([
    eps.wse1pct ? getSampleValue(eps.wse1pct, lat, lng, { timeoutMs, fetchImpl, signal }) : Promise.resolve(null),
    eps.wse02 ? getSampleValue(eps.wse02, lat, lng, { timeoutMs, fetchImpl, signal }) : Promise.resolve(null),
  ]);
  const resolved = { wse1pctFt, wse02Ft };
  if (useCache) {
    _maapCache.set(key, resolved);
    if (_maapCache.size > MAAP_CACHE_MAX) _maapCache.delete(_maapCache.keys().next().value);
  }
  return resolved;
}
