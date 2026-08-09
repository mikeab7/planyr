/* Baked FEMA NFHL flood tiles — the LEAFLET GLUE (NEW-2).
 *
 * A canvas `L.GridLayer` that range-reads a per-county PMTiles archive off the same Cloudflare
 * Pages origin that serves the app, decodes each tile's vector geometry, and paints it. The live
 * FEMA `/export` path is untouched and remains the fallback (`floodTiles.resolveFloodSource`).
 *
 * ⛔ THIS MODULE IS LAZY BY CONSTRUCTION AND MUST STAY THAT WAY. It pulls in `pmtiles`,
 * `@mapbox/vector-tile` and `pbf`. Those are worth their weight ONLY on a plan whose county has an
 * archive and whose flag is on — a minority of loads — so `layers.js` reaches this file through a
 * dynamic `import()` at the moment the layer is switched on, exactly the way `loadTerrain()` and
 * the DXF parser are kept off the boot bundle. A static import from layers.js would put the whole
 * vector-tile stack on every visitor's first paint.
 *
 * The decode / hit-test / paint half lives in `floodTileDecode.js` — Leaflet needs a `window`, so
 * anything imported here can only be tested through a browser (the `adminBoundaryData.js` split,
 * same reason). Keep new pure logic over there.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *  • It does not answer an acreage, an intersection, or a boundary a user acts on. A tile is
 *    generalised. `FLOOD_TILE_IDENTIFY_NOTE` says so on every card, and the screening / mitigation
 *    math still queries live FEMA.
 *  • It does not bake NFHL layer 27 (Flood Hazard BOUNDARIES). Those strokes are derived from the
 *    same polygons this layer already outlines, so baking them would double the bytes to redraw a
 *    line we are drawing anyway.
 */
import L from "leaflet";
import { PMTiles } from "pmtiles";
import { FloodArchiveSource } from "./floodArchiveSource.js";
import { floodTileTitle, floodTileRows, FLOOD_TILE_IDENTIFY_NOTE } from "./floodTileStyle.js";
import { decodeFloodTile, paint, featureAt, TILE_PX } from "./floodTileDecode.js";
import { FLOOD_TILE_MIN_ZOOM, FLOOD_TILE_MAX_ZOOM } from "../../../shared/gis/floodTiles.js";

/* One `PMTiles` reader per archive URL, shared by every layer that opens it. The reader keeps its
 * own directory cache, so a second layer on the same archive (the planner backdrop and the map
 * finder can both be alive) re-uses the resolved directories instead of re-reading the header and
 * root directory over the network. */
const ARCHIVES = new Map();
export function openArchive(url) {
  let entry = ARCHIVES.get(url);
  if (!entry) {
    /* ⛔ NOT `new PMTiles(url)` — that builds pmtiles' own `FetchSource`, which THROWS on a host
     * that ignores Range, and Cloudflare Pages (where this app is served from) does exactly that.
     * `FloodArchiveSource` adapts: ranged reads where byte serving works, whole-file-once where it
     * does not. The measurement and the refutation are in that module's header; do not "simplify"
     * this back to a bare URL. */
    const source = new FloodArchiveSource(url);
    entry = { source, pm: new PMTiles(source) };
    ARCHIVES.set(url, entry);
  }
  return entry.pm;
}
/* Teardown + test seam: a rebuilt archive at the same URL must not be served out of a stale
 * directory cache for the life of the tab — and the held whole-file buffer must be released with
 * it, or a plan switch leaks a county's worth of archive per visit. */
export function forgetArchive(url) {
  const drop = (e) => { if (e && e.source) e.source.release(); };
  if (url == null) { ARCHIVES.forEach(drop); ARCHIVES.clear(); return; }
  drop(ARCHIVES.get(url));
  ARCHIVES.delete(url);
}

/* ---------------------------------------------------------------------------
 * The layer.
 *
 * `report(state, msg)` is the same status channel every other layer uses: "loading" → "loaded"
 * once the first tile is on screen · "failed" on an archive that will never answer, which is ALSO
 * when `onFallback()` fires so the caller can swap in live FEMA.
 * ------------------------------------------------------------------------- */
