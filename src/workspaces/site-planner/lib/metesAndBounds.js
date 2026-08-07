/* Polyline offset / buffer / overlap primitives — pure, and on the BOOT PATH.
 *
 * These are the shared geometry behind every easement and setback strip, the road corridor, the
 * pipeline corridor and the KMZ export, so they are imported synchronously by several modules.
 * The DEED PARSER that used to live here moved to `deedParse.js` and is loaded on demand
 * (`deedParseLazy.js`) — it is only ever needed inside the deed workflow, and the site route has
 * no bundle headroom to carry it. Keep that separation: adding a parser import here puts ~5.5 KB
 * of minified deed-reading code back onto the planner's critical path.
 *
 * VIEW-INDEPENDENT-ONCE (NEW-2, 2026-08-06) — `offsetPolyline` and `bufferPolyline` are CACHED on
 * the identity of the polyline they are given. Measured by ui-audit/detect-view-recompute.mjs on a
 * 60-move pan of the reference plan: 2,256 calls of `offsetPolyline` and 1,128 of `bufferPolyline`
 * producing twelve and six distinct answers respectively — the same six roads' curb lines and
 * corridors re-derived on every render because the map moved. The centerlines they are taken of
 * are now cached themselves (`roadGeometry.roadCenterlineTagged`), so their IDENTITY is stable
 * across a gesture, which is what makes a `WeakMap` the right key here: free to compute, and it
 * holds nothing alive.
 *
 * ⛔ The precondition is that a caller does not MUTATE a point array in place and expect a fresh
 * answer — see `pureCache.js`. Every caller in this repo either builds a fresh array or replaces
 * model arrays wholesale.
 */
import { identityCache } from "./pureCache.js";

const _offCache = identityCache();
const _bufCache = identityCache();

/* Offset an OPEN polyline by `dist` feet along its left-hand normal (a NEGATIVE
 * `dist` offsets to the right side). Joins are mitered and the miter is clamped so
 * a tight corner doesn't blow out into a spike. Returns a polyline with one point
 * per input vertex (or null if < 2 points).
 *
 * This is the SHARED offset primitive behind every easement/setback strip: the
 * symmetric corridor (bufferPolyline, ±half each side) and the one-sided
 * parcel-edge / building-line strip (offset to a single side). Built once here so
 * the centerline tool, the parcel-edge tool, and a future setback tool reuse the
 * exact same corner math (NEW-1 / NEW-3). */
export function offsetPolyline(pts, dist) {
  if (!pts || pts.length < 2) return null;
  const hit = _offCache.get(pts, `o${dist}`);
  if (hit !== undefined) return hit;
  return _offCache.set(pts, `o${dist}`, offsetPolylineUncached(pts, dist));
}

function offsetPolylineUncached(pts, dist) {
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    seg.push({ nx: -dy / len, ny: dx / len }); // left normal of this segment
  }
  const normalAt = (i) => {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i)];
    let nx = a.nx + b.nx, ny = a.ny + b.ny;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    // miter length grows in tight corners; clamp so it doesn't blow out
    const cos = a.nx * b.nx + a.ny * b.ny;
    const scale = Math.min(1 / Math.max(0.3, Math.sqrt((1 + cos) / 2)), 3);
    return { nx: nx * scale, ny: ny * scale };
  };
  return pts.map((p, i) => { const n = normalAt(i); return { x: p.x + n.nx * dist, y: p.y + n.ny * dist }; });
}

/* Buffer an open polyline into a closed strip ring of total width `w` (a corridor
 * easement). Offsets each vertex by ±w/2 along the averaged segment normals
 * (miter join, clamped) and returns left-side-forward + right-side-back ring, with
 * flat end caps.
 *
 * ASYMMETRY-READY: pass `{ leftW, rightW }` to offset a different distance on each
 * side of the centerline. The default (no opts) stays the exact ±w/2 symmetric
 * strip every existing caller relies on, so a future asymmetric-easement UI needs
 * no geometry rework — just supply the two half-widths (NEW-1 engine note). */
export function bufferPolyline(pts, w, opts = {}) {
  if (!pts || pts.length < 2) return null;
  const key = `b${w}|${opts.leftW ?? ""}|${opts.rightW ?? ""}`;
  const hit = _bufCache.get(pts, key);
  if (hit !== undefined) return hit;
  return _bufCache.set(pts, key, bufferPolylineUncached(pts, w, opts));
}

function bufferPolylineUncached(pts, w, opts = {}) {
  const leftW = opts.leftW != null ? opts.leftW : w / 2;
  const rightW = opts.rightW != null ? opts.rightW : w / 2;
  const left = offsetPolyline(pts, leftW);
  const right = offsetPolyline(pts, -rightW);
  if (!left || !right) return null;
  return [...left, ...right.reverse()];
}

/* --- overlap test: do two convex-ish polygons (rings of {x,y}) intersect? ---
 * Uses vertex-containment + edge-crossing (handles partial overlaps the bbox
 * test would miss). Good enough for "warn me if this easement crosses a
 * building/paving footprint". */
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, xi = ring[i].x, yj = ring[j].y, xj = ring[j].x;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);

export function ringsOverlap(A, B) {
  if (!A?.length || !B?.length) return false;
  if (A.some((p) => pointInRing(p, B)) || B.some((p) => pointInRing(p, A))) return true;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const c = B[j], d = B[(j + 1) % B.length];
      if (segCross(a, b, c, d)) return true;
    }
  }
  return false;
}
