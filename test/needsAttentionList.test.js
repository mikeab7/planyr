import { describe, it, expect } from "vitest";
import { needsAttentionList, needsAttentionTotals, attentionBarFraction } from "../src/workspaces/dashboard/lib/needsAttentionList.js";

const NOW = Date.parse("2026-09-06T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

describe("needsAttentionList", () => {
  it("returns one row per stamped leaf task, across every project, sorted DESC by days since stamped", () => {
    const projects = {
      1: {
        id: 1, name: "Goose Creek", linkedSiteId: "g1",
        tasks: [
          { id: 1, name: "Zoning letter", end: "2026-09-10", parentId: null, needsAttentionSince: daysAgo(3) },
          { id: 2, name: "Phase 1 ESA", end: "2026-09-01", parentId: null, needsAttentionSince: daysAgo(20) },
        ],
      },
      2: {
        id: 2, name: "Grand Port", linkedSiteId: "g2",
        tasks: [
          { id: 10, name: "Survey", end: "2026-08-15", parentId: null, needsAttentionSince: daysAgo(9) },
          { id: 11, name: "Not stamped", end: "2026-08-01", parentId: null, needsAttentionSince: null },
        ],
      },
    };
    const rows = needsAttentionList(projects, NOW);
    expect(rows.map((r) => r.taskName)).toEqual(["Phase 1 ESA", "Survey", "Zoning letter"]);
    expect(rows.map((r) => r.days)).toEqual([20, 9, 3]);
    expect(rows[0].projectName).toBe("Goose Creek");
  });

  it("never substitutes days-past-due — a task with no stamp is simply absent", () => {
    const projects = { 1: { id: 1, name: "P", tasks: [{ id: 1, name: "Overdue but unstamped", end: "2020-01-01", parentId: null }] } };
    expect(needsAttentionList(projects, NOW)).toEqual([]);
  });

  it("excludes summary/parent rows — only leaves are counted, even if a parent carries the field", () => {
    const projects = {
      1: {
        id: 1, name: "P",
        tasks: [
          { id: 1, name: "Parent", parentId: null, needsAttentionSince: daysAgo(5) },
          { id: 2, name: "Child", parentId: 1, needsAttentionSince: daysAgo(1) },
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
          { id: 1, name: "Blocker", parentId: null, needsAttentionSince: daysAgo(4) },
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