export function floodPmtilesLayer({ url, opacity = 1, pane, report = () => {}, onFallback = null }) {
  const Layer = L.GridLayer.extend({
    initialize(opts) {
      L.GridLayer.prototype.initialize.call(this, opts);
      this._pm = openArchive(url);
      this._decoded = new Map();   // tile key → decoded tile, for identifyAt
      this._reportedLoaded = false;
      this._dead = false;
    },

    /* ⛔ ONE FAILURE PATH, AND IT IS TERMINAL ON PURPOSE. A 404 or an unparsable header means the
     * archive is not there — retrying every tile against a missing file would spend dozens of
     * requests to learn the same thing, and would leave the flood layer blank while it did. So the
     * first ARCHIVE-level failure disarms the layer and hands the caller its fallback exactly once.
     * A per-TILE miss is not this: an absent tile is the ordinary case (most of a county has no
     * polygon in it) and is drawn as empty, never as a failure. */
    _die(msg) {
      if (this._dead) return;
      this._dead = true;
      report("failed", msg);
      if (onFallback) { const fb = onFallback; onFallback = null; fb(msg); }
    },

    createTile(coords, done) {
      const tile = L.DomUtil.create("canvas");
      tile.width = tile.height = TILE_PX;
      const key = `${coords.z}/${coords.x}/${coords.y}`;
      this._pm.getZxy(coords.z, coords.x, coords.y).then((res) => {
        if (this._dead) { done(null, tile); return; }
        if (res && res.data) {
          const decoded = decodeFloodTile(res.data);
          this._decoded.set(key, { ...decoded, z: coords.z, x: coords.x, y: coords.y });
          paint(tile, decoded);
        }
        if (!this._reportedLoaded) { this._reportedLoaded = true; report("loaded"); }
        done(null, tile);
      }, (err) => {
        this._die(`flood tiles: ${(err && err.message) || "archive unreadable"}`);
        done(null, tile); // never `done(err)`: Leaflet would retry, and the fallback already owns this
      });
      return tile;
    },

    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      report("loading");
      // Read the header up front purely so a MISSING archive fails in one round trip instead of
      // waiting for whichever tile the viewport happens to want first.
      this._pm.getHeader().then(null, (err) => this._die(`flood tiles: ${(err && err.message) || "archive unreachable"}`));
      this.on("tileunload", this._forget, this);
      return this;
    },
    onRemove(map) {
      this.off("tileunload", this._forget, this);
      this._decoded.clear();
      L.GridLayer.prototype.onRemove.call(this, map);
      return this;
    },
    _forget(e) {
      const c = e && e.coords;
      if (c) this._decoded.delete(`${c.z}/${c.x}/${c.y}`);
    },

    /* (B1092) The canvas-identify accessor — the same contract as `vectorOverlay`'s `identifyAt`,
     * which is what lets `layers.identifyOverlaysAt` treat a tile answer and a vector answer
     * identically with no change at the call site. Answers ONLY from tiles currently decoded (i.e.
     * on screen), so a hover can never queue network work; a point with no polygon returns null and
     * the existing raster-identify path takes over, exactly as it does today. */
    identifyAt(at) {
      if (this._dead) return null;
      const f = featureAt(this._decoded.values(), at);
      if (!f) return null;
      return {
        sourceId: "femaTiles",
        title: floodTileTitle(f.resolved),
        rows: floodTileRows(f.props, f.resolved),
        note: FLOOD_TILE_IDENTIFY_NOTE,
      };
    },
  });

  return new Layer({
    pane,
    opacity,
    // Overzoom past the deepest baked level rather than baking z14–z18: Leaflet scales the z13 tile
    // up, which is exactly the right trade for a generalised picture.
    minNativeZoom: FLOOD_TILE_MIN_ZOOM,
    maxNativeZoom: FLOOD_TILE_MAX_ZOOM,
    tileSize: TILE_PX,
    updateWhenZooming: false,
    keepBuffer: 1,
  });
}
