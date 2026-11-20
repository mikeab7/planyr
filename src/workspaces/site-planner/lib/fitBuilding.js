/* Fit the biggest building (NEW-1, owner-only grading layer) — the INVERSE of the forward grading problem: given the parcel, the
 * limits of disturbance and the grading rules, how big a building (with its truck courts, trailer rows and parking) can this
 * ground hold?
 *
 * Pure, no DOM, no imports beyond the sweep engine — it runs inside the terrain Web Worker (terrainWorker.js pins its import list)
 * and in plain Node for the tests. Feet, cubic yards, elevations ft NAVD88; x east, y SOUTH like the planner's feet frame.
 *
 * NO NEW GRADING MATH. A cell can carry a piece of the graded footprint at required elevation e when (the owner's sweep rule,
 * `buildableGround.js`):  (a) it is inside the limit of disturbance (the FENCE) — and, for the BUILDING itself, inside the
 * setback; (b) |e − ground| ≤ D (the panel's max cut or fill); (c) its slope DAYLIGHTS before the fence: no fence sample b lies
 * within  shoulder + s·|e − z(b)|  of it (`blockByBoundary`, the sweep's own disc painting, with the 5-ft shoulder added).
 * What is new is only the SEARCH:
 *   • the footprint is not one level pad but the whole ASSEMBLY — the pad flat at E, then each side's stack (court, trailer rows,
 *     buffer / lot) falling away from the wall at the pavement slope from a dock drop, then the end parking — so a cell at
 *     distance t from the wall is tested at e = E − drop − slope·t, exactly as the engine will plane it;
 *   • the search runs on a lattice ROTATED to the candidate orientation (the building's length axis along u), where "the
 *     assembly fits here" is a run-length question per row, answered with right-run arrays — no per-cell search.
 *
 * Orientations: parallel to the frontage road, parallel to the parcel's long axis, the building's current rotation, and (so that
 * the tilted-plane case is answered by the ground rather than by the parcel's outline) parallel to the contours — plus the
 * perpendicular of the first two — each ±10°. FFE in 1-ft steps across the relief (coarse 2-ft pass, then the odd feet around
 * what mattered). Objective: max building SF; tie-break least net dirt. The ALTERNATIVE: best SF among balanced solutions
 * (|net| under 5% of cut).
 *
 * The search is a GENERATOR (`fitBuildingSteps`): it yields once per (orientation, finish) unit so the worker can slice it and a
 * newer request can supersede it; `runFitSync` drives it to completion for tests. */
import { latticeZAt, prepareSweep, blockByBoundary } from "./buildableGround.js";

export const FIT_DEFAULTS = Object.freeze({
  s: 2, D: 12, shoulderFt: 5, dockDropFt: 4, lotDropFt: 0.5, pavementSlopePct: 1.5,
  bayFt: 56, minBays: 5,                 // length grows in the template's bay increment (buildingGrid.GRID_DEFAULTS.bayLengthTarget)
  spreadDeg: 10, sameAngleDeg: 3,
  balancedFrac: 0.05,                    // the alternative: |net| under 5% of cut
  coarseStep: 2, fineSpan: 3, maxPositions: 160, tunePool: 40,
});

const RAD = Math.PI / 180;
const BIG = 32000;
const mod180 = (d) => ((d % 180) + 180) % 180;
const mod360 = (d) => ((d % 360) + 360) % 360;
const angDiff180 = (a, b) => { const d = Math.abs(mod180(a) - mod180(b)); return Math.min(d, 180 - d); };

/* ---------------- the realistic depths ---------------- */

/* The building depths (perpendicular to the dock walls) the search may pick, snapped to 20 ft: cross-dock buildings run deep, a
 * single-load building shallow. `maxDepthFt` is a cap, the template's own depth is always one of the rungs. */
export function depthLadder({ dockMode = "cross", templateDepthFt = null, minDepthFt = null, maxDepthFt = null } = {}) {
  const lo = minDepthFt ?? (dockMode === "single" ? 160 : dockMode === "none" ? 120 : 240);
  const hi = maxDepthFt ?? (dockMode === "single" ? 400 : dockMode === "none" ? 400 : 700);
  const out = [];
  for (let d = Math.ceil(lo / 20) * 20; d <= hi; d += 20) out.push(d);
  if (templateDepthFt && templateDepthFt >= 40) {
    const t = Math.round(templateDepthFt / 10) * 10;
    if (!out.includes(t)) { out.push(t); out.sort((a, b) => a - b); }
  }
  return out;
}

/* ---------------- angles ---------------- */

/* The principal axis of the inside cells (second moments) — degrees [0,180) from +x, y south. null when there is nothing. */
export function longAxisDeg(lat, inside) {
  const { nx, ny } = lat;
  let n = 0, mx = 0, my = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside[j * nx + i]) { n++; mx += i; my += j; }
  if (n < 3) return null;
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside[j * nx + i]) { const dx = i - mx, dy = j - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  if (Math.abs(sxx - syy) < 1e-9 && Math.abs(sxy) < 1e-9) return null;   // round: no axis
  return mod180((0.5 * Math.atan2(2 * sxy, sxx - syy)) / RAD);
}

