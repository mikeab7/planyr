/* Raw-DEM grid plumbing for the client-side terrain pipeline (B704/B705/B706).
 *
 * Plain-English: the public USGS elevation service can hand us the actual height
 * numbers for the current view (not just a colored picture). This module knows how to
 * ask for that grid, decode it, clean it up, and read heights back out of it. The
 * contour lines, drainage arrows, and hover readout all consume THIS one grid.
 *
 * PURE by design: no Leaflet, no DOM, no network — the fetch happens in the caller
 * (terrainLayers.js, so it can ride gisCache + the proxy fallback) and the heavy
 * decode/smooth runs inside the terrain Web Worker (terrainWorker.js), both of which
 * import from here. Unit-tests run in plain node (test/demGrid.test.js) against a real
 * captured LERC tile (test/fixtures/dep-katy-463x400.lerc).
 *
 * Geometry model: everything is Web Mercator (EPSG:3857) meters — the service's native
 * SR (probed 2026-07-07) and what the Leaflet map draws in. Elevations convert to survey
 * feet on decode (M_TO_FT — every 3DEP consumer converts identically; NAVD88 orthometric
 * heights, the same vertical datum FEMA BFEs use).
 *
 * TWO request shapes, and the difference is the whole point of NEW-2:
 *  - `latticeTile` / `latticeCover` — the FIXED GEOGRAPHIC LATTICE the view-driven
 *    terrain layers use. A tile is a pure function of (band, tx, ty): same ground →
 *    same tile → same cells → same contours, no matter where the viewport sits. The
 *    cell size is quantized to a small set of ZOOM BANDS, so panning cannot change it
 *    and the traced network cannot re-roll. (The predecessor sized the tile TO THE
 *    VIEWPORT and coarsened for it, so every pan/zoom moved the cell lattice and the
 *    tile border — which is why 1-ft contours traced off ±0.1–0.3 ft LiDAR noise
 *    visibly changed over identical ground.)
 *  - `gridRequest` — the viewport/envelope-snapped tile, still used by the SITE grid
 *    (`fetchSiteGrid`, B808). That caller passes a site envelope, not a map view, so it
 *    is already deterministic and deliberately keeps its tight-fitting bbox.
 */
import { DEP_URL } from "./elevation.js";

export const WEB_MERC_R = 6378137;                       // spherical mercator radius (m)
const MERC_MAX = Math.PI * WEB_MERC_R;

// Grid sizing: ~2 screen px per cell keeps 1-ft contours smooth without exploding the
// payload; tiles snap to SNAP_CELLS multiples so small pans reuse the same key; margin
// covers the widest smoothing kernel (see maskedSmooth — sigma ≤ ~2.5 cells → 3σ ≈ 8);
// MAX_GRID caps a single export well under the service's 8000² ceiling and ~4 MB F32.
export const CELL_PX = 2;
const SNAP_CELLS = 32;
export const MARGIN_CELLS = 8;
export const MAX_GRID = 1024;

// --- Web Mercator <-> WGS84 (pure spherical formulas — no Leaflet in the worker) ----
export const lngToMercX = (lng) => (lng * Math.PI * WEB_MERC_R) / 180;
export const latToMercY = (lat) =>
  WEB_MERC_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const mercXToLng = (x) => (x / MERC_MAX) * 180;
export const mercYToLat = (y) =>
  (Math.atan(Math.exp(y / WEB_MERC_R)) * 360) / Math.PI - 90;

// Mercator meters are stretched by 1/cos(lat): multiply a mercator distance by this to
// get GROUND meters (~0.868 at Houston). Slopes/arrow math must use ground distance;
// contour POSITIONS don't care (both axes stretch equally — B705 review note A11).
export const groundScale = (lat) => Math.cos((lat * Math.PI) / 180);

/* Mercator meters per screen pixel at an integer zoom (the standard 256-px tile pyramid). */
export const mercPerPx = (zoom) => (2 * MERC_MAX) / (256 * 2 ** zoom);

/* Snap a WGS84 view to the deterministic grid tile for `zoom`.
 * bounds: {west, south, east, north} degrees. Returns the full request descriptor:
 *   { key, zoom, cellMeters, width, height, bbox:{xmin,ymin,xmax,ymax} }  (bbox INCLUDES
 * the smoothing margin). Same view → same key → same bbox, by construction. */
