import { describe, it, expect } from "vitest";
import {
  AXES, axisById, rungEffectFault, rungViewFault, axisCost,
  editRecoveryVerdict, planSwitchVerdict, rankAxes,
  quantisationFloor, floorBlocks, pct,
} from "../ui-audit/lib/sessionAxes.mjs";

/* NEW-2 — the pure decision layer of the SESSION-SHAPED degradation probe.
 *
 * B1432's probe froze content and varied interaction count, and its guard was "content must not
 * change". This probe's premise is the INVERSE — content IS the variable — so its guard has to be
 * the inverse too: the rung must actually have taken effect. Every test below exists because a
 * broken driver produces a perfectly plausible frame number for a scene nobody asked for, and
 * that number joining a trend line is the most dangerous failure an instrument of this shape has.
 */

describe("the axis catalogue", () => {
  it("declares a session rise WITH ITS BASIS for every axis, so the ranking can be argued with", () => {
    expect(AXES.length).toBe(5);
    for (const a of AXES) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.observable).toBe("string");
      expect(Number.isFinite(a.sessionRise)).toBe(true);
      expect(a.sessionRise).toBeGreaterThan(0);
      expect(typeof a.riseBasis).toBe("string");
      expect(a.riseBasis.length).toBeGreaterThan(20);
    }
  });

  it("covers exactly the five axes the item names", () => {
    expect(AXES.map((a) => a.id).sort()).toEqual(["edits", "elements", "layers", "panels", "plans"]);
  });

  it("resolves by id and returns null for an unknown one rather than guessing", () => {
    expect(axisById("panels").observable).toBe("panelsOpen");
    expect(axisById("nope")).toBeNull();
  });
});

describe("rungEffectFault — a rung that did not take is MISSING, never free", () => {
  it("passes a rung whose observable moved exactly as far as the rung says", () => {
    expect(rungEffectFault({ axis: "panels", target: 3, observed: 3, baseline: 0 })).toBeNull();
  });

  it("REFUSES a rung whose panel never opened — the killer case", () => {
    const fault = rungEffectFault({ axis: "panels", target: 3, observed: 0, baseline: 0 });
    expect(fault).toMatch(/panelsOpen/);
    expect(fault).toMatch(/may not join the trend/);
  });

  it("REFUSES a rung whose observable could not be read at all, rather than treating null as zero", () => {
    expect(rungEffectFault({ axis: "elements", target: 10, observed: null })).toMatch(/UNMEASURED, not free/);
  });

  it("atLeast mode accepts overshoot — you cannot un-draw a building, so the driver only pushes one way", () => {
    expect(rungEffectFault({ axis: "elements", target: 10, observed: 74, baseline: 62, mode: "atLeast" })).toBeNull();
  });

  it("atLeast mode REFUSES an undershoot and says by how much it fell short", () => {
    const fault = rungEffectFault({ axis: "elements", target: 20, observed: 66, baseline: 62, mode: "atLeast" });
    expect(fault).toMatch(/reached 4 of the 20/);
  });

  it("honours a tolerance without letting it swallow a whole missing rung", () => {
    expect(rungEffectFault({ axis: "layers", target: 4, observed: 3, baseline: 0, tolerance: 1 })).toBeNull();
    expect(rungEffectFault({ axis: "layers", target: 4, observed: 1, baseline: 0, tolerance: 1 })).not.toBeNull();
  });
});

describe("rungViewFault — the viewport guard is B1432's, imported not re-derived", () => {
  const V = (offX, offY, ppf) => ({ offX: String(offX), offY: String(offY), ppf: String(ppf) });
  it("passes a neutral probe", () => {
    expect(rungViewFault({ before: V(10, 20, 0.5), mid: V(250, 140, 0.5), after: V(10, 20, 0.5) })).toBeNull();
  });
  it("refuses a probe that never moved", () => {
    expect(rungViewFault({ before: V(10, 20, 0.5), mid: V(10, 20, 0.5), after: V(10, 20, 0.5) })).toMatch(/IDLE page/);
  });
  it("refuses a probe that drifted beyond tolerance", () => {
    expect(rungViewFault({ before: V(10, 20, 0.5), mid: V(250, 140, 0.5), after: V(60, 20, 0.5) })).toMatch(/did not return/);
  });
});

