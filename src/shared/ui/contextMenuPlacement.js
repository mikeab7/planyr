/*
 * contextMenuPlacement.js — the pure viewport-placement math for the shared ContextMenu (B915).
 *
 * A CURSOR-anchored menu is a different problem from AnchoredMenu's TRIGGER-anchored flyout
 * (anchoredMenuPlacement.js). A context menu opens at the raw pointer coordinates of a
 * right-click, so its own height/width has to be measured against the viewport and the menu
 * FLIPPED (up / left) when it would run off an edge — not merely clamped. Every hand-rolled
 * context menu in the app used a hardcoded, ASSUMED height (e.g. `top: min(y, innerHeight-288)`);
 * when the real menu was taller than the guess, its bottom items (Delete) ran off the bottom
 * edge and were unreachable. This is the one tested place that math lives now.
 *
 * placeContextMenu takes the cursor point and the menu's MEASURED size and returns the
 * fixed-position (left, top) plus a maxHeight, doing, in order:
 *   1. anchor the menu's top-left at the cursor (+ a small gap);
 *   2. flip LEFT (open to the left of the cursor) if it would overflow the right edge;
 *   3. flip UP   (open above the cursor)        if it would overflow the bottom edge;
 *   4. a final hard-clamp to `margin` on all four edges (covers corner clicks where both flips
 *      fire, browser zoom, and a menu larger than the viewport);
 *   5. a maxHeight of (viewport height − 2·margin) so an over-tall menu scrolls instead of
 *      spilling past the edges.
 * Pure + framework-free so it unit-tests without a DOM.
 */

/**
 * @param {Object} p
 * @param {number} p.cursorX     event.clientX of the right-click
 * @param {number} p.cursorY     event.clientY of the right-click
 * @param {number} p.menuW       measured menu width (px)
 * @param {number} p.menuH       measured menu height (px)
 * @param {number} p.viewportW   window.innerWidth
 * @param {number} p.viewportH   window.innerHeight
 * @param {number} [p.margin=8]  min gap kept from every viewport edge
 * @param {number} [p.gap=2]     gap between the cursor and the menu's anchored corner
 * @returns {{left:number, top:number, maxHeight:number}}
 */
export function placeContextMenu({
  cursorX,
  cursorY,
  menuW,
  menuH,
  viewportW,
  viewportH,
  margin: M = 8,
  gap = 2,
}) {
  // 1. default: top-left corner of the menu sits just past the cursor.
  let left = cursorX + gap;
  let top = cursorY + gap;

  // 2. flip LEFT when the default would overflow the right edge — open to the left of the cursor.
  if (left + menuW > viewportW - M) left = cursorX - gap - menuW;

  // 3. flip UP when the default would overflow the bottom edge — open above the cursor.
  if (top + menuH > viewportH - M) top = cursorY - gap - menuH;

  // 4. final hard-clamp to the margins on all four edges (corner clicks fire both flips; a menu
  //    wider/taller than the viewport still lands its top-left inside the margin box).
  left = Math.max(M, Math.min(left, viewportW - menuW - M));
  top = Math.max(M, Math.min(top, viewportH - menuH - M));

  // 5. never let the menu itself exceed the viewport height — the component scrolls the overflow.
  const maxHeight = Math.max(0, viewportH - 2 * M);

  return { left, top, maxHeight };
}
