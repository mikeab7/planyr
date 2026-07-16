/* Building footprint reshape — rect → polygon promotion + dock-frame preservation (NEW-1 / B872).
 *
 * A placed building is a rectangle (`cx,cy,w,h,rot`). To angle an end wall or clip a corner, we
 * PROMOTE it to a polygon: `el.points = rectRing(el)` (world feet, rotation baked in) and from then
 * on the shared B230 vertex engine drives it (drag corners, insert/delete control points). The one
 * thing that must survive is the DOCK FRAME — the two (cross) / one (single) loaded walls the whole
 * site plan hangs off. We keep those walls STRAIGHT by remembering each as a fixed world-feet LINE
 * (`el.dockLines`), NOT by a mutable edge index (an index shifts the moment you insert a control
 * point on an end wall). A dock corner then slides ALONG its line; an end-wall vertex moves freely.
 *
 * Everything here is PURE + framework-free (its own rot2, like dockZones.js / dogEar.js) so the
 * geometry is unit-testable apart from the React canvas; SitePlanner.jsx wires it to the els list,
 * the drag handlers, the panel and the renderer. Real-world US survey feet (EPSG:2278) throughout.
 */

import { dockSidesFor } from "./dockZones.js";

const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

// World-feet rectangle corners of a building box — order TL, TR, BR, BL, rotation baked in.
// Mirrors SitePlanner's `elCorners` exactly, so a promoted building's ring starts as its true rect.
export function rectRing(el) {
  const hw = el.w / 2, hh = el.h / 2, rot = el.rot || 0;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = rot2(lx, ly, rot);
    return { x: el.cx + p.x, y: el.cy + p.y };
  });
}

// The dock-wall LINES (world feet) for a rect building's dock sides. Each: { side, p:{x,y}, d:{x,y} }
// where `p` is a point on the wall (its midpoint) and `d` is the UNIT direction ALONG the wall. Only
// the real dock sides are returned (cross → 2 parallel lines, single → 1, none → 0). A dock corner
// stays on its line forever, so storing the line once (at conversion) is a permanent, index-free
// anchor: inserting a control point on an end wall can never renumber it.
export function dockLinesFor(el) {
  const { dockSides } = dockSidesFor(el);
  const hw = el.w / 2, hh = el.h / 2, rot = el.rot || 0;
  const w = (lx, ly) => { const p = rot2(lx, ly, rot); return { x: el.cx + p.x, y: el.cy + p.y }; };
  const ends = {
    top: [w(-hw, -hh), w(hw, -hh)],
    bottom: [w(-hw, hh), w(hw, hh)],
    left: [w(-hw, -hh), w(-hw, hh)],
    right: [w(hw, -hh), w(hw, hh)],
  };
  return dockSides.map((side) => {
    const [a, b] = ends[side];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    return { side, p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: dx / L, y: dy / L } };
  });
}

// The element patch that promotes a rect building to an editable polygon. `points` is the rect ring,
// `dockLines` pins the loaded walls, `footEdit` marks the building as reshaped. `cx/cy/w/h/rot` are
// left as-is — they already equal the ring's dock-frame bounding box, and stay in sync from here on.
export function convertBuildingToPolygon(el) {
  return { points: rectRing(el), dockLines: dockLinesFor(el), footEdit: true };
}

// Perpendicular (signed-magnitude) distance from `pt` to the infinite line — the component of
// (pt − p) along the line's unit normal (−d.y, d.x).
export function distToLine(line, pt) {
  const wx = pt.x - line.p.x, wy = pt.y - line.p.y;
  return Math.abs(wx * -line.d.y + wy * line.d.x);
}

// Foot of the perpendicular from `pt` to the infinite line — where a dragged dock corner lands so it
// slides ALONG the wall instead of off it.
export function projectOntoLine(line, pt) {
  const wx = pt.x - line.p.x, wy = pt.y - line.p.y;
  const t = wx * line.d.x + wy * line.d.y;
  return { x: line.p.x + line.d.x * t, y: line.p.y + line.d.y * t };
}

// Which dock line (if any) `pt` currently lies on, within `tolFt`. Nearest wins (parallel cross-dock
// walls never overlap, so a corner is on exactly one). Null ⇒ a free vertex (end wall / rear).
export function dockLineAt(dockLines, pt, tolFt = 0.5) {
  let best = null;
  (dockLines || []).forEach((ln) => {
    const d = distToLine(ln, pt);
    if (d <= tolFt && (!best || d < best.d)) best = { line: ln, d };
  });
  return best ? best.line : null;
}

// Is edge `i` (points[i] → points[i+1]) a DOCK wall — i.e. both its endpoints sit on the SAME dock
// line (so the segment lies on it)? Used to BLOCK inserting a control point on a loaded wall: a dock
// wall must stay straight in v1. Returns the matched dock line (truthy) or null.
export function dockEdgeLine(points, dockLines, i, tolFt = 0.5) {
  const n = points.length;
  if (n < 2) return null;
  const a = points[i], b = points[(i + 1) % n];
  return (dockLines || []).find((ln) => distToLine(ln, a) <= tolFt && distToLine(ln, b) <= tolFt) || null;
}

