/* NEW-1 — the pure half of the "add one detention pond and the pan gets slow" probe.
 *
 * ⛔ WHAT THESE TESTS ARE ACTUALLY PROTECTING, because it is not the arithmetic.
 *
 * A performance instrument's failure mode is not a wrong number — it is a PLAUSIBLE number. The
 * whole value of `ui-audit/diagnose-pond-pan.mjs` rests on three judgements that live in this
 * module, and each of them has a comfortable wrong answer:
 *
 *   1. the FLOOR, measured on null pairs by the same estimator the arms use. Measure it any other
 *      way and it is wrong in a direction you cannot see;
 *   2. INCONCLUSIVE as a first-class outcome, with the smallest detectable effect stated — because
 *      "we saw nothing" and "we could not have seen it" are different results and conflating them
 *      falsely kills a hypothesis;
 *   3. the SHAPE of the pond-count scaling — fixed-per-scene vs per-pond vs superlinear — which is
 *      the distinction that decides the fix, and which must return UNRESOLVED rather than guess
 *      when the floor cannot separate two predictions.
 */
import { describe, it, expect } from "vitest";
import {
  median, pctDelta, pairedDelta, nullFloor, armVerdict, scalingShape,
  attributionQuality, phaseDelta, topFunctions,
} from "../ui-audit/lib/pondPan.mjs";

describe("median / pctDelta", () => {
  it("takes the LOWER median on an even count, so the answer is always an observed value", () => {
    expect(median([10, 20, 30, 40])).toBe(20);
    expect(median([30, 10, 20])).toBe(20);
  });
  it("ignores non-numbers rather than poisoning the answer with NaN", () => {
    expect(median([10, null, 20, undefined, 30])).toBe(20);
    expect(median([])).toBe(null);
    expect(median(null)).toBe(null);
  });
  it("refuses a percentage against a zero or negative base", () => {
    expect(pctDelta(0, 10)).toBe(null);
    expect(pctDelta(-5, 10)).toBe(null);
    expect(pctDelta(100, 110)).toBe(10);
    expect(pctDelta(100, 90)).toBe(-10);
  });
});

describe("pairedDelta — the estimator, which is a median of PER-PAIR differences", () => {
  it("is the median of the pair deltas, NOT the delta of the medians", () => {
    /* These differ, and the distinction is the whole reason the probe is paired: pairing cancels
     * the drift that moves both members of a pair together. A run where every pair rose 10% while
     * the absolute level drifted downward must read +10%, not the ratio of the two medians. */
    const p = pairedDelta([
      { before: 1000, after: 1100 },  // +10%
      { before: 900, after: 990 },    // +10%
      { before: 800, after: 880 },    // +10%
    ]);
    expect(p.deltaPct).toBe(10);
    expect(p.n).toBe(3);
  });
  it("drops unusable pairs instead of counting them as zero", () => {
    const p = pairedDelta([{ before: 100, after: 110 }, { before: null, after: 110 }, { before: 0, after: 5 }]);
    expect(p.n).toBe(1);
    expect(p.deltaPct).toBe(10);
  });
  it("reports the spread, so a median is never read without knowing how wide it was", () => {
    const p = pairedDelta([{ before: 100, after: 101 }, { before: 100, after: 120 }]);
    expect(p.spreadPct).toBe(19);
  });
  it("says nothing rather than something when there are no usable pairs", () => {
    expect(pairedDelta([]).deltaPct).toBe(null);
    expect(pairedDelta([]).n).toBe(0);
  });
});

describe("nullFloor — the noise floor, measured on the SAME estimator the arms use", () => {
  it("is the largest apparent effect the instrument produced when there was provably none", () => {
    const f = nullFloor([1.2, -3.4, 0.8, 2.0]);
    expect(f.floorPct).toBe(3.4);
    expect(f.n).toBe(4);
  });
  it("is a RANGE about zero, not a standard deviation — an over-confident floor manufactures findings", () => {
    // Five tight readings and one wide one: the floor is the wide one, not the typical one.
    expect(nullFloor([0.1, 0.1, 0.1, 0.1, 0.1, 9.0]).floorPct).toBe(9);
  });
  it("refuses to state a floor from fewer than two null pairs, and says so", () => {
    const f = nullFloor([1.2]);
    expect(f.floorPct).toBe(null);
    expect(f.why).toMatch(/no floor can be stated/);
  });
});

