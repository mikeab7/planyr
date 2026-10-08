/* planOpenVerdict — the pure scoring behind ui-audit/perf-plan-open.mjs (NEW-1 / B2224000): per-action budgets, VOID when the instrument or scene
 * cannot be trusted (known-good arm under 150 ms, errored run, no features, rows never fetched). */
import { describe, it, expect } from "vitest";
import { planOpenVerdict, SELF_TEST_MIN_MS } from "../ui-audit/lib/planOpenVerdict.mjs";

const act = (label, maxMs, extra = {}) => ({ label, maxMs, over50: 1, sumOver50: maxMs, feat: 30, rowFetches: 1, selfTestMs: 200, ...extra });
const run = (...a) => a;

describe("planOpenVerdict", () => {
  it("passes inside the per-action budget and fails over it (worst run counts, not the median)", () => {
    const budget = { maxGapMs: 100, byLabel: { slow: 300 } };
    const ok = planOpenVerdict({ s: [run(act("slow", 250), act("fast", 90)), run(act("slow", 260), act("fast", 95))] }, budget);
    expect(ok.pass).toBe(true);
    const bad = planOpenVerdict({ s: [run(act("fast", 50)), run(act("fast", 50)), run(act("fast", 140))] }, budget);
    expect(bad.pass).toBe(false);
    expect(bad.rows[0].medianMax).toBe(50);
    expect(bad.rows[0].worstMax).toBe(140);
  });
  it("is VOID, never PASS, when the known-good arm cannot see a 200 ms stall", () => {
    const v = planOpenVerdict({ s: [run(act("a", 10, { selfTestMs: SELF_TEST_MIN_MS - 1 }))] }, { maxGapMs: 500 });
    expect(v.void).toBe(true); expect(v.pass).toBe(false);
    expect(v.lines[0]).toMatch(/^VOID/);
  });
  it("is VOID on an errored run, an empty canvas, rows never fetched, or nothing scored", () => {
    expect(planOpenVerdict({ s: [run({ label: "a", error: "boom" })] }).void).toBe(true);
    expect(planOpenVerdict({ s: [run(act("a", 10, { feat: 0 }))] }, { maxGapMs: 500 }).void).toBe(true);
    expect(planOpenVerdict({ s: [run(act("a", 10, { rowFetches: 0 }))] }, { maxGapMs: 500 }).void).toBe(true);
    expect(planOpenVerdict({}).void).toBe(true);
  });
  it("carries the owner's 50 ms target as information, never as a gate", () => {
    const v = planOpenVerdict({ s: [run(act("a", 200))] }, { maxGapMs: 300, targetGapMs: 50 });
    expect(v.pass).toBe(true); expect(v.budget.targetGapMs).toBe(50);
  });
});
