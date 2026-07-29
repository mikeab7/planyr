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
import { WEB_MERC_R, mercYToLat, groundScale } from "./demGrid.js";

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

// ---------------------------------------------------------------------------
// Paint-time helpers (pure, main-thread — the worker never calls these).

/* THE ONE PLACE a contour label's text is built. The unit is appended HERE and only
 * here, so no code path can ever produce "150 ft ft" by concatenating twice.
 * (test/terrainLattice.test.js guards the rendered output against a doubled unit.) */
export function contourLabelText(level) {
  if (level == null || level === "") return "";
  const n = Number(level);
  if (!Number.isFinite(n)) return "";
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10} ft`;
}

/* Stitch polylines whose endpoints coincide — the two halves of one contour that the
 * tile clip cut at a shared lattice edge. Coordinates are [lat, lng]; `eps` matches the
 * 1e-6° rounding the worker applies. Closed rings pass through untouched. Pure. */
export function joinSeams(lines, eps = 2e-6) {
  const out = [], open = [];
  for (const ln of lines) {
    if (!ln || ln.length < 2) continue;
    const a = ln[0], b = ln[ln.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.push(ln);
    else open.push(ln);
  }
  // Chain in a CANONICAL order, not arrival order. Where three or more endpoints meet (a
  // saddle), which pair chains would otherwise depend on which tile resolved first — and
  // "depends on network timing" is precisely the class of bug this whole change removes.
  const rank = (ln) => `${ln[0][0]},${ln[0][1]}|${ln[ln.length - 1][0]},${ln[ln.length - 1][1]}|${ln.length}`;
  const byRank = (x, y) => (rank(x) < rank(y) ? -1 : rank(x) > rank(y) ? 1 : 0);
  open.sort(byRank);
  out.sort(byRank);
  const bucket = new Map();
  const key = (p) => `${Math.round(p[0] / eps)}|${Math.round(p[1] / eps)}`;
  open.forEach((ln, i) => {
    for (const [p, end] of [[ln[0], 0], [ln[ln.length - 1], 1]]) {
      const k = key(p);
      let l = bucket.get(k);
      if (!l) bucket.set(k, l = []);
      l.push({ i, end });
    }
  });
  const near = (p) => {
    const bx = Math.round(p[0] / eps), by = Math.round(p[1] / eps);
    const hits = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const l = bucket.get(`${bx + dx}|${by + dy}`);
        if (l) for (const r of l) hits.push(r);
      }
    }
    return hits;
  };
  const meets = (p, r) => Math.abs(p[0] - r[0]) <= eps && Math.abs(p[1] - r[1]) <= eps;
  const used = new Array(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = open[i].slice();
    for (const forward of [true, false]) {
      for (let guard = 0; guard < 256; guard++) {
        const tip = forward ? chain[chain.length - 1] : chain[0];
        let hit = null;
        for (const ref of near(tip)) {
          if (used[ref.i]) continue;
          const cand = open[ref.i];
          if (meets(tip, ref.end === 0 ? cand[0] : cand[cand.length - 1])) { hit = ref; break; }
        }
        if (!hit) break;
        used[hit.i] = true;
        const seg = hit.end === 0 ? open[hit.i] : open[hit.i].slice().reverse(); // starts at the joint
        chain = forward ? chain.concat(seg.slice(1)) : seg.slice(1).reverse().concat(chain);
      }
    }
    out.push(chain);
  }
  return out;
}

/* The DISPLAY filter over already-anchored labels (never the chooser).
 *  1. dedupe by (level, tileKey, anchor) — one contour cannot stamp twice even if a
 *     superseded compute slipped a duplicate artifact through;
 *  2. drop a label of the SAME level sitting within `minSepDeg` of one already kept —
 *     this is what keeps two tiles from both labelling the metre either side of a seam;
 *  3. cap the total, for DOM sanity only.
 * Ordering is by (tileKey, level, anchor) — ground-anchored, so the surviving set does
 * not depend on which order the tiles happened to resolve in. Pure. */
export const LABEL_CAP = 60;                // DOM sanity bound only
export const LABEL_MIN_SEP_CELLS = 260;     // two tiles must not both label either side of a seam

export function pickLabels(labels, { minSepDeg = 0, cap = LABEL_CAP } = {}) {
  const id = (l) => `${l.tileKey || ""}|${l.level}|${l.anchor || ""}`;
  const sorted = labels.slice().sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
  const seen = new Set(), out = [];
  for (const lab of sorted) {
    const k = id(lab);
    if (seen.has(k)) continue;
    seen.add(k);
    if (minSepDeg > 0) {
      const kx = Math.cos((lab.ll[0] * Math.PI) / 180);
      const crowded = out.some((o) => o.level === lab.level &&
        Math.hypot((o.ll[1] - lab.ll[1]) * kx, o.ll[0] - lab.ll[0]) < minSepDeg);
      if (crowded) continue;
    }
    out.push(lab);
    if (out.length >= cap) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// NEW-1 — HOVER HIT-TESTING. Only the sparse every-5-ft INDEX lines carry a permanent
// label, so four out of every five contours were unreadable. The lines themselves are
// deliberately `interactive:false` (B704: thousands of 1-ft polylines with Leaflet hit
// areas is the perf cliff), so the answer is a hit-test IN JS over the composed geometry
// — the picture stays a plain canvas paint, and the cursor still gets an answer.
//
// The index is a flat spatial bucket over the composed lat/lng lines: a cursor probe
// touches a handful of buckets instead of every segment in view. B1088's fixed world
// lattice is what makes a hit STABLE — the same ground is always traced from the same
// cells, so the line under the cursor carries the same elevation from one frame to the
// next. Pure (no Leaflet, no DOM) so it unit-tests in plain node.

export const HOVER_TOL_PX = 6;        // how close the cursor must come to a line, in CSS px
export const DOUBLE_STAMP_PX = 40;    // an index label this close already answers — don't stamp twice
const INDEX_CELL_DEG = 0.001;         // ~110 m — a bucket holds a handful of segments at z17
const BIG_SEG_CELLS = 32;             // a segment spanning more than this goes in the always-scanned list

/* Closest point on segment a→b to p, all in DEGREES with longitude pre-scaled by
 * cos(lat) so a degree of longitude and a degree of latitude compare as equal ground.
 * Returns { d, lat, lng } — d in scaled degrees. */
function segDist(pLat, pLng, a, b, kx) {
  const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0];
  const px = pLng * kx, py = pLat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), lat: qy, lng: qx / kx };
}

/* Bucket index over composed contour lines ([{ coords: [[lat,lng],…], level, isIndex }]).
 * Returns { cellDeg, cells: Map<string, seg[]>, big: seg[], count } where a seg is
 * { a, b, level, isIndex }. Pure. */
export function buildContourIndex(lines, { cellDeg = INDEX_CELL_DEG } = {}) {
  const cells = new Map(), big = [];
  let count = 0;
  const put = (k, seg) => {
    let l = cells.get(k);
    if (!l) cells.set(k, l = []);
    l.push(seg);
  };
  for (const ln of lines || []) {
    const coords = ln && ln.coords;
    if (!coords || coords.length < 2) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const seg = { a, b, level: ln.level, isIndex: !!ln.isIndex };
      count++;
      const i0 = Math.floor(Math.min(a[0], b[0]) / cellDeg), i1 = Math.floor(Math.max(a[0], b[0]) / cellDeg);
      const j0 = Math.floor(Math.min(a[1], b[1]) / cellDeg), j1 = Math.floor(Math.max(a[1], b[1]) / cellDeg);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > BIG_SEG_CELLS) { big.push(seg); continue; }
      for (let i2 = i0; i2 <= i1; i2++) for (let j2 = j0; j2 <= j1; j2++) put(`${i2}|${j2}`, seg);
    }
  }
  return { cellDeg, cells, big, count };
}

/* The contour line under the cursor, or null. `tolDeg` is the search radius in degrees
 * of LATITUDE (the caller converts HOVER_TOL_PX through the live map scale, so the
 * tolerance is a constant number of screen pixels at every zoom). Returns
 * { level, isIndex, ll: [lat, lng] (the closest point ON the line), distDeg }. Pure. */
export function hitContour(index, lat, lng, tolDeg) {
  if (!index || !(tolDeg > 0) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kx = Math.max(1e-6, Math.cos((lat * Math.PI) / 180));
  const { cellDeg, cells, big } = index;
  // Longitude spans more cells than latitude for the same ground distance — widen by 1/kx.
  const i0 = Math.floor((lat - tolDeg) / cellDeg), i1 = Math.floor((lat + tolDeg) / cellDeg);
  const j0 = Math.floor((lng - tolDeg / kx) / cellDeg), j1 = Math.floor((lng + tolDeg / kx) / cellDeg);
  let best = null;
  const consider = (seg) => {
    const r = segDist(lat, lng, seg.a, seg.b, kx);
    if (r.d > tolDeg) return;
    // Ties (a cursor equidistant from two lines) resolve by LEVEL, so the answer under a
    // resting cursor cannot depend on segment order — the same determinism rule as B1087.
    if (!best || r.d < best.distDeg - 1e-12 ||
      (Math.abs(r.d - best.distDeg) <= 1e-12 && seg.level < best.level)) {
      best = { level: seg.level, isIndex: seg.isIndex, ll: [r.lat, r.lng], distDeg: r.d };
    }
  };
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const l = cells.get(`${i}|${j}`);
      if (l) for (const seg of l) consider(seg);
    }
  }
  for (const seg of big) consider(seg);
  return best;
}

/* THE ONE composition of a painted contour view, shared by every consumer so screen and
 * test can't drift. `parts` is [{ tile, data }] — one per lattice tile in the cover, in
 * any order and possibly containing a duplicate (a superseded artifact that slipped
 * through). Returns exactly what a renderer needs:
 *   { lines: [{ coords, level, isIndex }], labels: [{ ll, level, text }] }
 * The guarantees this function OWNS, and that test/terrainLattice.test.js exercises
 * against a real captured 3DEP tile:
 *   - one label per (level, tileKey, anchor) — a doubled artifact cannot stamp twice;
 *   - label text carries the unit exactly once (contourLabelText is the only formatter);
 *   - output is identical however the parts are ordered — no re-roll on tile timing;
 *   - halves of one contour cut at a shared lattice edge come back as ONE polyline. */
export function composeContourPaint(parts, { cap = LABEL_CAP, minSepCells = LABEL_MIN_SEP_CELLS } = {}) {
  const byLevel = new Map();
  const labels = [];
  let cellMeters = 0, lat = 0;
  for (const { tile, data } of parts || []) {
    const c = data && data.contours;
    if (!tile || !c || !c.levels) continue;
    if (tile.cellMeters > cellMeters) cellMeters = tile.cellMeters;
    if (tile.bbox) lat = mercYToLat((tile.bbox.ymin + tile.bbox.ymax) / 2);
    for (const lv of c.levels) {
      let e = byLevel.get(lv.level);
      if (!e) byLevel.set(lv.level, e = { level: lv.level, isIndex: lv.isIndex, lines: [] });
      for (const line of lv.lines) e.lines.push(line);
    }
    for (const lab of c.labels || []) labels.push({ ...lab, tileKey: tile.key });
  }
  const lines = [];
  for (const e of [...byLevel.values()].sort((a, b) => a.level - b.level)) {
    for (const coords of joinSeams(e.lines)) lines.push({ coords, level: e.level, isIndex: e.isIndex });
  }
  // Minimum label separation is expressed in CELLS of the band's fixed grid, so it is a
  // property of the ground, not of the window the user happens to have open.
  const minSepDeg = cellMeters
    ? (minSepCells * cellMeters * groundScale(lat) * 180) / (Math.PI * WEB_MERC_R) : 0;
  return {
    lines,
    labels: pickLabels(labels, { minSepDeg, cap })
      .map((l) => ({ ll: l.ll, level: l.level, text: contourLabelText(l.level) })),
  };
}
