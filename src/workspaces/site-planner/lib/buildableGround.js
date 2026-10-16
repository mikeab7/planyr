/* Buildable-ground sweep engine (NEW-1, owner-only grading layer) — "how much of this parcel can be
 * ONE level pad at elevation E with no retaining walls?"
 *
 * Pure, no DOM, no imports — it runs inside the terrain Web Worker (terrainWorker.js pins its import
 * list) and in plain Node for the tests. Feet everywhere; elevations ft NAVD88.
 *
 * THE RULE (owner, 2026-10-16). A lattice cell is pad-able at finish elevation E when
 *   (a) its centre is inside the setback polygon,
 *   (b) |E − z(cell)| ≤ D — the pad never needs more than D ft of cut or fill there, and
 *   (c) the slope off the pad edge DAYLIGHTS before it reaches the setback boundary: no boundary
 *       sample point b lies within s·|E − z(b)| of the cell (s = the grading slope, H per 1 V — the
 *       2:1 slope that runs from a pad edge at E to the ground at b needs s·|E − z(b)| of run).
 *       Implemented as DISC PAINTING from the boundary samples (taken every cell along the setback
 *       edge): each sample blocks every cell centre within its radius. It is the cheap exact-enough
 *       way — no per-cell search over the boundary.
 * Then only the LARGEST 4-connected component of what is left counts: a pad is one piece of ground.
 *
 * The sweep walks E in 1-ft steps over the setback's own ground range, caches per
 * (E, s, D, lattice+setback signature), and reports the E with the largest area as the BEST FINISH.
 *
 * Void ground (NaN lattice value — water / no LiDAR) is never pad-able and never a boundary sample:
 * "no data" must not read as flat ground.
 *
 * Lattice = { x0, y0, nx, ny, cell, z: Float32Array(nx*ny) }  — cell (i,j) centre is
 * (x0 + (i + .5)·cell, y0 + (j + .5)·cell); y grows SOUTH like the planner's feet frame. */

export const CELL_FT = 10;            // the brief: 20 ft is too coarse for the daylight test, 4 ft is too slow
export const DEFAULT_SLOPE = 2;       // 2:1
export const DEFAULT_MAX_DEPTH_FT = 12;
export const SQFT_PER_ACRE = 43560;

/* ---- lattice sampling helpers ---- */

/* Bilinear ground at a feet point from a lattice (cell-centre samples). Null off-lattice or when any
 * contributing cell is void. */
export function latticeZAt(lat, x, y) {
  const fx = (x - lat.x0) / lat.cell - 0.5, fy = (y - lat.y0) / lat.cell - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= lat.nx || j0 + 1 >= lat.ny) return null;
  const a = lat.z[j0 * lat.nx + i0], b = lat.z[j0 * lat.nx + i0 + 1];
  const c = lat.z[(j0 + 1) * lat.nx + i0], d = lat.z[(j0 + 1) * lat.nx + i0 + 1];
  if (!(a === a) || !(b === b) || !(c === c) || !(d === d)) return null;
  const tx = fx - i0, ty = fy - j0;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/* Build a lattice over a feet bbox by calling `sample(x, y)` at each cell centre (null → void).
 * `sample` is the caller's ground reader (the worker passes the resampled B808/3DEP grid). */
export function buildLattice({ bbox, cell = CELL_FT, sample }) {
  const [bx0, by0, bx1, by1] = bbox;
  const x0 = Math.floor(bx0 / cell) * cell, y0 = Math.floor(by0 / cell) * cell;
  const nx = Math.max(1, Math.ceil((bx1 - x0) / cell)), ny = Math.max(1, Math.ceil((by1 - y0) / cell));
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const v = sample(x0 + (i + 0.5) * cell, y);
      z[j * nx + i] = v == null || !isFinite(v) ? NaN : v;
    }
  }
  return { x0, y0, nx, ny, cell, z };
}

/* ---- the sweep context (built once per lattice + setback) ---- */

/* Rasterise "inside any outer ring and not inside any hole" onto the lattice by scanline (even-odd per
 * ring, then union of outers minus union of holes). Rings are [{x,y}] in feet. */
function rasterInside(lat, rings, holes) {
  const { nx, ny, x0, y0, cell } = lat;
  const fillRings = (list, out) => {
    for (const ring of list) {
      if (!ring || ring.length < 3) continue;
      const n = ring.length;
      for (let j = 0; j < ny; j++) {
        const y = y0 + (j + 0.5) * cell;
        const xs = [];
        for (let k = 0; k < n; k++) {
          const a = ring[k], b = ring[(k + 1) % n];
          if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          // cells whose centre lies in [xs[k], xs[k+1])
          const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5));
          const i1 = Math.min(nx - 1, Math.ceil((xs[k + 1] - x0) / cell - 0.5) - 1);
          for (let i = i0; i <= i1; i++) out[j * nx + i] = 1;
        }
      }
    }
  };
  const inside = new Uint8Array(nx * ny);
  fillRings(rings, inside);
  if (holes && holes.length) {
    const h = new Uint8Array(nx * ny);
    fillRings(holes, h);
    for (let k = 0; k < inside.length; k++) if (h[k]) inside[k] = 0;
  }
  return inside;
}

