/*
 * programmaticScroll.js — lets app code mark a `scrollTop`/`scrollLeft` write as
 * DELIBERATE/APP-INITIATED, so a scroll-dismiss listener (ContextMenu's own, today; any future
 * one) can tell it apart from a real user scroll gesture WITHOUT guessing from magnitude or
 * timing (B1107632).
 *
 * THE PROBLEM THIS REPLACES. ContextMenu.jsx used to arm its scroll-dismiss listener one
 * requestAnimationFrame late, because opening the menu often selects the row/header/cell that
 * was right-clicked, and SheetView's own "keep the active cell fully on screen" layout effect
 * reacts to that selection change by writing `el.scrollTop`/`el.scrollLeft` — a real, deliberate
 * app scroll, not user input. Chrome does not dispatch the resulting native `scroll` event
 * synchronously with the write; it lands a frame or so later, which used to arrive after the
 * listener armed on mount and closed the menu within ~10-15ms of opening. The one-frame delay
 * was stress-tested (CPU throttled 1x-40x, sheets to 10,000 rows, 12 runs/config) and never
 * broke — but it is an IMPLICIT ordering that holds only because scroll dispatch and rAF
 * callbacks both happen to be sequenced by the same browser rendering-update step. That is a
 * timing coincidence, not a guarantee across engines or future effect-ordering changes.
 *
 * A per-write magnitude threshold ("ignore anything under a few px") was considered and
 * rejected: the "keep active cell visible" nudge is NOT bounded to a few px in general — it
 * scrolls exactly as far as the cut-off cell needs, which can be nearly a full row/column height.
 * There is no threshold that is simultaneously bigger than every real nudge and smaller than
 * every real user scroll. So the mark is keyed to WHO caused the scroll, not how far it moved.
 *
 * markProgrammaticScroll(el) — call it immediately before the write that will cause `el` to
 * scroll on its own. consumeProgrammaticScroll(el) — a listener calls it when a `scroll` event's
 * target is `el`; it returns true (and clears the mark) exactly once per mark, so a genuine
 * later scroll on the same element is never masked.
 *
 * A mark left unconsumed (the write happened to be a no-op — the cell was already at that exact
 * scroll position, so no `scroll` event ever follows) would otherwise sit forever on a
 * long-lived container and could wrongly excuse an unrelated later scroll. GRACE_MS bounds that:
 * it only has to outlast the browser's own deferred dispatch, measured at 11-55ms across 1x-40x
 * CPU throttling, so it stays a safety net for the no-op case, never the mechanism deciding the
 * normal case.
 */

const GRACE_MS = 1000;

const marks = new WeakMap(); // element -> timestamp (ms) the mark was set

export function markProgrammaticScroll(el, now = Date.now()) {
  if (!el) return;
  marks.set(el, now);
}

export function consumeProgrammaticScroll(el, now = Date.now()) {
  if (!el) return false;
  const markedAt = marks.get(el);
  if (markedAt === undefined) return false;
  marks.delete(el); // claimed at most once, whether or not it was still fresh
  return now - markedAt <= GRACE_MS;
}