/* The direction the contours RUN (perpendicular to the dominant slope) over the inside cells, degrees [0,180); null when the
 * ground is flat (mean slope under 0.2%) or has no data. */
export function contourAxisDeg(lat, inside) {
  const { nx, ny, cell, z } = lat;
  let sxx = 0, syy = 0, sxy = 0, n = 0, sg = 0;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i;
    if (!inside[k]) continue;
    const a = z[k - 1], b = z[k + 1], c = z[k - nx], d = z[k + nx];
    if (!(a === a) || !(b === b) || !(c === c) || !(d === d)) continue;
    const gx = (b - a) / (2 * cell), gy = (d - c) / (2 * cell);
    sxx += gx * gx; syy += gy * gy; sxy += gx * gy; n++; sg += Math.hypot(gx, gy);
  }
  if (n < 20 || sg / n < 0.002) return null;
  const grad = 0.5 * Math.atan2(2 * sxy, sxx - syy) / RAD;      // dominant gradient direction
  return mod180(grad + 90);
}

/* The orientation set, deduplicated: [{ deg, label }] (the building's LENGTH axis, along the dock walls). */
export function fitBaseAngles({ frontageDeg = null, longAxis = null, currentDeg = null, contourDeg = null, sameAngleDeg = FIT_DEFAULTS.sameAngleDeg } = {}) {
  const raw = [];
  const add = (deg, label) => { if (deg != null && Number.isFinite(deg)) raw.push({ deg: mod180(deg), label }); };
  add(frontageDeg, "frontage"); add(longAxis, "parcel"); add(currentDeg, "current"); add(contourDeg, "contours");
  if (frontageDeg != null) add(frontageDeg + 90, "frontage-perp");
  if (longAxis != null) add(longAxis + 90, "parcel-perp");
  const out = [];
  for (const a of raw) if (!out.some((b) => angDiff180(a.deg, b.deg) < sameAngleDeg)) out.push(a);
  if (!out.length) out.push({ deg: 0, label: "east-west" });
  return out;
}

/* ---------------- the prepared context ---------------- */

/* Rasterise the setback (where the BUILDING may stand) and the fence (the limit of disturbance, where the whole graded footprint
 * must daylight) onto the world lattice. Built once per (lattice, rings) in the worker. */
export function prepareFit({ lattice, setbackRings, setbackHoles = [], fenceRings, fenceHoles = [] }) {
  const sb = prepareSweep({ lattice, rings: setbackRings, holes: setbackHoles });
  const fe = prepareSweep({ lattice, rings: fenceRings, holes: fenceHoles });
  return {
    lattice, setbackInside: sb.inside, fenceInside: fe.inside, fenceBs: fe.bs,
    zMin: sb.zMin, zMax: sb.zMax, fenceCells: fe.insideCells, setbackCells: sb.insideCells,
    sig: `${sb.sig}#${fe.sig}`,
  };
}

/* ---------------- the rotated grid ---------------- */

/* The world lattice resampled onto a grid whose u axis points along `thetaDeg` (v = u turned +90°, so x = u·cosθ − v·sinθ,
 * y = u·sinθ + v·cosθ — the planner's `rot2`). Same cell size. Samples of the fence boundary ride along in cell-index space. */
export function rotatedGrid(ctx, thetaDeg, P) {
  const lat = ctx.lattice, c = lat.cell;
  const th = thetaDeg * RAD, cu = Math.cos(th), su = Math.sin(th);
  // world bbox of the fence's inside cells
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let j = 0; j < lat.ny; j++) for (let i = 0; i < lat.nx; i++) if (ctx.fenceInside[j * lat.nx + i]) {
    const x = lat.x0 + i * c, y = lat.y0 + j * c;
    if (x < bx0) bx0 = x; if (x + c > bx1) bx1 = x + c; if (y < by0) by0 = y; if (y + c > by1) by1 = y + c;
  }
  if (!isFinite(bx0)) return null;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [x, y] of [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]]) {
    const u = x * cu + y * su, v = -x * su + y * cu;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u; if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }
  uMin = Math.floor(uMin / c) * c; vMin = Math.floor(vMin / c) * c;
  const nu = Math.max(1, Math.ceil((uMax - uMin) / c)), nv = Math.max(1, Math.ceil((vMax - vMin) / c));
  const N = nu * nv;
  const z = new Float32Array(N), fenceIn = new Uint8Array(N), sbIn = new Uint8Array(N);
  for (let j = 0; j < nv; j++) {
    const v = vMin + (j + 0.5) * c;
    for (let i = 0; i < nu; i++) {
      const u = uMin + (i + 0.5) * c;
      const x = u * cu - v * su, y = u * su + v * cu;
      const wi = Math.floor((x - lat.x0) / c), wj = Math.floor((y - lat.y0) / c);
      const k = j * nu + i;
      if (wi < 0 || wj < 0 || wi >= lat.nx || wj >= lat.ny) { z[k] = NaN; continue; }
      const wk = wj * lat.nx + wi;
      fenceIn[k] = ctx.fenceInside[wk]; sbIn[k] = ctx.setbackInside[wk];
      const zz = latticeZAt(lat, x, y);
      z[k] = zz == null ? NaN : zz;
    }
  }
  const bs = ctx.fenceBs, m = bs.x.length;
  const bcx = new Float64Array(m), bcy = new Float64Array(m);
  for (let q = 0; q < m; q++) {
    const u = bs.x[q] * cu + bs.y[q] * su, v = -bs.x[q] * su + bs.y[q] * cu;
    bcx[q] = (u - uMin) / c - 0.5; bcy[q] = (v - vMin) / c - 0.5;
  }
  return { thetaDeg, cu, su, uMin, vMin, nu, nv, cell: c, z, fenceIn, sbIn, bcx, bcy, bz: bs.z, shared: new Map(), masks: new Map(), P };
}

