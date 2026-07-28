/* tileLifecycle — the Leaflet-bound half of the tile/overlay memory work. The POLICY
 * (how much overscan, how many tiles) is pure in tileBudget.js; everything that has to
 * touch a live Leaflet layer lives here so it stays in one auditable place.
 *
 * Three jobs:
 *   1. preserveTilesAcrossSetView — stop a `setView` from throwing away tiles it is about
 *      to ask for again (NEW-7, the biggest single load lever).
 *   2. capTileCache — an explicit ceiling on retained tiles, so a long session can't grow
 *      the tile cache without limit (NEW-7).
 *   3. releaseLayer — tear an overlay's RASTER down at toggle-off instead of leaving it to
 *      Leaflet's incidental pruning, and make sure a request still in flight can't
 *      resurrect the layer it belonged to (NEW-6).
 */
import { tilesToEvict } from "./tileBudget.js";

/* ── 1. keep tiles across a same-grid setView ─────────────────────────────────────────
 * Leaflet's Map._resetView fires `viewprereset` on EVERY setView, and GridLayer's handler
 * for it (`_invalidateAll`) removes every tile and every zoom level unconditionally — then
 * `_setView` immediately asks for most of them back. That is what made one scenario load
 * fetch 221 tiles across five zoom levels, ~53% of them transitional levels nobody ever
 * looked at: the progressive fly-in wiped and refetched at each step.
 *
 * But the tiles a GridLayer holds are keyed by NATIVE tile zoom, and the planner drives the
 * basemap at fractional zoom (zoomSnap 0). A commit that moves the fractional zoom without
 * moving the rounded native zoom needs no new tiles at all — the existing ones just shift
 * and rescale. So we skip the wipe exactly when the incoming native tile zoom equals the one
 * we already hold, and let `_setView` do its normal `_resetGrid` / `_update` / `_pruneTiles`
 * pass over the tiles we kept. When the native zoom genuinely changes we fall straight
 * through to Leaflet's own behaviour, unchanged.
 *
 * The caller publishes the zoom it is about to set via `announceSetView` (Leaflet has not
 * applied it yet at `viewprereset` time, so the layer cannot read it off the map).
 */
export function preserveTilesAcrossSetView(layer) {
  if (!layer || layer.__pfTileKeep) return layer;
  const orig = layer._invalidateAll;
  if (typeof orig !== "function") return layer; // not a GridLayer (or a Leaflet we don't know) — leave it alone
  layer.__pfTileKeep = true;
  layer._invalidateAll = function () {
    const target = this.__pfTargetZoom;
    if (target != null && this._tileZoom !== undefined && typeof this._clampZoom === "function") {
      try {
        if (this._clampZoom(Math.round(target)) === this._tileZoom) return; // same tile grid → keep every tile
      } catch (_) { /* fall through to the stock wipe */ }
    }
    return orig.call(this);
  };
  return layer;
}

/* Publish the zoom `map.setView` is about to be called with, run the commit, then clear it —
 * so a setView from anywhere ELSE (which we know nothing about) always takes Leaflet's
 * stock wipe rather than silently keeping stale tiles. */
export function announceSetView(layers, zoom, fn) {
  const list = (Array.isArray(layers) ? layers : [layers]).filter(Boolean);
  list.forEach((l) => { l.__pfTargetZoom = zoom; });
  try { return fn(); }
  finally { list.forEach((l) => { l.__pfTargetZoom = null; }); }
}

/* ── 2. bound the tile cache ──────────────────────────────────────────────────────────
 * Leaflet prunes tiles to `keepBuffer` rings, but only incidentally — the measured session
 * held ~500 tile <img> and only shed them when an unrelated pan happened to prune. This is
 * an explicit ceiling: past `limit` retained tiles, drop the furthest non-current ones.
 * Current tiles are never touched, so this can't punch a hole in the visible aerial. */
