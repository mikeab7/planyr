/* NEW-1 (B1057 completion) — the MISSING FOURTH INPUT to the screening-BFE engine: a ground
 * CROSS-SECTION cut across the channel, plus the channel's longitudinal slope and the cell the
 * cut is taken at.
 *
 * ─── AUDIT-FIRST: why this is not a second terrain path ──────────────────────────────────────
 * There is exactly ONE bare-earth terrain source in this app: the 3DEP DEM grid the drainage
 * check already fetches (`fetchSiteGrid` → `{ values(FEET), mask, width, height }` + the
 * `gridRequest` descriptor). `pondGeom.bermFillCells` reads it per-cell through the `gradeAt`
 * closure SitePlanner builds from `demGrid.sampleAtLatLng`; `upstreamArea.js` walks the SAME
 * arrays for D8 accumulation. This module reads the SAME arrays too — it just indexes them in
 * PIXEL space instead of lat/lng, because a cross-section is a straight line in the grid, not a
 * sequence of independent point look-ups. No new fetch, no new service, no second sampler.
 *
 * ─── What it produces ────────────────────────────────────────────────────────────────────────
 *   1. WHERE the channel crosses the site — the highest-flow-accumulation cell inside the site
 *      footprint (upstreamArea.flowAccumulation over this same grid).
 *   2. WHICH WAY the water runs there — the net D8 displacement over a short downstream walk
 *      (a single D8 step is 8-quantised and reads as noise on flat Gulf-Coast ground; the walk
 *      averages it, the same reason flowField.js windows its gradient).
 *   3. THE SECTION — station/elevation pairs sampled PERPENDICULAR to that bearing, which is
 *      what `screeningBfe.sectionAtWse` / `normalDepthWse` consume.
 *   4. THE SLOPE — the longitudinal drop per foot down the flow path, which is the S in
 *      Manning's equation. Without it the hydraulics cannot be solved at all.
 *
 * LOUD-FAILURE throughout: a void-riddled grid, a flat reach, a channel cell on the grid edge or
 * a section that never rises above its own low point all return an explicit `{ ok:false, reason }`.
 * Nothing here invents geometry, and nothing returns a partially-sampled section as if it were
 * whole. Pure — no DOM, no network, no Leaflet; Node-testable against synthetic grids. */
import { M_TO_FT } from "./elevation.js";
import { groundScale, mercToPixel, lngToMercX, latToMercY } from "./demGrid.js";
import { d8Direction } from "./flowField.js";

// Mercator y → latitude, for the grid-midpoint read below.
const mercYToLatDeg = (y) => (Math.atan(Math.sinh(y / 6378137)) * 180) / Math.PI;

/* Ground feet per grid cell. The grid is Web Mercator, so a cell's GROUND size is its mercator
 * size × cos(latitude) — the same `groundK` correction flowField.js applies. Pure. */
export function gridCellFt(req, lat = null) {
  if (!req || !(req.cellMeters > 0)) return null;
  const la = Number.isFinite(lat)
    ? lat
    : (req.bbox ? mercYToLatDeg((req.bbox.ymin + req.bbox.ymax) / 2) : null);
  const k = Number.isFinite(la) ? groundScale(la) : 1;
  return req.cellMeters * k * M_TO_FT;
}

/* Bilinear elevation read at a FRACTIONAL pixel coordinate, in the grid's own feet. Returns null
 * when any contributing cell is void or the point is off-grid — never interpolates across a void
 * (the same rule demGrid.sampleAtLatLng enforces: a confident number over water is a lie). Pure. */
export function sampleAtPixel(grid, fx, fy) {
  if (!grid) return null;
  const { values, mask, width, height } = grid;
  const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) return null;
  const i00 = y0 * width + x0, i10 = i00 + 1, i01 = i00 + width, i11 = i01 + 1;
  if (!mask[i00] || !mask[i10] || !mask[i01] || !mask[i11]) return null;
  const tx = fx - 0.5 - x0, ty = fy - 0.5 - y0;
  const top = values[i00] * (1 - tx) + values[i10] * tx;
  const bot = values[i01] * (1 - tx) + values[i11] * tx;
  return top * (1 - ty) + bot * ty;
}

/* Point-in-polygon (ray cast) over a pixel-space ring [[x,y],…]. Pure. */
function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* A site mask over the grid from site rings already converted to LAT/LNG. Rasterises only inside
 * each ring's pixel bounding box (a full-grid sweep over a 1024² grid would be a million
 * point-in-polygon tests for nothing). Returns a Uint8Array, or null with no usable ring. Pure. */
