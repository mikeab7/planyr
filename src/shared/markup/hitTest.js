/* Shared markup HIT-TESTING (B423 / NEW-2; completes the B155 shared tranche).
 *
 * Before this, three surfaces hit-tested markups three different inline ways (the Site
 * Planner's vertex/edge grips, Document Review's interior-grab, the Stitcher's measure
 * picking). This is the one shared implementation:
 *   • pickMarkup  — "what did the user click?" (selection): the TOP-MOST markup under a
 *                   point, tested by handle → edge → filled interior.
 *   • hitEditPath — "where on the SELECTED markup?" (editing): a vertex to drag (9 px) or
 *                   an edge to insert a vertex on (11 px) — the Bluebeam rule lifted from
 *                   SitePlanner.jsx:2462.
 *
 * Tolerances are in SCREEN PIXELS and converted to world units via the viewport `scale`
 * (so a grip is equally easy to grab at any zoom). Pure: geometry + model only.
 */
import { dist, projToSeg, pointInPoly } from "./geometry.js";
import { ptsOf, isClosed } from "./markupModel.js";

const VTX_TOL_PX = 9;    // grab radius for an existing vertex
const EDGE_TOL_PX = 11;  // grab radius for an edge (to insert a vertex)
const PICK_TOL_PX = 6;   // outline proximity for selection
const MARKER_TOL_PX = 10; // a count marker / text anchor is a forgiving target

const tolWorld = (px, view) => px / ((view && view.scale) || 1);

/* True if world point `p` lands on markup `m` within `tol` world units. Closed rings hit on
 * their filled interior OR their outline; open shapes hit on their outline; point markups
 * (text/callout/count) hit near their anchor(s). */
export function hitMarkup(m, p, tol, markerTol = tol) {
  const pts = ptsOf(m);
  if (!pts.length) return false;
  const kind = m.kind;
  if (kind === "count") return pts.some((q) => dist(p, q) <= markerTol);
  if (pts.length === 1) return dist(p, pts[0]) <= markerTol;       // text / callout anchor
  const closed = isClosed(kind) && pts.length >= 3;
  if (closed && pointInPoly(p, pts)) return true;                  // interior of a filled ring
  for (let i = 1; i < pts.length; i++) if (projToSeg(p, pts[i - 1], pts[i]).d <= tol) return true;
  if (closed && projToSeg(p, pts[pts.length - 1], pts[0]).d <= tol) return true;
  return false;
}

/* The top-most markup under a click (or null). Walks LAST→first so the most-recently-drawn
 * markup (painted on top) wins an overlap. `opts.filter` skips markups (e.g. locked ones).
 * Returns the markup object; use `pickMarkupIndex` if you need its position. */
export function pickMarkup(markups, p, view, opts = {}) {
  const tol = tolWorld(opts.tolPx ?? PICK_TOL_PX, view);
  const markerTol = tolWorld(opts.markerTolPx ?? MARKER_TOL_PX, view);
  const filter = opts.filter || (() => true);
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i];
    if (!m || !filter(m)) continue;
    if (hitMarkup(m, p, tol, markerTol)) return m;
  }
  return null;
}

/** Like pickMarkup but returns the array index (or -1). */
export function pickMarkupIndex(markups, p, view, opts = {}) {
  const tol = tolWorld(opts.tolPx ?? PICK_TOL_PX, view);
  const markerTol = tolWorld(opts.markerTolPx ?? MARKER_TOL_PX, view);
  const filter = opts.filter || (() => true);
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i];
    if (!m || !filter(m)) continue;
    if (hitMarkup(m, p, tol, markerTol)) return i;
  }
  return -1;
}

/* For an already-SELECTED vertex markup, what did the user grab?
 *   { type: "vertex", index, point }  — drag this existing vertex
 *   { type: "edge",   index, point }  — insert a new vertex here (index = segment start)
 *   null                              — nothing within tolerance
 * Vertices take priority over edges (the Bluebeam feel: a dot beats the line it's on). */
export function hitEditPath(m, p, view, opts = {}) {
  const pts = ptsOf(m);
  if (pts.length < 2) return null;
  const vtol = tolWorld(opts.vtxTolPx ?? VTX_TOL_PX, view);
  const etol = tolWorld(opts.edgeTolPx ?? EDGE_TOL_PX, view);
  for (let i = 0; i < pts.length; i++) {
    if (dist(p, pts[i]) <= vtol) return { type: "vertex", index: i, point: { x: pts[i].x, y: pts[i].y } };
  }
  const closed = isClosed(m.kind) && pts.length >= 3;
  const n = closed ? pts.length : pts.length - 1;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const pr = projToSeg(p, a, b);
    if (pr.d <= etol && (!best || pr.d < best.d)) best = { type: "edge", index: i, point: { x: pr.x, y: pr.y }, d: pr.d };
  }
  return best ? { type: best.type, index: best.index, point: best.point } : null;
}
