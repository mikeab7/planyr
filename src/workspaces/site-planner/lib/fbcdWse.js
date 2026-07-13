/* FBCDD Atlas-14 watershed-study WSE samplers — 0.2% (B770/V279) + 1% (B807).
 *
 * Plain-English: Fort Bend's drainage district published county-wide DRAFT flood-study
 * results as rasters (grids of water-surface elevations, one number per ~12 ft pixel)
 * on the county's ArcGIS Image Server. This module reads ONE elevation off a grid at
 * a point — the same getSamples pattern as the USGS 3DEP ground-elevation sampler
 * (elevation.js) — feeding the drainage check's derived WSE seams:
 *   • 0.2% (500-yr) → derivedWse02Ft, from the county-wide 500YR_WSE mosaic;
 *   • 1% (100-yr)  → derivedWse1pctFt (B807), from the PER-WATERSHED 100YR rasters —
 *     there is no county-wide 100-yr mosaic, so the sampler routes the point to the
 *     watershed service(s) whose published extent contains it (the `multiplex` table in
 *     the registry row), samples every candidate in parallel, and returns the MAX finite
 *     value (governing WSE). Rectangular extents overlap; a candidate whose raster has
 *     no data at the point answers empty — honesty resolves the overlap.
 *
 * Honesty rules (LOUD-FAILURE):
 *   • Values are DRAFT watershed-study screening numbers — every consumer labels them
 *     as such (see DERIVED_WSE02_DRAFT_NOTE / DERIVED_WSE100_DRAFT_NOTE in
 *     floodplainMitigation.js); they are never an effective/published elevation and
 *     never overwrite a manual entry.
 *   • An out-of-coverage point returns an EMPTY value from the service → null here —
 *     never a fabricated 0. A fetch/HTTP/service error THROWS (the caller records an
 *     honest "failed" state, never a silent all-clear). For the multiplexed 1% sampler
 *     ANY candidate failure rejects the whole call — a partial answer could be the
 *     wrong watershed's number.
 *
 * The services publish FEET (ft-NAVD88 by FBCDD study convention; F32 pixels, SR 2278
 * — Willow_Creek is SR 6588, the NAD83(2011) twin of the same ftUS grid) — no metres
 * conversion, unlike 3DEP. Endpoint facts live in the GIS Source Registry
 * (shared/gis/sources.js `fbcddWse02` + `fbcddWse100`, kind:"raster"), which the weekly
 * drift verifier probes with in-/out-of-coverage sample fixtures and, for the 1% row,
 * a live catalog parity check against the `multiplex` routing table. */
import { gisSource } from "../../../shared/gis/sources.js";
import { projectToGrid } from "../../../shared/coordinates/index.js";

export const FBCDD_WSE02_URL = gisSource("fbcddWse02").serviceUrl;

/* One getSamples read at a WGS84 point against ONE ImageServer. Returns FEET, null on
 * an empty (out-of-coverage) sample, throws on HTTP/service errors. Private core shared
 * by both public samplers — behavior is the original B770 contract, unchanged. */
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
  if (!r.ok) throw new Error(`FBCDD WSE HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "FBCDD WSE error");
  const raw = j.samples && j.samples[0] ? j.samples[0].value : undefined;
  const v = parseFloat(raw);
  return isFinite(v) ? v : null; // empty value = outside the study coverage → honest null
}

/* Sample the DRAFT 0.2% (500-yr) WSE at ONE point (WGS84 lat/lng). Returns FEET, or
 * null when the point is outside the study rasters' coverage (empty sample value).
 * `fetchImpl` is injectable for tests; `signal` lets a caller abort a superseded
 * request; `timeoutMs` (default 8s) bounds the call so a hung county server can't
 * stall the drainage check that awaits it. Throws on HTTP/service errors. */
export async function sampleWse02Point(lat, lng, opts = {}) {
  return getSampleValue(FBCDD_WSE02_URL, lat, lng, opts);
}

/* Watershed seams: the extents are exact published rectangles, but a site straddling a
 * boundary should still ask the neighbor raster — an over-inclusive candidate costs one
 * honest empty sample, an under-inclusive one costs a false "no coverage". */
const SEAM_PAD_FT = 1000;

/* Which per-watershed 100-yr rasters COULD cover a WGS84 point — pure bbox routing
 * against the registry's baked SR-2278 extents (padded for seams). `services` defaults
 * to the registry multiplex table; injectable for tests. Returns [{ name, extent2278 }]. */
export function wse100CandidatesForPoint(lat, lng, services = gisSource("fbcddWse100").multiplex.services) {
  const { x, y } = projectToGrid(lat, lng);
  return services.filter(({ extent2278: [xmin, ymin, xmax, ymax] }) =>
    x >= xmin - SEAM_PAD_FT && x <= xmax + SEAM_PAD_FT && y >= ymin - SEAM_PAD_FT && y <= ymax + SEAM_PAD_FT);
}

/* Sample the DRAFT 1% (100-yr) WSE at ONE point (WGS84 lat/lng) across the per-watershed
 * rasters (B807). Returns { wseFt, watershed } — the MAX finite value among the extent
 * candidates (governing WSE; overlapping rectangles resolved by honest no-data) — or
 * null when no candidate covers the point (zero candidates → null with ZERO fetches).
 * ANY candidate failure rejects the whole call (LOUD-FAILURE — a partial answer could
 * be the wrong watershed's number). Options as sampleWse02Point; `services` injectable. */
export async function sampleWse100Point(lat, lng, { timeoutMs = 8000, fetchImpl, signal, services } = {}) {
  const mux = gisSource("fbcddWse100").multiplex;
  const candidates = wse100CandidatesForPoint(lat, lng, services || mux.services);
  if (!candidates.length) return null;
  const values = await Promise.all(candidates.map(({ name }) =>
    getSampleValue(`${mux.restBase}/${name}/ImageServer`, lat, lng, { timeoutMs, fetchImpl, signal })));
  let best = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null && (best == null || values[i] > best.wseFt)) {
      best = { wseFt: values[i], watershed: candidates[i].name.split("/")[0] };
    }
  }
  return best;
}
