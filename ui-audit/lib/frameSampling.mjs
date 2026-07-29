/* Is a frame-time sample trustworthy? (2026-07-29)
 *
 * requestAnimationFrame is SUSPENDED in a backgrounded tab and says nothing about it. The
 * planner's frame budget was originally seeded from a browser session whose tab visibility
 * could not be guaranteed; re-checked on 2026-07-29 that surface reported
 * `document.visibilityState === "hidden"`, six real drag gestures produced ZERO frames, and a
 * 1500 ms idle sample produced zero as well. A screenshot does not foreground the tab. Sample
 * counts wandering 1525 → 316 → 0 across otherwise-identical runs are the signature of that
 * throttling, not of a performance change.
 *
 * The dangerous case is not the zero — it is the MIDDLE of that range. A partly throttled run
 * still yields a perfectly plausible-looking median from a starved sample, and that is exactly
 * how a bad ceiling gets committed. So this is the one place that decides whether a frame
 * sample may be reported at all. Pure → unit-tested, and shared by the harness so the rule
 * cannot drift between "what we check" and "what we document".
 */

// Below this observed rate across the gesture, rAF was throttled and the sample is starved.
// Deliberately well under 60: a genuinely slow frame is what we are trying to MEASURE, so the
// floor has to sit below any plausible real-world render cost and only catch suspension.
export const MIN_PLAUSIBLE_FPS = 30;

// Observed frame rate across a gesture. Returns 0 for a zero-length gesture rather than NaN /
// Infinity, so a degenerate run reads as "starved" instead of silently passing the floor.
export const observedFps = (samples, gestureMs) =>
  gestureMs > 0 ? +((samples / gestureMs) * 1000).toFixed(1) : 0;

// The reason this frame sample must NOT be reported, or null when it may be. Two distinct
// causes, named separately so a report says WHICH one fired instead of "unreliable".
export function frameSamplingFault({ visibility, samples, gestureMs, minFps = MIN_PLAUSIBLE_FPS }) {
  if (visibility !== "visible") {
    return `the tab was "${visibility}", not "visible" — Chrome suspends requestAnimationFrame in a backgrounded tab, so any median here would be computed from a starved sample`;
  }
  const fps = observedFps(samples, gestureMs);
  if (fps < minFps) {
    return `only ${samples} frames arrived across a ${gestureMs} ms gesture (${fps} fps, below the ${minFps} fps plausibility floor) — rAF was throttled, so the median would be computed from a starved sample`;
  }
  return null;
}
