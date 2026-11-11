/* The 3D viewer's MESH BUILDERS (owner-only grading layer; NEW-1, 2026-11-11). PURE — plain typed arrays, no three.js, no DOM, so every
 * claim about the model ("trimmed at the property line", "side faces from the boundary", "cut is rust where existing is above") is a
 * test on arrays. `threeScene.js` is the only place these become GPU geometry.
 *
 * Coordinates: X = plan x (east, ft), Y = ELEVATION (ft, true — the viewer scales Y for "height stretch"), Z = plan y (south, ft). So a
 * top-down view with +X to the right and +Z down the screen IS the plan view the owner sees on the map.
 *
 * What is built, all from one `field` (field.js — the planner's own proposed surface and the DEM sampled on a lattice):
 *   • top surface   — the PROPOSED surface as a solid, trimmed at the property line: lattice triangles for every cell inside, and for
 *                     every cell the line crosses, the cell clipped to the property (clipper) and triangulated, heights bilinear off
 *                     the lattice. Per-vertex colour = the 2D cut / fill palette by depth (colors.js); per-vertex normal from the
 *                     lattice gradient (so a clipped vertex lights like its neighbours).
 *   • walls         — vertical faces down the property line to a flat base, banded at absolute elevations like strata, so the model
 *                     reads as a slab lifted out of the ground. They share the top surface's boundary heights exactly (watertight).
 *   • ghost         — the EXISTING ground as a wire mesh (line segments every ~`ghostSpacingFt`), bright where it is above the finished
 *                     grade (cut), dim elsewhere.
 *   • outlines      — a building's footprint as a dashed ribbon draped on the pad. (A building stays FLAT — nothing may hide the grading.)
 *   • slice         — a vertical section along a line: earth below both grades, a rust wedge where existing is above proposed (cut), a
 *                     blue wedge where proposed is above existing (fill), faint strata, today's ground as a dashed line, the finished
 *                     grade as a solid one. */
import ClipperLib from "clipper-lib";
import { unionRings, ringAreaSf } from "../gradingLimit.js";
import { fieldAt, regionRings } from "./field.js";
import { groundRgb, ghostRgb, earthRgb, toUnit, CUT_RGB, FILL_RGB, STRATA_RGB, OUTLINE_RGB } from "./colors.js";

const f32 = (a) => Float32Array.from(a);
const u32 = (a) => Uint32Array.from(a);
const unit = (rgb) => toUnit(rgb);

