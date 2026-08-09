/* USGS 3DEP elevation sampling (bare-earth LiDAR-derived DEM). Keyless public
 * ImageServer. Used by the cross-section tool to estimate roadside-ditch
 * depth/invert. SCREENING ONLY — bare-earth, verify with survey.
 */
export const DEP_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
/* NEW-3 — the SERVICE'S OWN NAME, so a failure can say WHOSE failure it was. An indefinite
 * spinner over a third-party call gives the owner no way to tell a slow federal service from a
 * broken app; every error thrown from this module carries this on `err.service` and the drainage
 * readout names it in the freshness hover. */
export const DEP_SERVICE_LABEL = "USGS 3DEP elevation";
export const DEFAULT_INTERPOLATION = "RSP_BilinearInterpolation";

/* Every failure this module raises names the service it came from (NEW-3). */
function depError(message, extra = {}) {
  const e = new Error(message);
  e.service = DEP_SERVICE_LABEL;
  return Object.assign(e, extra);
}
// B533: US survey foot (exact 3937/1200 ft/m), matching FT_PER_M in shared/coordinates and the
// EPSG:2278 State Plane spine — not the international foot (3.280839895). 3DEP returns metres;
// converting with the survey foot keeps elevation consistent with all other project geometry.
// Exported for the B704 terrain pipeline (demGrid.js) so every 3DEP consumer converts identically.
export const M_TO_FT = 3937 / 1200;

/* ⛔ NEW-1 — THE ONE DERIVATION OF A PROFILE REQUEST, and the reason it is exported.
 *
 * The bare-earth transect the drainage check runs is CACHED (groundElevation.js), and the cache
 * key is the request's EXACT geometry string plus its sampleCount and interpolation — measured
 * live on the owner's Bain plan as byte-identical run to run (a 126-character 9-sample polyline),
 * for a value that changes when USGS re-flies a county. A cache key derived independently of the
 * request is the one way this goes wrong — serve elevation for the wrong ground — so the key and
 * the URL that fills it come from HERE, together, and can never drift apart. Pure. */
export function profileQuery(path, sampleCount = 48, interpolation = DEFAULT_INTERPOLATION) {
  const geometry = JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } });
  const url = `${DEP_URL}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPolyline` +
    `&sampleCount=${sampleCount}&interpolation=${interpolation}&returnFirstValueOnly=false&f=json`;
  return { geometry, sampleCount, interpolation, url };
}

/* Sample elevations along a polyline. `path` is [[lng,lat], …] (WGS84).
 * Returns an array of elevations in FEET, ordered along the line. `timeoutMs`
 * (default 12s) bounds the request so a hung 3DEP can't freeze a caller that
 * awaits it (e.g. the drainage check) — it throws/aborts instead.
 *
 * NEW-3 — a timeout now throws a NAMED failure (`err.service` / `err.timedOut`) rather than a
 * bare AbortError, because "the federal elevation service did not answer in 8 s" and "something
 * in the app broke" must not be the same sentence to whoever reads it. A caller-supplied `signal`
 * is CHAINED onto our own controller, never substituted for it (the samplePoint rule below —
 * substituting silently disables the timeout, which is how a hung socket never settles at all). */
export async function sampleProfile(path, sampleCount = 48, timeoutMs = 12000, { interpolation, fetchImpl, signal } = {}) {
  const u = profileQuery(path, sampleCount, interpolation || DEFAULT_INTERPOLATION).url;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const onAbort = () => { try { ctrl.abort(); } catch (_) { /* already gone */ } };
  if (signal && ctrl) {
    if (signal.aborted) onAbort();
    else if (signal.addEventListener) signal.addEventListener("abort", onAbort);
  }
  let timedOut = false;
  const timer = ctrl ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(u, ctrl ? { signal: ctrl.signal } : undefined);
  } catch (e) {
    throw timedOut ? depError(`${DEP_SERVICE_LABEL} timed out after ${timeoutMs} ms`, { timedOut: true }) : e;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && ctrl && signal.removeEventListener) signal.removeEventListener("abort", onAbort);
  }
  if (!r.ok) throw depError(`${DEP_SERVICE_LABEL} HTTP ${r.status}`, { status: r.status });
  const j = await r.json();
  if (j.error) throw depError(j.error.message || `${DEP_SERVICE_LABEL} error`);
  // Preserve POSITION: one entry per evenly-spaced sample, mapping no-data (water/
  // void) to null instead of dropping it — so a later stat can place each surviving
  // sample at its true fractional distance and not distort the x-axis (B58).
  return (j.samples || []).map((s) => {
    const v = parseFloat(s.value);
    return isFinite(v) ? v * M_TO_FT : null;
  });
}

