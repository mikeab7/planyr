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
 * add/remove.
 *
 * ⛔ NEW-1 (owner decision 2026-09-24) — a real CAD's OWN outline layer now draws in
 * THREE zoom-gated regimes, not one, and there is no more "capped this view at N lots"
 * banner. `parcelDisplayZoom.js` (a plain-Node-testable sibling — this file imports
 * Leaflet + esri-leaflet and so cannot be) is the whole decision; `makeParcelAdaptiveLayer`
 * below is the Leaflet wiring for it. See that module's header for the full rationale —
 * in short: below PARCEL_MINZOOM nothing draws (unchanged from before this item), the
 * server-rendered /export IMAGE layer draws every lot in view from there up to
 * PARCEL_VECTOR_MINZOOM (no record cap, no per-lot cost — what used to trigger the
 * retired banner), and the styleable VECTOR layer takes over above that for per-lot hover.
 * Clicking a lot was ALREADY independent of what's drawn (MapFinder's `handleClick`
 * always identifies via a live point query, never against the display layer) — B1427664
 * already ruled out making clicks wait on a display layer, and nothing here revisits
 * that. */
import * as EL from "esri-leaflet";
import L from "leaflet";
import { STATEWIDE_PARCEL_LAYER } from "./counties.js";
import { getSnapshot, featuresForView, onSnapshotChange } from "./parcelSnapshot.js";
import { guardRasterOpacity } from "./parcelOpacityGuard.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport, MAPSERVER_LAYER_RE } from "./parcelDisplayZoom.js";

export { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport };

// `opts` overrides the defaults below (e.g. a tighter `minZoom` for the "close" regime of
// `makeParcelAdaptiveLayer`); every existing single-argument caller is unaffected.
export function makeParcelLayer(url, opts) {
  return EL.featureLayer({
    url,
    minZoom: PARCEL_MINZOOM,
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map/canvas for add/remove
    style: () => ({ color: "#a21caf", weight: 1.3, opacity: 0.95, fillOpacity: 0 }),
    ...opts,
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
export function makeParcelImageLayer(url, opts) {
  const m = MAPSERVER_LAYER_RE.exec(trimUrl(url));
  if (!m) return makeParcelLayer(url);
  const [, service, id] = m;
  return guardRasterOpacity(EL.dynamicMapLayer({
    url: service,
    layers: [Number(id)],
    minZoom: PARCEL_MINZOOM,
    opacity: 1,
    f: "image",
    ...opts,
  }));
}

/* NEW-1 — a real, queryable CAD's outline display: the vector layer above from
 * PARCEL_VECTOR_MINZOOM up (close), the server-rendered image layer from PARCEL_MINZOOM up
 * to there (wide), nothing below PARCEL_MINZOOM (far). Both sublayers are mounted at once —
 * esri-leaflet's own FeatureManager/RasterLayer already re-check `options.minZoom`/`maxZoom`
 * against the live map zoom on every zoomend and add/clear themselves accordingly, so the
 * regime tracks the view with no listener or rebuild of ours. `eachFeature` — the one thing
 * `MapFinder.optimisticHitAt` needs off a parcel display, for the instant highlight-before-
 * the-authoritative-identify — delegates to the vector sublayer, which esri-leaflet already
 * empties out whenever it's outside its own zoom range, so an optimistic hit is naturally
 * only ever offered in the "close" regime; "wide" and "far" fall through to the ordinary
 * (still fully working) identify query, same as a statewide-image view always has.
 *
 * A source with no /export capability (a FeatureServer CAD, e.g. Fort Bend) has no image
 * regime to switch to, so it stays exactly what it was before this item: one vector layer,
 * gated at PARCEL_MINZOOM. */
export function makeParcelAdaptiveLayer(url) {
  if (!parcelUrlSupportsImageExport(url)) return makeParcelLayer(url);
  // The two bands MEET (vector's floor equals the image's ceiling) rather than merely
  // abut, so there is no zoom gap where neither draws — Leaflet zoom can be fractional
  // mid-gesture (B1449 smooth zoom), and a strict `image <17, vector >=17` split would
  // leave e.g. zoom 16.5 with nothing visible at all.
  const vectorLayer = makeParcelLayer(url, { minZoom: PARCEL_VECTOR_MINZOOM });
  const imageLayer = makeParcelImageLayer(url, { maxZoom: PARCEL_VECTOR_MINZOOM });
  const group = L.layerGroup([vectorLayer, imageLayer]);
  group._isAdaptive = true;
  group._vectorLayer = vectorLayer;
  group._imageLayer = imageLayer;
  group.eachFeature = (fn, context) => vectorLayer.eachFeature(fn, context);
  return group;
}

/* The one entry point both parcel-display surfaces (the map's Select-parcels tool and
 * the in-planner Add-parcel outline) use, so they stay identical: a query-disabled
 * statewide source renders as an image overlay (unchanged — its /query is disabled at
 * every zoom, not just a wide one), every queryable CAD as the three-regime adaptive
 * layer above (which also backs the instant client-side click highlight while close-in). */
export function makeParcelDisplayLayer(url) {
  return parcelDisplayIsImageOnly(url) ? makeParcelImageLayer(url) : makeParcelAdaptiveLayer(url);
}

/* Draw a county's outlines from its Drive PARCEL SNAPSHOT (B629) as a styleable vector layer —
 * the same magenta `L.geoJSON` shape as `makeParcelLayer`, so the existing `optimisticHitAt`
 * hit-test (which iterates `eachFeature`) selects a lot from it with NO new click logic, and it
 * renders + clicks even when the live county server is fully down. Only the viewport's parcels are
 * drawn (bbox-filtered) so a whole county never paints at once, and it re-fills on pan/zoom and
 * when a fresher snapshot loads. Empty until `ensureSnapshot(county)` has warmed the data. */
export function makeSnapshotLayer(county) {
  const layer = L.geoJSON(null, {
    interactive: false, // purely visual; clicks fall through to the map/canvas (like makeParcelLayer)
    style: () => ({ color: "#a21caf", weight: 1.3, opacity: 0.95, fillOpacity: 0 }),
  });
  layer._isSnapshot = true;
  layer._snapshotCounty = county;
  let mapRef = null, unsub = null;
  const refresh = () => {
    if (!mapRef) return;
    layer.clearLayers();
    if (mapRef.getZoom() < PARCEL_MINZOOM) return; // too many to draw across a whole county at once
    const snap = getSnapshot(county);
    if (!snap || !snap.features) return;
    const b = mapRef.getBounds();
    const feats = featuresForView(snap.features, { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() });
    if (feats.length) layer.addData({ type: "FeatureCollection", features: feats });
  };
  layer.on("add", () => {
    mapRef = layer._map;
    if (mapRef) mapRef.on("moveend zoomend", refresh);
    unsub = onSnapshotChange((c) => { if (c === county) refresh(); });
    refresh();
  });
  layer.on("remove", () => {
    if (mapRef) mapRef.off("moveend zoomend", refresh);
    if (unsub) unsub();
    mapRef = null; unsub = null;
  });
  return layer;
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
export const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
export const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
