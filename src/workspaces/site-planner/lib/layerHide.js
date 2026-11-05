/* Hide Layers — the SESSION-ONLY "take every reference layer off the map" switch (NEW-1, Imagery &
 * Layers redesign).
 *
 * TEMPORARY and NON-DESTRUCTIVE by construction: this is a boolean in a module-level store, nothing
 * else. It is never persisted, never written into `overlays`, `layerOverrides` or the site model —
 * the map reads it through `drawnOverlaysOf` (layerPanelModel.js), which treats a checked row as off
 * only while this is true. Show Layers flips it back and the exact same set draws again, because
 * nothing about the set was ever changed.
 *
 * One store for the whole app (not per surface): the planner and the map finder each mount a panel
 * over the same app-shared overlay state, so one pill answers for both. */
import { useSyncExternalStore } from "react";

let hidden = false;
const subs = new Set();

export const getLayersHidden = () => hidden;
export function setLayersHidden(v) {
  const next = !!v;
  if (next === hidden) return hidden;
  hidden = next;
  subs.forEach((cb) => { try { cb(); } catch (_) { /* a subscriber must never break the write */ } });
  return hidden;
}
export function subscribeLayersHidden(cb) { subs.add(cb); return () => subs.delete(cb); }
export const useLayersHidden = () => useSyncExternalStore(subscribeLayersHidden, getLayersHidden, getLayersHidden);
export function _resetLayersHidden() { hidden = false; subs.clear(); } // tests only
