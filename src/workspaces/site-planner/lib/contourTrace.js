/* Contour TRACING — the marching-squares half of the terrain pipeline (B704).
 *
 * SPLIT OUT OF `contours.js` (B1095): this half is WORKER-ONLY — `terrainWorker.js` is
 * its sole caller — and it is the only consumer of the `d3-contour` dependency. While it
 * lived alongside the paint-time helpers, every byte of the tracer AND of d3-contour rode
 * the Site route's boot bundle purely so the worker could import them, which is exactly
 * the `lercGrid.js` split (B1042) one module over. `contours.js` keeps the main-thread
 * half (label text, seam-join, label thinning, the composed paint, the hover hit-test)
 * and now imports nothing from here, so neither this file nor d3-contour reaches the page.
 *
 * Pure — no Leaflet/DOM; runs inside the worker and in plain-node tests.
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
 *
 * NEW-2 adds a third pass and changes how labels are chosen:
 *  - CLIP TO THE TILE INTERIOR. A lattice tile carries a smoothing margin all round;
 *    tracing runs over the whole padded grid (so the stencil always has real data) and
 *    the result is CUT — not dropped — at the interior square. Neighbouring lattice
 *    tiles share that square's edge exactly, so their lines meet instead of breaking,
 *    and `joinSeams` stitches the two halves back into one polyline at paint time.
 *    Clipping happens BEFORE simplification, so the cut endpoint is an exact point on
 *    the shared edge (Douglas–Peucker always keeps first/last).
 *  - DETERMINISTIC LABEL ANCHORS. Labels are anchored from the polyline's OWN geometry
 *    in tile space — a vertex past each fixed arc-length step — so the same ground
 *    always labels in the same place. The old "longest N runs in view" chooser re-rolled
 *    on every recompute, which is why the same strip read 150 ft in one view and 155 ft
 *    in the next. Capping is now a DISPLAY filter (`pickLabels`), never the chooser.
 */
import { contours as d3contours } from "d3-contour";
import { douglasPeucker } from "./vectorLayers.js";
import { clipPolyline, chaikin, polylineLength, pointAlong, expandRing } from "./polylineClip.js";

const BORDER_EPS = 0.01;   // ring coords sit exactly on 0/width/height when frame-closed
const SIMPLIFY_TOL = 0.5;  // Douglas–Peucker in CELLS (~1 screen px at CELL_PX=2)
const MIN_RUN_CELLS = 2;   // drop sub-2-cell specks (LiDAR noise survives smoothing)
const LABEL_ARC_CELLS = 500;   // one anchor per this much contour arc, measured IN TILE SPACE
const LABEL_MIN_RUN_CELLS = 12; // a label on a 3-cell squiggle is noise, not information

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

/* Liang–Barsky segment clip against an axis-aligned rect. Returns the clipped
 * [a, b] or null when the segment misses the rect entirely. Pure; exported for tests. */
export function clipSegment(a, b, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - r.x0, r.x1 - a[0], a[1] - r.y0, r.y1 - a[1]];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; } // parallel and outside
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  if (!(t1 > t0)) return null; // a grazing touch is not a line
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/* Clip a polyline to a rect, CUTTING it into the sub-runs that lie inside rather than
 * dropping anything that touches the edge. The cut endpoint lands exactly on the rect
 * edge, which is what lets two lattice tiles' halves of one contour meet. Pure. */
export function clipRun(run, rect) {
  const out = [];
  let cur = null;
  const same = (p, r) => p[0] === r[0] && p[1] === r[1];
  for (let i = 0; i < run.length - 1; i++) {
    const seg = clipSegment(run[i], run[i + 1], rect);
    if (!seg) { if (cur) { out.push(cur); cur = null; } continue; }
    if (cur && !same(cur[cur.length - 1], seg[0])) { out.push(cur); cur = null; }
    if (!cur) cur = [seg[0]];
    cur.push(seg[1]);
  }
  if (cur) out.push(cur);
  return out.filter((r) => r.length >= 2);
}

/* Anchor label points on ONE polyline, deterministically, from its own arc length.
 * Anchors sit at (k + ½)·arcStep along the run; a run shorter than one step still gets
 * a single anchor at its midpoint (short lines are the common case inside a tile).
 * The chosen point is a real VERTEX of the line — the label sits ON the contour. */
