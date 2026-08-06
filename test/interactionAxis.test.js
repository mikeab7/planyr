import { describe, it, expect } from "vitest";
import {
  viewKey, viewDrift, probeValidityFault, linearGrowth, growthRow,
  buildGrowthTable, axisVerdict, suspects, pearson,
} from "../ui-audit/lib/interactionAxis.mjs";

/* NEW-1 — the pure decision layer of the INTERACTION-COUNT degradation probe.
 *
 * The whole item rests on one premise: that the probe at N = 1000 and the probe at N = 0 are
 * looking at the SAME scene, so any difference between them is interaction count and not content.
 * If that premise silently breaks, the harness stops measuring the new axis and quietly starts
 * re-measuring the already-known "how much is drawn" one — with no error, and a plausible number.
 * These tests exist so it cannot break silently. */

describe("probeValidityFault — the probe must move, AND come back", () => {
  const V = (offX, offY, ppf) => ({ offX: String(offX), offY: String(offY), ppf: String(ppf) });

  it("passes a probe that moved and returned exactly", () => {
    const before = V(100, 200, 0.5);
    expect(probeValidityFault({ before, mid: V(340, 320, 0.5), after: V(100, 200, 0.5) })).toBeNull();
  });

  it("REFUSES a probe whose view never moved — that is an idle page, not a fast one", () => {
    const before = V(100, 200, 0.5);
    const fault = probeValidityFault({ before, mid: V(100, 200, 0.5), after: V(100, 200, 0.5) });
    expect(fault).toMatch(/did not move/);
  });

  it("REFUSES a probe that drifted — checkpoint N would be measuring a different scene", () => {
    const fault = probeValidityFault({ before: V(100, 200, 0.5), mid: V(340, 320, 0.5), after: V(160, 200, 0.5) });
    expect(fault).toMatch(/did not return/);
    // ...and it says WHY that matters, because a drifting probe reads as a slower probe.
    expect(fault).toMatch(/how much is drawn/);
  });

  it("allows drift inside an explicit tolerance, and only inside it", () => {
    const before = V(100, 200, 0.5);
    const nudged = V(100.4, 200, 0.5);
    expect(probeValidityFault({ before, mid: V(340, 320, 0.5), after: nudged, tolerance: 1 })).toBeNull();
    expect(probeValidityFault({ before, mid: V(340, 320, 0.5), after: nudged, tolerance: 0 })).toMatch(/did not return/);
  });

  it("refuses outright when the canvas published no view at all", () => {
    expect(probeValidityFault({ before: null, mid: null, after: null })).toMatch(/no view transform/);
  });

  it("counts a scale change as drift even when the offsets match", () => {
    const fault = probeValidityFault({ before: V(0, 0, 0.5), mid: V(0, 0, 0.7), after: V(0, 0, 0.55), tolerance: 1 });
    expect(fault).toMatch(/did not return/);
    expect(viewDrift(V(0, 0, 0.5), V(0, 0, 0.55))).toBeCloseTo(100, 0); // 10% of a nominal 1000 px
  });

  it("viewKey formats both ends of a probe identically, so a comparison is honest", () => {
    expect(viewKey(V(1, 2, 3))).toBe("1|2|3");
    expect(viewKey(null)).toBeNull();
  });
});

