/* scrollStrip.js — the ONE paging + edge-state model for every sideways-scrolling strip that has
 * prev/next chevrons (NAV-ARROWS, owner report 2026-10-03: on an iPhone the module tab strip's LEFT
 * arrow "took him too far over").
 *
 * Why a shared helper rather than a fix in AppHeader: a relative `scrollBy({left: ±0.72·width,
 * behavior:"smooth"})` is computed from wherever the strip happens to be AT TAP TIME. Two taps
 * inside one smooth animation (or a tap during a finger fling / iOS rubber-band) therefore stack
 * their deltas and land somewhere the user never asked for, and nothing re-aimed the result at an
 * edge. Here every page is an ABSOLUTE target, clamped to [0, max], chained from the previous
 * still-in-flight target, and snapped flush to an edge when the remainder is less than a tab.
 * Pure math is separated (unit-tested) from the DOM wiring. */

/** How much of the visible width one tap moves: a screenful minus a tab, so the last tab you
 *  could see stays on screen as a continuity anchor. */
export const TAB_ALLOWANCE = 72;
/** Edge detection tolerance (sub-pixel scroll positions on fractional DPR). */
export const EDGE_EPS = 1;

/** Absolute, clamped scroll target for one page in `dir` (-1 / +1). Snaps flush to the edge when
 *  what would remain past the target is under half a page — never leaves a sliver behind, never
 *  overshoots. */
export function pageTarget({ scrollLeft, clientWidth, scrollWidth, dir }) {
  const max = Math.max(0, scrollWidth - clientWidth);
  const step = Math.max(clientWidth * 0.5, clientWidth - TAB_ALLOWANCE);
  let t = scrollLeft + dir * step;
  t = Math.min(max, Math.max(0, t));
  const remaining = dir > 0 ? max - t : t;
  if (remaining < step * 0.5) t = dir > 0 ? max : 0;
  return Math.round(t);
}

/** Which chevrons should show. Strict at both ends: hidden exactly when flush. */
export function edgeState({ scrollLeft, clientWidth, scrollWidth }) {
  const max = Math.max(0, scrollWidth - clientWidth);
  const x = Math.min(max, Math.max(0, scrollLeft)); // iOS rubber-band reports < 0 / > max
  return { left: x > EDGE_EPS, right: x < max - EDGE_EPS };
}

const pending = new WeakMap(); // el -> { target, until }

/** Page a strip one step. Chains from an in-flight smooth scroll's target so rapid taps add up
 *  to whole pages instead of compounding from a mid-animation position. */
export function pageStrip(el, dir) {
  if (!el) return;
  const p = pending.get(el);
  const from = p && p.until > Date.now() ? p.target : el.scrollLeft;
  const target = pageTarget({ scrollLeft: from, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, dir });
  pending.set(el, { target, until: Date.now() + 600 });
  el.scrollTo({ left: target, behavior: "smooth" });
}

/** Subscribe to everything that can change a strip's edge state; `onChange` is called with a fresh
 *  read. Covers: scroll (incl. mid-animation), `scrollend`, a settle re-read after the last scroll
 *  event (Safari <17 has no `scrollend`, and smooth scrolls there fire sparse events), resize of
 *  the strip and any `watch` element, and the strip's child set changing (tab set changes).
 *  Returns a disposer. */
export function observeStripEdges(el, onChange, watch = []) {
  const read = () => onChange(edgeState(el));
  let settle = 0;
  const onScroll = () => { read(); clearTimeout(settle); settle = setTimeout(read, 140); };
  read();
  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("scrollend", read);
  let ro, mo;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(read);
    ro.observe(el);
    watch.forEach((w) => w && ro.observe(w));
    Array.from(el.children).forEach((c) => ro.observe(c));
  }
  if (typeof MutationObserver === "function") {
    mo = new MutationObserver(() => {
      if (ro) { ro.disconnect(); ro.observe(el); watch.forEach((w) => w && ro.observe(w)); Array.from(el.children).forEach((c) => ro.observe(c)); }
      read();
    });
    mo.observe(el, { childList: true, subtree: true });
  }
  return () => {
    clearTimeout(settle);
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("scrollend", read);
    ro?.disconnect(); mo?.disconnect();
  };
}