export function anchorLabels(run, { arcStep = LABEL_ARC_CELLS, minRun = LABEL_MIN_RUN_CELLS } = {}) {
  const total = runLenCells(run);
  if (!(total >= minRun)) return [];
  const targets = [];
  for (let k = 0; (k + 0.5) * arcStep < total; k++) targets.push((k + 0.5) * arcStep);
  if (!targets.length) targets.push(total / 2);
  const out = [];
  let ti = 0, acc = 0;
  for (let i = 1; i < run.length && ti < targets.length; i++) {
    acc += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    while (ti < targets.length && acc >= targets[ti]) {
      out.push({ px: run[i][0], py: run[i][1], anchorIndex: ti });
      ti++;
    }
  }
  return out;
}

/* Build contour polylines from a smoothed grid.
 * grid: { values: Float32Array (FEET, voids zeroed), mask, width, height }.
 * opts.clip: {x0,y0,x1,y1} in grid-pixel coords — the lattice tile's INTERIOR square;
 *   lines are cut to it so adjacent tiles meet exactly (omit for an unclipped grid).
 * Returns { interval, levels: [{ level, isIndex, lines: [[[px,py],…],…] }],
 *           labels: [{ px, py, level, anchor }], validMin, validMax } — pixel space.
 * `anchor` identifies the label WITHIN its level ("<lineIndex>:<anchorIndex>"): together
 * with the tile key it is the dedupe identity that makes a double-stamp impossible. */
export function buildContours(grid, {
  maxLevels = 50, labelCap = 40, indexEvery = 5, clip = null,
  labelArcCells = LABEL_ARC_CELLS, labelMinRunCells = LABEL_MIN_RUN_CELLS,
  interval: forcedInterval = null,   // ROUND 4 (B2349122): the proposed-surface contours ride the EXISTING layer's interval
  /* NEW-1 (Imagery & Layers): the owner's chosen Interval (1/2/5/10 ft) as a FLOOR under the automatic pick, so a
   * steep view that must coarsen to stay readable still does, but a flat Houston view traces at the chosen step. */
  minInterval = null,
} = {}) {
  const { values, mask, width, height } = grid;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return { interval: 1, levels: [], labels: [], validMin: null, validMax: null };
  const interval = forcedInterval > 0 ? forcedInterval : Math.max(minInterval > 0 ? minInterval : 0, pickInterval(max - min, maxLevels));
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
        for (const stripped of stripRing(ring, width, height, voids)) {
          // Clip BEFORE simplifying: Douglas–Peucker keeps first/last, so the cut point
          // stays exactly on the tile's interior edge and the neighbour's half meets it.
          const runs = clip ? clipRun(stripped, clip) : [stripped];
          for (const run of runs) {
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
            if (isIndex) {
              const li = lines.length;
              for (const a of anchorLabels(simp, { arcStep: labelArcCells, minRun: labelMinRunCells })) {
                labelCandidates.push({ level, px: a.px, py: a.py, anchor: `${li}:${a.anchorIndex}` });
              }
            }
            lines.push(simp);
          }
        }
      }
    }
    if (lines.length) levels.push({ level, isIndex, lines });
  }
  // The anchors above ARE the label set — deterministic in tile space, in emission
  // order. `labelCap` is only a per-tile safety bound on how many cross the wire; the
  // real display thinning is pickLabels, over already-anchored labels.
  const labels = labelCandidates.slice(0, labelCap);
  return { interval, levels, labels, validMin: min, validMax: max };
}


/* ROUND 5 (NEW-2 / NEW-3) — PROPOSED contours off the contour lattice (proposedSurface.contourLatticeSteps): marching
 * squares with linear interpolation along cell edges (d3's default — never a cell-edge staircase), then per line:
 *   1. CLIP to the daylight line (`clipRings` − `clipHoles`, lattice px): nothing proposed is drawn outside it, and the
 *      cut endpoint is the exact crossing — the existing layer is cut by the SAME clipper on the other side, so the two
 *      families meet there (polylineClip.js);
 *   2. CUT out of every building pad (`cutRings`): the pad is flat at the FFE, so a line that interpolates across the
 *      dock wall's vertical step inside one cell is the wall, not a contour — it is removed with the stub it leaves;
 *   3. pieces shorter than `minPieceCells` are dropped;
 *   4. Chaikin smoothing (`smoothPasses`, endpoints kept ON the daylight line), then a light Douglas–Peucker;
 *   5. ONE label per index-contour piece, at its middle, with the line's own angle there (`angle`, radians, lattice
 *      px frame = the feet frame's orientation), only on a piece at least `labelMinCells` long.
 * Lines in LATTICE PIXEL coordinates. Pure; the worker's `contours-proposed` job is its only runtime caller. */
