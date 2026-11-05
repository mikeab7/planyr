/* lib/parcelAreaFieldsLazy.js — NEW-1 (Select parcels, wide view): the verified size-column table AND the wide-view layer, loaded on demand.
 *
 * `parcelAreaFields.js` (generated) is ~60 KB of source URLs, and the layer/engine are only used when Select parcels is on, so both are dynamic imports
 * and never ride the Site route's critical chunk (the bundle budget measured the eager version at +98 KB with the table, +17 KB without it). `wideViewReady()` is awaited by MapFinder BEFORE the
 * first display is built (`areaFieldsReady()` is the table alone, for node callers); `areaFieldsNow()` is the synchronous read the request builder and the layer use afterwards (null until loaded, which
 * reads as "no wide stage for any source" — never a guess). A failed load is reported loudly and leaves every source at today's cutoff. */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

let table = null, layerMod = null, pending = null, tablePending = null;
export const areaFieldsNow = () => table;
/** The wide-view layer module (`attachWideOutlines`), or null until loaded — `makeParcelLayer` builds no wide stage without it. */
export const wideLayerNow = () => layerMod;
export function areaFieldsReady() {
  if (table) return Promise.resolve(table);
  if (!tablePending) {
    tablePending = import("./parcelAreaFields.js").then((m) => (table = m.default || {}), (err) => {
      tablePending = null;
      reportClientEvent("parcel-area-fields-load-failed", `the size-column table could not be loaded (${(err && err.message) || err}) — Select parcels keeps today's cutoff for every source`, {});
      return null;
    });
  }
  return tablePending;
}
/** MapFinder awaits THIS before the first display is built: the table AND the wide-view layer (which imports Leaflet, so only the browser asks). */
export function wideViewReady() {
  if (table && layerMod) return Promise.resolve(table);
  if (!pending) {
    pending = Promise.all([areaFieldsReady(), import("./parcelWideLayer.js")]).then(([t, l]) => { layerMod = l; return t; }, (err) => {
      pending = null;
      reportClientEvent("parcel-wide-layer-load-failed", `the wide-view layer could not be loaded (${(err && err.message) || err}) — Select parcels keeps today's cutoff for every source`, {});
      return null;
    });
  }
  return pending;
}
/** Tests / the probe: install a table without the dynamic import. */
export function setAreaFieldsForTest(t) { table = t; pending = null; tablePending = null; }
