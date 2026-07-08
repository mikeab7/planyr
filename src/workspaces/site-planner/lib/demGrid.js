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
 * SR (probed 2026-07-07) and what the Leaflet map draws in. A grid request snaps the
 * view outward to a deterministic cell-aligned tile (key ↔ bbox is a bijection, so a
 * pan inside the tile is a pure cache hit and the smoothing margin is baked in — no
 * seams: ONE grid covers the view). Elevations convert to survey feet on decode
 * (M_TO_FT — every 3DEP consumer converts identically; NAVD88 orthometric heights,
 * the same vertical datum FEMA BFEs use).
 */
import Lerc from "lerc";
import { DEP_URL, M_TO_FT } from "./elevation.js";

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

/* Decode a LERC payload into the working grid. Returns
 *   { values: Float32Array (FEET), mask: Uint8Array (1 = valid), width, height }
 * merged with the request geometry. Voids come in two shapes (both handled): an
 * explicit LERC validity mask, and cells equal to the F32 noData sentinel from the
 * band statistics — either becomes mask=0, and the value is left NaN-free (0) so
 * downstream math never meets NaN (d3-contour's smoothing would emit NaN coords). */
export function decodeGrid(buf, req) {
  if (!looksLikeLerc(buf)) throw new Error("not a LERC payload");
  const d = Lerc.decode(buf);
  if (!d || !d.pixels || !d.pixels[0]) throw new Error("LERC decode failed");
  if (req && ((d.width !== req.width) || (d.height !== req.height))) {
    // A silently resized export means the server adjusted our bbox — georeferencing
    // would be wrong everywhere. Refuse loudly rather than draw shifted contours.
    throw new Error(`grid size mismatch: got ${d.width}x${d.height}, asked ${req.width}x${req.height}`);
  }
  const src = d.pixels[0];
  const n = src.length;
  const noData = d.statistics && d.statistics[0] && d.statistics[0].noDataValue;
  const values = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = src[i];
    const bad = !isFinite(v) ||
      (noData != null && v === noData) ||
      (d.mask && !d.mask[i]) ||
      v < -1000; // physical floor: 3DEP min is ~-60 m (Death Valley); a huge negative is a sentinel
    if (bad) { values[i] = 0; mask[i] = 0; }
    else { values[i] = v * M_TO_FT; mask[i] = 1; }
  }
  return { values, mask, width: d.width, height: d.height };
}

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
