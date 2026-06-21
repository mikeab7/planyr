import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

// Regression guard for the Scheduler date/cascade engine hardening (scheduling
// stress-test, 2026-06-21). The engine lives in public/sequence/index.html (compiled
// in-browser by Babel — not importable), so ui-audit/stress/scheduler-engine.mjs is a
// FAITHFUL COPY of those functions. The final `describe` block asserts the copy hasn't
// drifted from the real source by checking the guard lines are present in index.html.

const T = (id, o = {}) => ({ id, name: "t" + id, start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null, ...o });

describe("addBD / difBD — malformed input must not crash or hang", () => {
  it("invalid date strings return the input instead of throwing 'Invalid time value'", () => {
    for (const bad of ["garbage", "2026-13-40", "0000-00-00", "20260101", "not-a-date", "2026-1-1"]) {
      expect(() => E.addBD(bad, 1)).not.toThrow();
      expect(E.addBD(bad, 1)).toBe(bad);
    }
  });
  it("non-finite step counts (Infinity / NaN) are a no-op, not an infinite loop", () => {
    expect(E.addBD("2026-06-22", Infinity)).toBe("2026-06-22");
    expect(E.addBD("2026-06-22", -Infinity)).toBe("2026-06-22");
    expect(E.addBD("2026-06-22", NaN)).toBe("2026-06-22");
  });
  it("fractional durations truncate (2.5d advances 2 BDs, not 3)", () => {
    expect(E.addBD("2026-06-22", 2.5)).toBe(E.addBD("2026-06-22", 2));
  });
  it("absurd magnitudes are bounded — no multi-minute freeze", () => {
    const t0 = performance.now();
    E.calcEnd("2026-06-22", 1e9);
    E.difBD("2026-06-22", "9999-12-31");
    expect(performance.now() - t0).toBeLessThan(3000); // capped at MAX_BD_STEPS
  });
  it("normal business-day math is unchanged", () => {
    expect(E.addBD("2026-06-22", 1)).toBe("2026-06-23"); // Mon → Tue
    expect(E.addBD("2026-06-26", 1)).toBe("2026-06-29"); // Fri → Mon (skip weekend)
    expect(E.difBD("2026-06-22", "2026-06-29")).toBe(5); // one business week
  });
});

describe("cascadeDates — dependency-graph pathologies don't crash", () => {
  it("cycles, self-deps, and missing predecessors terminate cleanly", () => {
    expect(() => E.cascadeDates([T(1, { predecessors: [{ id: 1 }] })])).not.toThrow();
    expect(() => E.cascadeDates([T(1, { predecessors: [{ id: 2 }] }), T(2, { predecessors: [{ id: 1 }] })])).not.toThrow();
    expect(() => E.cascadeDates([T(1, { predecessors: [{ id: 999 }] })])).not.toThrow();
    expect(() => E.cascadeDates([T(1, { predecessors: [{ id: null }, { id: NaN }] })])).not.toThrow();
  });
  it("a simple FS chain advances by one business day", () => {
    const out = E.cascadeDates([T(1, { start: "2026-06-22", duration: 1 }), T(2, { duration: 1, predecessors: [{ id: 1, type: "FS" }] })]);
    expect(out.find((t) => t.id === 2).start).toBe("2026-06-23");
  });
});

describe("rollupParentDates — orphaned parentId must not crash the recompute", () => {
  it("a child pointing at a missing parent is skipped, not dereferenced", () => {
    expect(() => E.rollupParentDates([T(2, { parentId: 1, start: "2026-06-22", end: "2026-06-25" })])).not.toThrow();
  });
  it("parent-hierarchy cycles terminate", () => {
    expect(() => E.rollupParentDates([T(1, { parentId: 2 }), T(2, { parentId: 1 })])).not.toThrow();
    expect(() => E.rollupParentDates([T(1, { parentId: 1 })])).not.toThrow();
  });
  it("normal parent rolls up to the children's min start / max end", () => {
    const out = E.rollupParentDates([
      T(1, { parentId: null }),
      T(2, { parentId: 1, start: "2026-06-22", end: "2026-06-25" }),
      T(3, { parentId: 1, start: "2026-06-23", end: "2026-06-30" }),
    ]);
    const parent = out.find((t) => t.id === 1);
    expect(parent.start).toBe("2026-06-22");
    expect(parent.end).toBe("2026-06-30");
  });
});

describe("parseFlexDate — reject garbage and impossible calendar dates", () => {
  it("accepts real flexible dates", () => {
    expect(E.parseFlexDate("6/22/26")).toBe("2026-06-22");
    expect(E.parseFlexDate("6-22-2026")).toBe("2026-06-22");
    expect(E.parseFlexDate("2026-06-22")).toBe("2026-06-22");
  });
  it("rejects impossible dates instead of silently rolling them forward", () => {
    expect(E.parseFlexDate("2/31")).toBeNull();   // was → "2026-02-31" → rolled to Mar 3
    expect(E.parseFlexDate("13/45/2026")).toBeNull();
  });
  it("rejects NaN-producing junk instead of returning 'NaN-NaN-05'", () => {
    expect(E.parseFlexDate("-5/-5/-5")).toBeNull();
    expect(E.parseFlexDate("garbage")).toBeNull();
  });
});

describe("end-to-end: a hostile imported project survives the full recompute", () => {
  it("rollupParentDates(cascadeDates(tasks)) does not throw on mixed bad data", () => {
    const hostile = [
      { id: 1, name: "Parent", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null },
      { id: 2, name: "Child A", start: "bad-date", end: "", duration: 3, predecessors: [{ id: 1, type: "FS", lag: 0 }], parentId: 1 },
      { id: 3, name: "Orphan", start: "2026-06-22", end: "2026-06-25", duration: 2, predecessors: [], parentId: 77 },
      { id: 4, name: "Cyclic", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [{ id: 5, type: "FS" }], parentId: null },
      { id: 5, name: "Cyclic2", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [{ id: 4, type: "FS" }], parentId: null },
    ];
    expect(() => E.rollupParentDates(E.cascadeDates(hostile))).not.toThrow();
  });
});

describe("anti-drift: the guards still exist in the real source (public/sequence/index.html)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  it("addBD coerces + bounds its step count (MAX_BD_STEPS)", () => {
    expect(src).toMatch(/MAX_BD_STEPS/);
    expect(src).toMatch(/if \(isNaN\(d\)\) return s;/);
  });
  it("rollupParentDates guards orphaned parentIds", () => {
    expect(src).toMatch(/if \(!map\[pid\]\) return;\s*\/\/ orphaned/);
  });
  it("parseFlexDate rejects non-finite parts and impossible calendar dates", () => {
    expect(src).toMatch(/!Number\.isFinite\(m\)/);
    expect(src).toMatch(/chk\.getMonth\(\) \+ 1 !== m/);
  });
});