/* ---------------------------------------------------------------- small geometry */
/* Ear-clip a simple polygon ([{x,y}]) → [[i,j,k]…] into the given array. O(n³) — pieces are a handful of vertices. */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area += p.x * q.y - q.x * p.y; }
  const order = Array.from({ length: n }, (_, i) => i);
  if (area < 0) order.reverse();
  const cross = (a, b, c) => (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
  const inTri = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const out = [];
  let guard = 0;
  while (order.length > 3 && guard++ < 10 * n) {
    let cut = false;
    for (let k = 0; k < order.length; k++) {
      const a = order[(k + order.length - 1) % order.length], b = order[k], c = order[(k + 1) % order.length];
      if (cross(a, b, c) <= 1e-12) continue;                       // reflex or flat
      let ear = true;
      for (const p of order) { if (p === a || p === b || p === c) continue; if (inTri(p, a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      out.push([a, b, c]); order.splice(k, 1); cut = true; break;
    }
    if (!cut) { for (let k = 1; k + 1 < order.length; k++) out.push([order[0], order[k], order[k + 1]]); order.length = 0; }   // degenerate: fan
  }
  if (order.length === 3 && cross(order[0], order[1], order[2]) > 1e-12) out.push([order[0], order[1], order[2]]);
  return out;
}

/* A growable vertex / triangle soup with ONE winding rule: a triangle is emitted so its geometric normal agrees with `want` (or +Y). */
function makeSoup() {
  const pos = [], nor = [], col = [], idx = [];
  const addV = (x, y, z, n, c) => { pos.push(x, y, z); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
  const addTri = (a, b, c, want = [0, 1, 0]) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-12) return;       // zero area
    if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const done = () => ({ positions: f32(pos), normals: f32(nor), colors: f32(col), indices: u32(idx), vertexCount: pos.length / 3, triangleCount: idx.length / 3 });
  return { addV, addTri, done };
}

/* ---------------------------------------------------------------- node normals */
export function nodeNormals(f) {
  const { nx, ny, cell, prop } = f;
  const out = new Float32Array(nx * ny * 3);
  const at = (i, j) => prop[j * nx + i];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = at(i, j);
    const d = (a, b, m) => (Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (2 * cell) : Number.isFinite(a) && Number.isFinite(m) ? (m - a) / cell : Number.isFinite(b) && Number.isFinite(m) ? (b - m) / cell : 0);
    const hx = d(i > 0 ? at(i - 1, j) : NaN, i < nx - 1 ? at(i + 1, j) : NaN, c);
    const hz = d(j > 0 ? at(i, j - 1) : NaN, j < ny - 1 ? at(i, j + 1) : NaN, c);
    const l = Math.hypot(hx, 1, hz), k = (j * nx + i) * 3;
    out[k] = -hx / l; out[k + 1] = 1 / l; out[k + 2] = -hz / l;
  }
  return out;
}
function normalAtPlan(f, nn, x, y) {
  const fx = (x - f.x0) / f.cell, fy = (y - f.y0) / f.cell;
  let i = Math.floor(fx), j = Math.floor(fy);
  i = Math.max(0, Math.min(f.nx - 2, i)); j = Math.max(0, Math.min(f.ny - 2, j));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
  const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v], ks = [j * f.nx + i, j * f.nx + i + 1, (j + 1) * f.nx + i, (j + 1) * f.nx + i + 1];
  let a = 0, b = 0, c = 0;
  for (let q = 0; q < 4; q++) { a += nn[ks[q] * 3] * w[q]; b += nn[ks[q] * 3 + 1] * w[q]; c += nn[ks[q] * 3 + 2] * w[q]; }
  const l = Math.hypot(a, b, c) || 1;
  return [a / l, b / l, c / l];
}

/* The property as clipper paths (outers positive, holes negative) for cell clipping. Local, not gradingLimit.clipRegions: that drops any
 * piece under 10 sf, and the corner slivers of a cell on the property line are exactly that small. Centi-foot grid, like the limit's. */
const CLIP_SCALE = 100;
function regionPaths(regions) {
  const paths = [];
  const add = (ring, positive) => {
    const p = ring.map((q) => ({ X: Math.round(q.x * CLIP_SCALE), Y: Math.round(q.y * CLIP_SCALE) }));
    if (p.length < 3) return;
    if ((ClipperLib.Clipper.Area(p) > 0) !== positive) p.reverse();
    paths.push(p);
  };
  for (const r of regions) { add(r.outer, true); for (const h of r.holes || []) add(h, false); }
  return paths;
}
/* The cell square ∩ the property → rings (feet). Pieces with a hole in them (a hole smaller than a cell) lose the hole — never seen on a real parcel. */
function clipCell(xa, ya, xb, yb, clipPaths) {
  const sq = [{ X: Math.round(xa * CLIP_SCALE), Y: Math.round(ya * CLIP_SCALE) }, { X: Math.round(xb * CLIP_SCALE), Y: Math.round(ya * CLIP_SCALE) }, { X: Math.round(xb * CLIP_SCALE), Y: Math.round(yb * CLIP_SCALE) }, { X: Math.round(xa * CLIP_SCALE), Y: Math.round(yb * CLIP_SCALE) }];
  const c = new ClipperLib.Clipper();
  c.AddPath(sq, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out = [];
  for (const path of sol) if (path.length >= 3 && ClipperLib.Clipper.Area(path) > 0) out.push(path.map((q) => ({ x: q.X / CLIP_SCALE, y: q.Y / CLIP_SCALE })));
  return out;
}

/* Cells the property line passes through: sample every ring edge finely and mark the cell each sample falls in. */
function markEdgeCells(f, regions) {
  const mark = new Uint8Array(f.nx * f.ny);
  for (const ring of regionRings(regions)) {
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const L = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(L / (f.cell * 0.4)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const i = Math.floor((x - f.x0) / f.cell), j = Math.floor((y - f.y0) / f.cell);
        if (i >= 0 && j >= 0 && i < f.nx - 1 && j < f.ny - 1) mark[j * f.nx + i] = 1;
      }
    }
  }
  return mark;
}

/* ---------------------------------------------------------------- top surface */
/* Generator (yields a fraction per lattice row). Returns { positions, normals, colors, indices, vertexCount, triangleCount }. */
export function* topSurfaceSteps(f, regions) {
  const { nx, ny, cell, x0, y0, prop, exist, inside } = f;
  const soup = makeSoup();
  const nn = nodeNormals(f);
  const nodeV = new Int32Array(nx * ny).fill(-1);
  const colorAtDz = (dz) => unit(groundRgb(dz));
  const nodeVert = (i, j) => {
    const k = j * nx + i;
    if (nodeV[k] >= 0) return nodeV[k];
    nodeV[k] = soup.addV(x0 + i * cell, prop[k], y0 + j * cell, [nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]], colorAtDz(prop[k] - exist[k]));
    return nodeV[k];
  };
  const planVert = (x, y) => {
    const z = fieldAt(f, "prop", x, y);
    if (!Number.isFinite(z)) return -1;
    return soup.addV(x, z, y, normalAtPlan(f, nn, x, y), colorAtDz(fieldAt(f, "dz", x, y)));
  };
  const marked = markEdgeCells(f, regions);
  const clipPaths = regionPaths(regions);
  for (let j = 0; j < ny - 1; j++) {
    yield (j + 1) / (ny - 1);
    for (let i = 0; i < nx - 1; i++) {
      const k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
      const c = inside[k00] + inside[k10] + inside[k01] + inside[k11];
      const edge = marked[k00] === 1 || (c > 0 && c < 4);
      if (c === 0 && !edge) continue;
      if (!edge) {
        if (!(Number.isFinite(prop[k00]) && Number.isFinite(prop[k10]) && Number.isFinite(prop[k01]) && Number.isFinite(prop[k11]))) continue;
        const a = nodeVert(i, j), b = nodeVert(i + 1, j), cc = nodeVert(i, j + 1), d = nodeVert(i + 1, j + 1);
        if (Math.abs(prop[k00] - prop[k11]) <= Math.abs(prop[k10] - prop[k01])) { soup.addTri(a, b, d); soup.addTri(a, d, cc); }
        else { soup.addTri(a, b, cc); soup.addTri(b, d, cc); }
        continue;
      }
      const xa = x0 + i * cell, ya = y0 + j * cell, xb = xa + cell, yb = ya + cell;
      for (const ring of clipCell(xa, ya, xb, yb, clipPaths)) {
        const vs = ring.map((p) => planVert(p.x, p.y));
        for (const [p, q, r] of triangulate(ring)) if (vs[p] >= 0 && vs[q] >= 0 && vs[r] >= 0) soup.addTri(vs[p], vs[q], vs[r]);
      }
    }
  }
  return soup.done();
}
export const buildTopSurface = (f, regions) => { const g = topSurfaceSteps(f, regions); let r = g.next(); while (!r.done) r = g.next(); return r.value; };

