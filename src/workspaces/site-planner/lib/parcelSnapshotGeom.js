/* lib/parcelSnapshotGeom.js — the pure geometry the parcel SAVED COPY (B629) is queried with: which lots are in a
 * view, which lot is under a click. A dependency-free leaf (B2092656 ×3) because it runs in TWO places — inside the
 * saved-copy worker (parcelSnapshotWorker.js), where the copy now lives, and on the main thread for the in-memory
 * fallback and the unit tests — and the worker must not carry counties.js. Moved here unchanged from
 * parcelSnapshot.js, which re-exports all of it. */
import { geoJsonToEsriFeature, outerRingsLngLat } from "./esriRings.js";

/* [minLng, minLat, maxLng, maxLat] over a GeoJSON Polygon/MultiPolygon feature's coords, or null.
 * Pure. Memoised on the feature via a non-enumerable field so a viewport filter over ~30k parcels
 * doesn't recompute every pan. */
export function featureBbox(feature) {
  if (!feature || !feature.geometry) return null;
  if (feature.__bbox) return feature.__bbox;
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : null;
  if (!rings || !rings.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const p of ring) {
    const x = p[0], y = p[1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  const b = [minX, minY, maxX, maxY];
  try { Object.defineProperty(feature, "__bbox", { value: b, enumerable: false, configurable: true }); } catch (_) {}
  return b;
}

// Absolute shoelace area (deg²) of an [[lng,lat]…] ring list — only for the smallest-lot tiebreak
// (mirrors optimisticHitAt preferring the tighter parcel when several overlap). Pure.
function ringsAreaAbs(parts) {
  let a = 0;
  for (const r of parts) { let s = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; s += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } a += Math.abs(s / 2); }
  return a;
}

// Even-odd point-in-ring on [[lng,lat]…]. Same test as MapFinder.optimisticHitAt. Pure.
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* The features whose bbox intersects the view (lng/lat `{ w, s, e, n }`). Cheap bbox reject so only
 * a few hundred parcels are ever drawn/hit-tested at site zoom. Pure. */
export function featuresForView(features, bounds) {
  if (!bounds) return features || [];
  const { w, s, e, n } = bounds;
  return (features || []).filter((f) => {
    const b = featureBbox(f);
    return b && !(b[2] < w || b[0] > e || b[3] < s || b[1] > n);
  });
}

/* The parcel under a clicked point, as the SAME esri feature shape the identify pipeline returns
 * (`{ geometry: { rings }, attributes }`, lng/lat), so it feeds `addParcelHit` with no new logic.
 * Prefers the tightest containing lot (parity with optimisticHitAt). Returns null if none. Pure. */
export function featureAtPoint(features, lng, lat) {
  let best = null, bestArea = Infinity;
  for (const f of features || []) {
    const b = featureBbox(f);
    if (!b || lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    const esri = geoJsonToEsriFeature(f);
    if (!esri) continue;
    const parts = outerRingsLngLat(esri);
    if (!parts.length || !parts.some((r) => pointInRing(lng, lat, r))) continue;
    const area = ringsAreaAbs(parts);
    if (area < bestArea) { best = esri; bestArea = area; }
  }
  return best;
}
