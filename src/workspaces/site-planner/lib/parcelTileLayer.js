/* NEW-1 (parcel-outline settle cost) — draw the Select-parcels outlines into per-TILE cached canvases
 * instead of one map-sized canvas that reprojects every held lot on every settle.
 *
 * MEASURED (Michael's Chrome, Bartow GA, build 2feca52): the old canvas renderer ran update+redraw
 * 6–8 ms at z16 (767 lots in view), 37–51 ms at z15 (2,374 in view, 8,230 held) and 75–94 ms at z14
 * (7,124 in view, 16,702 held) on EVERY moveend/zoomend — several dropped frames. The cost scaled with
 * what was HELD, not what was seen: every held esri-leaflet child is a Leaflet Path, and a Path
 * registers `zoom: _project` + `moveend: _update` on the map, so each settle re-projected, re-clipped
 * and re-simplified all of them before the renderer redrew them.
 *
 * THE SHAPE OF THE FIX
 *  · `ParcelGhost` replaces the per-lot Path. It is a bare Leaflet Layer that keeps `.feature` and
 *    `getBounds()` (the ONLY two things the hit-test, hover attach and export read off a display
 *    layer's children — B137: what you see is what you can select) and registers NO map events. Held
 *    lots therefore cost nothing per settle.
 *  · A ghost "is on the map" exactly when esri-leaflet says the feature is visible (it calls
 *    `map.addLayer` / `map.removeLayer` on it), so `ParcelIndex` — fed from onAdd/onRemove — is the set
 *    of lots that SHOULD be drawn, with no second bookkeeping to drift.
 *  · A `GridLayer` draws each tile ONCE from the index (a bbox reject, then only that tile's lots are
 *    projected) and the browser keeps it. A pan reuses tiles already drawn; a zoom settle draws only
 *    the tiles it has not. Lots that arrive (or leave) later repaint only the tiles they touch, once
 *    per frame.
 * Pure drawing + indexing live here with no Leaflet import so they are unit-testable in plain Node;
 * the Leaflet wiring is `attachParcelTiles` in parcelDisplay.js. */

export const PARCEL_OUTLINE_STYLE = { color: "#a21caf", weight: 1.3, opacity: 0.95 };

const RAD = Math.PI / 360;
/* Leaflet's EPSG:3857 world is 256 px wide at zoom 0 whatever the TILE size is; a tile of `size` px at map zoom z
 * covers world pixels [x*size, (x+1)*size). Keeping the two apart is what lets the layer use big tiles. */
const WORLD_PX = 256;

/** [w, s, e, n] of a GeoJSON Polygon / MultiPolygon / LineString / MultiLineString, or null. Pure. */
export function geometryBBox(geom) {
  if (!geom || !geom.coordinates) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else for (let i = 0; i < c.length; i++) walk(c[i]);
  };
  walk(geom.coordinates);
  return w <= e && s <= n ? [w, s, e, n] : null;
}

/** The line strings (arrays of [lng, lat]) a geometry draws — polygon rings included. Points draw
 *  nothing here (a parcel layer holds none). Pure. */
export function geometryLines(geom) {
  if (!geom || !geom.coordinates) return [];
  switch (geom.type) {
    case "Polygon": case "MultiLineString": return geom.coordinates;
    case "MultiPolygon": return geom.coordinates.flat(1);
    case "LineString": return [geom.coordinates];
    default: return [];
  }
}

/* Web-Mercator unit-square coordinates (0..1) for a [lng, lat] — Leaflet's own EPSG:3857 maths. Computed
 * ONCE per lot when it arrives (`prepareParcel`), so a tile draw is a multiply and a subtract per vertex
 * with no log/tan on the settle path; the same cached rings serve every zoom. */
const unitX = (lng) => (lng + 180) / 360;
const unitY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * RAD)) / (2 * Math.PI);

/** Everything a tile draw needs from a lot, precomputed: its lng/lat bbox (for the tile reject) and its
 *  rings as flat Float64Arrays of unit-square x,y pairs. Pure. */
export function prepareParcel(geometry) {
  const bbox = geometryBBox(geometry);
  const rings = geometryLines(geometry).filter((pts) => pts.length >= 2).map((pts) => {
    const a = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) { a[2 * i] = unitX(pts[i][0]); a[2 * i + 1] = unitY(pts[i][1]); }
    return a;
  });
  return { bbox, rings };
}

