/* B882 — FEMA/USGS InFRM Estimated BFE (Base Level Engineering) point sampler.
 *
 * Plain-English: for a FEMA "Zone A" — a floodplain FEMA mapped but never published a
 * flood elevation for — FEMA/USGS publish an ENGINEERED screening flood surface called
 * InFRM Base Level Engineering (EBFE). This module reads that estimate at ONE point:
 *   • the 1% (100-yr) water surface (layer 17) → the ESTIMATED BFE, and
 *   • the 0.2% (500-yr) water surface (layer 21) → fills the app's blank 0.2% field.
 * It REPLACES the old "grade @ Zone A boundary" guess wherever InFRM has coverage; where
 * it doesn't (InFRM is FEMA Region 6 / Gulf-central, not nationwide) the caller falls back
 * to the grade estimate.
 *
 * The service is an ArcGIS MapServer whose sublayers are RASTERS, so we read a point value
 * with the `identify` operation (MapServer raster layers support neither /query nor the
 * ImageServer getSamples the FBCDD sampler uses). Values are FEET (ft-NAVD88) — no metres
 * conversion.
 *
 * Honesty rules (LOUD-FAILURE):
 *   • An out-of-coverage point (no result, or "NoData") reads as an honest null for that
 *     layer — never a fabricated 0. Both layers null ⇒ no coverage ⇒ the caller falls back.
 *   • An HTTP / service error THROWS so the caller records a "failed" state and falls back
 *     to the grade estimate — a service outage is never a silent all-clear or a value.
 *   • The value is a SCREENING estimate, never a regulatory / published BFE. Provenance is
 *     the consumer's job (EST_EBFE_NOTE in floodplainMitigation.js).
 *
 * Bounded + cached: an AbortController + timeoutMs (default 8s) so a hung server can't stall
 * the drainage check (the B874 watchdog pattern); responses are cached per rounded location
 * so a recompute never re-hits the network. Endpoint facts live in the GIS Source Registry
 * (shared/gis/sources.js `femaEbfe`). */
import { gisSource } from "../../../shared/gis/sources.js";
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";

export const EBFE_URL = gisSource("femaEbfe").serviceUrl;
export const EBFE_LAYERS = gisSource("femaEbfe").identifyLayers; // { bfe1pct: 20, wse02: 24 } — RASTER sublayers
/* The attribute names this service reports a raster pixel under. Registry-owned so the app and
 * the weekly verifier read the SAME list — the mismatch between them is half of the NEW-1 bug. */
export const EBFE_PIXEL_ATTRS = gisSource("femaEbfe").pixelAttributes || ["Pixel Value", "Stretched.Pixel Value"];

/* NEW-1 — the request goes through the app's OWN same-origin GIS proxy, never straight at
 * txgeo.usgs.gov. Direct, the owner's 2026-08-04 audit measured "TypeError: Failed to fetch" at
 * Katy (a cross-origin refusal: the browser never saw a response, so no amount of error handling
 * here could have helped) and a hard TIMEOUT at Harris. Through the proxy the identical request
 * answered in under three seconds. `nostore=1` keeps a per-site point answer out of the Drive
 * imagery cache — this is a JSON reading, not a tile.
 * `direct: true` is the escape hatch the unit tests and any non-browser caller use. */
export function ebfeEndpoint({ direct = false } = {}) {
  return direct ? EBFE_URL : `${proxyServiceUrl(EBFE_URL)}`;
}

// Per-location response cache. Key = lat/lng rounded to ~11 m (4 dp). Stores the resolved
// { bfe1pctFt, wse02Ft } (both may be null = no coverage) — NOT thrown errors, so a transient
// outage is retried, not stuck. LRU-trimmed. Cleared by clearEbfeCache() for tests.
const _ebfeCache = new Map();
const EBFE_CACHE_MAX = 300;
const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export function clearEbfeCache() { _ebfeCache.clear(); }

/* Pull the raw pixel value out of one identify result.
 *
 * ⛔ NEW-1 — read the ATTRIBUTE NAMES from the registry, and NEVER fall back to `result.value`.
 * Both halves are load-bearing:
 *   (a) this service reports its pixel under "Service Pixel Value" / "Classify.Pixel Value".
 *       The old hardcoded pair ("Pixel Value" / "Stretched.Pixel Value") matched neither, so
 *       every result folded to null.
 *   (b) `result.value` is NOT a pixel value on this service. On the boundary sublayer it is a
 *       Shape_Length — the live response carries `value: "17141870.9255999"` — so a fold that
 *       trusted it would report seventeen million feet as a flood elevation. A missing attribute
 *       is an honest null; it is never an invitation to read whatever else is on the object.
 * Returns a finite number, or null for "NoData" / empty / non-numeric / absent. Pure. */
