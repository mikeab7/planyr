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

/* ⛔ VIEW-INDEPENDENT-ONCE (NEW-2, 2026-08-06) — WHY THE RECT IS LATCHED, NOT RE-DERIVED.
 *
 * `visibleWorldRect` is a CONTINUOUS function of `view`, so during a pan it returns four different
 * numbers on every frame, `cullToView` re-filters the whole model, and the result — on any pan
 * that stays inside the 60% margin — is THE SAME SET OF ELEMENTS in a brand-new array. Measured by
 * ui-audit/detect-view-recompute.mjs on a 60-move pan of the reference plan: `drawEls`,
 * `drawParcels` and `drawMarkupsZ` each ran 60 times and produced exactly ONE distinct result, and
 * because the array identity changed each time, every memo downstream of them missed too. That is
 * the `view-churned` verdict: the inputs moved, the answer did not.
 *
 * THE FIX IS HYSTERESIS, and the first attempt at it is worth recording because it was measured
 * and was not good enough. Snapping each edge outward to a lattice took the recompute count from
 * 60 to 19 — a step function still steps, and a gesture that oscillates re-crosses the same
 * boundary again and again. What actually holds is a LATCH: keep the rect you already have for as
 * long as the true viewport is still comfortably inside it, and only then build a new one.
 *
 *   • The rect handed out is padded by `CULL_MARGIN` (0.6 of the viewport on every side).
 *   • It is kept while the TRUE viewport (no margin) is inside it with `CULL_REARM` of the
 *     viewport still to spare on every side — so there is always at least that much drawn
 *     content beyond the screen edge, and nothing can pop in.
 *   • A change of px-per-foot always re-arms: at a new zoom the viewport covers a different
 *     amount of world, and a rect sized for the old one is the wrong budget.
 *
 * ⛔ WHAT MAKES THIS SAFE IS THE CONTAINMENT TEST, not the margin: the latch is only held when the
 * true visible rect is PROVEN inside the rect being kept, so the rect handed to `cullToView` is
 * always a superset of what is on screen. Culling with a superset draws more than strictly
 * necessary and can never drop something that should be visible. The export path passes no rect at
 * all, so `test/viewCull.test.js`'s "an export is independent of the viewport" is untouched.
 *
 * PURE: the previous rect is an ARGUMENT, never module state, so this is unit-testable and two
 * canvases cannot share a latch (test/pureCache.test.js).
 */
export const CULL_REARM = 0.25;

/** Keep `prev` if it still covers the view with room to spare; otherwise build a fresh padded
 *  rect. Returning `prev` BY IDENTITY is half the fix — a new object holding the same numbers
 *  would still invalidate every memo keyed on the rect. */
export function cullRectFor(view, size, prev = null, margin = CULL_MARGIN, rearm = CULL_REARM) {
  const ppf = Number(view?.ppf);
  if (prev && prev.ppf === ppf) {
    const now = visibleWorldRect(view, size, 0);
    const padX = Math.abs(now.maxX - now.minX) * rearm;
    const padY = Math.abs(now.maxY - now.minY) * rearm;
    if (now.minX - padX >= prev.minX && now.minY - padY >= prev.minY
      && now.maxX + padX <= prev.maxX && now.maxY + padY <= prev.maxY) return prev;
  }
  const r = visibleWorldRect(view, size, margin);
  return { minX: r.minX, minY: r.minY, maxX: r.maxX, maxY: r.maxY, ppf };
}

/** Do two cull rects describe the same window? The latch above returns `prev` by identity, so this
 *  is only needed by callers comparing two independently built rects (and by the tests). */
export function sameRect(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
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
