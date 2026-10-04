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
import { STATEWIDE_PARCEL_LAYER, displayMinZoomForUrl } from "./counties.js";
import { getSnapshot, featuresForView, onSnapshotChange } from "./parcelSnapshot.js";
import { pruneToLiveCells } from "./parcelPrune.js";
import { ParcelIndex, drawParcelTile, prepareParcel, tileLngLatBounds, PARCEL_OUTLINE_STYLE } from "./parcelTileLayer.js";
import { guardRasterOpacity } from "./parcelOpacityGuard.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport, MAPSERVER_LAYER_RE } from "./parcelDisplayZoom.js";

export { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport };

/* NEW-1 — a held outline is a `ParcelGhost`, not a Leaflet Path. A Path registers `zoom: _project` and
 * `moveend: _update` on the map, so every held lot was re-projected, re-clipped and re-simplified on every
 * settle — 75–94 ms at z14 on Michael's Bartow view (16,702 held). A ghost keeps the two things every
 * consumer reads off a display layer's children (`.feature` for the hit-test / hover / export, and
 * `getBounds()`), registers no map events, and is never put on the Leaflet map at all (see the
 * createLayers/addLayers/removeLayers overrides in makeParcelLayer): it joins/leaves the tile index when
 * esri-leaflet would have added/removed it, so a zoom that drops 10k lots is 10k Set deletes, not 10k
 * `map.removeLayer` calls (each firing events). The picture comes from `ParcelTiles` below. See parcelTileLayer.js. */
const ParcelGhost = L.Layer.extend({
  initialize(geojson, index, onChange) {
    this.feature = geojson;
    this.options = {};
    const prepared = prepareParcel(geojson.geometry);
    this.bbox = prepared.bbox;
    this.rings = prepared.rings;
    this._index = index;
    this._onChange = onChange;
  },
  getBounds() {
    const b = this.bbox;
    return b ? L.latLngBounds([b[1], b[0]], [b[3], b[2]]) : L.latLngBounds([]);
  },
  addEventParent() { return this; }, // nothing listens to a lot's own events (interactive:false); skips a per-lot parent link
  setStyle() { return this; }, // style is one constant for the whole layer, drawn per tile
  attach() { if (this._drawn) return; this._drawn = true; this._index.add(this); this._onChange(this.bbox); },
  detach() { if (!this._drawn) return; this._drawn = false; this._index.delete(this); this._onChange(this.bbox); },
  isDrawn() { return !!this._drawn; },
});

/* One cached canvas per map tile, drawn from the index (a bbox reject, then only that tile's lots are
 * projected). A pan reuses tiles already drawn; a zoom settle draws only the tiles it has not. Lots that
 * arrive or leave later repaint just the tiles they touch, coalesced to one pass per frame. Lives in the
 * overlay pane so it sits exactly where the old canvas renderer did. */
const ParcelTiles = L.GridLayer.extend({
  initialize(index, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._parcelIndex = index;
    this._dirty = null;
    this._flushTimer = null;
    this._pool = []; // canvases from tiles Leaflet dropped — a zoom settle reuses them instead of allocating ~dozens
  },
  createTile(coords) {
    const tile = this._pool.pop() || L.DomUtil.create("canvas", "leaflet-tile");
    this._paint(tile, coords);
    return tile;
  },
  _removeTile(key) {
    const t = this._tiles[key];
    L.GridLayer.prototype._removeTile.call(this, key);
    if (t && t.el && this._pool.length < 64) this._pool.push(t.el);
  },
  _paint(tile, coords) {
    if (typeof window !== "undefined" && window.__PLANYR_E2E) window.__parcelTileStats = Object.assign(window.__parcelTileStats || { paints: 0, dirty: 0, flushes: 0 }, { paints: ((window.__parcelTileStats || {}).paints || 0) + 1 }); // E2E-only counter: the settle harness asserts a no-op moveend repaints nothing
    const size = this.getTileSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (tile.width !== size.x * dpr) { tile.width = size.x * dpr; tile.height = size.y * dpr; }
    const ctx = tile.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawParcelTile(ctx, this._parcelIndex, { x: coords.x, y: coords.y, z: coords.z, size: size.x });
  },
  /** Lots changed under `bbox` ([w,s,e,n]) — repaint the live tiles it touches, once per frame. */
  markDirty(bbox) {
    if (!bbox) return;
    if (typeof window !== "undefined" && window.__PLANYR_E2E) window.__parcelTileStats = Object.assign(window.__parcelTileStats || { paints: 0, dirty: 0, flushes: 0 }, { dirty: ((window.__parcelTileStats || {}).dirty || 0) + 1 });
    const d = this._dirty;
    this._dirty = d ? [Math.min(d[0], bbox[0]), Math.min(d[1], bbox[1]), Math.max(d[2], bbox[2]), Math.max(d[3], bbox[3])] : bbox.slice();
    if (this._flushTimer) return;
    this._flushTimer = L.Util.requestAnimFrame(() => { this._flushTimer = null; this._flush(); });
  },
  _flush() {
    const d = this._dirty; this._dirty = null;
    if (!d || !this._map) return;
    Object.keys(this._tiles).forEach((k) => {
      const t = this._tiles[k];
      if (!t || !t.el || !t.coords) return;
      const b = tileLngLatBounds(t.coords.x, t.coords.y, t.coords.z, this.getTileSize().x);
      if (b[0] <= d[2] && b[2] >= d[0] && b[1] <= d[3] && b[3] >= d[1]) this._paint(t.el, t.coords);
    });
  },
});

