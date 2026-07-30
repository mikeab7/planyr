/* NEW-4 — flood-level sensitivity.
 *
 * The question this answers is an underwriting one, not a design one: on Tsakiris the whole
 * floodplain-mitigation obligation is 0.2 ac-ft, and it is 0.2 only because the ESTIMATED flood
 * surface sits about a quarter foot above existing ground in unstudied Zone A. Does a flood level
 * two feet higher make that 2 ac-ft, or 20?
 *
 * Two properties matter more than the arithmetic:
 *   • the rows come from the SAME evaluator the live panel uses, so a scenario cannot contradict
 *     the number above it;
 *   • an unpriceable scenario reads UNKNOWN, never 0.0 — a fabricated zero obligation is the worst
 *     output this module could produce (the B1036 defect class, in a new surface). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wseSensitivity, normalizeSteps, DEFAULT_STEPS_FT } from "../src/workspaces/site-planner/lib/wseSensitivity.js";
import { criteriaFor, CRITERIA_JUR_KEYS } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

const AF = 43560;
/* A stand-in for the real engine: fill volume grows with the flood level over a flat site, which
 * is exactly the Tsakiris shape — a few inches of water over many acres. */
const flatSite = (acres) => (wse) => ({
  mitigationCf: Math.max(0, (wse - 100.25) + 0.25) * acres * AF,
  detUsableCf: Math.max(0, (120 - wse)) * 2 * AF,
  ffeVerdict: wse > 103 ? "short" : "pass",
  requiredFfeFt: wse + 1,
});

describe("the sweep answers the owner's question: how fast does the obligation grow?", () => {
  const sweep = wseSensitivity(flatSite(0.8), 100.25, { stepsFt: [0, 1, 2, 5] });

  it("runs, and step 0 is the number on screen right now", () => {
    expect(sweep.ok).toBe(true);
    expect(sweep.rows[0].stepFt).toBe(0);
    expect(sweep.rows[0].wseFt).toBe(100.25);
    expect(sweep.rows[0].mitigationDeltaAcFt).toBe(0); // the baseline is a delta of zero from itself
  });

  it("a 0.2 ac-ft obligation today becomes an order of magnitude more two feet up", () => {
    const now = sweep.rows.find((r) => r.stepFt === 0).mitigationAcFt;
    const up2 = sweep.rows.find((r) => r.stepFt === 2).mitigationAcFt;
    expect(now).toBeCloseTo(0.2, 2);
    expect(up2).toBeCloseTo(1.8, 2);
    expect(sweep.worstMitigationAcFt).toBeCloseTo(4.2, 2); // the +5 ft row
  });

  it("deltas are ABSOLUTE — never a percentage against a near-zero requirement (B1034)", () => {
    for (const r of sweep.rows) {
      expect(r).not.toHaveProperty("mitigationDeltaPct");
      expect(r).not.toHaveProperty("pct");
    }
    expect(sweep.rows.find((r) => r.stepFt === 2).mitigationDeltaAcFt).toBeCloseTo(1.6, 2);
  });

  it("names what actually moves, so a flat answer can be said in one line instead of a table", () => {
    expect(sweep.movesWith.mitigation).toBe(true);
    expect(sweep.movesWith.ffe).toBe(true); // pass → short by +5 ft
    expect(sweep.flat).toBe(false);

    const nothingMoves = wseSensitivity(() => ({ mitigationCf: 5 * AF, detUsableCf: 9 * AF, ffeVerdict: "pass" }), 100);
    expect(nothingMoves.flat).toBe(true);
    expect(nothingMoves.movesWith).toEqual({ mitigation: false, credited: false, ffe: false });
  });

  it("credited storage falls as the flood level rises (the other half of the squeeze)", () => {
    const now = sweep.rows.find((r) => r.stepFt === 0).creditedAcFt;
    const up5 = sweep.rows.find((r) => r.stepFt === 5).creditedAcFt;
    expect(up5).toBeLessThan(now);
    expect(sweep.rows.find((r) => r.stepFt === 5).creditedDeltaAcFt).toBeCloseTo(-10, 2);
  });
});

