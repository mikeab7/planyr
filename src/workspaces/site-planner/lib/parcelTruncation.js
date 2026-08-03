/* lib/parcelTruncation.js — NEW-3.
 *
 * Split out of `parcelDisplay.js` deliberately: that module imports Leaflet and esri-leaflet, so
 * nothing in it can be exercised without a browser. These three functions are the whole DECISION
 * ("did this answer get cut short, and what do we tell the owner?"), so they live where a unit test
 * can reach them — test/parcelSourcePolicy.test.js.
 *
 * ArcGIS answers ANY query with at most the layer's `maxRecordCount` features and sets
 * `exceededTransferLimit` when it had more to give. esri-leaflet's `featureLayer` issues one
 * bbox query per view tile and does NOT page, so a service that truncates draws an
 * authoritative-looking parcel layer with an unknown number of lots silently missing — worse
 * than slow, because a lot the user needs may simply not be there to click.
 *
 * MEASURED (2026-08-03, the owner's browser, the view in the report): ONE view-sized bbox against
 * the Colorado statewide composite returned exactly 2000 features with `exceededTransferLimit`
 * true, in 1,466 ms. Nothing anywhere said so.
 *
 * The two paths that page ALREADY handle this flag correctly and are untouched here — the vector
 * GIS engine (`vectorLayers.js`) and the nightly parcel-snapshot builder
 * (`scripts/build-parcel-snapshot.mjs`, whose Waller undercount is exactly this bug caught once
 * before). The display path cannot page (esri-leaflet owns the request loop), so it takes the
 * honest, non-blocking notice instead — never a silent truncation.
 *
 * Both response shapes are handled because both are real: Esri JSON puts the flag at the top
 * level, GeoJSON output has carried it at the top level AND under `properties` across versions.
 * Pure. */
export function responseWasTruncated(response) {
  if (!response || typeof response !== "object") return false;
  return (
    response.exceededTransferLimit === true ||
    response.transferLimitExceeded === true ||
    !!(response.properties && response.properties.exceededTransferLimit === true)
  );
}

/* How many features the truncated answer actually carried (Esri JSON `features` and GeoJSON
 * `features` are the same key), or 0 when unreadable. Pure. */
export function featureCountOf(response) {
  const f = response && response.features;
  return Array.isArray(f) ? f.length : 0;
}

/* The owner-facing sentence. Names what happened and what to do about it, and stays non-blocking
 * (it rides the same notice strip a slow-source warning uses). Pure. */
export function parcelTruncationNotice(count) {
  const n = Number.isFinite(count) && count > 0 ? count.toLocaleString() : "some";
  return `That parcel service capped this view at ${n} lots — some outlines here are missing. Zoom in to see them all; clicking a lot still adds it.`;
}

