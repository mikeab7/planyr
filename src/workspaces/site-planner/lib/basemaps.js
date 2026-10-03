/* The basemap registry moved to `src/shared/basemaps/basemaps.js` (NEW-1, Food map) so /food can
 * use the Site Plan map without importing from this workspace. This file only re-exports it so
 * every existing site-planner import keeps working — do NOT redefine anything here. */
export * from "../../../shared/basemaps/basemaps.js";
