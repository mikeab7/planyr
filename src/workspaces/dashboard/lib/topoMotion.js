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

// DEPTH — OWNER-TUNED (NEW-1 of the TOPO-TUNE-2026-10-05 block; was 0.0000625, ~0.05x of the old
// speed, so the contours drift very slowly). Purely time-driven; never reset or nudged by input.
export const DEPTH_RATE = 0.0000031;

// SETTLE — OWNER-TUNED, deliberately extreme (NEW-1, 2026-10-05; were 0.045 / 0.03). Chosen by the
// owner on a standalone tuner that is a verbatim port of this component: do not clamp or round.
// easeToward is a per-frame lerp, so at 60fps the cursor highlight takes about 20 seconds to close
// 90% of the gap to the real cursor (was ~0.8s), and the highlight intensity fades in and out
// just as slowly. SETTLE_STRENGTH keeps the 2:3 ratio to SETTLE_POS. A lerp can't oscillate, so
// slowing it only ever reads laggier, never unstable.
export const SETTLE_POS = 0.0019;
export const SETTLE_STRENGTH = 0.0013;

// LINE INK — OWNER-TUNED (NEW-2, 2026-10-05). Canvas strokes need concrete hex at render time
// (palette.js: var() can't be used on a canvas), so the day/night sets live here as named
// constants, switched by the app's resolved theme in DashboardTopoBackground.jsx.
export const TOPO_INK = {
  light: { minor: "#8394AA", index: "#3B4B63", alpha: 0.50, minorWidth: 0.9, indexWidth: 1.5 }, // design-exempt: owner-tuned canvas line ink
  dark: { minor: "#5F6E86", index: "#B7C4DA", alpha: 0.55, minorWidth: 0.9, indexWidth: 1.5 }, // design-exempt: owner-tuned canvas line ink
};

/** Ease `current` toward `target` by `rate` (0,1]. `rate` at 1 is an instant snap (no lag at
 * all) — the pre-existing entry-snap case in DashboardTopoBackground.jsx still assigns directly
 * rather than calling this, since a snap is a deliberate exception, not a rate of 1. */
export function easeToward(current, target, rate) {
  return current + (target - current) * rate;
}