const PROPOSED_SIMPLIFY_TOL = 0.12; // cells — after smoothing; keeps the vertex count sane without re-cornering
const PAD_CUT_EXPAND_CELLS = 1.0;   // the wall's own interpolation band (one cell either side of the pad ring) is cut too
/* The daylight line off the lattice's own field (`inside`: +1 graded, −1 existing, signed across the band): the +0 iso,
 * interpolated — closed rings in lattice px, split into outers and holes by winding. */
export function traceDaylight(inside, width, height) {
  const rings = [], holes = [];
  const polys = d3contours().size([width, height]).thresholds([0])(inside);
  for (const poly of polys) for (const polygon of poly.coordinates) polygon.forEach((ring, i) => { if (ring.length >= 4) (i === 0 ? rings : holes).push(ring); });
  return { rings, holes };
}
export function buildProposedContours(grid, {
  interval = 1, clipRings = null, clipHoles = null, cutRings = [], smoothPasses = 2, minPieceCells = 1, labelMinCells = 8, inside = null,
} = {}) {
  const base = buildContours(grid, { interval, maxLevels: 400, labelCap: 0, indexEvery: 5 });
  // the graded area (the daylight line) off the lattice's own field; an explicit outer clip (boundary mode: the setback
  // and its holes) is applied as well — a line is kept only inside BOTH
  const daylight = inside ? traceDaylight(inside, grid.width, grid.height) : { rings: [], holes: [] };
  const clips = [];
  if (daylight.rings.length) clips.push([...daylight.rings, ...daylight.holes]);
  if (clipRings && clipRings.length) clips.push([...clipRings, ...(clipHoles || [])]);
  const cutWide = cutRings.map((r) => expandRing(r, PAD_CUT_EXPAND_CELLS));
  const levels = [], labels = [];
  for (const lv of base.levels) {
    const lines = [];
    for (const run of lv.lines) {
      let pieces0 = [run];
      for (const clip of clips) pieces0 = pieces0.flatMap((p) => clipPolyline(p, clip, { keepInside: true }));
      for (const p0 of pieces0) {
        const pieces = cutWide.length ? clipPolyline(p0, cutWide, { keepInside: false }) : [p0];
        for (const piece of pieces) {
          if (piece.length < 2 || polylineLength(piece) < minPieceCells) continue;
          let sm = smoothPasses > 0 ? chaikin(piece, smoothPasses) : piece;
          if (sm.length > 3) sm = douglasPeucker(sm, PROPOSED_SIMPLIFY_TOL);
          // smoothing a line that rounds a corner can pull a vertex over a ring: cut once more — inside every clip, and
          // on the pad itself (the first cut took the wall's band with it; this one keeps the ring exact)
          let finals = [sm];
          for (const clip of clips) finals = finals.flatMap((p) => clipPolyline(p, clip, { keepInside: true }));
          if (cutRings.length) finals = finals.flatMap((p) => clipPolyline(p, cutRings, { keepInside: false }));
          for (const fl of finals) {
            if (fl.length < 2 || polylineLength(fl) < minPieceCells) continue;
            const len = polylineLength(fl);
            if (lv.isIndex && len >= labelMinCells) {
              const m = pointAlong(fl, 0.5);
              labels.push({ level: lv.level, px: m.x, py: m.y, angle: m.angle, lenCells: len, anchor: `${lines.length}:0` });
            }
            lines.push(fl);
          }
        }
      }
    }
    if (lines.length) levels.push({ level: lv.level, isIndex: lv.isIndex, lines });
  }
  return { interval: base.interval, levels, labels, daylight, validMin: base.validMin, validMax: base.validMax };
}
