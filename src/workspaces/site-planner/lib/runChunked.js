/* runChunked — a LEAF (no imports): drive a step generator off the main thread's critical path. Split out of
 * buildingGrade.js (problem report 6cea9895) so lib/useGradeSurface.js — on the planner's boot path — can use it without
 * hoisting the grading solvers into the Site route. buildingGrade.js re-exports it. */
/* Drive a solver without hogging the main thread: pump until `sliceMs` is spent, then yield to the event
 * loop via a MessageChannel (never a clamped timer — a hidden tab must not stall it). `isStale()` abandons
 * the run (a newer request superseded it) and resolves `{ stale: true }`. */
export function runChunked(gen, { sliceMs = 10, isStale = null, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const tick = () => new Promise((res) => {
    if (typeof MessageChannel === "undefined") { setTimeout(res, 0); return; }
    const mc = new MessageChannel(); mc.port1.onmessage = () => { mc.port1.close(); res(); }; mc.port2.postMessage(0);
  });
  return (async () => {
    let r = gen.next();
    let t0 = now();
    while (!r.done) {
      if (isStale && isStale()) return { stale: true };
      if (now() - t0 >= sliceMs) { await tick(); t0 = now(); if (isStale && isStale()) return { stale: true }; }
      r = gen.next();
    }
    return r.value;
  })();
}
