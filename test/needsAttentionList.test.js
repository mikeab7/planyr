import { describe, it, expect } from "vitest";
import { needsAttentionList, needsAttentionTotals, attentionBarFraction } from "../src/workspaces/dashboard/lib/needsAttentionList.js";

const NOW = Date.parse("2026-09-06T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

describe("needsAttentionList", () => {
  it("returns one row per stamped leaf task, across every project, sorted DESC by days since stamped", () => {
    // B1939344 — `linkedSiteName` set on both, so `projectName` resolves to the qualified
    // "<Project> / <Schedule>" label (crossScheduleLabel), not the bare schedule name.
    const projects = {
      1: {
        id: 1, name: "Goose Creek", linkedSiteId: "g1", linkedSiteName: "Goose Creek",
        tasks: [
          { id: 1, name: "Zoning letter", end: "2026-09-10", parentId: null, health: "red", needsAttentionSince: daysAgo(3) },
          { id: 2, name: "Phase 1 ESA", end: "2026-09-01", parentId: null, health: "red", needsAttentionSince: daysAgo(20) },
        ],
      },
      2: {
        id: 2, name: "Grand Port", linkedSiteId: "g2", linkedSiteName: "Grand Port",
        tasks: [
          { id: 10, name: "Survey", end: "2026-08-15", parentId: null, health: "red", needsAttentionSince: daysAgo(9) },
          { id: 11, name: "Not stamped", end: "2026-08-01", parentId: null, needsAttentionSince: null },
        ],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows.map((r) => r.taskName)).toEqual(["Phase 1 ESA", "Survey", "Zoning letter"]);
    expect(rows.map((r) => r.days)).toEqual([20, 9, 3]);
    expect(rows[0].projectName).toBe("Goose Creek / Goose Creek");
  });

  // B1939344 (NEW-1) — the exact shape the owner's own account hit: two schedules sharing a name
  // ("Master Schedule") under different projects. On unmodified main both rows' `projectName` read
  // the identical bare string, which is the defect this item ships against.
  it("RED-PROOF (fails on unmodified main): two schedules named identically under different projects produce distinct projectName strings", () => {
    const projects = {
      1: {
        id: 1, name: "Master Schedule", linkedSiteId: "g1", linkedSiteName: "Goose Creek",
        tasks: [{ id: 1, name: "Zoning letter", end: "2026-09-10", parentId: null, health: "red", needsAttentionSince: daysAgo(3) }],
      },
      2: {
        id: 2, name: "Master Schedule", linkedSiteId: "g2", linkedSiteName: "Grand Port",
        tasks: [{ id: 10, name: "Survey", end: "2026-08-15", parentId: null, health: "red", needsAttentionSince: daysAgo(9) }],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    const byTask = Object.fromEntries(rows.map((r) => [r.taskName, r.projectName]));
    expect(byTask["Zoning letter"]).toBe("Goose Creek / Master Schedule");
    expect(byTask["Survey"]).toBe("Grand Port / Master Schedule");
    expect(byTask["Zoning letter"]).not.toBe(byTask["Survey"]);
  });

  it("an org-owned schedule's rows are prefixed 'Organization', never a bare schedule name", () => {
    const projects = {
      5: {
        id: 5, name: "Pursuits", ownerKind: "org",
        tasks: [{ id: 1, name: "Follow up", end: "2026-09-01", parentId: null, health: "red", needsAttentionSince: daysAgo(2) }],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows[0].projectName).toBe("Organization / Pursuits");
  });

  it("never substitutes days-past-due for 'since' — a task that is not red is absent whatever its stamp; a red task with no stamp lists as sinceKnown:false", () => {
    const projects = { 1: { id: 1, name: "P", tasks: [
      { id: 1, name: "Overdue, no rules, not red", end: "2020-01-01", parentId: null },
      { id: 2, name: "Red, never stamped", parentId: null, health: "red" },
    ] } };
    const rows = needsAttentionList(projects, NOW);
    expect(rows.map((r) => r.taskName)).toEqual(["Red, never stamped"]);
    expect(rows[0].sinceKnown).toBe(false);
    expect(rows[0].days).toBe(0);
    expect(rows[0].bulkStamped).toBe(false);
  });

  // B1953795 (S5) — RED-PROOF (fails on main, which trusted the stamp): the stamp is only written while
  // the Scheduler iframe is mounted, so a task edited/completed elsewhere kept a stale stamp, and a
  // task that turned overdue while the Scheduler was closed had none. Membership is decided at READ
  // time by the grid's own rules; the stamp only supplies "since".
  it("S5: a STALE stamp on a task that is no longer red (completed) is dropped; an unstamped task the rules make red is listed", () => {
    const rules = { healthRules: [{ id: "r", when: [{ field: "finish", op: "pastDueAtLeast", value: 1 }], whenCombinator: "AND", color: "red",
      unless: [{ field: "status", op: "is", value: "green" }], unlessCombinator: "OR" }] };
    const projects = { 1: { id: 1, name: "P", tasks: [
      { id: 1, name: "Stale stamp, now 100% done", end: "2026-08-01", percentComplete: 100, health: "gray", parentId: null, needsAttentionSince: daysAgo(30) },
      { id: 2, name: "Overdue, never stamped", end: "2026-08-01", percentComplete: 0, health: "gray", parentId: null },
    ] } };
    const rows = needsAttentionList(projects, NOW, rules);
    expect(rows.map((r) => r.taskName)).toEqual(["Overdue, never stamped"]);
  });

  it("excludes summary/parent rows — only leaves are counted, even if a parent carries the field", () => {
    const projects = {
      1: {
        id: 1, name: "P",
        tasks: [
          { id: 1, name: "Parent", parentId: null, health: "red", needsAttentionSince: daysAgo(5) },
          { id: 2, name: "Child", parentId: 1, health: "red", needsAttentionSince: daysAgo(1) },
        ],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows.map((r) => r.taskId)).toEqual([2]);
  });

  it("counts successors — how many other tasks name this one as a predecessor — as `waiting`", () => {
    const projects = {
      1: {
        id: 1, name: "P",
        tasks: [
          { id: 1, name: "Blocker", parentId: null, health: "red", needsAttentionSince: daysAgo(4) },
          { id: 2, name: "Downstream A", parentId: null, predecessors: [{ id: 1, type: "FS", lag: 0 }] },
          { id: 3, name: "Downstream B", parentId: null, predecessors: [1] },
          { id: 4, name: "Unrelated", parentId: null, predecessors: [] },
        ],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].waiting).toBe(2);
  });

  it("handles empty/missing input without throwing", () => {
    expect(needsAttentionList(null)).toEqual([]);
    expect(needsAttentionList({})).toEqual([]);
    expect(needsAttentionList({ 1: { tasks: null } })).toEqual([]);
  });

  // B1411504 — the Scheduler's reconcileNeedsAttention stamps EVERY already-red task with one
  // shared `nowIso` on the first load of an existing schedule after this field shipped, so a
  // bare `days` count is meaningless for those rows (confirmed on the owner's real account: 25 of
  // 31 currently-flagged tasks share one exact stamp, another 6 share a second). `bulkStamped`
  // must flag exactly the rows sharing an exact timestamp with another row, account-wide — never
  // a row whose stamp is unique, even if its `days` value happens to collide with someone else's
  // after flooring to whole days.
  it("flags a row bulkStamped only when its EXACT needsAttentionSince is shared with another row", () => {
    const sharedStamp = daysAgo(2);
    const projects = {
      1: {
        id: 1, name: "Goose Creek",
        tasks: [
          { id: 1, name: "Bulk A", parentId: null, health: "red", needsAttentionSince: sharedStamp },
          { id: 2, name: "Genuinely new", parentId: null, health: "red", needsAttentionSince: null }, // overwritten below with a unique stamp
        ],
      },
      2: {
        id: 2, name: "Grand Port",
        tasks: [
          { id: 10, name: "Bulk B", parentId: null, health: "red", needsAttentionSince: sharedStamp },
        ],
      },
    };
    // Force the "Genuinely new" task onto its OWN unique millisecond so it cannot accidentally
    // collide with `sharedStamp` (both were built from whole-day offsets and would otherwise tie).
    projects[1].tasks[1].needsAttentionSince = new Date(Date.parse(sharedStamp) + 1000).toISOString();

    const rows = needsAttentionList(projects, NOW);
    const byName = Object.fromEntries(rows.map((r) => [r.taskName, r]));
    expect(byName["Bulk A"].bulkStamped).toBe(true);
    expect(byName["Bulk B"].bulkStamped).toBe(true);
    expect(byName["Genuinely new"].bulkStamped).toBe(false);
  });

  it("ties on `days` break by `waiting` (more blocked downstream work first), then task name — never insertion order", () => {
    const sharedStamp = daysAgo(2);
    const projects = {
      1: {
        id: 1, name: "P",
        tasks: [
          { id: 1, name: "Zero waiting", parentId: null, health: "red", needsAttentionSince: sharedStamp },
          { id: 2, name: "Blocks two", parentId: null, health: "red", needsAttentionSince: sharedStamp },
          { id: 3, name: "A downstream of Blocks two", parentId: null, predecessors: [2] },
          { id: 4, name: "B downstream of Blocks two", parentId: null, predecessors: [2] },
        ],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows.map((r) => r.taskName)).toEqual(["Blocks two", "Zero waiting"]);
    expect(rows[0].waiting).toBe(2);
  });
});

describe("needsAttentionTotals", () => {
  it("sums rows per project, loudest first, ties broken by name", () => {
    const rows = [
      { projectId: "a", projectName: "Grand Port", days: 1 },
      { projectId: "a", projectName: "Grand Port", days: 2 },
      { projectId: "b", projectName: "8 South", days: 1 },
      { projectId: "b", projectName: "8 South", days: 1 },
      { projectId: "b", projectName: "8 South", days: 1 },
    ];
    expect(needsAttentionTotals(rows)).toEqual([
      { projectId: "b", projectName: "8 South", count: 3 },
      { projectId: "a", projectName: "Grand Port", count: 2 },
    ]);
  });

  it("empty input returns an empty list", () => {
    expect(needsAttentionTotals([])).toEqual([]);
    expect(needsAttentionTotals(undefined)).toEqual([]);
  });
});

describe("attentionBarFraction", () => {
  it("scales linearly against the top row's day count", () => {
    expect(attentionBarFraction(20, 20)).toBe(1);
    expect(attentionBarFraction(10, 20)).toBe(0.5);
    expect(attentionBarFraction(0, 20)).toBe(0);
  });

  it("never divides by zero — a zero or missing max reads as zero, not NaN/Infinity", () => {
    expect(attentionBarFraction(5, 0)).toBe(0);
    expect(attentionBarFraction(5, null)).toBe(0);
  });
});