const toWorld = (g, u, v) => ({ x: u * g.cu - v * g.su, y: u * g.su + v * g.cu });

/* Right-run lengths per row: run[i] = how many consecutive ok cells start at i going +u. */
function rightRuns(ok, nu, nv) {
  const run = new Int16Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    const b = j * nu;
    let r = 0;
    for (let i = nu - 1; i >= 0; i--) { r = ok[b + i] ? r + 1 : 0; run[b + i] = r; }
  }
  return run;
}

/* The fence-only run array at required elevation e (the pavement: courts, trailer rows, lots — the stacks). Cached on the BASE grid,
 * so it is shared by every derived grid (a different D never recomputes it: the daylight test does not depend on D).
 * THE MAX CUT / FILL (P.D) BINDS THE BUILDING PAD ONLY (V2115882, owner 2026-11-11): the courts, trailer rows and lots are paved
 * planes that fall away from the wall, so their depth under the surface is the template's, not the pad's rule; they need only to
 * daylight inside the fence (`P.Dstack`, unlimited unless a caller sets it). `P.noDaylight` (the last-resort tier) skips the
 * daylight test and keeps the fence + setback, so the assembly stays inside the limit but its slope may run past it. */
function stackRuns(g, e) {
  const key = (g.P.noDaylight ? "n" : "d") + e;
  let m = g.shared.get(key);
  if (m) return m;
  const { nu, nv, cell, z, fenceIn, P } = g;
  const N = nu * nv;
  const ok = new Uint8Array(N);
  const DS = P.Dstack ?? Infinity;
  for (let k = 0; k < N; k++) {
    if (!fenceIn[k]) continue;
    const zz = z[k];
    if (zz === zz && Math.abs(e - zz) <= DS) ok[k] = 1;
  }
  if (!P.noDaylight) blockByBoundary(ok, nu, nv, cell, g.bcx, g.bcy, g.bz, e, P.s, P.shoulderFt);
  m = { ok, runS: rightRuns(ok, nu, nv) };
  g.shared.set(key, m);
  return m;
}

/* The building's run array at required elevation e: the stack mask AND the setback AND the pad's cut / fill band (P.D). Per derived grid. */
function padRuns(g, e) {
  const key = e;
  let r = g.masks.get(key);
  if (r) return r;
  const { nu, nv, sbIn, z, P } = g;
  const { ok } = stackRuns(g, e);
  const N = nu * nv, okP = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (ok[k] && sbIn[k] && Math.abs(e - z[k]) <= P.D) okP[k] = 1;
  r = rightRuns(okP, nu, nv);
  g.masks.set(key, r);
  return r;
}

/* The same grid under other rules (D, daylight): shares the arrays and the stack-mask cache, owns its pad-run cache. */
export function deriveGrid(g, P) {
  return { ...g, P, masks: new Map() };
}

/* ---------------- the template's profile ---------------- */

const rowsOf = (ft, c) => Math.max(0, Math.ceil(ft / c - 1e-9));

/* Required elevation at distance t ft out from a wall, on a side whose stack starts `drop` below the finish. */
const fallE = (E, drop, slope, t) => E - drop - slope * t;

/* min over a side's stack rows of the fence-run, per building-start row (negative side: rows j0−1−m; positive: rows jEnd+m). */
function stackMin(g, E, rows, drop, dir) {
  const { nu, nv, cell, P } = g;
  const out = new Int16Array(nu * nv);
  if (rows <= 0) { out.fill(BIG); return out; }
  const slope = P.pavementSlopePct / 100;
  const runs = [];
  for (let m = 0; m < rows; m++) runs.push(stackRuns(g, Math.round(fallE(E, drop, slope, (m + 0.5) * cell))).runS);
  for (let j = 0; j < nv; j++) {
    const base = j * nu;
    // a row is only usable if all `rows` stack rows exist
    if (dir < 0 ? j - rows < 0 : j + rows > nv) continue;
    for (let i = 0; i < nu; i++) out[base + i] = BIG;
    for (let m = 0; m < rows; m++) {
      const rj = dir < 0 ? j - 1 - m : j + m;
      const rb = rj * nu, run = runs[m];
      let any = 0;
      for (let i = 0; i < nu; i++) { const v = run[rb + i]; if (v < out[base + i]) out[base + i] = v; any |= out[base + i]; }
      if (!any) break;
    }
  }
  return out;
}

