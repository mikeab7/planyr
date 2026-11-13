/* NEW-1 (2026-11-12, cross-user `client_errors`: "Cannot read properties of null (reading 'removeLayer')",
 * stack `_overlayOnError → fire → i.P` in `map-vendor`) — THE RASTER ERROR PATH, closed at the SAME seam.
 * esri-leaflet 3.0.19 `RasterLayer._renderImage` registers `onOverlayError = function () { this._map.removeLayer(image); … }`
 * with NO `this._map` guard (its sibling `onOverlayLoad` has `if (this._map)`). The image is created and added
 * synchronously inside `_renderImage`, but the request that fails comes back LATER — so a row switched off, or a plan
 * switched, while an /export image is in flight leaves an error landing on a layer whose `_map` is already null, and
 * the throw happens inside Leaflet's event loop. We cannot edit the closure, so right after `_renderImage` returns we
 * find the Overlay it just added (a `layeradd` listener held for exactly that call — O(1), no scan of the map's
 * layers), drop esri's unguarded "error" listener and register an equivalent that never dereferences a null map:
 * remove the image if it is still on a map, fire the layer's "error" (status wiring still hears it), and drop the
 * pending load listener. Same behaviour otherwise.
 *
 * ONE wrapper per layer: the orphan-image handling below (guardRasterOpacity) and this error guard share the single
 * `_renderImage` wrapper via `install`; `guardRasterErrors` is the error-only entry for layers.js's raster layers. */
const GUARD = "__planyrRasterGuard";

function guardOverlayError(layer, overlay) {
  if (!overlay || typeof overlay.on !== "function" || typeof overlay.off !== "function") return;
  overlay.off("error"); // esri-leaflet's own listener (the overlay has no other "error" listener)
  const onLoad = () => { overlay.off("error", onError); overlay.off("load", onLoad); };
  function onError() {
    overlay.off("error", onError);
    overlay.off("load"); // esri's pending load listener, and ours
    const m = overlay._map; // the map the IMAGE is still on — null once the layer's teardown already removed it
    if (m) m.removeLayer(overlay);
    layer.fire("error");
  }
  overlay.on("error", onError);
  overlay.on("load", onLoad);
}

function install(layer) {
  if (layer[GUARD]) return layer[GUARD];
  const state = { opacity: false, pending: new Set() }; // pending: DOM <img> nodes whose load hasn't resolved yet
  layer[GUARD] = state;
  const origRenderImage = layer._renderImage;
  layer._renderImage = function (url, bounds, contentType) {
    const map = this._map;
    let overlay = null;
    const onAdd = (e) => { if (!overlay && e && e.layer && e.layer._image) overlay = e.layer; };
    const listen = !!map && typeof map.on === "function" && typeof map.off === "function";
    if (listen) map.on("layeradd", onAdd);
    try {
      origRenderImage.call(this, url, bounds, contentType);
    } finally {
      if (listen) map.off("layeradd", onAdd);
    }
    guardOverlayError(this, overlay);
    if (state.opacity) {
      // The Overlay is created and .addTo()'d SYNCHRONOUSLY inside _renderImage, so by the time
      // the call above returns, its <img> already exists as the pane's newest matching child.
      const pane = typeof this.getPane === "function" ? this.getPane() : null;
      const imgs = pane ? pane.querySelectorAll("img.leaflet-image-layer") : null;
      const img = imgs && imgs.length ? imgs[imgs.length - 1] : null;
      if (img) state.pending.add(img);
    }
  };
  return state;
}

/* Error-only entry: every esri raster layer (dynamicMapLayer / imageMapLayer) built by layers.js. */
export function guardRasterErrors(layer) {
  install(layer);
  return layer;
}


/* NEW-1 (parcel outline opacity race) — split out of parcelDisplay.js for the same reason
 * `terrainGate.js`/`adminBoundaryData.js`/`floodTileDecode.js` were split from their Leaflet-glue
 * siblings: this module touches only the LAYER OBJECT it's handed (duck-typed — `_renderImage`,
 * `onRemove`, `on`, `getPane`, `_currentImage`, `_map`, `options.opacity`), never `window` or
 * `document` directly, so it can run and be unit-tested in plain Node against fakes. Importing
 * `esri-leaflet`/`leaflet` themselves throws ("window is not defined") outside a browser, which
 * is exactly why `parcelDisplay.js` (which does import them) can't be.
 *
 * THE DEFECT THIS CLOSES. esri-leaflet's RasterLayer (`_renderImage`, esri-leaflet 3.0.19) fades
 * a fresh /export image in from opacity 0 to visible ONLY if the map's bounds at the moment the
 * image finishes loading exactly equal the bounds it was requested for. Confirmed live
 * (`ui-audit/verify-parcel-outline-opacity.mjs`): if the LAYER itself is removed
 * (`map.removeLayer(fl)`) while that /export request is still in flight — which every one of
 * this app's own display-teardown paths does sooner or later (leaving select mode, closing the
 * in-planner identify tool, a shared/aliased layer's last reference going away) — the
 * freshly-created `<img>` is orphaned: esri-leaflet adds it straight to the map, bypassing the
 * layer's own tracked `_currentImage`, so the layer's `onRemove` cleanup never sees it. It sits
 * fully loaded, correctly positioned, and stuck at opacity 0 forever — the layer's own "load"
 * event still fires afterward (Leaflet's `Evented` listeners survive removal) but nothing was
 * listening for "the layer that owned this image is already gone".
 *
 * One instance of this reached production: MapFinder's `removeDisplay` used to destroy a shared
 * statewide-URL layer whenever the "owner" key (an accident of async resolve order — e.g.
 * `waller`, whose live source IS the statewide composite, racing `txgio_statewide` itself) was
 * removed, even with a still-live alias depending on it — fixed separately in `MapFinder.jsx` by
 * having ownership hand off instead of tearing the layer down. But the orphan class is bigger
 * than that one trigger (any full teardown of a display layer mid-flight reproduces it), so it
 * is closed here too, at the one place every parcel image layer is built, rather than chased at
 * each call site. Keep what you SEE == what you can SELECT (B137). */
export function guardRasterOpacity(layer) {
  const state = install(layer);
  state.opacity = true;
  const pending = state.pending;
  const origOnRemove = layer.onRemove;
  layer.onRemove = function (map) {
    pending.forEach((img) => {
      if (!img.isConnected) return;
      // Not this layer's OWN current (already-shown) image — leave that to esri-leaflet's own
      // cleanup below. Find the orphan's own Leaflet layer object (its DOM node is all we kept
      // a handle to) and remove it properly rather than yanking the node out from under Leaflet.
      if (this._currentImage && this._currentImage._image === img) return;
      map.eachLayer((l) => { if (l._image === img) { try { map.removeLayer(l); } catch (_) {} } });
    });
    pending.clear();
    return origOnRemove.call(this, map);
  };
  // Defense-in-depth: a "load" whose image is still exactly right for the CURRENT view but
  // whose opacity didn't get raised (the equality check above is gated on bit-for-bit bounds
  // equality, which any moveend racing a slow response can defeat) is self-healed here — never
  // for a stale image esri-leaflet had already decided to discard.
  layer.on("load", () => {
    const cur = layer._currentImage;
    if (cur && cur._image) pending.delete(cur._image);
    if (!layer._map || !cur || !cur._map) return;
    try {
      if (cur._bounds.equals(layer._map.getBounds())) cur.setOpacity(layer.options.opacity);
    } catch (_) { /* best effort — never let a self-heal throw into the caller's event */ }
  });
  return layer;
}
