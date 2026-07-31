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

/* THE SAME FLOOR CANNOT SERVE AN EMULATED RUN (NEW-1, 2026-07-31).
 *
 * The 30 fps floor above answers one question: "is this sample starved by a SUSPENDED rAF?" At
 * 1× that is the right question and the right answer — a real drag on this app has never been
 * anywhere near 30 fps in a foreground tab, so anything below it is suspension, not slowness.
 *
 * Under a deliberate `--cpu-throttle N` the premise inverts. Slowness IS the measurand: the
 * whole point of throttling to 4× is to make a 16 ms frame cost 65 ms and become comparable
 * between two builds. Measured on the real Goose Creek plan at 4×, the pan ran at 16 fps and the
 * wheel zoom at 5.3 fps — both genuine, both below the floor, both suppressed, which would have
 * thrown away the only run that reproduced the owner's complaint at all.
 *
 * So under emulation the floor drops to what actually distinguishes suspension from work:
 * Chrome pins a backgrounded tab's rAF to roughly 1 fps or stops it dead, so below 2 fps is
 * suspension and above it is a slow machine. The other two guards do NOT relax — the tab must
 * still be visible, and `idleGestureFault` must still see the view move. At 1× this returns
 * exactly the committed 30, unchanged: emulation buys dynamic range, it does not buy a lower bar.
 */
export const SUSPENSION_FLOOR_FPS = 2;
export const plausibilityFloor = (cpuThrottle = 1) =>
  (cpuThrottle > 1 ? SUSPENSION_FLOOR_FPS : MIN_PLAUSIBLE_FPS);

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

/* THE THIRD WAY A FRAME SAMPLE LIES, and the one that actually shipped (NEW-1, 2026-07-31).
 *
 * The two faults above both ask "did enough frames arrive?". Neither asks the prior question:
 * DID THE GESTURE DO ANYTHING? The perf harness pressed at the exact CENTRE of the canvas and
 * dragged, and on any plan with something in the middle of it that press lands on an ELEMENT,
 * not on bare canvas — so the view never panned. Measured on the real Goose Creek plan: the
 * centre-press gesture produced 604 DOM mutations, while the identical gesture started on bare
 * canvas produced 641,730. The frame sampler saw a full 60 fps for both, and reported the first
 * as a 16.7 ms median with a straight face. That is not a fast pan; it is an idle page.
 *
 * So a frame sample is only reportable if the render surface it claims to be measuring actually
 * changed. The caller passes what it observed move (here: the canvas's own published view
 * transform, before vs after); this decides whether the number may be spoken.
 */
export function idleGestureFault({ before, after, what = "the view transform" }) {
  const same = before != null && after != null && String(before) === String(after);
  if (!same) return null;
  return `${what} did not change across the gesture — the press did not land where it could drive one (on this canvas a centre press lands on an ELEMENT, not bare canvas), so the sample measures an IDLE page and its median describes nothing`;
}