export function gridRequest(bounds, zoom) {
  const z = Math.round(zoom);
  let cell = mercPerPx(z) * CELL_PX;
  const x0 = lngToMercX(bounds.west), x1 = lngToMercX(bounds.east);
  const y0 = latToMercY(bounds.south), y1 = latToMercY(bounds.north);
  // Snap outward to SNAP_CELLS-aligned cell indices (aligned to the mercator origin).
  const snap = cell * SNAP_CELLS;
  let ix0 = Math.floor(x0 / snap) * SNAP_CELLS, ix1 = Math.ceil(x1 / snap) * SNAP_CELLS;
  let iy0 = Math.floor(y0 / snap) * SNAP_CELLS, iy1 = Math.ceil(y1 / snap) * SNAP_CELLS;
  // An oversized viewport could exceed MAX_GRID — coarsen the cell deterministically
  // (the factor depends only on the snapped span, which depends only on bounds+zoom).
  const spanCells = Math.max(ix1 - ix0, iy1 - iy0) + 2 * MARGIN_CELLS;
  const k = Math.max(1, Math.ceil(spanCells / MAX_GRID));
  if (k > 1) {
    cell *= k;
    ix0 = Math.floor(ix0 / k); ix1 = Math.ceil(ix1 / k);
    iy0 = Math.floor(iy0 / k); iy1 = Math.ceil(iy1 / k);
  }
  const width = (ix1 - ix0) + 2 * MARGIN_CELLS;
  const height = (iy1 - iy0) + 2 * MARGIN_CELLS;
  const bbox = {
    xmin: (ix0 - MARGIN_CELLS) * cell,
    ymin: (iy0 - MARGIN_CELLS) * cell,
    xmax: (ix1 + MARGIN_CELLS) * cell,
    ymax: (iy1 + MARGIN_CELLS) * cell,
  };
  return { key: `dem:z${z}k${k}:${ix0},${iy0},${ix1},${iy1}`, zoom: z, cellMeters: cell, width, height, bbox };
}

// ---------------------------------------------------------------------------
// THE FIXED GEOGRAPHIC LATTICE (NEW-2).
//
// Plain-English: the ground is carved into fixed squares that never move. Panning the
// map changes WHICH squares you're looking at, never WHERE the squares are — so the
// same piece of ground is always traced from exactly the same height samples, and the
// contour lines stop changing when you move.
//
// A band is one quantized cell size (cell = mercPerPx(band) · CELL_PX). Bands are the
// integer zooms, so a tile's ground span shrinks with zoom at the same rate the
// viewport does — the tile count per view stays roughly constant across zoom.
export const TILE_CELLS = 512;          // interior cells per lattice tile (margin sits OUTSIDE this)
export const LATTICE_MAX_BAND = 19;     // finer than this buys nothing over ~1 m LiDAR
export const LATTICE_MIN_BAND = 12;     // floor for the coarsening ladder
export const LATTICE_MAX_TILES = 20;    // per view; beyond this the band steps down (and says so).
                                        // 512 cells ≈ 1024 screen px, so a 4K pane still fits without coarsening.

/* Cell size (mercator meters) for a band. Depends on the band ALONE — never on the view. */
export const bandCellMeters = (band) => mercPerPx(band) * CELL_PX;

/* One lattice tile. Pure function of (band, tx, ty): the key ↔ bbox bijection now has
 * NOTHING viewport-derived in it. `interior` is the tile's own square in grid-pixel
 * coords; the MARGIN_CELLS ring outside it exists only so the smoothing kernel and the
 * marching-squares stencil have real data on every side — contours are CLIPPED to the
 * interior so neighbouring tiles butt up exactly instead of overlapping. */
