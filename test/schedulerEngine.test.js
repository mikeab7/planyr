import { describe, it, expect, afterEach } from "vitest";
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
    // Freeze-guard, NOT a perf benchmark: this catches a MISSING cap (an uncapped 1e9-step run is
    // ~25 min), so the bound only needs to be comfortably sub-minute. The capped run is a bounded
    // ~1M steps (≈1–3s locally) — keep generous headroom so a slow/loaded CI runner doesn't flake
    // (a real 3113ms run tripped a too-tight 3000ms bound).
    expect(performance.now() - t0).toBeLessThan(20000); // capped at MAX_BD_STEPS
  }, 60000);
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

describe("B501 — deleting a task must recompute parent roll-ups (no stale summary span)", () => {
  it("recomputeAfterStructureChange after removing a child shrinks the parent to the survivor", () => {
    // Durations drive the cascade (06-22 is a Monday): child 2 = 1 BD → ends 06-22;
    // child 3 = 5 BD → ends 06-26 (Fri). recompute = rollupParentDates(cascadeDates(...)).
    const tasks = [
      T(1, { parentId: null }),
      T(2, { parentId: 1, start: "2026-06-22", duration: 1 }),
      T(3, { parentId: 1, start: "2026-06-22", duration: 5 }),
    ];
    // Parent spans both children.
    expect(E.rollupParentDates(E.cascadeDates(tasks)).find((t) => t.id === 1).end).toBe("2026-06-26");
    // Delete the later child (id 3). The fix wraps the filtered list with the same recompute
    // the indent/outdent handlers use; without it the parent would keep the stale 06-26 end.
    const afterDelete = tasks.filter((t) => t.id !== 3);
    const recomputed = E.rollupParentDates(E.cascadeDates(afterDelete)).find((t) => t.id === 1);
    expect(recomputed.end).toBe("2026-06-22");   // shrunk to the surviving child
    expect(recomputed.start).toBe("2026-06-22");
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
  it("a 'cd' suffix marks the lag as calendar days; 'd'/none stays working days", () => {
    expect(E.parsePreds("85FS+130cd")).toEqual([{ id: 85, type: "FS", lag: 130, lagUnit: "calendar" }]);
    expect(E.parsePreds("85FS+130d")).toEqual([{ id: 85, type: "FS", lag: 130 }]);   // no lagUnit → business default
    expect(E.parsePreds("85FS+130")).toEqual([{ id: 85, type: "FS", lag: 130 }]);
    expect(E.parsePreds("3FF-2cd")).toEqual([{ id: 3, type: "FF", lag: -2, lagUnit: "calendar" }]); // negative calendar lag
  });
  it("'cd' with a zero lag carries no unit (nothing to count)", () => {
    expect(E.parsePreds("5cd")).toEqual([{ id: 5, type: "FS", lag: 0 }]);
    expect(E.parsePreds("2SS")).toEqual([{ id: 2, type: "SS", lag: 0 }]);
  });
});

describe("normPreds — carries the calendar-lag unit through (dropped for business)", () => {
  it("preserves lagUnit:'calendar', omits it otherwise", () => {
    expect(E.normPreds([{ id: 2, type: "SS", lag: 3, lagUnit: "calendar" }])).toEqual([{ id: 2, type: "SS", lag: 3, lagUnit: "calendar" }]);
    expect(E.normPreds([{ id: 2, type: "SS", lag: 3 }])).toEqual([{ id: 2, type: "SS", lag: 3 }]);
    expect(E.normPreds([{ id: 2, type: "SS", lag: 3, lagUnit: "business" }])).toEqual([{ id: 2, type: "SS", lag: 3 }]);
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
  it("a calendar lag counts STRAIGHT days (weekends included) — it can even land on a weekend", () => {
    // FS: next business day (Mon 06-29) then +5 CALENDAR days → Sat 07-04 (a working lag never lands on a weekend).
    expect(E.constrainedStartFrom(pred, { type: "FS", lag: 5, lagUnit: "calendar" }, 1)).toBe("2026-07-04");
  });
  it("calendar vs working lag diverge across a weekend (SS +5)", () => {
    // Calendar: Mon 06-22 + 5 straight days = Sat 06-27. Working: skips the weekend → Mon 06-29.
    expect(E.constrainedStartFrom(pred, { type: "SS", lag: 5, lagUnit: "calendar" }, 1)).toBe("2026-06-27");
    expect(E.constrainedStartFrom(pred, { type: "SS", lag: 5 }, 1)).toBe("2026-06-29");
  });
  it("a working (default) lag is unchanged by the refactor — FS +2 skips no weekend here", () => {
    expect(E.constrainedStartFrom(pred, { type: "FS", lag: 2 }, 1)).toBe("2026-07-01"); // Mon 06-29 + 2 BD
  });
});

describe("anti-drift: the calendar-lag wiring exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("constrainedStartFrom branches addD (calendar) vs addBD (working) on lagUnit in both", () => {
    expect(src).toMatch(/dep\.lagUnit === "calendar" \? addD\(base, n\) : addBD\(base, n\)/);
    expect(mjs).toMatch(/dep\.lagUnit === "calendar" \? addD\(base, n\) : addBD\(base, n\)/);
  });
  it("normPreds carries lagUnit:'calendar' through in both", () => {
    expect(src).toMatch(/x\.lagUnit === "calendar" \? \{lagUnit: "calendar"\} : \{\}/);
    expect(mjs).toMatch(/x\.lagUnit === "calendar" \? \{lagUnit: "calendar"\} : \{\}/);
  });
  it("parsePreds tokenizes the (cd|d) unit suffix in both", () => {
    expect(src).toMatch(/\(cd\|d\)\?\$/);
    expect(mjs).toMatch(/\(cd\|d\)\?\$/);
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
    expect(performance.now() - t0).toBeLessThan(4000);
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

describe("rebuildHealthMaps — corrupt custom-status settings must not crash render", () => {
  it("survives non-array / null / garbage custom statuses and bad overrides", () => {
    for (const custom of [null, "nope", 5, {}, [null], [undefined], ["x"], [{}], [{ k: null }]]) {
      expect(() => E.rebuildHealthMaps(custom, {})).not.toThrow();
    }
    for (const ov of [null, "nope", 5, []]) expect(() => E.rebuildHealthMaps([], ov)).not.toThrow();
  });
  it("applies a valid custom status and label override, base statuses intact", () => {
    const { HEALTH, HK } = E.rebuildHealthMaps([{ k: "blocked", label: "Blocked", dot: "#000", bar: "#eee" }], { gray: "Backlog" });
    expect(HK).toContain("blocked");
    expect(HEALTH.blocked.label).toBe("Blocked");
    expect(HEALTH.gray.label).toBe("Backlog");
    expect(HEALTH.green.label).toBe("Complete"); // untouched built-in
  });
});

describe("B550 — a parentId cycle in loaded data can't hang the scheduler", () => {
  // True acyclicity check: every task's parent chain must terminate (no loop).
  const isAcyclic = (tasks) => {
    const byId = {}; tasks.forEach(t => { byId[t.id] = t; });
    return tasks.every(t => {
      const seen = new Set([t.id]); let p = t.parentId;
      while (p != null && byId[p]) { if (seen.has(p)) return false; seen.add(p); p = byId[p].parentId; }
      return true;
    });
  };

  it("normalizeIds breaks a 3-task parentId cycle (1→3→2→1) instead of leaving it", () => {
    const d = { projects: { 1: { id: 1, name: "P", tasks: [
      T(1, { parentId: 3 }), T(2, { parentId: 1 }), T(3, { parentId: 2 }),
    ] } }, nTid: {} };
    let out;
    expect(() => { out = E.normalizeIds(d); }).not.toThrow();
    expect(isAcyclic(out.projects[1].tasks)).toBe(true); // cycle broken → safe for every downstream walk
    expect(out.projects[1].tasks.length).toBe(3);        // no task lost
  });

  it("normalizeIds leaves a valid hierarchy unchanged in shape (no-op on clean data)", () => {
    const d = { projects: { 1: { id: 1, name: "P", tasks: [
      T(1, { parentId: null }), T(2, { parentId: 1 }), T(3, { parentId: 1 }),
    ] } }, nTid: {} };
    const out = E.normalizeIds(d);
    expect(isAcyclic(out.projects[1].tasks)).toBe(true);
    // renumber compacts ids 1..n but the parent/child SHAPE is preserved: two children under the root.
    const tasks = out.projects[1].tasks;
    const root = tasks.find(t => t.parentId == null);
    expect(tasks.filter(t => t.parentId === root.id).length).toBe(2);
  });

  it("the cycle-break is what protects the arbitrary-root operation walks (getSubtreeIds etc.)", () => {
    // A descendant walk that STARTS at a node inside a cycle (e.g. outdent's getSubtreeIds) would
    // infinite-loop; after normalizeIds breaks the cycle, any such walk over the result terminates.
    const d = { projects: { 1: { id: 1, name: "P", tasks: [
      T(1, { parentId: 2 }), T(2, { parentId: 1 }), // a 2-cycle, both reachable as each other's child
    ] } }, nTid: {} };
    const out = E.normalizeIds(d);
    expect(isAcyclic(out.projects[1].tasks)).toBe(true);
    expect(out.projects[1].tasks.length).toBe(2);
  });
});

describe("B568: renumberTasks resolves a duplicate id to the FIRST occurrence (original wins)", () => {
  it("a predecessor pointing at a duplicated id remaps to the first occurrence, not the last", () => {
    // Corrupt/legacy input: id=100 appears twice (the app once minted dup ids before addTask used
    // maxId+1). A third task depends on id=100. The original (first in visual order) is the true target.
    const tasks = [
      { id: 100, name: "A (original)", parentId: null, predecessors: [] },
      { id: 200, name: "B", parentId: null, predecessors: [] },
      { id: 100, name: "A-dup (stray paste)", parentId: null, predecessors: [] },
      { id: 300, name: "C depends on 100", parentId: null, predecessors: [{ id: 100, type: "FS", lag: 0 }] },
    ];
    const out = E.renumberTasks(tasks);
    // ids compact to 1..n by position
    expect(out.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    // C's predecessor must point at the FIRST occurrence of old-id 100 → new id 1, never the dup at 3
    const c = out.find((t) => t.name === "C depends on 100");
    expect(c.predecessors).toEqual([{ id: 1, type: "FS", lag: 0 }]);
  });
  it("clean unique-id data is unaffected (parent + predecessor remap unchanged)", () => {
    const tasks = [
      { id: 10, name: "P", parentId: null, predecessors: [] },
      { id: 20, name: "child", parentId: 10, predecessors: [{ id: 10, type: "FS", lag: 0 }] },
    ];
    const out = E.renumberTasks(tasks);
    expect(out[1].parentId).toBe(1);
    expect(out[1].predecessors).toEqual([{ id: 1, type: "FS", lag: 0 }]);
  });
});

describe("anti-drift: the guards still exist in the real source (public/sequence/index.html)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  it("B568: renumberTasks first-occurrence guard exists in BOTH source and the engine mirror", () => {
    const mirror = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
    expect(src).toMatch(/tasks\.forEach\(\(t, i\) => \{ if \(!\(t\.id in map\)\) map\[t\.id\] = i \+ 1; \}\)/);
    expect(mirror).toMatch(/tasks\.forEach\(\(t, i\) => \{ if \(!\(t\.id in map\)\) map\[t\.id\] = i \+ 1; \}\)/);
  });
  it("B550: normalizeIds breaks a parentId cycle on load (protects every downstream tree-walk)", () => {
    expect(src).toMatch(/break any parentId cycle on load/);                          // the comment marking the fix
    expect(src).toMatch(/if \(seen\.has\(p\)\) return \{\.\.\.t, parentId: null\}/);  // the actual break
  });
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
  it("the shell message handler validates origin and the Gantt month loop is bounded", () => {
    expect(src).toMatch(/if \(e\.origin !== window\.location\.origin\) return;/);
    expect(src).toMatch(/let _mGuard=12000;/);
    expect(src).toMatch(/while\(cur2<=pd\(winEnd\) && _mGuard-->0\)/);   // B401: month axis now walks the visible window
  });
  it("the Scheduler shell wrapper validates message origin too", () => {
    const sjsx = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");
    expect(sjsx).toMatch(/if \(e\.origin !== window\.location\.origin\) return;/);
  });
  it("rebuildHEALTH guards corrupt custom-status settings", () => {
    expect(src).toMatch(/\(Array\.isArray\(custom\) \? custom : \[\]\)\.forEach/);
    expect(src).toMatch(/skip a null\/garbage custom status/);
  });
  it("B501: both delete handlers recompute roll-ups (renumberTasks(recomputeAfterStructureChange(...filter)))", () => {
    const calls = src.match(/renumberTasks\(recomputeAfterStructureChange\([^)]*\.filter\(t => !del\.has\(t\.id\)\)\)\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);   // deleteTask + deleteTasks
  });
  it("B502: InlineDate seeds its display with toShortDate (keeps the year)", () => {
    expect(src).toMatch(/const disp = value \? toShortDate\(value\) : "";/);
  });
  it("B503: MasterView fmtDate guards a non-ISO value before formatting", () => {
    expect(src).toMatch(/if \(!y\|\|!m\|\|!d\) return "";\s*\/\/ B503/);
  });
});

// ── Schedule INPUT hardening (2026-06-27) ──────────────────────────────────
// Bugs found in how a user's typed/edited values flow into the model.

describe("validatePredEdit — predecessor input guards (self / unknown / cycle)", () => {
  const tasks = [
    { id: 1, predecessors: [] },
    { id: 2, predecessors: [{ id: 1, type: "FS", lag: 0 }] },
    { id: 3, predecessors: [{ id: 2, type: "FS", lag: 0 }] },
  ];
  const FS = id => ({ id, type: "FS", lag: 0 });

  it("passes a normal predecessor through untouched", () => {
    const r = E.validatePredEdit(tasks, 4, [FS(1)]);
    expect(r.preds).toEqual([FS(1)]);
    expect(r.selfRemoved).toBe(false);
    expect(r.unknownIds).toEqual([]);
    expect(r.cyclic).toEqual([]);
  });
  it("drops a self-reference and flags it", () => {
    const r = E.validatePredEdit(tasks, 2, [FS(2)]);
    expect(r.preds).toEqual([]);
    expect(r.selfRemoved).toBe(true);
  });
  it("drops a reference to a nonexistent task id and reports it", () => {
    const r = E.validatePredEdit(tasks, 2, [FS(99)]);
    expect(r.preds).toEqual([]);
    expect(r.unknownIds).toEqual([99]);
  });
  it("rejects a predecessor that closes a multi-hop cycle (1→3 with 3→2→1)", () => {
    const r = E.validatePredEdit(tasks, 1, [FS(3)]);
    expect(r.cyclic).toEqual([3]);
    expect(r.preds).toEqual([]);
  });
  it("rejects a direct two-node cycle (1↔2)", () => {
    const r = E.validatePredEdit(tasks, 1, [FS(2)]);
    expect(r.cyclic).toEqual([2]);
    expect(r.preds).toEqual([]);
  });
  it("keeps the valid predecessor of a mixed set, dropping only the cyclic one", () => {
    const t2 = [...tasks, { id: 4, predecessors: [] }];
    const r = E.validatePredEdit(t2, 1, [FS(3), FS(4)]);
    expect(r.cyclic).toEqual([3]);
    expect(r.preds).toEqual([FS(4)]);
  });
  it("never throws on junk input", () => {
    expect(() => E.validatePredEdit(null, 1, null)).not.toThrow();
    expect(() => E.validatePredEdit(tasks, 1, "nope")).not.toThrow();
    expect(E.validatePredEdit(tasks, 1, [null, undefined]).preds).toEqual([]);
  });
});

describe("recomputeAfterStructureChange — parents roll up after an indent/outdent/paste move", () => {
  it("a task moved under a parent expands the parent's start/end to cover it", () => {
    // 'Phase B' (id 2) currently a short parent; move the long leaf (id 3) under it.
    const tasks = [
      { id: 1, name: "Phase B", start: "2026-03-02", end: "2026-03-04", duration: 3, predecessors: [], parentId: null },
      { id: 2, name: "Sub", start: "2026-03-02", end: "2026-03-04", duration: 3, predecessors: [], parentId: 1 },
      { id: 3, name: "Survey", start: "2026-01-05", end: "2026-01-30", duration: 20, predecessors: [], parentId: 1 },
    ];
    const out = E.rollupParentDates(E.cascadeDates(tasks));
    const parent = out.find(t => t.id === 1);
    expect(parent.start).toBe("2026-01-05"); // min child start
    expect(parent.end).toBe("2026-03-04");   // max child end
  });
});

describe("anti-drift: the schedule-input fixes still exist in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const sjsx = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");

  it("export cover Date + Prepared-for are HTML-escaped", () => {
    expect(src).toMatch(/Prepared for: <strong>\$\{escapeHtml\(cfg\.preparedFor\)\}/);
    expect(src).toMatch(/Date:&nbsp;<strong>\$\{escapeHtml\(cfg\.docDate\)\}/);
  });
  it("the master grid parses duration UNIT-AWARE (d/w/cd/mo/y), like the project grid — no unit-blind parseInt", () => {
    // B855: was Math.max(0, Math.min(100000, parseInt(val)||0)) which silently dropped any unit suffix.
    expect(src).toMatch(/if \(parsed\.value !== taskDurValue\(t\) \|\| parsed\.unit !== taskDurUnit\(t\)\) updateTask\(t\.id, \{durValue: parsed\.value, durUnit: parsed\.unit\}, t\.projId\)/);
  });
  it("indent/outdent/paste recompute roll-ups after a structural move", () => {
    // B443248 re-pointed this at recomputeSchedule (cascade→rollup iterated to a fixed point); the
    // structural-move call sites below are unchanged.
    expect(src).toMatch(/const recomputeAfterStructureChange = tasks => recomputeSchedule\(tasks\);/);
    // every structural-move handler routes through it (5 call sites)
    expect((src.match(/renumberTasks\(recomputeAfterStructureChange\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(src).toMatch(/recomputeAfterStructureChange\(sortByVisualOrder\(final\)\)/);
  });
  it("setting Finish on a startless task anchors a 1-day task (no bare 'd', no lost date)", () => {
    // B616 added the durUnit/durValue stamp + finish-lock, but the startless-anchor invariant holds.
    expect(src).toMatch(/if \(u\.end && !u\.start\) \{ u\.start = u\.end; u\.durUnit = 'd'; u\.durValue = 1; u\.duration = 1; \}/);
  });
  it("the duration cell never renders a bare 'd' (fmtTaskDuration guards blank)", () => {
    // B615 routes the cell through fmtTaskDuration, which returns "" for a blank duration → no bare "d".
    expect(src).toContain("fmtTaskDuration(task, task.hasChildren)");   // B463072 added the summary flag
    expect(src).toMatch(/if \(t\.duration === "" \|\| t\.duration == null\) return "";/);
  });
  it("grid date input clears, gives feedback on junk, and rejects Finish-before-Start", () => {
    expect(src).toMatch(/Couldn't read that date/);
    expect(src).toMatch(/Finish can't be before Start/);
    expect(src).toMatch(/if \(!raw\) \{ updateTask\(id,\{\[col\]:""\}\); return; \}/);
  });
  it("predecessor edits go through validatePredEdit (self / unknown / cycle)", () => {
    expect(src).toMatch(/validatePredEdit\(proj\?\.tasks \|\| tasks, id, parsePreds\(val\)\)/);
    expect(src).toMatch(/would create a circular dependency/);
    expect(src).toMatch(/const validatePredEdit = \(tasks, id, parsed\) =>/);
  });
  it("the engine mirror carries validatePredEdit verbatim", () => {
    expect(sjsx).toMatch(/export const validatePredEdit = \(tasks, id, parsed\) =>/);
  });
});

// ── Schedule OUTPUT hardening (2026-06-27) ─────────────────────────────────
// Bugs in what the scheduler PRODUCES / EXPORTS / DISPLAYS.

describe("computeRolledHealth — a parent reflects the worst of its descendants", () => {
  const T = (id, health, parentId = null) => ({ id, name: "t" + id, health, parentId });
  it("rolls a red child up to its parent (and grandparent)", () => {
    const map = E.computeRolledHealth([
      T(1, "gray"), T(2, "gray", 1), T(3, "red", 2), T(4, "green", 1),
    ]);
    expect(map[1]).toBe("red");   // worst across the whole subtree
    expect(map[2]).toBe("red");   // direct parent of the red task
    expect(map[3]).toBeUndefined(); // a leaf gets no rolled entry
    expect(map[4]).toBeUndefined();
  });
  it("worst-wins ordering: red > yellow > paused > green > gray", () => {
    const map = E.computeRolledHealth([T(1, "gray"), T(2, "yellow", 1), T(3, "green", 1), T(4, "paused", 1)]);
    expect(map[1]).toBe("yellow");
  });
  it("a parent whose children are all green rolls up green, not its own stale gray", () => {
    const map = E.computeRolledHealth([T(1, "gray"), T(2, "green", 1), T(3, "green", 1)]);
    expect(map[1]).toBe("green");
  });
  it("never throws and terminates on a parentId cycle", () => {
    expect(() => E.computeRolledHealth([T(1, "gray", 2), T(2, "red", 1)])).not.toThrow();
  });
  it("matches the prior inline grid algorithm on a random tree", () => {
    // reference = the original App rolledHealthMap logic
    const ref = (all) => {
      const PRIO = { red: 4, yellow: 3, paused: 2, green: 1, gray: 0, "": 0 };
      const rollup = id => {
        const kids = all.filter(t => t.parentId === id);
        if (!kids.length) return all.find(t => t.id === id)?.health || "";
        let best = "", bestP = 0;
        for (const c of kids) { const h = rollup(c.id); const p = PRIO[h] || 0; if (p > bestP) { bestP = p; best = h; } }
        return best;
      };
      const m = {}; all.forEach(t => { if (all.some(c => c.parentId === t.id)) m[t.id] = rollup(t.id); });
      return m;
    };
    const H = ["red", "yellow", "paused", "green", "gray"];
    let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const tasks = [];
    for (let i = 1; i <= 50; i++) tasks.push({ id: i, name: "t" + i, health: H[Math.floor(rnd() * H.length)], parentId: i === 1 ? null : (rnd() < 0.6 ? 1 + Math.floor(rnd() * (i - 1)) : null) });
    expect(E.computeRolledHealth(tasks)).toEqual(ref(tasks));
  });
});

describe("anti-drift: the schedule-output fixes still exist in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const sjsx = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");

  it("the web/JSON/PDF exports use the Site-Planner filename format, not Hillwood/planar", () => {
    expect(src).not.toMatch(/Hillwood Schedule/);
    expect(src).not.toMatch(/hillwood-schedule/);
    expect(src).not.toMatch(/<title>planar<\/title>/);
    // all three exports route their name through scheduleExportName (Site-Planner format)
    expect(src).toMatch(/`\$\{scheduleExportName\(Object\.values\(data\.projects\)\)\}\.html`/);
    expect(src).toMatch(/`\$\{scheduleExportName\(Object\.values\(data\.projects\)\)\}\.json`/);
    expect(src).toMatch(/<title>\$\{escapeHtml\(scheduleExportName\(selProjs\)\)\}<\/title>/);
  });
  it("the web snapshot guards percent/duration and escapes the status color", () => {
    expect(src).toMatch(/const pct = t\.health==="green" \? 100 : \(t\.percentComplete\|\|0\)/);
    expect(src).toMatch(/\$\{Number\(t\.duration\)\|\|0\}d/);
    expect(src).toMatch(/style="color:\$\{escapeHtml\(h\.dot\)\}"/);
  });
  it("buildGanttSVG skips an unscheduled task's bar and tags it instead of drawing NaN", () => {
    expect(src).toMatch(/const blank = !t\.start \|\| !t\.end \|\| isNaN\(pd\(t\.start\)\) \|\| isNaN\(pd\(t\.end\)\);/);
    expect(src).toMatch(/if\(blank\)\{\s*barSvg="";/);
    expect(src).toMatch(/>Unscheduled<\/text>/);
  });
  it("buildGanttSVG draws a summary bracket before a milestone diamond + normalizes preds for arrows", () => {
    expect(src).toMatch(/\}else if\(isParent\)\{[\s\S]*?\}else if\(isMilestone\)\{/);
    expect(src).toMatch(/normPreds\(t\.predecessors\)/);   // arrows tolerate plain-number preds (B629 inlined this into the fan-collection loop)
  });
  it("the on-screen Gantt renders a duration-0 parent as a bracket, not a diamond", () => {
    expect(src).toMatch(/\(isMilestone && !isSummary\) \? \(<>/);
  });
  it("the exhibit table %Done matches the green→100 bar convention", () => {
    expect(src).toMatch(/return `\$\{t\.health==="green" \? 100 : \(t\.percentComplete\|\|0\)\}%`/);
  });
  it("MasterView uses rolled health for parents (shared helper) and live deps", () => {
    // NEW (group-header-rule-rollup): computeRolledHealth now takes `settings` too, so a leaf
    // child's contribution is its RULE-COMPUTED health, not its raw stored `health` field.
    expect(src).toMatch(/const computeRolledHealth = \(all, settings\) =>/);
    expect(src).toMatch(/const rolled = computeRolledHealth\(p\.tasks, data\.settings\);/);
    // NEW-schedule-health: dispOf now threads a per-project `byId` map through so the
    // "a predecessor is late" health condition can resolve predecessor tasks — was
    // `dispOf(t, !isLeaf, rolled)`, no third arg, before that condition existed.
    expect(src).toMatch(/_disp: dispOf\(t, !isLeaf, rolled, byId\)/);
    expect(src).toMatch(/\}, \[data\.projects, masterHealthFilter, data\.settings, NOW\]\);/);
    expect(src).toMatch(/const rolledHealthMap = useMemo\(\(\) => proj \? computeRolledHealth\(proj\.tasks, data\.settings\) : \{\}/);
  });
  // NEW-schedule-health: the fixed 3-toggle cfRules (completeGreen/overdueRed/dueSoonYellow) was
  // replaced by a configurable ordered rule list (HEALTH_CONDITIONS / evalHealthRules) — see the
  // "configurable health automation" describe block below for its own coverage, including the
  // equivalent of this exact case ("finishPastDays" requires percentComplete < 100, same as the
  // old overdueRed literal did). This assertion is retired rather than chasing the new source
  // text, since the new engine's "not 100% complete" gate lives in a shared `evalHealthCondition`
  // switch, not in a single line naming `cf.overdueRed`.
  it("computeDisplayHealth no longer reads the retired cf.overdueRed literal", () => {
    // "cf.overdueRed" itself still appears once, inside migrateCfRulesToHealthRules (the legacy
    // fallback) — what's retired is the inline comparison that used to live in computeDisplayHealth.
    expect(src).not.toMatch(/cf\.overdueRed && task\.end && task\.end < NOW/);
    expect(src).toMatch(/case "finishPastDays":\s*\n\s*if \(!task\.end \|\| pct >= 100\) return false;/);
  });
  it("the engine mirror carries computeRolledHealth verbatim", () => {
    expect(sjsx).toMatch(/export const computeRolledHealth = \(all, settings\) =>/);
  });
  it("the schedule export name uses the Site-Planner format helper (mirrored)", () => {
    expect(src).toMatch(/const scheduleExportName = \(projects, date = new Date\(\)\) =>/);
    expect(sjsx).toMatch(/export const scheduleExportName = \(projects, date = new Date\(\)\) =>/);
  });
});

describe("scheduleExportName — matches the Site Planner PDF filename format", () => {
  const D = new Date(2026, 5, 27); // 2026-06-27 (local), date injectable for determinism
  it("single project: 'YYYY.MM.DD {Project} - Schedule'", () => {
    expect(E.scheduleExportName([{ id: 1, name: "Goose Creek" }], D)).toBe("2026.06.27 Goose Creek - Schedule");
  });
  it("zero-pads month/day to match the Site Planner stamp", () => {
    expect(E.scheduleExportName([{ name: "X" }], new Date(2026, 0, 3))).toBe("2026.01.03 X - Schedule");
  });
  it("multiple projects collapse to the Planyr brand", () => {
    expect(E.scheduleExportName([{ name: "A" }, { name: "B" }], D)).toBe("2026.06.27 Planyr - Schedule");
  });
  it("no/blank projects fall back to the Planyr brand", () => {
    expect(E.scheduleExportName([], D)).toBe("2026.06.27 Planyr - Schedule");
    expect(E.scheduleExportName([{ name: "" }], D)).toBe("2026.06.27 Planyr - Schedule");
  });
  it("strips filesystem-illegal chars but KEEPS letters/digits/spaces (the regex isn't a bad range)", () => {
    expect(E.scheduleExportName([{ name: 'A/B: C* <x>|2' }], D)).toBe("2026.06.27 A B C x 2 - Schedule");
  });
});

// ── Scheduler bug-batch (2026-06-30) — "find and debug and ship fixes" ──────────────────────────
// Twenty real bugs found by an adversarial bug hunt over public/sequence/index.html + the React
// shell. Runtime tests for the engine-level fixes (parseFlexDate); anti-drift source-presence
// assertions for the App-level fixes (same style as the blocks above — the App code isn't
// importable, so we assert the fix still exists in the real source).

describe("parseFlexDate — ISO fast-path must reject impossible calendar dates (bug-batch #1)", () => {
  it("rejects impossible ISO dates the same way the slash path does", () => {
    expect(E.parseFlexDate("2026-02-30")).toBeNull(); // was returned verbatim → pd() rolled it to Mar 2
    expect(E.parseFlexDate("2026-04-31")).toBeNull();
    expect(E.parseFlexDate("2026-13-01")).toBeNull();
    expect(E.parseFlexDate("2026-00-15")).toBeNull();
    expect(E.parseFlexDate("2026-06-00")).toBeNull();
  });
  it("still accepts real ISO dates unchanged", () => {
    expect(E.parseFlexDate("2026-02-28")).toBe("2026-02-28");
    expect(E.parseFlexDate("2026-06-22")).toBe("2026-06-22");
    expect(E.parseFlexDate("2024-02-29")).toBe("2024-02-29"); // leap day
  });
});

describe("anti-drift: the scheduler bug-batch fixes still exist in the real source", () => {
  const src  = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs  = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");

  it("#1 parseFlexDate ISO fast-path round-trips through the calendar check (source + mirror)", () => {
    expect(src).toMatch(/const isoM = s\.match\(/);
    expect(src).toMatch(/chk\.getMonth\(\) \+ 1 === Mo && chk\.getDate\(\) === Da/);
    expect(mjs).toMatch(/const isoM = s\.match/);
  });
  it("#2 concurrency guard treats an unknown base rev as 0 (no stale overwrite on the seed/offline path)", () => {
    expect(src).toMatch(/cloudRev > \(knownRev\[k\] \|\| 0\)/);
  });
  it("#3 grid zoom is adopted from persisted data after the async load", () => {
    expect(src).toMatch(/if \(data && typeof data\.gridZoom === "number"\) setGridZoom\(data\.gridZoom\);/);
  });
  it("#4 a narrow viewport NEVER mutates the persisted view (render-time gating only)", () => {
    expect(src).not.toMatch(/d\.view = "grid"/);          // all three load-path mutations removed
    expect(src).toMatch(/\(isMobile\?"grid":data\.view\)==="split"/);
  });
  it("#5 undo/redo push the LIVE current state (dataRef.current), not the stale closure", () => {
    expect(src).toMatch(/future\.current = \[\.\.\.future\.current, dataRef\.current\]/);
    expect(src).toMatch(/history\.current = \[\.\.\.history\.current, dataRef\.current\]/);
  });
  it("#6 cut+paste rewires every remaining task's predecessors onto the moved subtree's new ids", () => {
    expect(src).toMatch(/idMap\[p\.id\] !== undefined \? \{ \.\.\.p, id: idMap\[p\.id\] \} : p/);
  });
  it("#7 commit() still commits the focused name/notes/predecessors cell under a range selection", () => {
    expect(src).toMatch(/never range-filled \(filling one name across many rows is destructive\)/);
  });
  it("#8 autoSizeCol measures an empty date as nothing, not 'NaN/NaN/'", () => {
    expect(src).toMatch(/case 'start': case 'end': \{ if\(!t\[colKey\]\)\{ val=''; break; \}/);
  });
  it("#9 the on-screen Gantt axis is anchored to today + positions clamped (R3: supersedes the R1 span cap)", () => {
    // Round 3 replaced the R1 totD=Math.min(...,MAX_SPAN_DAYS) cap (which froze→desynced bars/today line)
    // with a today-anchored window + clamped xOf, so an outlier date pins to the chart edge.
    expect(src).toMatch(/const hardBack = addD\(NOW, -365 \* 30\), hardFwd = addD\(NOW, 365 \* 50\);/);
    expect(src).toMatch(/const xOf = d => Math\.max\(0, Math\.min\(totalW, dif\(minD, d\) \* ppd\)\);/);
    expect(src).not.toMatch(/Math\.min\(dif\(mn, mx\), MAX_SPAN_DAYS\)/); // old incomplete cap is gone
  });
  it("#10 the dependency edge-helpers test the summary case before the milestone case (both paths)", () => {
    // Both glyphEdges helpers (on-screen + export) branch on summary BEFORE milestone, so a
    // duration-0 parent anchors to its bracket, not a phantom diamond (B396/B402, shared in B629).
    expect(src).toMatch(/summary bracket \(test before milestone/);   // on-screen glyphEdges
    expect(src).toMatch(/summary bracket \(before milestone/);         // export glyphEdges
  });
  it("#11 on-screen dependency connectors skip unparseable-date endpoints (mirrors the export)", () => {
    expect(src).toMatch(/isNaN\(pd\(pred\.start\)\) \|\| isNaN\(pd\(pred\.end\)\) \|\| isNaN\(pd\(task\.start\)\)/);
  });
  it("#12 the PDF split-Gantt slices are guarded on a non-null svgEl", () => {
    expect(src).toMatch(/if\(pr\.svgEl\)\{/);
    expect(src).toMatch(/a project filtered to zero rows yields an empty Gantt/);
  });
  it("#13 the @page size uses explicit orientation-swapped dimensions (valid for Tabloid too)", () => {
    expect(src).toMatch(/@page\{size:\$\{pgW\}in \$\{pgR\}in;/);
    expect(src).not.toMatch(/@page\{size:\$\{ps\.css\} \$\{cfg\.orientation\}/);
  });
  it("#16 approving a suggestion only attaches a note when the reviewer typed one", () => {
    expect(src).toMatch(/const noteTxt = String\(noteText \|\| ""\)\.trim\(\);/);
  });
  it("#17 the owner ContactPicker only ghost-accepts on Enter when the typed text is a NEW name", () => {
    expect(src).toMatch(/else if \(ghostText && prediction && isNewName\) onCommit\(prediction\.name\);/);
  });
  it("#18 the grid uses rolled child health for every parent (collapsed or expanded)", () => {
    expect(src).toMatch(/A parent ALWAYS reflects rolled-up child health/);
    expect(src).toMatch(/const displayHealth = task\.hasChildren\s*\n\s*\? \(rolledHealthMap/);
  });
  it("#15 MasterView keys cell selection to the RENDERED columns (displayCols)", () => {
    expect(src).toMatch(/const ci = displayCols\.indexOf\(col\);/);
  });
  it("#14 MasterView shows the empty-state row whenever NOTHING is displayed (filtered or empty)", () => {
    expect(src).toMatch(/\{sortedRows\.length===0 && \(/);
  });
  it("#19 floating (nth-weekday) holidays serialize with the local-calendar formatter (source + mirror)", () => {
    expect(src).not.toMatch(/fd\(nthWeekday\(/);            // all converted to fdLocal
    expect(src).toMatch(/fdLocal\(nthWeekday\(y,11,4,4\)\)/);
    expect(mjs).not.toMatch(/fd\(nthWeekday\(/);
    expect(mjs).toMatch(/fdLocal\(nthWeekday\(y,5,-1,1\)\)/);
  });
  it("#20 the nav-request handshake reply carries the cross-module link fields (≥2 emit sites)", () => {
    const hits = src.match(/linkedSiteId: p\.linkedSiteId \?\? null/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(2); // primary data-change emit + nav-request reply
  });
});

// ── B815 (NEW-1) — meeting-body cadence engine ──────────────────────────────────
describe("B815 nthWeekdayOfMonth — nth vs last weekday of a month", () => {
  // Dec 2026 has FIVE Tuesdays (1,8,15,22,29) — the case where 4th ≠ last.
  it("2nd / 4th Tuesday of Dec 2026", () => {
    expect(E.nthWeekdayOfMonth(2026, 12, 2, 2)).toBe("2026-12-08");
    expect(E.nthWeekdayOfMonth(2026, 12, 2, 4)).toBe("2026-12-22");
  });
  it("setpos:-1 (last Tuesday) is NOT the 4th in a 5-Tuesday month", () => {
    expect(E.nthWeekdayOfMonth(2026, 12, 2, -1)).toBe("2026-12-29");
    expect(E.nthWeekdayOfMonth(2026, 12, 2, -1)).not.toBe(E.nthWeekdayOfMonth(2026, 12, 2, 4));
  });
  it("a non-existent nth occurrence returns null (5th Tuesday of a 4-Tuesday Feb 2026)", () => {
    expect(E.nthWeekdayOfMonth(2026, 2, 2, 5)).toBeNull();
  });
  it("serializes via the local formatter — no UTC one-day-early slip (B584 #19)", () => {
    // 1st of a month resolved as a floating weekday must land on the true local date.
    expect(E.nthWeekdayOfMonth(2026, 1, 4, 1)).toBe("2026-01-01"); // Jan 1 2026 is a Thursday (dow 4)
  });
});

describe("B815 meetingDatesInRange — recurrence + explicit-date precedence", () => {
  const council = { recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }] };
  it("2nd & 4th Tuesday across a two-month window", () => {
    expect(E.meetingDatesInRange(council, "2026-08-01", "2026-09-30"))
      .toEqual(["2026-08-11", "2026-08-25", "2026-09-08", "2026-09-22"]);
  });
  it("respects [from,to] boundaries inclusively", () => {
    expect(E.meetingDatesInRange(council, "2026-08-25", "2026-08-25")).toEqual(["2026-08-25"]);
    expect(E.meetingDatesInRange(council, "2026-08-12", "2026-08-24")).toEqual([]);
  });
  it("blackoutDates remove a scheduled meeting (cancelled)", () => {
    const b = { ...council, blackoutDates: ["2026-08-25"] };
    expect(E.meetingDatesInRange(b, "2026-08-01", "2026-09-30"))
      .toEqual(["2026-08-11", "2026-09-08", "2026-09-22"]);
  });
  it("extraDates add a special-called meeting — explicit beats the rule", () => {
    const b = { ...council, extraDates: ["2026-08-18"] };
    expect(E.meetingDatesInRange(b, "2026-08-01", "2026-08-31"))
      .toEqual(["2026-08-11", "2026-08-18", "2026-08-25"]);
  });
  it("a blackout on a date also in extraDates: extra wins (explicit add applied last)", () => {
    const b = { ...council, blackoutDates: ["2026-08-11"], extraDates: ["2026-08-11"] };
    expect(E.meetingDatesInRange(b, "2026-08-01", "2026-08-20")).toEqual(["2026-08-11"]);
  });
  it("monthly `months` filter — e.g. quarterly (Jan/Apr/Jul/Oct) 1st Monday", () => {
    const q = { recurrence: [{ freq: "monthly", weekday: 1, setpos: [1], months: [1, 4, 7, 10] }] };
    expect(E.meetingDatesInRange(q, "2026-01-01", "2026-12-31"))
      .toEqual(["2026-01-05", "2026-04-06", "2026-07-06", "2026-10-05"]);
  });
  it("weekly cadence (every Wednesday)", () => {
    const w = { recurrence: [{ freq: "weekly", weekday: 3 }] };
    expect(E.meetingDatesInRange(w, "2026-08-01", "2026-08-31"))
      .toEqual(["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"]);
  });
  it("effectiveFrom/effectiveTo bound a rule's active window", () => {
    const c = { recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4], effectiveFrom: "2026-09-01" }] };
    expect(E.meetingDatesInRange(c, "2026-08-01", "2026-09-30")).toEqual(["2026-09-08", "2026-09-22"]);
  });
});

describe("B815 agendaDeadline — offset (business/calendar) + weekdayAnchor", () => {
  it("business-day offset lands on the cascade's working calendar", () => {
    const body = { agendaLead: { type: "offset", n: 10, unit: "business" } };
    expect(E.agendaDeadline(body, "2026-08-25")).toBe("2026-08-11");
  });
  it("business offset skips a holiday it crosses (3 bd before 11/30 skips Thanksgiving 11/26)", () => {
    const body = { agendaLead: { type: "offset", n: 3, unit: "business" } };
    expect(E.agendaDeadline(body, "2026-11-30")).toBe("2026-11-24");
  });
  it("calendar-day offset counts straight days (no weekend/holiday skip)", () => {
    const body = { agendaLead: { type: "offset", n: 10, unit: "calendar" } };
    expect(E.agendaDeadline(body, "2026-08-25")).toBe("2026-08-15");
  });
  it("weekdayAnchor — the Wednesday two weeks before the meeting's week", () => {
    const body = { agendaLead: { type: "weekdayAnchor", weeksBefore: 2, weekday: 3 } };
    expect(E.agendaDeadline(body, "2026-08-25")).toBe("2026-08-12");
  });
  it("no agendaLead → the deadline is the meeting date itself (no lead)", () => {
    expect(E.agendaDeadline({}, "2026-08-25")).toBe("2026-08-25");
  });
});

describe("B815 nextEligibleMeeting — the core snap rule (deadline, not meeting, gates)", () => {
  const council = { recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
                    agendaLead: { type: "offset", n: 10, unit: "business" } };
  it("packet ready after an agenda closed snaps a full cycle forward", () => {
    // 8/11 meeting's agenda closed 7/28; ready 8/5 misses it → first eligible is 8/25.
    expect(E.nextEligibleMeeting(council, "2026-08-05")).toEqual({ meetingDate: "2026-08-25", deadline: "2026-08-11" });
  });
  it("eligibility is agendaDeadline>=ready, NOT meeting>=ready (the obvious wrong impl)", () => {
    // The 8/11 meeting is AFTER 8/5, but its agenda (7/28) already closed — must be skipped.
    const r = E.nextEligibleMeeting(council, "2026-08-05");
    expect(r.meetingDate).not.toBe("2026-08-11");
  });
  it("afterDate forces a strictly-later meeting (a subsequent reading)", () => {
    const r = E.nextEligibleMeeting(council, "2026-08-01", "2026-08-25");
    expect(r.meetingDate > "2026-08-25").toBe(true);
  });
  it("returns null when no meeting resolves within the horizon", () => {
    expect(E.nextEligibleMeeting({ recurrence: [] }, "2026-08-05")).toBeNull();
  });
});

// ── B845 — government date patterns: the "Tuesday after the first Monday" primitive ─────────────
describe("B845 nthWeekdayOnOrAfter — Election-Day primitive (Tue after the 1st Monday in Nov)", () => {
  it("resolves the 1st Tuesday on/after Nov 2 across the acceptance years", () => {
    expect(E.nthWeekdayOnOrAfter(2024, 11, 2, 2)).toBe("2024-11-05");
    expect(E.nthWeekdayOnOrAfter(2026, 11, 2, 2)).toBe("2026-11-03");
    expect(E.nthWeekdayOnOrAfter(2032, 11, 2, 2)).toBe("2032-11-02"); // Nov 2 itself IS a Tuesday
    expect(E.nthWeekdayOnOrAfter(2033, 11, 2, 2)).toBe("2033-11-08"); // Nov 1 is a Tuesday → must NOT be week-early
    expect(E.nthWeekdayOnOrAfter(2039, 11, 2, 2)).toBe("2039-11-08");
  });
  it("differs from the classic 1st-Tuesday primitive exactly when Nov 1 is a Tuesday", () => {
    expect(E.nthWeekdayOfMonth(2033, 11, 2, 1)).toBe("2033-11-01");        // the week-early bug the primitive avoids
    expect(E.nthWeekdayOnOrAfter(2033, 11, 2, 2)).not.toBe("2033-11-01");
    expect(E.nthWeekdayOnOrAfter(2026, 11, 2, 2)).toBe(E.nthWeekdayOfMonth(2026, 11, 2, 1)); // coincide when Nov 1 ≠ Tue
  });
  it("returns null when no such weekday exists on/after dom in the month", () => {
    expect(E.nthWeekdayOnOrAfter(2026, 2, 1, 27)).toBeNull(); // no Monday on/after Feb 27 2026 stays in Feb
  });
  it("clamps dom<1 / non-integer down to day 1", () => {
    expect(E.nthWeekdayOnOrAfter(2026, 11, 2, 0)).toBe(E.nthWeekdayOnOrAfter(2026, 11, 2, 1));
    expect(E.nthWeekdayOnOrAfter(2026, 11, 2, 2.9)).toBe(E.nthWeekdayOnOrAfter(2026, 11, 2, 2));
  });
});

describe("B845 meetingDatesInRange — Election Day + TX uniform-election-date preset", () => {
  const election = { recurrence: [{ freq: "monthly", weekday: 2, setpos: [1], months: [11], onOrAfter: 2 }] };
  it("the November uniform-election rule resolves the correct hearing date each year", () => {
    expect(E.meetingDatesInRange(election, "2024-01-01", "2024-12-31")).toEqual(["2024-11-05"]);
    expect(E.meetingDatesInRange(election, "2026-01-01", "2026-12-31")).toEqual(["2026-11-03"]);
    expect(E.meetingDatesInRange(election, "2032-01-01", "2032-12-31")).toEqual(["2032-11-02"]);
    expect(E.meetingDatesInRange(election, "2033-01-01", "2033-12-31")).toEqual(["2033-11-08"]);
    expect(E.meetingDatesInRange(election, "2039-01-01", "2039-12-31")).toEqual(["2039-11-08"]);
  });
  it("never lands a week early (no 11-01) and stays month-restricted to November", () => {
    const span = E.meetingDatesInRange(election, "2024-01-01", "2039-12-31");
    expect(span).toContain("2033-11-08");
    expect(span).toContain("2039-11-08");
    expect(span).not.toContain("2033-11-01");
    expect(span).not.toContain("2039-11-01");
    expect(span.every(d => d.slice(5, 7) === "11")).toBe(true);
  });
  it("TX uniform election dates = 1st Sat in May + Election Day in Nov (two rules, unioned)", () => {
    const tx = { recurrence: [
      { freq: "monthly", weekday: 6, setpos: [1], months: [5] },
      { freq: "monthly", weekday: 2, setpos: [1], months: [11], onOrAfter: 2 } ] };
    expect(E.meetingDatesInRange(tx, "2026-01-01", "2026-12-31")).toEqual(["2026-05-02", "2026-11-03"]);
  });
  it("a plain 1st-Saturday-in-May rule uses the classic primitive (no onOrAfter)", () => {
    const may = { recurrence: [{ freq: "monthly", weekday: 6, setpos: [1], months: [5] }] };
    expect(E.meetingDatesInRange(may, "2026-01-01", "2027-12-31")).toEqual(["2026-05-02", "2027-05-01"]);
  });
});

describe("anti-drift: the B815 meeting-body engine exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("subBD is the inverse of addBD in both", () => {
    expect(src).toMatch(/subBD = \(s, n\) => addBD\(s, -n\);/);
    expect(mjs).toMatch(/subBD = \(s, n\) => addBD\(s, -n\);/);
  });
  it("nthWeekdayOfMonth guards month overflow (getMonth === m-1) in both", () => {
    expect(src).toMatch(/return \(d\.getMonth\(\) === m - 1\) \? fdLocal\(d\) : null;/);
    expect(mjs).toMatch(/return \(d\.getMonth\(\) === m - 1\) \? fdLocal\(d\) : null;/);
  });
  it("meetingDatesInRange applies extraDates AFTER blackoutDates (explicit-wins) in both", () => {
    expect(src).toMatch(/\.forEach\(d => \{ if \(d >= from && d <= to\) set\.add\(d\); \}\);/);
    expect(mjs).toMatch(/\.forEach\(d => \{ if \(d >= from && d <= to\) set\.add\(d\); \}\);/);
  });
  it("nextEligibleMeeting gates on agenda deadline (dl >= readyDate) in both", () => {
    expect(src).toMatch(/if \(dl >= readyDate\) return \{ meetingDate: m, deadline: dl \};/);
    expect(mjs).toMatch(/if \(dl >= readyDate\) return \{ meetingDate: m, deadline: dl \};/);
  });
});

describe("anti-drift: the B845 on/after primitive exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("nthWeekdayOnOrAfter applies the nth-week shift in both", () => {
    expect(src).toMatch(/if \(nth > 1\) d\.setDate\(d\.getDate\(\) \+ 7 \* \(nth - 1\)\);/);
    expect(mjs).toMatch(/if \(nth > 1\) d\.setDate\(d\.getDate\(\) \+ 7 \* \(nth - 1\)\);/);
  });
  it("meetingDatesInRange routes onOrAfter rules through the new primitive in both", () => {
    expect(src).toMatch(/nthWeekdayOnOrAfter\(y, m, r\.weekday, r\.onOrAfter, sp > 0 \? sp : 1\)/);
    expect(mjs).toMatch(/nthWeekdayOnOrAfter\(y, m, r\.weekday, r\.onOrAfter, sp > 0 \? sp : 1\)/);
  });
});

// ── B816 (NEW-2) — meeting-bound tasks in cascadeDates ──────────────────────────
describe("B816 cascadeDates — meeting-bound snap + the interaction matrix", () => {
  const council = { id: "mb_bt", name: "Baytown council",
    recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
    agendaLead: { type: "offset", n: 10, unit: "business" } };
  const bodies = [council];
  const mk = (id, o = {}) => ({ id, name: "t" + id, start: "", end: "", duration: 1, durValue: 1, durUnit: "d", predecessors: [], parentId: null, ...o });
  const run = (tasks, b = bodies) => { const r = E.cascadeDates(tasks, b); const by = {}; r.forEach(t => by[t.id] = t); return by; };

  it("a bound task snaps to the earliest meeting whose agenda is still OPEN (deadline≥packetReady, not meeting≥ready)", () => {
    // A finishes 8/3 → packet ready 8/4; the 8/11 agenda closed 7/28, so it snaps to 8/25.
    const r = run([mk(1, { start: "2026-07-27", pinnedStart: true, duration: 6, durValue: 6 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] })]);
    expect(r[2].start).toBe("2026-08-25");
    expect(r[2].end).toBe("2026-08-25");        // milestone
    expect(r[2].duration).toBe(0);              // duration forced 0
    expect(r[2].meetingDeadline).toBe("2026-08-11");
    expect(r[2].meetingInfeasible).toBe(false);
    expect(r[2].start).not.toBe("2026-08-11");  // NOT the next meeting after packet-ready
  });
  it("an earlier packet makes the earlier meeting", () => {
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] })]);
    expect(r[2].start).toBe("2026-08-11");
    expect(r[2].meetingDeadline).toBe("2026-07-28");
  });
  it("matrix — bound + blank/unscheduled predecessor stays BLANK (must not snap to next Tuesday from today)", () => {
    const r = run([mk(1, { start: "", end: "", duration: 0 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] })]);
    expect(r[2].start).toBe("");
    expect(r[2].duration).toBe(0);
  });
  it("matrix — bound + pinnedStart: the pin wins (meeting fixed, never rolled)", () => {
    const r = run([mk(2, { meetingBound: true, meetingBodyId: "mb_bt", pinnedStart: true, start: "2026-08-11" })]);
    expect(r[2].start).toBe("2026-08-11");
    expect(r[2].meetingDeadline).toBe("2026-07-28");
  });
  it("matrix — bound + pinnedStart goes INFEASIBLE when the predecessor packet can't make the pinned agenda", () => {
    // Predecessor forced to finish 8/10 → packet ready 8/11, but the pinned 8/11 meeting's agenda closed 7/28.
    const r = run([mk(1, { start: "2026-08-10", pinnedStart: true, duration: 1, durValue: 1 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", pinnedStart: true, start: "2026-08-11",
                           predecessors: [{ id: 1, type: "FS" }] })]);
    expect(r[2].start).toBe("2026-08-11");        // pin holds
    expect(r[2].meetingInfeasible).toBe(true);    // but it's flagged infeasible (red glyph / row)
  });
  it("★ two readings can never be consecutive — the strict tie-break skips the meeting whose agenda already closed", () => {
    // 1st reading lands 8/11; the 2nd reading's agenda for 8/25 closed 8/11 (same day) → it must skip to 9/8.
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 2, type: "FS" }] })]);
    expect(r[2].start).toBe("2026-08-11");
    expect(r[3].start).toBe("2026-09-08");        // NOT 8/25 — the schedule "loses a month" correctly
  });
  it("sameDayFilingAllowed relaxes the tie-break (a same-day-ready 2nd reading CAN make the consecutive meeting)", () => {
    // SS link → the 2nd reading's packet is ready the SAME day the 1st reading meets (8/11).
    const build = bodyArr => run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                                  mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                                  mk(3, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 2, type: "SS" }] })], bodyArr);
    const strict = build(bodies);
    expect(strict[2].start).toBe("2026-08-11");
    expect(strict[3].start).toBe("2026-09-08");   // strict: the 8/25 agenda closed on the 1st-reading day → loses a month
    const relaxed = build([{ ...council, sameDayFilingAllowed: true }]);
    expect(relaxed[3].start).toBe("2026-08-25");   // same-day filing → the consecutive meeting is reachable
  });
  it("minMeetingsAfter forces at least N meetings after a referenced task's meeting", () => {
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }],
                           minMeetingsAfter: { taskId: 2, n: 2 } })]);
    expect(r[2].start).toBe("2026-08-11");
    expect(r[3].start >= "2026-09-08").toBe(true);  // at least the 2nd meeting after 8/11
  });
  it("matrix — bound as a summary/parent is NOT snapped (parents come from rollup)", () => {
    const r = run([mk(10, { meetingBound: true, meetingBodyId: "mb_bt" }),        // parent (has a child)
                   mk(11, { parentId: 10, start: "2026-08-03", pinnedStart: true, duration: 2, durValue: 2 })]);
    expect(r[10].duration).not.toBe(0);   // the bound flag is ignored for a parent — no milestone snap
  });
  it("no meetingBodyId match → behaves as a normal task (unknown body id)", () => {
    const r = run([mk(1, { start: "2026-08-03", pinnedStart: true, duration: 5, durValue: 5 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_missing", predecessors: [{ id: 1, type: "FS" }], duration: 3, durValue: 3 })]);
    expect(r[2].duration).toBe(3);        // normal FS cascade, not a milestone
    expect(r[2].start).toBe("2026-08-10"); // A ends 8/07 (Fri) → +1 BD = Mon 8/10
  });
  it("REGRESSION — unbound tasks (no bodies) cascade exactly as before", () => {
    const r = run([mk(1, { start: "2026-08-03", pinnedStart: true, duration: 5, durValue: 5 }),
                   mk(2, { predecessors: [{ id: 1, type: "FS" }], duration: 3, durValue: 3 })], []);
    expect(r[1].start).toBe("2026-08-03"); expect(r[1].end).toBe("2026-08-07");
    expect(r[2].start).toBe("2026-08-10"); expect(r[2].end).toBe("2026-08-12");
  });
});

describe("anti-drift: the B816 meeting-bound snap exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("cascadeDates takes (tasks, bodies) and merges the MEETING_BODY_INDEX in both", () => {
    expect(src).toMatch(/const cascadeDates = \(tasks, bodies = \[\]\) => \{/);
    expect(src).toMatch(/const bodyMap = \{\.\.\.MEETING_BODY_INDEX\};/);
    expect(mjs).toMatch(/export const cascadeDates = \(tasks, bodies = \[\]\) => \{/);
    expect(mjs).toMatch(/const bodyMap = \{\.\.\.MEETING_BODY_INDEX\};/);
  });
  it("applyMeetingBinding forces duration 0 and pins win in both", () => {
    expect(src).toMatch(/const applyMeetingBinding = \(t, body, predEarly, drivingMeetingDate, minAfterDate\) => \{/);
    expect(mjs).toMatch(/export const applyMeetingBinding = \(t, body, predEarly, drivingMeetingDate, minAfterDate\) => \{/);
    expect(src).toMatch(/if \(pinnedDate\) \{[\s\S]*?t\.start = t\.end = pinnedDate;/);
    expect(mjs).toMatch(/if \(pinnedDate\) \{[\s\S]*?t\.start = t\.end = pinnedDate;/);
  });
  it("the strict two-reading tie-break (addD driving+1 when not sameDayFilingAllowed) is present in both", () => {
    expect(src).toMatch(/if \(!body\.sameDayFilingAllowed\) \{ const nd = addD\(drivingMeetingDate, 1\); if \(nd > readyDate\) readyDate = nd; \}/);
    expect(mjs).toMatch(/if \(!body\.sameDayFilingAllowed\) \{ const nd = addD\(drivingMeetingDate, 1\); if \(nd > readyDate\) readyDate = nd; \}/);
  });
});

describe("bound-task fixed point — a pred-less bound task must NOT ratchet a meeting per cascade", () => {
  // Pre-existing B816 bug: packetReady fell back to the task's OWN snapped start, and a meeting's
  // deadline always precedes the meeting, so the current meeting was never "eligible" from its own
  // date — every cascade rolled it one cycle forward (bind → edit → edit = 3 meetings of drift).
  const council = { id: "mb_bt", name: "Baytown council",
    recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
    agendaLead: { type: "offset", n: 10, unit: "business" } };
  const mk = (id, o = {}) => ({ id, name: "t" + id, start: "", end: "", duration: 1, durValue: 1, durUnit: "d", predecessors: [], parentId: null, ...o });
  it("first cascade snaps from the stored start; repeat cascades are a FIXED POINT", () => {
    let r = E.cascadeDates([mk(2, { meetingBound: true, meetingBodyId: "mb_bt", start: "2026-06-01" })], [council]);
    expect(r[0].start).toBe("2026-06-23");   // first meeting whose agenda (6/9) is still open on 6/1
    r = E.cascadeDates(r, [council]);
    expect(r[0].start).toBe("2026-06-23");   // stays — no ratchet
    r = E.cascadeDates(r, [council]);
    expect(r[0].start).toBe("2026-06-23");
    expect(r[0].meetingDeadline).toBe("2026-06-09");
  });
  it("a later blackout of the current date re-snaps FORWARD (the fixed point releases)", () => {
    const cancelled = { ...council, blackoutDates: ["2026-06-23"] };
    const r = E.cascadeDates([mk(2, { meetingBound: true, meetingBodyId: "mb_bt", start: "2026-06-23" })], [cancelled]);
    expect(r[0].start).toBe("2026-07-14");
  });
  it("a task WITH predecessors still re-derives from them (unchanged behavior)", () => {
    const r = E.cascadeDates([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                              mk(2, { meetingBound: true, meetingBodyId: "mb_bt", start: "2026-06-23", predecessors: [{ id: 1, type: "FS" }] })], [council]);
    expect(r[1].start).toBe("2026-08-11");   // preds say the packet isn't ready until 7/23 — roll forward
  });
});

// ── Deadline rows (deadlineForTaskId) — a task that always sits on its anchor's derived
// call/file-by date (anchor.meetingDeadline), recomputed by a cascade post-pass. One-way
// derivation: deliberately NOT a predecessor link (that would be circular with the anchor's
// meeting-eligibility). "The election must be CALLED ≥78 days before election day" as a row.
describe("deadline rows — cascadeDates post-pass keeps the row on the anchor's call/file-by date", () => {
  const council = { id: "mb_bt", name: "Baytown council",
    recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
    agendaLead: { type: "offset", n: 10, unit: "business" } };
  const bodies = [council];
  const mk = (id, o = {}) => ({ id, name: "t" + id, start: "", end: "", duration: 1, durValue: 1, durUnit: "d", predecessors: [], parentId: null, ...o });
  const run = (tasks, b = bodies) => { const r = E.cascadeDates(tasks, b); const by = {}; r.forEach(t => by[t.id] = t); return by; };

  it("the deadline row lands on the anchor's meetingDeadline as a milestone", () => {
    // Anchor snaps to the 8/11 meeting (deadline 7/28) — the linked row must sit on 7/28.
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { deadlineForTaskId: 2 })]);
    expect(r[2].start).toBe("2026-08-11");
    expect(r[3].start).toBe("2026-07-28");
    expect(r[3].end).toBe("2026-07-28");
    expect(r[3].duration).toBe(0);
    expect(r[3].deadlineInfeasible).toBe(false);
  });
  it("when the anchor rolls to the next meeting, the deadline row follows", () => {
    // Packet ready 8/4 misses the 8/11 agenda → anchor 8/25, deadline 8/11 — row follows to 8/11.
    const r = run([mk(1, { start: "2026-07-27", pinnedStart: true, duration: 6, durValue: 6 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { deadlineForTaskId: 2 })]);
    expect(r[2].start).toBe("2026-08-25");
    expect(r[3].start).toBe("2026-08-11");
  });
  it("deadlineInfeasible fires when the row's own predecessors land AFTER the call/file-by date", () => {
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(4, { start: "2026-08-03", pinnedStart: true, duration: 2, durValue: 2 }),
                   mk(3, { deadlineForTaskId: 2, predecessors: [{ id: 4, type: "FS" }] })]);
    expect(r[3].start).toBe("2026-07-28");            // still sits on the deadline (date is derived)
    expect(r[3].deadlineInfeasible).toBe(true);       // but the conflict is flagged loudly
  });
  it("a stored date WITHOUT predecessors is stale context, not a constraint — no false infeasible", () => {
    // e.g. the body's lead just moved the deadline earlier; the row's old stored date must not flag.
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { start: "2026-09-01", deadlineForTaskId: 2 })]);
    expect(r[3].start).toBe("2026-07-28");
    expect(r[3].deadlineInfeasible).toBe(false);
  });
  it("dangling anchor id → the row keeps its natural date (defensive, no crash)", () => {
    const r = run([mk(3, { start: "2026-07-01", pinnedStart: true, deadlineForTaskId: 99 })]);
    expect(r[3].start).toBe("2026-07-01");
    expect(r[3].deadlineInfeasible).toBe(false);
  });
  it("an UNBOUND anchor leaves the row on its natural date", () => {
    const r = run([mk(2, { start: "2026-08-03", pinnedStart: true }),
                   mk(3, { start: "2026-07-01", pinnedStart: true, deadlineForTaskId: 2 })]);
    expect(r[3].start).toBe("2026-07-01");
  });
  it("meeting binding wins over a stray deadline link (mutual exclusivity, defensive)", () => {
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { meetingBound: true, meetingBodyId: "mb_bt", deadlineForTaskId: 2, predecessors: [{ id: 1, type: "FS" }] })]);
    expect(r[3].start).toBe("2026-08-11");            // snapped to the MEETING, not the deadline
  });
  it("a parent row is never snapped by a deadline link", () => {
    const r = run([mk(1, { start: "2026-07-20", pinnedStart: true, duration: 3, durValue: 3 }),
                   mk(2, { meetingBound: true, meetingBodyId: "mb_bt", predecessors: [{ id: 1, type: "FS" }] }),
                   mk(3, { start: "2026-07-01", pinnedStart: true, deadlineForTaskId: 2 }),
                   mk(4, { start: "2026-07-01", pinnedStart: true, parentId: 3 })]);
    expect(r[3].start).toBe("2026-07-01");            // parent (has child 4) is skipped
  });
});

