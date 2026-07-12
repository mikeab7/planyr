/* FBCDD Atlas-14 watershed-study 0.2% (500-yr) WSE sampler — the B770/V279 wiring.
 *
 * Plain-English: Fort Bend's drainage district published county-wide DRAFT flood-study
 * results as a raster (a grid of water-surface elevations, one number per ~12 ft pixel)
 * on the county's ArcGIS Image Server. This module reads ONE elevation off that grid at
 * a point — the same getSamples pattern as the USGS 3DEP ground-elevation sampler
 * (elevation.js) — to feed the drainage check's derived 0.2% WSE seam (derivedWse02Ft).
 *
 * Honesty rules (LOUD-FAILURE):
 *   • Values are DRAFT watershed-study screening numbers — every consumer labels them
 *     as such (see DERIVED_WSE02_DRAFT_NOTE in floodplainMitigation.js); they are never
 *     an effective/published elevation and never overwrite a manual entry.
 *   • An out-of-coverage point returns an EMPTY value from the service → null here —
 *     never a fabricated 0. A fetch/HTTP/service error THROWS (the caller records an
 *     honest "failed" state, never a silent all-clear).
 *
 * The service publishes FEET (ft-NAVD88 by FBCDD study convention; F32 pixels, SR 2278)
 * — no metres conversion, unlike 3DEP. Endpoint facts live in the GIS Source Registry
 * (shared/gis/sources.js `fbcddWse02`, kind:"raster"), which the weekly drift verifier
 * probes with in-/out-of-coverage sample fixtures. */
import { gisSource } from "../../../shared/gis/sources.js";

export const FBCDD_WSE02_URL = gisSource("fbcddWse02").serviceUrl;

/* Sample the DRAFT 0.2% (500-yr) WSE at ONE point (WGS84 lat/lng). Returns FEET, or
 * null when the point is outside the study rasters' coverage (empty sample value).
 * `fetchImpl` is injectable for tests; `signal` lets a caller abort a superseded
 * request; `timeoutMs` (default 8s) bounds the call so a hung county server can't
 * stall the drainage check that awaits it. Throws on HTTP/service errors. */
export async function sampleWse02Point(lat, lng, { timeoutMs = 8000, fetchImpl, signal } = {}) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const u = `${FBCDD_WSE02_URL}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPoint` +
    `&interpolation=RSP_BilinearInterpolation&returnFirstValueOnly=true&f=json`;
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(u, { signal: signal || (ctrl && ctrl.signal) || undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`FBCDD WSE HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "FBCDD WSE error");
  const raw = j.samples && j.samples[0] ? j.samples[0].value : undefined;
  const v = parseFloat(raw);
  return isFinite(v) ? v : null; // empty value = outside the study coverage → honest null
}
