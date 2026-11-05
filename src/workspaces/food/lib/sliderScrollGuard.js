/* sliderScrollGuard — a finger that lands on a rating slider and then SWIPES VERTICALLY is scrolling the card, not rating the dish.
 *
 * THE DEFECT (V1476080 step 3, "put a finger on the rating and scroll the sheet — the rating must not change"; measured 2026-10-08 on the
 * fixture and on planyr.io in Chromium's real touch pipeline, iPhone 15 descriptor): a vertical swipe that STARTS on the slider moved the
 * thumb to where the finger first touched (mid-track 7.75 → 5.5, left end → 1.75) while the card scrolled under it. `touch-action: pan-y`
 * alone did not prevent it. Whether iOS Safari does the same cannot be raised here (WebKit has no touch-drag primitive in Playwright —
 * docs/PHONE-TESTING.md), so the guard is engine-independent and harmless where the browser already behaves.
 *
 * THE RULE: remember the value at touch-start; the moment the movement is vertical-dominant beyond a small slop, put that value back — and
 * put it back again when the touch ends/cancels, in case the browser applied its jump after we looked. A tap, and any horizontal-dominant drag,
 * are untouched (the slider works exactly as before). Owner constraint #16 (one half-step slider, never tap buttons) is not touched.
 */
import { useRef } from "react";

export const SCROLL_SLOP_PX = 8;

/** Is this finger movement (from where it landed) a vertical scroll rather than a slider drag? */
export function isVerticalScroll(dx, dy, slop = SCROLL_SLOP_PX) {
  return Math.abs(dy) > slop && Math.abs(dy) > Math.abs(dx);
}

/** Touch handlers to spread on the `<input type="range">`. `value` is the CURRENT value (null = not rated); `onChange` takes a value or null. */
export function useScrollSafeSlider(value, onChange) {
  const g = useRef(null);
  const settle = () => { const s = g.current; if (s && s.reverted) onChange(s.before); g.current = null; };
  return {
    onTouchStart: (e) => {
      const t = e.touches && e.touches[0];
      g.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, before: value, reverted: false } : null;
    },
    onTouchMove: (e) => {
      const s = g.current, t = e.touches && e.touches[0];
      if (!s || !t || s.reverted) return;
      if (isVerticalScroll(t.clientX - s.x, t.clientY - s.y)) { s.reverted = true; onChange(s.before); }
    },
    onTouchEnd: settle,
    onTouchCancel: settle,
  };
}
