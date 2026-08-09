/* Baked flood tiles — the LEAFLET-FREE half (NEW-2): decode, hit-test, paint.
 *
 * Split out of `floodTileLayer.js` for the same reason `adminBoundaryData.js` is split out of
 * `adminBoundaryLayer.js`: a module that imports Leaflet needs a `window`, so it can only ever be
 * tested through a browser. Everything here is the part worth pinning in a unit test — which ring
 * a point is in, what a tile actually decoded to, and what got painted — so it lives where a
 * DOM-less Node test can reach it.
 *
 * `paint` takes the canvas as an argument and touches nothing global, so it is testable against a
 * recording stub with no DOM at all.
 */
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { resolveFloodZone } from "./floodZone.js";
import { floodTileStyle, paintRank } from "./floodTileStyle.js";
import { FLOOD_TILE_LAYER_NAME } from "../../../shared/gis/floodTiles.js";

export const TILE_PX = 256;

/* Web-mercator, tile-space. `lngLatToTileFraction` is the inverse of what the renderer does, so a
 * point query is EXACT rather than re-derived from painted pixels. */
export const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
export const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/* Even-odd point-in-rings. MVT hands a feature back as a FLAT list of rings — exteriors and holes
 * together, and several polygons' worth for a multipolygon — so an even-odd crossing count over
 * all of them is both the simplest and the correct answer: a point inside a hole crosses an even
 * number of boundaries and reads as outside, with no need to classify ring winding first. */
export function pointInRings(rings, px, py) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/* Decode one MVT tile into the shape BOTH the painter and the identify read, so the thing under
 * the cursor is by construction the thing that was drawn. An archive whose tile carries no `flood`
 * layer decodes to nothing rather than throwing — a tile is allowed to be empty (most of a county
 * has no polygon in it), and that is not a failure. */
export function decodeFloodTile(buf) {
  const vt = new VectorTile(new Pbf(buf));
  const layer = vt.layers[FLOOD_TILE_LAYER_NAME];
  if (!layer) return { extent: 4096, features: [] };
  const features = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const props = f.properties || {};
    const resolved = resolveFloodZone(props);
    features.push({ props, resolved, rings: f.loadGeometry(), rank: paintRank(resolved && resolved.variant) });
  }
  // Painter's algorithm — a floodway must land ON TOP of the SFHA it sits inside, whatever order
  // the tile happens to hold. Stable, so equal-rank features keep the archive's own order.
  features.sort((a, b) => a.rank - b.rank);
  return { extent: layer.extent || 4096, features };
}

/* Paint one decoded tile. Returns how many features were drawn, so a headless check can assert a
 * known tile draws something without standing up a map. */
export function paint(canvas, decoded) {
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx || !decoded) return 0;
  const k = TILE_PX / (decoded.extent || 4096);
  let drawn = 0;
  for (const f of decoded.features) {
    const style = floodTileStyle(f.resolved && f.resolved.variant);
    ctx.beginPath();
    for (const ring of f.rings) {
      if (!ring.length) continue;
      ctx.moveTo(ring[0].x * k, ring[0].y * k);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x * k, ring[i].y * k);
      ctx.closePath();
    }
    ctx.fillStyle = style.fill;
    // even-odd, so a hole inside a polygon stays a hole whichever way its ring was wound.
    ctx.fill("evenodd");
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.stroke();
    drawn++;
  }
  return drawn;
}

/* Which feature is under this lat/lng, given a decoded tile and the tile's own z/x/y? Returns the
 * TOPMOST hit (the last painted), or null. Pure — the layer supplies the decoded tiles it holds. */
export function featureAt(tiles, at) {
  if (!at || typeof at.lat !== "number" || typeof at.lng !== "number") return null;
  for (const t of tiles) {
    const fx = lngToTileX(at.lng, t.z) - t.x;
    const fy = latToTileY(at.lat, t.z) - t.y;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue;
    const px = fx * t.extent, py = fy * t.extent;
    for (let i = t.features.length - 1; i >= 0; i--) {
      if (pointInRings(t.features[i].rings, px, py)) return t.features[i];
    }
  }
  return null;
}
