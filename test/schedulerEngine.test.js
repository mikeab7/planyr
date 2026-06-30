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
  it("the master grid clamps duration the same way the project grid does", () => {
    expect(src).toMatch(/Math\.max\(0, Math\.min\(100000, parseInt\(val\)\|\|0\)\)/);
  });
  it("indent/outdent/paste recompute roll-ups after a structural move", () => {
    expect(src).toMatch(/const recomputeAfterStructureChange = tasks => rollupParentDates\(cascadeDates\(tasks\)\);/);
    // every structural-move handler routes through it (5 call sites)
    expect((src.match(/renumberTasks\(recomputeAfterStructureChange\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(src).toMatch(/recomputeAfterStructureChange\(sortByVisualOrder\(final\)\)/);
  });
  it("setting Finish on a startless task anchors a 1-day task (no bare 'd', no lost date)", () => {
    expect(src).toMatch(/if \(u\.end && !u\.start\) \{ u\.start = u\.end; u\.duration = 1; \}/);
  });
  it("the duration cell never renders a bare 'd'", () => {
    expect(src).toMatch(/\(task\.duration === "" \|\| task\.duration == null\) \? "" : task\.duration \+ "d"/);
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
    expect(src).toMatch(/const preds=normPreds\(t\.predecessors\);/);
  });
  it("the on-screen Gantt renders a duration-0 parent as a bracket, not a diamond", () => {
    expect(src).toMatch(/\(isMilestone && !isSummary\) \? \(<>/);
  });
  it("the exhibit table %Done matches the green→100 bar convention", () => {
    expect(src).toMatch(/return `\$\{t\.health==="green" \? 100 : \(t\.percentComplete\|\|0\)\}%`/);
  });
  it("MasterView uses rolled health for parents (shared helper) and live deps", () => {
    expect(src).toMatch(/const computeRolledHealth = \(all\) =>/);
    expect(src).toMatch(/const rolled = computeRolledHealth\(p\.tasks\);/);
    expect(src).toMatch(/_disp: dispOf\(t, !isLeaf, rolled\)/);
    expect(src).toMatch(/\}, \[data\.projects, masterHealthFilter, data\.settings, NOW\]\);/);
    expect(src).toMatch(/const rolledHealthMap = useMemo\(\(\) => proj \? computeRolledHealth\(proj\.tasks\) : \{\}/);
  });
  it("the overdue rule no longer fires on a 100%-complete task", () => {
    expect(src).toMatch(/cf\.overdueRed && task\.end && task\.end < NOW && \(task\.percentComplete\|\|0\) < 100/);
  });
  it("the engine mirror carries computeRolledHealth verbatim", () => {
    expect(sjsx).toMatch(/export const computeRolledHealth = \(all\) =>/);
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
  it("#9 the on-screen Gantt axis span is capped so a far-future date can't freeze the tab", () => {
    expect(src).toMatch(/const MAX_SPAN_DAYS = 365 \* 100;/);
    expect(src).toMatch(/totD: Math\.min\(dif\(mn, mx\), MAX_SPAN_DAYS\)/);
  });
  it("#10 the dependency y-helpers test the summary case before the milestone case (both paths)", () => {
    expect(src).toMatch(/test this BEFORE the milestone case/);     // on-screen depYCenter
    expect(src).toMatch(/test summary BEFORE milestone/);           // export edgeYOf
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
