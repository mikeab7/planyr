/* Shared parcel-outline display helpers — used by BOTH the map finder (whole-county
 * select) and the in-planner "Add parcel → Identify from county GIS" tool, so the two
 * surfaces light up parcels identically (one source of truth, not two).
 *
 * A queryable CAD's outlines are drawn as styleable vector lines via esri-leaflet's
 * featureLayer (the SAME query path that powers click-to-select), so the lot under the
 * cursor is already client-side geometry for an instant highlight. The one exception is
 * the TxGIO statewide source, whose layer /query is disabled upstream (it 400s) — a
 * vector layer would draw nothing there, so `makeParcelDisplayLayer` renders THAT source
 * as a server /export image overlay instead (and the click path has a matching
 * /query→/identify fallback, so what you SEE stays what you can SELECT). `interactive:
 * false` keeps outlines purely visual; clicks fall through to the map/canvas for
 * add/remove. They load once zoomed in past PARCEL_MINZOOM (too many to draw across a
 * whole county at once); click-to-add still works at any zoom because that's a point
 * query, not a draw. */
import * as EL from "esri-leaflet";
import { STATEWIDE_PARCEL_LAYER } from "./counties.js";

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

const trimUrl = (u) => String(u || "").replace(/\/+$/, "");

/* The one parcel source whose layer /query is disabled upstream: the TxGIO statewide
 * parcels MapServer (Chambers County's source + every county's outage fallback). A
 * vector featureLayer renders by QUERYING, so it draws nothing there — a blank Chambers
 * with no lines. The service's /export (image) op still works, so that source must be
 * drawn as a server-rendered image overlay instead. Matched by URL so a hand-pasted
 * override or a real, queryable CAD is never diverted. Pure. */
export function parcelDisplayIsImageOnly(url) {
  return trimUrl(url) === trimUrl(STATEWIDE_PARCEL_LAYER);
}

/* Draw a query-disabled parcel MapServer (see above) as a server-rendered image overlay
 * (esri dynamicMapLayer → /export) rather than a query-based vector featureLayer. Takes
 * the same /MapServer/<id> layer URL and targets that one sublayer; keeps the
 * PARCEL_MINZOOM gate so a statewide layer never paints at metro scale. Falls back to the
 * vector layer if the URL isn't a MapServer layer (a FeatureServer can't /export). */
export function makeParcelImageLayer(url) {
  const m = /^(.*\/MapServer)\/(\d+)\/?$/i.exec(trimUrl(url));
  if (!m) return makeParcelLayer(url);
  const [, service, id] = m;
  return EL.dynamicMapLayer({
    url: service,
    layers: [Number(id)],
    minZoom: PARCEL_MINZOOM,
    opacity: 1,
    f: "image",
  });
}

/* The one entry point both parcel-display surfaces (the map's Select-parcels tool and
 * the in-planner Add-parcel outline) use, so they stay identical: a query-disabled
 * statewide source renders as an image overlay, every queryable CAD as the styleable
 * vector layer (which also backs the instant client-side click highlight). */
export function makeParcelDisplayLayer(url) {
  return parcelDisplayIsImageOnly(url) ? makeParcelImageLayer(url) : makeParcelLayer(url);
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
export const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
export const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