/* ---------------------------------------------------------------- walls */
export const BASE_PAD_MIN_FT = 12;
export const BASE_PAD_RELIEF = 0.3;
/* The flat base of the block: below the lowest ground by a margin that grows with the relief. */
export const baseElevation = (zLo, zHi) => zLo - Math.max(BASE_PAD_MIN_FT, BASE_PAD_RELIEF * (zHi - zLo));
const NICE = [1, 2, 5, 10, 20, 50, 100];
export const strataStep = (spanFt, bands = 9) => NICE.find((s) => spanFt / s <= bands) || 200;

/* A ring cut into pieces no longer than `step` (closed): [{x,y}]. */
export function densifyRing(ring, step) {
  const out = [];
  for (let k = 0, n = ring.length; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < m; s++) out.push({ x: a.x + ((b.x - a.x) * s) / m, y: a.y + ((b.y - a.y) * s) / m });
  }
  return out;
}
const signedArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p.x * q.y - q.x * p.y; } return a / 2; };

/* Clip the convex polygon [[s,e]…] to lo ≤ e ≤ hi (Sutherland–Hodgman against two horizontals). */
function clipBand(poly, lo, hi) {
  const clip1 = (pts, keep, edgeE) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ina = keep(a[1]), inb = keep(b[1]);
      if (ina) out.push(a);
      if (ina !== inb) { const t = (edgeE - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, edgeE]); }
    }
    return out;
  };
  return clip1(clip1(poly, (e) => e >= lo, lo), (e) => e <= hi, hi);
}

