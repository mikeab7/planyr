/* Re-export shim (B423 / NEW-2).
 *
 * The takeoff geometry + measure engine moved to the shared markup module
 * (`src/shared/markup/`) so the Site Planner, Document Review, and the Stitcher all speak
 * the same units and share one implementation. This file stays as a stable import path:
 * everything Document Review historically imported from `./lib/takeoff.js` still resolves
 * here, now sourced from the shared engine. Prefer importing from `src/shared/markup/*`
 * directly in new code.
 */
export { dist, pathLength, polyArea, centroidOf, midOfPath, pointInPoly } from "../../../shared/markup/geometry.js";
export { measureValue, measureLabel, rollup, canCommitMeasure, MIN_MEASURE_PTS } from "../../../shared/markup/measure.js";
export { sanitizeMarkup, sanitizeMarkups } from "../../../shared/markup/markupModel.js";