/* ---------------- one (orientation, finish) unit ---------------- */

/* The best candidate of one unit, or null. With `collect` = { r, L } it instead gathers every position that supports a building of
 * r rows × L length (for the position refinement). */
function evalUnit(g, tpl, E, collect = null) {
  const { nu, nv, cell: c } = g;
  const rowsA = rowsOf(tpl.negDepth, c), rowsB = rowsOf(tpl.posDepth, c);
  const eN = rowsOf(tpl.endNeg, c), eP = rowsOf(tpl.endPos, c);
  const ladder = tpl.depthRows;
  const kMax = ladder[ladder.length - 1];
  const runPad = padRuns(g, E);
  const sA = stackMin(g, E, rowsA, tpl.negDrop, -1);
  const sB = stackMin(g, E, rowsB, tpl.posDrop, +1);
  const cur = new Int16Array(nu);
  let best = null;
  const positions = collect ? [] : null;
  for (let j0 = rowsA; j0 + ladder[0] + rowsB <= nv; j0++) {
    const rb0 = j0 * nu;
    let nz = 0;
    for (let i = 0; i < nu; i++) { cur[i] = runPad[rb0 + i]; nz |= cur[i]; }
    if (!nz) continue;
    let li = 0;
    for (let r = 1; r <= kMax && j0 + r + rowsB <= nv; r++) {
      if (r > 1) {
        const rb = (j0 + r - 1) * nu;
        nz = 0;
        for (let i = 0; i < nu; i++) { const v = runPad[rb + i]; if (v < cur[i]) cur[i] = v; nz |= cur[i]; }
        if (!nz) break;
      }
      if (r !== ladder[li]) continue;
      li++;
      const W = r * c;
      const sbase = (j0 + r) * nu;
      for (let i = 0; i < nu; i++) {
        const pr = cur[i];
        if (!pr) continue;
        const i0 = i + eN;
        if (i0 >= nu) continue;
        const st = Math.min(sA[rb0 + i0], sB[sbase + i0]);
        const Lcap = Math.min((pr - eN - eP) * c, st * c);
        const bays = Math.floor(Lcap / tpl.bayFt + 1e-9);
        if (bays < tpl.minBays) continue;
        const L = bays * tpl.bayFt;
        if (collect) { if (r === collect.r && L >= collect.L) positions.push({ j0, i, i0, r, L: collect.L, E, cap: L }); continue; }
        const sf = L * W;
        if (!best || sf > best.sf) best = { E, j0, i, i0, r, L, W, sf };
      }
    }
  }
  return collect ? positions : best;
}

/* ---------------- earthwork of a candidate (the search's own estimate) ---------------- */

/* Cut / fill (cubic yards, bank) of a candidate's whole assembly on the rotated grid: every cell of the pad, the side stacks and
 * the ends at its required elevation, plus the slope wedge (s·d²/2) and the shoulder (5 ft × d) along its outline. An ESTIMATE
 * from the lattice — the card the owner reads is re-priced by the real engine; this only has to rank candidates. */
export function estimateEarthwork(g, tpl, cand) {
  const { nu, nv, cell: c, P } = g;
  const slope = P.pavementSlopePct / 100;
  const rowsA = rowsOf(tpl.negDepth, c), rowsB = rowsOf(tpl.posDepth, c);
  const eN = rowsOf(tpl.endNeg, c), eP = rowsOf(tpl.endPos, c);
  const nL = Math.ceil(cand.L / c - 1e-9);
  const j0 = cand.j0, r = cand.r, i0 = cand.i0;
  // region bounds
  const jTop = j0 - rowsA, jBot = j0 + r + rowsB, iL = i0 - eN, iR = i0 + nL + eP;
  const regionE = (i, j) => {
    const inU = i >= i0 && i < i0 + nL, inV = j >= j0 && j < j0 + r;
    if (inV && inU) return cand.E;
    if (inV) return i < i0 ? fallE(cand.E, tpl.lotDrop, slope, (i0 - i - 0.5) * c) : (i >= i0 + nL ? fallE(cand.E, tpl.lotDrop, slope, (i - (i0 + nL) + 0.5) * c) : null);
    if (inU) return j < j0 ? fallE(cand.E, tpl.negDrop, slope, (j0 - j - 0.5) * c) : (j >= j0 + r ? fallE(cand.E, tpl.posDrop, slope, (j - (j0 + r) + 0.5) * c) : null);
    return null;
  };
  let cutCf = 0, fillCf = 0;
  const c2 = c * c;
  for (let j = Math.max(0, jTop); j < Math.min(nv, jBot); j++) {
    for (let i = Math.max(0, iL); i < Math.min(nu, iR); i++) {
      const e = regionE(i, j);
      if (e == null) continue;
      const zz = g.z[j * nu + i];
      if (!(zz === zz)) continue;
      const d = e - zz;
      if (d > 0) fillCf += d * c2; else cutCf -= d * c2;
      // outline cells carry the slope wedge + shoulder (edges facing a cell outside the region)
      let edges = 0;
      if (regionE(i - 1, j) == null) edges++;
      if (regionE(i + 1, j) == null) edges++;
      if (regionE(i, j - 1) == null) edges++;
      if (regionE(i, j + 1) == null) edges++;
      if (edges) {
        const ad = Math.abs(d);
        const vol = edges * c * (P.s * ad * ad / 2 + P.shoulderFt * ad);
        if (d > 0) fillCf += vol; else cutCf += vol;
      }
    }
  }
  const cutCy = cutCf / 27, fillCy = fillCf / 27;
  return { cutCy, fillCy, netCy: fillCy - cutCy };
}