export function* wallsSteps(f, regions, baseZ) {
  const soup = makeSoup();
  const step = f.cell;
  const bandFt = strataStep(f.zHi - baseZ);
  const rings = [];
  for (const r of regions) { rings.push({ ring: r.outer, hole: false }); for (const h of r.holes || []) rings.push({ ring: h, hole: true }); }
  let done = 0;
  for (const { ring, hole } of rings) {
    yield ++done / rings.length;
    const pts = densifyRing(ring, step);
    const ccw = signedArea(ring) > 0;
    const outward = ccw !== hole ? 1 : -1;     // for a CCW outer ring (math sense) the outward normal of edge (dx,dy) is (dy,−dx)
    for (let k = 0, n = pts.length; k < n; k++) {
      const p = pts[k], q = pts[(k + 1) % n];
      const zp = fieldAt(f, "prop", p.x, p.y), zq = fieldAt(f, "prop", q.x, q.y);
      if (!Number.isFinite(zp) || !Number.isFinite(zq)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
      const nrm = [(outward * dy) / L, 0, (-outward * dx) / L];
      const e0 = Math.floor(baseZ / bandFt) * bandFt;
      const top = Math.max(zp, zq);
      for (let lo = e0, bi = Math.round(e0 / bandFt); lo < top; lo += bandFt, bi++) {
        const hi = lo + bandFt;
        const poly = clipBand([[0, baseZ], [1, baseZ], [1, zq], [0, zp]], Math.max(lo, baseZ), hi);
        if (poly.length < 3) continue;
        const shade = (bi & 1) ? 0.9 : 1;
        const vs = poly.map(([s, e]) => {
          const c = earthRgb((e - baseZ) / Math.max(1, f.zHi - baseZ));
          return soup.addV(p.x + dx * s, e, p.y + dy * s, nrm, unit([c[0] * shade, c[1] * shade, c[2] * shade]));
        });
        for (let t = 1; t + 1 < vs.length; t++) soup.addTri(vs[0], vs[t], vs[t + 1], nrm);
      }
    }
  }
  return soup.done();
}
export const buildWalls = (f, regions, baseZ) => { const g = wallsSteps(f, regions, baseZ); let r = g.next(); while (!r.done) r = g.next(); return r.value; };

/* ---------------------------------------------------------------- ghost (existing ground) */
export const GHOST_SPACING_FT = 55;
/* Wire segments of the existing ground inside the property. Returns { positions, colors, segmentCount }. */
export function buildGhost(f, { spacingFt = GHOST_SPACING_FT } = {}) {
  const { nx, ny, cell, x0, y0, exist, prop, inside } = f;
  const stride = Math.max(1, Math.round(spacingFt / cell));
  const pos = [], col = [];
  const node = (i, j) => {
    const k = j * nx + i;
    return { x: x0 + i * cell, y: exist[k], z: y0 + j * cell, c: unit(ghostRgb(prop[k] - exist[k])) };
  };
  const seg = (a, b) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(...a.c, ...b.c); };
  const ok = (i, j) => inside[j * nx + i] === 1 && Number.isFinite(exist[j * nx + i]);
  for (let j = 0; j < ny; j += stride) for (let i = 0; i + 1 < nx; i++) if (ok(i, j) && ok(i + 1, j)) seg(node(i, j), node(i + 1, j));
  for (let i = 0; i < nx; i += stride) for (let j = 0; j + 1 < ny; j++) if (ok(i, j) && ok(i, j + 1)) seg(node(i, j), node(i, j + 1));
  return { positions: f32(pos), colors: f32(col), segmentCount: pos.length / 6 };
}

