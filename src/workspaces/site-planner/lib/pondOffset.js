// Robust inward polygon offset for detention-pond grading contours, via clipper-lib (the
// Clipper library — a CAD/CAM-grade polygon-offset engine). Unlike a per-edge miter offset
// (the old offsetPolygon) it repairs self-intersections, PINCHES OFF a narrowing region
// (returns fewer rings, or none), can SPLIT a basin into multiple pools (multiple rings),
// and never produces the outward spikes that plagued acute corners. Round joins also match
// how earthwork is actually graded — you can't cut a knife-edge corner in dirt.
//
// Pure: world-feet in, world-feet out, no React/DOM — unit-testable without a browser.
// Clipper works in integers, so we scale feet → centi-feet (~0.01 ft ≈ 1/8" precision).
import ClipperLib from "clipper-lib";

const SCALE = 100;            // feet → centi-feet
const ARC_TOL = 0.25 * SCALE; // round-join chord tolerance (~0.25 ft) → smooth contour arcs
const MITER = 2;

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path) => path.map((c) => ({ x: c.X / SCALE, y: c.Y / SCALE }));

// |area| (sf) of a single ring via the shoelace formula.
const ringAbsArea = (r) => { let s = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; s += p.x * q.y - q.x * p.y; } return Math.abs(s / 2); };

// Inward offset of `ring` (world feet) by `dist` feet. Returns an ARRAY of result rings:
//   []          → the offset pinched the basin to nothing (clean infeasible floor)
//   [r]         → the usual single shrunk ring
//   [r1, r2, …] → the basin split into separate pools (a real, valid topology)
// Never throws and never returns self-intersecting garbage (degenerate input → []).
export function offsetInward(ring, dist) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  if (!(dist > 0)) return [ring.map((p) => ({ x: p.x, y: p.y }))];
  try {
    let path = toPath(ring);
    path = ClipperLib.Clipper.CleanPolygon(path, SCALE * 0.01); // drop sub-precision noise
    if (path.length < 3) return [];
    // Normalise orientation so a NEGATIVE delta always shrinks inward, regardless of how the
    // user drew the ring (clockwise vs counter-clockwise on screen).
    if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
    const co = new ClipperLib.ClipperOffset(MITER, ARC_TOL);
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const sol = new ClipperLib.Paths();
    co.Execute(sol, -dist * SCALE);
    const out = [];
    for (const p of sol) {
      if (!p || p.length < 3) continue;
      const r = fromPath(ClipperLib.Clipper.Area(p) < 0 ? p.slice().reverse() : p);
      if (r.length >= 3) out.push(r);
    }
    return out;
  } catch {
    return []; // a degenerate / self-intersecting footprint yields nothing, never garbage
  }
}

// Total filled area (sf) across a set of rings (from offsetInward).
export function ringsArea(rings) {
  let a = 0;
  for (const r of rings) a += ringAbsArea(r);
  return a;
}

// Largest inward-offset distance (feet) before the basin pinches to nothing — the maximum
// inscribed reach. Binary-searched against the REAL offset so it matches what gets drawn.
// max gradeable depth = maxInwardOffset(footprint) / sideSlopeRatio.
export function maxInwardOffset(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  let lo = 0, hi = Math.max(maxX - minX, maxY - minY) / 2 + 1; // inscribed reach ≤ half the larger side
  if (offsetInward(ring, hi).length) return hi;                // (guard) shouldn't be reachable
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (offsetInward(ring, mid).length) lo = mid; else hi = mid;
  }
  return lo;
}
