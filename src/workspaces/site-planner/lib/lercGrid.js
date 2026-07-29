/* LERC payload decode — split out of demGrid.js so the `lerc` decoder stays OFF the
 * Site route's static bundle (B1042).
 *
 * Plain-English: `lerc` is the codec that unpacks the raw elevation numbers the USGS
 * service sends back. It is only ever needed AFTER a grid has actually been fetched —
 * i.e. when the user asks for contours, drainage arrows, or a drainage check — never
 * while the planner is booting. Keeping it in demGrid.js meant the whole decoder rode
 * the critical-path chunk for every load, including loads that never touch terrain.
 *
 * Everything else in the terrain pipeline (request geometry, smoothing, sampling) stays
 * in demGrid.js, which is genuinely on the boot path (SitePlanner imports `gridRequest`
 * / `sampleAtLatLng`) and is now `lerc`-free.
 *
 * Two consumers, deliberately different:
 *   • terrainWorker.js imports this STATICALLY — the worker is its own bundle, so the
 *     decoder weighs nothing on the main thread and a dynamic import there would only
 *     add a round-trip inside the worker.
 *   • terrainLayers.js imports it DYNAMICALLY, inside the already-async site-grid fetch,
 *     so the main-thread bundle never carries it.
 * Pure: no DOM, no network, no Leaflet — unit-tested in plain node (test/demGrid.test.js)
 * against a real captured 3DEP tile.
 */
import Lerc from "lerc";
import { looksLikeLerc } from "./demGrid.js";
import { M_TO_FT } from "./elevation.js";

/* Decode a LERC payload into the working grid. Returns
 *   { values: Float32Array (FEET), mask: Uint8Array (1 = valid), width, height }
 * merged with the request geometry. Voids come in two shapes (both handled): an
 * explicit LERC validity mask, and cells equal to the F32 noData sentinel from the
 * band statistics — either becomes mask=0, and the value is left NaN-free (0) so
 * downstream math never meets NaN (d3-contour's smoothing would emit NaN coords). */
export function decodeGrid(buf, req) {
  if (!looksLikeLerc(buf)) throw new Error("not a LERC payload");
  const d = Lerc.decode(buf);
  if (!d || !d.pixels || !d.pixels[0]) throw new Error("LERC decode failed");
  if (req && ((d.width !== req.width) || (d.height !== req.height))) {
    // A silently resized export means the server adjusted our bbox — georeferencing
    // would be wrong everywhere. Refuse loudly rather than draw shifted contours.
    throw new Error(`grid size mismatch: got ${d.width}x${d.height}, asked ${req.width}x${req.height}`);
  }
  const src = d.pixels[0];
  const n = src.length;
  const noData = d.statistics && d.statistics[0] && d.statistics[0].noDataValue;
  const values = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = src[i];
    const bad = !isFinite(v) ||
      (noData != null && v === noData) ||
      (d.mask && !d.mask[i]) ||
      v < -1000; // physical floor: 3DEP min is ~-60 m (Death Valley); a huge negative is a sentinel
    if (bad) { values[i] = 0; mask[i] = 0; }
    else { values[i] = v * M_TO_FT; mask[i] = 1; }
  }
  return { values, mask, width: d.width, height: d.height };
}
