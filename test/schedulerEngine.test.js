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
    // B616 added the durUnit/durValue stamp + finish-lock, but the startless-anchor invariant holds.
    expect(src).toMatch(/if \(u\.end && !u\.start\) \{ u\.start = u\.end; u\.durUnit = 'd'; u\.durValue = 1; u\.duration = 1; \}/);
  });
  it("the duration cell never renders a bare 'd' (fmtTaskDuration guards blank)", () => {
    // B615 routes the cell through fmtTaskDuration, which returns "" for a blank duration → no bare "d".
    expect(src).toContain("fmtTaskDuration(task)");
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
    expect(src).toMatch(/if \(overlayOpenRef\.current\) return;/);
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
  it("B615: the V7 migration is wired into the load pipeline (source + mirror)", () => {
    expect(src).toMatch(/normalizeToV7\(normalizeToV6\(/);
    expect(mjs).toMatch(/normalizeToV7\(normalizeToV6\(/);
    expect(src).toContain("_v7");
  });
  it("B615: the duration cell renders the typed unit, parses via parseDurationInput", () => {
    expect(src).toContain("fmtTaskDuration(task)");
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
