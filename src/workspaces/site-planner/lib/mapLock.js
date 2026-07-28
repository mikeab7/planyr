/* mapLock — the ONE projection that welds the planner's feet frame to the Web-Mercator
 * basemap. Pure math, no DOM, no Leaflet (so it unit-tests and can run in a worker).
 *
 * WHY THIS EXISTS (NEW-1). The planner draws in a local feet frame anchored at the site
 * origin; the basemap under it is Web Mercator. Those two only stay locked together if
 * BOTH the position conversion and the scale (zoom) conversion use the SAME latitude
 * model. They used to disagree:
 *   • position went through an EQUIRECTANGULAR frame pinned at the site origin
 *     (`y = -(lat - lat0) * FT_PER_DEG`, linear in latitude), while
 *   • the basemap zoom was re-derived at the CURRENT view-centre latitude.
 * Mercator's y is nonlinear in latitude and the linear frame's is not, so the two
 * round-tripped inconsistently: a long north–south pan out and back left the drawing a
 * few feet off the imagery, EVERY time, and it accumulated (measured 2026-07-28: -4.3 ft
 * residual per ~89,000 ft out-and-back, uniform across every element; east–west, where
 * both models agree, was exactly lossless at 0.0 ft).
 *
 * THE FIX — one model for both halves. The feet frame is now an exact UNIFORM SCALING of
 * spherical Web Mercator, anchored at the site origin:
 *
 *     x_ft = (lon - lon0)                     * FT_PER_DEG * cos(lat0)
 *     y_ft = -(mercDeg(lat) - mercDeg(lat0))  * FT_PER_DEG * cos(lat0)
 *
 * Because Mercator is conformal and this is a pure scale of it, feet↔screen is a rigid
 * affine map of Mercator↔screen: the round trip is exact at any pan distance, in any
 * direction, and nothing accumulates. The matching scale conversion (`ppfToZoom`) is
 * therefore anchored at the SAME `lat0` — never at the panned-to latitude.
 *
 * WHAT THIS DOES NOT CHANGE. At `lat0` the new frame is identical to the old one to first
 * order (dy/dlat = -FT_PER_DEG exactly at lat0), so drawn geometry, acreage and every
 * dimension are untouched: over a mile of site the linear-vs-Mercator difference is under
 * a ten-thousandth of a foot, and even ten miles out it is ~0.02 ft. Feet stay ground-true
 * at the site, which is the only place site math is done.
 */

// Feet per degree on the Web-Mercator sphere base (2πR/360). Both axes use it, so the
// frame is a linearisation of spherical Mercator rather than of the ellipsoid.
export const FT_PER_DEG = 365223;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// Spherical Mercator northing, expressed in DEGREES so it shares FT_PER_DEG with the
// longitude axis. mercDeg(lat) ≈ lat near the equator and diverges toward the poles.
export const mercDeg = (lat) => R2D * Math.log(Math.tan(Math.PI / 4 + clampLat(lat) * D2R / 2));

// Inverse of mercDeg.
export const invMercDeg = (m) => R2D * (2 * Math.atan(Math.exp(m * D2R)) - Math.PI / 2);

// Web Mercator is undefined at the poles; clamp to the standard ±85.051129° world edge so
// a wild input can never produce Infinity and poison a view transform.
const MAX_LAT = 85.05112878;
function clampLat(lat) {
  const v = Number(lat);
  if (!Number.isFinite(v)) return 0;
  return v > MAX_LAT ? MAX_LAT : v < -MAX_LAT ? -MAX_LAT : v;
}

// Feet per degree of Mercator (either axis) in a frame anchored at lat0. One constant for
// x and y — that uniformity is what makes the frame conformal with the basemap.
export const ftPerDeg = (lat0) => FT_PER_DEG * Math.cos(clampLat(lat0) * D2R);

/* [lon, lat] → planner feet {x east, y SOUTH} about the origin (lon0, lat0). */
export function lngLatToFeet(lon, lat, lon0, lat0) {
  const k = ftPerDeg(lat0);
  return { x: (lon - lon0) * k, y: -(mercDeg(lat) - mercDeg(lat0)) * k };
}

/* Planner feet {x, y} → [lat, lng]. Exact inverse of lngLatToFeet. */
export function feetToLatLngPair(pt, lat0, lon0) {
  const k = ftPerDeg(lat0);
  const x = Number(pt && pt.x) || 0;
  const y = Number(pt && pt.y) || 0;
  return [invMercDeg(mercDeg(lat0) - y / k), lon0 + x / k];
}

// ── scale ────────────────────────────────────────────────────────────────────────────
// Leaflet lays 256 px across every 360° of Mercator at zoom 0, so pixels per degree of
// Mercator is 256·2^z / 360. The feet frame above puts `ftPerDeg(lat0)` feet in that same
// degree — so the two constants must be THE SAME FT_PER_DEG, not one derived from the
// earth's circumference in metres and the other from a feet-per-degree constant. They used
// to be exactly that, differing by ~4 parts per million, which is small but not zero: it
// left a residual that grew with distance from the view centre. Deriving the zoom from
// FT_PER_DEG makes the SVG↔basemap lock exact by construction rather than approximate.
const PX_PER_WORLD_DEG_Z0 = 256 / 360;

/* The (fractional) Leaflet zoom whose pixels-per-foot equals the planner's `ppf` in a feet
 * frame anchored at `lat0`. ALWAYS pass the SITE ORIGIN latitude — passing the panned-to
 * centre latitude is precisely the NEW-1 bug: it makes the basemap rescale while the
 * drawing does not. */
export const ppfToZoom = (ppf, lat0) =>
  Math.log2((ppf * ftPerDeg(lat0)) / PX_PER_WORLD_DEG_Z0);

/* Inverse of ppfToZoom — pixels per foot at a given Leaflet zoom. */
export const zoomToPpf = (zoom, lat0) =>
  (Math.pow(2, zoom) * PX_PER_WORLD_DEG_Z0) / ftPerDeg(lat0);

/* ── the lock invariant ───────────────────────────────────────────────────────────────
 * Where a feet point lands on screen, computed TWO independent ways:
 *   • the planner's own SVG transform (feet × ppf + offset), and
 *   • the basemap's, by projecting the point to lat/lng, then to Web-Mercator world
 *     pixels at the derived zoom, relative to the map centre.
 * They must agree — that agreement IS "the drawing is locked to the imagery". Exported so
 * the regression test can assert it directly instead of eyeballing a screenshot.
 */
export function lockOffsetPx(pt, view, size, origin) {
  const svg = { x: pt.x * view.ppf + view.offX, y: pt.y * view.ppf + view.offY };
  // The map centre, exactly as SitePlanner derives it: the feet point under the canvas centre.
  const centerFt = { x: (size.w / 2 - view.offX) / view.ppf, y: (size.h / 2 - view.offY) / view.ppf };
  const [cLat, cLon] = feetToLatLngPair(centerFt, origin.lat, origin.lon);
  const zoom = ppfToZoom(view.ppf, origin.lat);
  const [pLat, pLon] = feetToLatLngPair(pt, origin.lat, origin.lon);
  const scale = (256 * Math.pow(2, zoom)) / 360; // world pixels per degree of Mercator
  const map = {
    x: size.w / 2 + (pLon - cLon) * scale,
    y: size.h / 2 - (mercDeg(pLat) - mercDeg(cLat)) * scale,
  };
  return { dx: map.x - svg.x, dy: map.y - svg.y };
}