// Axis-aligned bounding box of `points` in the dock frame (rotation `rot`), returned in WORLD feet:
// { cx, cy, w, h } where cx/cy is the world centre of that frame box. Recomputed after every reshape
// so downstream consumers (dockSidesFor, footprintDepth/Length, the grid, KMZ) keep reading correct
// bounding dims off w/h — the building's true area stays polyArea(points), this is just the frame.
export function frameBBox(points, rot = 0) {
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  points.forEach((pt) => {
    const q = rot2(pt.x, pt.y, -rot);
    if (q.x < lo) lo = q.x; if (q.x > hi) hi = q.x;
    if (q.y < lo2) lo2 = q.y; if (q.y > hi2) hi2 = q.y;
  });
  const c = rot2((lo + hi) / 2, (lo2 + hi2) / 2, rot);
  return { cx: c.x, cy: c.y, w: hi - lo, h: hi2 - lo2 };
}

// Translate the stored dock lines by (dx,dy) — used when a reshaped building is MOVED (its points
// translate; the pinned walls must travel with them).
export function translateDockLines(dockLines, dx, dy) {
  return (dockLines || []).map((ln) => ({ ...ln, p: { x: ln.p.x + dx, y: ln.p.y + dy } }));
}

// Rotate the stored dock lines about `pivot` by `deg` — used when a reshaped building is rotated as
// part of a multi-selection (its points rotate; the walls rotate with them).
export function rotateDockLines(dockLines, pivot, deg) {
  return (dockLines || []).map((ln) => {
    const rp = rot2(ln.p.x - pivot.x, ln.p.y - pivot.y, deg);
    const rd = rot2(ln.d.x, ln.d.y, deg);
    return { ...ln, p: { x: pivot.x + rp.x, y: pivot.y + rp.y }, d: rd };
  });
}

// The dock WALL's actual segment along its length, as { startF, endF, L } in the 0..L length-offset
// coordinate the column grid uses (0 = the low length edge of the frame bbox, L = footprint length).
// Repoints dock doors + the truck-court trim to the TRUE wall when a corner is clipped or an end wall
// is angled (the wall shortens/lengthens); returns null for a non-dock side or a wall with < 2 corners.
export function dockSegExtent(el, side, tolFt = 0.5) {
  const dl = (el.dockLines || []).find((x) => x.side === side);
  if (!dl || !Array.isArray(el.points) || el.points.length < 2) return null;
  const rot = el.rot || 0;
  const horiz = side === "top" || side === "bottom"; // length axis runs along local x for a horizontal wall
  const lp = rot2(dl.p.x, dl.p.y, -rot);             // dock line point, in frame-local coords
  let loA = Infinity, hiA = -Infinity;               // whole-footprint length extent (defines offset 0 = loA)
  const seg = [];
  el.points.forEach((pt) => {
    const q = rot2(pt.x, pt.y, -rot);
    const along = horiz ? q.x : q.y;
    if (along < loA) loA = along; if (along > hiA) hiA = along;
    const perp = horiz ? Math.abs(q.y - lp.y) : Math.abs(q.x - lp.x);
    if (perp <= tolFt) seg.push(along);
  });
  if (seg.length < 2) return null;
  const s0 = Math.min(...seg), s1 = Math.max(...seg);
  return { startF: s0 - loA, endF: s1 - loA, L: hiA - loA };
}

// Even-odd point-in-ring test (world feet). Local to keep the module framework-free.
export function pointInRing(pt, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Clip segment a→b (world feet) to the INTERIOR of polygon `ring`, returning the sub-segments that
// fall inside as [{a,b}, ...]. Column-grid lines are drawn across the frame bbox then clipped to the
// true (irregular) outline with this, so a line never spills past an angled wall. General enough for
// convex AND mildly-concave footprints (splits at every ring crossing, keeps the inside spans).
export function clipSegmentToRing(a, b, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const dx = b.x - a.x, dy = b.y - a.y;
  const ts = [0, 1];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const rx = q.x - p.x, ry = q.y - p.y;
    const den = dx * ry - dy * rx;
    if (Math.abs(den) < 1e-9) continue;              // parallel
    const t = ((p.x - a.x) * ry - (p.y - a.y) * rx) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const mid = (t0 + t1) / 2;
    const mp = { x: a.x + dx * mid, y: a.y + dy * mid };
    if (pointInRing(mp, ring)) out.push({ a: { x: a.x + dx * t0, y: a.y + dy * t0 }, b: { x: a.x + dx * t1, y: a.y + dy * t1 } });
  }
  return out;
}