export function capTileCache(layer, limit) {
  if (!layer || !layer._tiles || !layer._map) return 0;
  const entries = Object.keys(layer._tiles).map((key) => {
    const t = layer._tiles[key];
    const c = t && t.coords;
    let distance = 0;
    try {
      const center = layer._map.getCenter();
      const cp = layer._map.project(center, c.z).divideBy(layer.getTileSize().x);
      distance = Math.max(Math.abs(cp.x - c.x), Math.abs(cp.y - c.y));
    } catch (_) { distance = 0; }
    return { key, current: !!(t && t.current), active: !!(t && t.active), loaded: !!(t && t.loaded), distance };
  });
  const drop = tilesToEvict(entries, limit);
  drop.forEach((key) => { try { layer._removeTile(key); } catch (_) {} });
  return drop.length;
}

/* Keep a tile layer under its cap for as long as it is on the map. Returns a detach fn. */
export function boundTileCache(layer, limitFn) {
  if (!layer || typeof layer.on !== "function") return () => {};
  const run = () => { try { capTileCache(layer, limitFn()); } catch (_) {} };
  layer.on("load", run);
  layer.on("moveend", run);
  return () => { try { layer.off("load", run); layer.off("moveend", run); } catch (_) {} };
}

/* ── 3. release an overlay for real ───────────────────────────────────────────────────
 * Measured (NEW-6): toggling 23 overlays off released 780 of 782 SVG elements — the vector
 * teardown is already correct — but 0 of 51 overlay TILES. They lingered until an unrelated
 * later pan happened to prune them. Two causes, both fixed here:
 *   • esri-leaflet's raster layers hold their painted `<img>` on `_currentImage`, and a
 *     request already in flight when the layer is removed re-adds a FRESH image on resolve —
 *     so the layer quietly puts itself back on a map it was removed from.
 *   • grid/tile children of a layer group keep their whole `_tiles` map alive.
 * `releaseLayer` walks the layer (and, for a group, its children), aborts what it can,
 * removes the raster DOM, and leaves a tombstone that makes any later `onAdd` a no-op.
 */
export function releaseLayer(map, layer) {
  if (!layer || layer === "pending") return;
  // Tombstone FIRST: whatever resolves after this point must find a dead layer.
  try { layer.__pfReleased = true; } catch (_) {}
  // Abort anything the layer itself knows how to cancel (evidence/vector layers expose a
  // controller; esri-leaflet does not, so its in-flight request is neutralised by the
  // tombstone + the onAdd block below rather than cancelled).
  try { if (layer.__pfAbort && typeof layer.__pfAbort.abort === "function") layer.__pfAbort.abort(); } catch (_) {}
  try { if (typeof layer.abortPending === "function") layer.abortPending(); } catch (_) {}

  // Children first, so a group's tile/raster children are released before the group leaves
  // the map (after removal `eachLayer` still works, but the child's `_map` is gone).
  try { if (typeof layer.eachLayer === "function") layer.eachLayer((child) => releaseLayer(map, child)); } catch (_) {}

  try { if (map && typeof map.removeLayer === "function") map.removeLayer(layer); } catch (_) {}

  // esri-leaflet RasterLayer: drop the painted image AND the reference that keeps its
  // decoded bitmap alive.
  try {
    const img = layer._currentImage;
    if (img) {
      if (map && typeof map.removeLayer === "function") { try { map.removeLayer(img); } catch (_) {} }
      const el = img._image || (typeof img.getElement === "function" ? img.getElement() : null);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      layer._currentImage = null;
    }
  } catch (_) {}

  // GridLayer: drop every retained tile and its level containers now, not whenever a later
  // pan happens to prune.
  try { if (typeof layer._removeAllTiles === "function") layer._removeAllTiles(); } catch (_) {}
  try {
    if (layer._levels) {
      Object.keys(layer._levels).forEach((z) => {
        const el = layer._levels[z] && layer._levels[z].el;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        delete layer._levels[z];
      });
    }
  } catch (_) {}

  // A resolve that lands after removal must not put the layer back. esri-leaflet's async
  // paths all funnel through onAdd/_renderImage; blocking both makes the removal final.
  try {
    layer.onAdd = function () { return this; };
    if (typeof layer._renderImage === "function") layer._renderImage = function () {};
  } catch (_) {}
}