describe("axisCost — a SLOPE with a floor, never a from/to pair", () => {
  it("names a real per-unit cost when it clears the floor at the last two rungs", () => {
    const r = axisCost({ rungs: [0, 1, 2, 3, 4], costs: [20, 24, 28, 32, 36], floorPct: 6 });
    expect(r.verdict).toBe("GROWS");
    expect(r.perUnitMs).toBeCloseTo(4, 3);
    expect(r.risePct).toBe(80);
    expect(r.r).toBeGreaterThan(0.99);
  });

  it("returns INCONCLUSIVE — a real result — when the rise is inside the floor", () => {
    const r = axisCost({ rungs: [0, 1, 2, 3], costs: [20, 20.4, 19.8, 20.6], floorPct: 10 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.why).toMatch(/did not rise/);
  });

  it("calls a one-point jump UNSUSTAINED rather than a trend", () => {
    const r = axisCost({ rungs: [0, 1, 2, 3], costs: [20, 20, 20, 40], floorPct: 10 });
    expect(r.verdict).toBe("UNSUSTAINED");
  });

  it("refuses to fit a slope through fewer than three reportable rungs", () => {
    expect(axisCost({ rungs: [0, 1], costs: [20, 40], floorPct: 5 }).verdict).toBe("unmeasured");
  });

  it("drops suppressed rungs (null cost) rather than treating them as zero", () => {
    const r = axisCost({ rungs: [0, 1, 2, 3], costs: [20, null, 28, 36], floorPct: 6 });
    expect(r.points).toBe(3);
    expect(r.verdict).toBe("GROWS");
  });

  it("is inconclusive with no floor at all — an unfloored rise is not a finding", () => {
    expect(axisCost({ rungs: [0, 1, 2], costs: [20, 30, 40], floorPct: null }).verdict).toBe("inconclusive");
  });
});

describe("editRecoveryVerdict — the memo-invalidation test", () => {
  it("names EDIT-SENSITIVE when the gesture right after an edit is dearer than the settled one", () => {
    const v = editRecoveryVerdict({ hotMs: 40, coldMs: 25, floorPct: 10 });
    expect(v.verdict).toBe("EDIT-SENSITIVE");
    expect(v.deltaPct).toBe(60);
  });

  it("reports COLD-SLOWER rather than silently reading it as no effect — that is a different suspect", () => {
    expect(editRecoveryVerdict({ hotMs: 20, coldMs: 40, floorPct: 10 }).verdict).toBe("COLD-SLOWER");
  });

  it("is INCONCLUSIVE inside the floor", () => {
    expect(editRecoveryVerdict({ hotMs: 21, coldMs: 20, floorPct: 10 }).verdict).toBe("INCONCLUSIVE");
  });

  it("is unmeasured when either probe was suppressed", () => {
    expect(editRecoveryVerdict({ hotMs: null, coldMs: 20, floorPct: 10 }).verdict).toBe("unmeasured");
  });
});

describe("planSwitchVerdict — did returning to plan A cost what plan A cost?", () => {
  const keys = ["retainedHeapMB", "rendererNodes", "jsEventListenersCdp"];

  it("says RELEASED when the round trip lands back where it started", () => {
    const v = planSwitchVerdict({
      a0: { retainedHeapMB: 20, rendererNodes: 5000, jsEventListenersCdp: 400 },
      b: { retainedHeapMB: 26, rendererNodes: 6100, jsEventListenersCdp: 470 },
      a1: { retainedHeapMB: 20.4, rendererNodes: 5030, jsEventListenersCdp: 402 },
      keys,
    });
    expect(v.verdict).toBe("RELEASED");
  });

  it("says RETAINED and NAMES the counter when plan B was not let go — and only with a settle sample agreeing", () => {
    const v = planSwitchVerdict({
      a0: { retainedHeapMB: 20, rendererNodes: 5000, jsEventListenersCdp: 400 },
      b: { retainedHeapMB: 26, rendererNodes: 6100, jsEventListenersCdp: 470 },
      a1: { retainedHeapMB: 31, rendererNodes: 5020, jsEventListenersCdp: 405 },
      a2: { retainedHeapMB: 30.5, rendererNodes: 5015, jsEventListenersCdp: 404 },
      keys,
    });
    expect(v.verdict).toBe("RETAINED");
    expect(v.why).toMatch(/retainedHeapMB/);
    expect(v.rows.find((r) => r.counter === "rendererNodes").verdict).toBe("released");
  });

  /* ⛔ THE FALSE POSITIVE THIS VERDICT EXISTS TO STOP (B1121's recurrence run, 2026-08-08). Sampled
   * once, immediately after the round trip, this test reported `retainedHeapMB +39.1% ·
   * rendererNodes +38.1%` on two real plans — and `session-growth.mjs`, sampling the same counters
   * one ordinary round of work later, found them BELOW where they started, on all four of its
   * switch rounds. A forced collection does NOT settle it: conservative stack scanning pins what is
   * still referenced from the frames on the stack when the collection runs. */
  it("says TRANSIENT — not RETAINED — when the spike is gone after a settle", () => {
    const v = planSwitchVerdict({
      a0: { retainedHeapMB: 27.7, rendererNodes: 2276, jsEventListenersCdp: 1599 },
      b: { retainedHeapMB: 28.6, rendererNodes: 3780, jsEventListenersCdp: 1232 },
      a1: { retainedHeapMB: 38.5, rendererNodes: 3143, jsEventListenersCdp: 1654 },
      a2: { retainedHeapMB: 27.9, rendererNodes: 2230, jsEventListenersCdp: 1605 },
      keys,
    });
    expect(v.verdict).toBe("TRANSIENT");
    expect(v.why).toMatch(/awaiting collection, NOT retention/);
    expect(v.why).toMatch(/A single sample here would have reported a leak/);
    expect(v.rows.find((r) => r.counter === "retainedHeapMB").verdict).toBe("transient");
  });

  it("refuses to call a one-sample spike retention at all — it is UNSETTLED, which is neither verdict", () => {
    const v = planSwitchVerdict({
      a0: { retainedHeapMB: 20, rendererNodes: 5000, jsEventListenersCdp: 400 },
      b: { retainedHeapMB: 26, rendererNodes: 6100, jsEventListenersCdp: 470 },
      a1: { retainedHeapMB: 31, rendererNodes: 5020, jsEventListenersCdp: 405 },
      keys, // no a2
    });
    expect(v.verdict).toBe("UNSETTLED");
    expect(v.why).toMatch(/conservative stack scanning/);
    expect(v.rows.find((r) => r.counter === "retainedHeapMB").verdict).toBe("RETAINED?");
  });

  it("still says RELEASED without a settle sample when nothing spiked in the first place", () => {
    const v = planSwitchVerdict({
      a0: { retainedHeapMB: 20, rendererNodes: 5000, jsEventListenersCdp: 400 },
      b: { retainedHeapMB: 26, rendererNodes: 6100, jsEventListenersCdp: 470 },
      a1: { retainedHeapMB: 20.4, rendererNodes: 5030, jsEventListenersCdp: 402 },
      keys,
    });
    expect(v.verdict).toBe("RELEASED");
  });

  it("is unmeasured when nothing could be compared, rather than declaring a clean bill of health", () => {
    expect(planSwitchVerdict({ a0: {}, b: {}, a1: {}, keys }).verdict).toBe("unmeasured");
  });
});

describe("rankAxes — an UNPROVEN cost sorts below every proven one, never above", () => {
  const R = (axis, verdict, perUnitMs) => ({ axis, cost: { verdict, perUnitMs, risePct: 1, r: 0.9 } });

  it("ranks by measured per-unit cost times the DECLARED session rise", () => {
    const out = rankAxes([R("panels", "GROWS", 2), R("elements", "GROWS", 0.5)]);
    // panels: 2 ms × 4 = 8 ms.  elements: 0.5 ms × 40 = 20 ms → elements wins on the session, not the unit.
    expect(out[0].axis).toBe("elements");
    expect(out[0].sessionMs).toBe(20);
    expect(out[1].sessionMs).toBe(8);
  });

  it("scores an INCONCLUSIVE axis at zero — an unproven cost is not a small cost", () => {
    const out = rankAxes([R("panels", "INCONCLUSIVE", 9), R("elements", "GROWS", 0.1)]);
    expect(out[0].axis).toBe("elements");
    expect(out[1].score).toBe(0);
    expect(out[1].perUnitMs).toBeNull();
  });

  it("carries the rise BASIS into the ranking so the multiplier can be challenged", () => {
    const out = rankAxes([R("layers", "GROWS", 1)]);
    expect(out[0].riseBasis).toMatch(/ten layers on/);
  });
});

describe("instrument honesty — the floor has to be able to say it blocked the answer", () => {
  it("computes the floor that 16.7 ms frame quantisation alone imposes", () => {
    expect(quantisationFloor(16.7)).toBeCloseTo(99.8, 0);
    expect(quantisationFloor(33.3)).toBeCloseTo(50.1, 0);
    expect(quantisationFloor(250)).toBeCloseTo(6.7, 0);
    expect(quantisationFloor(0)).toBeNull();
  });

  it("says outright when an expected effect could never have been seen through the floor", () => {
    expect(floorBlocks({ floorPct: 50, expectedEffectPct: 20 })).toBe(true);
    expect(floorBlocks({ floorPct: 6, expectedEffectPct: 20 })).toBe(false);
  });

  it("pct is nearest-rank and ignores non-numbers", () => {
    expect(pct([10, 20, 30, 40], 50)).toBe(30);
    expect(pct([10, null, 30], 90)).toBe(30);
    expect(pct([], 50)).toBeNull();
  });
});
