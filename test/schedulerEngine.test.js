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

describe("parsePreds — hostile predecessor strings never throw", () => {
  it("parses MS-Project syntax and ignores junk", () => {
    expect(E.parsePreds("2SS+3")).toEqual([{ id: 2, type: "SS", lag: 3 }]);
    expect(E.parsePreds("3FF-1d")).toEqual([{ id: 3, type: "FF", lag: -1 }]);
    expect(E.parsePreds("1,2SS")).toEqual([{ id: 1, type: "FS", lag: 0 }, { id: 2, type: "SS", lag: 0 }]);
    expect(E.parsePreds("abc")).toEqual([]);
    expect(E.parsePreds("2XX")).toEqual([]);
  });
  it("never throws on null/objects/numbers", () => {
    for (const x of [null, undefined, 42, {}, "", "-3", "2FS+"]) expect(() => E.parsePreds(x)).not.toThrow();
  });
});

describe("constrainedStartFrom — the four MS-Project conventions", () => {
  const pred = { start: "2026-06-22", end: "2026-06-26" }; // Mon–Fri
  it("FS = next business day after the predecessor's end", () => {
    expect(E.constrainedStartFrom(pred, { type: "FS", lag: 0 }, 1)).toBe("2026-06-29"); // skip weekend
  });
  it("SS = same start as the predecessor", () => {
    expect(E.constrainedStartFrom(pred, { type: "SS", lag: 0 }, 1)).toBe("2026-06-22");
  });
  it("unknown type falls back to FS and never throws", () => {
    expect(() => E.constrainedStartFrom(pred, { type: "ZZ", lag: 0 }, 1e9)).not.toThrow();
  });
});