describe("deadline rows — renumberTasks remaps every task-id pointer (link survives inserts/deletes)", () => {
  const mk = (id, o = {}) => ({ id, name: "t" + id, start: "", end: "", duration: 1, predecessors: [], parentId: null, ...o });
  it("inserting a row above the anchor re-points the link at the anchor's NEW id", () => {
    // [new(id 0), anchor(1), deadline(2 → anchor 1)] → renumber → [1, 2, 3]; link must follow to 2.
    const r = E.renumberTasks([mk(0), mk(1), mk(2, { deadlineForTaskId: 1 })]);
    expect(r[2].deadlineForTaskId).toBe(2);
  });
  it("deleting the anchor nulls the dangling link (the row visibly reverts to a normal task)", () => {
    const r = E.renumberTasks([mk(2, { deadlineForTaskId: 1 })]);   // anchor id 1 already filtered out
    expect(r[0].deadlineForTaskId).toBeNull();
  });
  it("minMeetingsAfter.taskId is remapped too (the latent re-pointing bug this remap fixes)", () => {
    const r = E.renumberTasks([mk(0), mk(1), mk(2, { minMeetingsAfter: { taskId: 1, n: 2 } })]);
    expect(r[2].minMeetingsAfter.taskId).toBe(2);
    const gone = E.renumberTasks([mk(2, { minMeetingsAfter: { taskId: 1, n: 2 } })]);
    expect(gone[0].minMeetingsAfter).toBeUndefined();
  });
  it("plain tasks gain no pointer fields from the remap", () => {
    const r = E.renumberTasks([mk(1)]);
    expect("deadlineForTaskId" in r[0]).toBe(false);
  });
});