export function siteMaskFromLatLngRings(req, rings, width, height) {
  if (!req || !Array.isArray(rings) || !rings.length) return null;
  const polys = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const poly = [];
    for (const p of ring) {
      const lat = Array.isArray(p) ? p[0] : p.lat, lng = Array.isArray(p) ? p[1] : p.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      poly.push(mercToPixel(req, lngToMercX(lng), latToMercY(lat)));
    }
    if (poly.length >= 3) polys.push(poly);
  }
  if (!polys.length) return null;
  const out = new Uint8Array(width * height);
  let any = 0;
  for (const poly of polys) {
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (y < mnY) mnY = y; if (y > mxY) mxY = y;
    }
    const x0 = Math.max(0, Math.floor(mnX)), x1 = Math.min(width - 1, Math.ceil(mxX));
    const y0 = Math.max(0, Math.floor(mnY)), y1 = Math.min(height - 1, Math.ceil(mxY));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (out[y * width + x]) continue;
        if (inPoly(poly, x + 0.5, y + 0.5)) { out[y * width + x] = 1; any++; }
      }
    }
  }
  return any ? out : null;
}

/* The cell where the channel crosses the site: the highest flow-accumulation cell inside
 * `siteMask` (or the whole grid without one), excluding a margin of edge cells whose upstream
 * area is truncated by the grid boundary and would read falsely small. Returns an index or -1.
 * Pure. */
export function channelCell({ acc, mask, width, height }, siteMask = null, { edgeMargin = 2 } = {}) {
  if (!acc) return -1;
  let best = -1, bestAcc = 0;
  for (let y = edgeMargin; y < height - edgeMargin; y++) {
    for (let x = edgeMargin; x < width - edgeMargin; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      if (siteMask && !siteMask[i]) continue;
      if (acc[i] > bestAcc) { bestAcc = acc[i]; best = i; }
    }
  }
  return best;
}

/* TRUNCATION DETECTION — the honesty guard on a delineated watershed.
 *
 * A DEM grid is a finite window. If any cell on the grid's BORDER drains (eventually) through a
 * given cell, that cell's contributing area continues past the window and the delineated figure is
 * a LOWER BOUND, not the watershed. Left unsaid, that produces a confidently understated discharge
 * and therefore an understated flood elevation — the exact failure mode this whole feature exists
 * to avoid. So: propagate a "my upstream area reaches the grid edge" flag downstream in the same
 * descending-elevation order flow accumulation uses. Returns a Uint8Array. Pure. */
export function upstreamEdgeFlags({ values, mask, width, height, cellFt = 1 } = {}) {
  const n = width * height;
  const flag = new Uint8Array(n);
  const order = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % width, y = (i / width) | 0;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) flag[i] = 1;
    order.push(i);
  }
  order.sort((a, b) => values[b] - values[a]);
  for (const i of order) {
    if (!flag[i]) continue;
    const x = i % width, y = (i / width) | 0;
    const step = d8Direction(values, mask, width, height, x, y, cellFt);
    if (!step) continue;
    const nx = x + step.dx, ny = y + step.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const j = ny * width + nx;
    if (mask[j]) flag[j] = 1;
  }
  return flag;
}

/* The flow BEARING at a cell as a unit vector in pixel space (x → east, y → south), taken as the
 * NET displacement of a short downstream walk rather than one 8-quantised D8 step. Returns
 * { ux, uy, steps } or null (pit / flat / immediately off-grid). Pure. */
export function flowBearing({ values, mask, width, height, cellFt }, i, { walkCells = 8 } = {}) {
  if (i < 0 || i >= width * height || !mask[i]) return null;
  const x0 = i % width, y0 = (i / width) | 0;
  let x = x0, y = y0, steps = 0;
  const seen = new Set([i]);
  while (steps < walkCells) {
    const step = d8Direction(values, mask, width, height, x, y, cellFt);
    if (!step) break;
    const nx = x + step.dx, ny = y + step.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
    const j = ny * width + nx;
    if (!mask[j] || seen.has(j)) break;
    seen.add(j); x = nx; y = ny; steps++;
  }
  if (!steps) return null;
  const dx = x - x0, dy = y - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  return { ux: dx / len, uy: dy / len, steps };
}

