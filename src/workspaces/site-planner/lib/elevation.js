/* USGS 3DEP elevation sampling (bare-earth LiDAR-derived DEM). Keyless public
 * ImageServer. Used by the cross-section tool to estimate roadside-ditch
 * depth/invert. SCREENING ONLY — bare-earth, verify with survey.
 */
export const DEP_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
const M_TO_FT = 3.280839895;

/* Sample elevations along a polyline. `path` is [[lng,lat], …] (WGS84).
 * Returns an array of elevations in FEET, ordered along the line. */
export async function sampleProfile(path, sampleCount = 48) {
  const geometry = JSON.stringify({ paths: [path], spatialReference: { wkid: 4326 } });
  const u = `${DEP_URL}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPolyline` +
    `&sampleCount=${sampleCount}&interpolation=RSP_BilinearInterpolation&returnFirstValueOnly=false&f=json`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`3DEP HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "3DEP error");
  // Preserve POSITION: one entry per evenly-spaced sample, mapping no-data (water/
  // void) to null instead of dropping it — so a later stat can place each surviving
  // sample at its true fractional distance and not distort the x-axis (B58).
  return (j.samples || []).map((s) => {
    const v = parseFloat(s.value);
    return isFinite(v) ? v * M_TO_FT : null;
  });
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
