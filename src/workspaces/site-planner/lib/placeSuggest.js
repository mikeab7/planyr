/* placeSuggest.js — B831779 (NEW-4): live place suggestions for the map toolbar's address field,
 * replacing the old single-shot "Go" geocode with a typeahead list of PLACES (address /
 * intersection / place).
 *
 * Reuses geocode.js's two-provider ladder (Esri World Geocoding first, Nominatim fallback) but
 * asks each for SEVERAL candidates instead of committing to one, so the caller can render a list.
 * Pure I/O — no React, no DOM beyond fetch/AbortController — so it is unit-testable without a browser.
 *
 * Return contract mirrors geocode.js's honest distinction (B540 / LOUD-FAILURE, precedent B709696 —
 * a place missing from a snapshot must never silently read as "no results" the same way a genuine
 * empty answer does): `reachedAny` tells the caller whether ANY service responded, so a real
 * no-match can be told apart from a service outage.
 *
 *   { results: [{label,lat,lon}], reachedAny: true }   → at least one service answered (0+ hits)
 *   { results: [], reachedAny: false }                  → no service could be reached
 *
 * An AbortError from the passed-in `signal` is re-thrown (never swallowed into "no match") so a
 * caller that aborts a stale request on every keystroke can tell "cancelled" apart from "empty".
 */
export async function suggestPlaces(q, center, { signal, max = 6 } = {}) {
  const near = center ? `&location=${center.lng},${center.lat}` : "";
  let reachedAny = false;
  // 1) Esri World Geocoding Service — several candidates, biased to the map/plan centre.
  try {
    const u = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
      `?f=json&singleLine=${encodeURIComponent(q)}&maxLocations=${max}&outFields=Match_addr&countryCode=USA${near}`;
    const r = await fetch(u, { signal });
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      const hits = ((j && j.candidates) || [])
        .filter((c) => c && c.location && isFinite(c.location.y) && isFinite(c.location.x))
        .map((c) => ({ label: c.address || q, lat: c.location.y, lon: c.location.x }));
      if (hits.length) return { results: dedupeByLabel(hits), reachedAny };
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    /* else unreachable — fall through to Nominatim */
  }
  // 2) Nominatim fallback — several results, biased to a ~0.6° viewbox around the centre.
  try {
    let vb = "";
    if (center) { const d = 0.6; vb = `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}&bounded=0`; }
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=${max}&countrycodes=us&q=${encodeURIComponent(q)}${vb}`;
    const r = await fetch(u, { signal });
    if (r.ok) {
      reachedAny = true;
      const j = await r.json();
      const hits = (Array.isArray(j) ? j : [])
        .filter((h) => h && isFinite(+h.lat) && isFinite(+h.lon))
        .map((h) => ({ label: h.display_name || q, lat: +h.lat, lon: +h.lon }));
      return { results: dedupeByLabel(hits), reachedAny };
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
  }
  return { results: [], reachedAny };
}

function dedupeByLabel(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = h.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