const isBalanced = (ew, frac) => ew.cutCy > 0 ? Math.abs(ew.netCy) <= frac * ew.cutCy : Math.abs(ew.netCy) <= frac * Math.max(1, ew.fillCy);

/* ---------------- a candidate → the planner's frame ---------------- */

/* The candidate as world geometry: the building's box, its element-convention box ({cx, cy, w, h, rot} for the template's dock
 * axis), and the rings the ghost draws (the building, and the whole assembly's outline pieces). */
export function candidateGeometry(g, tpl, cand) {
  const c = g.cell;
  const uA = g.uMin + cand.i0 * c, uB = uA + cand.L;
  const vA = g.vMin + cand.j0 * c, vB = vA + cand.r * c;
  const centre = toWorld(g, (uA + uB) / 2, (vA + vB) / 2);
  const rect = (u0, u1, v0, v1) => [toWorld(g, u0, v0), toWorld(g, u1, v0), toWorld(g, u1, v1), toWorld(g, u0, v1)];
  const building = rect(uA, uB, vA, vB);
  const zones = [];
  if (tpl.negDepth > 0) zones.push({ kind: "neg", ring: rect(uA, uB, vA - tpl.negDepth, vA) });
  if (tpl.posDepth > 0) zones.push({ kind: "pos", ring: rect(uA, uB, vB, vB + tpl.posDepth) });
  if (tpl.endNeg > 0) zones.push({ kind: "endNeg", ring: rect(uA - tpl.endNeg, uA, vA, vB) });
  if (tpl.endPos > 0) zones.push({ kind: "endPos", ring: rect(uB, uB + tpl.endPos, vA, vB) });
  const W = cand.r * c;
  const theta = g.thetaDeg;
  const box = tpl.axis === "y"
    ? { cx: centre.x, cy: centre.y, w: W, h: cand.L, rot: mod360(theta - 90) }
    : { cx: centre.x, cy: centre.y, w: cand.L, h: W, rot: mod360(theta) };
  return { centre, building, zones, box, uDeg: theta, lengthFt: cand.L, depthFt: W };
}

/* Does the candidate's whole assembly still hold at finish E (whole-foot masks, as the search read them)? */
function supportsAt(g, tpl, cand, E) {
  const { nu, cell: c, P } = g;
  const slope = P.pavementSlopePct / 100;
  const rowsA = rowsOf(tpl.negDepth, c), rowsB = rowsOf(tpl.posDepth, c);
  const eN = rowsOf(tpl.endNeg, c), eP = rowsOf(tpl.endPos, c);
  const nL = Math.ceil(cand.L / c - 1e-9);
  const pad = padRuns(g, Math.round(E));
  // the masks read whole feet; a half-foot finish must still keep the pad inside the cut / fill band exactly
  if (padExceedFt(g, { ...cand, E }) > P.D + 1e-6) return false;
  for (let r = 0; r < cand.r; r++) if (pad[(cand.j0 + r) * nu + cand.i] < nL + eN + eP) return false;
  for (let m = 0; m < rowsA; m++) if (stackRuns(g, Math.round(fallE(E, tpl.negDrop, slope, (m + 0.5) * c))).runS[(cand.j0 - 1 - m) * nu + cand.i0] < nL) return false;
  for (let m = 0; m < rowsB; m++) if (stackRuns(g, Math.round(fallE(E, tpl.posDrop, slope, (m + 0.5) * c))).runS[(cand.j0 + cand.r + m) * nu + cand.i0] < nL) return false;
  return true;
}

/* The same building at the finish (half-foot steps, ±6 ft of the searched one) that moves the least dirt. */
function tuneFinish(g, tpl, rec, P) {
  let best = { ...rec, balanced: isBalanced(rec.ew, P.balancedFrac) };
  for (let E = rec.E - 6; E <= rec.E + 6 + 1e-9; E += 0.5) {
    if (E === rec.E) continue;
    const cand = { ...rec.cand, E };
    if (!supportsAt(g, tpl, cand, E)) continue;
    const ew = estimateEarthwork(g, tpl, cand);
    if (Math.abs(ew.netCy) < Math.abs(best.ew.netCy)) best = { deg: rec.deg, E, cand, ew, balanced: isBalanced(ew, P.balancedFrac) };
  }
  return best;
}

