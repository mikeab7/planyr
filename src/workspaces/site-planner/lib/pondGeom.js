// Pond-expansion geometry (B157) — where to anchor the "added detention area" map label.
//
// When you enlarge an existing pond (B139), the new ground is the EXPANDED footprint minus
// the existing/baseline footprint. We want the "+X ac · +Y sf" label to sit ON that new area
// — specifically on the THICKEST part of it — so it never drifts back into the existing
// basin. That matters because the whole pond's centroid often stays inside the old pond
// (e.g. a uniform "push the banks out" expansion leaves a ring of new ground whose centre of
// mass is the old water), which is exactly the confusing case to avoid.
//
// `addedAreaLabelPoint` returns the pole-of-inaccessibility of (expanded − baseline): the
// interior point of the new ground farthest from any edge. A coarse grid finds the deepest
// cell, then a local grid refines it. Pure (world-feet in / world-feet out), no React/DOM,
// so it unit-tests without a browser. Screening-grade placement, not survey geometry.
import { offsetInward, ringsArea, maxInwardOffset } from "./pondOffset.js";

// Even-odd ray cast: is point `pt` inside ring `ring` (array of {x,y})?
export const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

// Shortest distance from point `p` to segment a→b.
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

// Shortest distance from point `p` to the closed ring `ring` (includes the closing edge).
const distToRing = (p, ring) => {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const dd = distToSeg(p, ring[i], ring[(i + 1) % n]);
    if (dd < d) d = dd;
  }
  return d;
};

// Deepest interior point of the "added" region = inside `expanded` but outside `baseline`.
// Returns {x,y} in the same (world-feet) frame as the inputs, or null when there is no
// added ground (no expansion, a pure shrink, or a degenerate ring). `coarse`/`fine` are the
// grid subdivisions; the defaults are plenty for a screening label.
export function addedAreaLabelPoint(expanded, baseline, opts = {}) {
  if (!Array.isArray(expanded) || expanded.length < 3) return null;
  if (!Array.isArray(baseline) || baseline.length < 3) return null;
  const coarse = opts.coarse || 28, fine = opts.fine || 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of expanded) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const inAdded = (p) => pointInRing(p, expanded) && !pointInRing(p, baseline);
  // "Depth" of an added-region point = distance to the nearest edge of that region, whose
  // boundary is parts of the outer (expanded) ring and the inner (baseline) ring.
  const score = (p) => Math.min(distToRing(p, expanded), distToRing(p, baseline));
  const search = (x0, y0, x1, y1, n) => {
    let best = null, bestD = -1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      for (let j = 0; j <= n; j++) {
        const p = { x, y: y0 + ((y1 - y0) * j) / n };
        if (!inAdded(p)) continue;
        const d = score(p);
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    return best ? { x: best.x, y: best.y, d: bestD } : null;
  };
  const c = search(minX, minY, maxX, maxY, coarse);
  if (!c) return null;
  const cw = (maxX - minX) / coarse, ch = (maxY - minY) / coarse;
  const r = search(c.x - cw, c.y - ch, c.x + cw, c.y + ch, fine);
  const best = r && r.d >= c.d ? r : c;
  return { x: best.x, y: best.y };
}

// ---------------------------------------------------------------------------
// Stage contour lines (the "topographic" depth rings drawn inside a detention
// pond). A pond is drawn TOP-OF-BANK and tapers inward at `slope`:1, so the ring
// at depth `down` below the top is the footprint offset INWARD by slope*down. That
// offset must be a ROBUST topology op — clipper-lib's offsetInward (pondOffset.js) —
// not a per-edge miter, so acute corners don't spike, a narrowing tail pinches off,
// and a split basin returns multiple rings. Pure: world-feet in, world-feet out.
// ---------------------------------------------------------------------------

const ringCentroidAvg = (r) => { let x = 0, y = 0; for (const p of r) { x += p.x; y += p.y; } return { x: x / r.length, y: y / r.length }; };

// Smart contour interval (ft): aim for ~4–6 rings across the basin depth so a shallow
// pond gets 1-ft lines and a deep one doesn't crowd. User-overridable via det.contourInterval.
export function autoContourInterval(depth) {
  const d = depth > 0 ? depth : 8;
  if (d <= 6) return 1;
  if (d <= 12) return 2;
  return 3;
}