export function latticeTile(band, tx, ty) {
  const cell = bandCellMeters(band);
  const span = TILE_CELLS * cell;
  const width = TILE_CELLS + 2 * MARGIN_CELLS;
  const height = width;
  const bbox = {
    xmin: tx * span - MARGIN_CELLS * cell,
    ymin: ty * span - MARGIN_CELLS * cell,
    xmax: (tx + 1) * span + MARGIN_CELLS * cell,
    ymax: (ty + 1) * span + MARGIN_CELLS * cell,
  };
  return {
    key: `dem:L${band}:${tx},${ty}`,
    zoom: band, band, tx, ty, cellMeters: cell, width, height, bbox,
    interior: { x0: MARGIN_CELLS, y0: MARGIN_CELLS, x1: MARGIN_CELLS + TILE_CELLS, y1: MARGIN_CELLS + TILE_CELLS },
    // Global cell index of local pixel (0,0) — lets the flow pass phase its sample
    // lattice to the WORLD, so arrows don't bunch or gap at a tile seam.
    originCellX: tx * TILE_CELLS - MARGIN_CELLS,
    originCellY: ty * TILE_CELLS - MARGIN_CELLS,
  };
}

/* The ONE lattice tile that contains a WGS84 point at `band`. Same purity as
 * latticeTile — the tile a point falls in never depends on the viewport, which is what
 * lets the cursor-warm grid (NEW-2) be a plain cache HIT of the tile the contour layer
 * already asked for at that zoom. */
export function latticeTileAt(lat, lng, band) {
  const span = TILE_CELLS * bandCellMeters(band);
  return latticeTile(band, Math.floor(lngToMercX(lng) / span), Math.floor(latToMercY(lat) / span));
}

/* Every lattice tile covering a WGS84 view, plus the band actually used.
 * The band comes from the ZOOM, so a pan can never change it. It steps DOWN (coarser)
 * only when a very large window would need more tiles than `maxTiles` — the one
 * remaining viewport dependence, and the caller states it in the layer note
 * (`coarsened`) rather than quietly painting 1-ft lines off a coarse grid. */
export function latticeCover(bounds, zoom, {
  maxTiles = LATTICE_MAX_TILES, maxBand = LATTICE_MAX_BAND, minBand = LATTICE_MIN_BAND,
} = {}) {
  const nominal = Math.min(maxBand, Math.max(minBand, Math.round(zoom)));
  const x0 = lngToMercX(bounds.west), x1 = lngToMercX(bounds.east);
  const y0 = latToMercY(bounds.south), y1 = latToMercY(bounds.north);
  let band = nominal;
  for (;;) {
    const span = TILE_CELLS * bandCellMeters(band);
    const tx0 = Math.floor(x0 / span), tx1 = Math.floor(x1 / span);
    const ty0 = Math.floor(y0 / span), ty1 = Math.floor(y1 / span);
    const n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    if (n <= maxTiles || band <= minBand) {
      const tiles = [];
      for (let ty = ty1; ty >= ty0; ty--) for (let tx = tx0; tx <= tx1; tx++) tiles.push(latticeTile(band, tx, ty));
      return { band, nominal, coarsened: band < nominal, cellMeters: bandCellMeters(band), tiles };
    }
    band--;
  }
}

/* The exportImage URL for a grid request. `base` is the service root — the caller picks
 * the same-origin cache proxy or the direct agency URL (proxy→direct fallback lives in
 * terrainLayers, mirroring wireRaster). Requirements probed against the live service:
 * format=lerc + pixelType=F32 + renderingRule None returns LERC1; size must MATCH the
 * bbox aspect and adjustAspectRatio=false is sent anyway (a silently adjusted bbox
 * would shift every contour); explicit bilinear interpolation (at z16 we downsample
 * ~1 m LiDAR — nearest-neighbor would inject fake 1-ft jaggies). */
export function exportUrl(req, base = DEP_URL) {
  const { bbox, width, height } = req;
  const rule = encodeURIComponent(JSON.stringify({ rasterFunction: "None" }));
  return `${base}/exportImage?bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}` +
    `&bboxSR=3857&imageSR=3857&size=${width},${height}&format=lerc&pixelType=F32` +
    `&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation` +
    `&adjustAspectRatio=false&renderingRule=${rule}&f=image`;
}

/* LERC magic-byte sniff. The dev server SPA-fallbacks /api/* to index.html (200,
 * text/html) and the deployed proxy fails open with a 302 — so "response arrived" is
 * NOT "response is a grid". Anything that fails this sniff triggers the direct-agency
 * retry, and failing that, a LOUD failed status — never a silent parse of garbage. */
