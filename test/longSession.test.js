import { describe, it, expect } from "vitest";
import { noiseFloor, verdictFor, sustainedVerdict, correlate, pearson, FRAME_QUANTUM_MS } from "../ui-audit/lib/longSession.mjs";

/* B1357 — the pure decision layer of the long-session degradation harness.
 *
 * These three rules are the whole difference between "we measured it" and "we made a number up",
 * and every one of them was written because the harness got it WRONG on a real run first. They are
 * unit-tested rather than left inside the browser driver for exactly that reason. */

describe("noiseFloor — what this machine can actually resolve", () => {
  it("reports the spread of the baseline repeats as a percentage of their median", () => {
    const f = noiseFloor([100, 110, 120]);
    expect(f.median).toBe(110);
    expect(f.measuredSpreadPct).toBeCloseTo(18.2, 1);
  });

  it("REFUSES to state a zero floor — one frame quantum is the smallest thing it can express", () => {
    // The trap, hit on the harness's first real run: a fast steady pan reports the identical
    // quantised median every repeat, the measured spread is 0, and a later 16.8 vs 16.7 then reads
    // as a real regression against a ±0% floor.
    const f = noiseFloor([16.7, 16.7, 16.7]);
    expect(f.measuredSpreadPct).toBe(0);
    expect(f.floorPct).toBeGreaterThan(0);
    expect(f.quantumFloored).toBe(true);
    expect(f.floorPct).toBeCloseTo((FRAME_QUANTUM_MS / 16.7) * 100, 0);
  });

  it("keeps the MEASURED spread when it is larger than the quantum", () => {
    const f = noiseFloor([100, 150]);
    expect(f.quantumFloored).toBe(false);
    expect(f.floorPct).toBeCloseTo(33.3, 1);
  });

  it("states no floor at all rather than inventing one from a single repeat", () => {
    expect(noiseFloor([120]).floorPct).toBeNull();
    expect(noiseFloor([]).floorPct).toBeNull();
  });
});

describe("sustainedVerdict — one endpoint above the floor is not a trend", () => {
  it("calls a move REAL only when the last two checkpoints both clear the floor", () => {
    expect(sustainedVerdict([100, 115, 118, 120], 10).verdict).toBe("SLOWER");
  });

  it("calls a final-checkpoint-only excursion UNSUSTAINED, not a regression", () => {
    const v = sustainedVerdict([100, 100, 100, 120], 10);
    expect(v.verdict).toBe("unsustained");
    expect(v.changePct).toBe(20);
  });

  it("calls anything inside the floor within-noise", () => {
    expect(sustainedVerdict([100, 104, 103, 105], 10).verdict).toBe("within-noise");
  });

  it("reports a real IMPROVEMENT as faster, with the same two-checkpoint rule", () => {
    expect(sustainedVerdict([100, 85, 82, 80], 10).verdict).toBe("faster");
    expect(sustainedVerdict([100, 100, 100, 80], 10).verdict).toBe("unsustained");
  });

  it("never guesses when the sample is too short or the floor unknown", () => {
    expect(sustainedVerdict([100, 120], 10).verdict).toBe("unmeasured");
    expect(sustainedVerdict([100, 120, 130], null).verdict).toBe("inconclusive");
  });
});

describe("verdictFor — the single-point comparison the series verdict is built on", () => {
  it("does not call a change real unless it clears the floor", () => {
    expect(verdictFor(100, 105, 10).verdict).toBe("within-noise");
    expect(verdictFor(100, 130, 10).verdict).toBe("SLOWER");
    expect(verdictFor(100, 70, 10).verdict).toBe("faster");
  });
  it("returns unmeasured rather than 0% when a median was suppressed", () => {
    expect(verdictFor(null, 120, 10).verdict).toBe("unmeasured");
    expect(verdictFor(100, null, 10).verdict).toBe("unmeasured");
  });
});

describe("correlate — naming a suspect, never proving one", () => {
  it("ranks the counter that moved WITH the gesture cost first", () => {
    const series = [0, 1, 2, 3].map((i) => ({
      wheelMedianMs: 100 + i * 10,
      panCommitsPerMove: 2,
      counters: { heapMB: 50 + i * 10, canvasNodes: 900, documentNodes: 1800, tiles: 100, elements: 64 },
    }));
    const c = correlate(series);
    expect(c[0].counter).toBe("heapMB");
    expect(c[0].r).toBeCloseTo(1, 2);
  });

  it("says nothing at all on fewer than three points", () => {
    expect(correlate([{ wheelMedianMs: 100, counters: {} }, { wheelMedianMs: 120, counters: {} }])).toEqual([]);
  });

  it("drops a flat counter rather than reporting a meaningless correlation", () => {
    const series = [0, 1, 2, 3].map((i) => ({ wheelMedianMs: 100 + i * 10, counters: { canvasNodes: 900 } }));
    expect(correlate(series).find((x) => x.counter === "canvasNodes")).toBeUndefined();
  });

  it("pearson returns null rather than NaN when a series has no variance", () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});
