/* lib/parcelDisplayZoom.js — NEW-1.
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
