/* Shared markup HIT-TESTING (B423 / NEW-2; B155 routes Document Review's selection through it).
 *
 * Before this, three surfaces hit-tested markups three different inline ways (the Site
 * Planner's SVG-native per-element picking, Document Review's interior-grab `hitTest`, the
 * Stitcher's measure picking). This is the one shared implementation for the JS-picker
 * surfaces:
 *   • pickMarkup  — "what did the user click?" (selection): the best markup under a point.
 *                   Nearest wins; among interior grabs the SMALLEST shape wins (B374, so a
 *                   small markup on/inside a big unfilled one stays grabbable); an exact tie
 *                   goes to the top-most (last-drawn). This is Document Review's reference feel.
 *   • hitEditPath — "where on the SELECTED markup?" (editing): a vertex to drag (9 px) or an
 *                   edge to insert a vertex on (11 px) — the Bluebeam rule.
 *
 * Tolerances are in SCREEN PIXELS and converted to world units via the viewport `scale`
 * (so a grip is equally easy to grab at any zoom). Pure: geometry + model only.
 *
 * (The Site Planner keeps its own SVG-native picking — `pointerEvents:"all"` interiors + a fat
 * transparent hit-stroke on lines — which already delivers these same rules declaratively via
 * the browser's hit-testing + DOM paint order, so it is deliberately NOT re-routed through this
 * imperative picker; see B155 in BACKLOG-DONE.)
 */
import { dist, projToSeg, pointInPoly, bboxOf } from "./geometry.js";
import { ptsOf, isClosed } from "./markupModel.js";
import { readProp } from "./propertySchema.js";

const VTX_TOL_PX = 9;    // grab radius for an existing vertex
const EDGE_TOL_PX = 11;  // grab radius for an edge (to insert a vertex)
const PICK_TOL_PX = 6;   // outline proximity for selection
const MARKER_TOL_PX = 10; // a count marker / text anchor is a forgiving target

const tolWorld = (px, view) => px / ((view && view.scale) || 1);
const bboxArea = (pts) => { const b = bboxOf(pts); return b.w * b.h; };

/* How world point `p` relates to markup `m`: returns { d, interior } — `d` is the distance (in
 * world units) to the markup's selectable geometry, `0` for an interior grab — or `null` if the
 * point is beyond `tol` (outline / markers) . Closed rings hit on their filled interior OR their
 * outline; open shapes hit on their outline; point markups (count) hit near their anchors.
 *
 * `scale` (screen px per world unit) sizes the text/callout boxes, which are drawn at a fixed
 * SCREEN size; pass it for WYSIWYG box selection. With `scale` omitted/0 the text & callout kinds
 * fall back to their anchor point + `markerTol` (a geometry-only test, e.g. from `hitMarkup`).
 *
 * Mirrors Document Review's reference `hitTest` (B33/B374) so routing that surface onto this
 * picker is behaviour-preserving. */
