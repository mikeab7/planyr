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
import { STATEWIDE_PARCEL_LAYER, displayMinZoomForUrl, lotNumberFieldForUrl, snapshotLotNumberField } from "./counties.js";
import { attachLotNumbers, attachSnapshotLotNumbers } from "./parcelLotLabelLayer.js";
import { getSnapshot, snapshotFeaturesInView, onSnapshotChange } from "./parcelSnapshot.js";
import { pruneToLiveCells } from "./parcelPrune.js";
import { IngestQueue, INGEST_BUDGET_MS, PAINT_BUDGET_MS } from "./parcelIngest.js";
import { routeQueryThroughWorker } from "./parcelQueryTransport.js";
import { ParcelIndex, drawParcelTile, prepareParcel, tileLngLatBounds, PARCEL_OUTLINE_STYLE } from "./parcelTileLayer.js";
import { guardRasterOpacity } from "./parcelOpacityGuard.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom, parcelUrlSupportsImageExport, MAPSERVER_LAYER_RE, plainOutlineDynamicLayers } from "./parcelDisplayZoom.js";

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
  /** Lots changed under `bbox` ([w,s,e,n]) — repaint the live tiles it touches, a few per frame. */
  markDirty(bbox) {
    if (!bbox) return;
    if (typeof window !== "undefined" && window.__PLANYR_E2E) window.__parcelTileStats = Object.assign(window.__parcelTileStats || { paints: 0, dirty: 0, flushes: 0 }, { dirty: ((window.__parcelTileStats || {}).dirty || 0) + 1 });
    const d = this._dirty;
    this._dirty = d ? [Math.min(d[0], bbox[0]), Math.min(d[1], bbox[1]), Math.max(d[2], bbox[2]), Math.max(d[3], bbox[3])] : bbox.slice();
    this._schedule();
  },
  _schedule() {
    if (!this._flushTimer && this._map) this._flushTimer = L.Util.requestAnimFrame(() => { this._flushTimer = null; this._flush(); });
  },
  /* NEW-1 (arrival cost) — repainting is budgeted too. The dirty box is turned into a queue of tile keys once, and
   * each frame repaints only as many as fit PAINT_BUDGET_MS (always at least one, so it always progresses). While lots
   * are still being ingested the repaint is held back (up to ~100 ms) so a tile is painted once with the batch, not
   * once per slice. A tile that left the map while queued is skipped. */
  _flush() {
    if (!this._map) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this._busy && this._busy() && now - (this._lastFlush || 0) < 100) { this._schedule(); return; }
    const d = this._dirty; this._dirty = null;
    const todo = this._todo || (this._todo = new Set());
    if (d) {
      const size = this.getTileSize().x;
      Object.keys(this._tiles).forEach((k) => {
        const t = this._tiles[k];
        if (!t || !t.el || !t.coords) return;
        const b = tileLngLatBounds(t.coords.x, t.coords.y, t.coords.z, size);
        if (b[0] <= d[2] && b[2] >= d[0] && b[1] <= d[3] && b[3] >= d[1]) todo.add(k);
      });
    }
    this._lastFlush = now;
    const t0 = now;
    for (const k of todo) {
      todo.delete(k);
      const t = this._tiles[k];
      if (t && t.el && t.coords) this._paint(t.el, t.coords);
      if (performance.now() - t0 >= PAINT_BUDGET_MS) break;
    }
    if (todo.size || this._dirty) this._schedule();
  },
});

