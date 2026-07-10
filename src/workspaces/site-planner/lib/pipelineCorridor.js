/* Pipeline easement screening corridor (B752) — pure, dependency-free, unit-tested.
 *
 * Draws an ASSUMED buffer band a set distance each side of a pipeline centerline as a screening
 * proxy for easement extent. Real easement widths are NOT in the RRC/PHMSA data — the T-4 route
 * carries diameter, not width, and recorded widths live per-instrument in county easements — so
 * this is DOUBLY approximate (a schematic centerline × an assumed width) and must never read as a
 * surveyed easement. The prominent caveat lives on the layer; this module is only the geometry.
 *
 * The centerline arrives as WGS84 [lon,lat] (the map's frame). `bufferPolyline` (metesAndBounds.js,
 * the same hand-rolled offset engine the easement/setback strips use — no new dependency, the repo
 * deliberately avoids JSTS) works in planar FEET, so we project each vertex to a LOCAL flat-earth
 * feet frame anchored at the path's own latitude, buffer, then unproject back to [lon,lat]. Over a
 * single pipeline segment at a ~50 ft corridor width this local equirectangular scaling is accurate
 * to well under a foot — more than enough for a screening band.
 */
import { bufferPolyline } from "./metesAndBounds.js";

// Feet per degree of latitude (WGS84 mean, 69.047 mi × 5280). Longitude scales by cos(lat).
const FT_PER_DEG_LAT = 364567;
const D2R = Math.PI / 180;

/* Mean latitude of a [lon,lat] path (for the local longitude scale). Pure. */
function meanLat(path) {
  let sum = 0, n = 0;
  for (const p of path) { if (p && Number.isFinite(p[1])) { sum += p[1]; n++; } }
  return n ? sum / n : 0;
}

/* Buffer a WGS84 [lon,lat] centerline into a closed corridor ring of TOTAL width `totalWidthFt`,
 * returned as [lon,lat] vertices (a single strip ring, left-forward + right-back with flat end
 * caps, from bufferPolyline). Returns null for a degenerate path (< 2 finite vertices) or a
 * non-positive width — the caller then draws nothing (an honest omission, never a zero-width
 * sliver). Pure. */
export function corridorRingLngLat(path, totalWidthFt) {
  if (!Array.isArray(path) || path.length < 2) return null;
  if (!(totalWidthFt > 0)) return null;
  const finite = path.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (finite.length < 2) return null;
  const lat0 = meanLat(finite);
  const ftPerLon = FT_PER_DEG_LAT * Math.max(Math.cos(lat0 * D2R), 1e-6); // guard the poles (never in TX)
  // Project to local feet, buffer ±width/2, unproject.
  const pts = finite.map(([lon, lat]) => ({ x: lon * ftPerLon, y: lat * FT_PER_DEG_LAT }));
  const ring = bufferPolyline(pts, totalWidthFt);
  if (!ring || ring.length < 3) return null;
  return ring.map(({ x, y }) => [x / ftPerLon, y / FT_PER_DEG_LAT]);
}

/* Corridor rings for many centerlines at one width. Each part that buffers is one ring; a
 * degenerate part is skipped (never a half-drawn band). `paths` is an array of [lon,lat] paths.
 * Returns an array of [lon,lat] rings. Pure. */
export function corridorRings(paths, totalWidthFt) {
  const out = [];
  for (const path of paths || []) {
    const ring = corridorRingLngLat(path, totalWidthFt);
    if (ring) out.push(ring);
  }
  return out;
}

// The conservative single default the layer ships with (owner: one honest default over a fake
// precise diameter→width table; refine-by-class is a follow-on). Total corridor, feet.
export const DEFAULT_CORRIDOR_WIDTH_FT = 50;
// Editable bounds for the inline width control.
export const MIN_CORRIDOR_WIDTH_FT = 10;
export const MAX_CORRIDOR_WIDTH_FT = 400;
