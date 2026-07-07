/* Terrain Web Worker (B704/B705) — the repo's first dedicated worker. All the heavy
 * work happens here so the UI never stutters: LERC decode, masked smoothing, marching
 * squares, and the flow-field pass on a 1M-cell grid take tens of milliseconds that
 * would otherwise be dropped frames.
 *
 * ⚠ IMPORT DISCIPLINE: this file may import ONLY the pure terrain modules (demGrid /
 * contours / flowField and, through them, lerc + d3-contour + elevation constants).
 * Anything that transitively touches Leaflet, React, or the DOM crashes at WORKER
 * RUNTIME, not at build time — test/terrainWorker.test.js pins the import list.
 *
 * The network fetch deliberately does NOT live here: the main thread fetches (so the
 * bytes ride gisCache + the proxy→direct fallback beside their precedents) and
 * transfers the ArrayBuffer in; the decoded grid transfers back out (zero copies).
 *
 * Message protocol:
 *   in:  { id, req, buffer, opts? }         (buffer transferred)
 *   out: { id, ok: true, contours, arrows, grid: {values, mask, width, height} }
 *        (grid buffers transferred — the main thread keeps them for the B706 readout)
 *   or   { id, ok: false, error }           (LOUD — the layer shows a failed status)
 */
import {
  decodeGrid, maskedSmooth, pixelToLatLng, groundScale, mercYToLat, MARGIN_CELLS,
} from "./demGrid.js";
import { buildContours } from "./contours.js";
import { flowArrows } from "./flowField.js";

// Smoothing sigmas are spec'd in GROUND METERS (same terrain detail at every zoom)
// then converted to cells per grid — but CAPPED in cells so the kernel radius
// (3σ, see maskedSmooth) never exceeds the tile's baked-in MARGIN_CELLS; otherwise
// edge cells would smooth differently on each side of a tile change and contours
// would visibly pop on pan. 1-m LiDAR carries ±0.1–0.3 ft noise → unsmoothed 1-ft
// contours are jagged spaghetti; flow direction needs a harder hand than contours.
const SIGMA_CAP_CELLS = (MARGIN_CELLS - 1) / 3;   // 3σ ≤ margin − 1
const CONTOUR_SIGMA_M = 3;
const FLOW_SIGMA_M = 12;

const round6 = (v) => Math.round(v * 1e6) / 1e6;

self.onmessage = (e) => {
  const { id, req, buffer, opts = {} } = e.data || {};
  try {
    const grid = decodeGrid(buffer, req);
    const { values, mask, width, height } = grid;
    const gk = groundScale(mercYToLat((req.bbox.ymin + req.bbox.ymax) / 2));
    const groundCell = req.cellMeters * gk;
    const toLL = (px, py) => {
      const [lat, lng] = pixelToLatLng(req, px, py);
      return [round6(lat), round6(lng)];
    };

    const sigmaC = Math.min(SIGMA_CAP_CELLS, (opts.contourSigmaM ?? CONTOUR_SIGMA_M) / groundCell);
    const c = buildContours({
      values: maskedSmooth(values, mask, width, height, sigmaC),
      mask, width, height,
    });
    const contours = {
      interval: c.interval,
      levels: c.levels.map((l) => ({
        level: l.level, isIndex: l.isIndex,
        lines: l.lines.map((line) => line.map((p) => toLL(p[0], p[1]))),
      })),
      labels: c.labels.map((lb) => ({ ll: toLL(lb.px, lb.py), level: lb.level })),
    };

    const sigmaF = Math.min(SIGMA_CAP_CELLS, (opts.flowSigmaM ?? FLOW_SIGMA_M) / groundCell);
    const arrows = flowArrows(
      { values: maskedSmooth(values, mask, width, height, sigmaF), mask, width, height },
      {
        cellMeters: req.cellMeters, groundK: gk,
        spacingCells: opts.arrowSpacingCells ?? 35,   // ≈70 screen px at 2 px/cell
        minSlope: opts.minSlope ?? 0.0008,
        marginCells: MARGIN_CELLS,
      },
    ).map((a) => ({ ll: toLL(a.px, a.py), dir: Math.round(a.dir * 1e3) / 1e3, slope: Math.round(a.slope * 1e5) / 1e5 }));

    // The RAW (unsmoothed) grid goes back for the hover readout — it must agree with
    // the cross-section tool, not with the smoothed cartography. Buffers transfer.
    self.postMessage(
      { id, ok: true, contours, arrows, grid: { values, mask, width, height } },
      [values.buffer, mask.buffer],
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
