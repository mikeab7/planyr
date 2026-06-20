/* Shared real-world coordinate system (minimal interface).
 *
 * The common ground between workspaces: the Site Planner works in feet about a
 * per-site origin (see workspaces/site-planner/lib/arcgis.js), and the Document
 * Review takeoff produces measured quantities; both should ultimately speak one
 * project grid (Texas State Plane, EPSG:2278 — US survey feet) so a PDF takeoff
 * and a site plan reconcile.
 *
 * The EPSG:2278 ↔ WGS84 projection (below) is now implemented and in use by the
 * layer coverage engine (a read-only screening use). The Site Planner still keeps
 * its own per-site feet frame for drawn geometry — adopt this grid incrementally
 * and additively, never via a big-bang planner rewrite.
 */

// Texas State Plane, South Central zone, US survey feet (the project grid).
export const PROJECT_CRS = { epsg: 2278, name: "NAD83 / Texas South Central (ftUS)", unit: "us-ft" };

export const FT_PER_M = 1 / 0.3048;
export const SQFT_PER_ACRE = 43560;

// A project-grid point, in feet, about a shared origin: { x: east, y: north }.
// (Placeholder type marker for documentation; JS has no types.)
export const makePoint = (x, y) => ({ x, y });

// Minimal unit helpers the takeoff + planner can share now.
export const ftToAcres = (sqft) => sqft / SQFT_PER_ACRE;
export const metersToFeet = (m) => m * FT_PER_M;

/* ---------------------------------------------------------------------------
 * EPSG:2278 ↔ WGS84 — the real project-grid projection.
 *
 * EPSG:2278 is a Lambert Conformal Conic (2 standard parallels) on the NAD83 /
 * GRS80 ellipsoid, in US SURVEY FEET. Implemented from the EPSG Guidance Note 7-2
 * formulas so it needs no proj library. Validated against pyproj to <1e-4° (a few
 * metres — far tighter than any screening use). The US survey foot (not the
 * international foot) is what makes the false northing 13,123,333.333 ftUS land on
 * exactly 4,000,000 m, so the grid lines up with the published service extents.
 *
 * First consumer: the layer coverage engine reads a regional service's fullExtent
 * — which the City of Houston / HCFCD publish in EPSG:2278 — and reprojects it to
 * lat/lon to test whether that layer's data reaches the current map view. It is a
 * READ-ONLY screening use; the Site Planner still keeps its own per-site feet frame
 * for drawn geometry (this is the additive seam noted above, not a planner rewrite).
 * ------------------------------------------------------------------------- */
const US_FT_M = 1200 / 3937;          // 1 US survey foot in metres (exact)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// NAD83 / GRS80 ellipsoid.
const GRS80_A = 6378137.0;
const GRS80_F = 1 / 298.257222101;
const E2 = GRS80_F * (2 - GRS80_F);
const ECC = Math.sqrt(E2);

// Texas South Central (FIPS 4204) defining parameters, in metres.
const LAT0 = 27.83333333333333 * D2R;   // 27°50′ — latitude of false origin
const LON0 = -99.0 * D2R;                // central meridian
const LAT1 = 28.38333333333333 * D2R;    // 28°23′ — standard parallel 1
const LAT2 = 30.28333333333333 * D2R;    // 30°17′ — standard parallel 2
const FE_M = 600000.0;                   // false easting  (1,968,500 ftUS)
const FN_M = 4000000.0;                  // false northing (13,123,333.333 ftUS)

const lccM = (lat) => Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
const lccT = (lat) => Math.tan(Math.PI / 4 - lat / 2) /
  ((1 - ECC * Math.sin(lat)) / (1 + ECC * Math.sin(lat))) ** (ECC / 2);

// Precompute the cone constants once (they depend only on the zone parameters).
const _m1 = lccM(LAT1), _m2 = lccM(LAT2);
const _t0 = lccT(LAT0), _t1 = lccT(LAT1), _t2 = lccT(LAT2);
const LCC_N = (Math.log(_m1) - Math.log(_m2)) / (Math.log(_t1) - Math.log(_t2));
const LCC_F = _m1 / (LCC_N * _t1 ** LCC_N);
const LCC_R0 = GRS80_A * LCC_F * _t0 ** LCC_N;

/* WGS84 (lat, lon in degrees) → project grid {x, y} in US survey feet. */
export function projectToGrid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("coordinates: projectToGrid needs finite lat, lon");
  const latR = lat * D2R, lonR = lon * D2R;
  const r = GRS80_A * LCC_F * lccT(latR) ** LCC_N;
  const theta = LCC_N * (lonR - LON0);
  const E_m = FE_M + r * Math.sin(theta);
  const N_m = FN_M + LCC_R0 - r * Math.cos(theta);
  return { x: E_m / US_FT_M, y: N_m / US_FT_M };
}

/* Project grid {x, y} in US survey feet → WGS84 {lat, lon} in degrees. */
export function gridToProject({ x, y } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("coordinates: gridToProject needs finite {x, y}");
  const E_m = x * US_FT_M, N_m = y * US_FT_M;
  const dE = E_m - FE_M, dN = LCC_R0 - (N_m - FN_M);
  const rho = Math.sign(LCC_N) * Math.sqrt(dE * dE + dN * dN);
  const t = (rho / (GRS80_A * LCC_F)) ** (1 / LCC_N);
  const lon = Math.atan2(dE, dN) / LCC_N + LON0;
  let lat = Math.PI / 2 - 2 * Math.atan(t);            // first approximation
  for (let i = 0; i < 8; i++) {                         // iterate to convergence
    const es = ECC * Math.sin(lat);
    lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (ECC / 2));
  }
  return { lat: lat * R2D, lon: lon * R2D };
}
