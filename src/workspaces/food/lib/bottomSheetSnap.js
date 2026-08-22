/* bottomSheetSnap — the pure decision at the end of a drag: given the sheet's current dragged
 * height and the three candidate snap heights, which snap does it settle to (or does it
 * dismiss)? Extracted from BottomSheet.jsx so the actual gesture MATH is unit-testable without a
 * DOM/pointer-event harness — the component wires this to real pointer coordinates, this file
 * only ever sees numbers.
 */

/** heightPx below this settles to "dismiss" instead of the nearest snap — always evaluated
 *  BEFORE distance-matching, so a hard downward flip past the threshold can never "round up" to
 *  peek just because peek happens to be the closest candidate. */
export function resolveSnap({ heightPx, peekHeight, halfHeight, fullHeight, dismissBelow }) {
  if (heightPx < dismissBelow) return "dismiss";
  const candidates = [
    { snap: "peek", h: peekHeight },
    { snap: "half", h: halfHeight },
    { snap: "full", h: fullHeight },
  ];
  let best = candidates[0];
  let bestDist = Math.abs(heightPx - best.h);
  for (let i = 1; i < candidates.length; i++) {
    const dist = Math.abs(heightPx - candidates[i].h);
    if (dist < bestDist) { best = candidates[i]; bestDist = dist; }
  }
  return best.snap;
}

/** The numeric height (px) a given snap name renders at, for a content block whose natural
 *  height is `contentHeight` — content-driven and capped, never fixed regardless of content (NEW-2:
 *  "The sheet's height at the peek and half snaps is driven by its content. No empty white below
 *  the content, ever"). `full`'s cap leaves `topInset` px of the viewport visible above the sheet
 *  so the map is never fully hidden. */
export function heightForSnap(snap, { contentHeight, peekHeight, viewportHeight, topInset }) {
  if (snap === "peek") return Math.min(peekHeight, contentHeight);
  const cap = snap === "half" ? viewportHeight * 0.6 : Math.max(0, viewportHeight - topInset);
  return Math.min(contentHeight, cap);
}
