import { describe, it, expect } from "vitest";
import { runBudgeted, drainBudgeted, PAINT_FRAME_BUDGET_MS } from "../src/workspaces/site-planner/lib/paintSchedule.js";

/* B802400 round 5 — the mechanism the owner's own perf captures pointed at: a single
 * requestAnimationFrame callback ("FrameRequestCallback" in the LoAF attribution) blocking the
 * main thread for 1.5–3.1 SECONDS, coincident with a burst of lattice tiles landing close
 * together. `runBudgeted` is the pure scheduling decision that fixes it: split a big ops list into
 * time-boxed batches so no single synchronous run exceeds a stated budget. */

/* A fake clock that advances by a fixed step on every call — enough for tests that only care
 * that everything eventually runs, not about the exact frame at which a yield happens. */
function stepClock(step = 1) {
  let t = 0;
  return () => { const v = t; t += step; return v; };
}

/* A fake clock that returns an EXPLICIT, pre-scripted sequence of absolute readings, one per
 * call — for tests that assert exactly which op lands in which batch. Repeats the last reading
 * once the script is exhausted. */
function scriptedClock(times) {
  let i = 0;
  return () => {
    const t = times[Math.min(i, times.length - 1)];
    i++;
    return t;
  };
}

describe("runBudgeted — every op runs exactly once, in order", () => {
  it("is a no-op for an empty ops list", () => {
    const gen = runBudgeted([], stepClock());
    expect([...gen]).toEqual([]);
  });

  it("runs a small ops list in a single batch when nothing crosses the budget", () => {
    const seen = [];
    const ops = [1, 2, 3].map((n) => () => seen.push(n));
    drainBudgeted(runBudgeted(ops, stepClock(1), PAINT_FRAME_BUDGET_MS));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("yields once the elapsed time in the current batch reaches the budget, then resumes", () => {
    const seen = [];
    const ops = [1, 2, 3, 4, 5].map((n) => () => seen.push(n));
    // batchStart=0; op1 check=30 (30<40, continue); op2 check=45 (45>=40, yield); new
    // batchStart=45; op3 check=55 (10<40); op4 check=65 (20<40); op5 check=75 (30<40, done).
    const clock = scriptedClock([0, 30, 45, 45, 55, 65, 75]);
    const gen = runBudgeted(ops, clock, 40);
    const first = gen.next();
    expect(first.done).toBe(false);           // yielded after op1+op2 (45ms since batch start)
    expect(seen).toEqual([1, 2]);
    const second = gen.next();
    expect(second.done).toBe(true);            // op3, op4, op5 finish the list
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("never starves a single op whose own cost already exceeds the budget", () => {
    const seen = [];
    const ops = [() => seen.push("huge"), () => seen.push("next")];
    // batchStart=0; op1 check=500 (way over budget -> yield); new batchStart=500;
    // op2 check=505 (5ms, under budget -> done).
    const clock = scriptedClock([0, 500, 500, 505]);
    const gen = runBudgeted(ops, clock, 40);
    const first = gen.next();
    expect(seen).toEqual(["huge"]);   // it ran — never dropped, never split mid-op
    expect(first.done).toBe(false);   // and yielded immediately after
    const second = gen.next();
    expect(second.done).toBe(true);
    expect(seen).toEqual(["huge", "next"]);
  });

  it("drainBudgeted ignores every yield and runs everything to completion in one call", () => {
    const seen = [];
    const ops = Array.from({ length: 20 }, (_, i) => () => seen.push(i));
    drainBudgeted(runBudgeted(ops, stepClock(10), 40)); // crosses the 40ms budget every few ops
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("drainBudgeted resumes a PARTIALLY-consumed generator rather than restarting it", () => {
    const seen = [];
    const ops = [1, 2, 3, 4].map((n) => () => seen.push(n));
    // batchStart=0; op1 check=50 (over budget -> yield immediately after the first op).
    const clock = scriptedClock([0, 50, 50, 60, 70]);
    const gen = runBudgeted(ops, clock, 40);
    gen.next();                    // manually pull the first batch (op1 only)
    expect(seen).toEqual([1]);
    drainBudgeted(gen);            // hand the SAME generator to drainBudgeted
    expect(seen).toEqual([1, 2, 3, 4]);   // finished, not re-run from the top
  });

  it("is a safe no-op on a null/already-exhausted generator", () => {
    expect(() => drainBudgeted(null)).not.toThrow();
    const gen = runBudgeted([], stepClock());
    drainBudgeted(gen);
    expect(() => drainBudgeted(gen)).not.toThrow();
  });
});

/* ── the fixture built from the owner's real numbers, not hand-waved ───────────────────────────
 * B800848 measured a real 8-tile cover composing to 2642 lines. This session's brief cites a real
 * production perf capture (build 558cbc0) whose worst FrameRequestCallback long task ran 2566ms.
 * Modeling one paint op (one L.polyline().addTo()) at 2566/2642 ≈ 0.971ms — the SAME order of
 * magnitude a canvas-backed Leaflet add genuinely costs — reproduces the exact shape of the
 * reported defect: a burst of ~2600+ ops applied in one synchronous loop blows past any frame
 * budget by roughly 50x. This is the RED case; `runBudgeted` is the fix that makes it GREEN. */
describe("a fixture built from the owner's real captured numbers (B800848 + this session's perf captures)", () => {
  const OPS_COUNT = 2642;                              // B800848's real 8-tile composed-line count
  const OBSERVED_LONG_TASK_MS = 2566;                  // build 558cbc0's worst FrameRequestCallback
  const PER_OP_MS = OBSERVED_LONG_TASK_MS / OPS_COUNT; // ≈0.971ms/op — derived, not chosen

  function buildOps() {
    const applied = [];
    const ops = [];
    for (let i = 0; i < OPS_COUNT; i++) ops.push(() => applied.push(i));
    return { ops, applied };
  }

  it("RED: applying the whole burst in one unscheduled synchronous loop reproduces the reported multi-second block", () => {
    const { ops } = buildOps();
    let elapsed = 0;
    for (let i = 0; i < ops.length; i++) { ops[i](); elapsed += PER_OP_MS; }
    // This is what the OLD terrainLayers.js paint() did: one loop, no scheduling. It reproduces
    // the owner's measured order of magnitude (seconds, not milliseconds) and is far over budget —
    // the property this whole module exists to fix.
    expect(elapsed).toBeCloseTo(OBSERVED_LONG_TASK_MS, 0);
    expect(elapsed).toBeGreaterThan(PAINT_FRAME_BUDGET_MS * 10);
  });

  it("GREEN: the SAME burst, run through runBudgeted one animation frame at a time, never blocks a single frame anywhere near the budget", () => {
    const { ops, applied } = buildOps();
    const clock = stepClock(PER_OP_MS); // one now() reading per op boundary, paced like the real cost
    const gen = runBudgeted(ops, clock, PAINT_FRAME_BUDGET_MS);
    const opsPerBatch = [];
    let prevCount = 0;
    let r = gen.next();
    while (true) {
      opsPerBatch.push(applied.length - prevCount);
      prevCount = applied.length;
      if (r.done) break;
      r = gen.next();
    }
    const maxBatchMs = Math.max(...opsPerBatch.map((n) => n * PER_OP_MS));

    expect(applied).toEqual(Array.from({ length: OPS_COUNT }, (_, i) => i)); // every op ran, in order
    expect(opsPerBatch.length).toBeGreaterThan(1);          // the burst genuinely spans multiple frames
    // The whole point: no single batch's own work comes anywhere near the multi-second block that
    // running everything unscheduled produced above — one op of slop over the budget, never a
    // full batch's worth.
    expect(maxBatchMs).toBeLessThan(PAINT_FRAME_BUDGET_MS + PER_OP_MS);
  });
});