describe("linearGrowth / growthRow — a NAMED RATE, not a from/to pair", () => {
  it("recovers the slope of a clean per-interaction growth", () => {
    const g = linearGrowth([{ n: 0, v: 10 }, { n: 50, v: 20 }, { n: 150, v: 40 }, { n: 400, v: 90 }]);
    expect(g.slope).toBeCloseTo(0.2, 3);
    expect(g.r).toBeCloseTo(1, 2);
  });

  it("separates a STEP AT LOAD from a per-interaction cost — same endpoint delta, different meaning", () => {
    // Both series end 100 above where they started. Only the second one costs anything per gesture.
    const step = growthRow("x", [{ n: 0, v: 0 }, { n: 50, v: 100 }, { n: 150, v: 100 }, { n: 1000, v: 100 }]);
    const perGesture = growthRow("y", [{ n: 0, v: 0 }, { n: 50, v: 5 }, { n: 150, v: 15 }, { n: 1000, v: 100 }]);
    expect(step.total).toBe(100);
    expect(perGesture.total).toBe(100);
    expect(perGesture.perInteraction).toBeCloseTo(0.1, 2);
    expect(perGesture.r).toBeGreaterThan(0.99);
    expect(step.r).toBeLessThan(perGesture.r); // the step's slope does not describe the series
  });

  it("calls a counter that never moved FLAT rather than inventing a rate", () => {
    const row = growthRow("elementsDrawn", [{ n: 0, v: 66 }, { n: 400, v: 66 }, { n: 1000, v: 66 }]);
    expect(row.verdict).toBe("FLAT");
    expect(row.perInteraction).toBe(0);
  });

  it("reports unmeasured rather than zero when a counter was never read", () => {
    expect(growthRow("gpu", []).verdict).toBe("unmeasured");
    expect(linearGrowth([{ n: 0, v: 1 }])).toBeNull();
  });

  it("builds the whole table in the order it was asked for", () => {
    const cps = [{ n: 0, counters: { a: 1, b: 9 } }, { n: 100, counters: { a: 3, b: 9 } }];
    const t = buildGrowthTable(cps, [{ counter: "a" }, { counter: "b" }]);
    expect(t.map((r) => r.counter)).toEqual(["a", "b"]);
    expect(t[0].verdict).toBe("grows");
    expect(t[1].verdict).toBe("FLAT");
  });
});

describe("axisVerdict — which axis did the cost actually track?", () => {
  const ns = [0, 50, 150, 400, 1000];

  it("names INTERACTION-BOUND only when the interact arm rises and the idle arm does not", () => {
    const v = axisVerdict({
      interactCosts: [100, 120, 145, 180, 240], idleCosts: [100, 101, 99, 102, 100],
      floorPct: 12, checkpointNs: ns,
    });
    expect(v.verdict).toBe("INTERACTION-BOUND");
    expect(v.interactRisePct).toBeCloseTo(140, 0);
    expect(v.why).toMatch(/r=0\.93/); // it says explicitly that the prior finding does not cover this
  });

  it("REFUSES to call it interaction-bound when the idle arm degraded too", () => {
    const v = axisVerdict({
      interactCosts: [100, 130, 160, 190, 230], idleCosts: [100, 128, 155, 185, 225],
      floorPct: 12, checkpointNs: ns,
    });
    expect(v.verdict).toBe("TIME-OR-PROBE-BOUND");
    expect(v.why).toMatch(/regardless of input/);
  });

  it("returns INCONCLUSIVE — a real answer — when nothing clears the floor", () => {
    const v = axisVerdict({ interactCosts: [100, 103, 98, 105, 101], idleCosts: [100, 99, 102, 100, 98], floorPct: 12, checkpointNs: ns });
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.why).toMatch(/NOT refuted/); // and it says what that means for the prior finding
  });

  it("calls a single high endpoint UNSUSTAINED — one point is not a trend", () => {
    const v = axisVerdict({ interactCosts: [100, 101, 99, 102, 160], idleCosts: [100, 100, 100, 100, 100], floorPct: 12, checkpointNs: ns });
    expect(v.verdict).toBe("unsustained");
  });

  it("refuses to state any verdict without a noise floor", () => {
    expect(axisVerdict({ interactCosts: [100, 200, 300], idleCosts: [], floorPct: null }).verdict).toBe("inconclusive");
    expect(axisVerdict({ interactCosts: [100, 200], floorPct: 5 }).verdict).toBe("unmeasured");
  });
});

describe("suspects — names a mechanism, never convicts one", () => {
  it("ranks growing counters by how well they track the measured cost, and drops the flat ones", () => {
    const cps = [
      { n: 0, probeMedianMs: 100, counters: { tiles: 40, heap: 20, drawn: 66 } },
      { n: 400, probeMedianMs: 160, counters: { tiles: 200, heap: 21, drawn: 66 } },
      { n: 1000, probeMedianMs: 240, counters: { tiles: 440, heap: 19, drawn: 66 } },
    ];
    const table = buildGrowthTable(cps, [{ counter: "tiles" }, { counter: "heap" }, { counter: "drawn" }]);
    const s = suspects(table, cps);
    expect(s[0].counter).toBe("tiles");
    expect(s[0].rVsCost).toBeGreaterThan(0.99);
    expect(s.map((x) => x.counter)).not.toContain("drawn"); // FLAT ⇒ exonerated, never ranked
  });

  it("pearson refuses a series too short to mean anything", () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
  });
});