describe("armVerdict — three outcomes and no fourth", () => {
  it("calls an effect real only when it clears the floor", () => {
    expect(armVerdict({ deltaPct: 12, floorPct: 4 }).verdict).toBe("COSTS MORE");
    expect(armVerdict({ deltaPct: -12, floorPct: 4 }).verdict).toBe("COSTS LESS");
    expect(armVerdict({ deltaPct: 3.9, floorPct: 4 }).verdict).toBe("INCONCLUSIVE");
    expect(armVerdict({ deltaPct: -3.9, floorPct: 4 }).verdict).toBe("INCONCLUSIVE");
  });
  it("an INCONCLUSIVE arm STATES the smallest effect the run could have detected", () => {
    /* Without this, "inconclusive" reads as "no effect" — which is how a real hypothesis gets
     * falsely killed by an instrument that was simply too blunt to see it. */
    const v = armVerdict({ deltaPct: 3, floorPct: 14 });
    expect(v.why).toMatch(/could only have detected an effect larger than ±14%/);
  });
  it("a CHEAPER result is a result, not a rounding error", () => {
    expect(armVerdict({ deltaPct: -20, floorPct: 4 }).why).toMatch(/CHEAPER/);
  });
  it("refuses a verdict with no floor, and with no measurement", () => {
    expect(armVerdict({ deltaPct: 12, floorPct: null }).verdict).toBe("inconclusive");
    expect(armVerdict({ deltaPct: null, floorPct: 4 }).verdict).toBe("unmeasured");
  });
});

describe("scalingShape — the distinction that decides the fix", () => {
  it("FIXED: the first pond costs and the rest are free → fix the gate, not the per-pond work", () => {
    const s = scalingShape([{ n: 1, deltaPct: 20 }, { n: 2, deltaPct: 21 }, { n: 4, deltaPct: 22 }], 5);
    expect(s.shape).toBe("FIXED");
    expect(s.why).toMatch(/per-SCENE/);
  });
  it("LINEAR: each pond costs the same again → fix the per-pond work", () => {
    const s = scalingShape([{ n: 1, deltaPct: 10 }, { n: 2, deltaPct: 20 }, { n: 4, deltaPct: 40 }], 5);
    expect(s.shape).toBe("LINEAR");
    expect(s.perPondPct).toBe(10);
    expect(s.linearAtLast).toBe(40);
  });
  it("SUPERLINEAR: ponds interact → fix the algorithm, not the caching", () => {
    const s = scalingShape([{ n: 1, deltaPct: 10 }, { n: 4, deltaPct: 90 }], 5);
    expect(s.shape).toBe("SUPERLINEAR");
    expect(s.why).toMatch(/interaction between ponds/);
  });
  it("says NO EFFECT when every rung is inside the floor — never a shape fitted to noise", () => {
    expect(scalingShape([{ n: 1, deltaPct: 1 }, { n: 4, deltaPct: 2 }], 10).shape).toBe("no effect");
  });
  it("returns UNRESOLVED rather than guessing when the floor cannot separate fixed from linear", () => {
    // One pond +8%, four ponds +20%: fixed predicts 8% and linear predicts 32%, so the observed
    // 20% sits 12 points from BOTH — outside a ±10% floor in both directions. Neither prediction
    // may be claimed, and the honest answer is that the instrument cannot tell them apart.
    const s = scalingShape([{ n: 1, deltaPct: 8 }, { n: 4, deltaPct: 20 }], 10);
    expect(s.shape).toBe("unresolved");
    expect(s.why).toMatch(/cannot separate them/);
  });
  it("refuses a shape from one point, or with no floor", () => {
    expect(scalingShape([{ n: 1, deltaPct: 10 }], 5).shape).toBe("unresolved");
    expect(scalingShape([{ n: 1, deltaPct: 10 }, { n: 4, deltaPct: 40 }], null).shape).toBe("unresolved");
  });
});