/* Sample the ground elevation at ONE point (B706 hover readout). Returns FEET, or
 * null for no-data (water/void) — the caller suppresses the readout rather than show
 * a made-up number. `fetchImpl` is injectable for tests; `signal` lets the caller
 * abort a superseded request (cursor moved on) — an abort surfaces as a throw, which
 * the caller treats as "no reading", never as a value. Point probe verified against
 * the live service 2026-07-07 (getSamples, esriGeometryPoint, 1 m resolution). */
export async function samplePoint(lat, lng, { timeoutMs = 8000, fetchImpl, signal } = {}) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const u = `${DEP_URL}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPoint` +
    `&interpolation=RSP_BilinearInterpolation&returnFirstValueOnly=true&f=json`;
  // A caller-supplied signal used to REPLACE our controller, which silently disabled the
  // timeout with it — so a socket that hung (a stalled proxy tunnel, an agency host that
  // accepts and never answers) never settled at all, and the hover readout sat "in flight"
  // forever with no way to ever report a failure. Own the controller always, chain the
  // caller's signal onto it, and DISTINGUISH the two aborts: a timeout is a real failure
  // and throws as one (LOUD-FAILURE), a caller abort stays an AbortError the caller ignores.
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const onAbort = () => { try { ctrl.abort(); } catch (_) { /* already gone */ } };
  if (signal && ctrl) {
    if (signal.aborted) onAbort();
    else if (signal.addEventListener) signal.addEventListener("abort", onAbort);
  }
  let timedOut = false;
  const timer = ctrl ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(u, { signal: (ctrl && ctrl.signal) || undefined });
  } catch (e) {
    if (timedOut) throw depError(`${DEP_SERVICE_LABEL} timed out after ${timeoutMs} ms`, { timedOut: true });
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && ctrl && signal.removeEventListener) signal.removeEventListener("abort", onAbort);
  }
  if (!r.ok) throw depError(`${DEP_SERVICE_LABEL} HTTP ${r.status}`, { status: r.status });
  const j = await r.json();
  if (j.error) throw depError(j.error.message || `${DEP_SERVICE_LABEL} error`);
  const v = parseFloat(j.samples && j.samples[0] && j.samples[0].value);
  return isFinite(v) ? v * M_TO_FT : null; // no-data → null (B58 convention)
}

/* Reduce a profile to ditch screening stats. `lenFt` is the line's ground length.
 * invert = lowest point; bank reference = mean of the two ends; depth = bank −
 * invert. Returns { profile:[{d,el}], invertFt, bankFt, depthFt, minFt, maxFt }. */
export function ditchStats(elevFt, lenFt) {
  if (!elevFt || elevFt.length < 2) return null; // need ≥2 samples (1 sample → i/(n-1)=0/0=NaN distance)
  const n = elevFt.length;
  // Place each surviving sample at its TRUE fractional position and skip no-data
  // (null) points, so dropping voids never compresses the x-axis (B58).
  const profile = [];
  for (let i = 0; i < n; i++) { const el = elevFt[i]; if (el == null || !isFinite(el)) continue; profile.push({ d: (i / (n - 1)) * lenFt, el }); }
  if (profile.length < 2) return null;
  const els = profile.map((p) => p.el);
  const minFt = Math.min(...els), maxFt = Math.max(...els);
  // Banks = the end-most VALID samples (if a true end is no-data we fall back to the
  // nearest valid one) rather than substituting an interior point as the bank (B58).
  const bankFt = (profile[0].el + profile[profile.length - 1].el) / 2;
  return { profile, invertFt: minFt, bankFt, depthFt: Math.max(0, bankFt - minFt), minFt, maxFt };
}