/* The channel's LONGITUDINAL slope (ft per ft) — the S in Manning's equation. Walks downstream
 * from the section cell accumulating true ground distance and elevation drop. Returns
 * { slopeFtPerFt, dropFt, runFt, steps } or null when the reach is flat / the walk dies at once.
 * A non-positive drop returns null rather than a fabricated minimum: normalDepthWse then reports
 * "no channel slope" honestly. Pure. */
export function channelSlope({ values, mask, width, height, cellFt }, i, { walkCells = 40 } = {}) {
  if (i < 0 || i >= width * height || !mask[i]) return null;
  let x = i % width, y = (i / width) | 0, steps = 0, runFt = 0;
  const z0 = values[i];
  const seen = new Set([i]);
  while (steps < walkCells) {
    const step = d8Direction(values, mask, width, height, x, y, cellFt);
    if (!step) break;
    const nx = x + step.dx, ny = y + step.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) break;
    const j = ny * width + nx;
    if (!mask[j] || seen.has(j)) break;
    runFt += Math.hypot(step.dx, step.dy) * cellFt;
    seen.add(j); x = nx; y = ny; steps++;
  }
  if (!steps || !(runFt > 0)) return null;
  const dropFt = z0 - values[y * width + x];
  if (!(dropFt > 0)) return null;
  return { slopeFtPerFt: dropFt / runFt, dropFt, runFt, steps };
}

/* THE CROSS-SECTION. Station/elevation pairs along a line PERPENDICULAR to `bearing`, centred on
 * the channel cell, sampled from the same DEM grid. `halfWidthFt` reaches each way; `samples` is
 * the total point count (odd → a sample exactly on the channel).
 *
 * Returns { ok:true, station:[{offsetFt,elevFt}], bedFt, sectionTopFt, reliefFt, voidCount,
 *           halfWidthFt } or { ok:false, reason }. A section with fewer than `minSamples` usable
 * points, or no relief at all, fails loudly — a flat "section" would silently produce an
 * unsolvable (or absurd) normal depth. Pure. */
export function cutSection(grid, req, cellIdx, bearing, {
  halfWidthFt = 500, samples = 81, cellFt = null, minSamples = 12, lat = null,
} = {}) {
  if (!grid || !req) return { ok: false, reason: "no terrain grid" };
  const { width, height } = grid;
  if (cellIdx < 0 || cellIdx >= width * height) return { ok: false, reason: "no channel cell on this grid" };
  if (!bearing || !Number.isFinite(bearing.ux) || !Number.isFinite(bearing.uy)) {
    return { ok: false, reason: "no flow direction at the channel (flat or void terrain)" };
  }
  const cft = Number.isFinite(cellFt) && cellFt > 0 ? cellFt : gridCellFt(req, lat);
  if (!(cft > 0)) return { ok: false, reason: "unknown grid cell size" };

  // Perpendicular to flow, in pixel space.
  const px = -bearing.uy, py = bearing.ux;
  const cx = (cellIdx % width) + 0.5, cy = ((cellIdx / width) | 0) + 0.5;
  const n = Math.max(3, samples | 0);
  const stepFt = (2 * halfWidthFt) / (n - 1);
  const station = [];
  let voidCount = 0;
  for (let k = 0; k < n; k++) {
    const offsetFt = -halfWidthFt + k * stepFt;
    const dPx = offsetFt / cft;
    const elevFt = sampleAtPixel(grid, cx + px * dPx, cy + py * dPx);
    if (elevFt == null || !Number.isFinite(elevFt)) { voidCount++; continue; }
    station.push({ offsetFt: Math.round(offsetFt * 100) / 100, elevFt: Math.round(elevFt * 1000) / 1000 });
  }
  if (station.length < minSamples) {
    return { ok: false, reason: `the cross-section fell outside the sampled terrain (${station.length} of ${n} points usable)` };
  }
  const elevs = station.map((p) => p.elevFt);
  const bedFt = Math.min(...elevs), sectionTopFt = Math.max(...elevs);
  const reliefFt = sectionTopFt - bedFt;
  if (!(reliefFt > 0.25)) {
    return { ok: false, reason: "the sampled ground across the channel is flat — no section to solve a water surface in" };
  }
  return {
    ok: true,
    station,
    bedFt: Math.round(bedFt * 100) / 100,
    sectionTopFt: Math.round(sectionTopFt * 100) / 100,
    reliefFt: Math.round(reliefFt * 100) / 100,
    voidCount,
    halfWidthFt,
    cellFt: Math.round(cft * 100) / 100,
  };
}
