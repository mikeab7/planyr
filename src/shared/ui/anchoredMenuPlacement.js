/*
 * anchoredMenuPlacement.js — the pure viewport-placement math for AnchoredMenu (B734).
 *
 * Lifted out of AnchoredMenu.jsx so it can be unit-tested and so the "don't pin a
 * mis-anchored menu to the top-left corner" guard lives in one tested place. Mirrors the
 * floatingPanel.js pattern (pure math next to its React component).
 *
 * placeMenu computes the fixed-position (left, top) for a portal menu given the trigger's
 * on-screen rect and the menu's measured size, then clamps the whole menu into the viewport.
 *
 * Returns `null` — meaning "don't place it, keep it hidden" — when the anchor is missing or
 * zero-sized. A zero-sized rect is what getBoundingClientRect() returns for a `display:none`
 * element; before this guard, feeding those zeros into the math clamped the menu to (margin,
 * margin) = the top-left corner (the B734 bug, where the account pill was mounted into several
 * kept-alive-but-hidden headers at once). Hiding beats mis-placing.
 */

/**
 * @param {Object} p
 * @param {{left:number,right:number,top:number,bottom:number,width:number,height:number}} p.anchorRect
 *        the trigger's getBoundingClientRect()
 * @param {number} p.menuW   measured menu width (px)
 * @param {number} p.menuH   measured menu height (px)
 * @param {number} p.viewportW  window.innerWidth
 * @param {number} p.viewportH  window.innerHeight
 * @param {"left"|"below-left"|"below-right"} [p.placement="left"]
 * @param {number} [p.gap=10]     gap between anchor and menu
 * @param {number} [p.margin=8]   min gap kept from every viewport edge
 * @returns {{left:number,top:number}|null}
 */
export function placeMenu({
  anchorRect: a,
  menuW,
  menuH,
  viewportW,
  viewportH,
  placement = "left",
  gap = 10,
  margin: M = 8,
}) {
  // No anchor, or an anchor with no box (display:none → all-zero rect): don't place it.
  if (!a || (a.width === 0 && a.height === 0)) return null;

  let left, top;
  if (placement === "below-left") { left = a.left; top = a.bottom + gap; }
  else if (placement === "below-right") { left = a.right - menuW; top = a.bottom + gap; }
  else { left = a.left - gap - menuW; top = a.top; } // "left" — flyout to the left of the rail

  // Keep the whole menu on-screen.
  left = Math.max(M, Math.min(left, viewportW - menuW - M));
  top = Math.max(M, Math.min(top, viewportH - menuH - M));
  return { left, top };
}