/** The lat/lng box a tile covers, padded by `padPx` of its own pixels so a stroke crossing the tile edge
 *  is drawn in BOTH neighbours. Pure. Returns [w, s, e, n]. */
export function tileLngLatBounds(x, y, z, size = 256, padPx = 2) {
  const scale = WORLD_PX * Math.pow(2, z);
  const px0 = x * size - padPx, px1 = (x + 1) * size + padPx, py0 = y * size - padPx, py1 = (y + 1) * size + padPx;
  const lng = (px) => (px / scale) * 360 - 180;
  const lat = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / scale))) * 180) / Math.PI;
  return [lng(px0), lat(py1), lng(px1), lat(py0)];
}

const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/* Coarse grid (degrees) the index buckets lots into, so a tile query touches only the few cells it overlaps
 * instead of testing every held lot — the settle cost then depends on what a tile CONTAINS, not on what is
 * held. ~one z14 tile; a finer tile just scans one cell's worth of bbox rejects. */
const CELL_DEG = 0.02;
const cellKey = (i, j) => (i + 100000) * 1000000 + (j + 100000);

/** The set of lots that should be drawn, with each lot's bbox so a tile can reject cheaply. */
export class ParcelIndex {
  constructor() { this.items = new Set(); this.cells = new Map(); this._stamp = 0; }
  _eachCell(box, fn) {
    const i0 = Math.floor(box[0] / CELL_DEG), i1 = Math.floor(box[2] / CELL_DEG);
    const j0 = Math.floor(box[1] / CELL_DEG), j1 = Math.floor(box[3] / CELL_DEG);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(cellKey(i, j));
  }
  add(item) {
    if (this.items.has(item)) return;
    this.items.add(item);
    if (!item.bbox) return;
    this._eachCell(item.bbox, (k) => { let c = this.cells.get(k); if (!c) this.cells.set(k, (c = new Set())); c.add(item); });
  }
  delete(item) {
    if (!this.items.delete(item) || !item.bbox) return;
    this._eachCell(item.bbox, (k) => { const c = this.cells.get(k); if (c) { c.delete(item); if (!c.size) this.cells.delete(k); } });
  }
  get size() { return this.items.size; }
  /** Items whose bbox touches `box` ([w,s,e,n]). */
  query(box) {
    const out = [], stamp = ++this._stamp;
    this._eachCell(box, (k) => {
      const c = this.cells.get(k);
      if (c) c.forEach((it) => { if (it._q !== stamp && intersects(it.bbox, box)) { it._q = stamp; out.push(it); } });
    });
    return out;
  }
}

/** Draw every item the index holds for tile (x, y, z) onto `ctx` as ONE stroked path. `ctx` is
 *  already scaled to CSS pixels (the caller applies devicePixelRatio). Returns how many lots drew. Pure
 *  of the DOM: the unit test hands it a counting mock context. */
export function drawParcelTile(ctx, index, { x, y, z, size = 256, style = PARCEL_OUTLINE_STYLE }) {
  ctx.clearRect(0, 0, size, size);
  const items = index.query(tileLngLatBounds(x, y, z, size));
  if (!items.length) return 0;
  const scale = WORLD_PX * Math.pow(2, z), ox = x * size, oy = y * size;
  ctx.beginPath();
  for (let k = 0; k < items.length; k++) {
    const rings = items[k].rings;
    for (let l = 0; l < rings.length; l++) {
      const r = rings[l], n = r.length;
      let px = r[0] * scale - ox, py = r[1] * scale - oy;
      ctx.moveTo(px, py);
      for (let i = 2; i < n; i += 2) {
        const nx = r[i] * scale - ox, ny = r[i + 1] * scale - oy;
        // Sub-half-pixel steps change nothing on screen; skipping them is the old simplifyFactor's job
        // done where the pixels are, and keeps a dense ring from costing a lineTo per vertex.
        if (Math.abs(nx - px) < 0.5 && Math.abs(ny - py) < 0.5 && i < n - 2) continue;
        ctx.lineTo(nx, ny); px = nx; py = ny;
      }
    }
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.weight;
  ctx.globalAlpha = style.opacity;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
  return items.length;
}
