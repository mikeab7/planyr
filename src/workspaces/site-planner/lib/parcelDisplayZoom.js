/* lib/parcelDisplayZoom.js — NEW-1.
 *
 * ⛔ AMENDED 2026-10-04 (NEW-1, owner decision after the Grand Port follow-up) — PLANYR OWNS THE
 * OUTLINES. The "wide" regime below used to draw a county's own server /export PICTURE for every
 * MapServer county, which carried the county's colours and its own baked-in lot numbers (Chambers'
 * '1532567588' west of the pond, under Planyr's "Parcel 19" chip). It no longer does:
 *   - a QUERYABLE CAD (MapServer or FeatureServer) draws ONLY Planyr's vector outline, in Planyr's
 *     one colour; a MapServer CAD's vector floor is PARCEL_VECTOR_MINZOOM (it has no cheap way to
 *     draw vectors further out without hitting its record cap — B1976336 / `maxRecordCount`), so
 *     the wide band draws NOTHING for it; a FeatureServer keeps its PARCEL_MINZOOM floor;
 *   - the ONE remaining picture is the statewide image-only source (TxGIO — /query disabled
 *     upstream), the one area with no queryable source. It is requested WITHOUT labels and in
 *     Planyr's outline colour via `dynamicLayers` (`plainOutlineDynamicLayers`).
 * Read "wide" below as: the band in which ONLY that statewide image can draw.
 *
 * Split out of `parcelDisplay.js` for the same reason `parcelOpacityGuard.js` is: that module
 * imports Leaflet + esri-leaflet, so nothing in it can run outside a browser. This is the whole
 * DECISION behind the three-regime parcel display — which zoom band draws what — so it belongs
 * where a plain Node test can reach it.
 *
 * THE THREE REGIMES (owner decision 2026-09-24, retiring the "capped this view at N lots"
 * banner and the vector-only display behind it — NEW-1):
 *   - far   (below PARCEL_MINZOOM)              — draw nothing. Too many lots to mean anything
 *                                                  on screen, and pointless to even try.
 *   - wide  (PARCEL_MINZOOM..PARCEL_VECTOR_MINZOOM) — the server-rendered `/export` image layer
 *                                                  (`makeParcelImageLayer`) — every lot in view,
 *                                                  no per-lot render cost, no record cap.
 *   - close (PARCEL_VECTOR_MINZOOM and above)    — the styleable vector outline layer
 *                                                  (`makeParcelLayer`) — per-lot shapes + hover.
 *
 * PARCEL_MINZOOM was already the draw-nothing floor (it gates the ONLY layer a view ever drew
 * before this) — reused verbatim, not re-derived. PARCEL_VECTOR_MINZOOM is new: the boundary
 * below which a real CAD's vector query risks exceeding the source's own `maxRecordCount` (ArcGIS
 * answers any query with at most that many features — 1,000 on some sources, 2,000 on others —
 * and silently drops the rest for a non-paging display query; see `parcelDisplay.js`'s own
 * header). Clicking a lot never depends on either regime: `MapFinder.handleClick` always
 * identifies via a point query against the county's live service, never against what happened to
 * be drawn (the B137 invariant — what you SEE is a subset of, never a precondition for, what you
 * can SELECT).
 *
 * Picking ONE zoom boundary is necessarily an approximation — the same zoom covers a handful of
 * hundred-acre rural tracts in one county and thousands of quarter-acre urban lots in another —
 * but the two regimes it separates are equally correct at any density: the image layer always
 * shows every lot in view, and the vector layer only ever draws MORE than the image layer when
 * it isn't at risk of being cut short. `PARCEL_VECTOR_MINZOOM` is deliberately a single named
 * constant, not one derived per county, so it stays easy to retune from one live-verified number.
 */

// The far floor — reused verbatim from the pre-existing single-layer behavior.
export const PARCEL_MINZOOM = 14;

/* The close-in floor — vector outlines below this risk exceeding a real CAD's maxRecordCount.
 * 16, not 17: `MapFinder.jsx`'s own `SITE_PLAN_VIEW_ZOOM` (the fixed zoom "Show on map" and a
 * few other site-focus flyTos land on) is 17, and a geocoded-address flyTo lands on 18 — so 16
 * leaves the app's own most common "I'm looking AT one site" zooms cleanly inside "close" with a
 * full zoom level of headroom, rather than sitting exactly on the wide/close boundary where both
 * sublayers would be considered in range at once (found by driving the real app headlessly —
 * `ui-audit/verify-parcel-display-regimes.mjs` — not assumed). */
export const PARCEL_VECTOR_MINZOOM = 16;