describe("attributionQuality — the UNATTRIBUTED line, held at the standard B1448 set", () => {
  it("computes the unattributed share and judges it against the stated standard", () => {
    const q = attributionQuality({ totalMs: 1000, phases: [{ phase: "React render & commit", ms: 995 }, { phase: "UNATTRIBUTED", ms: 5 }] });
    expect(q.unattributedPct).toBe(0.5);
    expect(q.meetsStandard).toBe(true);
  });
  it("fails the standard loudly rather than quietly rounding", () => {
    const q = attributionQuality({ totalMs: 1000, phases: [{ phase: "UNATTRIBUTED", ms: 50 }] });
    expect(q.unattributedPct).toBe(5);
    expect(q.meetsStandard).toBe(false);
  });
  it("an absent UNATTRIBUTED row is zero, and an unusable profile is null — not zero", () => {
    expect(attributionQuality({ totalMs: 100, phases: [{ phase: "x", ms: 100 }] }).unattributedPct).toBe(0);
    expect(attributionQuality(null).meetsStandard).toBe(null);
    expect(attributionQuality({ totalMs: 0, phases: [] }).unattributedPct).toBe(null);
  });
});

describe("phaseDelta — which named phases MOVED", () => {
  it("compares ABSOLUTE ms, because a share can rise while a cost falls", () => {
    const rows = phaseDelta(
      { phases: [{ phase: "A", ms: 100 }, { phase: "B", ms: 100 }] },
      { phases: [{ phase: "A", ms: 110 }, { phase: "B", ms: 50 }] },
    );
    expect(rows[0]).toEqual({ phase: "A", beforeMs: 100, afterMs: 110, deltaMs: 10 });
    expect(rows[rows.length - 1]).toEqual({ phase: "B", beforeMs: 100, afterMs: 50, deltaMs: -50 });
  });
  it("a phase present on ONE side only is reported at zero, never dropped — it is the interesting row", () => {
    const rows = phaseDelta({ phases: [] }, { phases: [{ phase: "Site geometry", ms: 42 }] });
    expect(rows).toEqual([{ phase: "Site geometry", beforeMs: 0, afterMs: 42, deltaMs: 42 }]);
  });
});

describe("topFunctions — self time per FUNCTION, which is what names a line of code", () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: "spots", url: "http://x/assets/a.js", lineNumber: 210 } },
      { id: 2, callFrame: { functionName: "render", url: "http://x/assets/a.js", lineNumber: 4 } },
    ],
    samples: [1, 1, 2, 1],
    timeDeltas: [1000, 2000, 500, 1000], // µs
  };
  it("aggregates by resolved SOURCE LOCATION, so a name is a line and not a minified symbol", () => {
    const rows = topFunctions(profile, (f) => (f.lineNumber === 210 ? "src/lib/labelFitLadder.js" : "src/App.jsx"));
    expect(rows[0].fn).toBe("spots — src/lib/labelFitLadder.js:211");
    expect(rows[0].ms).toBe(4);
    expect(rows[1].fn).toBe("render — src/App.jsx:5");
    expect(rows[1].ms).toBe(0.5);
  });
  it("falls back to the chunk name when no source map resolves the frame — never silently drops it", () => {
    const rows = topFunctions(profile, () => null);
    expect(rows[0].fn).toBe("spots — a.js");
  });
  it("percentages are of the profiled total and sum to 100", () => {
    const rows = topFunctions(profile, () => null);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 6);
  });
  it("survives an empty profile without inventing a row", () => {
    expect(topFunctions({}, () => null)).toEqual([]);
  });
});
