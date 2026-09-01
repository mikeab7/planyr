/* Shared address geocoder (B384) — one pipeline for both surfaces.
 *
 * Originally inline in MapFinder.jsx (the map's "Find a site" box). B384 surfaces the same
 * "add by address" capability inside the planner's ＋ Add parcel menu, and B383's reuse rule is
 * explicit: do NOT fork the address pipeline. So the geocoder lives here and both the map
 * (MapFinder) and the planner (SitePlanner) import it.
 *
 * Esri World Geocoding first (keyless, single non-stored lookup, biased to the map/plan centre),
 * Nominatim as the fallback. Pure I/O over fetch — no React.
 *
 * Return contract (B540 — honest error surfacing, never conflate "down" with "not found"):
 *   { lat, lon, label }  → a hit.
 *   null                 → at least one service was REACHED and authoritatively found nothing.
 *   { error }            → NO service could be reached (offline / blocked / non-OK) — so the
 *                          caller can say "lookup is unavailable" instead of "address not found".
 */
export async function geocodeAddress(q, center) {
  const near = center ? `&location=${center.lng},${center.lat}` : "";
  let reachedAny = false; // did any provider actually respond OK? (distinguishes down vs not-found)
  // 1) Esri World Geocoding Service — single, non-stored lookup (keyless).
  try {
    const u = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
      `?f=json&singleLine=${encodeURIComponent(q)}&maxLocations=1&outFields=Match_addr&countryCode=USA${near}`;
    const r = await fetch(u);
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      const c = j && j.candidates && j.candidates[0];
      if (c && c.location && isFinite(c.location.y) && isFinite(c.location.x)) {
        return { lat: c.location.y, lon: c.location.x, label: c.address || q };
      }
    }
  } catch (_) { /* unreachable — fall through to Nominatim */ }
  // 2) Nominatim fallback — bias to a ~0.6° viewbox around the centre.
  try {
    let vb = "";
    if (center) { const d = 0.6; vb = `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}&bounded=0`; }
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}${vb}`;
    const r = await fetch(u);
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      if (j && j.length) return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name || q };
    }
  } catch (_) { /* unreachable */ }
  // Reached a provider but no match → genuinely not found (null). Reached NONE → service is down.
  return reachedAny ? null : { error: "Address lookup is unavailable right now — check your connection and try again, or pan the map to your site." };
}

/* B986096-HARDENING-9 (owner rule, "reverse-geocoded from the stored lat/lon... do not add a new
 * dependency for this") — the REVERSE of `geocodeAddress` above, same two providers in the same
 * order, same honest three-way return contract (a hit / genuinely-nothing-there / unreachable).
 * First consumer: the comp entry sheet's Location cell, turning a dropped pin into a street
 * address instead of a bare confirmation label. */
export async function reverseGeocodeLatLon(lat, lon) {
  let reachedAny = false;
  try {
    const u = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode` +
      `?f=json&location=${lon},${lat}&langCode=en`;
    const r = await fetch(u);
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      const addr = j?.address;
      const label = addr?.Match_addr || addr?.LongLabel || addr?.Address;
      if (label) return { label };
    }
  } catch (_) { /* unreachable — fall through to Nominatim */ }
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`;
    const r = await fetch(u);
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      if (j?.display_name) return { label: j.display_name };
    }
  } catch (_) { /* unreachable */ }
  return reachedAny ? null : { error: "Reverse geocode unavailable right now." };
}
