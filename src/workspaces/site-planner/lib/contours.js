/* Contour-line math for the terrain pipeline (B704). Pure — no Leaflet/DOM; runs
 * inside the terrain Web Worker and in plain-node tests.
 *
 * Input is the decoded, smoothed DEM grid (FEET, with validity mask) from demGrid.js;
 * output is polylines + label points in GRID/PIXEL coordinates (the worker transforms
 * them to lat/lng with demGrid's pixelToLatLng — one transform, one convention, pinned
 * by the ramp calibration test).
 *
 * The two strip passes matter as much as the marching squares itself:
 *  - d3-contour returns CLOSED polygons, closed along the grid border — rendered
 *    naively every level would paint a rectangle frame around the view.
 *  - every level's polygon also hugs no-data voids (water), stacking N polylines
 *    along every pond edge — segments touching a DILATED void mask are dropped, so
 *    contour lines BREAK at water instead of bridging or outlining it.
 * Both passes split rings into open runs; the cyclic run-walk below is that code.
 */
import { contours as d3contours } from "d3-contour";
import { douglasPeucker } from "./vectorLayers.js";

const BORDER_EPS = 0.01;   // ring coords sit exactly on 0/width/height when frame-closed
const SIMPLIFY_TOL = 0.5;  // Douglas–Peucker in CELLS (~1 screen px at CELL_PX=2)
const MIN_RUN_CELLS = 2;   // drop sub-2-cell specks (LiDAR noise survives smoothing)

/* Pick the contour interval for an elevation range so the view never drowns in lines:
 * 1 ft is the workhorse (the whole point of B704 — Houston sites span a handful of
 * feet); a steeper view (hill country) auto-coarsens. Pure. */
export function pickInterval(rangeFt, maxLevels = 50) {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    if (rangeFt / step <= maxLevels) return step;
  }
  return 100;
}

/* Dilate the VOID set by one cell (8-neighborhood): returns Uint8Array where 1 = void
 * or void-adjacent. Contour segments whose midpoint lands here are stripped — the
 * one-cell halo catches the ring that marching squares draws along the void edge. */
export function dilateVoids(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < width && yy >= 0 && yy < height) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

const onBorder = (p, width, height) =>
  p[0] < BORDER_EPS || p[0] > width - BORDER_EPS ||
  p[1] < BORDER_EPS || p[1] > height - BORDER_EPS;

const inVoid = (voids, width, height, x, y) => {
  const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
  return voids[cy * width + cx] === 1;
};

/* Split one closed ring into the open runs that survive the border + void strips.
 * Cyclic-aware: a run crossing the ring's start/end joint is merged, and a ring with
 * every edge kept comes back as ONE closed run (first === last). Exported for tests. */
export function stripRing(ring, width, height, voids) {
  const pts = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  const n = pts.length;
  if (n < 2) return [];
  const keep = new Array(n);
  let keptAll = true;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ok = !onBorder(a, width, height) && !onBorder(b, width, height) &&
      !inVoid(voids, width, height, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    keep[i] = ok;
    if (!ok) keptAll = false;
  }
  if (keptAll) return [pts.concat([pts[0]])]; // fully clean → one closed ring
  // Walk the cycle starting just after a dropped edge, accumulating kept stretches.
  let start = 0;
  while (start < n && keep[start]) start++;
  const runs = [];
  let cur = null;
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    if (keep[i]) {
      if (!cur) cur = [pts[i]];
      cur.push(pts[(i + 1) % n]);
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}

const runLenCells = (run) => {
  let l = 0;
  for (let i = 1; i < run.length; i++) l += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
  return l;
};

/* Build contour polylines from a smoothed grid.
 * grid: { values: Float32Array (FEET, voids zeroed), mask, width, height }.
 * Returns { interval, levels: [{ level, isIndex, lines: [[[px,py],…],…] }],
 *           labels: [{ px, py, level }], validMin, validMax } — pixel space. */
export function buildContours(grid, { maxLevels = 50, labelCap = 30, indexEvery = 5 } = {}) {
  const { values, mask, width, height } = grid;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return { interval: 1, levels: [], labels: [], validMin: null, validMax: null };
  const interval = pickInterval(max - min, maxLevels);
  const first = Math.ceil(min / interval) * interval;
  const thresholds = [];
  for (let lv = first; lv <= max; lv += interval) thresholds.push(lv);
  if (!thresholds.length) return { interval, levels: [], labels: [], validMin: min, validMax: max };

  // Sentinel-embed the voids: far below every real level, so marching squares treats
  // them as "deep below" (never NaN — d3's smoothing would emit NaN coordinates).
  let work = values;
  const sentinel = min - 1000;
  let hasVoid = false;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) { hasVoid = true; break; }
  if (hasVoid) {
    work = Float32Array.from(values);
    for (let i = 0; i < mask.length; i++) if (!mask[i]) work[i] = sentinel;
  }
  const voids = dilateVoids(mask, width, height);

  const gen = d3contours().size([width, height]).thresholds(thresholds);
  const polys = gen(work);
  const levels = [];
  const labelCandidates = [];
  for (const poly of polys) {
    const level = poly.value;
    const isIndex = Math.round(level) % (interval * indexEvery) === 0;
    const lines = [];
    for (const polygon of poly.coordinates) {
      for (const ring of polygon) {
        for (const run of stripRing(ring, width, height, voids)) {
          if (run.length < 2 || runLenCells(run) < MIN_RUN_CELLS) continue;
          const closed = run.length > 3 &&
            run[0][0] === run[run.length - 1][0] && run[0][1] === run[run.length - 1][1];
          let simp;
          if (closed) {
            simp = douglasPeucker(run.slice(0, -1), SIMPLIFY_TOL);
            simp = simp.concat([simp[0]]);
            if (simp.length < 4) continue;
          } else {
            simp = douglasPeucker(run, SIMPLIFY_TOL);
            if (simp.length < 2) continue;
          }
          lines.push(simp);
          if (isIndex) labelCandidates.push({ level, line: simp, len: runLenCells(simp) });
        }
      }
    }
    if (lines.length) levels.push({ level, isIndex, lines });
  }
  // Sparse labels: longest index runs first, one label at the run's middle vertex.
  labelCandidates.sort((a, b) => b.len - a.len);
  const labels = labelCandidates.slice(0, labelCap).map(({ level, line }) => {
    const mid = line[Math.floor(line.length / 2)];
    return { px: mid[0], py: mid[1], level };
  });
  return { interval, levels, labels, validMin: min, validMax: max };
}