/* ---------------- the search ---------------- */

/* Round to the nearest 1,000 SF. */
export const roundSf = (sf) => Math.round(sf / 1000) * 1000;

function prepareTemplate(tpl, P, cell) {
  const rows = (tpl.depths || []).map((d) => Math.round(d / cell)).filter((r) => r >= 2);
  const depthRows = [...new Set(rows)].sort((a, b) => a - b);
  return {
    axis: tpl.axis === "y" ? "y" : "x",
    negDepth: Math.max(0, tpl.negDepth || 0), posDepth: Math.max(0, tpl.posDepth || 0),
    negDrop: tpl.negDrop ?? P.dockDropFt, posDrop: tpl.posDrop ?? P.dockDropFt, lotDrop: tpl.lotDrop ?? P.lotDropFt,
    endNeg: Math.max(0, tpl.endNeg || 0), endPos: Math.max(0, tpl.endPos || 0),
    bayFt: tpl.bayFt || P.bayFt, minBays: tpl.minBays || P.minBays,
    depthRows,
  };
}

/* The biggest cut or fill (ft) under the candidate's PAD — the number P.D limits. */
function padExceedFt(g, cand) {
  const { nu, cell: c } = g;
  const nL = Math.ceil(cand.L / c - 1e-9);
  let mx = 0;
  for (let r = 0; r < cand.r; r++) {
    const b = (cand.j0 + r) * nu;
    for (let i = cand.i0; i < cand.i0 + nL; i++) { const zz = g.z[b + i]; if (zz === zz) { const d = Math.abs(cand.E - zz); if (d > mx) mx = d; } }
  }
  return mx;
}

/* The generator. Yields `{ progress }` (0..1) once per unit; returns the result object. NEVER A DEAD END (V2115882, owner
 * 2026-11-11): when nothing fits under the plan's max cut / fill, the rule is RELAXED in steps and the biggest building that comes
 * closest is returned with `breaks` naming what it breaks and by how much:
 *   tier 0  the rules as set (the max cut / fill binds the pad only);
 *   tier 1  the smallest pad cut / fill (1-ft steps) at which the template's smallest building fits — then the biggest building at it
 *           (the search shrinks length — 5 bays minimum — and depth — the template's realistic ladder — on its own);
 *   tier 2  the daylight test off (the building and its pavement still inside the limit; the slope may run past it) with the
 *           smallest cut / fill that fits.
 * Only a setback that cannot hold the smallest building at any cut / fill is `why: "no-room"`.
 *   input: { ctx (prepareFit), template, params?, frontageDeg?, currentDeg?, angles?, shouldAbort? } */
