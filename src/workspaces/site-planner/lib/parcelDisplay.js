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
 * ⛔ AMENDED 2026-10-04 (NEW-1, owner decision): PLANYR OWNS THE OUTLINES AND THE LOT NUMBERS. The
 * "wide" server-image regime described next is GONE for every queryable CAD — a county's own /export
 * picture (its colours, its baked-in labels) is never mounted; only the statewide image-only source
 * still draws a picture, and it is requested without labels in Planyr's colour. See
 * `parcelDisplayZoom.js`'s amendment and `parcelLotNumbers.js` / `parcelLotLabelLayer.js`.
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
import { STATEWIDE_PARCEL_LAYER, displayMinZoomForUrl, lotNumberFieldForUrl } from "./counties.js";
import { attachLotNumbers } from "./parcelLotLabelLayer.js";
import { getSnapshot, featuresForView, onSnapshotChange } from "./parcelSnapshot.js";
import { pruneToLiveCells } from "./parcelPrune.js";
import { guardRasterOpacity } from "./parcelOpacityGuard.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport, MAPSERVER_LAYER_RE, PARCEL_OUTLINE_COLOR, PARCEL_OUTLINE_WEIGHT, plainOutlineDynamicLayers } from "./parcelDisplayZoom.js";

export { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport };

// `opts` overrides the defaults below (e.g. a tighter `minZoom` for the "close" regime of
// `makeParcelAdaptiveLayer`); every existing single-argument caller is unaffected.
export function makeParcelLayer(url, opts) {
  /* NEW-1 (2026-10-04) — Planyr draws the lot NUMBERS too. `lotNumberHint` (default: the county's
   * `lotNumberField`/`idField` for this URL) names the attribute; `labels:false` opts out;
   * `getObstacles` hands the label engine the screen boxes a number must clear (the Site planner's
   * parcel chips). None of these are esri-leaflet options, so they are split off before the spread. */
  const { lotNumberHint, labels, getObstacles, getInset, ...layerOpts } = opts || {};
  const lotHint = labels === false ? null : (lotNumberHint !== undefined ? lotNumberHint : lotNumberFieldForUrl(url));
  /* B1976336 — TWO MEASURED COSTS, both found on Michael's Bartow view (17,282 <path> nodes held
   * after ONE zoom step, only 27 distinct `d`, tab unresponsive for 30 s):
   *  · a CANVAS renderer instead of one SVG <path> per lot: thousands of outlines become one bitmap
   *    (no DOM node per parcel). `interactive:false` and the client-side hit test (`eachFeature` →
   *    geometry) are untouched, so click-to-select is unchanged (B137). The renderer leaves the map
   *    with the layer so no empty canvas is left behind.
   *  · `pruneToLiveCells` — esri-leaflet 3.0.19 NEVER releases a feature once fetched: `cellLeave`
   *    only removes when `!_activeCells[key]`, but `_removeCell` sets `_activeCells[key]` (for reuse)
   *    just before calling it, so the test can never pass, and `cacheLayers:false` therefore changes
   *    nothing (measured). A zoom-out/zoom-in cycle accumulated the union of every tile ever fetched.
   *    After each move we drop every feature that belongs only to cells that are no longer current,
   *    and forget those cells so they are re-requested if the view returns. Features held track the
   *    view. */
  const renderer = L.canvas({ padding: 0.3 });
  const layer = EL.featureLayer({
    url,
    minZoom: Math.max(PARCEL_MINZOOM, displayMinZoomForUrl(url)), // NEW-2 — a source that cannot answer a dense cell inside its record cap declares a higher floor
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map/canvas for add/remove
    renderer,
    style: () => ({ color: PARCEL_OUTLINE_COLOR, weight: PARCEL_OUTLINE_WEIGHT, opacity: 0.95, fillOpacity: 0 }),
    ...layerOpts,
  });
  if (lotHint) layer._lotNumbers = attachLotNumbers(layer, { hint: lotHint, getObstacles, getInset });
  let mapRef = null;
  let timer = null;
  const prune = () => { timer = null; if (layer._map) pruneToLiveCells(layer); };
  const onMoved = () => { if (timer) clearTimeout(timer); timer = setTimeout(prune, 0); };
  layer.on("add", () => { mapRef = layer._map; if (mapRef) mapRef.on("moveend zoomend", onMoved); });
  layer.on("remove", () => {
    if (mapRef) mapRef.off("moveend zoomend", onMoved);
    mapRef = null;
    if (timer) { clearTimeout(timer); timer = null; }
    try { renderer.remove(); } catch (_) {}
  });
  return layer;
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
 * vector layer if the URL isn't a MapServer layer (a FeatureServer can't /export).
 *
 * NEW-1 (2026-10-04) — Planyr owns the look: the request goes out with `dynamicLayers` set to Planyr's
 * outline colour and labels OFF, so the one remaining county-side picture carries neither the server's
 * own colour nor any labels it would otherwise bake in. (`layers` is deliberately not sent as well —
 * `dynamicLayers` is the whole layer definition for the request.) */
export function makeParcelImageLayer(url, opts) {
  const m = MAPSERVER_LAYER_RE.exec(trimUrl(url));
  if (!m) return makeParcelLayer(url);
  const [, service, id] = m;
  return guardRasterOpacity(EL.dynamicMapLayer({
    url: service,
    dynamicLayers: plainOutlineDynamicLayers(id),
    minZoom: PARCEL_MINZOOM,
    opacity: 1,
    f: "image",
    ...opts,
  }));
}

/* A real, queryable CAD's outline display (NEW-1, 2026-10-04 — Planyr owns outlines AND lot numbers):
 * ONE look in every county. Planyr's own vector outline (+ its own lot numbers) is the ONLY thing drawn;
 * a county's server-rendered /export picture is never mounted for a queryable CAD. A MapServer CAD's
 * vector floor is PARCEL_VECTOR_MINZOOM (`displayMinZoomForUrl` — the wide band draws nothing for it:
 * no cheap way was found to draw vectors there without hitting `maxRecordCount`), a FeatureServer's is
 * PARCEL_MINZOOM, exactly as before. `eachFeature` — the one thing `MapFinder.optimisticHitAt` needs off
 * a parcel display for the instant highlight-before-the-authoritative-identify — is the vector layer's
 * own. B137 holds: what is drawn is a subset of what a live point query can select. */
export function makeParcelAdaptiveLayer(url, opts) {
  return makeParcelLayer(url, opts);
}

/* The one entry point both parcel-display surfaces (the map's Select-parcels tool and
 * the in-planner Add-parcel outline) use, so they stay identical: a query-disabled
 * statewide source renders as an image overlay (unchanged — its /query is disabled at
 * every zoom, not just a wide one), every queryable CAD as the three-regime adaptive
 * layer above (which also backs the instant client-side click highlight while close-in). */
export function makeParcelDisplayLayer(url, opts) {
  return parcelDisplayIsImageOnly(url) ? makeParcelImageLayer(url) : makeParcelAdaptiveLayer(url, opts);
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
    style: () => ({ color: PARCEL_OUTLINE_COLOR, weight: PARCEL_OUTLINE_WEIGHT, opacity: 0.95, fillOpacity: 0 }),
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
