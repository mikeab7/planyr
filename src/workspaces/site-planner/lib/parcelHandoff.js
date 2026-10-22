/* lib/parcelHandoff.js — NEW-1 (parcel outlines lag the map when zooming, then snap into place a second later).
 *
 * Pure decisions, no Leaflet, so test/parcelHandoff.test.js can drive every rule. MEASURED first (ui-audit/measure-parcel-zoom-lock.mjs, a per-frame
 * reading of how far the painted line sits from a lot's true corner, with Leaflet's own animated marker as the oracle): the lines RIDE the zoom
 * animation to within a pixel — they are not lagging the imagery. What failed was the HAND-OFF at the end of the zoom:
 *   · zooming OUT past the close stage's floor (or from the mid stage to the wide one) removed every line at `zoomend` and drew nothing until the NEXT
 *     stage's tiles had been fetched — a blank gap as long as the county server's answer (300 ms against a mock, seconds against a real county);
 *   · zooming IN (or out) inside the close stage pruned every held lot at `zoomend` (`pruneToLiveCells`: the new zoom's cells are all "new", so every old
 *     lot "belongs to a cell that is no longer current") and the lines came back only when the new cells' queries returned.
 * The rule that fixes both: WHAT IS DRAWN IS KEPT UNTIL ITS REPLACEMENT IS DRAWN (the same idea as the wide→close hand-off that already existed), with a
 * time cap so a county that never answers cannot pin stale lines on the map forever. */

/** How long the previous stage's lines may stay under a stage that has not finished loading. */
export const CARRY_MS = 4000;
/** How long a prune may wait for the new zoom's cells before it runs anyway (a hung request must not leave the map holding every lot it ever saw). */
export const PRUNE_IDLE_CAP_MS = 6000;

/** Should `pruneToLiveCells` run now, or wait for the new view's answers?
 *  It waits only while the layer is IN its draw range and answers are still coming: out of range nothing is requested, so there is nothing to wait for. */
export function pruneVerdict({ visibleZoom, activeRequests, ingestPending }) {
  if (!visibleZoom) return "now";
  return (Number(activeRequests) > 0 || Number(ingestPending) > 0) ? "wait" : "now";
}

/** Is the stage the view is in drawn — so the previous stage's carried lines can go?
 *  `wantNow` = the tile keys the current view needs (null until the layer has computed them for this view). Every one must be loaded AND attached, and
 *  the ingest queue empty (an attached tile whose lots are still queued is not drawn yet). */
export function carryReady({ wantNow, hasLoaded, hasAttached, ingestPending }) {
  if (!Array.isArray(wantNow)) return false;
  if (Number(ingestPending) > 0) return false;
  for (let i = 0; i < wantNow.length; i++) if (!hasLoaded(wantNow[i]) || !hasAttached(wantNow[i])) return false;
  return true;
}

/** When a carried close-stage lot is let go: detach it unless it is a LIVE lot again (still held by the close layer, which is back in range). */
export function ghostShouldDetach({ heldByLayer, visibleZoom }) {
  return !(heldByLayer && visibleZoom);
}