export function pixelValueOf(result, attrNames = EBFE_PIXEL_ATTRS) {
  if (!result || !result.attributes) return null;
  for (const name of attrNames) {
    const c = result.attributes[name];
    if (c == null) continue;
    const s = String(c).trim();
    if (!s || /^nodata$/i.test(s)) continue;
    const v = parseFloat(s);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/* Fold an identify response's `results` array into { bfe1pctFt, wse02Ft } by layer id.
 * A layer with no covering result (omitted, or NoData) stays null. Pure.
 *
 * The layer ids MUST be the raster "… Image" sublayers (20 / 24), not the mosaic GROUP ids
 * (17 / 21): ArcGIS identify expands a group and reports only its children, so matching on a
 * group id matches nothing, forever, silently. See the registry row's trap note. */
export function foldIdentify(results = [], layers = EBFE_LAYERS, attrNames = EBFE_PIXEL_ATTRS) {
  const out = { bfe1pctFt: null, wse02Ft: null };
  for (const r of results || []) {
    const v = pixelValueOf(r, attrNames);
    if (v == null) continue;
    if (r.layerId === layers.bfe1pct && out.bfe1pctFt == null) out.bfe1pctFt = v;
    else if (r.layerId === layers.wse02 && out.wse02Ft == null) out.wse02Ft = v;
  }
  return out;
}

/* Build the /identify query URL for a WGS84 point. Uses a small map extent + imageDisplay
 * around the point so the raster cell containing the point is what's identified. Pure. */
export function ebfeIdentifyUrl(lat, lng, { serviceUrl, direct = false, layers = EBFE_LAYERS, boxDeg = 0.005 } = {}) {
  const base = serviceUrl || ebfeEndpoint({ direct });
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const mapExtent = [lng - boxDeg, lat - boxDeg, lng + boxDeg, lat + boxDeg].join(",");
  const ids = [layers.bfe1pct, layers.wse02].join(",");
  // `nostore=1` is stripped by the proxy before the upstream URL is rebuilt (like `meta=1`), so
  // a direct call and a proxied call put the SAME query on the agency's wire.
  const store = base.indexOf("/api/gis-cache/") === 0 ? "&nostore=1" : "";
  return `${base}/identify?geometry=${encodeURIComponent(geometry)}` +
    `&geometryType=esriGeometryPoint&sr=4326&layers=${encodeURIComponent(`all:${ids}`)}` +
    `&tolerance=1&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=101,101,96` +
    `&returnGeometry=false&f=json${store}`;
}

/* Sample the FEMA InFRM EBFE at ONE point (WGS84 lat/lng). Returns
 *   { bfe1pctFt, wse02Ft }  — feet-NAVD88, either null when that layer has no coverage; both
 *   null ⇒ the point is outside InFRM coverage (the caller falls back to grade).
 * THROWS on HTTP / service errors. Options:
 *   timeoutMs (default 8s) bounds the call; fetchImpl injectable for tests; signal lets a
 *   caller abort a superseded request; useCache (default true) reads/writes the per-location
 *   cache. */
export async function sampleEbfePoint(lat, lng, { timeoutMs = 8000, fetchImpl, signal, useCache = true, boxDeg, direct } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = cacheKey(lat, lng);
  if (useCache && _ebfeCache.has(key)) {
    const hit = _ebfeCache.get(key);
    _ebfeCache.delete(key); _ebfeCache.set(key, hit); // LRU touch
    return hit;
  }
  const url = ebfeIdentifyUrl(lat, lng, { boxDeg, direct });
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(url, { signal: signal || (ctrl && ctrl.signal) || undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`FEMA EBFE HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "FEMA EBFE identify error");
  const resolved = foldIdentify(j.results, EBFE_LAYERS);
  if (useCache) {
    _ebfeCache.set(key, resolved);
    if (_ebfeCache.size > EBFE_CACHE_MAX) _ebfeCache.delete(_ebfeCache.keys().next().value);
  }
  return resolved;
}
