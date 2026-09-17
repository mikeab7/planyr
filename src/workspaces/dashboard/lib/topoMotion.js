/* topoMotion — the pure numbers behind the dashboard topo background's cursor interaction
 * (NEW-2, 2026-09-17, owner ask: "the background topo should have some lag to it").
 *
 * This answers the open half of the 2026-09-10 dashboard-design question (Michael's Cowork
 * project, not this repo) that named three topo dials — follow, settle, depth — without saying
 * what they should do. Reading `DashboardTopoBackground.jsx` before this item: two of the three
 * already existed as unnamed inline numbers, one didn't exist at all.
 *
 *   - FOLLOW  — how far and how strongly the ambient noise field bulges near the cursor (the
 *     radius the cursor's presence reaches, and how much it lifts the field inside that reach).
 *     Already existed, inlined as `d2 < 9` and `S * 1.6`.
 *   - DEPTH   — how fast the field's own 3D noise volume advances through its Z axis each frame,
 *     independent of any input — pure ambient drift, not cursor- or scroll-driven. Already
 *     existed, inlined as `t += 0.0000625`.
 *   - SETTLE  — how quickly the RENDERED cursor position/intensity eases toward the cursor's raw
 *     target rather than snapping to it every frame. This is the one that was missing: the raw
 *     target (`ptr.tx`/`ptr.ty`) was already set directly from `clientX`/`clientY` (an instant,
 *     lockstep target), but nothing eased the picture toward it — this file's `easeToward` is
 *     that spring/lerp, and DashboardTopoBackground.jsx now calls it every frame instead of
 *     inlining the lerp arithmetic three times.
 *
 * There is no scroll driver anywhere in this component — the canvas is `position: fixed` to the
 * viewport and never reads a scroll offset. Cursor position is the only user-input driver of any
 * of this; the field's large-scale drift (DEPTH) runs on its own regardless of input.
 */

// FOLLOW — unchanged values, now named. `FOLLOW_RADIUS2` is squared (compared against a squared
// distance, so no per-sample sqrt); `FOLLOW_STRENGTH` is how much the field lifts at the cursor's
// exact center before falling off with distance (`Math.exp(-d2)` in the caller).
export const FOLLOW_RADIUS2 = 9;
export const FOLLOW_STRENGTH = 1.6;

// DEPTH — unchanged value, now named. Purely time-driven; never reset or nudged by input.
export const DEPTH_RATE = 0.0000625;

// SETTLE — NEW. Lower = more visible trailing lag. Chosen empirically against the OLD inline
// values this replaces (0.11 for position, 0.065 for intensity): at 60fps, easeToward's implicit
// time constant is roughly -16.7ms / ln(1-rate), so the old position rate reached ~90% of a
// sudden jump in about 20 frames (~330ms) — closer to "tracks the cursor" than "trails behind
// it." These values roughly double that (~45-50 frames, ~750-800ms to 90%), which reads as a
// deliberate beat of lag on a real gesture without the overshoot-free lerp ever looking "seasick"
// (a lerp can't oscillate — it only ever approaches its target monotonically, so slowing it
// further only ever looks laggier, never unstable). Confirmed by canvas sampling in
// ui-audit/verify-dashboard-topo-settle.mjs, not guessed.
export const SETTLE_POS = 0.045;
export const SETTLE_STRENGTH = 0.03;

/** Ease `current` toward `target` by `rate` (0,1]. `rate` at 1 is an instant snap (no lag at
 * all) — the pre-existing entry-snap case in DashboardTopoBackground.jsx still assigns directly
 * rather than calling this, since a snap is a deliberate exception, not a rate of 1. */
export function easeToward(current, target, rate) {
  return current + (target - current) * rate;
}