export function looksLikeLerc(buf) {
  if (!buf || buf.byteLength < 10) return false;
  const head = String.fromCharCode(...new Uint8Array(buf, 0, 9));
  return head.startsWith("CntZImage") || head.startsWith("Lerc2");
}

/* decodeGrid — the one LERC-codec consumer — now lives in ./lercGrid.js (B1042), so the
 * ~22 KB `lerc` decoder stays off the Site route's boot bundle. It is only reachable
 * after a grid has actually been fetched (contours / drainage arrows / a drainage
 * check), never during boot. Import it from there:
 *   • terrainWorker.js — statically (the worker is its own bundle)
 *   • terrainLayers.js — dynamically, inside the async fetch it already awaits
 * Everything below this line is codec-free and safe on the critical path. */

/* Masked gaussian smooth (separable). Weights renormalize over VALID cells only, so a
 * void never bleeds a sentinel into its neighbors and edges smooth correctly; void
 * cells stay void. `sigmaCells` in cells (callers convert from ground meters). Returns
 * a new Float32Array; input untouched. */
export function maskedSmooth(values, mask, width, height, sigmaCells) {
  if (!(sigmaCells > 0)) return Float32Array.from(values);
  const r = Math.max(1, Math.ceil(sigmaCells * 3));
  const kern = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) kern[i + r] = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells));
  const pass = (src, w, h, horizontal) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!mask[idx]) { out[idx] = 0; continue; }
        let acc = 0, wsum = 0;
        for (let o = -r; o <= r; o++) {
          const xx = horizontal ? x + o : x, yy = horizontal ? y : y + o;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          const j = yy * w + xx;
          if (!mask[j]) continue;
          const wt = kern[o + r];
          acc += src[j] * wt; wsum += wt;
        }
        out[idx] = wsum > 0 ? acc / wsum : 0;
      }
    }
    return out;
  };
  return pass(pass(values, width, height, true), width, height, false);
}

// --- Grid-space <-> world transforms (the one place the pixel convention lives) -----
// A cell's VALUE sits at its CENTER: pixel (px, py) in continuous grid coords maps to
// mercator x = xmin + px·cell, y = ymax − py·cell, and cell (i, j)'s center is at
// (i + 0.5, j + 0.5). d3-contour emits ring coordinates in this same continuous space
// (its (0,0) is the top-left CORNER of cell (0,0)) — pinned by the ramp calibration
// test in test/contours.test.js; if that test moves, this comment is stale, not law.
export const pixelToMerc = (req, px, py) => [
  req.bbox.xmin + px * req.cellMeters,
  req.bbox.ymax - py * req.cellMeters,
];
export const mercToPixel = (req, x, y) => [
  (x - req.bbox.xmin) / req.cellMeters,
  (req.bbox.ymax - y) / req.cellMeters,
];
export const pixelToLatLng = (req, px, py) => {
  const [x, y] = pixelToMerc(req, px, py);
  return [mercYToLat(y), mercXToLng(x)];
};

/* Bilinear elevation sample at a WGS84 point, in FEET — the B706 hover readout. Runs on
 * the UNSMOOTHED grid so it agrees with the cross-section tool (same DEM, same
 * interpolation). Returns null when outside the grid or when ANY contributing cell is
 * void — never interpolate across a void (a confident number over water is a lie). */
export function sampleAtLatLng(grid, req, lat, lng) {
  const [px, py] = mercToPixel(req, lngToMercX(lng), latToMercY(lat));
  const fx = px - 0.5, fy = py - 0.5;            // cell centers at (i+0.5, j+0.5)
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= grid.width || y0 + 1 >= grid.height) return null;
  const { values, mask, width } = grid;
  const i00 = y0 * width + x0, i10 = i00 + 1, i01 = i00 + width, i11 = i01 + 1;
  if (!mask[i00] || !mask[i10] || !mask[i01] || !mask[i11]) return null;
  const tx = fx - x0, ty = fy - y0;
  const top = values[i00] * (1 - tx) + values[i10] * tx;
  const bot = values[i01] * (1 - tx) + values[i11] * tx;
  return top * (1 - ty) + bot * ty;
}
