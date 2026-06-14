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
  return (j.samples || [])
    .map((s) => parseFloat(s.value))
    .filter((v) => isFinite(v))
    .map((m) => m * M_TO_FT);
}

/* Reduce a profile to ditch screening stats. `lenFt` is the line's ground length.
 * invert = lowest point; bank reference = mean of the two ends; depth = bank −
 * invert. Returns { profile:[{d,el}], invertFt, bankFt, depthFt, minFt, maxFt }. */
export function ditchStats(elevFt, lenFt) {
  if (!elevFt.length) return null;
  const n = elevFt.length;
  const profile = elevFt.map((el, i) => ({ d: (i / (n - 1)) * lenFt, el }));
  const minFt = Math.min(...elevFt), maxFt = Math.max(...elevFt);
  const bankFt = (elevFt[0] + elevFt[n - 1]) / 2;
  return { profile, invertFt: minFt, bankFt, depthFt: Math.max(0, bankFt - minFt), minFt, maxFt };
}
