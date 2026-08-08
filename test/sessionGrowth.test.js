/* The pure half of the session-growth probe (NEW-2, B1121).
 *
 * Two things are pinned here and they are pinned for different reasons.
 *
 *  1. THE CLASSIFIER, because the whole dispatch turns on one distinction — *"a before/after pair
 *     cannot distinguish a step from a slope, and the owner's report is explicitly a slope."* A
 *     classifier that quietly calls a step a slope would send the next session hunting for an
 *     accumulation that is not there, which is precisely the failure this program has already paid
 *     for four times. So every shape is asserted on a series whose true shape is known by
 *     construction, including the two that must NOT be named: noise, and a series too short to have
 *     a shape at all.
 *
 *  2. THE ELIMINATOR, because it is the only load-bearing NEW idea in the item. The owner's symptom
 *     is undone by a reload; anything that survives a reload therefore cannot be its mechanism.
 *     That inference is worth exactly as much as its implementation is correct, so the quadrants
 *     are asserted individually rather than trusted.
 */
import { describe, it, expect } from "vitest";
import {
  GROWTH_CANDIDATES, candidateById, observableCandidates, unobservableCandidates,
  linearFit, flatFit, stepFit, classifyCurve, reloadReset, admissibility, correlate, attribute, growthHeadline,
} from "../ui-audit/lib/sessionGrowth.mjs";

const series = (ys, step = 1) => ys.map((y, i) => ({ x: i * step, y }));