describe("rollupParentDates — deep nesting stays fast and matches the reference", () => {
  // Reference = the ORIGINAL O(n²·depth) algorithm. The optimized version (child index +
  // deepest-first ordering) must produce byte-identical output on random hierarchies.
  const reference = (tasks) => {
    const map = {};
    tasks.forEach((t) => { map[t.id] = { ...t }; });
    const parentIds = new Set(tasks.filter((t) => t.parentId !== null).map((t) => t.parentId));
    if (!parentIds.size) return tasks;
    let changed = true;
    while (changed) {
      changed = false;
      parentIds.forEach((pid) => {
        if (!map[pid]) return;
        const children = Object.values(map).filter((t) => t.parentId === pid);
        if (!children.length) return;
        const vs = children.map((t) => t.start).filter(Boolean);
        const ve = children.map((t) => t.end).filter(Boolean);
        if (!vs.length || !ve.length) return;
        const ns = vs.reduce((a, b) => (a < b ? a : b));
        const ne = ve.reduce((a, b) => (a > b ? a : b));
        const nd = ns === ne && children.every((c) => c.duration === 0) ? 0 : Math.max(0, E.difBD(ns, ne) + 1);
        if (map[pid].start !== ns || map[pid].end !== ne || map[pid].duration !== nd) {
          map[pid] = { ...map[pid], start: ns, end: ne, duration: nd };
          changed = true;
        }
      });
    }
    return tasks.map((t) => map[t.id]);
  };

  const randHierarchy = (seed) => {
    let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const N = 30 + Math.floor(rnd() * 40);
    const tasks = [];
    for (let i = 1; i <= N; i++) {
      const parentId = i === 1 ? null : (rnd() < 0.6 ? 1 + Math.floor(rnd() * (i - 1)) : null);
      const d = Math.floor(rnd() * 28);
      const start = `2026-0${1 + Math.floor(rnd() * 9)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`;
      tasks.push({ id: i, name: "t" + i, start, end: E.calcEnd(start, d || 1), duration: d, predecessors: [], parentId });
    }
    return tasks;
  };

  it("optimized output is identical to the reference across 40 random trees", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const t = randHierarchy(seed);
      expect(E.rollupParentDates(t)).toEqual(reference(t));
    }
  });

  it("1000-deep nesting completes well under a second (was ~11s)", () => {
    const tasks = [];
    for (let i = 1; i <= 1000; i++) tasks.push({ id: i, name: "t" + i, start: "2026-06-22", end: `2026-06-${22 + (i % 7)}`, duration: 1, predecessors: [], parentId: i > 1 ? i - 1 : null });
    const t0 = performance.now();
    E.rollupParentDates(tasks);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("load pipeline — corrupt cloud/seed data must not crash the whole load", () => {
  // index.html composes ensureContacts(normalizeIds(ensureHolidays(normalizeToV6(d)))).
  // A throw here bricks the scheduler (the catch re-runs normalizeToV6 on the seed, so a
  // malformed seed hangs forever on the loader). Every hostile shape must degrade, not throw.
  const cases = [
    ["d = null", null],
    ["d = {}", {}],
    ["projects = null", { projects: null }],
    ["projects = array", { projects: [{ id: 1, name: "P", tasks: [] }] }],
    ["a project is null", { projects: { 1: null } }],
    ["a project is a string", { projects: { 1: "oops" } }],
    ["tasks missing", { projects: { 1: { id: 1, name: "P" } } }],
    ["tasks = null", { projects: { 1: { id: 1, name: "P", tasks: null } } }],
    ["tasks = object", { projects: { 1: { id: 1, name: "P", tasks: { 0: {} } } } }],
    ["tasks = number", { projects: { 1: { id: 1, name: "P", tasks: 5 } } }],
    ["a task is null", { projects: { 1: { id: 1, name: "P", tasks: [null] } } }],
    ["task = {}", { projects: { 1: { id: 1, name: "P", tasks: [{}] } } }],
    ["parentId cycle", { projects: { 1: { id: 1, name: "P", tasks: [{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }] } } }],
    ["contact name null", { projects: { 1: { id: 1, name: "P", tasks: [] } }, settings: { contacts: [{ id: 1, name: null }] } }],
    ["responsibleParty number", { projects: { 1: { id: 1, name: "P", tasks: [{ id: 1, responsibleParty: 42 }] } } }],
  ];
  for (const [label, doc] of cases) {
    it(`survives: ${label}`, () => { expect(() => E.loadPipeline(doc)).not.toThrow(); });
  }

  it("a well-formed doc loads with every project and task preserved", () => {
    const doc = { projects: { 1: { id: 1, name: "P", tasks: [
      { id: 1, name: "Parent", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null },
      { id: 2, name: "Child", start: "2026-06-23", end: "2026-06-23", duration: 1, predecessors: [{ id: 1, type: "FS", lag: 0 }], parentId: 1 },
    ] } } };
    const out = E.loadPipeline(doc);
    expect(Object.keys(out.projects)).toEqual(["1"]);
    expect(out.projects["1"].tasks).toHaveLength(2);
    expect(out.projects["1"].tasks.map(t => t.name)).toEqual(["Parent", "Child"]);
  });
});

describe("anti-drift: the guards still exist in the real source (public/sequence/index.html)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  it("addBD coerces + bounds its step count (MAX_BD_STEPS)", () => {
    expect(src).toMatch(/MAX_BD_STEPS/);
    expect(src).toMatch(/if \(isNaN\(d\)\) return s;/);
  });
  it("rollupParentDates guards orphans, indexes children, and orders deepest-first", () => {
    expect(src).toMatch(/if \(!map\[pid\]\) return;\s*\/\/ orphaned/);
    expect(src).toMatch(/childIdsByParent/);
    expect(src).toMatch(/depthOf\(b\) - depthOf\(a\)/);
  });
  it("parseFlexDate rejects non-finite parts and impossible calendar dates", () => {
    expect(src).toMatch(/!Number\.isFinite\(m\)/);
    expect(src).toMatch(/chk\.getMonth\(\) \+ 1 !== m/);
  });
  it("buildGanttSVG guards a nameless task and filters unparseable dates", () => {
    expect(src).toMatch(/a nameless task must not crash the exhibit/);
    expect(src).toMatch(/filter\(d=>d&&!isNaN\(pd\(d\)\)\)/);
  });
  it("normalizeToV6 guards corrupt projects/tasks on load", () => {
    expect(src).toMatch(/if \(!d \|\| typeof d !== "object"\) d = \{\};/);
    expect(src).toMatch(/const srcTasks = Array\.isArray\(proj\.tasks\) \? proj\.tasks : \[\];/);
  });
  it("ensureContacts coerces non-string contact names and responsibleParty", () => {
    expect(src).toMatch(/String\(c\?\.name \|\| ''\)\.toLowerCase\(\)/);
    expect(src).toMatch(/String\(\(t && t\.responsibleParty\) \|\| ''\)\.trim\(\)/);
  });
});