/* ---------------------------------------------------------------- building outlines */
/* The buildings of a plan as ONE outline each: a host building and its bump-outs (type "building" with a hostId) are one footprint.
 * Returns [{ id, regions, areaSf, centre, longAxis:{x,y} }] largest first. */
export function buildingFootprints(els) {
  const list = (els || []).filter((e) => e && e.type === "building" && Array.isArray(e.ring) && e.ring.length >= 3);
  const hosts = list.filter((e) => !e.hostId);
  const out = [];
  for (const h of hosts) {
    const rings = [h.ring, ...list.filter((e) => e.hostId === h.id).map((e) => e.ring)];
    const regs = unionRings(rings);
    if (!regs.length) continue;
    const outer = regs.reduce((a, r) => (ringAreaSf(r.outer) > ringAreaSf(a.outer) ? r : a), regs[0]).outer;
    let cx = 0, cy = 0;
    for (const p of outer) { cx += p.x; cy += p.y; }
    cx /= outer.length; cy /= outer.length;
    let best = 0, ax = 1, ay = 0;
    for (let k = 0, n = outer.length; k < n; k++) {
      const p = outer[k], q = outer[(k + 1) % n], L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L > best) { best = L; ax = (q.x - p.x) / L; ay = (q.y - p.y) / L; }
    }
    out.push({ id: h.id, regions: regs, areaSf: regs.reduce((s, r) => s + ringAreaSf(r.outer), 0), centre: { x: cx, y: cy }, longAxis: { x: ax, y: ay } });
  }
  return out.sort((a, b) => b.areaSf - a.areaSf);
}

export const OUTLINE_DASH_FT = 24, OUTLINE_GAP_FT = 14;
/* A dashed ribbon for each region outline, lying on the proposed surface (+lift). width/lift in feet. Returns { positions, indices, colors }. */
export function buildOutlineRibbons(f, regionsList, { widthFt = 3, liftFt = 0.5, dashFt = OUTLINE_DASH_FT, gapFt = OUTLINE_GAP_FT } = {}) {
  const soup = makeSoup();
  const white = unit(OUTLINE_RGB);
  for (const regs of regionsList) {
    for (const r of regs) {
      const pts = densifyRing(r.outer, Math.max(2, f.cell * 0.5));
      let acc = 0;
      for (let k = 0, n = pts.length; k < n; k++) {
        const p = pts[k], q = pts[(k + 1) % n];
        const L = Math.hypot(q.x - p.x, q.y - p.y);
        if (!(L > 1e-9)) continue;
        const phase = acc % (dashFt + gapFt);
        acc += L;
        if (phase > dashFt) continue;                     // inside a gap (resolved per piece — pieces are ≤ cell/2 long)
        const zp = fieldAt(f, "prop", p.x, p.y), zq = fieldAt(f, "prop", q.x, q.y);
        if (!Number.isFinite(zp) || !Number.isFinite(zq)) continue;
        const nx = (-(q.y - p.y) / L) * (widthFt / 2), nz = ((q.x - p.x) / L) * (widthFt / 2);
        const a = soup.addV(p.x + nx, zp + liftFt, p.y + nz, [0, 1, 0], white), b = soup.addV(p.x - nx, zp + liftFt, p.y - nz, [0, 1, 0], white);
        const c = soup.addV(q.x - nx, zq + liftFt, q.y - nz, [0, 1, 0], white), d = soup.addV(q.x + nx, zq + liftFt, q.y + nz, [0, 1, 0], white);
        soup.addTri(a, b, c); soup.addTri(a, c, d);
      }
    }
  }
  return soup.done();
}

