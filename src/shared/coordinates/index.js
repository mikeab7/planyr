/* Shared real-world coordinate system — STUB (minimal interface).
 *
 * The future common ground between workspaces: the Site Planner works in feet
 * about a per-site origin (see workspaces/site-planner/lib/arcgis.js), and the
 * Document Review takeoff produces measured quantities; both should ultimately
 * speak one project grid (Texas State Plane, EPSG:2278 — US survey feet) so a
 * PDF takeoff and a site plan reconcile.
 *
 * NOT wired into the Site Planner yet (it keeps its own projection). This is the
 * seam to grow; keep the interface tiny and additive so both workspaces can adopt
 * it incrementally without churn.
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

/* Reserved for the real implementation:
 *   projectToGrid(lat, lon) -> {x, y}      // WGS84 → State Plane feet
 *   gridToProject({x, y})   -> {lat, lon}
 *   scaleFromCalibration(pxLen, realFt)    // PDF px → feet (Document Review)
 * Implement these here when the workspaces adopt the shared grid. */
export function projectToGrid() { throw new Error("coordinates: projectToGrid not implemented (stub)"); }
export function gridToProject() { throw new Error("coordinates: gridToProject not implemented (stub)"); }
