/* The 3D viewer's HEIGHTFIELD (owner-only grading layer; NEW-1, 2026-11-11). PURE — no DOM, no three.js.
 *
 * NO NEW GRADING MATH. A regular lattice over the parcel is sampled with the two answers the planner already has:
 *   • proposed = `sampleProposedAt(grid, pt, existAt)` — the ONE point sampler for the stitched proposed surface (pad at the FFE,
 *     each paved plane, the open ground, the slope bands, and the property past the daylight line = existing). The cursor chip
 *     and every picture read the same function, so the 3D model cannot disagree with the 2D ones.
 *   • existing = `existAt(pt)` — the DEM.
 * A pond interior (the engine has no bottom for it), a point the stitched surface says nothing about, or a DEM void falls back to the
 * other surface; a node with NEITHER stays NaN and the mesh leaves a hole there (never an invented height).
 *
 * The lattice covers the union of the parcels' bounding box plus one cell each side, so every cell the property line crosses has all
 * four corners. `inside` marks the nodes in the property (even-odd across every outer ring and hole). The proposed surface is only
 * asked at nodes in or beside the property — beyond that the value is the existing ground (it is never drawn).
 *
 * Generator: one yield (a fraction) per lattice row, for `runChunked` — opening the viewer on a 100-acre plan never stalls the page. */
import { sampleProposedAt } from "../proposedSurface.js";

export const FIELD_DEFAULTS = Object.freeze({ maxSamples: 45000, minCellFt: 4, maxCellFt: 60 });

/* regions: [{ outer, holes }] in feet ({x,y} points). */
export function regionRings(regions) {
  const rings = [];
  for (const r of regions || []) { rings.push(r.outer); for (const h of r.holes || []) rings.push(h); }
  return rings;
}
export function boundsOfRings(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* Mark the lattice nodes inside the rings (even-odd), by scanline: each edge adds its crossing to the rows it spans, so the work is
 * proportional to the perimeter, not to nodes × vertices. */
export function insideMask(rings, nx, ny, x0, y0, cell) {
  const inside = new Uint8Array(nx * ny);
  const rows = Array.from({ length: ny }, () => []);
  for (const ring of rings) {
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      if (a.y === b.y) continue;
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      // rows j whose y falls in [lo, hi): the half-open rule counts a vertex on a row once
      let j0 = Math.ceil((lo - y0) / cell), j1 = Math.ceil((hi - y0) / cell) - 1;
      if (j0 < 0) j0 = 0; if (j1 > ny - 1) j1 = ny - 1;
      for (let j = j0; j <= j1; j++) {
        const y = y0 + j * cell;
        rows[j].push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    const xs = rows[j];
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((xs[k + 1] - x0) / cell) - 1);
      for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
    }
  }
  return inside;
}

/* The lattice cell size for a box: ~maxSamples nodes, never finer than minCellFt nor coarser than maxCellFt. */
export function cellFor(bounds, { maxSamples = FIELD_DEFAULTS.maxSamples, minCellFt = FIELD_DEFAULTS.minCellFt, maxCellFt = FIELD_DEFAULTS.maxCellFt } = {}) {
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  return Math.min(maxCellFt, Math.max(minCellFt, Math.sqrt((Math.max(w, 1) * Math.max(h, 1)) / maxSamples)));
}

/* The sampler. `grid` is the planner's `gradeSurface.grid`; `existAt(pt) → ft | null`; `regions` the parcels' union.
 * Returns { nx, ny, x0, y0, cell, prop, exist, inside, zLo, zHi, regions, bounds } (Float32Array heights, NaN = unknown) or null. */
