/* The wide-zoom political-boundary GATE, alone in a leaf module (NEW-1).
 *
 * Same shape, and the same reason, as `terrainGate.js` (B1095): the map finder needs to
 * know WHETHER state/country outlines belong on screen at the current zoom, and that is
 * one comparison — but the thing it gates (`adminBoundaryLayer.js`, plus a ~100 KB
 * geometry asset) must never ride the boot bundle. So the rule lives here, this file
 * imports nothing, and the layer is reached only through the dynamic import below.
 *
 * WHY A ZOOM BAND RATHER THAN A FLOOR. Every other zoom gate in this codebase is a
 * `minZoom` — "appear once you zoom IN" (the layer registry's flood/utility/terrain
 * gates, `TERRAIN_MIN_ZOOM`). This is the first gate that runs the other way, because
 * political boundaries are the opposite kind of thing: they are ORIENTATION FURNITURE,
 * useful exactly when you have pulled back far enough to lose every local landmark, and
 * pure clutter over a site plan. At site working zoom they are not merely hidden — the
 * chunk and its geometry are never fetched at all.
 *
 * The band, in plain terms:
 *   zoom ≤ 7   country outlines — the continental view that lifting the old zoom floor
 *              (B1102/NEW-6, min zoom 8 → 3) finally made reachable.
 *   zoom 5..7  state / province outlines join in. Below 5 the whole United States is a
 *              couple of hundred pixels wide and fifty state outlines are mush, so the
 *              coarser level carries the view on its own.
 *   zoom ≥ 8   nothing. This is the old zoom floor, and everything at or inside it is
 *              site work: parcels, buildings and site elements own the screen.
 *
 * Only the OUTER edge of the band lives here. Which of the two levels shows within it is
 * `adminBoundaryLevels` in `adminBoundaryData.js`, on the lazy side — the boot path needs
 * to answer one question ("is anything worth loading yet?") and carrying the rest of the
 * rule with it would spend Site-route bytes on a decision that cannot be acted on until
 * the chunk has landed anyway.
 */
export const ADMIN_BOUNDARY_MAX_ZOOM = 7;

/* True when the wide-zoom furniture belongs on screen at all. Pure. `zoom` may be null
 * before the map has reported one, which must read as "nothing yet", never as zoom 0 —
 * hence the explicit typeof rather than a bare comparison. */
export const adminBoundariesVisible = (zoom) => typeof zoom === "number" && zoom <= ADMIN_BOUNDARY_MAX_ZOOM;

/* Attach the layer to a map, loading the chunk on first use. Idempotent per map (the
 * layer module keeps its own per-map registry), cached module promise, and a failed load
 * clears the cache so the next zoom-out retries rather than wedging on a dead promise —
 * the `terrainLazy.js` contract, verbatim. */
let loading = null;
export function attachAdminBoundaries(map) {
  if (!map) return Promise.resolve(null);
  if (!loading) {
    loading = import("./adminBoundaryLayer.js").catch((e) => { loading = null; throw e; });
  }
  return loading.then((m) => m.attachAdminBoundaries(map), () => null);
}
