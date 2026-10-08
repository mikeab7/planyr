/* NEW-1 (B217540 ×2) — the pure verdict behind ui-audit/perf-edit-cycle.mjs. A slope is asserted, never a level. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { linearFitXY, editCycleVerdict } from "../ui-audit/lib/editCycle.mjs";

const cyc = (n, f) => Array.from({ length: n }, (_, i) => ({ workMs: f.work(i), longTaskMs: f.lt ? f.lt(i) : 0, maxTaskMs: f.max ? f.max(i) : 0, heapMB: f.heap ? f.heap(i) : 30, domNodes: f.dom ? f.dom(i) : 1000 }));
const budget = JSON.parse(readFileSync(fileURLToPath(new URL("../ui-audit/perf-edit-cycle.budget.json", import.meta.url)), "utf8"));

describe("linearFitXY", () => {
  it("recovers an exact slope", () => { expect(linearFitXY([5, 7, 9, 11]).slope).toBeCloseTo(2, 9); });
  it("is flat on a constant", () => { expect(linearFitXY([3, 3, 3, 3]).slope).toBe(0); });
});

describe("editCycleVerdict", () => {
  it("VOID below four cycles — a slope needs a series, and a short run may not print a flat-looking pass", () => {
    const v = editCycleVerdict(cyc(3, { work: () => 100 }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines[0]).toMatch(/VOID/);
  });
  it("a flat series within budget passes", () => {
    const v = editCycleVerdict(cyc(10, { work: (i) => 1000 + (i % 2) * 20, lt: () => 400, max: () => 150 }), budget);
    expect(v.pass).toBe(true);
  });
  it("a FLAT but heavy series FAILS the level budget — a constant 7 s per cycle is the bug, not 'no growth'", () => {
    const v = editCycleVerdict(cyc(10, { work: () => 7000, lt: () => 400, max: () => 150 }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines.join("\n")).toMatch(/✗ median cycle work/);
  });
  it("long tasks have their own level budget", () => {
    const v = editCycleVerdict(cyc(10, { work: () => 1000, lt: () => 5500, max: () => 150 }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines.join("\n")).toMatch(/✗ median long-task/);
  });
  it("a series that gets heavier every cycle FAILS the work-slope budget — the owner's 'progressively slower'", () => {
    const v = editCycleVerdict(cyc(10, { work: (i) => 1000 + 300 * i, lt: () => 400, max: () => 150 }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines.join("\n")).toMatch(/✗ work slope/);
  });
  it("a heap that climbs per cycle after a forced GC FAILS the retained-heap budget", () => {
    const v = editCycleVerdict(cyc(10, { work: () => 1000, heap: (i) => 30 + 6 * i, max: () => 100 }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines.join("\n")).toMatch(/✗ retained-heap/);
  });
  it("one huge task FAILS the worst-task budget even when nothing trends", () => {
    const v = editCycleVerdict(cyc(10, { work: () => 1000, max: (i) => (i === 5 ? 900 : 100) }), budget);
    expect(v.pass).toBe(false);
    expect(v.lines.join("\n")).toMatch(/✗ worst single task/);
  });
});
