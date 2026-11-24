/* THE MAP FINDER AS TEXT — same idea as plannerSource.js / noteEditorSource.js (audit batch L2).
 * MapFinder.jsx is being split into hooks under lib/; a source-scan test that read only MapFinder.jsx would pass VACUOUSLY
 * on a negative assertion once the code it guards moved. `mapFinderSource()` is the main file plus every hook extracted
 * from it (new tests should read through it). A new extraction costs one line in MAP_FINDER_EXTRACTED. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAP_FINDER_DIR = fileURLToPath(new URL("../../src/workspaces/site-planner/", import.meta.url));
export const MAP_FINDER_MAIN = "MapFinder.jsx";
export const MAP_FINDER_EXTRACTED = ["lib/useMapFileDrop.js", "lib/useMapFocusRequests.js", "lib/useMyTeams.js", "lib/useMapEscapeKeys.js", "lib/useCalibrationMarkers.js"];

export function mapFinderSource() {
  return [MAP_FINDER_MAIN, ...MAP_FINDER_EXTRACTED].map((f) => readFileSync(MAP_FINDER_DIR + f, "utf8")).join("\n");
}
