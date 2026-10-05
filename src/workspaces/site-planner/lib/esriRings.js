/* lib/esriRings.js — pure ring helpers shared by arcgis.js and the parcel saved-copy worker (B2092656 ×3).
 * A leaf on purpose: arcgis.js imports counties.js, and the worker (parcelSnapshotWorker.js) must not carry the whole
 * county registry to answer "which saved-copy lot is under this point". Moved here unchanged from arcgis.js. */

export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a / 2;
}

// The outer-boundary ring of an ArcGIS polygon. Outer rings and holes wind oppositely;
// the largest ring by |area| is always an outer boundary (a hole can't exceed the ring
// that contains it), so picking the max-|area| ring can never select a hole — even on a
// multipart feature whose biggest hole exceeds a small separate part (B36c).
export function largestRing(rings) {
  let best = rings[0], bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) { const a = Math.abs(ringArea(r)); if (a > bestA) { best = r; bestA = a; } }
  return best;
}

export const ringClosed = (r) => r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

/* Convert a GeoJSON polygon feature (as esri-leaflet's vector display layer carries
 * them, in lon/lat) into the SAME esri-shaped `{ geometry: { rings }, attributes }`
 * that the identify pipeline and `outerRingsLngLat`/`featureToParcel` consume — so the
 * already-on-screen parcel outlines can feed the exact same highlight/select path as a
 * server identify (the B441 optimistic-highlight pick). A GeoJSON Polygon's
 * `coordinates` is a list of rings; a MultiPolygon's is a list of those — flatten both
 * to one flat ring list (winding-agnostic: `outerRingsLngLat` re-derives outers vs
 * holes from ring area, so GeoJSON's RFC-7946 winding vs esri's doesn't matter).
 * GeoJSON `properties` becomes `attributes`. Returns null if it isn't a polygon. */
export function geoJsonToEsriFeature(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  let rings;
  if (g.type === "Polygon") rings = g.coordinates;
  else if (g.type === "MultiPolygon") rings = g.coordinates.flat();
  else return null;
  if (!Array.isArray(rings) || !rings.length) return null;
  return { geometry: { rings }, attributes: { ...(feature.properties || {}) } };
}

/* EVERY outer-boundary ring of a (possibly MULTIPART) polygon feature, each as an
 * open [[lon,lat], ...] array (4326). A parcel can legitimately be several separate
 * pieces under one account — e.g. "TRS 3 & 5" is two physically separate tracts —
 * and the largest-ring-only pick (B36c) silently dropped the smaller piece: a click
 * in it registered the account but highlighted (and imported) only the biggest
 * tract, so the clicked piece "wouldn't select" and a neighbour appeared to. This
 * returns all outer parts so callers can highlight + plan every tract. Holes (rings
 * wound opposite to the outers) are excluded — the planner parcel model has no
 * donut support and the prior behaviour already ignored them. Returns [] if none. */
export function outerRingsLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return [];
  // Outer rings and holes wind oppositely (ArcGIS: outers clockwise, holes CCW);
  // the largest |area| ring is always an outer boundary, so its winding sign marks
  // the outers. Keep same-sign, non-degenerate rings; drop the opposite-sign holes.
  const areas = rings.map(ringArea);
  let outerSign = 1, bestA = -1;
  areas.forEach((a) => { if (Math.abs(a) > bestA) { bestA = Math.abs(a); outerSign = Math.sign(a) || 1; } });
  return rings
    .filter((_, i) => areas[i] !== 0 && Math.sign(areas[i]) === outerSign)
    .map((r) => (ringClosed(r) ? r.slice(0, -1) : r));
}
