/* parcelFeatureIds — dependency-free, so the display layer can import it without pulling the worker transport's converter onto the main thread.
 */
const knownFieldNames = /^(OBJECTID|FID|OID|ID)$/i;
/* NEW-1 (2026-10-22, work-laptop report — THE ROOT CAUSE of the half-drawn Epps Mill lot). A hosted FeatureServer answers `f=geojson`
 * directly, and some of them (Rutherford County TN's `ParcelsCAMA1`, measured live) emit each feature WITHOUT a top-level `id` — the object
 * id is only inside `properties`. esri-leaflet keys everything it holds by `feature.id`, so every lot of every answer shared the key
 * `undefined` and collapsed to ONE held lot: `__mapParcelDisplay()` read `held: 1` over a whole county view, a DIFFERENT lot each time
 * (whichever tile answered last), so the owner saw the outline of one small lot (the building at the north tip) and nothing else.
 * Every hermetic mock in this repo set `id`, which is how a server that does not stayed invisible. Give every feature a real id before
 * anything keys on it: the layer's own id field, else the usual object-id names, else a stable key from the geometry — NEVER a shared
 * undefined. Mutates and returns the array (esri-leaflet's own features, no copy per frame). */
export function ensureFeatureIds(features, idField) {
  if (!Array.isArray(features)) return features;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f || (f.id !== undefined && f.id !== null)) continue;
    const p = f.properties || {};
    let v = idField && p[idField] != null ? p[idField] : undefined;
    if (v === undefined) for (const k in p) if (knownFieldNames.test(k) && p[k] != null) { v = p[k]; break; }
    if (v === undefined) v = geometryKey(f.geometry);
    f.id = v;
  }
  return features;
}
function geometryKey(g) {
  try {
    let ring = g && g.coordinates; while (Array.isArray(ring) && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
    const n = ring ? ring.length : 0;
    const a = n ? ring[0] : [], b = n ? ring[n >> 1] : [];
    return `g:${g && g.type}:${n}:${a[0]},${a[1]}:${b[0]},${b[1]}`;
  } catch (_) { return "g:unkeyed"; }
}

