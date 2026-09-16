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

/* NEW-1 (this dispatch) — THE MEASUREMENT `floodFillEnclosed` CANNOT MAKE: a concavity cut into the
 * paved area that is OPEN to the surrounding grass (reachable from the scan box's own border) is
 * invisible to a border-flood-fill by construction — the fill walks straight through it. Three PRs
 * (B1645792 and its two amendments) each shipped a fully green suite built entirely on
 * `floodFillEnclosed`, and the owner's real junction is visibly broken tonight: the defect is a
 * bevel cut out of the pavement that is open to the grass — a boundary CONCAVITY, not a hole — so
 * every one of those green runs measured a true, meaningless zero.
 *
 * `convexDeficiency` asks a different, complementary question: within a window, how much of the
 * CONVEX HULL of the paved cells is NOT paved? A perfectly filled convex shape (a rectangle, a
 * square corner) has zero deficiency. A corner that got a real, tangent, constant-radius curb
 * return has a SMALL, bounded deficiency — exactly the circular segment the fillet itself cuts from
 * the square corner (this is expected and correct; a fillet is concave relative to the corner it
 * rounds). A corner that got a raw bevel or no return at all has a LARGE deficiency — the whole
 * triangular gore the return should have filled. So this is a RATIO/MAGNITUDE measure, not a
 * strict-zero one like the enclosed-hole scan: the acceptance test compares the deficiency at each
 * junction corner against the deficiency the SAME junction's own best (working) corner shows, or
 * against a stated ceiling — never a bare "must be exactly 0", which a legitimate fillet can never
 * satisfy. Keep `floodFillEnclosed` running alongside this — the two catch different shapes of the
 * same underlying defect (an enclosed courtyard vs. an open notch), and neither substitutes for the
 * other. */

// Convex hull (monotone chain), dependency-free — mirrors roadGeometry.js's own (unexported) hull so
// this ui-audit lib stays free of a source import (it measures RENDERED geometry, never re-derives
// it). Returns a CCW ring of >= 3 points, or null for < 3 distinct input points.
export function convexHullOf(points) {
  const pts = (points || [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const n = pts.length;
  if (n < 3) return null;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : null;
}

/* Real convex-deficiency scan: grid-sample `bbox` at `step`, take the convex hull of every PAVED
 * cell, then count UNPAVED cells that fall inside that hull. Returns world-feet points for the
 * deficient cells (capped by grid resolution), plus counts — same shape discipline as
 * `floodFillEnclosed` so a caller can treat the two uniformly. */
export function convexDeficiency(isPaved, bbox, step) {
  const nx = Math.max(2, Math.round((bbox.x1 - bbox.x0) / step) + 1);
  const ny = Math.max(2, Math.round((bbox.y1 - bbox.y0) / step) + 1);
  const ptAt = (i, j) => ({ x: bbox.x0 + i * step, y: bbox.y0 + j * step });
  const pavedPts = [];
  const cells = [];
  let pavedCount = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = ptAt(i, j);
      const paved = isPaved(p);
      cells.push({ p, paved });
      if (paved) { pavedPts.push(p); pavedCount++; }
    }
  }
  const hull = convexHullOf(pavedPts);
  if (!hull) return { deficient: [], deficientCount: 0, pavedCount, hull: null, nx, ny, step };
  const deficient = [];
  for (const c of cells) {
    if (c.paved) continue;
    if (pointInRing(c.p, hull)) deficient.push(c.p);
  }
  return { deficient, deficientCount: deficient.length, pavedCount, hull, nx, ny, step };
}

/* Approximate real-world area (sq ft) of the deficient cells — mirrors `enclosedAreaSqFt`. */
export function deficiencyAreaSqFt(result) {
  return result.deficientCount * result.step * result.step;
}

/* THE MANDATORY CONTROL for convex deficiency (same discipline `selfTestControl` enforces for the
 * enclosed-hole scan, and the SAME shape DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 asks for: a probe must
 * report its KNOWN answer before its unknown one is trusted). Erasing a disc from an otherwise
 * solidly-paved square must produce a LARGE, nonzero deficiency — proving the scan box/step/hull can
 * see a concavity at all before its "small" or "zero" reading on the real geometry is trusted. */
export function convexDeficiencySelfTest(isPaved, bbox, step, discCenter, discR) {
  const r = discR > 0 ? discR : Math.max(step * 1.5, 1.5);
  const withHole = (pt) => isPaved(pt) && Math.hypot(pt.x - discCenter.x, pt.y - discCenter.y) > r;
  return convexDeficiency(withHole, bbox, step);
}

/* Run the convex-deficiency scan + its own self-test in one call, and THROW if the control doesn't
 * come back non-zero — mirrors `assertMeasurableFloodFill` exactly, so a caller cannot accidentally
 * trust a vacuous reading from either measure. */
export function assertMeasurableConvexDeficiency(isPaved, bbox, step, discCenter, discR, label) {
  const real = convexDeficiency(isPaved, bbox, step);
  const control = convexDeficiencySelfTest(isPaved, bbox, step, discCenter, discR);
  if (!(control.deficientCount > 0)) {
    throw new Error(
      `paveFloodFill convex-deficiency self-test FAILED${label ? ` (${label})` : ""}: subtracting a ` +
      `disc at (${discCenter.x.toFixed(1)}, ${discCenter.y.toFixed(1)}) r=${discR ?? "auto"} produced ` +
      `${control.deficientCount} deficient cells (expected > 0) — this scan cannot see a concavity at ` +
      `all; its reading on the real geometry is VACUOUS, not a pass.`
    );
  }
  return { real, control };
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