/* ---------------------------------------------------------------- slice */
/* The default section: through the middle of the largest building, across its SHORT axis (so the cut shows the dock court, the pad and the
 * far court); the handle slides it along the building's length. No building → across the middle of the property, east-west.
 * line = { px, py (a point on it), dx, dy (unit direction of the cut), nx, ny (unit normal — the handle moves along it) }, s = offset along n. */
export function defaultSliceLine(footprints, bounds) {
  const b = footprints && footprints[0];
  if (b) {
    const u = b.longAxis;
    return lineFrom(b.centre.x, b.centre.y, -u.y, u.x);
  }
  return lineFrom((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2, 1, 0);
}
export function lineFrom(px, py, dx, dy) {
  const l = Math.hypot(dx, dy) || 1;
  return { px, py, dx: dx / l, dy: dy / l, nx: -dy / l, ny: dx / l };
}
/* Move the line by `s` ft along its normal. */
export const shiftLine = (line, s) => ({ ...line, px: line.px + line.nx * s, py: line.py + line.ny * s });
/* How far the line can slide along its normal and still touch the property: [min, max] offsets from the line's current point. */
export function slideRange(line, regions) {
  let lo = Infinity, hi = -Infinity;
  for (const ring of regionRings(regions)) for (const p of ring) {
    const s = (p.x - line.px) * line.nx + (p.y - line.py) * line.ny;
    if (s < lo) lo = s; if (s > hi) hi = s;
  }
  return { lo, hi };
}
/* The parameter intervals [t0,t1] (ft along the line's direction from its point) that lie inside the property. */
export function lineIntervals(line, regions) {
  const ts = [];
  for (const ring of regionRings(regions)) {
    for (let k = 0, n = ring.length; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const sa = (a.x - line.px) * line.nx + (a.y - line.py) * line.ny, sb = (b.x - line.px) * line.nx + (b.y - line.py) * line.ny;
      if (sa === sb || (sa > 0) === (sb > 0)) continue;                         // half-open: a vertex on the line counts once
      const u = sa / (sa - sb), x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
      ts.push((x - line.px) * line.dx + (y - line.py) * line.dy);
    }
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k + 1] - ts[k] > 1e-6) out.push([ts[k], ts[k + 1]]);
  return out;
}

export const SLICE_STRATA_FT = 6;
export const SLICE_DASH_FT = 18, SLICE_GAP_FT = 10;
/* The section face. Returns { faces:{positions,colors,indices}, strata:{positions}, existing:{positions} (dashed segments),
 * proposed:{positions} (solid segments), intervals, samples } — all at the plane of the line (so the three.js side never needs the
 * plan again). `baseZ` is the block's flat base. */
