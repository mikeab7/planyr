/* NEW-1 (B217540 ×3) — the pure decision behind ui-audit/perf-edit-switch.mjs. A harness that cannot have seen the defect must say
 * VOID, not green (FOREGROUND-OR-VOID / the "known-good arm" rule), and a budget breach must name itself. */
import { describe, it, expect } from "vitest";
import { editSwitchVerdict, slope } from "../ui-audit/lib/editSwitch.mjs";

const budget = { minStoreKB: 2500, heapWarmupVisits: 6, hitchMs: 150, maxHitchEdits: 2, maxWorstTaskMs: 400, maxMedianLongTaskMsPerEdit: 80, maxFrames100: 12,
  maxBigParsesPerEdit: 2, maxBigStringifiesPerEdit: 0, maxBigWritesPerEdit: 1, maxAllocMBPerEdit: 300, maxHeapSlopeMBPerSwitch: 1.0, maxDetachedNodes: 40 };
const edit = (o = {}) => ({ moved: true, lt: [[1, 55]], fr: [], big: { parse: 0, stringify: 0, set: 1, setMs: 33 }, ...o });
const good = (o = {}) => ({
  visits: Array.from({ length: 12 }, (_, i) => ({ heapMB: 60 + (i > 5 ? (i - 6) * 0.2 : 0) })),
  editLog: Array.from({ length: 36 }, () => edit()),
  switchProven: true, detachedNodes: 0, store: { extraKB: 3000 }, ...o,
});

describe("slope", () => {
  it("is the least-squares slope", () => { expect(slope([1, 2, 3, 4])).toBeCloseTo(1, 9); expect(slope([5, 5, 5])).toBeCloseTo(0, 9); expect(slope([7])).toBe(0); });
});

describe("editSwitchVerdict", () => {
  it("passes a clean run", () => { const v = editSwitchVerdict(good(), budget); expect(v.pass).toBe(true); expect(v.void).toBe(false); });
  it("FAILS (named) on the owner's shape: whole-store parses/stringifies/double writes and a 1 s task", () => {
    const run = good({ editLog: Array.from({ length: 36 }, (_, i) => edit(i === 5 ? { lt: [[1, 1057]], big: { parse: 9, stringify: 2, set: 2, setMs: 70 } } : {})) });
    const v = editSwitchVerdict(run, budget);
    expect(v.pass).toBe(false);
    const text = v.lines.join("\n");
    expect(text).toMatch(/❌ worst single task/); expect(text).toMatch(/❌ whole-store JSON.parse/); expect(text).toMatch(/❌ whole-store JSON.stringify/); expect(text).toMatch(/❌ whole-store setItem/);
  });
  it("fails a median edit that blocks too long even when no single task is huge", () => {
    const v = editSwitchVerdict(good({ editLog: Array.from({ length: 36 }, () => edit({ lt: [[1, 99]] })) }), budget);
    expect(v.pass).toBe(false); expect(v.lines.join("\n")).toMatch(/❌ median long-task/);
  });
  it("fails a heap that climbs after warm-up, and ignores the warm-up climb itself", () => {
    const climbing = good({ visits: Array.from({ length: 12 }, (_, i) => ({ heapMB: 60 + i * 3 })) });
    expect(editSwitchVerdict(climbing, budget).pass).toBe(false);
    const warm = good({ visits: Array.from({ length: 12 }, (_, i) => ({ heapMB: i < 6 ? 50 + i * 3 : 65 })) });
    expect(editSwitchVerdict(warm, budget).pass).toBe(true);
  });
  it("fails retained detached DOM", () => { expect(editSwitchVerdict(good({ detachedNodes: 900 }), budget).pass).toBe(false); });
  it("checks allocation only when it was measured", () => {
    expect(editSwitchVerdict(good(), budget).lines.join("\n")).not.toMatch(/allocated/);
    const v = editSwitchVerdict(good({ allocMB: 36 * 465 }), budget);
    expect(v.pass).toBe(false); expect(v.lines.join("\n")).toMatch(/❌ MB allocated per edit/);
    expect(editSwitchVerdict(good({ allocMB: 36 * 209 }), budget).pass).toBe(true);
  });
  describe("is VOID — never green — when the run could not have seen the defect", () => {
    const cases = {
      "too few switches": good({ visits: Array.from({ length: 5 }, () => ({ heapMB: 60 })) }),
      "too few edits": good({ editLog: Array.from({ length: 10 }, () => edit()) }),
      "no plan switch proven": good({ switchProven: false }),
      "drags that moved nothing": good({ editLog: Array.from({ length: 36 }, (_, i) => edit({ moved: i % 2 === 0 })).map((e, i) => (i % 3 ? { ...e, moved: false } : e)) }),
      "a store too light to exercise the whole-store cost": good({ store: { extraKB: 100 } }),
      "counters that never reported": good({ editLog: Array.from({ length: 36 }, () => ({ moved: true, lt: [], fr: [] })) }),
      "no detachedness reading": good({ detachedNodes: null }),
    };
    for (const [name, run] of Object.entries(cases)) it(name, () => { const v = editSwitchVerdict(run, budget); expect(v.void).toBe(true); expect(v.pass).toBe(false); expect(v.lines[0]).toMatch(/^VOID/); });
  });
});