/* Boundary samples every `cell` ft along every ring edge (outer + hole), with the lattice ground at
 * each. A sample over void ground is dropped — see header. Returns parallel typed arrays. */
function boundarySamples(lat, rings, holes) {
  const xs = [], ys = [], zs = [];
  const walk = (ring) => {
    if (!ring || ring.length < 3) return;
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(len / lat.cell));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const z = latticeZAt(lat, x, y);
        if (z == null) continue;
        xs.push(x); ys.push(y); zs.push(z);
      }
    }
  };
  for (const r of rings) walk(r);
  for (const r of holes || []) walk(r);
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs) };
}

const ringSig = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7.13 + ring[i].y * 3.71) * (i + 1);
  return `${ring.length}:${Math.round(h)}`;
};

/* Build the reusable context: inside mask, boundary samples, the setback's own ground range. */
export function prepareSweep({ lattice, rings, holes = [] }) {
  const inside = rasterInside(lattice, rings, holes);
  const bs = boundarySamples(lattice, rings, holes);
  let zMin = Infinity, zMax = -Infinity, nIn = 0;
  for (let k = 0; k < inside.length; k++) {
    if (!inside[k]) continue;
    const z = lattice.z[k];
    if (!(z === z)) continue;
    nIn++;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  return {
    lattice, rings, inside, bs, zMin, zMax, insideCells: nIn,
    insideSf: nIn * lattice.cell * lattice.cell,
    sig: `${lattice.nx}x${lattice.ny}@${lattice.cell}:${lattice.x0},${lattice.y0}|${rings.map(ringSig).join(",")}|${holes.map(ringSig).join(",")}`,
  };
}

/* ---- the mask at one E ---- */

/* The pad-able mask at finish elevation E — the LARGEST 4-connected component of the cells that satisfy
 * (a)(b)(c). Returns { mask: Uint8Array, cells, areaSf, areaAc }. `scratch` lets a sweep reuse buffers. */
export function maskAt(ctx, E, s = DEFAULT_SLOPE, D = DEFAULT_MAX_DEPTH_FT) {
  const { lattice: lat, inside, bs } = ctx;
  const { nx, ny, cell, x0, y0, z } = lat;
  const N = nx * ny;
  const ok = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (!inside[k]) continue;
    const zz = z[k];
    if (zz === zz && Math.abs(E - zz) <= D) ok[k] = 1;
  }
  // (c) disc painting — a boundary sample blocks every cell centre within s·|E − z(b)| of it.
  for (let q = 0; q < bs.x.length; q++) {
    const r = s * Math.abs(E - bs.z[q]);
    if (!(r > 0)) continue;
    const cx = (bs.x[q] - x0) / cell - 0.5, cy = (bs.y[q] - y0) / cell - 0.5;  // sample position in cell-centre index space
    const rc = r / cell, r2 = rc * rc;
    const j0 = Math.max(0, Math.ceil(cy - rc)), j1 = Math.min(ny - 1, Math.floor(cy + rc));
    for (let j = j0; j <= j1; j++) {
      const dy = j - cy;
      const w2 = r2 - dy * dy;
      if (w2 <= 0) continue;
      const w = Math.sqrt(w2);
      // cells whose centre is strictly inside the disc (distance < r)
      const i0 = Math.max(0, Math.floor(cx - w) + 1), i1 = Math.min(nx - 1, Math.ceil(cx + w) - 1);
      for (let i = i0; i <= i1; i++) ok[j * nx + i] = 0;
    }
  }
  // largest 4-connected component
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  let bestLabel = 0, bestCount = 0, nextLabel = 0;
  for (let k = 0; k < N; k++) {
    if (!ok[k] || label[k]) continue;
    nextLabel++;
    let sp = 0, count = 0;
    stack[sp++] = k; label[k] = nextLabel;
    while (sp) {
      const c = stack[--sp];
      count++;
      const i = c % nx, j = (c - i) / nx;
      if (i > 0 && ok[c - 1] && !label[c - 1]) { label[c - 1] = nextLabel; stack[sp++] = c - 1; }
      if (i < nx - 1 && ok[c + 1] && !label[c + 1]) { label[c + 1] = nextLabel; stack[sp++] = c + 1; }
      if (j > 0 && ok[c - nx] && !label[c - nx]) { label[c - nx] = nextLabel; stack[sp++] = c - nx; }
      if (j < ny - 1 && ok[c + nx] && !label[c + nx]) { label[c + nx] = nextLabel; stack[sp++] = c + nx; }
    }
    if (count > bestCount) { bestCount = count; bestLabel = nextLabel; }
  }
  const mask = new Uint8Array(N);
  if (bestLabel) for (let k = 0; k < N; k++) if (label[k] === bestLabel) mask[k] = 1;
  const areaSf = bestCount * cell * cell;
  return { mask, cells: bestCount, areaSf, areaAc: areaSf / SQFT_PER_ACRE };
}

/* ---- the sweep ---- */