export function scoreMarkup(m, p, tol, markerTol, scale = 0) {
  const pts = ptsOf(m);
  if (!pts.length) return null;
  const kind = m.kind;

  if (kind === "count") {
    let d = Infinity;
    for (const q of pts) d = Math.min(d, dist(p, q));
    return d <= markerTol ? { d, interior: false } : null;
  }

  if (kind === "text") {
    const q = pts[0];
    if (scale) {
      // the rendered text box (offsets mirror the render; screen px → world via /scale) (B33)
      const w = ((m.text || "").length * 6.5 + 6) / scale, h = 16 / scale;
      const x0 = q.x - 2 / scale, y0 = q.y - 12 / scale;
      return (p.x >= x0 && p.x <= x0 + w && p.y >= y0 && p.y <= y0 + h) ? { d: 0, interior: true } : null;
    }
    const d = dist(p, q);
    return d <= markerTol ? { d, interior: false } : null;
  }

  if (kind === "callout") {
    const tip = pts[0], box = pts[1];
    const anchor = box || tip;
    if (scale) {
      const fs = (readProp(m, "fontSize") || 14) / scale;
      const textW = Math.max(60 / scale, (m.text || "").length * fs * 0.58 + 8 / scale);
      const textH = fs + 8 / scale;
      if (p.x >= anchor.x && p.x <= anchor.x + textW && p.y >= anchor.y && p.y <= anchor.y + textH) return { d: 0, interior: true };
    }
    if (box) {
      const d = Math.min(dist(p, tip), dist(p, box), projToSeg(p, tip, box).d);
      return d <= tol ? { d, interior: false } : null;
    }
    const d = dist(p, tip);
    return d <= markerTol ? { d, interior: false } : null;
  }

  // B521: a closed box (rect/ellipse/cloud/snapshot) is commonly stored as two OPPOSITE corners
  // (the Document Review form). Expand it to its real geometry: a tol-expanded axis-aligned box
  // interior (ellipse via its own equation) — the whole rendered body is grabbable, not just the
  // diagonal between the two corners.
  if (isClosed(kind) && pts.length === 2) {
    const x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
    const y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
    if (kind === "ellipse") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2 + tol, ry = (y1 - y0) / 2 + tol;
      if (rx > 0 && ry > 0 && ((p.x - cx) * (p.x - cx)) / (rx * rx) + ((p.y - cy) * (p.y - cy)) / (ry * ry) <= 1) return { d: 0, interior: true };
      return null;
    }
    return (p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol) ? { d: 0, interior: true } : null;
  }

  // Closed ring (≥3 pts): filled interior is grabbable; else nearest vertex/edge (incl. the
  // closing edge). Open shapes: nearest vertex/segment only.
  const closed = isClosed(kind) && pts.length >= 3;
  if (closed && pointInPoly(p, pts)) return { d: 0, interior: true };
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    d = Math.min(d, dist(p, pts[i]));
    if (i > 0) d = Math.min(d, projToSeg(p, pts[i - 1], pts[i]).d);
  }
  if (closed && pts.length > 2) d = Math.min(d, projToSeg(p, pts[pts.length - 1], pts[0]).d);
  return d <= tol ? { d, interior: false } : null;
}

/* True if world point `p` lands on markup `m` within `tol` world units (geometry-only — text /
 * callout fall back to their anchor + `markerTol`). The boolean primitive behind `pickMarkup`. */
export function hitMarkup(m, p, tol, markerTol = tol) {
  return scoreMarkup(m, p, tol, markerTol, 0) != null;
}

/* The best markup index under a click (or -1). Nearest distance wins; among interior grabs the
 * SMALLEST bounding-box area wins (B374 — a small shape stays grabbable over a big unfilled one);
 * an exact (distance + area) tie goes to the later-drawn (top-most) markup. `opts.filter` skips
 * markups (e.g. locked ones); `opts.tolPx` / `opts.markerTolPx` override the pixel tolerances. */
export function pickMarkupIndex(markups, p, view, opts = {}) {
  const tol = tolWorld(opts.tolPx ?? PICK_TOL_PX, view);
  const markerTol = tolWorld(opts.markerTolPx ?? MARKER_TOL_PX, view);
  const scale = (view && view.scale) || 0;
  const filter = opts.filter || (() => true);
  let bi = -1, bd = Infinity, ba = Infinity;
  for (let i = 0; i < markups.length; i++) {
    const m = markups[i];
    if (!m || !filter(m)) continue;
    const s = scoreMarkup(m, p, tol, markerTol, scale);
    if (!s) continue;
    const area = s.interior ? bboxArea(ptsOf(m)) : Infinity;
    const better =
      s.d < bd - 1e-6 ||                                          // strictly nearer
      (Math.abs(s.d - bd) <= 1e-6 && area < ba - 1e-6) ||          // tie on distance → smaller area
      (Math.abs(s.d - bd) <= 1e-6 && Math.abs(area - ba) <= 1e-6); // exact tie → later (top-most)
    if (better) { bd = s.d; ba = area; bi = i; }
  }
  return bi;
}

/* The best markup under a click (or null) — the object. See `pickMarkupIndex` for the rules. */
export function pickMarkup(markups, p, view, opts = {}) {
  const i = pickMarkupIndex(markups, p, view, opts);
  return i >= 0 ? markups[i] : null;
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
