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

/* ── Gesture math (NEW-3, 2026-10-05) ───────────────────────────────────────────────────────────
 * What was wrong with the old release rule, measured with real touch drags on an iPhone-sized
 * page (ui-audit/verify-food-rating-and-sheet.mjs, red on main):
 *  · it only ever looked at WHERE the sheet was let go, never how fast — so a flick that did not
 *    cross the halfway point to the next stop snapped straight back ("jumps back unexpectedly");
 *  · any release below half the peek height closed the whole place — including with the keyboard
 *    up or a form open, which threw away what had been typed;
 *  · only the thin handle strip could move the sheet at all; a pull on the content or header just
 *    scrolled the list.
 * These pure functions are the decisions; BottomSheet.jsx only feeds them numbers. */

const STOP_NAMES = ["peek", "half", "full"];
/** px/ms — a release at least this fast is a flick, not a placement */
export const FLICK_VELOCITY = 0.35;
/** px — a flick must also have moved the sheet at least this far (a twitch is not a flick) */
export const FLICK_MIN_TRAVEL = 12;
const SAME_STOP_PX = 2;

/** The distinct stops, lowest first. Two snaps that render at the same height (short content makes
 *  peek == half == full) are ONE stop — the highest name wins, so a flick up is never "stuck" on
 *  a stop that looks identical to the one above it. */
export function stopList(stops) {
  const out = [];
  for (const name of STOP_NAMES) {
    const h = stops[name];
    const last = out[out.length - 1];
    if (last && Math.abs(last.h - h) < SAME_STOP_PX) { last.name = name; continue; }
    out.push({ name, h });
  }
  return out;
}

function nearestIndex(list, h) {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i].h - h) < Math.abs(list[best].h - h)) best = i;
  return best;
}

/** Finger speed at release in px/ms, UP positive, from the last ~100 ms of {t, y} samples. */
export function releaseVelocity(samples, windowMs = 100) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= windowMs; i--) first = samples[i];
  const dt = last.t - first.t;
  return dt > 0 ? (first.y - last.y) / dt : 0;
}

/** The lowest and highest height a drag may take. The top is the FULL stop (the content's own
 *  height, never the viewport) so the sheet cannot be pulled open onto empty space and then spring
 *  back; the bottom is the peek stop unless closing is allowed. */
export function dragBounds({ stops, canDismiss }) {
  return { min: canDismiss ? 0 : stops.peek, max: Math.max(stops.peek, stops.half, stops.full) };
}
export const clampDragHeight = (h, { min, max }) => Math.min(max, Math.max(min, h));

/** Where a released drag settles: "peek" | "half" | "full" | "dismiss".
 *  - slow release → the NEAREST stop;
 *  - flick → ONE stop from where the drag STARTED, in the flick's direction (unless the drag itself
 *    already carried past that stop);
 *  - closing (below the lowest stop) only when `canDismiss` — never with a form open or the keyboard up. */
export function resolveRelease({ heightPx, startHeight, velocity = 0, stops, canDismiss = true, dismissBelow }) {
  if (canDismiss && heightPx < (dismissBelow ?? stops.peek * 0.5)) return "dismiss";
  const list = stopList(stops);
  const near = nearestIndex(list, heightPx);
  if (Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(heightPx - startHeight) >= FLICK_MIN_TRAVEL) {
    const dir = velocity > 0 ? 1 : -1;
    const from = nearestIndex(list, startHeight);
    let idx = from + dir;
    if (idx < 0) return canDismiss ? "dismiss" : list[0].name;
    idx = Math.min(list.length - 1, idx);
    idx = dir > 0 ? Math.max(idx, near) : Math.min(idx, near);
    return list[idx].name;
  }
  return list[near].name;
}