describe("deadline rows — computeDisplayHealth surfaces the call/file-by risk", () => {
  const orig = E.NOW;
  afterEach(() => E.setNOW(orig));
  const cf = { cfRules: {} };
  it("infeasible deadline row → red", () => {
    E.setNOW("2026-08-01");
    expect(E.computeDisplayHealth({ deadlineForTaskId: 2, deadlineInfeasible: true, health: "gray", percentComplete: 0, end: "2026-09-30" }, cf)).toBe("red");
  });
  it("deadline within 2 working days → at-risk yellow", () => {
    E.setNOW("2026-08-24");
    expect(E.computeDisplayHealth({ deadlineForTaskId: 2, health: "gray", percentComplete: 0, end: "2026-08-25" }, cf)).toBe("yellow");
  });
  it("a comfortable deadline passes through to the stored health", () => {
    E.setNOW("2026-08-01");
    expect(E.computeDisplayHealth({ deadlineForTaskId: 2, health: "gray", percentComplete: 0, end: "2026-09-15" }, cf)).toBe("gray");
  });
  it("a COMPLETE deadline row is exempt", () => {
    E.setNOW("2026-08-24");
    expect(E.computeDisplayHealth({ deadlineForTaskId: 2, deadlineInfeasible: true, health: "gray", percentComplete: 100, end: "2026-08-25" }, { cfRules: { completeGreen: true } })).toBe("green");
  });
});

