/* Shared address geocoder (B384) — one pipeline for both surfaces.
 *
 * Originally inline in MapFinder.jsx (the map's "Find a site" box). B384 surfaces the same
 * "add by address" capability inside the planner's ＋ Add parcel menu, and B383's reuse rule is
 * explicit: do NOT fork the address pipeline. So the geocoder lives here and both the map
 * (MapFinder) and the planner (SitePlanner) import it.
 *
 * Esri World Geocoding first (keyless, single non-stored lookup, biased to the map/plan centre),
 * Nominatim as the fallback. Returns { lat, lon, label } or null. Pure I/O over fetch — no React.
 */
export async function geocodeAddress(q, center) {
  const near = center ? `&location=${center.lng},${center.lat}` : "";
  // 1) Esri World Geocoding Service — single, non-stored lookup (keyless).
  try {
    const u = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
      `?f=json&singleLine=${encodeURIComponent(q)}&maxLocations=1&outFields=Match_addr&countryCode=USA${near}`;
    const r = await fetch(u);
    if (r.ok) {
      const j = await r.json();
      const c = j && j.candidates && j.candidates[0];
      if (c && c.location && isFinite(c.location.y) && isFinite(c.location.x)) {
        return { lat: c.location.y, lon: c.location.x, label: c.address || q };
      }
    }
  } catch (_) { /* fall through to Nominatim */ }
  // 2) Nominatim fallback — bias to a ~0.6° viewbox around the centre.
  try {
    let vb = "";
    if (center) { const d = 0.6; vb = `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}&bounded=0`; }
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}${vb}`;
    const r = await fetch(u);
    if (r.ok) {
      const j = await r.json();
      if (j && j.length) return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name || q };
    }
  } catch (_) { /* both failed */ }
  return null;
}