export function buildSlice(f, regions, line, baseZ, { stepFt = null, sample = null, strataFt = SLICE_STRATA_FT, dashFt = SLICE_DASH_FT, gapFt = SLICE_GAP_FT } = {}) {
  const soup = makeSoup();
  const strata = [], existing = [], proposed = [];
  // `sample(x, y) → { p, e }` reads the planner's own samplers EXACTLY at the cut (a few hundred points — cheap), so the section is crisp at a
  // pad's edge instead of blurred over a lattice cell; without it the lattice is read bilinearly.
  const read = sample || ((x, y) => ({ p: fieldAt(f, "prop", x, y), e: fieldAt(f, "exist", x, y) }));
  const step = stepFt || Math.max(1, f.cell * (sample ? 0.4 : 0.75));
  const at = (t) => ({ x: line.px + line.dx * t, y: line.py + line.dy * t });
  const intervals = lineIntervals(line, regions);
  const cutC = unit(CUT_RGB), fillC = unit(FILL_RGB);
  let samples = 0, dashAcc = 0;
  const pushFace = (t0, t1, lo0, lo1, hi0, hi1, color) => {          // a quad between two profiles at t0 / t1
    const p0 = at(t0), p1 = at(t1);
    const a = soup.addV(p0.x, lo0, p0.y, [line.nx, 0, line.ny], color), b = soup.addV(p1.x, lo1, p1.y, [line.nx, 0, line.ny], color);
    const c = soup.addV(p1.x, hi1, p1.y, [line.nx, 0, line.ny], color), d = soup.addV(p0.x, hi0, p0.y, [line.nx, 0, line.ny], color);
    soup.addTri(a, b, c, [line.nx, 0, line.ny]); soup.addTri(a, c, d, [line.nx, 0, line.ny]);
  };
  const earthFor = (e0, e1) => unit(earthRgb(((e0 + e1) / 2 - baseZ) / Math.max(1, f.zHi - baseZ)));
  for (const [ta, tb] of intervals) {
    const n = Math.max(1, Math.ceil((tb - ta) / step));
    const ts = Array.from({ length: n + 1 }, (_, k) => ta + ((tb - ta) * k) / n);
    const P = ts.map((t) => { const q = at(t), r = read(q.x, q.y); return { t, p: r.p, e: r.e }; });
    samples += P.length;
    for (let k = 0; k + 1 < P.length; k++) {
      const A = P[k], B = P[k + 1];
      if (![A.p, A.e, B.p, B.e].every(Number.isFinite)) { dashAcc = 0; continue; }
      // split where the two grades cross inside this step so each wedge has ONE sign
      const da = A.e - A.p, db = B.e - B.p;
      const parts = [];
      if (da * db < 0) {
        const u = da / (da - db), tm = A.t + (B.t - A.t) * u, zm = A.p + (B.p - A.p) * u;
        parts.push([A, { t: tm, p: zm, e: zm }], [{ t: tm, p: zm, e: zm }, B]);
      } else parts.push([A, B]);
      for (const [S, T] of parts) {
        const lo0 = Math.min(S.p, S.e), lo1 = Math.min(T.p, T.e), hi0 = Math.max(S.p, S.e), hi1 = Math.max(T.p, T.e);
        pushFace(S.t, T.t, baseZ, baseZ, lo0, lo1, earthFor(baseZ, (lo0 + lo1) / 2));
        const sign = (S.e - S.p) + (T.e - T.p);                                  // + : existing above proposed = CUT
        if (hi0 - lo0 > 1e-6 || hi1 - lo1 > 1e-6) pushFace(S.t, T.t, lo0, lo1, hi0, hi1, sign > 0 ? cutC : fillC);
        // strata: horizontal lines at fixed elevations, only where the earth reaches them
        for (let e = Math.ceil(baseZ / strataFt) * strataFt; e < Math.min(lo0, lo1); e += strataFt) {
          const a = at(S.t), b = at(T.t);
          strata.push(a.x, e, a.y, b.x, e, b.y);
        }
        const a = at(S.t), b = at(T.t);
        proposed.push(a.x, S.p, a.y, b.x, T.p, b.y);
        // today's ground: dashed by arc length along the profile (dash state carried across steps)
        const L = Math.hypot(T.t - S.t, T.e - S.e);
        const phase = dashAcc % (dashFt + gapFt);
        if (phase <= dashFt) existing.push(a.x, S.e, a.y, b.x, T.e, b.y);
        dashAcc += L;
      }
    }
    dashAcc = 0;
  }
  const g = soup.done();
  return {
    faces: { positions: g.positions, colors: g.colors, indices: g.indices, triangleCount: g.triangleCount },
    strata: { positions: f32(strata), colors: null, rgb: STRATA_RGB },
    existing: { positions: f32(existing) }, proposed: { positions: f32(proposed) },
    intervals, samples,
  };
}