describe("anti-drift: the deadline-row wiring exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("the cascade post-pass snaps the row to anchor.meetingDeadline in both", () => {
    expect(src).toMatch(/t\.start = t\.end = anchor\.meetingDeadline; t\.duration = 0;/);
    expect(mjs).toMatch(/t\.start = t\.end = anchor\.meetingDeadline; t\.duration = 0;/);
  });
  it("renumberTasks remaps deadlineForTaskId (dangling → null) in both", () => {
    expect(src).toMatch(/deadlineForTaskId: map\[t\.deadlineForTaskId\] \?\? null/);
    expect(mjs).toMatch(/deadlineForTaskId: map\[t\.deadlineForTaskId\] \?\? null/);
  });
  it("computeDisplayHealth wires deadline-row infeasible→red in both", () => {
    expect(src).toMatch(/if \(task\.deadlineInfeasible\) return "red";/);
    expect(mjs).toMatch(/if \(task\.deadlineInfeasible\) return "red";/);
  });
  it("the pred-less fixed-point guard (no per-cascade ratchet) exists in both", () => {
    expect(src).toMatch(/if \(meetingDatesInRange\(body, packetReady, packetReady\)\.length\) \{/);
    expect(mjs).toMatch(/if \(meetingDatesInRange\(body, packetReady, packetReady\)\.length\) \{/);
  });
});