/* Sweep E in `step`-ft increments across the setback's own ground range (zMin−D … zMax+D clipped to
 * where any cell can qualify), returning the whole curve and the best finish (first maximum). Cached
 * per (E, s, D, signature) in the module-level `cache` Map. */
const cache = new Map();
const CACHE_MAX = 600;
export function clearSweepCache() { cache.clear(); }

export function cachedMaskAt(ctx, E, s, D) {
  const key = `${ctx.sig}#${E}#${s}#${D}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = maskAt(ctx, E, s, D);
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return r;
}

export function sweep(ctx, { s = DEFAULT_SLOPE, D = DEFAULT_MAX_DEPTH_FT, step = 1, shouldAbort = null } = {}) {
  if (!(ctx.insideCells > 0)) return { curve: [], best: null, insideAc: 0 };
  const lo = Math.floor(ctx.zMin), hi = Math.ceil(ctx.zMax);
  const curve = [];
  let best = null;
  for (let E = lo; E <= hi; E += step) {
    if (shouldAbort && shouldAbort()) return { curve, best, insideAc: ctx.insideSf / SQFT_PER_ACRE, aborted: true };
    const r = cachedMaskAt(ctx, E, s, D);
    curve.push({ E, areaSf: r.areaSf, areaAc: r.areaAc });
    if (!best || r.areaSf > best.areaSf) best = { E, areaSf: r.areaSf, areaAc: r.areaAc };
  }
  return { curve, best, insideAc: ctx.insideSf / SQFT_PER_ACRE };
}

/* Severity pill for the Ground row: share of the parcel that makes one level pad.
 * ≥45% Workable (green) · 25–45% Tight (amber) · <25% Steep (red). */
export function severityOfShare(share) {
  if (!Number.isFinite(share) || share < 0) return null;
  if (share >= 0.45) return { id: "workable", label: "Workable", tone: "green" };
  if (share >= 0.25) return { id: "tight", label: "Tight", tone: "amber" };
  return { id: "steep", label: "Steep", tone: "red" };
}

/* ---- relief + steepness over the PARCEL (not the setback) ---- */

/* Exact polygon area (shoelace), square feet. */
export function ringAreaSf(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* High/low ground across the parcel and the share of its area steeper than `pct` (default 15%).
 * Slope per cell is the central-difference gradient magnitude on the lattice; a cell with a void
 * neighbour contributes no slope (it is counted in neither numerator nor denominator). */
export function parcelRelief({ lattice, rings, holes = [], steepPct = 15 }) {
  const inside = rasterInside(lattice, rings, holes);
  const { nx, ny, cell, z } = lattice;
  let lo = Infinity, hi = -Infinity, nSlope = 0, nSteep = 0, nIn = 0;
  const lim = steepPct / 100;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!inside[k]) continue;
      const v = z[k];
      if (!(v === v)) continue;
      nIn++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) continue;
      const a = z[k - 1], b = z[k + 1], c = z[k - nx], d = z[k + nx];
      if (!(a === a) || !(b === b) || !(c === c) || !(d === d)) continue;
      const gx = (b - a) / (2 * cell), gy = (d - c) / (2 * cell);
      nSlope++;
      if (Math.hypot(gx, gy) > lim) nSteep++;
    }
  }
  return {
    lowFt: isFinite(lo) ? lo : null, highFt: isFinite(hi) ? hi : null,
    reliefFt: isFinite(lo) ? hi - lo : null,
    steepShare: nSlope ? nSteep / nSlope : null,
    parcelAc: nIn * cell * cell / SQFT_PER_ACRE,
    cellsSampled: nIn,
  };
}

/* The one object the Ground row renders from. Pure over a prepared context. */
export function summarizeCtx(ctx, { parcelRings = null, holes = [], s = DEFAULT_SLOPE, D = DEFAULT_MAX_DEPTH_FT, shouldAbort = null } = {}) {
  const ringsForArea = parcelRings || ctx.rings;
  const relief = parcelRelief({ lattice: ctx.lattice, rings: ringsForArea, holes });
  const sw = sweep(ctx, { s, D, shouldAbort });
  if (sw.aborted) return { aborted: true };
  // The parcel's TRUE area (exact ring area, minus holes), not the raster count — "37.4 of 74.0 ac" must
  // agree with the acreage shown everywhere else.
  const parcelAc = (ringsForArea.reduce((a, r) => a + ringAreaSf(r), 0) - holes.reduce((a, r) => a + ringAreaSf(r), 0)) / SQFT_PER_ACRE;
  const best = sw.best;
  const share = best && parcelAc > 0 ? best.areaAc / parcelAc : null;
  return {
    s, D, relief, parcelAc, setbackAc: sw.insideAc,
    best, curve: sw.curve, share, severity: share == null ? null : severityOfShare(share),
  };
}

export function groundSummary({ lattice, setbackRings, holes = [], parcelRings = null, s, D, shouldAbort = null }) {
  const ctx = prepareSweep({ lattice, rings: setbackRings, holes });
  return summarizeCtx(ctx, { parcelRings, holes, s, D, shouldAbort });
}
