// ROUND 8 perf (B2319137 ×2): runChunked lets a FRAME through at least every FRAME_GAP_MS of work — a MessageChannel yield is a
// task, not a frame, and back-to-back message tasks ran a 667 ms animation frame on the owner's cross-dock with no long task
// anywhere (ui-audit perf-grading-freeze). A fake clock + a fake rAF prove the scheduling; a hidden tab never waits on rAF.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runChunked, FRAME_GAP_MS, FRAME_WAIT_MS } from "../src/workspaces/site-planner/lib/runChunked.js";

let clock = 0, frames = 0, rafQueue = [];
const now = () => clock;
function* work(slices, msEach) { for (let i = 0; i < slices; i++) { clock += msEach; yield; } return "done"; }
beforeEach(() => {
  clock = 0; frames = 0; rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); setTimeout(() => { const q = rafQueue; rafQueue = []; frames++; clock += 1; for (const f of q) f(clock); }, 0); return 1; };
  globalThis.document = { visibilityState: "visible" };
});
afterEach(() => { delete globalThis.requestAnimationFrame; delete globalThis.document; });

describe("runChunked lets frames through", () => {
  it("600 ms of 5 ms steps in 10 ms slices: a frame at least every FRAME_GAP_MS of work, and the result still arrives", async () => {
    const r = await runChunked(work(120, 5), { now });
    expect(r).toBe("done");
    expect(frames).toBeGreaterThanOrEqual(Math.floor(600 / (FRAME_GAP_MS + 10)));
  });
  it("frameGapMs 0 is the old behaviour: message yields only, no frame wait (the red arm)", async () => {
    await runChunked(work(120, 5), { now, frameGapMs: 0 });
    expect(frames).toBe(0);
  });
  it("a hidden tab never waits on rAF (it would be suspended there)", async () => {
    globalThis.document.visibilityState = "hidden";
    const r = await runChunked(work(120, 5), { now });
    expect(r).toBe("done");
    expect(frames).toBe(0);
  });
  it("two jobs share one clock: together they still let a frame through every gap", async () => {
    const [a, b] = await Promise.all([runChunked(work(60, 5), { now }), runChunked(work(60, 5), { now })]);
    expect(a).toBe("done"); expect(b).toBe("done");
    expect(frames).toBeGreaterThanOrEqual(Math.floor(600 / (FRAME_GAP_MS + 20)));
  });
  it("×3: a frame that never comes cannot hold the work — each wait ends after FRAME_WAIT_MS of idle time (V1950033 FAILED: ~65 s)", async () => {
    globalThis.requestAnimationFrame = () => 1;      // the browser is busy: no frame arrives at all
    const t0 = Date.now();
    const r = await runChunked(work(120, 5), { now });
    expect(r).toBe("done");
    // ~20 waits of FRAME_WAIT_MS each; an unbounded wait never resolves (the vitest timeout is the red arm)
    expect(Date.now() - t0).toBeLessThan(20 * (FRAME_WAIT_MS + 20) + 500);
  });
  it("×3 red arm: with the race switched off (frameWaitMs 0) a frame that never comes holds the work forever", async () => {
    globalThis.requestAnimationFrame = () => 1;
    const r = await Promise.race([runChunked(work(120, 5), { now, frameWaitMs: 0 }), new Promise((res) => setTimeout(() => res("held"), 300))]);
    expect(r).toBe("held");
  });
  it("stale still abandons", async () => {
    let n = 0;
    const r = await runChunked(work(120, 5), { now, isStale: () => ++n > 5 });
    expect(r).toEqual({ stale: true });
  });
});