describe("the pre-registered candidate list", () => {
  it("declares, for every candidate, what it is and whether a reload is predicted to zero it", () => {
    expect(GROWTH_CANDIDATES.length).toBeGreaterThan(15);
    for (const c of GROWTH_CANDIDATES) {
      expect(typeof c.id).toBe("string");
      expect(c.title, `${c.id} has no title`).toBeTruthy();
      expect(c.why, `${c.id} has no rationale`).toBeTruthy();
      expect(["yes", "no", "measure"], `${c.id} reset prediction`).toContain(c.resets);
      expect(c.family, `${c.id} has no family`).toBeTruthy();
    }
  });
  it("has unique ids, so a sample cannot silently overwrite another candidate's series", () => {
    const ids = GROWTH_CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("splits into what can be sampled and what is a recorded open question — never silently drops the second", () => {
    expect(observableCandidates().length + unobservableCandidates().length).toBe(GROWTH_CANDIDATES.length);
    expect(unobservableCandidates().length).toBeGreaterThan(0);
    for (const c of unobservableCandidates()) expect(c.observable).toBeNull();
  });
  it("carries the durable tier, whose whole point is that it is predicted NOT to reset", () => {
    expect(candidateById("localStorageBytes").resets).toBe("no");
    expect(candidateById("idbUsageMB").resets).toBe("no");
    expect(candidateById("heapMB").resets).toBe("yes");
  });
});

describe("linearFit / flatFit / stepFit", () => {
  it("recovers a known line exactly", () => {
    const f = linearFit(series([2, 4, 6, 8, 10]));
    expect(f.slope).toBeCloseTo(2, 9);
    expect(f.intercept).toBeCloseTo(2, 9);
    expect(f.r).toBeCloseTo(1, 4);
    expect(f.rss).toBeCloseTo(0, 9);
  });
  it("gives a flat series a zero slope and a null-ish correlation rather than dividing by zero", () => {
    const f = linearFit(series([5, 5, 5, 5]));
    expect(f.slope).toBeCloseTo(0, 9);
    expect(f.r).toBeNull();
    expect(flatFit(series([5, 5, 5, 5])).mean).toBe(5);
  });
  it("finds the breakpoint of a clean step, and reports it as the first point of the NEW level", () => {
    const f = stepFit(series([10, 10, 10, 30, 30, 30]));
    expect(f.at).toBe(3);
    expect(f.x).toBe(3);
    expect(f.before).toBeCloseTo(10, 9);
    expect(f.after).toBeCloseTo(30, 9);
    expect(f.jumpPct).toBeCloseTo(200, 5);
    expect(f.rss).toBeCloseTo(0, 9);
  });
  it("refuses a step over fewer than three points, because two points are a step by definition", () => {
    expect(stepFit(series([1, 5]))).toBeNull();
  });
});

describe("classifyCurve — the step/slope distinction the whole item turns on", () => {
  it("names a steady rise a SLOPE and says it is unbounded", () => {
    const c = classifyCurve(series([100, 120, 140, 160, 180, 200]), { floorPct: 5 });
    expect(c.shape).toBe("SLOPE");
    expect(c.netPct).toBeCloseTo(100, 1);
    expect(c.why).toMatch(/ACCUMULATION/);
  });
  it("names a single level change a STEP and says it is bounded — NOT a slope", () => {
    const c = classifyCurve(series([100, 101, 99, 100, 160, 159, 161, 160]), { floorPct: 5 });
    expect(c.shape).toBe("STEP");
    expect(c.at).toBe(4);
    expect(c.why).toMatch(/MODE CHANGE/);
  });
  it("refuses to name any shape when the whole series fits inside the stated noise floor", () => {
    const c = classifyCurve(series([100, 103, 98, 101, 99]), { floorPct: 10 });
    expect(c.shape).toBe("FLAT");
    expect(c.why).toMatch(/noise floor/);
  });
  it("calls an oscillation a SAWTOOTH rather than flattening it or fitting a line to it", () => {
    const c = classifyCurve(series([100, 200, 100, 200, 100, 200, 100]), { floorPct: 5 });
    expect(c.shape).toBe("SAWTOOTH");
    expect(c.why).toMatch(/oscillates/);
  });
  it("returns unmeasured — not flat — for a series too short to have a shape", () => {
    const c = classifyCurve(series([100, 200]), { floorPct: 5 });
    expect(c.shape).toBe("unmeasured");
    expect(c.why).toMatch(/two points fit a step and a slope equally well/);
  });
  it("does not call a falling series growth", () => {
    const c = classifyCurve(series([200, 180, 160, 140, 120]), { floorPct: 5 });
    expect(c.shape).toBe("SLOPE-DOWN");
  });
  it("prefers the simpler model: a line through noisy-but-linear data is a SLOPE, not a step", () => {
    const c = classifyCurve(series([100, 111, 119, 131, 139, 151]), { floorPct: 3 });
    expect(c.shape).toBe("SLOPE");
  });
});

describe("reloadReset — the eliminator", () => {
  it("calls a counter that returns to its fresh-page level RESETS", () => {
    const v = reloadReset({ start: 100, end: 400, afterReload: 105 });
    expect(v.verdict).toBe("RESETS");
    expect(v.recoveredPct).toBeGreaterThan(95);
  });
  it("calls a counter that keeps its growth across the reload PERSISTS", () => {
    const v = reloadReset({ start: 100, end: 400, afterReload: 398 });
    expect(v.verdict).toBe("PERSISTS");
    expect(v.why).toMatch(/cannot be what the reload fixes/);
  });
  it("reports a half-recovery as PARTIAL rather than forcing it into one of the two", () => {
    expect(reloadReset({ start: 100, end: 400, afterReload: 250 }).verdict).toBe("PARTIAL");
  });
  it("says there is nothing to test when the counter never grew", () => {
    expect(reloadReset({ start: 100, end: 100, afterReload: 100 }).verdict).toBe("no-growth");
  });
  it("handles a counter that starts at zero without dividing by it", () => {
    expect(reloadReset({ start: 0, end: 50, afterReload: 0 }).verdict).toBe("RESETS");
    expect(reloadReset({ start: 0, end: 50, afterReload: 50 }).verdict).toBe("PERSISTS");
  });
  it("is unmeasured when a sample is missing rather than guessing", () => {
    expect(reloadReset({ start: 1, end: 2, afterReload: null }).verdict).toBe("unmeasured");
  });
});

describe("admissibility — the two-axis verdict", () => {
  it("ADMISSIBLE only for grows-AND-resets, which is the owner's exact signature", () => {
    const a = admissibility({ shape: "SLOPE", reset: { verdict: "RESETS" } });
    expect(a.verdict).toBe("ADMISSIBLE");
    expect(a.why).toMatch(/never a conviction/);
  });
  it("EXCLUDES a durable accumulator — it grows, but the reload does not undo it", () => {
    const a = admissibility({ shape: "SLOPE", reset: { verdict: "PERSISTS" } });
    expect(a.verdict).toBe("EXCLUDED");
    /* And it must NOT be reported as harmless: a permanently large store is complaint (b). */
    expect(a.why).toMatch(/complaint \(b\)/);
  });
  it("EXONERATES anything flat regardless of what a reload does to it", () => {
    expect(admissibility({ shape: "FLAT", reset: { verdict: "PERSISTS" } }).verdict).toBe("EXONERATED");
    expect(admissibility({ shape: "FLAT", reset: { verdict: "RESETS" } }).verdict).toBe("EXONERATED");
  });
  it("marks a resetting STEP as admissible but distinguishes it from an accumulation", () => {
    const a = admissibility({ shape: "STEP", reset: { verdict: "RESETS" } });
    expect(a.verdict).toBe("ADMISSIBLE-STEP");
    expect(a.why).toMatch(/not a steady one/);
  });
  it("never turns an unmeasured curve into an answer", () => {
    expect(admissibility({ shape: "unmeasured" }).verdict).toBe("UNMEASURED");
  });
  it("calls a counter that ends where it began NO-NET-GROWTH, not UNMEASURED", () => {
    /* Run 1 fitted `documentNodes` a STEP on a two-node wiggle (1691 → 1693) and then printed it as
     * UNMEASURED beside genuinely unanswered rows. Ending where it began is an ANSWER. */
    const a = admissibility({ shape: "STEP", reset: { verdict: "no-growth" } });
    expect(a.verdict).toBe("NO-NET-GROWTH");
    expect(a.why).toMatch(/ends where it began/);
  });
  it("keeps a net-zero SAWTOOTH distinguishable — it can still produce a transient", () => {
    const a = admissibility({ shape: "SAWTOOTH", reset: { verdict: "no-growth" } });
    expect(a.verdict).toBe("NO-NET-GROWTH");
    expect(a.why).toMatch(/transient spike, never a steady rise/);
  });
});

describe("attribute — correlation may promote, never rescue", () => {
  const cost = [10, 12, 14, 16, 18];
  it("promotes an admissible candidate that tracks cost to SUSPECT", () => {
    const a = attribute({
      costSeries: cost,
      candidates: [{ id: "heapMB", shape: "SLOPE", series: [1, 2, 3, 4, 5], admissibility: { verdict: "ADMISSIBLE" } }],
    });
    expect(a.rows[0].standing).toBe("SUSPECT");
    expect(a.suspects).toEqual(["heapMB"]);
  });
  it("does NOT rescue a reload-excluded candidate however perfectly it correlates", () => {
    const a = attribute({
      costSeries: cost,
      candidates: [{ id: "idbUsageMB", shape: "SLOPE", series: [1, 2, 3, 4, 5], admissibility: { verdict: "EXCLUDED" } }],
    });
    expect(a.rows[0].r).toBeCloseTo(1, 4);
    expect(a.rows[0].standing).toBe("excluded-by-reload");
    expect(a.suspects).toEqual([]);
  });
  it("keeps an admissible-but-uncorrelated candidate visible instead of dropping it", () => {
    const a = attribute({
      costSeries: cost,
      candidates: [{ id: "rafLive", shape: "SLOPE", series: [5, 1, 4, 2, 3], admissibility: { verdict: "ADMISSIBLE" } }],
    });
    expect(a.rows[0].standing).toBe("admissible-uncorrelated");
  });
  it("correlate returns null rather than a number when there is nothing to correlate", () => {
    expect(correlate([1, 2], [1, 2])).toBeNull();
    expect(correlate([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
});

describe("growthHeadline — a null has to be as loud as a finding", () => {
  it("states a flat cost curve as an explicit NULL, and does not overclaim from it", () => {
    const h = growthHeadline({ costShape: { shape: "FLAT" }, floorPct: 6 });
    expect(h.verdict).toBe("NULL");
    expect(h.headline).toMatch(/HONEST NULL/);
    expect(h.headline).toMatch(/not the same as the symptom not existing/);
  });
  it("says loudly when cost accumulates and NOTHING measured can explain it", () => {
    const h = growthHeadline({ costShape: { shape: "SLOPE" }, attribution: { suspects: [] } });
    expect(h.verdict).toBe("SLOPE");
    expect(h.headline).toMatch(/UNATTRIBUTED/);
  });
  it("names the suspects when there are some, and still refuses to call them causes", () => {
    const h = growthHeadline({ costShape: { shape: "SLOPE" }, attribution: { suspects: ["heapMB", "rafLive"] } });
    expect(h.headline).toMatch(/heapMB, rafLive/);
    expect(h.headline).toMatch(/not convictions/);
  });
  it("carries the un-sampled candidates into the headline so they are not lost", () => {
    const h = growthHeadline({ costShape: { shape: "FLAT" }, unobservable: ["undoDepth"] });
    expect(h.headline).toMatch(/remain OPEN: undoDepth/);
  });
  it("distinguishes a step from a slope in the headline itself", () => {
    const h = growthHeadline({ costShape: { shape: "STEP" } });
    expect(h.verdict).toBe("STEP");
    expect(h.headline).toMatch(/MODE CHANGE/);
  });
});
