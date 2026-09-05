import { describe, it, expect } from "vitest";
import { groupProjectsByGroupId, pipelineCounts, pursuitsByActivity, goingQuiet, mostRecentProject } from "../src/workspaces/dashboard/lib/dashboardPipeline.js";

const NOW = Date.parse("2026-09-05T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

describe("groupProjectsByGroupId", () => {
  it("collapses multiple plans sharing a group_id into one project, counting plans", () => {
    const rows = [
      { id: "p1", group_id: "g1", site: "Goose Creek", county: "chambers", status: "active", role: "pursuit", updated_at: daysAgo(5) },
      { id: "p2", group_id: "g1", site: "Goose Creek", county: "chambers", status: "active", role: "pursuit", updated_at: daysAgo(1) },
    ];
    const out = groupProjectsByGroupId(rows);
    expect(out).toEqual([{ groupId: "g1", name: "Goose Creek", county: "chambers", status: "active", role: "pursuit", updatedAt: daysAgo(1), planCount: 2 }]);
  });

  it("uses the MOST RECENTLY UPDATED plan as the group's representative status/name/county", () => {
    const rows = [
      { id: "p1", group_id: "g1", site: "Old Name", county: "harris", status: "pursuit", role: "pursuit", updated_at: daysAgo(10) },
      { id: "p2", group_id: "g1", site: "New Name", county: "harris", status: "active", role: "pursuit", updated_at: daysAgo(1) },
    ];
    const out = groupProjectsByGroupId(rows);
    expect(out[0].name).toBe("New Name");
    expect(out[0].status).toBe("active");
  });

  it("a plan with no group_id falls back to its own id (never dropped)", () => {
    const rows = [{ id: "solo", group_id: null, site: "Solo Plan", status: "pursuit", role: "pursuit", updated_at: daysAgo(1) }];
    expect(groupProjectsByGroupId(rows)).toEqual([{ groupId: "solo", name: "Solo Plan", county: null, status: "pursuit", role: "pursuit", updatedAt: daysAgo(1), planCount: 1 }]);
  });

  it("missing status/role default to pursuit; missing name reads Untitled", () => {
    const rows = [{ id: "p1", group_id: "g1", site: "", status: null, role: null, updated_at: daysAgo(1) }];
    const out = groupProjectsByGroupId(rows);
    expect(out[0]).toMatchObject({ name: "Untitled", status: "pursuit", role: "pursuit" });
  });

  it("handles empty/missing input without throwing", () => {
    expect(groupProjectsByGroupId([])).toEqual([]);
    expect(groupProjectsByGroupId(null)).toEqual([]);
  });
});

describe("pipelineCounts", () => {
  it("counts by status, with tracked market records broken out regardless of their status field", () => {
    const projects = [
      { status: "pursuit", role: "pursuit" }, { status: "pursuit", role: "pursuit" },
      { status: "active", role: "pursuit" },
      { status: "onhold", role: "pursuit" },
      { status: "complete", role: "pursuit" },
      { status: "dead", role: "pursuit" },
      { status: "active", role: "tracked" }, // tracked — must NOT land in the "active" bucket
    ];
    expect(pipelineCounts(projects)).toEqual({ pursuit: 2, active: 1, onhold: 1, complete: 1, dead: 1, tracked: 1 });
  });

  it("empty input is all zeros", () => {
    expect(pipelineCounts([])).toEqual({ pursuit: 0, active: 0, onhold: 0, complete: 0, dead: 0, tracked: 0 });
  });
});

describe("pursuitsByActivity", () => {
  it("excludes tracked and settled (complete/dead) records, orders loudest stage first then newest", () => {
    const projects = [
      { groupId: "a", status: "onhold", role: "pursuit", updatedAt: daysAgo(1) },
      { groupId: "b", status: "pursuit", role: "pursuit", updatedAt: daysAgo(10) },
      { groupId: "c", status: "active", role: "pursuit", updatedAt: daysAgo(2) },
      { groupId: "d", status: "complete", role: "pursuit", updatedAt: daysAgo(0) },
      { groupId: "e", status: "active", role: "tracked", updatedAt: daysAgo(0) },
    ];
    expect(pursuitsByActivity(projects).map((p) => p.groupId)).toEqual(["b", "c", "a"]);
  });

  it("respects the limit", () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({ groupId: String(i), status: "pursuit", role: "pursuit", updatedAt: daysAgo(i) }));
    expect(pursuitsByActivity(projects, { limit: 3 })).toHaveLength(3);
  });
});

describe("mostRecentProject", () => {
  it("picks the single most recently updated project regardless of status or role", () => {
    const projects = [
      { groupId: "a", status: "complete", role: "pursuit", updatedAt: daysAgo(5) },
      { groupId: "b", status: "active", role: "tracked", updatedAt: daysAgo(0) },
      { groupId: "c", status: "pursuit", role: "pursuit", updatedAt: daysAgo(20) },
    ];
    expect(mostRecentProject(projects).groupId).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(mostRecentProject([])).toBe(null);
    expect(mostRecentProject(null)).toBe(null);
  });
});

describe("goingQuiet", () => {
  it("flags only OPEN projects idle at least idleDays, sorted longest-idle first", () => {
    const projects = [
      { groupId: "a", status: "active", role: "pursuit", updatedAt: daysAgo(45) },
      { groupId: "b", status: "pursuit", role: "pursuit", updatedAt: daysAgo(2) },   // too recent
      { groupId: "c", status: "onhold", role: "pursuit", updatedAt: daysAgo(90) },
      { groupId: "d", status: "complete", role: "pursuit", updatedAt: daysAgo(200) }, // settled — never "quiet"
      { groupId: "e", status: "active", role: "tracked", updatedAt: daysAgo(200) },   // tracked — excluded
    ];
    const out = goingQuiet(projects, { idleDays: 30, nowMs: NOW });
    expect(out.map((p) => p.groupId)).toEqual(["c", "a"]);
    expect(out[0].idleDays).toBe(90);
  });

  it("a project with no updatedAt is never flagged (can't compute idle time)", () => {
    expect(goingQuiet([{ groupId: "a", status: "active", role: "pursuit", updatedAt: null }], { nowMs: NOW })).toEqual([]);
  });
});
