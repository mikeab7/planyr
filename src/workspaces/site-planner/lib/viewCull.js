/* viewCull — draw only what is on screen (NEW-5).
 *
 * WHY (measured 2026-07-28). The feet-frame SVG holds ~4,600 elements on the reference
 * scenario and stays FLAT across every phase — it is not where the tab's memory goes (that
 * is the tiles). But it is where the frame time goes: during a scripted drag the median
 * frame was 20 ms with p90 80 ms and p99 140 ms, against a 16.7 ms budget — one frame in
 * ten costing five times its budget is exactly the "lagging" the owner feels. The cost
 * scaled with the size of the whole model rather than with what is actually visible, so a
 * plan the size of Concept C pays for every element on every pan frame even when most of
 * them are far off screen.
 *
 * THE RULE THAT MAKES THIS SAFE: culling is SCREEN-ONLY. The export/print path
 * (`buildExportSvg`, the PDF and aerial pipelines) must render the complete model whatever
 * the current view is — a drawing that prints only the part you happened to be looking at
 * would be far worse than a slow pan. So the cull rect is grown generously and the whole
 * mechanism is switched off for an export pass; `test/viewCull.test.js` asserts the export
 * element count is independent of the viewport.
 *
 * Pure geometry, no React and no DOM.
 */
import { screenToWorld } from "../../../shared/viewport/viewportTransform.js";

/* How much beyond the viewport still renders, as a fraction of the viewport's size. A
 * generous margin means nothing pops in at the edge during a normal drag, and labels that
 * hang outside their element's own bounds are still drawn. */
export const CULL_MARGIN = 0.6;

/* The world (feet) rectangle currently on screen, grown by `margin`. `view` is the planner's
 * {ppf, offX, offY}; `size` the canvas {w, h}. */
export function visibleWorldRect(view, size, margin = CULL_MARGIN) {
  const v = { scale: view.ppf, tx: view.offX, ty: view.offY };
  const a = screenToWorld(v, { x: 0, y: 0 });
  const b = screenToWorld(v, { x: size.w, y: size.h });
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const mx = (maxX - minX) * margin, my = (maxY - minY) * margin;
  return { minX: minX - mx, minY: minY - my, maxX: maxX + mx, maxY: maxY + my };
}

/* Axis-aligned bounds of anything the planner draws, in feet. Understands the three shapes
 * the model actually uses: a point list (`points` / `pts`), a rotated box (`cx/cy/w/h`), and
 * a bare anchor (`cx/cy`). Returns null when the element carries no usable geometry — and a
 * null bound is ALWAYS drawn, so an unrecognised shape can never be culled by accident. */
export function elementBounds(el) {
  if (!el) return null;
  const pts = Array.isArray(el.points) ? el.points : Array.isArray(el.pts) ? el.pts : null;
  if (pts && pts.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null; // unknown shape → never cull
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  if (Number.isFinite(el.cx) && Number.isFinite(el.cy)) {
    // A rotated box's circumscribed radius — half its diagonal — bounds it at any rotation,
    // so we never have to trust a stale `rot`.
    const w = Number.isFinite(el.w) ? el.w : 0;
    const h = Number.isFinite(el.h) ? el.h : 0;
    const r = Math.hypot(w, h) / 2;
    return { minX: el.cx - r, minY: el.cy - r, maxX: el.cx + r, maxY: el.cy + r };
  }
  return null;
}

export const boundsIntersect = (b, rect) =>
  !b || (b.minX <= rect.maxX && b.maxX >= rect.minX && b.minY <= rect.maxY && b.maxY >= rect.minY);

/* Filter a collection to what the view can see. `enabled: false` returns the input array
 * UNCHANGED (identity, not a copy) — that is the export path, and it is also what keeps a
 * small plan free of any culling work at all. `keep` force-includes ids that must render
 * whatever their bounds say (the selection, the element being dragged). */
export function cullToView(list, rect, { enabled = true, keep = null } = {}) {
  if (!enabled || !rect || !Array.isArray(list)) return list;
  return list.filter((el) => {
    if (!el) return true;
    if (keep && el.id != null && keep.has(el.id)) return true;
    return boundsIntersect(elementBounds(el), rect);
  });
}

/* Below this many drawable items, culling costs more than it saves — every element is on
 * screen anyway and the filter is pure overhead. */
export const CULL_MIN_ELEMENTS = 40;

export const shouldCull = (count, { exporting = false } = {}) =>
  !exporting && Number(count) >= CULL_MIN_ELEMENTS;