/** Which of the three regimes a given map zoom falls into. Pure; `zoom` may be `null`/`undefined`
 * (no map yet) or fractional (mid-gesture smooth zoom, B1449) — both read as "far" rather than
 * throwing. */
export function parcelDisplayRegimeForZoom(zoom) {
  if (zoom == null || !Number.isFinite(zoom) || zoom < PARCEL_MINZOOM) return "far";
  if (zoom < PARCEL_VECTOR_MINZOOM) return "wide";
  return "close";
}

/* A /MapServer/<id> layer can be rendered as a server /export image; a /FeatureServer layer
 * cannot (no /export op). Pure string test, lifted out of `parcelDisplay.js` (Leaflet-dependent)
 * so it can be unit-tested alongside the regime it feeds: a source that fails this can only ever
 * offer the "close" (vector) regime, never "wide" — see `makeParcelAdaptiveLayer`. */
export const MAPSERVER_LAYER_RE = /^(.*\/MapServer)\/(\d+)\/?$/i;
export function parcelUrlSupportsImageExport(url) {
  return MAPSERVER_LAYER_RE.test(String(url || "").replace(/\/+$/, ""));
}

/* ONE outline colour for every Planyr-drawn parcel line, the statewide image's server-side
 * recolour, and the lot numbers — so a county never shows a look of its own. */
export const PARCEL_OUTLINE_COLOR = "#a21caf"; // design-exempt: the one parcel-outline colour — canvas strokes, a server-image request and DOM label ink cannot use var(); same value as parcelTileLayer.PARCEL_OUTLINE_STYLE
export const PARCEL_OUTLINE_RGB = [162, 28, 175];
export const PARCEL_OUTLINE_WEIGHT = 1.3;

/* The one floor a queryable MapServer CAD may draw vectors from (see the amendment above).
 * A FeatureServer (or any non-MapServer URL) has no image regime to hand over to, so it stays at
 * PARCEL_MINZOOM; the image-only statewide source is exempt — it draws its image from there. */
export const parcelVectorFloorFor = (url) =>
  (parcelUrlSupportsImageExport(url) ? PARCEL_VECTOR_MINZOOM : PARCEL_MINZOOM);

/* `dynamicLayers` for an /export of ONE sublayer: Planyr's outline colour, no fill, and labels
 * OFF. A county server's /export otherwise paints with its own drawingInfo — its own colour and,
 * where it publishes labelingInfo, its own lot numbers. Verified live 2026-10-04 on the TxGIO
 * StratMap MapServer (supportsDynamicLayers: true): the same view re-rendered magenta. Returns
 * the JSON string esri-leaflet passes through as the `dynamicLayers` export parameter. */
export function plainOutlineDynamicLayers(layerId) {
  const id = Number(layerId);
  return JSON.stringify([{
    id,
    source: { type: "mapLayer", mapLayerId: id },
    drawingInfo: {
      showLabels: false,
      renderer: {
        type: "simple",
        symbol: {
          type: "esriSFS",
          style: "esriSFSNull",
          color: [0, 0, 0, 0],
          outline: { type: "esriSLS", style: "esriSLSSolid", color: [...PARCEL_OUTLINE_RGB, 242], width: PARCEL_OUTLINE_WEIGHT },
        },
      },
    },
  }]);
}

/* Is this display layer INSIDE the zoom range it can draw in right now? Duck-typed (a Leaflet layer's `_map`
 * and `options.minZoom`) so the health guards that need it stay Leaflet-free and Node-testable.
 *
 * ⛔ WHY THIS EXISTS (V1475200 live FAIL, 2026-10-04). esri-leaflet fires `requeststart` for a layer's own
 * metadata read the moment it is ADDED, at any zoom — but a layer below its `minZoom` then requests no cells
 * and so never fires `load`. A hang-guard that armed on that first `requeststart` therefore declared a
 * perfectly healthy county DOWN eight seconds after it was mounted below its floor, replaced it with the
 * statewide picture, and — `down` being sticky — never mounted it again after the view zoomed in. A guard
 * for "a request is outstanding and not answering" may only arm when the layer could actually be asked
 * for data. Unknown zoom or floor reads as IN range, so a layer this cannot judge keeps the old behaviour. */
export function layerInDrawRange(layer) {
  const m = layer && layer._map;
  if (!m || typeof m.getZoom !== "function") return true;
  const z = m.getZoom();
  const floor = Number(layer.options && layer.options.minZoom);
  if (!Number.isFinite(z) || !Number.isFinite(floor)) return true;
  return z >= floor;
}