export function* sampleFieldSteps({ grid, existAt, regions, maxSamples, minCellFt, maxCellFt } = {}) {
  const rings = regionRings(regions);
  const bb = boundsOfRings(rings);
  if (!bb || typeof existAt !== "function") return null;
  const cell = cellFor(bb, { maxSamples, minCellFt, maxCellFt });
  const x0 = bb.x0 - cell, y0 = bb.y0 - cell;
  const nx = Math.ceil((bb.x1 + cell - x0) / cell) + 1, ny = Math.ceil((bb.y1 + cell - y0) / cell) + 1;
  const inside = insideMask(rings, nx, ny, x0, y0, cell);
  const prop = new Float32Array(nx * ny).fill(NaN), exist = new Float32Array(nx * ny).fill(NaN);
  const near = (i, j) => {            // in or beside the property: the only nodes whose proposed height is ever read
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && inside[jj * nx + ii]) return true;
    }
    return false;
  };
  let zLo = Infinity, zHi = -Infinity, insideN = 0, existN = 0;
  for (let j = 0; j < ny; j++) {
    yield (j + 1) / ny;
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const pt = { x: x0 + i * cell, y };
      const g = existAt(pt);
      const e = g != null && Number.isFinite(g) ? g : NaN;
      exist[k] = e;
      let p = e;
      const nearNode = inside[k] === 1 || near(i, j);
      if (grid && nearNode) {
        const r = sampleProposedAt(grid, pt, existAt);
        if (r && r.status === "value" && Number.isFinite(r.ft)) p = r.ft;
      }
      prop[k] = p;
      if (inside[k]) { insideN++; if (Number.isFinite(e)) existN++; }
      if (nearNode) {                     // the boundary heights are bilinear off the nodes beside the line, so the range covers them too
        if (Number.isFinite(p)) { if (p < zLo) zLo = p; if (p > zHi) zHi = p; }
        if (Number.isFinite(e)) { if (e < zLo) zLo = e; if (e > zHi) zHi = e; }
      }
    }
  }
  // EMPTY IS NOT ZERO: without the ground (the DEM never loaded) there is nothing to cut or fill against — a block of "proposed" floating in a void
  // would read as a finished picture. Under half the property known = no model; the viewer says so.
  if (!(zHi >= zLo) || existN < 0.5 * insideN) return null;
  return { nx, ny, x0, y0, cell, prop, exist, inside, zLo, zHi, regions, bounds: bb };
}

/* Bilinear read of a field array at a plan point, ignoring unknown corners (NaN only when all four are unknown).
 * `which` = "prop" | "exist" | "dz" (proposed − existing). */
export function fieldAt(f, which, x, y) {
  const fx = (x - f.x0) / f.cell, fy = (y - f.y0) / f.cell;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0) i = 0; if (j < 0) j = 0;
  if (i > f.nx - 2) i = f.nx - 2; if (j > f.ny - 2) j = f.ny - 2;
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
  const val = (ii, jj) => {
    const k = jj * f.nx + ii;
    return which === "dz" ? f.prop[k] - f.exist[k] : f[which][k];
  };
  const vs = [val(i, j), val(i + 1, j), val(i, j + 1), val(i + 1, j + 1)];
  const ws = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
  let s = 0, w = 0;
  for (let q = 0; q < 4; q++) if (Number.isFinite(vs[q])) { s += vs[q] * ws[q]; w += ws[q]; }
  return w > 1e-9 ? s / w : NaN;
}

/* Point in the regions (even-odd over every ring) — for the few exact tests the builders need. */
export function pointInRegions(regions, x, y) {
  let c = false;
  for (const ring of regionRings(regions)) {
    for (let k = 0, n = ring.length, m = n - 1; k < n; m = k++) {
      const a = ring[k], b = ring[m];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  }
  return c;
}

/* The planner's two samplers as ONE function for the section: (x, y) → { p, e } (proposed, existing), a pond / unknown falling back to the
 * other surface exactly as the lattice does. Exact, not lattice-bilinear — the slice reads a few hundred points, so it can afford to. */
export function exactSampler(grid, existAt) {
  return (x, y) => {
    const pt = { x, y };
    const g = existAt(pt);
    const e = g != null && Number.isFinite(g) ? g : NaN;
    let p = e;
    if (grid) { const r = sampleProposedAt(grid, pt, existAt); if (r && r.status === "value" && Number.isFinite(r.ft)) p = r.ft; }
    return { p, e };
  };
}