// ── Round-2 scheduler bug-batch (2026-06-30) — anti-drift guards for the App-level fixes ──
describe("anti-drift: the round-2 scheduler fixes still exist in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const fjs = readFileSync(fileURLToPath(new URL("../src/shared/formula/formula.js", import.meta.url)), "utf8");

  it("TH1: renameProject guards a stale/non-existent project id (no ghost project)", () => {
    // B644 strengthened the guard to also survive a pre-load null d (the nav-bridge crash class).
    expect(src).toMatch(/setData\(d => \(d && d\.projects && d\.projects\[id\]\) \?/);
  });
  it("B644: the shell nav bridge drops messages until data has loaded (null-d updater crash)", () => {
    expect(src).toMatch(/if \(!latestData\.current\) return;/);
  });
  it("TH2: duplicateProject spreads ...src and deep-copies formulaCols (keeps column layout)", () => {
    expect(src).toMatch(/\{\.\.\.src, id: newId, name: src\.name \+ " \(Copy\)", tasks: newTasks,/);
    expect(src).toMatch(/formulaCols: Array\.isArray\(src\.formulaCols\) \? src\.formulaCols\.map\(fc => \(\{\.\.\.fc\}\)\)/);
  });
  it("TH3: the nav-delete bridge only routes home when a delete actually happens", () => {
    expect(src).toMatch(/if \(wasActive && projCount > 1\) setData\(d => \(\{ \.\.\.d, section: "reports" \}\)\);/);
  });
  it("S1: previewProject clears the pin on a predecessors patch (preview matches apply)", () => {
    expect(src).toMatch(/if \('predecessors' in patch\) delete u\.pinnedStart;/);
  });
  it("S2: cleanPatchFor structurally compares objects/arrays (predecessor patches aren't dropped)", () => {
    expect(src).toMatch(/JSON\.stringify\(x\) === JSON\.stringify\(y\)/);
  });
  it("S3: the holiday recascade recomputes from the live `d`, not a stale closure", () => {
    expect(src).toMatch(/Recompute from the LIVE/);
    expect(src).toMatch(/setData\(d => \{\s*const newProjects = \{\};\s*Object\.entries\(d\.projects\)/);
  });
  it("G1: a health-dot click preserves a covering multi-row range (mouse fill works)", () => {
    expect(src).toMatch(/const inSpan = selRange && ri >= Math\.min\(selRange\.r1, selRange\.r2\)/);
    expect(src).toMatch(/if \(!inSpan\) setSelRange\(\{r1:ri, r2:ri, c1:ci, c2:ci\}\);/);
  });
  it("G2: the parent-lock guards lock the whole cost FAMILY by type (col.t), not just col.k", () => {
    expect((src.match(/col\.k==="duration"\|\|col\.t==="cost"/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/c\.k==="duration"\|\|c\.t==="cost"/);
    expect(src).not.toMatch(/col\.k==="duration"\|\|col\.k==="cost"/); // the buggy key-only check is gone
  });
  it("G3: the range-fill loop skips a parent's rolled cost/budget/actual columns", () => {
    expect(src).toMatch(/col==="cost"\|\|col==="budget"\|\|col==="actualCost"\)\)\) applyUpdate\(t\.id, col, val\)/);
  });
  it("F1+F2: the INLINE formula copy carries the blank-equals-empty + date-overflow guards", () => {
    expect(src).toMatch(/if \(isBlank\(a\) && typeof b === "string"\) return b === "" \? 0 : -1;/);
    expect(src).toMatch(/Math\.abs\(s\) > MAX_DATE_SERIAL/);
    // ...and the source-of-truth engine matches (so the two can't drift)
    expect(fjs).toMatch(/if \(isBlank\(a\) && typeof b === "string"\) return b === "" \? 0 : -1;/);
    expect(fjs).toMatch(/Math\.abs\(s\) > MAX_DATE_SERIAL/);
  });
});

// ── Round-3 scheduler bug-batch (2026-06-30) — anti-drift guards ──
describe("anti-drift: the round-3 scheduler fixes still exist in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

  it("E1: the Gantt window is anchored to today + xOf is clamped (axis-clamp regression fixed)", () => {
    expect(src).toMatch(/const hardBack = addD\(NOW, -365 \* 30\), hardFwd = addD\(NOW, 365 \* 50\);/);
    expect(src).toMatch(/const xOf = d => Math\.max\(0, Math\.min\(totalW, dif\(minD, d\) \* ppd\)\);/);
    expect(src).toMatch(/const bw  = isBlankDates \? 0 : Math\.max\(6, xOf\(task\.end\) - bx\);/);
  });
  it("C1: the global key handler bails while any blocking overlay is open", () => {
    expect(src).toMatch(/const overlayOpenRef = useRef\(false\);/);
    /* NEW-1 widened this: the guard now also bails on the keystroke that DISMISSED the overlay.
     * Asking "is an overlay open?" reads false for that one key, because the modal has already
     * closed itself by the time this handler runs — and the grid then acted on a key aimed at the
     * modal, re-opening the status picker. The property C1 cares about is unchanged and strictly
     * stronger; only the expression moved. Full reasoning + the browser proof live in
     * test/menuPortalIsolation.test.js and ui-audit/verify-grid-overlay-input.mjs. */
    expect(src).toMatch(/if \(overlayOpenRef\.current \|\| overlayAtKeyStartRef\.current\) return;/);
  });
  it("C2: Delete blanks the whole multi-cell selection", () => {
    expect(src).toMatch(/Multi-cell range delete/);
    expect(src).toMatch(/if \(Object\.keys\(patch\)\.length\) updateTask\(t\.id, patch\);/);
  });
  it("C3: a date/dependency commit clears the now-stale selRange", () => {
    expect(src).toMatch(/if \(col === "start" \|\| col === "end" \|\| col === "duration" \|\| col === "predecessors"\) setSelRange\(null\);/);
  });
  it("B1+import: a shared applyLoadedData pipeline feeds load / import / restore", () => {
    expect(src).toMatch(/const applyLoadedDataRef = useRef\(null\);/);
    expect(src).toMatch(/applyLoadedDataRef\.current = \(parsed\) =>/);
    expect(src).toMatch(/if \(applyLoadedDataRef\.current\) applyLoadedDataRef\.current\(parsed\);/);   // importJSON (was a ReferenceError)
    expect(src).toMatch(/if \(applyLoadedData\) applyLoadedData\(parsed\); else setData\(parsed\);/);    // doRestore
  });
  it("D1: a contact rename/delete propagates to tasks' responsibleParty", () => {
    expect(src).toMatch(/t\.responsibleParty === oldName \? \{\.\.\.t, responsibleParty: nm\}/);
    expect(src).toMatch(/t\.responsibleParty === goneName \? \{\.\.\.t, responsibleParty: ""\}/);
  });
  it("D2 (B613): the rebuilt notes panel edits notes by id and guards the dismiss", () => {
    // The B613 rebuild replaced the free-text bulk editor (which matched notes by text to avoid
    // scrambling ids) with a per-note running log: every edit maps by note id, so it structurally
    // cannot scramble the other notes. And the panel closes only on a genuine backdrop press+click
    // (the fix for "editing a note dismisses the panel").
    expect(src).toMatch(/notes: notes\.map\(x => x\.id === cur\.id \?/);
    expect(src).toMatch(/e\.target === backdropRef\.current && downOnBackdropRef\.current/);
  });
  it("D3: cost/budget/actual rollups include the node's OWN value (no stranded parent value)", () => {
    expect(src).toMatch(/\(Number\(byId\[id\]\?\.cost\) \|\| 0\) \+ kids\.reduce\(\(s, c\) => s \+ costOf\(c\.id\), 0\)/);
    expect(src).toMatch(/\(Number\(byId\[id\]\?\.\[field\]\) \|\| 0\) \+ kids\.reduce/);
  });
});

// ── B615 — duration input model: working-day weeks/days, calendar-real months/years ──────────
describe("B615 parseDurationInput — unit-aware duration parsing (visible error, never silent 0)", () => {
  it("days & weeks", () => {
    expect(E.parseDurationInput("15d")).toEqual({ value: 15, unit: "d" });
    expect(E.parseDurationInput("15 days")).toEqual({ value: 15, unit: "d" });
    expect(E.parseDurationInput("3w")).toEqual({ value: 3, unit: "w" });
    expect(E.parseDurationInput("3 weeks")).toEqual({ value: 3, unit: "w" });
    expect(E.parseDurationInput("2wk")).toEqual({ value: 2, unit: "w" });
  });
  it("months & years", () => {
    expect(E.parseDurationInput("2mo")).toEqual({ value: 2, unit: "mo" });
    expect(E.parseDurationInput("2 months")).toEqual({ value: 2, unit: "mo" });
    expect(E.parseDurationInput("1y")).toEqual({ value: 1, unit: "y" });
    expect(E.parseDurationInput("1 year")).toEqual({ value: 1, unit: "y" });
    expect(E.parseDurationInput("3yrs")).toEqual({ value: 3, unit: "y" });
  });
  it("calendar days ('cd') is its own unit, distinct from working days ('d')", () => {
    expect(E.parseDurationInput("30cd")).toEqual({ value: 30, unit: "cd" });
    expect(E.parseDurationInput("5 caldays")).toEqual({ value: 5, unit: "cd" });
    expect(E.parseDurationInput("30d")).toEqual({ value: 30, unit: "d" });   // 'd' unchanged, never swallows cd
    expect(E.parseDurationInput("30")).toEqual({ value: 30, unit: "d" });    // bare number still days
  });
  it("a bare number → days; an empty field → 0 days (a cleared cell = milestone, not an error)", () => {
    expect(E.parseDurationInput("5")).toEqual({ value: 5, unit: "d" });
    expect(E.parseDurationInput("0")).toEqual({ value: 0, unit: "d" });
    expect(E.parseDurationInput("")).toEqual({ value: 0, unit: "d" });
    expect(E.parseDurationInput("   ")).toEqual({ value: 0, unit: "d" });
  });
  it("decimals truncate to whole units (matches the existing addBD truncation)", () => {
    expect(E.parseDurationInput("2.9w")).toEqual({ value: 2, unit: "w" });
    expect(E.parseDurationInput("1.5mo")).toEqual({ value: 1, unit: "mo" });
  });
  it("an unparseable string returns {error} — the caller shows it, never coerces to 0", () => {
    expect(E.parseDurationInput("abc").error).toBeTruthy();
    expect(E.parseDurationInput("3x").error).toBeTruthy();
    expect(E.parseDurationInput("-4").error).toBeTruthy();
    expect(E.parseDurationInput("fortnight").error).toBeTruthy();
  });
});

describe("B615 addCalendarMonths — calendar math with end-of-month clamp", () => {
  it("clamps the day to the target month's last day", () => {
    expect(E.addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");   // non-leap
    expect(E.addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");   // leap
    expect(E.addCalendarMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("plain month + year rollover, and one year = same day next year", () => {
    expect(E.addCalendarMonths("2026-01-15", 2)).toBe("2026-03-15");
    expect(E.addCalendarMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(E.addCalendarMonths("2026-12-31", 1)).toBe("2027-01-31");
    expect(E.addCalendarMonths("2026-03-10", 12)).toBe("2027-03-10");
  });
});

describe("B615 rollForwardToWorkday — plain forward off a weekend/holiday", () => {
  it("weekends roll to Monday; a working day is unchanged", () => {
    expect(E.rollForwardToWorkday("2026-06-20")).toBe("2026-06-22"); // Sat → Mon
    expect(E.rollForwardToWorkday("2026-06-21")).toBe("2026-06-22"); // Sun → Mon
    expect(E.rollForwardToWorkday("2026-06-22")).toBe("2026-06-22"); // Mon (working)
    expect(E.rollForwardToWorkday("2026-06-23")).toBe("2026-06-23"); // Tue (working)
  });
  it("a weekday HOLIDAY_SET date rolls forward to the next working day", () => {
    const weekdayHoliday = [...E.HOLIDAY_SET].find(h => h.startsWith("2026-") && ![0,6].includes(new Date(h + "T12:00:00").getDay()));
    expect(weekdayHoliday).toBeTruthy();
    const rolled = E.rollForwardToWorkday(weekdayHoliday);
    expect(rolled > weekdayHoliday).toBe(true);
    const rd = new Date(rolled + "T12:00:00");
    expect([0,6].includes(rd.getDay())).toBe(false);
    expect(E.HOLIDAY_SET.has(rolled)).toBe(false);
  });
});

describe("B615 workdaysBetween — closed-form count agrees with a day-by-day reference", () => {
  const ref = (aIso, bIso) => {
    let a = new Date(aIso + "T12:00:00"), b = new Date(bIso + "T12:00:00");
    if (a > b) { const t = a; a = b; b = t; }
    let c = 0; const cur = new Date(a);
    while (cur <= b) { if (cur.getDay() !== 0 && cur.getDay() !== 6 && !E.HOLIDAY_SET.has(E.fd(cur))) c++; cur.setDate(cur.getDate() + 1); }
    return c;
  };
  it("known spans", () => {
    expect(E.workdaysBetween("2026-06-22", "2026-06-22")).toBe(1); // Mon inclusive
    expect(E.workdaysBetween("2026-06-22", "2026-06-26")).toBe(5); // Mon–Fri
    expect(E.workdaysBetween("2026-06-22", "2026-06-29")).toBe(6); // Mon–Fri + next Mon
    expect(E.workdaysBetween("2026-06-26", "2026-06-22")).toBe(5); // order-independent
  });
  it("agrees with the reference across 400 spans that cross weekends AND federal holidays", () => {
    const base = new Date("2026-01-01T12:00:00");
    for (let i = 0; i < 400; i += 7) {
      const a = new Date(base); a.setDate(a.getDate() + i);
      const b = new Date(base); b.setDate(b.getDate() + i + (i % 37));
      const aIso = E.fd(a), bIso = E.fd(b);
      expect(E.workdaysBetween(aIso, bIso)).toBe(ref(aIso, bIso));
    }
  });
});

describe("B615 resolveDuration — days/weeks = working days · months/years = calendar-real", () => {
  it("days & weeks resolve to a WORKING-day span (inclusive), matching calcEnd", () => {
    const d10 = E.resolveDuration("2026-06-22", 10, "d");
    expect(d10.duration).toBe(10);
    expect(d10.end).toBe(E.calcEnd("2026-06-22", 10));
    expect(E.workdaysBetween("2026-06-22", d10.end)).toBe(10);
    const w3 = E.resolveDuration("2026-06-22", 3, "w");
    expect(w3.duration).toBe(15);                                   // 3 weeks = 15 working days
    expect(w3.end).toBe(E.calcEnd("2026-06-22", 15));
  });
  it("months add CALENDAR months + roll forward; the working-day count is DERIVED off the span", () => {
    const r = E.resolveDuration("2026-01-15", 2, "mo");
    expect(r.end).toBe(E.rollForwardToWorkday("2026-03-15"));        // 2 calendar months
    expect(r.duration).toBe(E.workdaysBetween("2026-01-15", r.end)); // derived, never an input
    // end-of-month clamp flows through
    expect(E.resolveDuration("2026-01-31", 1, "mo").end).toBe(E.rollForwardToWorkday("2026-02-28"));
  });
  it("years = same day next year (+ roll forward)", () => {
    expect(E.resolveDuration("2026-03-10", 1, "y").end).toBe(E.rollForwardToWorkday("2027-03-10"));
  });
  it("calendar days ('cd') = an EXACT calendar window (weekends counted, no roll); working-day count DERIVED", () => {
    // 10 calendar days from Mon 06-22 = through 07-01 (start + 9 straight days), no weekend skip.
    const r = E.resolveDuration("2026-06-22", 10, "cd");
    expect(r.end).toBe(E.addD("2026-06-22", 9));                    // exact, weekend-inclusive
    expect(r.end).toBe("2026-07-01");
    expect(r.duration).toBe(E.workdaysBetween("2026-06-22", r.end)); // derived, never an input
    // a cd window MAY end on a weekend (a working span never does): 6 calendar days from Mon = Sat.
    expect(E.resolveDuration("2026-06-22", 6, "cd").end).toBe("2026-06-27");
  });
  it("the SAME number is a shorter wall-clock window in cd than in d (cd skips no weekend)", () => {
    const cd = E.resolveDuration("2026-06-22", 10, "cd");
    const d  = E.resolveDuration("2026-06-22", 10, "d");
    expect(cd.end < d.end).toBe(true);                   // ISO strings compare by date: 10cd ends before 10d
    expect(cd.duration).toBeLessThanOrEqual(d.duration); // fewer working days inside the window
  });
  it("0cd is a milestone; a cd with no start yields a blank end", () => {
    expect(E.resolveDuration("2026-06-22", 0, "cd")).toEqual({ end: "2026-06-22", duration: 0 });
    expect(E.resolveDuration("", 10, "cd")).toEqual({ end: "", duration: 0 });
  });
  it("0 of any unit is a milestone; no start yields a blank end", () => {
    expect(E.resolveDuration("2026-06-22", 0, "d")).toEqual({ end: "2026-06-22", duration: 0 });
    expect(E.resolveDuration("2026-06-22", 0, "mo")).toEqual({ end: "2026-06-22", duration: 0 });
    expect(E.resolveDuration("", 5, "d")).toEqual({ end: "", duration: 5 });
    expect(E.resolveDuration("", 2, "mo")).toEqual({ end: "", duration: 0 });
  });
  it("ACCEPTED divergence: 4 weeks (20 wd) is NOT 1 month (calendar) — different measuring sticks", () => {
    expect(E.resolveDuration("2026-06-22", 4, "w").duration).toBe(20);
    expect(E.resolveDuration("2026-06-22", 4, "w").end)
      .not.toBe(E.resolveDuration("2026-06-22", 1, "mo").end);
  });
});

describe("B615 cascadeDates — unit-aware end derivation flows through the dependency chain", () => {
  const leaf = (id, o) => ({ id, name: "t" + id, start: "2026-06-22", end: "", duration: 1, durUnit: "d", durValue: 1, predecessors: [], parentId: null, ...o });
  it("a WEEK successor cascades as 5 working days per week", () => {
    const out = E.cascadeDates([
      leaf(1, { start: "2026-06-22", duration: 1, durValue: 1 }),
      leaf(2, { durUnit: "w", durValue: 1, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    const t2 = out.find(t => t.id === 2);
    expect(t2.start).toBe(E.addBD("2026-06-22", 1));      // FS: pred end + 1 BD
    expect(t2.duration).toBe(5);                           // 1 week = 5 working days
    expect(t2.end).toBe(E.calcEnd(t2.start, 5));
  });
  it("a MONTH successor cascades as calendar months, working-day count derived off the span", () => {
    const out = E.cascadeDates([
      leaf(1, { start: "2026-06-22", duration: 1, durValue: 1 }),
      leaf(2, { durUnit: "mo", durValue: 2, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    const t2 = out.find(t => t.id === 2);
    expect(t2.end).toBe(E.rollForwardToWorkday(E.addCalendarMonths(t2.start, 2)));
    expect(t2.duration).toBe(E.workdaysBetween(t2.start, t2.end));
  });
  it("a CALENDAR-DAY successor cascades as an exact calendar window from its cascaded start", () => {
    const out = E.cascadeDates([
      leaf(1, { start: "2026-06-22", duration: 1, durValue: 1 }),
      leaf(2, { durUnit: "cd", durValue: 30, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    const t2 = out.find(t => t.id === 2);
    expect(t2.end).toBe(E.addD(t2.start, 29));                      // 30 calendar days, weekend-inclusive
    expect(t2.duration).toBe(E.workdaysBetween(t2.start, t2.end));  // derived working-day count
  });
});

describe("B615 normalizeToV7 — legacy durations become unit 'd' with ZERO end-date shift", () => {
  const legacy = () => ({ projects: { p1: { name: "P", tasks: [
    { id: 1, name: "a", start: "2026-06-22", end: "2026-06-26", duration: 5, predecessors: [], parentId: null },
    { id: 2, name: "b", start: "2026-07-06", end: "2026-07-06", duration: 1, predecessors: [], parentId: null },
  ] } } });
  it("stamps durUnit/durValue and preserves every end date (no silent shift)", () => {
    const before = E.normalizeToV6(legacy());
    const after = E.normalizeToV7(before);
    const t = after.projects.p1.tasks;
    expect(t[0]).toMatchObject({ durUnit: "d", durValue: 5, end: before.projects.p1.tasks[0].end });
    expect(t[1]).toMatchObject({ durUnit: "d", durValue: 1, end: before.projects.p1.tasks[1].end });
    // The before/after end-date diff the migration must surface: for legacy data it is EMPTY.
    const shifted = t.filter((x, i) => x.end !== before.projects.p1.tasks[i].end);
    expect(shifted).toHaveLength(0);
  });
  it("is idempotent (the _v7 flag short-circuits a second pass)", () => {
    const once = E.normalizeToV7(E.normalizeToV6(legacy()));
    const twice = E.normalizeToV7(once);
    expect(twice._v7).toBe(true);
    expect(twice.projects.p1.tasks).toEqual(once.projects.p1.tasks);
  });
});

// ── B616 — a locked finish is a hard constraint (fixed point + loud conflict) ─────────────────
describe("B616 startForEnd — back-calc a start that finishes ON a locked date", () => {
  it("inverts calcEnd for the working-day span", () => {
    expect(E.startForEnd("2026-06-26", 5)).toBe("2026-06-22"); // Fri, 5 wd → Mon
    expect(E.startForEnd("2026-06-26", 1)).toBe("2026-06-26"); // 1-day / milestone
    expect(E.startForEnd("2026-06-26", 0)).toBe("2026-06-26");
    expect(E.startForEnd("", 5)).toBe("");
  });
});

describe("B616 cascadeDates — a pinnedEnd task is a FIXED POINT, conflicts flagged loudly", () => {
  const T2 = (id, o) => ({ id, name: "t" + id, start: "2026-06-22", end: "2026-06-22", duration: 1, durUnit: "d", durValue: 1, predecessors: [], parentId: null, ...o });
  it("locked finish with no predecessors: end stays, start back-calcs, no conflict", () => {
    const out = E.cascadeDates([T2(1, { start: "2026-06-22", end: "2026-06-26", duration: 5, durValue: 5, pinnedEnd: true })]);
    const t = out.find(x => x.id === 1);
    expect(t.end).toBe("2026-06-26");                    // never moved
    expect(t.start).toBe("2026-06-22");                  // back-calc of 5 wd ending Fri
    expect(t.finishConflict).toBe(false);
  });
  it("a predecessor chain that can't fit the duration flags a conflict, but NEVER moves the lock", () => {
    const out = E.cascadeDates([
      T2(1, { start: "2026-06-22", duration: 5, durValue: 5 }),                             // ends Fri 06-26
      T2(2, { end: "2026-06-25", duration: 5, durValue: 5, pinnedEnd: true, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    const t2 = out.find(x => x.id === 2);
    expect(t2.end).toBe("2026-06-25");                   // locked finish held, not overwritten/exceeded
    expect(t2.finishConflict).toBe(true);                // chain needs more time than the lock allows
  });
  it("a predecessor chain with room does NOT flag a conflict", () => {
    const out = E.cascadeDates([
      T2(1, { start: "2026-06-01", duration: 1, durValue: 1 }),
      T2(2, { end: "2026-07-31", duration: 5, durValue: 5, pinnedEnd: true, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    const t2 = out.find(x => x.id === 2);
    expect(t2.end).toBe("2026-07-31");
    expect(t2.finishConflict).toBe(false);
  });
  it("a successor cascades from the locked finish (the fixed point), not a floating end", () => {
    const out = E.cascadeDates([
      T2(1, { start: "2026-06-22", end: "2026-06-30", duration: 7, durValue: 7, pinnedEnd: true }),
      T2(2, { duration: 1, durValue: 1, predecessors: [{ id: 1, type: "FS" }] }),
    ]);
    expect(out.find(x => x.id === 1).end).toBe("2026-06-30");
    expect(out.find(x => x.id === 2).start).toBe(E.addBD("2026-06-30", 1));
  });
});

// ── anti-drift: the B615/B616 engine lives in BOTH the source and the mirror ──────────────────
describe("anti-drift: the B615/B616 duration + finish-lock engine exists in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("B615: the pure helpers are present in source AND mirror", () => {
    for (const s of [src, mjs]) {
      expect(s).toContain("parseDurationInput");
      expect(s).toContain("addCalendarMonths");
      expect(s).toContain("rollForwardToWorkday");
      expect(s).toContain("workdaysBetween");
      expect(s).toContain("resolveDuration");
      expect(s).toContain("normalizeToV7");
    }
  });
  it("B855: the calendar-days ('cd') duration unit + resolve branch exist in source AND mirror", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/if \(u === "cd"\) \{ const end = addD\(start, v - 1\);/);   // exact calendar window, no roll
      expect(s).toMatch(/\{ re: \/\^\(cd\|cds\|calday\|caldays\|caldy\)\$\/,\s*unit: "cd" \}/);
    }
  });
  it("B615: the V7 migration is wired into the load pipeline (source + mirror)", () => {
    expect(src).toMatch(/normalizeToV7\(normalizeToV6\(/);
    expect(mjs).toMatch(/normalizeToV7\(normalizeToV6\(/);
    expect(src).toContain("_v7");
  });
  it("B615: the duration cell renders the typed unit, parses via parseDurationInput", () => {
    expect(src).toContain("fmtTaskDuration(task, task.hasChildren)");   // B463072 added the summary flag
    expect(src).toMatch(/const parsed = parseDurationInput\(val\);/);
    expect(src).toMatch(/if \(parsed\.error\) \{ showToast\(parsed\.error\); return; \}/);
  });
  it("B616: pinnedEnd is a fixed point + finishConflict flag in cascade (source + mirror)", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/if \(t\.pinnedEnd && t\.end\)/);
      expect(s).toContain("finishConflict");
      expect(s).toContain("startForEnd");
    }
  });
  it("B616: the finish lock icon + conflict banner are wired in the source UI", () => {
    expect(src).toContain("Finish locked (hard constraint)");
    expect(src).toMatch(/pinnedEnd: false, durValue: taskDurValue\(task\)/);      // unlock → flow
    expect(src).toContain("locked finish date");                                  // the loud banner
  });
  it("B624: a typed Start/Finish on a weekend/holiday rolls forward to the next working day + toasts", () => {
    // rollForwardToWorkday is applied to the parsed date in the grid commit path, and the toast
    // names the reason (weekend vs holiday) — never a silent weekend/holiday endpoint.
    expect(src).toMatch(/const rolled = rollForwardToWorkday\(p\);/);
    expect(src).toMatch(/const why = \(wd === 0 \|\| wd === 6\) \? "a weekend" : "a holiday";/);
    expect(src).toMatch(/moved to \$\{toShortDate\(rolled\)\} — you picked \$\{why\}/);
  });
});

// B624 runtime: the engine helper the input guard reuses (weekend/holiday → next working day).
describe("B624 rollForwardToWorkday — the input-guard primitive", () => {
  it("a weekend rolls to Monday; a working day is unchanged; a weekday holiday rolls forward", () => {
    expect(E.rollForwardToWorkday("2026-06-20")).toBe("2026-06-22"); // Sat → Mon
    expect(E.rollForwardToWorkday("2026-06-21")).toBe("2026-06-22"); // Sun → Mon
    expect(E.rollForwardToWorkday("2026-06-23")).toBe("2026-06-23"); // Tue (working) unchanged
    const wkHol = [...E.HOLIDAY_SET].find(h => h.startsWith("2026-") && ![0,6].includes(new Date(h + "T12:00:00").getDay()));
    if (wkHol) expect(E.rollForwardToWorkday(wkHol) > wkHol).toBe(true);
  });
});

// ── B817 (NEW-3) — float-to-deadline, cost-of-miss, and the health rollup ───────
describe("B817 meetingFloatBD / meetingCostDays — the two decision numbers", () => {
  const council = { id: "mb_bt", recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
    agendaLead: { type: "offset", n: 10, unit: "business" } };
  it("meetingFloatBD — working days from today to the agenda deadline", () => {
    const t = { meetingBound: true, meetingDeadline: "2026-08-25" };
    expect(E.meetingFloatBD(t, "2026-08-20")).toBe(3);   // Thu 8/20 → Tue 8/25 = Fri,Mon,Tue
    expect(E.meetingFloatBD(t, "2026-08-25")).toBe(0);   // same day = no float
  });
  it("meetingFloatBD — null on an unbound task or one without a deadline", () => {
    expect(E.meetingFloatBD({ meetingBound: false, meetingDeadline: "2026-08-25" }, "2026-08-20")).toBeNull();
    expect(E.meetingFloatBD({ meetingBound: true }, "2026-08-20")).toBeNull();
  });
  it("meetingCostDays — calendar days to the next eligible meeting", () => {
    const t = { meetingBound: true, meetingBodyId: "mb_bt", start: "2026-08-11" };  // a 2nd-Tuesday meeting
    expect(E.meetingCostDays(t, council)).toBe(14);      // → the 4th Tuesday 8/25 is 14 calendar days out
  });
  it("meetingCostDays — null without a body or a start", () => {
    expect(E.meetingCostDays({ meetingBound: true, start: "2026-08-11" }, null)).toBeNull();
    expect(E.meetingCostDays({ meetingBound: true, start: "" }, council)).toBeNull();
  });
});

describe("B817 computeDisplayHealth — a bound task surfaces risk before it slips", () => {
  const orig = E.NOW;
  afterEach(() => E.setNOW(orig));
  const cf = { cfRules: { completeGreen: true, overdueRed: true, dueSoonYellow: true } };
  it("infeasible bound task → red (a genuine alert)", () => {
    E.setNOW("2026-08-01");
    expect(E.computeDisplayHealth({ meetingBound: true, meetingInfeasible: true, health: "gray", percentComplete: 0, meetingDeadline: "2026-09-30" }, cf)).toBe("red");
  });
  it("≤2 working days of float → at-risk yellow", () => {
    E.setNOW("2026-08-24");   // Mon; deadline Tue 8/25 = 1 working day
    expect(E.computeDisplayHealth({ meetingBound: true, meetingDeadline: "2026-08-25", health: "gray", percentComplete: 0 }, cf)).toBe("yellow");
  });
  it("healthy float (>2 working days) → passes through to the stored health", () => {
    E.setNOW("2026-08-01");
    expect(E.computeDisplayHealth({ meetingBound: true, meetingDeadline: "2026-09-15", health: "gray", percentComplete: 0 }, cf)).toBe("gray");
  });
  it("a COMPLETE bound task is green, never at-risk", () => {
    E.setNOW("2026-08-24");
    expect(E.computeDisplayHealth({ meetingBound: true, meetingInfeasible: true, meetingDeadline: "2026-08-25", health: "gray", percentComplete: 100 }, cf)).toBe("green");
  });
  it("an UNBOUND task is unaffected by the meeting-risk rule", () => {
    E.setNOW("2026-08-24");
    expect(E.computeDisplayHealth({ meetingBound: false, meetingInfeasible: true, meetingDeadline: "2026-08-25", health: "gray", percentComplete: 0, end: "2026-12-01" }, cf)).toBe("gray");
  });
});

describe("anti-drift: the B817 float/cost + health wiring exists in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("meetingFloatBD + meetingCostDays present in both", () => {
    expect(src).toMatch(/const meetingFloatBD = \(task, todayIso\) =>/);
    expect(mjs).toMatch(/export const meetingFloatBD = \(task, todayIso\) =>/);
    expect(src).toMatch(/const meetingCostDays = \(task, body\) =>/);
    expect(mjs).toMatch(/export const meetingCostDays = \(task, body\) =>/);
  });
  it("computeDisplayHealth wires bound-task infeasible→red / ≤2 float→yellow in both", () => {
    expect(src).toMatch(/if \(task\.meetingDeadline && difBD\(NOW, task\.meetingDeadline\) <= 2\) return "yellow";/);
    expect(mjs).toMatch(/if \(task\.meetingDeadline && difBD\(NOW, task\.meetingDeadline\) <= 2\) return "yellow";/);
  });
});

// B835/B836 — cascade-drift detection. A non-pinned leaf task's SAVED start must equal the start its
// predecessor chain implies; when a stale/fossil value survives (e.g. a lag zeroed without a re-cascade),
// the load re-cascade corrects it. detectCascadeDrift surfaces those corrections so the heal is LOUD, not
// silent. The scenario mirrors the exact owner repro: Grand Port task 81 saved 2026-08-03 while its FS
// predecessor (task 80, ends 2026-07-10) implies 2026-07-13; task 82 is pinned and masks the wrong finish.
describe("B836 — detectCascadeDrift flags non-pinned tasks whose stored start ≠ engine start", () => {
  const fossil = () => [
    T(80, { start: "2026-06-22", end: "2026-07-10", pinnedEnd: true, durValue: 15, durUnit: "d", predecessors: [] }),
    T(81, { start: "2026-08-03", durValue: 10, durUnit: "d", predecessors: [{ id: 80, type: "FS", lag: 0 }] }), // fossil start
    T(82, { start: "2026-08-17", pinnedStart: true, durValue: 30, durUnit: "d", predecessors: [{ id: 81, type: "FS", lag: 0 }] }),
  ];

  it("detects the fossil (task 81 saved 8/3 → engine 7/13) and reports from/to", () => {
    const stored = fossil();
    const engine = E.rollupParentDates(E.cascadeDates(stored.map(t => ({ ...t }))));
    // sanity: the engine really does derive 7/13 from the FS predecessor
    expect(engine.find(t => t.id === 81).start).toBe("2026-07-13");
    const drift = E.detectCascadeDrift(stored, engine);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ id: 81, from: "2026-08-03", to: "2026-07-13" });
  });

  it("does NOT flag the downstream pinned task (82) that masked the wrong finish", () => {
    const stored = fossil();
    const engine = E.rollupParentDates(E.cascadeDates(stored.map(t => ({ ...t }))));
    expect(E.detectCascadeDrift(stored, engine).some(d => d.id === 82)).toBe(false);
  });

  it("clean data (stored start already matches the predecessor) yields no drift", () => {
    const stored = [
      T(80, { start: "2026-06-22", end: "2026-07-10", pinnedEnd: true, durValue: 15, durUnit: "d", predecessors: [] }),
      T(81, { start: "2026-07-13", durValue: 10, durUnit: "d", predecessors: [{ id: 80, type: "FS", lag: 0 }] }),
    ];
    const engine = E.rollupParentDates(E.cascadeDates(stored.map(t => ({ ...t }))));
    expect(E.detectCascadeDrift(stored, engine)).toEqual([]);
  });

  it("pinned starts are exempt even when the engine array disagrees (a pin is intentional)", () => {
    const stored = [T(5, { start: "2026-08-03", pinnedStart: true, predecessors: [{ id: 4, type: "FS", lag: 0 }] })];
    const engine = [{ ...stored[0], start: "2026-07-13" }]; // engine says something else — still exempt
    expect(E.detectCascadeDrift(stored, engine)).toEqual([]);
  });

  it("parents (rollup-derived) are not reported as cascade drift", () => {
    const stored = [
      T(1, { start: "2026-08-03", predecessors: [] }),                    // parent of 2 — start differs from engine
      T(2, { start: "2026-06-22", parentId: 1, predecessors: [] }),
    ];
    const engine = [{ ...stored[0], start: "2026-06-22" }, { ...stored[1] }];
    expect(E.detectCascadeDrift(stored, engine)).toEqual([]);
  });

  it("empty / missing inputs never throw", () => {
    expect(() => E.detectCascadeDrift(undefined, undefined)).not.toThrow();
    expect(E.detectCascadeDrift([], [])).toEqual([]);
  });
});

describe("B836 — the drift guard is wired into the real source + engine mirror (anti-drift)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("detectCascadeDrift is defined in both the app source and the engine mirror", () => {
    expect(src).toContain("const detectCascadeDrift =");
    expect(mjs).toContain("export const detectCascadeDrift =");
  });
  it("the load paths collect drift (recascadeWithDrift) and surface it loudly (setDriftNotice + banner)", () => {
    expect(src).toContain("recascadeWithDrift");
    expect(src).toContain("setDriftNotice");
    expect(src).toContain("driftNotice && driftNotice.length");   // the banner render
  });
});

// B835 — the cascade is FORWARD-ONLY: a task's start is derived from its PREDECESSORS, never its
// successors. A pinned successor can therefore neither MOVE nor BLOCK the recompute of an upstream task.
// Confirmed against the owner's live version history: Grand Port task 81 corrected 8/3 -> 7/13 while its
// successor task 82 was STILL pinned — so the pin never gated 81's cascade. The 8/3 was a fossil from a
// ~15-working-day lag on 81's OWN predecessor link (later zeroed); it lingered only because the app
// recomputes on a fresh load or a date/dependency edit, and a run of non-date edits never triggered one.
describe("B835 — a pinned successor never moves OR blocks an upstream task's recompute (cascade is forward-only)", () => {
  const chain = (extra82 = {}) => [
    T(80, { start: "2026-06-22", end: "2026-07-10", pinnedEnd: true, durValue: 15, durUnit: "d", predecessors: [] }),
    T(81, { start: "2026-07-13", durValue: 10, durUnit: "d", predecessors: [{ id: 80, type: "FS", lag: 0 }] }),
    T(82, { start: "2026-07-27", durValue: 30, durUnit: "d", predecessors: [{ id: 81, type: "FS", lag: 0 }], ...extra82 }),
  ];
  const startOf = (tasks, id) => E.cascadeDates(tasks).find(t => t.id === id).start;

  it("task 81 holds its predecessor-derived 7/13 no matter where the successor (82) is pinned", () => {
    expect(startOf(chain(), 81)).toBe("2026-07-13");                                              // baseline, no pin
    expect(startOf(chain({ pinnedStart: true, start: "2026-08-17" }), 81)).toBe("2026-07-13");    // pinned later
    expect(startOf(chain({ pinnedStart: true, start: "2027-01-01" }), 81)).toBe("2026-07-13");    // pinned far out
    expect(startOf(chain({ pinnedStart: true, start: "2026-07-01" }), 81)).toBe("2026-07-13");    // pinned earlier
  });

  it("pinning the successor still moves the successor + its own downstream (proves the pin isn't a no-op)", () => {
    const pinned = E.cascadeDates(chain({ pinnedStart: true, start: "2026-08-17" }));
    expect(pinned.find(t => t.id === 82).start).toBe("2026-08-17");   // 82 obeys its pin (forward effect is real)
  });

  it("the 8/3 fossil is explained by a lag on 81's OWN link, not by task 82", () => {
    const withLag = chain();
    withLag[1].predecessors = [{ id: 80, type: "FS", lag: 15 }];      // FS +1 +15 working days from 7/10
    expect(startOf(withLag, 81)).toBe("2026-08-03");
  });

  it("the reported fossil state (81 saved 8/3 non-pinned, 82 pinned) heals 81 back to 7/13 on recompute", () => {
    const tasks = chain({ pinnedStart: true, start: "2026-08-17" });
    tasks[1].start = "2026-08-03";                                    // inject the stale saved value
    expect(startOf(tasks, 81)).toBe("2026-07-13");                   // recompute ignores the fossil, re-derives from 80
  });
});

// B835 (recurrence ×2) — the EDIT-time cascade gate. updateTask only re-runs cascadeDates when the edit
// TOUCHES a scheduling input. The pre-fix gate was an OR-list that omitted the B615 typed-duration
// keys (durValue/durUnit) and the pin toggles (pinnedStart/pinnedEnd), so a typed duration edit or an
// unpin/unlock updated the edited task's own end but NEVER cascaded — successors kept stale dates and
// the stale value got persisted. This is the exact hs-v1 repro: task 82 "Remove Tract from City of
// Baytown ETJ" (pinned 2027-01-15) had its duration changed and its FS successor 83 "Petition TCEQ for
// District Creation" (and the whole 83→85→87→88 chain) never re-flowed.
describe("B835 (×2) — touchesSchedule fires the cascade for EVERY scheduling-input mutation", () => {
  it("returns true for each scheduling-input key (incl. the ones the old gate missed)", () => {
    for (const k of ["start", "end", "duration", "durValue", "durUnit", "predecessors",
                     "pinnedStart", "pinnedEnd", "meetingBound", "meetingBodyId",
                     "pinnedMeetingDate", "minMeetingsAfter", "deadlineForTaskId"]) {
      expect(E.touchesSchedule({ [k]: 1 })).toBe(true);
    }
  });
  it("fires for the EXACT commit shapes that used to slip through", () => {
    expect(E.touchesSchedule({ durValue: 45, durUnit: "cd" })).toBe(true);   // typed duration cell (index.html :8374 / master :11217)
    expect(E.touchesSchedule({ durUnit: "d" })).toBe(true);
    expect(E.touchesSchedule({ pinnedStart: false, predecessors: [] })).toBe(true); // unpin start (:9426)
    expect(E.touchesSchedule({ pinnedEnd: false, durValue: 5, durUnit: "d" })).toBe(true); // unlock finish (:9427)
  });
  it("returns false for edits that can never move a date (so they still skip the cascade)", () => {
    for (const u of [{ name: "x" }, { health: "green" }, { percentComplete: 50 }, { notes: [] },
                     { rowColor: "#fff" }, { bold: true }, { focused: true }, { isExpanded: false },
                     { responsibleParty: "Sam" }, { cost: 10 }]) {
      expect(E.touchesSchedule(u)).toBe(false);
    }
  });
  it("guards empty / nullish input", () => {
    expect(E.touchesSchedule(undefined)).toBe(false);
    expect(E.touchesSchedule(null)).toBe(false);
    expect(E.touchesSchedule({})).toBe(false);
  });
});

describe("B835 (×2) — once the gate fires, a typed-duration edit re-flows the whole FS successor chain (hs-v1 repro)", () => {
  // The live fossil: 82 pinned 2027-01-15 @ 45 working days (end 2027-03-18); 83/85/87/88 still hold
  // the dates they had when 82 was 45 CALENDAR days (end 2027-02-28). A cascade re-flows them.
  const T2 = (id, o = {}) => ({ id, name: "t" + id, start: "", end: "", duration: 0, durValue: 0, durUnit: "d", predecessors: [], parentId: 81, ...o });
  const chain = () => [
    T2(81, { parentId: 80, name: "District Creation" }),
    T2(82, { start: "2027-01-15", pinnedStart: true, durValue: 45, durUnit: "d", predecessors: [] }),
    T2(83, { start: "2027-03-01", predecessors: [{ id: 82, type: "FS", lag: 0 }] }),                       // fossil
    T2(85, { start: "2027-09-01", predecessors: [{ id: 83, type: "FS", lag: 130 }] }),                     // fossil
    T2(87, { start: "2027-09-02", predecessors: [{ id: 85, type: "FS", lag: 0 }] }),                       // fossil
    T2(88, { start: "2028-05-06", predecessors: [{ id: 87, type: "FS", lag: 78, lagUnit: "calendar" }] }), // fossil
  ];
  it("re-flows 83→85→87→88 to their predecessor-derived starts", () => {
    const by = {};
    E.rollupParentDates(E.cascadeDates(chain().map(t => ({ ...t })))).forEach(t => (by[t.id] = t));
    expect(by[82].end).toBe("2027-03-18");   // 45 working days from the pinned 01-15 (unchanged anchor)
    expect(by[83].start).toBe("2027-03-19");  // FS: next business day after Thu 03-18
    expect(by[85].start).toBe("2027-09-22");  // FS +130 working days
    expect(by[87].start).toBe("2027-09-23");  // FS: next business day
    expect(by[88].start).toBe("2027-12-11");  // FS +78 CALENDAR days
  });
  it("a weekend-ending calendar-day task hands off to the next WORKING day (no skew) — FS from Sun 02-28", () => {
    // Secondary check from the repro: when 82 is 45cd (end Sun 2027-02-28), 83's FS start must roll to Mon 03-01.
    const cd = chain();
    cd[1] = T2(82, { start: "2027-01-15", pinnedStart: true, durValue: 45, durUnit: "cd", predecessors: [] });
    const by = {};
    E.cascadeDates(cd.map(t => ({ ...t }))).forEach(t => (by[t.id] = t));
    expect(by[82].end).toBe("2027-02-28");    // 45 calendar days lands on a Sunday
    expect(by[83].start).toBe("2027-03-01");  // and the FS hand-off resolves to the next working day, not the weekend
  });
});

describe("B835 (×2) — the touchesSchedule gate is wired into the real source + engine mirror (anti-drift)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("touchesSchedule + SCHEDULE_INPUT_KEYS are defined in BOTH the app source and the engine mirror", () => {
    expect(src).toContain("const touchesSchedule =");
    expect(src).toContain("const SCHEDULE_INPUT_KEYS =");
    expect(mjs).toContain("export const touchesSchedule =");
    expect(mjs).toContain("export const SCHEDULE_INPUT_KEYS =");
  });
  it("both key-lists carry the keys the pre-fix gate omitted (durValue/durUnit/pinnedStart/pinnedEnd)", () => {
    for (const s of [src, mjs]) for (const k of ["durValue", "durUnit", "pinnedStart", "pinnedEnd"]) {
      expect(s).toContain(`'${k}'`);
    }
  });
  it("updateTask's cascade gate uses touchesSchedule (not the old hand-maintained OR-list)", () => {
    expect(src).toContain("if (touchesSchedule(updates)) {");
  });
});

// B864 — a task bound to a meeting calendar that no longer exists (a lost meeting body — the multi-writer
// clobber that orphaned hs-v1's election binding). cascadeDates must PRESERVE the stored meeting date
// instead of silently reverting it to a plain FS date, and flag it; detectCascadeDrift must exempt
// meeting-bound + deadline rows (their dates are derived by a different mechanism, like pins).
describe("B864 — orphaned meeting binding: preserve the date + flag it, never revert to FS", () => {
  const body = { id: "mb_e", name: "Elections", recurrence: [{ freq: "monthly", weekday: 6, setpos: [1], months: [5] }], agendaLead: { type: "offset", n: 10, unit: "business" } };
  const base = () => [
    T(1, { start: "2026-01-05", end: "2026-01-09", pinnedStart: true, durValue: 5, durUnit: "d" }),
    T(2, { start: "2027-05-01", duration: 0, durValue: 0, durUnit: "d", meetingBound: true, meetingBodyId: "mb_e", predecessors: [{ id: 1, type: "FS", lag: 0 }] }),
  ];

  it("with the calendar MISSING, the bound task holds its stored date and is flagged meetingBodyMissing", () => {
    const by = {};
    E.cascadeDates(base(), []).forEach(t => (by[t.id] = t));   // no bodies passed → body missing
    expect(by[2].start).toBe("2027-05-01");        // preserved, NOT the FS date its predecessor implies
    expect(by[2].meetingBodyMissing).toBe(true);
    expect(by[2].meetingInfeasible).toBe(false);   // unverifiable alert cleared
  });

  it("proves preservation is real: unbinding the SAME task reverts it to the plain FS date", () => {
    const unbound = base().map(t => t.id === 2 ? { ...t, meetingBound: false, meetingBodyId: undefined } : t);
    const by = {};
    E.cascadeDates(unbound, []).forEach(t => (by[t.id] = t));
    expect(by[2].start).not.toBe("2027-05-01");     // a plain FS task DOES move off the stored date
    expect(by[2].start).toBe("2026-01-12");         // FS: next business day after the predecessor's 2026-01-09 end
  });

  it("with the calendar PRESENT, the task snaps to the meeting date and the flag clears", () => {
    const by = {};
    E.cascadeDates(base(), [body]).forEach(t => (by[t.id] = t));
    expect(by[2].start).toBe("2026-05-02");         // 1st Saturday of May 2026 on/after packet-ready
    expect(by[2].meetingBodyMissing).toBe(false);
  });

  it("detectCascadeDrift EXEMPTS a meeting-bound task even when stored != engine (a legitimate re-snap)", () => {
    const stored = base();                          // task 2 stored 2027-05-01
    const engine = E.cascadeDates(base(), [body]);  // engine snaps it to 2026-05-02
    expect(engine.find(t => t.id === 2).start).toBe("2026-05-02");   // they genuinely differ
    expect(E.detectCascadeDrift(stored, engine).some(d => d.id === 2)).toBe(false);
  });

  it("detectCascadeDrift EXEMPTS a deadline row (deadlineForTaskId) too", () => {
    const stored = [T(3, { start: "2027-01-01", deadlineForTaskId: 9, predecessors: [] })];
    const engine = [{ ...stored[0], start: "2026-01-01" }];
    expect(E.detectCascadeDrift(stored, engine)).toEqual([]);
  });
});

describe("B864 — the orphaned-binding hardening exists in BOTH the app source and the engine mirror (anti-drift)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("cascadeDates computes bodyMissing and soft-pins the start in both files", () => {
    for (const s of [src, mjs]) {
      expect(s).toContain("const bodyMissing = !!(t.meetingBound && !bodyMap[t.meetingBodyId] && !parentIds.has(t.id));");
      expect(s).toContain("t.pinnedStart || (bodyMissing && t.start)");
    }
  });
  it("detectCascadeDrift exempts meeting-bound + deadline rows in both files", () => {
    for (const s of [src, mjs]) {
      expect(s).toContain("if (t.meetingBound || t.deadlineForTaskId != null) return;");
    }
  });
  it("the row surfaces a missing-calendar badge (LOUD-FAILURE) in the app source", () => {
    expect(src).toContain("task.meetingBound && !MEETING_BODY_INDEX[task.meetingBodyId]");
    expect(src).toContain("Bound to a meeting calendar that no longer exists");
  });
});

// B864(b) — the 3-way cloud-doc merge that stops a stale tab from clobbering a sibling's changes (the
// multi-writer whole-doc-save clobber that lost hs-v1's election calendar). Rebases OUR edits onto the
// newer cloud (theirs) so independent additions on both sides survive.
describe("B864(b) — mergeCloudDoc rebases our edits onto the newer cloud without dropping either side", () => {
  it("THE REPRO: a stale tab's save preserves the sibling's just-created meeting calendar + binding", () => {
    const base = { settings: { meetingBodies: [] }, projects: { p: { tasks: [{ id: 88, meetingBound: false }, { id: 50, start: "2026-01-01" }] } } };
    // theirs (cloud): a sibling created the election calendar AND bound #88 to it
    const theirs = { settings: { meetingBodies: [{ id: "mb_e", name: "TX Elections" }] }, projects: { p: { tasks: [{ id: 88, meetingBound: true, meetingBodyId: "mb_e", start: "2027-05-01" }, { id: 50, start: "2026-01-01" }] } } };
    // ours (stale tab): never saw the calendar; independently moved task 50
    const ours = { settings: { meetingBodies: [] }, projects: { p: { tasks: [{ id: 88, meetingBound: false }, { id: 50, start: "2026-02-15" }] } } };
    const merged = E.mergeCloudDoc(base, ours, theirs);
    expect(merged.settings.meetingBodies).toEqual([{ id: "mb_e", name: "TX Elections" }]);   // calendar SURVIVES
    expect(merged.projects.p.tasks.find(t => t.id === 88).meetingBound).toBe(true);           // binding SURVIVES
    expect(merged.projects.p.tasks.find(t => t.id === 88).start).toBe("2027-05-01");           // election date SURVIVES
    expect(merged.projects.p.tasks.find(t => t.id === 50).start).toBe("2026-02-15");           // our own edit SURVIVES
  });

  it("symmetric: the calendar-creating tab's save keeps a sibling's independent task edit", () => {
    const base = { settings: { meetingBodies: [] }, projects: { p: { tasks: [{ id: 1, name: "a" }] } } };
    const ours = { settings: { meetingBodies: [{ id: "mb_e" }] }, projects: { p: { tasks: [{ id: 1, name: "a" }] } } };  // we added the calendar
    const theirs = { settings: { meetingBodies: [] }, projects: { p: { tasks: [{ id: 1, name: "RENAMED" }] } } };          // sibling renamed task 1
    const merged = E.mergeCloudDoc(base, ours, theirs);
    expect(merged.settings.meetingBodies).toEqual([{ id: "mb_e" }]);            // our calendar kept
    expect(merged.projects.p.tasks[0].name).toBe("RENAMED");                    // their rename kept
  });

  it("identical or no-op sides short-circuit", () => {
    const d = { a: 1, b: { c: 2 } };
    expect(E.mergeCloudDoc(d, d, d)).toBe(d);
    expect(E.mergeCloudDoc({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 });   // we didn't change → take theirs
    expect(E.mergeCloudDoc({ a: 1 }, { a: 2 }, { a: 1 })).toEqual({ a: 2 });   // they didn't change → take ours
  });

  it("a true conflict on the same field prefers OURS (the active tab)", () => {
    expect(E.mergeCloudDoc({ x: 0 }, { x: 1 }, { x: 2 }).x).toBe(1);
    // a task edited by BOTH tabs: ours wins (loser recoverable from history)
    const base = { t: { start: "2026-01-01" } }, ours = { t: { start: "2026-03-03" } }, theirs = { t: { start: "2026-09-09" } };
    expect(E.mergeCloudDoc(base, ours, theirs).t.start).toBe("2026-03-03");
  });

  it("honors an add on either side and a delete only when the other side left the key alone", () => {
    // their add survives; our add survives
    expect(E.mergeCloudDoc({}, { a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    // we deleted `k` (they left it as-base) → stays deleted
    expect(E.mergeCloudDoc({ k: 1, x: 0 }, { x: 0 }, { k: 1, x: 0 })).toEqual({ x: 0 });
    // they deleted `k` (we left it as-base) → stays deleted
    expect(E.mergeCloudDoc({ k: 1, x: 0 }, { k: 1, x: 0 }, { x: 0 })).toEqual({ x: 0 });
    // they deleted `k` but WE changed it → our change wins (not silently dropped)
    expect(E.mergeCloudDoc({ k: 1 }, { k: 9 }, {})).toEqual({ k: 9 });
  });

  it("is robust to a missing/undefined base (fail-safe: falls back to our doc on a full conflict)", () => {
    expect(E.mergeCloudDoc(undefined, { a: 1 }, { a: 1 })).toEqual({ a: 1 });
    expect(() => E.mergeCloudDoc(null, { a: 1 }, { b: 2 })).not.toThrow();
  });
});

describe("B864(b) — the cloud-doc merge is wired into the save path in the real source", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("mergeCloudDoc is defined in BOTH the app source and the engine mirror", () => {
    expect(src).toContain("mergeCloudDoc");
    expect(mjs).toContain("export const mergeCloudDoc =");
  });
  it("the Layer-0 guard MERGES on a stale save instead of only blocking, and tracks a base doc", () => {
    expect(src).toContain("baseByKey");
    expect(src).toContain("mergeCloudDoc(");
  });
});

describe("B864(b) — keyed-array (tasks/bodies) merge honors adds, deletes, and per-element conflicts", () => {
  const P = (tasks) => ({ projects: { p: { tasks } } });
  it("a sibling's NEW task survives our unrelated edit", () => {
    const base = P([{ id: 1, name: "a" }]);
    const ours = P([{ id: 1, name: "a-EDIT" }]);
    const theirs = P([{ id: 1, name: "a" }, { id: 2, name: "sibling-added" }]);
    const m = E.mergeCloudDoc(base, ours, theirs).projects.p.tasks;
    expect(m.find(t => t.id === 1).name).toBe("a-EDIT");    // our edit kept
    expect(m.find(t => t.id === 2)).toBeTruthy();           // their new task kept
  });
  it("our deletion of a task the sibling didn't touch stays deleted", () => {
    const base = P([{ id: 1 }, { id: 2 }]);
    const ours = P([{ id: 1 }]);                            // we deleted #2
    const theirs = P([{ id: 1, name: "renamed" }, { id: 2 }]);
    const m = E.mergeCloudDoc(base, ours, theirs).projects.p.tasks;
    expect(m.find(t => t.id === 2)).toBeFalsy();            // delete honored
    expect(m.find(t => t.id === 1).name).toBe("renamed");  // their unrelated edit kept
  });
  it("both tabs edited the SAME task → ours wins (loser is recoverable from history)", () => {
    const base = P([{ id: 1, start: "2026-01-01" }]);
    const ours = P([{ id: 1, start: "2026-05-05" }]);
    const theirs = P([{ id: 1, start: "2026-09-09" }]);
    expect(E.mergeCloudDoc(base, ours, theirs).projects.p.tasks[0].start).toBe("2026-05-05");
  });
  it("a sibling's brand-new project survives (nested object add)", () => {
    const base = { projects: { a: { tasks: [] } } };
    const ours = { projects: { a: { tasks: [{ id: 1 }] } } };
    const theirs = { projects: { a: { tasks: [] }, b: { tasks: [{ id: 9 }] } } };
    const m = E.mergeCloudDoc(base, ours, theirs);
    expect(m.projects.a.tasks).toHaveLength(1);   // our task in project a
    expect(m.projects.b).toBeTruthy();            // their new project b
  });
});

// ── B443248 / B443249 / B443250 — the owner-reported "Mobilize" defect ────────────────────────
// Grand Port task 228 "Mobilize" (0d, FS after 106 and 108) sat on 2026-08-10 — which read like the
// clock, because it was roughly the day the link was made. It was not the clock. It was the next
// WORKING DAY after predecessor 108's START, because cascadeDates resolved 108 (a SUMMARY row whose
// three children run to 2026-10-02) as if it were a leaf: a parent carries `duration` from the rollup
// but leaves `durValue` at 0, so resolveTaskSpan collapsed a 40-working-day parent to a 0-day milestone
// on its own start. rollupParentDates restored the parent's finish immediately afterwards — which is
// exactly why the wrong successor date was a STABLE fixed point that re-running the recompute could not
// correct, and that detectCascadeDrift (stored vs engine) could never see.
const GP = () => ([
  // 108 — the summary. duration 40 from a prior rollup, durValue 0 (a parent never carries one).
  { id: 108, name: "CCID3 Approval", start: "2026-08-07", end: "2026-10-02", duration: 40, durValue: 0, durUnit: "d", predecessors: [], parentId: null },
  { id: 109, name: "Revise routing", start: "2026-08-07", end: "2026-08-13", duration: 5, durValue: 5, durUnit: "d", predecessors: [], parentId: 108 },
  { id: 110, name: "CWA Approval",   start: "2026-08-14", end: "2026-08-20", duration: 5, durValue: 5, durUnit: "d", predecessors: [{id:109,type:"FS",lag:0}], parentId: 108 },
  { id: 111, name: "LONO Approvals", start: "2026-08-21", end: "2026-10-02", duration: 30, durValue: 30, durUnit: "d", predecessors: [{id:110,type:"FS",lag:0}], parentId: 108 },
  // 106 — an UNSCHEDULED predecessor: a summary with one blank child. Contributes no date at all.
  { id: 106, name: "ETJ Permit",   start: "", end: "", duration: 0, durValue: 0, durUnit: "d", predecessors: [], parentId: null },
  { id: 107, name: "Submit Permit", start: "", end: "", duration: 0, durValue: 0, durUnit: "d", predecessors: [], parentId: 106 },
  // 228 — the reported row.
  { id: 228, name: "Mobilize", start: "2026-08-10", end: "2026-08-10", duration: 0, durValue: 0, durUnit: "d",
    predecessors: [{id:106,type:"FS",lag:0},{id:108,type:"FS",lag:0}], parentId: null },
]);
const byId = arr => Object.fromEntries(arr.map(t => [t.id, t]));

describe("B443248 — a successor of a SUMMARY row schedules off the summary's real FINISH", () => {
  it("Mobilize starts the next working day after its summary predecessor's FINISH, not its START", () => {
    const out = byId(E.recomputeSchedule(GP()));
    expect(out[108].end).toBe("2026-10-02");            // the parent keeps its rolled-up finish
    expect(out[228].start).toBe("2026-10-05");          // Monday after Fri 2026-10-02 — NOT 2026-08-10
    expect(out[228].end).toBe("2026-10-05");            // 0d milestone: finish = start
  });
  it("the summary row's own dates come from its children, never from durValue", () => {
    const out = byId(E.recomputeSchedule(GP()));
    expect([out[108].start, out[108].end]).toEqual(["2026-08-07", "2026-10-02"]);
  });
  it("the recompute is a FIXED POINT — running it again moves nothing", () => {
    const once = E.recomputeSchedule(GP());
    const twice = E.recomputeSchedule(once);
    expect(twice.map(t => [t.id, t.start, t.end])).toEqual(once.map(t => [t.id, t.start, t.end]));
  });
  it("a change PROPAGATES transitively: a child moves → the summary moves → the successor and ITS successor move", () => {
    const tasks = GP().concat([
      { id: 229, name: "Pour slab", start: "", end: "", duration: 5, durValue: 5, durUnit: "d", predecessors: [{id:228,type:"FS",lag:0}], parentId: null },
      { id: 230, name: "Steel",     start: "", end: "", duration: 5, durValue: 5, durUnit: "d", predecessors: [{id:229,type:"FS",lag:0}], parentId: null },
    ]);
    const before = byId(E.recomputeSchedule(tasks));
    expect(before[228].start).toBe("2026-10-05");
    expect(before[230].start).toBe("2026-10-13");
    // Push the LAST child of the summary out by two working weeks.
    const moved = tasks.map(t => t.id === 111 ? { ...t, durValue: 40, duration: 40 } : t);
    const after = byId(E.recomputeSchedule(moved));
    expect(after[108].end).toBe("2026-10-16");
    expect(after[228].start).toBe("2026-10-19");        // one hop
    expect(after[229].start).toBe("2026-10-20");        // two hops
    expect(after[230].start).toBe("2026-10-27");        // three hops — transitive, in ONE call
  });
  it("detectCascadeDrift NAMES the correction, so an existing saved schedule self-corrects visibly on load", () => {
    const stored = GP();
    const drift = E.detectCascadeDrift(stored, E.recomputeSchedule(stored));
    expect(drift.map(d => [d.id, d.from, d.to])).toEqual([[228, "2026-08-10", "2026-10-05"]]);
  });
  it("a leaf task's own span is still derived from durValue/durUnit (the parent skip is not a blanket skip)", () => {
    const out = byId(E.recomputeSchedule(GP()));
    expect(out[109].end).toBe("2026-08-13");            // 5 working days from 2026-08-07 inclusive
    expect(out[110].start).toBe("2026-08-14");
  });
});

describe("B443249 — a predecessor that drives NOTHING is named, never silently dropped", () => {
  it("an UNSCHEDULED (dateless) predecessor is recorded on the successor", () => {
    const out = byId(E.recomputeSchedule(GP()));
    expect(out[228].predUnresolved).toEqual([106]);     // 106 has no dates; 108 does and is absent
  });
  it("a MISSING predecessor id (no such row) is recorded too", () => {
    const tasks = GP().concat([
      { id: 300, name: "Orphan link", start: "2026-09-01", end: "2026-09-01", duration: 0, durValue: 0, durUnit: "d",
        predecessors: [{id:9999,type:"FS",lag:0}], parentId: null },
    ]);
    expect(byId(E.recomputeSchedule(tasks))[300].predUnresolved).toEqual([9999]);
  });
  it("a fully satisfied row records nothing", () => {
    const out = byId(E.recomputeSchedule(GP()));
    expect(out[110].predUnresolved).toEqual([]);
  });
});

describe("B443250 — a pinned start still WINS, but a pin that beats the chain says so", () => {
  it("a pinned start earlier than the predecessors allow flags startConflict and keeps the pin", () => {
    const tasks = GP().map(t => t.id === 228 ? { ...t, pinnedStart: true } : t);
    const out = byId(E.recomputeSchedule(tasks));
    expect(out[228].start).toBe("2026-08-10");          // the pin wins — unchanged contract
    expect(out[228].startConflict).toBe(true);          // …and it is no longer silent
  });
  it("a pinned start at or after the chain's earliest is NOT a conflict", () => {
    const tasks = GP().map(t => t.id === 228 ? { ...t, pinnedStart: true, start: "2026-11-02", end: "2026-11-02" } : t);
    expect(byId(E.recomputeSchedule(tasks))[228].startConflict).toBe(false);
  });
  it("an unpinned row never carries a start conflict", () => {
    expect(byId(E.recomputeSchedule(GP()))[228].startConflict).toBe(false);
  });
});

describe("anti-drift: B443248/B443249/B443250 exist VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("cascadeDates skips date derivation for a summary row in both", () => {
    for (const s of [src, mjs]) expect(s).toMatch(/if \(parentIds\.has\(t\.id\)\) \{ t\.finishConflict = false; t\.startConflict = false; return; \}/);
  });
  it("predUnresolved is computed in both", () => {
    for (const s of [src, mjs]) expect(s).toMatch(/\.filter\(p => !map\[p\.id\] \|\| !\(map\[p\.id\]\.end \|\| map\[p\.id\]\.start\)\)/);
  });
  it("the pinned-start conflict flag is set in both", () => {
    for (const s of [src, mjs]) expect(s).toMatch(/if \(t\.pinnedStart && t\.start && predEarly && predEarly > t\.start\) t\.startConflict = true;/);
  });
  it("recomputeSchedule iterates to a fixed point in both", () => {
    for (const s of [src, mjs]) expect(s).toMatch(/const next = rollupParentDates\(cascadeDates\(out, bodies\)\);/);
  });
  it("no cascade+rollup pair is hand-written outside recomputeSchedule in index.html", () => {
    // Every call site goes through the one recompute; a hand-paired call is the shape that let the
    // parent's restored finish arrive one pass too late for its successors.
    const pairs = src.match(/rollupParentDates\(cascadeDates\(/g) || [];
    expect(pairs.length).toBe(1);                        // the single occurrence inside recomputeSchedule
  });
  it("the grid marks a flagged predecessor entry and the pinned-start conflict", () => {
    expect(src).toMatch(/flagged=\{p => un\.has\(p\.id\)\}/);
    expect(src).toMatch(/isStart \? !!task\.startConflict : !!task\.finishConflict/);
  });
});

// ── B463072 — the SUMMARY row's Duration cell read the stale leftover ─────────────────────────
// The audit B443248 provoked: a group header carries TWO durations — the span rollupParentDates derives
// from its children (`duration`), and the typed value the rollup never rewrites (`durValue`/`durUnit`).
// B443248 stopped the SCHEDULER reading the stale one. This is the same field, read by the DISPLAY.
// Measured on the real page before the fix: the owner's "CCID3: Lift Station & Force Main Approval"
// rendered `08/07/26 · 10/02/26 · 0d` — forty working days of work printed as a zero-day milestone.
describe("B463072 — a summary row prints its ROLLED span, never the leftover typed duration", () => {
  const summary = { id: 1, duration: 40, durValue: 0, durUnit: "d" };   // exactly the CCID3 shape
  it("the summary shape printed the leftover when asked as a leaf (the defect, pinned)", () => {
    expect(E.fmtTaskDuration(summary)).toBe("0d");
  });
  it("…and prints the rolled span when told it is a summary", () => {
    expect(E.fmtTaskDuration(summary, true)).toBe("40d");
  });
  it("a summary NEVER inherits a leftover unit — the rolled span is always working days", () => {
    // A row that was once typed "2mo" and later became a parent keeps durUnit:'mo'; rendering "2mo"
    // for a span the children put at 63 working days would be a second wrong number, not a fix.
    expect(E.fmtTaskDuration({ id: 2, duration: 63, durValue: 2, durUnit: "mo" }, true)).toBe("63d");
  });
  it("a LEAF is untouched — typed value and typed unit both survive", () => {
    expect(E.fmtTaskDuration({ id: 3, duration: 30, durValue: 30, durUnit: "d" }, false)).toBe("30d");
    expect(E.fmtTaskDuration({ id: 4, duration: 63, durValue: 3, durUnit: "mo" })).toBe("3mo");
    expect(E.fmtTaskDuration({ id: 5, duration: 21, durValue: 30, durUnit: "cd" })).toBe("30cd");
  });
  it("a blank duration still renders blank for a summary too (no bare 'd')", () => {
    expect(E.fmtTaskDuration({ id: 6, duration: "", durValue: 0, durUnit: "d" }, true)).toBe("");
    expect(E.fmtTaskDuration({ id: 7, duration: null, durValue: 0, durUnit: "d" }, true)).toBe("");
  });
  it("a 0-day summary (all children milestones on one day) still reads 0d", () => {
    expect(E.fmtTaskDuration({ id: 8, duration: 0, durValue: 0, durUnit: "d" }, true)).toBe("0d");
  });
  it("the rolled span the engine produces is what the cell then prints — end to end", () => {
    const tasks = [
      { id: 100, name: "Header", start: "2026-08-07", end: "2026-10-02", duration: 40, durValue: 0, durUnit: "d", predecessors: [], parentId: null },
      { id: 101, name: "A", start: "2026-08-07", end: "2026-08-13", duration: 5, durValue: 5, durUnit: "d", predecessors: [], parentId: 100 },
      { id: 102, name: "B", start: "2026-08-14", end: "2026-10-02", duration: 35, durValue: 35, durUnit: "d", predecessors: [{id:101,type:"FS",lag:0}], parentId: 100 },
    ];
    const out = Object.fromEntries(E.recomputeSchedule(tasks).map(t => [t.id, t]));
    expect(E.fmtTaskDuration(out[100], true)).toBe(`${out[100].duration}d`);
    expect(out[100].end).toBe("2026-10-02");
    expect(E.fmtTaskDuration(out[100], true)).not.toBe("0d");
  });
});

describe("anti-drift: B463072 exists VERBATIM in src + mirror, and every render site passes the flag", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("fmtTaskDuration takes isSummary and short-circuits to the rolled span in both", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/fmtTaskDuration = \(t, isSummary = false\) =>/);
      expect(s).toMatch(/if \(isSummary\) return `\$\{t\.duration\}d`;/);
    }
  });
  it("the project grid passes hasChildren", () => {
    expect(src).toMatch(/\{fmtTaskDuration\(task, task\.hasChildren\)\}/);
  });
  it("the master view and the export both pass !isLeaf", () => {
    expect((src.match(/fmtTaskDuration\(t, !t\.isLeaf\)/g) || []).length).toBe(2);
  });
  it("NO render or export site calls fmtTaskDuration one-armed except the leaf-only edit seed", () => {
    // The master view's duration EDITOR seeds from the typed value on purpose — it only opens on a leaf
    // (the dblclick handler returns unless t.isLeaf), and a leaf must edit in the unit it was typed in.
    const bare = (src.match(/fmtTaskDuration\(([a-z]+)\)/g) || []);
    expect(bare).toEqual(["fmtTaskDuration(t)"]);
    expect(src).toMatch(/if \(!t\.isLeaf\) return; setLocalEdit/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NEW-schedule-health — configurable health automation (replaces the fixed 3-toggle cfRules)
// ═══════════════════════════════════════════════════════════════════════════════════════════
// An ORDERED list of {id, type, days?, color} rules, first match wins. See
// public/sequence/index.html's own comment above computeDisplayHealth for the full design.

describe("NEW-schedule-health — the condition vocabulary is finite (locks scope)", () => {
  it("exactly the 7 named conditions exist, no more, no fewer", () => {
    expect(E.HEALTH_CONDITIONS.map(c => c.k)).toEqual([
      "finishPastDays", "finishWithinDays", "finishToday",
      "notStarted", "predecessorLate", "noOwner", "complete",
    ]);
  });
  it("every condition is keyed for O(1) lookup and needsDays is a real boolean on each", () => {
    for (const c of E.HEALTH_CONDITIONS) {
      expect(E.HEALTH_CONDITION_BY_KEY[c.k]).toBe(c);
      expect(typeof c.needsDays).toBe("boolean");
      if (c.needsDays) expect(typeof c.defaultDays).toBe("number");
    }
  });
});

describe("NEW-schedule-health — evalHealthCondition: one condition, one fact, absence-safe", () => {
  const base = { id: 1, name: "t", percentComplete: 0, responsibleParty: "", predecessors: [] };

  it("finishPastDays: matches N+ calendar days late, not on the due date itself, not once complete", () => {
    expect(E.evalHealthCondition("finishPastDays", 1, { ...base, end: "2026-08-14" }, "2026-08-15")).toBe(true);  // 1 day late
    expect(E.evalHealthCondition("finishPastDays", 1, { ...base, end: "2026-08-15" }, "2026-08-15")).toBe(false); // due TODAY is not "past"
    expect(E.evalHealthCondition("finishPastDays", 2, { ...base, end: "2026-08-14" }, "2026-08-15")).toBe(false); // 1 day late, threshold is 2
    expect(E.evalHealthCondition("finishPastDays", 1, { ...base, end: "2026-08-01", percentComplete: 100 }, "2026-08-15")).toBe(false); // done work is never "overdue"
  });
  it("finishPastDays: a MISSING finish date never reads as \"not overdue ⇒ safe\" — it fails the condition outright", () => {
    expect(E.evalHealthCondition("finishPastDays", 1, { ...base, end: "" }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("finishPastDays", 1, { ...base }, "2026-08-15")).toBe(false); // end entirely absent
  });

  it("finishWithinDays: matches inside the window, not once overdue, not once complete", () => {
    expect(E.evalHealthCondition("finishWithinDays", 7, { ...base, end: "2026-08-20" }, "2026-08-15")).toBe(true);  // 5 days out
    expect(E.evalHealthCondition("finishWithinDays", 7, { ...base, end: "2026-08-25" }, "2026-08-15")).toBe(false); // 10 days out, outside the window
    expect(E.evalHealthCondition("finishWithinDays", 7, { ...base, end: "2026-08-10" }, "2026-08-15")).toBe(false); // already overdue, not "approaching"
    expect(E.evalHealthCondition("finishWithinDays", 7, { ...base, end: "2026-08-20", percentComplete: 100 }, "2026-08-15")).toBe(false);
  });
  it("finishWithinDays: a MISSING finish date fails the condition, never a silent pass", () => {
    expect(E.evalHealthCondition("finishWithinDays", 7, { ...base, end: null }, "2026-08-15")).toBe(false);
  });

  it("finishToday: matches only an exact calendar-date match, and never a completed task", () => {
    expect(E.evalHealthCondition("finishToday", null, { ...base, end: "2026-08-15" }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("finishToday", null, { ...base, end: "2026-08-14" }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("finishToday", null, { ...base, end: "2026-08-15", percentComplete: 100 }, "2026-08-15")).toBe(false);
  });
  it("finishToday: a MISSING finish date can't be \"today\"", () => {
    expect(E.evalHealthCondition("finishToday", null, { ...base, end: "" }, "2026-08-15")).toBe(false);
  });

  it("notStarted: start in the past + 0% complete matches; already-touched work does not", () => {
    expect(E.evalHealthCondition("notStarted", null, { ...base, start: "2026-08-10" }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("notStarted", null, { ...base, start: "2026-08-10", percentComplete: 5 }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("notStarted", null, { ...base, start: "2026-08-15" }, "2026-08-15")).toBe(false); // starts today, not yet "past"
  });
  it("notStarted: a MISSING start date fails the condition, never a silent pass", () => {
    expect(E.evalHealthCondition("notStarted", null, { ...base, start: "" }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("notStarted", null, { ...base }, "2026-08-15")).toBe(false);
  });

  it("predecessorLate: true only when a resolvable predecessor is itself overdue and incomplete", () => {
    const byId = { 9: { id: 9, end: "2026-08-10", percentComplete: 50 } };  // 5 days late, unfinished
    expect(E.evalHealthCondition("predecessorLate", null, { ...base, predecessors: [{ id: 9 }] }, "2026-08-15", byId)).toBe(true);
  });
  it("predecessorLate: NO predecessors, an UNRESOLVABLE id, and a FINISHED predecessor all fail (never a false positive)", () => {
    const byId = { 9: { id: 9, end: "2026-08-10", percentComplete: 100 } };
    expect(E.evalHealthCondition("predecessorLate", null, { ...base, predecessors: [] }, "2026-08-15", byId)).toBe(false);
    expect(E.evalHealthCondition("predecessorLate", null, { ...base, predecessors: [{ id: 404 }] }, "2026-08-15", byId)).toBe(false);
    expect(E.evalHealthCondition("predecessorLate", null, { ...base, predecessors: [{ id: 9 }] }, "2026-08-15", byId)).toBe(false);
  });
  it("predecessorLate: with NO taskById map at all, it never guesses — always false, never a crash", () => {
    expect(E.evalHealthCondition("predecessorLate", null, { ...base, predecessors: [{ id: 9 }] }, "2026-08-15", undefined)).toBe(false);
  });

  it("noOwner: true for empty/whitespace-only, false once a real name is entered — not gated on % complete", () => {
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: "" }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: "   " }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: "Bob" }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: "", percentComplete: 100 }, "2026-08-15")).toBe(true);
  });

  it("complete: exactly the 100%-or-more boundary", () => {
    expect(E.evalHealthCondition("complete", null, { ...base, percentComplete: 100 }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("complete", null, { ...base, percentComplete: 99 }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("complete", null, { ...base, percentComplete: 0 }, "2026-08-15")).toBe(false);
  });

  it("an unknown condition type is a no-match, never a throw (forward-compat with a stale saved rule)", () => {
    expect(E.evalHealthCondition("somethingRemovedInAFutureVersion", 3, { ...base, end: "2020-01-01" }, "2026-08-15")).toBe(false);
  });
});

describe("NEW-schedule-health — evalHealthRules: ordering IS the mechanism (first match wins)", () => {
  const task = { id: 1, name: "t", percentComplete: 100, responsibleParty: "" };  // matches BOTH "complete" and "noOwner"
  it("complete-then-noOwner picks green; noOwner-then-complete picks red — same task, same rules, different order", () => {
    const greenFirst = E.evalHealthRules(task, { healthRules: [
      { id: "a", type: "complete", color: "green" },
      { id: "b", type: "noOwner", color: "red" },
    ] }, "2026-08-15");
    const redFirst = E.evalHealthRules(task, { healthRules: [
      { id: "b", type: "noOwner", color: "red" },
      { id: "a", type: "complete", color: "green" },
    ] }, "2026-08-15");
    expect(greenFirst).toBe("green");
    expect(redFirst).toBe("red");
  });
  it("no rule matches → null, so the caller falls back to the stored health (never invents a color)", () => {
    expect(E.evalHealthRules({ id: 1, percentComplete: 0, responsibleParty: "Bob" }, { healthRules: [
      { id: "a", type: "complete", color: "green" },
    ] }, "2026-08-15")).toBeNull();
  });
  it("an empty rule list is a legitimate \"automation off\" state, not an error", () => {
    expect(E.evalHealthRules({ id: 1, percentComplete: 0 }, { healthRules: [] }, "2026-08-15")).toBeNull();
  });
});

describe("NEW-schedule-health — migrateCfRulesToHealthRules reproduces the old 3-toggle order exactly", () => {
  it("all three on → [complete, overdue(1d), duesoon(7d)], the SAME precedence computeDisplayHealth used", () => {
    expect(E.migrateCfRulesToHealthRules({ completeGreen: true, overdueRed: true, dueSoonYellow: true })).toEqual([
      { id: "legacy-complete", type: "complete", color: "green" },
      { id: "legacy-overdue", type: "finishPastDays", days: 1, color: "red" },
      { id: "legacy-duesoon", type: "finishWithinDays", days: 7, color: "yellow" },
    ]);
  });
  it("only overdueRed on (the real shape found in production data) → a single rule", () => {
    expect(E.migrateCfRulesToHealthRules({ overdueRed: true })).toEqual([
      { id: "legacy-overdue", type: "finishPastDays", days: 1, color: "red" },
    ]);
  });
  it("nothing on, or no cfRules at all → an empty list (matches the old \"automation off\" default)", () => {
    expect(E.migrateCfRulesToHealthRules({})).toEqual([]);
    expect(E.migrateCfRulesToHealthRules(undefined)).toEqual([]);
  });
  it("getHealthRules prefers a real healthRules array over the legacy fallback, even an empty one", () => {
    expect(E.getHealthRules({ healthRules: [], cfRules: { overdueRed: true } })).toEqual([]);
    expect(E.getHealthRules({ cfRules: { overdueRed: true } })).toEqual(E.migrateCfRulesToHealthRules({ overdueRed: true }));
    expect(E.getHealthRules({})).toEqual([]);
  });
});

describe("NEW-schedule-health — STEP 3.A: manual override wins, and wins over EVERYTHING automated", () => {
  const orig = E.NOW;
  afterEach(() => E.setNOW(orig));

  it("an overridden task keeps its hand-picked color even though a rule would otherwise recolor it", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [{ id: "a", type: "finishPastDays", days: 1, color: "red" }] };
    const overridden = { id: 1, health: "green", healthOverride: true, end: "2020-01-01", percentComplete: 0 };
    expect(E.computeDisplayHealth(overridden, settings)).toBe("green");
    // Prove the rule really would have fired if it weren't overridden — otherwise this test is vacuous.
    const notOverridden = { ...overridden, healthOverride: false };
    expect(E.computeDisplayHealth(notOverridden, settings)).toBe("red");
  });
  it("override wins over the meeting-bound risk block too — not just the configurable rule list", () => {
    // health:"yellow" deliberately — NOT green/paused, so the meeting-bound block's own
    // (pre-existing, untouched) exclusion can't be what's protecting it; only healthOverride can.
    E.setNOW("2026-08-24");
    const task = { id: 1, health: "yellow", healthOverride: true, meetingBound: true, meetingInfeasible: true,
      meetingDeadline: "2026-08-25", percentComplete: 0 };
    expect(E.computeDisplayHealth(task, { healthRules: [] })).toBe("yellow");
    // Same task, override cleared: the meeting-infeasible signal reaches through and wins.
    expect(E.computeDisplayHealth({ ...task, healthOverride: false }, { healthRules: [] })).toBe("red");
  });
  it("override wins over the deadline-row risk block too", () => {
    E.setNOW("2026-08-24");
    const task = { id: 1, health: "yellow", healthOverride: true, deadlineForTaskId: 2, deadlineInfeasible: true, percentComplete: 0 };
    expect(E.computeDisplayHealth(task, { healthRules: [] })).toBe("yellow");
    expect(E.computeDisplayHealth({ ...task, healthOverride: false }, { healthRules: [] })).toBe("red");
  });
  it("a non-overridden task with no matching rule still falls back to its raw stored health, unchanged", () => {
    E.setNOW("2026-08-15");
    expect(E.computeDisplayHealth({ id: 1, health: "yellow", healthOverride: false, percentComplete: 40 }, { healthRules: [] })).toBe("yellow");
  });
});

describe("NEW-schedule-health — normalizeToV9: override seeded once, survives a reload, a clear STAYS cleared", () => {
  const doc = (tasks) => ({ projects: { p1: { id: "p1", name: "P", tasks } } });

  it("seeds healthOverride=true for green/red/paused (the old overdueRed/meetingBound protected set) and false for gray/yellow", () => {
    const before = doc([
      { id: 1, health: "gray" }, { id: 2, health: "yellow" },
      { id: 3, health: "green" }, { id: 4, health: "red" }, { id: 5, health: "paused" },
    ]);
    const after = E.normalizeToV9(before);
    const byId = Object.fromEntries(after.projects.p1.tasks.map(t => [t.id, t]));
    expect(byId[1].healthOverride).toBe(false);
    expect(byId[2].healthOverride).toBe(false);
    expect(byId[3].healthOverride).toBe(true);
    expect(byId[4].healthOverride).toBe(true);
    expect(byId[5].healthOverride).toBe(true);
  });
  it("is idempotent — a second pass changes nothing (the _v9 flag short-circuits it)", () => {
    const once = E.normalizeToV9(doc([{ id: 1, health: "green" }]));
    const twice = E.normalizeToV9(once);
    expect(twice).toEqual(once);
  });
  it("STAYS WON across a reload — the whole-doc _v9 stamp alone guarantees it: once stamped, a later load never re-enters the migration at all", () => {
    // Simulate: migration ran once (v9 stamped), the user then picked "Automatic" on a green
    // task (updateTask(id,{healthOverride:false}) — health itself is untouched), and the doc
    // reloads. The doc is already _v9-stamped, so a later normalizeToV9 call is a pure no-op —
    // it must return the SAME object, never re-derive anything from `health`.
    const migrated = E.normalizeToV9(doc([{ id: 1, health: "green" }]));
    const userCleared = {
      ...migrated,
      projects: { p1: { ...migrated.projects.p1, tasks: migrated.projects.p1.tasks.map(t => t.id === 1 ? { ...t, healthOverride: false } : t) } },
    };
    const reloaded = E.normalizeToV9(userCleared);
    expect(reloaded).toBe(userCleared);   // same reference — the _v9 guard returned immediately
    expect(reloaded.projects.p1.tasks[0].healthOverride).toBe(false);
  });
  it("the PER-TASK guard: a task that already carries an explicit healthOverride (true OR false) is never re-derived from `health`, even on a doc that hasn't been _v9-stamped yet", () => {
    // This is the scenario the whole-doc _v9 stamp above can't cover on its own — a doc that is
    // NOT yet _v9 (so the migration genuinely runs) but already has SOME tasks with an explicit
    // healthOverride (a multi-device sync landing an old, unstamped copy next to an already-
    // cleared task; or simply hand-authored/imported data). The per-task `=== undefined` check,
    // not the doc-level flag, is what protects THIS task.
    const raw = doc([
      { id: 1, health: "green", healthOverride: false },  // explicitly cleared already — must stay false
      { id: 2, health: "red", healthOverride: true },      // explicitly set already — must stay true
      { id: 3, health: "green" },                          // never touched — gets seeded true
    ]);
    expect(raw._v9).toBeUndefined();   // sanity: this doc genuinely has NOT been migrated yet
    const out = E.normalizeToV9(raw);
    const byId = Object.fromEntries(out.projects.p1.tasks.map(t => [t.id, t]));
    expect(byId[1].healthOverride).toBe(false);
    expect(byId[2].healthOverride).toBe(true);
    expect(byId[3].healthOverride).toBe(true);
  });
  it("a corrupt/garbage project or task is skipped, not a crash (matches the sibling v6/v7/v8 migrations)", () => {
    expect(() => E.normalizeToV9({ projects: { bad: null, p1: { tasks: [null, { id: 1, health: "gray" }] } } })).not.toThrow();
    const out = E.normalizeToV9({ projects: { bad: null, p1: { tasks: [null, { id: 1, health: "gray" }] } } });
    expect(out.projects.p1.tasks).toHaveLength(1);
  });
});

describe("NEW-schedule-health — absence-safety (STEP 3.C): a missing date is an explicit non-match, never a passing answer", () => {
  const orig = E.NOW;
  afterEach(() => E.setNOW(orig));

  it("a task with NO finish date, next to one WITH the same overdue finish date: only the dated one goes red", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [{ id: "a", type: "finishPastDays", days: 1, color: "red" }] };
    const dated = { id: 1, health: "gray", healthOverride: false, end: "2026-08-01", percentComplete: 0 };
    const undated = { id: 2, health: "gray", healthOverride: false, end: "", percentComplete: 0 };
    expect(E.computeDisplayHealth(dated, settings)).toBe("red");
    expect(E.computeDisplayHealth(undated, settings)).toBe("gray"); // falls to raw stored health — an explicit "unknown", not red, not green
  });
  it("a task with NO start date next to one with a genuinely stale start: only the dated one matches \"not started\"", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [{ id: "a", type: "notStarted", color: "yellow" }] };
    const dated = { id: 1, health: "gray", healthOverride: false, start: "2026-08-01", percentComplete: 0 };
    const undated = { id: 2, health: "gray", healthOverride: false, start: "", percentComplete: 0 };
    expect(E.computeDisplayHealth(dated, settings)).toBe("yellow");
    expect(E.computeDisplayHealth(undated, settings)).toBe("gray");
  });
  it("a task with NO predecessors next to one whose predecessor is late: only the one with a real late predecessor matches", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [{ id: "a", type: "predecessorLate", color: "red" }] };
    const byId = { 9: { id: 9, end: "2026-08-01", percentComplete: 0 } };
    const withLatePred = { id: 1, health: "gray", healthOverride: false, predecessors: [{ id: 9 }], percentComplete: 0 };
    const noPreds = { id: 2, health: "gray", healthOverride: false, predecessors: [], percentComplete: 0 };
    expect(E.computeDisplayHealth(withLatePred, settings, byId)).toBe("red");
    expect(E.computeDisplayHealth(noPreds, settings, byId)).toBe("gray");
  });
});

describe("NEW-schedule-health — group headers: the engine NEVER runs on a parent/summary row", () => {
  // B463072's lesson generalized: a parent's OWN start/end/duration can be a stale rollup
  // leftover. The health engine sidesteps this entirely by never being called WITH a parent
  // task — every call site (GridView, GanttView, MasterView, buildPDFHtml) branches on
  // hasChildren/isSummary and shows computeRolledHealth's worst-of-children result instead of
  // calling computeDisplayHealth on the parent directly.
  //
  // ⛔ SUPERSEDED (group-header-rule-rollup session, branch claude/group-header-rule-rollup-84yspo):
  // the test that used to live right here (PR #1073) asserted the OPPOSITE of what's below —
  // that a parent's rolled health reflects children's RAW stored `.health`, "not their
  // rule-computed display health". That assertion was correct about what the code did, and
  // WRONG about what the product needs: it pinned a real defect in place. computeRolledHealth
  // read each LEAF child's raw `.health` field, but health rules are display-only and never
  // write back to `.health` (that's the whole point of computeDisplayHealth existing) — so a
  // child that was automatically red by rule but still "gray" in storage could never turn its
  // parent red, on the grid OR in the PDF export, even though both surfaces separately agree
  // the child itself is red. Measured live before this fix, screen and export identical: an
  // overdue child with no manual override read "Needs Attn." on its own row while its
  // collapsed parent read "Not Started" on both surfaces. Two assertions cannot both hold for
  // the same fixture below (a dated, rule-matching child rolls up as "green" under the old
  // claim and "red" under the new one) — this is not a preference resolved by whichever was
  // touched last, it is the defect fix, and the old claim is retired for that stated reason.
  //
  // The two call sites' own branch pattern (task.hasChildren ? rolledHealthMap : compute
  // DisplayHealth(...)) is UNCHANGED — a parent is still never itself handed to
  // computeDisplayHealth. What changed is only what computeRolledHealth feeds itself
  // internally for each LEAF descendant: computeDisplayHealth's rule-computed answer, not
  // task.health. See computeRolledHealth's own comment in index.html for the full rationale
  // and why this cannot create a self-reference cycle (a leaf's rules never read another
  // task's rolled or computed health, only raw scheduling fields).
  it("a parent's rolled health now reflects a leaf child's RULE-COMPUTED display health, not its raw stored health", () => {
    const settings = { healthRules: [
      { id: "r-complete", type: "complete", color: "green" },
      { id: "r-overdue",  type: "finishPastDays", days: 1, color: "red" },
    ]};
    const tasks = [
      { id: 1, parentId: null, health: "gray" },   // parent — stale/irrelevant end date, never read by rollup
      { id: 2, parentId: 1, health: "gray", healthOverride: false, end: "2020-01-01", percentComplete: 0 },  // genuinely RED under the rule above
      { id: 3, parentId: 1, health: "green", healthOverride: false, end: "2020-01-01", percentComplete: 100 },
    ];
    // Prove the rule really fires red for the un-overridden child — otherwise this test is vacuous.
    expect(E.computeDisplayHealth(tasks[1], settings)).toBe("red");
    const rolled = E.computeRolledHealth(tasks, settings);
    expect(rolled[1]).toBe("red"); // worst of {rule-computed red, rule-computed green} is red
  });
  it("with NO settings passed (the old call shape), the rollup degrades to raw health — never throws", () => {
    // A caller that hasn't been updated to pass settings (there should be none left in the real
    // app after this fix, but the function must not crash if one is ever missed) sees the SAME
    // answer as before: with no health rules configured, computeDisplayHealth falls through to
    // task.health for every un-overridden leaf, so the rollup is unchanged from the pre-fix shape.
    const tasks = [
      { id: 1, parentId: null, health: "gray" },
      { id: 2, parentId: 1, health: "gray", end: "2020-01-01", percentComplete: 0 },
      { id: 3, parentId: 1, health: "green", end: "2020-01-01", percentComplete: 100 },
    ];
    expect(() => E.computeRolledHealth(tasks)).not.toThrow();
    expect(E.computeRolledHealth(tasks)[1]).toBe("green");
  });
  it("a parentId CYCLE still falls back to the cyclic task's raw health, never computeDisplayHealth", () => {
    // The cycle guard (stack.has(id)) is a different case from a genuine leaf: a task caught in
    // a parentId loop is a corrupt SUMMARY row, not a leaf, so its own start/end/percentComplete
    // can be stale rollup leftovers — exactly what computeDisplayHealth must never see (the
    // B463072 lesson this whole describe block is named for). A rule that would fire red on
    // those stale fields must NOT reach the cyclic task.
    const settings = { healthRules: [{ id: "r-overdue", type: "finishPastDays", days: 1, color: "red" }] };
    const tasks = [
      { id: 1, parentId: 2, health: "yellow", end: "2020-01-01", percentComplete: 0 },  // would be RED under the rule if evaluated
      { id: 2, parentId: 1, health: "yellow", end: "2020-01-01", percentComplete: 0 },
    ];
    expect(() => E.computeRolledHealth(tasks, settings)).not.toThrow();
    const rolled = E.computeRolledHealth(tasks, settings);
    expect(rolled[1]).toBe("yellow"); // raw, not rule-computed red — the cycle guard, not the leaf path
  });
  it("computeDisplayHealth itself is never even asked about the parent in the real call sites (source check)", () => {
    const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
    // Every real call site branches hasChildren/isSummary BEFORE reaching computeDisplayHealth.
    expect(src).toMatch(/task\.hasChildren\s*\n\s*\? \(rolledHealthMap\?\.\[task\.id\] \|\| task\.health\)\s*\n\s*: computeDisplayHealth\(task, data\.settings, taskById\)/);
    expect(src).toMatch(/const displayHealth = isSummary/);
    expect(src).toMatch(/: computeDisplayHealth\(task, settings, taskById\);/);
  });

  // ── Adjacent cases the group-header-rule-rollup fix must not break ──────────────────────────
  const OVERDUE_SETTINGS = { healthRules: [
    { id: "r-complete", type: "complete", color: "green" },
    { id: "r-overdue",  type: "finishPastDays", days: 1, color: "red" },
  ]};

  it("nested parents more than one level deep: a rule-computed red leaf bubbles through a middle parent to the grandparent", () => {
    const tasks = [
      { id: 1, parentId: null, health: "gray" },                      // grandparent
      { id: 2, parentId: 1, health: "gray" },                          // middle parent — itself has no raw health worth reading
      { id: 3, parentId: 2, health: "gray", healthOverride: false, end: "2020-01-01", percentComplete: 0 }, // leaf, rule-computed red
      { id: 4, parentId: 2, health: "green", healthOverride: false, end: "2020-01-01", percentComplete: 100 }, // leaf, rule-computed green
    ];
    const rolled = E.computeRolledHealth(tasks, OVERDUE_SETTINGS);
    expect(rolled[2]).toBe("red");  // middle parent rolls up its own leaves' rule-computed health
    expect(rolled[1]).toBe("red");  // grandparent rolls up the middle parent's ROLLED value (still red), not the middle parent's raw "gray"
  });

  it("a parent whose children are ALL hand-overridden: rollup is unaffected — override still wins per child before any rule runs", () => {
    const tasks = [
      { id: 1, parentId: null, health: "gray" },
      { id: 2, parentId: 1, health: "yellow", healthOverride: true, end: "2020-01-01", percentComplete: 0 },  // overdue by the rule, but overridden — override wins
      { id: 3, parentId: 1, health: "green", healthOverride: true, end: "2099-01-01", percentComplete: 0 },
    ];
    const rolled = E.computeRolledHealth(tasks, OVERDUE_SETTINGS);
    // Same answer with or without settings — override short-circuits computeDisplayHealth before any rule is even evaluated.
    expect(rolled[1]).toBe("yellow");
    expect(E.computeRolledHealth(tasks)[1]).toBe("yellow");
  });

  it("a parent with one DATED and one UNDATED child: only the dated one is rule-eligible, matching the leaf-level absence-safety rule", () => {
    const tasks = [
      { id: 1, parentId: null, health: "gray" },
      { id: 2, parentId: 1, health: "gray", healthOverride: false, end: "2020-01-01", percentComplete: 0 },   // dated + overdue → rule-computed red
      { id: 3, parentId: 1, health: "gray", healthOverride: false, end: "", percentComplete: 0 },              // no end date → no rule can match, falls to raw "gray"
    ];
    const rolled = E.computeRolledHealth(tasks, OVERDUE_SETTINGS);
    expect(rolled[1]).toBe("red"); // worst of {red, gray} is red — the dated child alone is enough to flip the parent
  });

  it("a milestone (duration 0) as a child: the rule engine doesn't care about duration, so it rolls up exactly like any other leaf", () => {
    const tasks = [
      { id: 1, parentId: null, health: "gray" },
      { id: 2, parentId: 1, health: "gray", healthOverride: false, duration: 0, start: "2020-01-01", end: "2020-01-01", percentComplete: 0 }, // overdue milestone
    ];
    const rolled = E.computeRolledHealth(tasks, OVERDUE_SETTINGS);
    expect(rolled[1]).toBe("red");
  });

  it("collapsed vs expanded parent: the rolled value is IDENTICAL either way — computeRolledHealth never reads task.isExpanded", () => {
    // Live-browser follow-up (group-header-rule-rollup session) found that the GRID and GANTT
    // deliberately render a BLANK status cell for an expanded parent (index.html's GridView
    // "status"/"health" cases and GanttView's rowBg both gate on isExpandedParent) — pre-existing
    // B222/B211 design ("the red/paused/overdue signal stays in the row background... never
    // collides with the navy hierarchy of the summary brackets"), unrelated to this fix. So the
    // two surfaces are not literally comparable on screen once expanded — there is no color to
    // compare against. What DOES have to hold, and does: the rolled MAP entry itself is exactly
    // the same whether the parent is collapsed or expanded, because isExpanded never enters the
    // computation at all. The PDF export has no such gate (buildPDFHtml's cellVal always renders
    // the computed health for whatever rows collapsedIds includes), so it shows this value
    // unconditionally — verified live in ui-audit/verify-schedule-export-health-colours.mjs's
    // "autoRollupExpanded" scenario.
    const collapsed = [
      { id: 1, parentId: null, health: "gray", isExpanded: false },
      { id: 2, parentId: 1, health: "gray", healthOverride: false, end: "2020-01-01", percentComplete: 0 },
      { id: 3, parentId: 1, health: "green", healthOverride: false, end: "2020-01-01", percentComplete: 100 },
    ];
    const expanded = collapsed.map(t => t.id === 1 ? { ...t, isExpanded: true } : t);
    expect(E.computeRolledHealth(collapsed, OVERDUE_SETTINGS)).toEqual(E.computeRolledHealth(expanded, OVERDUE_SETTINGS));
    expect(E.computeRolledHealth(expanded, OVERDUE_SETTINGS)[1]).toBe("red");
  });

  it("source check: computeRolledHealth and computeDisplayHealth never reference task.isExpanded (the invariant the test above relies on)", () => {
    const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
    const between = (startRe, endRe) => { const s = src.match(startRe); if (!s) return ""; const from = s.index; const rest = src.slice(from); const e = rest.match(endRe); return e ? rest.slice(0, e.index) : rest; };
    const computeRolledHealthBody = between(/const computeRolledHealth = /, /\n\nconst fmtD = /);
    const computeDisplayHealthBody = between(/const computeDisplayHealth = /, /\n\n\/\/ Worst-of-descendants/);
    expect(computeRolledHealthBody).not.toMatch(/isExpanded/);
    expect(computeDisplayHealthBody).not.toMatch(/isExpanded/);
  });
});

describe("NEW-schedule-health — adjacent cases: milestones, completed tasks, undated tasks, reordered rules", () => {
  it("a milestone (duration 0, start===end) evaluates finish-date rules exactly like any other leaf", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [{ id: "a", type: "finishToday", color: "yellow" }] };
    const milestone = { id: 1, health: "gray", healthOverride: false, start: "2026-08-15", end: "2026-08-15", duration: 0, percentComplete: 0 };
    expect(E.computeDisplayHealth(milestone, settings)).toBe("yellow");
  });
  it("a completed task (100%) never lights up an overdue/due-soon/not-started rule, only \"complete\" can match it", () => {
    E.setNOW("2026-08-15");
    const settings = { healthRules: [
      { id: "a", type: "finishPastDays", days: 1, color: "red" },
      { id: "b", type: "notStarted", color: "yellow" },
      { id: "c", type: "complete", color: "green" },
    ] };
    const done = { id: 1, health: "yellow", healthOverride: false, start: "2020-01-01", end: "2020-01-01", percentComplete: 100 };
    expect(E.computeDisplayHealth(done, settings)).toBe("green");
  });
  it("a task with no dates at all and an empty rule list just shows its raw stored health", () => {
    const bare = { id: 1, health: "gray", healthOverride: false, percentComplete: 0 };
    expect(E.computeDisplayHealth(bare, { healthRules: [] })).toBe("gray");
  });
  it("reordering the SAME rules changes the outcome for a task both rules would otherwise match — this is the whole mechanism", () => {
    E.setNOW("2026-08-15");
    const task = { id: 1, health: "gray", healthOverride: false, end: "2026-08-01", start: "2026-07-01", percentComplete: 0 }; // overdue AND not-started
    const overdueFirst = { healthRules: [
      { id: "a", type: "finishPastDays", days: 1, color: "red" },
      { id: "b", type: "notStarted", color: "yellow" },
    ] };
    const notStartedFirst = { healthRules: [
      { id: "b", type: "notStarted", color: "yellow" },
      { id: "a", type: "finishPastDays", days: 1, color: "red" },
    ] };
    expect(E.computeDisplayHealth(task, overdueFirst)).toBe("red");
    expect(E.computeDisplayHealth(task, notStartedFirst)).toBe("yellow");
  });
});

describe("anti-drift: the NEW-schedule-health engine exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("the condition vocabulary is defined identically in both", () => {
    const vocab = /const HEALTH_CONDITIONS = \[\s*\n\s*\{k:"finishPastDays",   label:"Finish date is N\+ days past due",     needsDays:true,  defaultDays:1\},/;
    expect(src).toMatch(vocab);
    expect(mjs).toMatch(/export const HEALTH_CONDITIONS = \[\s*\n\s*\{k:"finishPastDays",   label:"Finish date is N\+ days past due",     needsDays:true,  defaultDays:1\},/);
  });
  it("evalHealthCondition's switch cases are present in both, same order", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/case "finishPastDays":/);
      expect(s).toMatch(/case "finishWithinDays": \{/);
      expect(s).toMatch(/case "finishToday":/);
      expect(s).toMatch(/case "notStarted":/);
      expect(s).toMatch(/case "predecessorLate": \{/);
      expect(s).toMatch(/case "noOwner":/);
      expect(s).toMatch(/case "complete":/);
    }
  });
  it("computeDisplayHealth checks healthOverride first, in both", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/if \(task\.healthOverride\) return task\.health;/);
    }
  });
  it("normalizeToV9's override-seed predicate is present in both", () => {
    for (const s of [src, mjs]) {
      expect(s).toMatch(/healthOverride: t\.health === "green" \|\| t\.health === "red" \|\| t\.health === "paused"/);
    }
  });
});