// `opts` overrides the defaults below (e.g. a tighter `minZoom` for the "close" regime of
// `makeParcelAdaptiveLayer`); every existing single-argument caller is unaffected.
export function makeParcelLayer(url, opts) {
  /* B1976336 — esri-leaflet 3.0.19 NEVER releases a feature once fetched: `cellLeave` only removes when
   * `!_activeCells[key]`, but `_removeCell` sets `_activeCells[key]` (for reuse) just before calling it, so
   * the test can never pass, and `cacheLayers:false` therefore changes nothing (measured). A zoom-out/
   * zoom-in cycle accumulated the union of every tile ever fetched (17,282 held after ONE zoom step on
   * Michael's Bartow view). After each move `pruneToLiveCells` drops every feature that belongs only to
   * cells that are no longer current, and forgets those cells so they are re-requested if the view
   * returns. Features held track the view. `interactive:false` and the client-side hit test
   * (`eachFeature` → geometry) are untouched, so click-to-select is unchanged (B137). */
  const index = new ParcelIndex();
  let tiles = null;
  const layer = EL.featureLayer({
    url,
    minZoom: Math.max(PARCEL_MINZOOM, displayMinZoomForUrl(url)), // NEW-2 — a source that cannot answer a dense cell inside its record cap declares a higher floor
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map/canvas for add/remove
    style: () => PARCEL_OUTLINE_STYLE,
    ...opts,
  });
  // NEW-1 — children are ghosts (no per-lot Path, no per-settle projection); see ParcelGhost above.
  layer.createNewLayer = (geojson) => (geojson && geojson.geometry
    ? new ParcelGhost(geojson, index, (bbox) => { if (tiles) tiles.markDirty(bbox); })
    : null);
  /* …and ghosts never go through `map.addLayer`/`map.removeLayer`: those fire layeradd/add/remove events and
   * walk Leaflet's registry per lot (a ~100 ms long task per zoom at 10k lots). These three replace esri's
   * bodies one-for-one for a layer whose children are inert; `_layers` stays the source of truth for
   * `eachFeature`, so the hit-test, hover and export reads are unchanged. */
  layer.createLayers = function (features) {
    const visible = this._visibleZoom();
    for (let i = features.length - 1; i >= 0; i--) {
      const gj = features[i];
      let g = this._layers[gj.id];
      if (!g) {
        g = this.createNewLayer(gj);
        if (!g) continue;
        g.feature = gj;
        this._layers[gj.id] = g;
      }
      if (visible) g.attach();
    }
  };
  layer.addLayers = function (ids) { for (let i = ids.length - 1; i >= 0; i--) { const g = this._layers[ids[i]]; if (g) g.attach(); } };
  layer.removeLayers = function (ids, permanent) {
    for (let i = ids.length - 1; i >= 0; i--) {
      const g = this._layers[ids[i]];
      if (!g) continue;
      g.detach();
      if (permanent) delete this._layers[ids[i]];
    }
  };
  /* NEW-1 — esri-leaflet's `_addFeatures` dedupes each arriving id with `Array.indexOf` over EVERYTHING
   * held (`_currentSnapshot`) and the cell's id list: O(held × arriving) — 225 ms across a handful of
   * Bartow zooms. Same behaviour, one Set per call instead of a linear scan per id. */
  const baseAddFeatures = layer._addFeatures;
  if (typeof baseAddFeatures === "function") {
    layer._addFeatures = function (features, coords) {
      if (!Array.isArray(this._currentSnapshot) || !this._cache || this.options.timeField) return baseAddFeatures.call(this, features, coords);
      let key;
      if (coords) { key = this._cacheKey(coords); this._cache[key] = this._cache[key] || []; }
      const snap = new Set(this._currentSnapshot);
      const cell = key !== undefined ? new Set(this._cache[key]) : null;
      for (let i = features.length - 1; i >= 0; i--) {
        const id = features[i].id;
        if (!snap.has(id)) { snap.add(id); this._currentSnapshot.push(id); }
        if (cell && !cell.has(id)) { cell.add(id); this._cache[key].push(id); }
      }
      this.createLayers(features);
    };
  }
  let mapRef = null;
  let timer = null;
  const prune = () => { timer = null; if (layer._map) pruneToLiveCells(layer); };
  const onMoved = () => { if (timer) clearTimeout(timer); timer = setTimeout(prune, 0); };
  layer.on("add", () => {
    mapRef = layer._map;
    if (!mapRef) return;
    mapRef.on("moveend zoomend", onMoved);
    tiles = new ParcelTiles(index, { pane: "overlayPane", zIndex: 0, minZoom: layer.options.minZoom, maxZoom: 24, tileSize: 512, keepBuffer: 1 });
    tiles.addTo(mapRef);
  });
  layer.on("remove", () => {
    if (mapRef) mapRef.off("moveend zoomend", onMoved);
    Object.keys(layer._layers || {}).forEach((id) => { const g = layer._layers[id]; if (g && g.detach) g.detach(); });
    if (tiles) { try { tiles.remove(); } catch (_) {} tiles = null; }
    mapRef = null;
    if (timer) { clearTimeout(timer); timer = null; }
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
