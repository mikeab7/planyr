/* lib/selectParcelsHint.js — NEW-1: the ONE source of the bottom hint's words while Select parcels is on.
 *
 * One short line per stage, nothing else (owner-approved copy, mockup reviewed 2026-10-22):
 *   far     too far out for any outline         → zoom-in icon + "Zoom in to see lots"  (the instruction, medium weight)
 *   large   only the larger lots are drawn      → zoom-in icon + "Large lots only. Zoom in for all."
 *   all     every lot is drawn                  → pointer icon + "Click lots to add or remove"
 * Two honest-failure states keep their own short line (LOUD-FAILURE: a busy county or a slow draw is said, never left as a blank map):
 *   busy    the county server is backing off    → "Parcel server is busy. Showing lots already loaded."
 *   refused a wide-view tile was refused  → "Some lots didn't load. Zoom in to retry." (only while a tile really was refused)
 *   loading outlines still arriving              → "Outlines still loading. Click lots to add or remove"
 * There is NO zoom button: the hint never moves the map (owner: never auto-zoom). Hover-to-remove is no longer taught here; it lives
 * on the Keyboard Shortcuts page ("site.map-remove-lot"). Pure — the component only picks the icon from `icon`. */
import { outlineHoldForView } from "./parcelWideRequest.js";

export const SELECT_PARCELS_HINT = Object.freeze({
  far: Object.freeze({ key: "far", icon: "zoom-in", strong: true, text: "Zoom in to see lots" }),
  large: Object.freeze({ key: "large", icon: "zoom-in", strong: false, text: "Large lots only. Zoom in for all." }),
  all: Object.freeze({ key: "all", icon: "pointer", strong: false, text: "Click lots to add or remove" }),
  busy: Object.freeze({ key: "busy", icon: "zoom-in", strong: false, text: "Parcel server is busy. Showing lots already loaded." }),
  refused: Object.freeze({ key: "refused", icon: "zoom-in", strong: false, text: "Some lots didn't load. Zoom in to retry." }),
  loading: Object.freeze({ key: "loading", icon: "pointer", strong: false, text: "Outlines still loading. Click lots to add or remove" }),
});

/** Which hint applies. `outlineSources` = [{ floor, wide }] for the sources the view needs; with none, `zoom < outlineFloor` is the old
 *  single-cutoff test. `wideBusy` / `wideRefused` / `slowLoading` are the failure states, asked only once the zoom is past "far". Pure. */
export function selectParcelsHintFor({ zoom, outlineSources, outlineFloor, wideBusy = false, wideRefused = false, slowLoading = false }) {
  const hold = (outlineSources && outlineSources.length)
    ? outlineHoldForView(zoom, outlineSources)
    : (zoom != null && zoom < outlineFloor ? "far" : "none");
  if (hold === "far") return SELECT_PARCELS_HINT.far;
  if (hold === "held") return wideBusy ? SELECT_PARCELS_HINT.busy : wideRefused ? SELECT_PARCELS_HINT.refused : SELECT_PARCELS_HINT.large;
  return slowLoading ? SELECT_PARCELS_HINT.loading : SELECT_PARCELS_HINT.all;
}