// `opts` overrides the defaults below (e.g. a tighter `minZoom` for the "close" regime of
// `makeParcelAdaptiveLayer`); every existing single-argument caller is unaffected.
export function makeParcelLayer(url, opts) {
  /* NEW-1 (2026-10-04) — Planyr draws the lot NUMBERS too. `lotNumberHint` (default: the county's
   * `lotNumberField`/`idField` for this URL) names the attribute; `labels:false` opts out;
   * `getObstacles` hands the label engine the screen boxes a number must clear (the Site planner's
   * parcel chips). None of these are esri-leaflet options, so they are split off before the spread. */
  const { lotNumberHint, labels, getObstacles, getInset, ...layerOpts } = opts || {};
  const lotHint = labels === false ? null : (lotNumberHint !== undefined ? lotNumberHint : lotNumberFieldForUrl(url));
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
    ...layerOpts,
  });
  if (lotHint) layer._lotNumbers = attachLotNumbers(layer, { hint: lotHint, getObstacles, getInset });
  // NEW-1 — children are ghosts (no per-lot Path, no per-settle projection); see ParcelGhost above.
  layer.createNewLayer = (geojson) => (geojson && geojson.geometry
    ? new ParcelGhost(geojson, index, (bbox) => { if (tiles) tiles.markDirty(bbox); })
    : null);
  /* NEW-1 (arrival cost) — a response is QUEUED and drained under a per-frame time budget (see parcelIngest.js),
   * so landing 1,200 new lots × six queries never becomes one 100 ms task. `load` is held until the queue is empty,
   * because MapFinder reads it as "the outlines for this view are drawn". */
  const ingestOne = (gj) => {
    let g = layer._layers[gj.id];
    if (!g) {
      g = layer.createNewLayer(gj);
      if (!g) return;
      g.feature = gj;
      layer._layers[gj.id] = g;
    }
    if (layer._visibleZoom()) g.attach();
  };
  const queue = new IngestQueue({
    process: ingestOne,
    alive: (coords) => !coords || !layer._cache || layer._cache[layer._cacheKey(coords)] !== undefined, // prune deletes a left cell's cache entry
  });
  const heldLoads = [];
  let basePostProcess = null;
  const releaseLoads = () => { while (heldLoads.length && basePostProcess) basePostProcess.call(layer, heldLoads.shift()); };
  let pumpRaf = null;
  const pump = () => {
    pumpRaf = null;
    if (!layer._map) return;
    queue.drain(INGEST_BUDGET_MS);
    if (queue.pending) pumpRaf = L.Util.requestAnimFrame(pump); else releaseLoads();
  };
  const enqueue = (features, coords) => {
    queue.push(features, coords);
    if (typeof document !== "undefined" && document.hidden) { queue.drain(Infinity); releaseLoads(); return; } // nobody is watching a frame; rAF would not run either
    if (pumpRaf == null) pumpRaf = L.Util.requestAnimFrame(pump);
  };
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
      enqueue(features, coords);
    };
  }
  /* B2092656 ×3 — the /query round trip, its JSON parse and the ArcGIS→GeoJSON conversion run in a worker
   * (parcelQueryTransport.js): one ~1,200-lot answer was a 15–35 ms main-thread task inside esri-leaflet's XHR
   * callback. The query itself is still built by esri-leaflet (`_buildQuery`), and the service still fires every
   * request event the hang-guards listen for. */
  const baseBuildQuery = layer._buildQuery;
  if (typeof baseBuildQuery === "function") layer._buildQuery = function (bounds, offset) { return routeQueryThroughWorker(baseBuildQuery.call(this, bounds, offset)); };
  basePostProcess = layer._postProcessFeatures;
  if (typeof basePostProcess === "function") {
    layer._postProcessFeatures = function (bounds) {
      if (queue.pending) { heldLoads.push(bounds); return undefined; }
      return basePostProcess.call(this, bounds);
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
    tiles._busy = () => queue.pending > 0;
    tiles.addTo(mapRef);
  });
  layer.on("remove", () => {
    if (mapRef) mapRef.off("moveend zoomend", onMoved);
    Object.keys(layer._layers || {}).forEach((id) => { const g = layer._layers[id]; if (g && g.detach) g.detach(); });
    if (tiles) { try { tiles.remove(); } catch (_) {} tiles = null; }
    queue.clear();
    if (pumpRaf != null) { L.Util.cancelAnimFrame(pumpRaf); pumpRaf = null; }
    releaseLoads(); // keeps esri-leaflet's request counter honest
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
  const layer = guardRasterOpacity(EL.dynamicMapLayer({
    url: service,
    dynamicLayers: plainOutlineDynamicLayers(id),
    minZoom: PARCEL_MINZOOM,
    opacity: 1,
    f: "image",
    ...opts,
  }));
  /* A statewide BACKUP covers only the counties whose own server failed (`names`), not the whole view; null
   * = the whole state (a county with no CAD of its own). A no-op when unchanged, and safe before the layer is
   * on a map (esri's `_update` returns with no map), so the first request already carries the scope. */
  let scopeKey = "";
  layer.setCountyScope = (names) => {
    const list = Array.isArray(names) && names.length ? [...names].sort() : [];
    const key = list.join("|");
    if (key === scopeKey) return layer;
    scopeKey = key;
    if (typeof layer.setDynamicLayers === "function") layer.setDynamicLayers(plainOutlineDynamicLayers(id, { countyNames: list }));
    return layer;
  };
  return layer;
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

/* Draw a county's outlines from its Drive PARCEL SNAPSHOT (B629). `optimisticHitAt` (which iterates `eachFeature`)
 * selects a lot from it with NO new click logic, and it renders + clicks even when the live county server is fully
 * down. Only the viewport's parcels are held (bbox-filtered), re-filled on pan/zoom and when a fresher snapshot loads.
 * Empty until `ensureSnapshot(county)` has warmed the data.
 *
 * ⛔ B2092656 ×3 — THE SAME MACHINERY AS THE LIVE OUTLINES, NOT AN `L.geoJSON`. It used to be an `L.geoJSON` that rebuilt
 * one Leaflet Path per in-view lot (projected, clipped, an SVG node each) plus every lot number, all in ONE task —
 * 263–282 ms on Waller's recorded real copy at Katy, z15 (ui-audit/verify-select-parcels-on-cost.mjs), the moment the
 * copy finished loading. Now: in-view lots are inert `ParcelGhost`s fed through the budgeted `IngestQueue`, drawn by
 * the per-tile cached canvases (`ParcelTiles`), and the lot numbers are laid out once ingestion drains. B137 holds the
 * same way it does for the live layer: a lot is in `_layers` (what `eachFeature` walks) exactly when it is in the
 * tile index. */
export function makeSnapshotLayer(county, { getObstacles } = {}) {
  const index = new ParcelIndex();
  let tiles = null;
  const held = new Map(); // lot key (`__k`, stable per vintage) -> { f, g } — g is its ghost once ingested, null while queued (a ghost's ring prep is per-lot work, so it happens in the budgeted drain)
  const layer = new (L.Layer.extend({}))();
  layer._isSnapshot = true;
  layer._snapshotCounty = county;
  layer._layers = {};
  let nextId = 0;
  layer.eachFeature = function (fn, ctx) { Object.keys(this._layers).forEach((k) => fn.call(ctx, this._layers[k])); return this; };
  layer.eachLayer = layer.eachFeature;
  layer.getLayers = function () { return Object.keys(this._layers).map((k) => this._layers[k]); };
  // The saved copy numbers its lots too (owner decision 2026-10-05): the SAME account the live CAD shows,
  // read off the snapshot's own attributes, so a lot reads one number whether the county server is up or down.
  const numbers = attachSnapshotLotNumbers(layer, { field: snapshotLotNumberField(county), getObstacles, getFeatures: () => layer.getLayers().map((g) => g.feature) });
  layer._lotNumbers = numbers; // a host that moves a chip over the lots asks for a relayout
  let mapRef = null, unsub = null, pumpRaf = null;
  const queue = new IngestQueue({
    process: (k) => {
      const h = held.get(k);
      if (!h || h.g) return; // left the view while queued, or already in
      const g = new ParcelGhost(h.f, index, (bbox) => { if (tiles) tiles.markDirty(bbox); });
      h.g = g;
      g._live = true;
      g._sid = String(++nextId);
      layer._layers[g._sid] = g;
      g.attach();
    },
  });
  const pump = () => {
    pumpRaf = null;
    if (!mapRef) return;
    queue.drain(INGEST_BUDGET_MS);
    if (queue.pending) pumpRaf = L.Util.requestAnimFrame(pump);
    else numbers.relayout();
  };
  const drop = (k, h) => {
    held.delete(k);
    const g = h && h.g;
    if (g && g._live) { g._live = false; delete layer._layers[g._sid]; g.detach(); }
  };
  const dropAll = () => { held.forEach((h, k) => drop(k, h)); queue.clear(); };
  let ask = 0;
  const apply = (feats) => {
    const want = new Set();
    const fresh = [];
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      const k = f.__k != null ? f.__k : f; // the worker's answers are fresh objects; `__k` is the lot's stable key
      want.add(k);
      if (held.has(k)) continue;
      held.set(k, { f, g: null });
      fresh.push(k);
    }
    held.forEach((h, k) => { if (!want.has(k)) drop(k, h); });
    if (fresh.length) {
      queue.push(fresh, null);
      if (typeof document !== "undefined" && document.hidden) { queue.drain(Infinity); numbers.relayout(); return; }
      if (pumpRaf == null) pumpRaf = L.Util.requestAnimFrame(pump);
    } else if (!queue.pending) numbers.relayout();
  };
  const refresh = () => {
    if (!mapRef) return;
    const mine = ++ask;
    if (mapRef.getZoom() < PARCEL_MINZOOM || !getSnapshot(county)) { dropAll(); numbers.clear(); return; } // too many to draw across a whole county at once
    const b = mapRef.getBounds();
    snapshotFeaturesInView(county, { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() })
      .then((feats) => { if (mine === ask && mapRef) apply(feats || []); }) // a later view's answer supersedes this one
      .catch(() => {});
  };
  layer.onAdd = function (map) {
    mapRef = map;
    tiles = new ParcelTiles(index, { pane: "overlayPane", zIndex: 0, minZoom: PARCEL_MINZOOM, maxZoom: 24, tileSize: 512, keepBuffer: 1 });
    tiles._busy = () => queue.pending > 0;
    tiles.addTo(map);
    map.on("moveend zoomend", refresh);
    unsub = onSnapshotChange((c) => { if (c === county) { dropAll(); refresh(); } }); // a fresher copy: new lots, new keys
    refresh();
    return this;
  };
  layer.onRemove = function (map) {
    map.off("moveend zoomend", refresh);
    if (unsub) unsub();
    if (pumpRaf != null) { L.Util.cancelAnimFrame(pumpRaf); pumpRaf = null; }
    ask++;
    dropAll();
    numbers.clear();
    if (tiles) { try { tiles.remove(); } catch (_) {} tiles = null; }
    mapRef = null; unsub = null;
    return this;
  };
  return layer;
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
export const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
export const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
