// ROUND 8 perf (B2319137 ×2): runChunked lets a FRAME through at least every FRAME_GAP_MS of work — a MessageChannel yield is a
// task, not a frame, and back-to-back message tasks ran a 667 ms animation frame on the owner's cross-dock with no long task
// anywhere (ui-audit perf-grading-freeze). A fake clock + a fake rAF prove the scheduling; a hidden tab never waits on rAF.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runChunked, FRAME_GAP_MS } from "../src/workspaces/site-planner/lib/runChunked.js";

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
  it("stale still abandons", async () => {
    let n = 0;
    const r = await runChunked(work(120, 5), { now, isStale: () => ++n > 5 });
    expect(r).toEqual({ stale: true });
  });
});