describe("LOUD-FAILURE — an unknown stays unknown", () => {
  it("a scenario the engine cannot price reads unknown, never a fabricated 0.0 obligation", () => {
    const patchy = (wse) => (wse > 101 ? {} : { mitigationCf: 1 * AF, detUsableCf: 2 * AF });
    const sweep = wseSensitivity(patchy, 100, { stepsFt: [0, 2] });
    const high = sweep.rows.find((r) => r.stepFt === 2);
    expect(high.unknown).toBe(true);
    expect(high.mitigationAcFt).toBe(null);
    expect(high.mitigationDeltaAcFt).toBe(null);
    expect(sweep.anyUnknown).toBe(true);
  });

  it("refuses to run rather than inventing a baseline", () => {
    expect(wseSensitivity(null, 100).ok).toBe(false);
    expect(wseSensitivity(() => ({}), null).ok).toBe(false);
    expect(wseSensitivity(() => ({}), NaN).reason).toMatch(/no governing flood level/);
  });

  it("a baseline the engine can't price leaves every delta null rather than anchoring on zero", () => {
    const sweep = wseSensitivity((wse) => (wse === 100 ? {} : { mitigationCf: 9 * AF }), 100, { stepsFt: [0, 1] });
    expect(sweep.rows[1].mitigationAcFt).toBeCloseTo(9, 2);
    expect(sweep.rows[1].mitigationDeltaAcFt).toBe(null); // no honest baseline to subtract
  });
});

describe("the steps are criteria-configurable, never hardcoded at the call site", () => {
  it("all eight jurisdictions publish a sensitivity ladder through criteriaFor", () => {
    for (const key of CRITERIA_JUR_KEYS) {
      const steps = criteriaFor(key).wseSensitivityStepsFt;
      expect(steps, key).toBeTruthy();
      expect(Array.isArray(steps.value), key).toBe(true);
      expect(steps.value.length, key).toBeGreaterThan(1);
      // honest provenance: no code publishes an uncertainty range for an estimated Zone A level
      expect(steps.verified, key).toBe(false);
    }
  });

  it("normalizeSteps always yields a sorted, de-duplicated ladder that includes the baseline", () => {
    expect(normalizeSteps([2, 1, 2, 5])).toEqual([0, 1, 2, 5]);
    expect(normalizeSteps([-3, 1])).toEqual([0, 1]);
    expect(normalizeSteps(null)).toEqual(DEFAULT_STEPS_FT);
    expect(normalizeSteps("nonsense")).toEqual(DEFAULT_STEPS_FT);
  });

  it("an override ladder is honoured end to end", () => {
    const sweep = wseSensitivity(flatSite(1), 100, { stepsFt: [0, 3] });
    expect(sweep.stepsFt).toEqual([0, 3]);
    expect(sweep.rows.map((r) => r.stepFt)).toEqual([0, 3]);
  });
});

describe("the SitePlanner wiring feeds it the SAME evaluator as the live panel", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("evalAtWse is hoisted and shared — one derivation, not two", () => {
    expect(src).toContain("const fmEvalAtWse = useCallback((wse) => {");
    expect(src).toContain("sensitivityBand(fmEvalAtWse, fmEstWse.wseFt, { deltaFt: 1 })");
    expect(src).toContain("wseSensitivity(fmEvalAtWse, baseWse, { stepsFt: steps })");
    // the old inline copy is gone, so the two cannot drift apart
    expect(src.includes("return sensitivityBand(evalAtWse, fmEstWse.wseFt")).toBe(false);
  });

  it("the ladder reads its steps from criteria, not from an inline array", () => {
    // NEW-4(d) — the resolved criteria record is now memoised ONCE per (jurisdiction, overrides)
    // pair as `critAll` and every call site reads that. The guard's intent is unchanged: the steps
    // come from the jurisdiction criteria, never from an inline array.
    expect(src).toContain("const critAll = useMemo(() => criteriaFor(critJurKey, { overrides: criteriaOverrides }), [critJurKey, criteriaOverrides]);");
    expect(src).toContain('const steps = critAll.wseSensitivityStepsFt?.value;');
  });

  it("a flat result is one folded line, not a table of identical rows (PANEL-BREVITY)", () => {
    expect(src).toContain('keyedNote(`Flood-level sensitivity: nothing moves');
  });
});
