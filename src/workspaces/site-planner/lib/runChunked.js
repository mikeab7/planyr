/* runChunked — a LEAF (no imports): drive a step generator off the main thread's critical path. Split out of
 * buildingGrade.js (problem report 6cea9895) so lib/useGradeSurface.js — on the planner's boot path — can use it without
 * hoisting the grading solvers into the Site route. buildingGrade.js re-exports it. */
/* Drive a solver without hogging the main thread: pump until `sliceMs` is spent, then yield to the event loop via a
 * MessageChannel (never a clamped timer — a hidden tab must not stall it). `isStale()` abandons the run (a newer request
 * superseded it) and resolves `{ stale: true }`.
 *
 * ⛔ ROUND 8 perf (B2319137 ×2) — A YIELD IS NOT A FRAME. A MessageChannel message is a task, so every slice stays short, but
 * the browser only renders at its own frame opportunities and back-to-back message tasks can keep running straight through
 * them: measured on the owner's cross-dock (ui-audit perf-grading-freeze), a limit-mode switch ran ~60 slices of 10–15 ms
 * each with NO frame between them — one 667 ms animation frame, a screenshot unable to come back — while every long-TASK
 * detector (and the app's perfcap) saw nothing, because no single task was long. That is the shape of the owner's ~30 s
 * freezes. So once `frameGapMs` has passed since the last frame this driver let through, it waits for the next animation
 * frame and resumes in a task AFTER it (rAF runs before paint; the message posted from it lands after the frame). A hidden
 * tab has no frames to give (rAF is suspended there), so it keeps the plain message yield and never stalls.
 *
 * ⛔ B2319137 ×3 — AND A FRAME THAT IS SLOW TO COME MUST NOT BE WAITED FOR. The ×2 fix waited for the next frame unconditionally,
 * and on the owner's screen frames come slowly (a heavy picture at his pixel ratio): every 30 ms of work then cost a whole
 * frame of waiting, so the result took ~65 s on a fresh load (8 s before) and never arrived after three zoom steps (V1950033
 * FAILED). Measured with frames held to ~6 a second (ui-audit perf-grading-freeze, "slow" arm): 4.6 s → 19.7 s and 17 s →
 * 104 s. So the wait is a RACE: the next frame, or `frameWaitMs` of idle time, whichever comes first. The idle gap is what
 * lets the browser render at all (the starvation was back-to-back tasks with no gap); a frame that is late is the browser
 * telling us it is busy painting, and waiting longer for it only slows the work, never the paint. */
export const FRAME_GAP_MS = 30;
export const FRAME_WAIT_MS = 8;
/* ONE clock for every job: several grading solvers run at once (surface, FFE search, fixes, contours), and a per-job clock
 * would let each take its full turn back to back between two frames. */
let lastFrameAt = null;
export function runChunked(gen, { sliceMs = 10, frameGapMs = FRAME_GAP_MS, frameWaitMs = FRAME_WAIT_MS, isStale = null, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const tick = () => new Promise((res) => {
    if (typeof MessageChannel === "undefined") { setTimeout(res, 0); return; }
    const mc = new MessageChannel(); mc.port1.onmessage = () => { mc.port1.close(); res(); }; mc.port2.postMessage(0);
  });
  const canFrame = () => typeof requestAnimationFrame === "function" && !(typeof document !== "undefined" && document.visibilityState === "hidden");
  // the next frame, then a task after it (so the frame — style, layout, paint — happens before we resume)
  // …or `frameWaitMs` of idle time, whichever comes first (a late frame is never waited for — see ×3 above)
  const frame = () => new Promise((res) => {
    let done = false;
    const go = () => { if (done) return; done = true; tick().then(res); };
    requestAnimationFrame(() => { lastFrameAt = now(); go(); });
    if (frameWaitMs > 0) setTimeout(go, frameWaitMs);
  });
  return (async () => {
    let r = gen.next();
    let t0 = now();
    if (lastFrameAt == null || t0 < lastFrameAt || t0 - lastFrameAt > 1000) lastFrameAt = t0;   // first job in a while: the clock starts now
    while (!r.done) {
      if (isStale && isStale()) return { stale: true };
      if (now() - t0 >= sliceMs) {
        if (frameGapMs > 0 && now() - lastFrameAt >= frameGapMs && canFrame()) { await frame(); lastFrameAt = now(); }
        else await tick();
        t0 = now();
        if (isStale && isStale()) return { stale: true };
      }
      r = gen.next();
    }
    return r.value;
  })();
}
