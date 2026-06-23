/* Shared parcel-outline display helpers — used by BOTH the map finder (whole-county
 * select) and the in-planner "Add parcel → Identify from county GIS" tool, so the two
 * surfaces light up parcels identically (one source of truth, not two).
 *
 * The outlines are drawn as styleable vector lines via esri-leaflet's featureLayer
 * (the SAME query path that powers click-to-select), not a server image — so they
 * render reliably. `interactive:false` keeps them purely visual; clicks fall through
 * to the map/canvas for add/remove. They load once zoomed in past PARCEL_MINZOOM
 * (too many to draw across a whole county at once); click-to-add still works at any
 * zoom because that's a point query, not a draw. */
import * as EL from "esri-leaflet";

// Low enough to outline big rural/industrial tracts from further out, high enough to
// avoid drawing a whole dense-urban county at once.
export const PARCEL_MINZOOM = 14;

export function makeParcelLayer(url) {
  return EL.featureLayer({
    url,
    minZoom: PARCEL_MINZOOM,
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map/canvas for add/remove
    style: () => ({ color: "#a21caf", weight: 1.3, opacity: 0.95, fillOpacity: 0 }),
  });
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
export const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
export const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