export function* fitBuildingSteps(input) {
  const { ctx, template } = input;
  const P0 = { ...FIT_DEFAULTS, ...(input.params || {}) };
  const t0 = Date.now();
  const lat = ctx.lattice, c = lat.cell;
  const tpl = prepareTemplate(template, P0, c);
  if (!tpl.depthRows.length || !(ctx.setbackCells > 0) || !(ctx.fenceCells > 0)) return { best: null, alt: null, why: "no-ground", stats: { units: 0, ms: 0 } };
  const baseAngles = Array.isArray(input.angles) && input.angles.length ? input.angles.map((d) => ({ deg: mod180(d), label: "pinned" })) : fitBaseAngles({
    frontageDeg: input.frontageDeg ?? null, longAxis: longAxisDeg(lat, ctx.fenceInside),
    currentDeg: input.currentDeg ?? null, contourDeg: contourAxisDeg(lat, ctx.setbackInside), sameAngleDeg: P0.sameAngleDeg,
  });
  const slope0 = P0.pavementSlopePct / 100;
  const maxFall = Math.max(tpl.negDrop + slope0 * tpl.negDepth, tpl.posDrop + slope0 * tpl.posDepth, tpl.lotDrop + slope0 * Math.max(tpl.endNeg, tpl.endPos));
  const eLo = Math.floor(ctx.zMin), eHi = Math.ceil(ctx.zMax + (tpl.negDepth || tpl.posDepth || tpl.endNeg || tpl.endPos ? maxFall : 0));
  const aborted = () => !!(input.shouldAbort && input.shouldAbort());
  // the base grids, kept across the tiers (their stack masks are shared by every D); derived per rule set
  const bases = new Map();
  const baseFor = (deg) => {
    const key = Math.round(deg * 4);
    let g = bases.get(key);
    if (g === undefined) { if (bases.size >= 6) bases.delete(bases.keys().next().value); g = rotatedGrid(ctx, deg, P0); bases.set(key, g); }
    return g;
  };
  const coarseEs = []; for (let E = eLo; E <= eHi; E += P0.coarseStep) coarseEs.push(E);
  let unitCount = 0;

  // ---- tier 1 / 2 probe: the smallest pad cut / fill (D0 + k, whole feet) at which the template's SMALLEST building fits some unit
  const tplMin = { ...tpl, depthRows: [tpl.depthRows[0]] };
  const dCap = Math.max(P0.D, Math.ceil(ctx.zMax - ctx.zMin + maxFall) + 1);
  const kCap = Math.max(0, Math.ceil(dCap - P0.D));
  const findMinD = function* (noDaylight) {
    let kBest = kCap + 1;                                        // sentinel: none yet
    for (const a of baseAngles) {
      const g0 = baseFor(a.deg);
      if (!g0) continue;
      const gAt = (k) => deriveGrid(g0, { ...P0, D: P0.D + k, noDaylight });
      for (const E of coarseEs) {
        if (aborted()) return -2;
        const hi = kBest - 1;
        if (hi < 0) return 0;
        const feasible = (k) => !!evalUnit(gAt(k), tplMin, E);
        if (feasible(hi)) {
          let lo = -1, up = hi;                                   // lo infeasible (virtually), up feasible
          while (up - lo > 1) { const mid = (lo + up) >> 1; if (feasible(mid)) up = mid; else lo = mid; }
          kBest = up;
          if (kBest === 0) return 0;
        }
        unitCount++;
        yield { progress: Math.min(0.45, unitCount / (baseAngles.length * coarseEs.length + 1) * 0.45) };
      }
    }
    return kBest > kCap ? -1 : kBest;
  };

  let tier = 0, noDaylight = false, kUsed = 0;
  let k = yield* findMinD(false);
  if (k === -2) return { aborted: true };
  if (k === -1) {                                                  // not even with unlimited cut / fill under the daylight rule
    noDaylight = true; tier = 2;
    k = yield* findMinD(true);
    if (k === -2) return { aborted: true };
    if (k === -1) return { best: null, alt: null, why: "no-room", stats: { units: unitCount, ms: Date.now() - t0, tier: 2 } };
  } else if (k > 0) tier = 1;
  kUsed = k;
  if (noDaylight && k === 0) tier = 2;
  const P = { ...P0, D: P0.D + kUsed, noDaylight };
  const grids = new Map();
  const gridFor = (deg) => {
    const key = Math.round(deg * 4);
    let g = grids.get(key);
    if (g === undefined) { const b = baseFor(deg); g = b ? deriveGrid(b, P) : null; grids.set(key, g); }
    return g;
  };
  const units = new Map();      // `${θ}|${E}` → { deg, E, cand, ew, balanced }
  const totalGuess = (baseAngles.length + 4) * coarseEs.length + 40;
  const progBase = tier === 0 ? 0.05 : 0.45;
  const evalE = function* (deg, E) {
    const key = `${Math.round(deg * 4)}|${E}`;
    if (units.has(key)) return units.get(key);
    if (aborted()) return null;
    const g = gridFor(deg);
    let rec = null;
    if (g) {
      const cand = evalUnit(g, tpl, E);
      if (cand) {
        const ew = estimateEarthwork(g, tpl, cand);
        rec = { deg, E, cand, ew, balanced: isBalanced(ew, P.balancedFrac) };
      }
    }
    units.set(key, rec);
    unitCount++;
    yield { progress: Math.min(0.97, progBase + (0.97 - progBase) * unitCount / totalGuess) };
    return rec;
  };
  const bestOf = (deg) => { let b = 0; for (const [k2, r] of units) if (r && k2.startsWith(`${Math.round(deg * 4)}|`) && r.cand.sf > b) b = r.cand.sf; return b; };
  // stage 1: the base orientations, coarse finish
  for (const a of baseAngles) for (const E of coarseEs) { yield* evalE(a.deg, E); if (aborted()) return { aborted: true }; }
  // stage 2: ±spread around the two best bases
  const ranked = input.angles ? [] : baseAngles.map((a) => ({ a, sf: bestOf(a.deg) })).sort((p, q) => q.sf - p.sf).filter((x) => x.sf > 0).slice(0, 2);
  const spreadAngles = [];
  for (const { a } of ranked) for (const d of [-P.spreadDeg, P.spreadDeg]) {
    const deg = mod180(a.deg + d);
    if (![...baseAngles, ...spreadAngles].some((b) => angDiff180(b.deg, deg) < P.sameAngleDeg)) spreadAngles.push({ deg, label: `${a.label}${d > 0 ? "+" : "−"}${P.spreadDeg}` });
  }
  for (const a of spreadAngles) for (const E of coarseEs) { yield* evalE(a.deg, E); if (aborted()) return { aborted: true }; }
  // stage 3: the odd feet around what mattered, for the three best orientations
  const allAngles = [...baseAngles, ...spreadAngles];
  const top = allAngles.map((a) => ({ a, sf: bestOf(a.deg) })).sort((p, q) => q.sf - p.sf).filter((x) => x.sf > 0).slice(0, 3);
  for (const { a } of top) {
    const mine = [...units.values()].filter((r) => r && Math.round(r.deg * 4) === Math.round(a.deg * 4));
    const wanted = new Set();
    const around = (E0) => { for (let d = -P.fineSpan; d <= P.fineSpan; d++) { const E = E0 + d; if (E >= eLo && E <= eHi) wanted.add(E); } };
    const bySf = [...mine].sort((p, q) => q.cand.sf - p.cand.sf).slice(0, 2); bySf.forEach((r) => around(r.E));
    const bal = mine.filter((r) => r.balanced).sort((p, q) => q.cand.sf - p.cand.sf)[0];
    if (bal) around(bal.E);
    else { const nearZero = [...mine].sort((p, q) => Math.abs(p.ew.netCy) - Math.abs(q.ew.netCy))[0]; if (nearZero) around(nearZero.E); }
    for (const E of wanted) { yield* evalE(a.deg, E); if (aborted()) return { aborted: true }; }
  }
  // rank
  const all = [...units.values()].filter(Boolean);
  if (!all.length) return { best: null, alt: null, why: "no-fit", stats: { units: unitCount, ms: Date.now() - t0, angles: allAngles.length } };
  const better = (p, q) => (p.cand.sf !== q.cand.sf ? p.cand.sf > q.cand.sf : Math.abs(p.ew.netCy) < Math.abs(q.ew.netCy));
  // The finish is searched in whole feet; the geometry that matters (and the ones that could be BALANCED) are then tuned in half-feet
  // — the same building, the same SF, the finish that moves the least dirt (the tie-break), and the one that balances it.
  const pool = [...all].sort((p, q) => (q.cand.sf - p.cand.sf) || (Math.abs(p.ew.netCy) - Math.abs(q.ew.netCy))).slice(0, P.tunePool);
  const tuned = [];
  for (const rec of pool) {
    const g = gridFor(rec.deg);
    if (!g) continue;
    tuned.push(tuneFinish(g, tpl, rec, P));
    if (tuned.length % 6 === 0) yield { progress: 0.97 };
  }
  // a relaxed search ranks by SF, then by how little it breaks (a finish the half-foot tuning moved off the whole-foot one may sit a hair past D*)
  let bestRec = tuned[0]; for (const r of tuned) if (better(r, bestRec)) bestRec = r;
  let altRec = null; for (const r of tuned) if (r.balanced && (!altRec || better(r, altRec))) altRec = r;
  if (altRec && altRec === bestRec) altRec = null;
  // position refinement: among the positions that support the same building, the one with the least net dirt (then re-tuned)
  const refine = function* (rec) {
    const g = gridFor(rec.deg);
    const pos = evalUnit(g, tpl, Math.round(rec.E), { r: rec.cand.r, L: rec.cand.L });
    let bestRec2 = rec;
    if (pos.length > 1) {
      const step = Math.max(1, Math.ceil(pos.length / P.maxPositions));
      for (let k2 = 0; k2 < pos.length; k2 += step) {
        const p = pos[k2];
        const cand = { E: rec.E, j0: p.j0, i: p.i, i0: p.i0, r: p.r, L: p.L, W: p.r * c, sf: p.L * p.r * c };
        if (!supportsAt(g, tpl, cand, rec.E)) continue;
        const t = tuneFinish(g, tpl, { deg: rec.deg, E: rec.E, cand, ew: estimateEarthwork(g, tpl, cand) }, P);
        if (Math.abs(t.ew.netCy) < Math.abs(bestRec2.ew.netCy)) bestRec2 = t;
        if (k2 % (step * 8) === 0) yield { progress: 0.98 };
      }
    }
    return { rec: bestRec2, g };
  };
  const out = {};
  const finish = function* (rec) {
    const { rec: r, g } = yield* refine(rec);
    const geo = candidateGeometry(g, tpl, r.cand);
    const padFt = padExceedFt(g, r.cand);
    const breaks = [];
    if (padFt > P0.D + 0.05) breaks.push({ rule: "cutfill", limitFt: P0.D, actualFt: Math.round(padFt * 10) / 10 });
    if (noDaylight) breaks.push({ rule: "limit" });
    return {
      sf: r.cand.sf, sfRounded: roundSf(r.cand.sf), lengthFt: geo.lengthFt, depthFt: geo.depthFt, ffe: r.E,
      uDeg: geo.uDeg, box: geo.box, centre: geo.centre, building: geo.building, zones: geo.zones,
      cutCy: r.ew.cutCy, fillCy: r.ew.fillCy, netCy: r.ew.netCy, balanced: isBalanced(r.ew, P.balancedFrac),
      padCutFillFt: Math.round(padFt * 10) / 10, breaks,
    };
  };
  out.best = yield* finish(bestRec);
  out.alt = altRec ? yield* finish(altRec) : null;
  // an alternative the owner could not tell from the best (same size, same floor) is not an alternative
  if (out.alt && out.alt.sfRounded === out.best.sfRounded && Math.abs(out.alt.ffe - out.best.ffe) < 0.5) out.alt = null;
  out.stats = { units: unitCount, ms: Date.now() - t0, angles: allAngles.length, finishRange: [eLo, eHi], tier, dUsedFt: P.D, anglesUsed: allAngles.map((a) => ({ deg: Math.round(a.deg * 10) / 10, label: a.label })) };
  yield { progress: 1 };
  return out;
}

/* Drive the generator to completion (tests, Node). */
export function runFitSync(input) {
  const gen = fitBuildingSteps(input);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}
