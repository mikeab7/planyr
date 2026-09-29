/* The political-boundary GATE, alone in a leaf module (NEW-1, revised 2026-09-29).
 *
 * Same shape, and the same reason, as `terrainGate.js` (B1095): the map finder needs to
 * know WHETHER state/country outlines belong on screen at the current zoom, and that is
 * one comparison — but the thing it gates (`adminBoundaryLayer.js`, plus the geometry
 * assets) must never ride the boot bundle. So the rule lives here, this file imports
 * nothing, and the layer is reached only through the dynamic import below.
 *
 * WHY A ZOOM BAND RATHER THAN A FLOOR. Every other zoom gate in this codebase is a
 * `minZoom` — "appear once you zoom IN". This is the first that runs the other way:
 * political boundaries are ORIENTATION FURNITURE, useful once you have pulled back far
 * enough to lose every local landmark, and clutter over a site plan.
 *
 * The band, in plain terms (REVISED 2026-09-29 — owner: "the state boundaries should
 * survive more zoom ins"; this deliberately replaces the old "zoom >= 8: nothing" rule):
 *   zoom <= 7    country outlines (the continental view). UNCHANGED: once you are inside
 *                one country they add nothing, so they still stop at 7.
 *   zoom 5..12   state outlines. Below 5 fifty outlines are mush; through 12 (roughly "the
 *                whole Houston metro still in view") a state line is still useful context.
 *                8..12 uses the finer 1:10m geometry (`ADMIN1_DETAIL_MIN_ZOOM`).
 *   zoom >= 13   nothing. PARCEL_MINZOOM is 14 (parcelDisplayZoom.js — the first zoom at
 *                which any parcel draws), so 13 is the last zoom before parcels and site
 *                work own the screen; the line is gone one step earlier so it never shares
 *                a screen with them, and no fetch happens there at all.
 *
 * Only the OUTER edge of the band lives here. Which level shows within it is
 * `adminBoundaryLevels` in `adminBoundaryData.js`, on the lazy side — the boot path needs
 * to answer one question ("is anything worth loading yet?").
 */
export const ADMIN_BOUNDARY_MAX_ZOOM = 12;

/* True when ANY boundary level (in practice: state outlines) belongs on screen. Pure. `zoom` may be null
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