// Build the stack of stage contours for a pond footprint `ring` (top-of-bank, world feet).
// Returns levels top→bottom; each level carries `rings` — an ARRAY of result rings, since a
// robust inward offset can split the basin (multiple pools) or pinch it off (none). Stops
// the moment the offset returns nothing, and reports feasibility: a footprint can only grade
// to `maxDepth = maxInwardOffset(ring)/slope` before opposing slopes meet.
export function pondContours(ring, det = {}, opts = {}) {
  const depth = det.depth != null ? det.depth : 8;
  const freeboard = det.freeboard != null ? det.freeboard : 1;
  const slope = det.slope != null ? det.slope : 3;
  const interval = Math.max(0.5, det.contourInterval || autoContourInterval(depth));
  const tobElev = det.tobElev;
  const hasElev = tobElev != null && isFinite(tobElev);
  const EPS = 0.05;
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const out = { levels: [], collapsedAt: null, feasible: depth <= maxDepth + EPS, maxDepth, meta: { depth, freeboard, slope, interval } };
  if (!Array.isArray(ring) || ring.length < 3) return out;

  // Depths below top to draw: the interval grid, plus the water surface and the bottom
  // always (they carry the emphasis), de-duped within EPS so they don't double a grid line.
  const downs = [0];
  for (let d = interval; d < depth - EPS; d += interval) downs.push(d);
  if (freeboard > EPS && freeboard < depth - EPS) downs.push(freeboard);
  downs.push(depth);
  downs.sort((a, b) => a - b);
  const uniq = [];
  for (const d of downs) { if (d < -EPS) continue; if (!uniq.length || d - uniq[uniq.length - 1] > EPS) uniq.push(d); }

  const elevOf = (down) => (hasElev ? tobElev - down : undefined);
  for (const down of uniq) {
    if (down <= EPS) {
      out.levels.push({ down: 0, rings: [ring], area: ringsArea([ring]), isWater: freeboard <= EPS, isBottom: depth <= EPS, elev: elevOf(0) });
      continue;
    }
    const rings = offsetInward(ring, slope * down);
    // Pinch-off: the side slopes have met — nothing exists at this depth or deeper. Stop.
    if (!rings.length) { out.collapsedAt = down; break; }
    out.levels.push({
      down,
      rings,
      area: ringsArea(rings),
      isWater: Math.abs(down - freeboard) <= EPS,
      isBottom: Math.abs(down - depth) <= EPS,
      elev: elevOf(down),
    });
  }
  return out;
}

// Where to seat a contour's depth/elevation label: the ring's extreme vertex on the chosen
// side (top/bottom/left/right), nudged a hair inward so it sits just inside the line. Anchoring
// the water ring to the TOP and the bottom ring to the BOTTOM keeps the two callouts apart and
// reads intuitively (water surface high, floor low), clear of the centred pond name. Returns
// {x,y} (world feet) or null.

// Average-end-area storage volume (cubic feet) of a staged pond from its contour `levels`
// (the `pondContours(...).levels` array). Volume between two successive contour levels = the mean
// of their plan areas × the vertical step between them, summed from top-of-bank down to the deepest
// emitted level. Pure over the ENGINE-captured areas (clipper round-joins mean a level's area is not
// the raw rectangle formula), so a fixture golden computed from this is a deterministic
// "known geometry → known volume" — the detention regression the B278/B280 harness exercises.
export function pondStorageVolume(levels) {
  const ls = (Array.isArray(levels) ? levels : [])
    .filter((l) => l && isFinite(l.down) && isFinite(l.area))
    .sort((a, b) => a.down - b.down);
  let vol = 0;
  for (let i = 1; i < ls.length; i++) vol += ((ls[i].area + ls[i - 1].area) / 2) * (ls[i].down - ls[i - 1].down);
  return vol;
}

export function contourLabelPoint(contourRing, anchor = "top") {
  if (!Array.isArray(contourRing) || contourRing.length < 3) return null;
  const c = ringCentroidAvg(contourRing);
  let best = contourRing[0];
  for (const p of contourRing) {
    if (anchor === "bottom") { if (p.y > best.y) best = p; }
    else if (anchor === "left") { if (p.x < best.x) best = p; }
    else if (anchor === "right") { if (p.x > best.x) best = p; }
    else if (p.y < best.y) best = p; // "top" (default)
  }
  const dx = c.x - best.x, dy = c.y - best.y, L = Math.hypot(dx, dy) || 1;
  const n = Math.min(10, L * 0.4);
  return { x: best.x + (dx / L) * n, y: best.y + (dy / L) * n };
}
