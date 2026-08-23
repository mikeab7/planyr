/* zoomAnimTier — the pure two-tier perf-degrade DECISION for continuous marker scaling during a
 * Leaflet zoom animation (NEW-2, 2nd owner block, 2026-08-23: "resize stuff as it's going...
 * assuming that doesn't bog stuff down too much"). Extracted from FoodMap.jsx so the state
 * machine is unit-testable without a browser: the component feeds it real per-frame timings, this
 * file only ever sees numbers.
 *
 * A LIVE CPU-throttled proof alone can't fully exercise this: Leaflet's own zoom-animation window
 * is a fixed ~250ms regardless of device speed, so a heavily throttled device may render only a
 * handful of frames in that whole window — too few for one live gesture to reliably hit BOTH tier
 * transitions even though the mechanism is correct (measured live,
 * `.scratch-repro/verify-zoom-scaling-degrade.mjs`: 6x CPU throttle, 2000 markers actually in the
 * layer group — the map must be zoomed past MIN_PIN_ZOOM first, or these reference-snapshot
 * markers are never even added; individual frames reached 17-25ms, confirming real pressure, but
 * only ~1.75 frames land per 250ms gesture at that throttle — too few for a 3-frame streak to
 * complete in one gesture). This function is what actually has to be right; drive it directly
 * with ZOOM_ANIM_DEGRADE_STREAK consecutive over-budget frames and assert each transition.
 */

// ~8ms leaves headroom in a 16.7ms (60fps) frame for Leaflet's own work and browser compositing.
export const ZOOM_ANIM_FRAME_BUDGET_MS = 8;
// Three consecutive over-budget frames (not one, which could just be a one-off GC pause) before
// dropping a tier.
export const ZOOM_ANIM_DEGRADE_STREAK = 3;

/** Given the current { tier, overBudgetStreak } and how long the frame that JUST ran took, returns
 *  the next state. Three tiers: "full" (every frame, every marker) -> "everyOther" (redraw every
 *  other frame) -> "bailed" (stop compensating for the rest of THIS gesture; the caller restores
 *  every marker's true radius immediately and falls back to Leaflet's own transform-then-settle
 *  look). Never recovers mid-gesture — a fresh gesture always starts back at "full" (the caller
 *  resets state on the next 'zoomanim'), because conditions genuinely change between gestures
 *  (e.g. fewer markers once zoomed in past MIN_PIN_ZOOM). */
export function nextZoomAnimTier(state, elapsedMs) {
  if (state.tier === "bailed") return state;
  if (elapsedMs <= ZOOM_ANIM_FRAME_BUDGET_MS) {
    return { ...state, overBudgetStreak: 0 };
  }
  const streak = state.overBudgetStreak + 1;
  if (state.tier === "full" && streak >= ZOOM_ANIM_DEGRADE_STREAK) {
    return { ...state, tier: "everyOther", overBudgetStreak: 0, frameParity: 0 };
  }
  if (state.tier === "everyOther" && streak >= ZOOM_ANIM_DEGRADE_STREAK) {
    return { ...state, tier: "bailed", overBudgetStreak: 0 };
  }
  return { ...state, overBudgetStreak: streak };
}