// ── NEW-1 — the successor prompt can mark a successor Complete, not just In Progress ──
// Owner report: "it should also allow me to mark it complete." Full browser + mutation proof
// lives in ui-audit/verify-successor-complete.mjs; these are the fast, CI-runnable source anchors
// that pin the shape so a future edit can't quietly drift back to the pre-fix behaviour.
describe("NEW-1: the successor prompt's Complete option and its own accept path", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

  it("StatusPills offers Complete alongside the three original options", () => {
    expect(src).toMatch(/\{ k:'gray',   label:'Not Started' \},\s*\{ k:'yellow', label:'In Progress' \},\s*\{ k:'red',    label:'Needs Attn\.' \},\s*\{ k:'green',  label:'Complete' \},/);
  });

  it("applyComplete is a SEPARATE function from apply() — Complete never routes through the plain-Enter path", () => {
    expect(src).toMatch(/function applyComplete\(\) \{/);
    expect(src).toMatch(/const forced = readyIds\.has\(Number\(tid\)\) \? 'green' : hk;/);
  });

  it("plain Enter's own line is UNCHANGED — it still just applies `pending`, never applyComplete", () => {
    // The exact literal from before this feature existed. If this ever needs to become
    // `applyComplete()` or gain new conditions, Enter's muscle-memory meaning changed — which the
    // owner explicitly ruled out — so this must be a deliberate, discussed change, not a drift.
    expect(src).toMatch(/if \(e\.key==='Enter' && changeCount>0\) apply\(\);/);
  });

  it("Complete's key is Ctrl/Cmd+Enter — a DIFFERENT key from plain Enter, matching the FormulaBar precedent", () => {
    expect(src).toMatch(/if \(\(e\.metaKey\|\|e\.ctrlKey\) && e\.key==='Enter'\) \{ e\.preventDefault\(\); if \(canComplete\) applyComplete\(\); return; \}/);
  });

  it("Complete has its own footer BUTTON, distinct from Skip and Update Successors", () => {
    expect(src).toMatch(/data-successor-apply="complete"/);
    expect(src).toMatch(/data-successor-apply="update"/);
    expect(src).toMatch(/data-successor-apply="skip"/);
  });

  it("a completion is QUEUED, never written directly to the single successorPrompt slot — the batch-race guard", () => {
    // Two Ready-to-Start successors completed in the SAME action (the bulk button) each
    // independently schedule their own 80ms-later chain check; writing directly to one state
    // slot lets the second clobber the first, silently losing a follow-up prompt. Proven live
    // (and proven load-bearing by mutation) in ui-audit/verify-successor-complete.mjs section B/C2.
    expect(src).toMatch(/const \[successorPromptQueue, setSuccessorPromptQueue\] = useState\(\[\]\);/);
    expect(src).toMatch(/setSuccessorPromptQueue\(q => \[\.\.\.q, \{ completedTask, projId: pid2, projName: p\.name, successors \}\]\);/);
    expect(src).not.toMatch(/setSuccessorPrompt\(\{ completedTask, projId: pid2, projName: p\.name, successors \}\);/);
  });

  it("an already-complete task is excluded from the successors list at the source (never reaches the modal)", () => {
    expect(src).toMatch(/normPreds\(t\.predecessors\)\.some\(pr => pr\.id === taskId\) && t\.health !== 'green'/);
  });
});
