/* NEW-4 — the real acceptance check for "is this junction fully paved, with no enclosed gap."
 *
 * Two prior rounds (B1645792, B1645792 ×2) shipped a test that LOOKED like this check —
 * `throatNotchCells` in test/roadDriveJunctionFillet.test.js — but it was not one: it scanned only
 * within 12 ft of the tee point and flagged a cell only when >=3 of its 4 immediate neighbours were
 * ALREADY known-paved (a one-step heuristic, not a flood fill). Neither property holds for the real
 * defect: an oblique throat notch measured live at 8.4 ft deep by 32.2 ft ALONG THE PAD EDGE sits
 * mostly outside a 12 ft window, and a wide unpaved region has interior cells with zero paved
 * neighbours, which the heuristic simply never visits.
 *
 * THE REAL TEST: flood-fill from the scan box's own border. Any UNPAVED cell the flood fill cannot
 * reach from the border is enclosed by pavement on every side — a real hole, at any size, any
 * shape, any distance from the tee point. This is a direct, dependency-free reimplementation of the
 * "flood fill of (pad ∪ all road surfaces) via isPointInFill" method used to find these defects live
 * on the deployed build (b8d3c27 / f7408e0): here `isPaved(pt)` stands in for isPointInFill, driven
 * by the SAME world-feet polygons — a pad ring/rings and dissolveRings' own {outer,holes} regions —
 * the renderer turns into the actual SVG `d` attribute (see roadNetwork.regionPathD). Nothing here
 * re-derives geometry; it only asks whether a grid of points is covered by the shapes already
 * computed by the real pipeline (teeGeometry / dissolveRings / driveJunctionsOf).
 *
 * ⛔ A VACUOUS zero is worse than no check (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 / NEW-4's own
 * instruction). `selfTestControl` punches a small disc out of an otherwise-paved point and re-runs
 * the SAME flood fill — if that does not come back non-zero, the scan box/step/predicate can't see
 * a hole at all and the caller must refuse to trust a "0" from it.
 */

// Even-odd point-in-ring (ray cast). Pure, no deps — matches roadGeometry.polygonContainsPoint /
// ringMath.pointInRing's own algorithm so this stays consistent with what the renderer uses.
export function pointInRing(p, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Is `p` inside region {outer, holes}? Inside the outer ring and outside every hole.
export function pointInRegion(p, region) {
  if (!region || !pointInRing(p, region.outer)) return false;
  for (const h of region.holes || []) if (pointInRing(p, h)) return false;
  return true;
}

/* isPaved(pt) built from a list of pad rings (plain closed polylines — a pad has no holes) and a
 * list of dissolved road {outer,holes} regions — exactly the two families the dispatch named
 * ("pad rect union all road surfaces"). */
export function pavedPredicate(padRings, roadRegions) {
  const pads = padRings || [];
  const roads = roadRegions || [];
  return (pt) => {
    for (const ring of pads) if (pointInRing(pt, ring)) return true;
    for (const r of roads) if (pointInRegion(pt, r)) return true;
    return false;
  };
}

/* Real flood fill: BFS of UNPAVED cells starting from the scan box's own border. Any unpaved cell
 * never reached is enclosed by pavement on every side. Returns world-feet points for enclosed cells
 * (capped by the grid resolution `step`), plus counts. */
export function floodFillEnclosed(isPaved, bbox, step) {
  const nx = Math.max(2, Math.round((bbox.x1 - bbox.x0) / step) + 1);
  const ny = Math.max(2, Math.round((bbox.y1 - bbox.y0) / step) + 1);
  const idx = (i, j) => j * nx + i;
  const ptAt = (i, j) => ({ x: bbox.x0 + i * step, y: bbox.y0 + j * step });
  const paved = new Uint8Array(nx * ny);
  let unpavedTotal = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = isPaved(ptAt(i, j));
      paved[idx(i, j)] = p ? 1 : 0;
      if (!p) unpavedTotal++;
    }
  }
  const open = new Uint8Array(nx * ny); // unpaved AND reachable from the border
  const qx = new Int32Array(nx * ny), qy = new Int32Array(nx * ny);
  let qh = 0, qt = 0;
  const offer = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const id = idx(i, j);
    if (paved[id] || open[id]) return;
    open[id] = 1; qx[qt] = i; qy[qt] = j; qt++;
  };
  for (let i = 0; i < nx; i++) { offer(i, 0); offer(i, ny - 1); }
  for (let j = 0; j < ny; j++) { offer(0, j); offer(nx - 1, j); }
  while (qh < qt) {
    const i = qx[qh], j = qy[qh]; qh++;
    offer(i + 1, j); offer(i - 1, j); offer(i, j + 1); offer(i, j - 1);
  }
  const enclosed = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const id = idx(i, j);
      if (!paved[id] && !open[id]) enclosed.push(ptAt(i, j));
    }
  }
  return { enclosed, enclosedCount: enclosed.length, unpavedTotal, nx, ny, step };
}

/* Approximate real-world area (sq ft) of the enclosed cells — each cell stands in for a step×step
 * square, which is what the caller should read as "how big is the hole", not the raw cell count. */
export function enclosedAreaSqFt(result) {
  return result.enclosedCount * result.step * result.step;
}

/* THE SELF-TEST (NEW-4's mandatory control). Punches a small disc of radius `discR` out of an
 * otherwise-paved point and re-runs the identical flood fill. A working scan MUST report a non-zero
 * enclosed count here — if it reports zero, the scan box/resolution/predicate cannot see a hole at
 * this scale at all, and any "0" it reported on the real geometry is VACUOUS, not a pass. */
export function selfTestControl(isPaved, bbox, step, discCenter, discR) {
  const r = discR > 0 ? discR : Math.max(step * 1.5, 1.5);
  const withHole = (pt) => isPaved(pt) && Math.hypot(pt.x - discCenter.x, pt.y - discCenter.y) > r;
  return floodFillEnclosed(withHole, bbox, step);
}

/* Run the scan + its own self-test in one call, and THROW if the self-test doesn't come back
 * non-zero — a caller that ignores the return value can't accidentally trust a vacuous zero. */
export function assertMeasurableFloodFill(isPaved, bbox, step, discCenter, discR, label) {
  const real = floodFillEnclosed(isPaved, bbox, step);
  const control = selfTestControl(isPaved, bbox, step, discCenter, discR);
  if (!(control.enclosedCount > 0)) {
    throw new Error(
      `paveFloodFill self-test FAILED${label ? ` (${label})` : ""}: subtracting a disc at ` +
      `(${discCenter.x.toFixed(1)}, ${discCenter.y.toFixed(1)}) r=${discR ?? "auto"} produced ` +
      `${control.enclosedCount} enclosed cells (expected > 0) — this scan cannot see a hole at all; ` +
      `its "${real.enclosedCount}" on the real geometry is VACUOUS, not a pass.`
    );
  }
  return { real, control };
}
