/* B881 — FEMA/USGS InFRM Estimated BFE (Base Level Engineering) point sampler.
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

export const EBFE_URL = gisSource("femaEbfe").serviceUrl;
export const EBFE_LAYERS = gisSource("femaEbfe").identifyLayers; // { bfe1pct: 17, wse02: 21 }

// Per-location response cache. Key = lat/lng rounded to ~11 m (4 dp). Stores the resolved
// { bfe1pctFt, wse02Ft } (both may be null = no coverage) — NOT thrown errors, so a transient
// outage is retried, not stuck. LRU-trimmed. Cleared by clearEbfeCache() for tests.
const _ebfeCache = new Map();
const EBFE_CACHE_MAX = 300;
const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

export function clearEbfeCache() { _ebfeCache.clear(); }

/* Pull the raw pixel value out of one identify result. Prefer the raw "Pixel Value"
 * attribute (unaffected by any renderer/stretch), else the top-level `value`. Returns a
 * finite number, or null for "NoData" / empty / non-numeric. Pure. */
export function pixelValueOf(result) {
  if (!result) return null;
  const candidates = [
    result.attributes && (result.attributes["Pixel Value"] ?? result.attributes["Stretched.Pixel Value"]),
    result.value,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (!s || /^nodata$/i.test(s)) continue;
    const v = parseFloat(s);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/* Fold an identify response's `results` array into { bfe1pctFt, wse02Ft } by layer id.
 * A layer with no covering result (omitted, or NoData) stays null. Pure. */
export function foldIdentify(results = [], layers = EBFE_LAYERS) {
  const out = { bfe1pctFt: null, wse02Ft: null };
  for (const r of results || []) {
    const v = pixelValueOf(r);
    if (v == null) continue;
    if (r.layerId === layers.bfe1pct && out.bfe1pctFt == null) out.bfe1pctFt = v;
    else if (r.layerId === layers.wse02 && out.wse02Ft == null) out.wse02Ft = v;
  }
  return out;
}

/* Build the /identify query URL for a WGS84 point. Uses a small map extent + imageDisplay
 * around the point so the raster cell containing the point is what's identified. Pure. */
export function ebfeIdentifyUrl(lat, lng, { serviceUrl = EBFE_URL, layers = EBFE_LAYERS, boxDeg = 0.005 } = {}) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const mapExtent = [lng - boxDeg, lat - boxDeg, lng + boxDeg, lat + boxDeg].join(",");
  const ids = [layers.bfe1pct, layers.wse02].join(",");
  return `${serviceUrl}/identify?geometry=${encodeURIComponent(geometry)}` +
    `&geometryType=esriGeometryPoint&sr=4326&layers=${encodeURIComponent(`all:${ids}`)}` +
    `&tolerance=1&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=101,101,96` +
    `&returnGeometry=false&f=json`;
}

/* Sample the FEMA InFRM EBFE at ONE point (WGS84 lat/lng). Returns
 *   { bfe1pctFt, wse02Ft }  — feet-NAVD88, either null when that layer has no coverage; both
 *   null ⇒ the point is outside InFRM coverage (the caller falls back to grade).
 * THROWS on HTTP / service errors. Options:
 *   timeoutMs (default 8s) bounds the call; fetchImpl injectable for tests; signal lets a
 *   caller abort a superseded request; useCache (default true) reads/writes the per-location
 *   cache. */
export async function sampleEbfePoint(lat, lng, { timeoutMs = 8000, fetchImpl, signal, useCache = true, boxDeg } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = cacheKey(lat, lng);
  if (useCache && _ebfeCache.has(key)) {
    const hit = _ebfeCache.get(key);
    _ebfeCache.delete(key); _ebfeCache.set(key, hit); // LRU touch
    return hit;
  }
  const url = ebfeIdentifyUrl(lat, lng, { boxDeg });
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
