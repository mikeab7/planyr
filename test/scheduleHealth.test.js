import { describe, it, expect } from "vitest";
import { summarizeProjectHealth, summarizeScheduleHealth } from "../src/workspaces/dashboard/lib/scheduleHealth.js";

const NOW = Date.parse("2026-09-05T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);

describe("summarizeProjectHealth", () => {
  it("buckets a mix of tasks into complete / overdue / at-risk / on-track", () => {
    const project = {
      tasks: [
        { id: 1, health: "green", end: daysAgo(30) },              // complete — health wins regardless of date
        { id: 2, health: "gray", end: daysAgo(5) },                 // overdue — past end, not complete/paused
        { id: 3, health: "red", end: daysAgo(1) },                  // overdue
        { id: 4, health: "gray", end: daysFromNow(3) },             // at-risk — due soon
        { id: 5, health: "gray", end: daysFromNow(30) },            // on-track — due later
        { id: 6, health: "paused", end: daysAgo(90) },              // on-track — paused is exempt from overdue
        { id: 7, health: "gray", end: "" },                         // on-track — no end date at all
      ],
    };
    expect(summarizeProjectHealth(project, NOW)).toEqual({
      complete: 1, overdue: 2, atRisk: 1, onTrack: 3, total: 7,
    });
  });

  it("excludes parent/summary rows (any task that is another task's parentId) from the count", () => {
    const project = {
      tasks: [
        { id: 1, parentId: null, health: "gray", end: daysAgo(90) }, // the PARENT — stale rollup, must not count
        { id: 2, parentId: 1, health: "green", end: daysAgo(1) },
        { id: 3, parentId: 1, health: "gray", end: daysAgo(1) },
      ],
    };
    // Only the two leaves (id 2, 3) count; the parent (id 1) is excluded even though it looks overdue.
    expect(summarizeProjectHealth(project, NOW)).toEqual({ complete: 1, overdue: 1, atRisk: 0, onTrack: 0, total: 2 });
  });

  it("an end exactly 1 day in the past is overdue; today or tomorrow is not", () => {
    const p1 = { tasks: [{ id: 1, health: "gray", end: daysAgo(1) }] };
    const p2 = { tasks: [{ id: 1, health: "gray", end: daysFromNow(0) }] };
    expect(summarizeProjectHealth(p1, NOW).overdue).toBe(1);
    expect(summarizeProjectHealth(p2, NOW).overdue).toBe(0);
  });

  it("no tasks summarizes to all zeros", () => {
    expect(summarizeProjectHealth({ tasks: [] }, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
    expect(summarizeProjectHealth({}, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
    expect(summarizeProjectHealth(null, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
  });
});

describe("summarizeScheduleHealth", () => {
  const projectsMap = {
    "1": { id: 1, name: "Goose Creek", linkedSiteId: "smqfy48tlk9j", tasks: [{ id: 1, health: "gray", end: daysAgo(5) }] },
    "2": { id: 2, name: "Healthy Project", linkedSiteId: null, tasks: [{ id: 1, health: "green", end: daysAgo(5) }] },
    "3": { id: 3, name: "Empty Schedule", tasks: [] },
  };

  it("reads the projects MAP (keyed by string id), not an array", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW);
    expect(out.map((p) => p.name).sort()).toEqual(["Goose Creek", "Healthy Project"]);
  });

  it("drops a schedule with zero leaf tasks entirely (an empty project is not a health row)", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW);
    expect(out.find((p) => p.name === "Empty Schedule")).toBeUndefined();
  });

  it("carries linkedSiteId through for the Site Planner cross-link, null when never linked", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW);
    expect(out.find((p) => p.name === "Goose Creek").linkedSiteId).toBe("smqfy48tlk9j");
    expect(out.find((p) => p.name === "Healthy Project").linkedSiteId).toBe(null);
  });

  it("sorts the worst overdue-share schedule first", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW);
    expect(out[0].name).toBe("Goose Creek"); // 100% overdue vs. 0%
  });

  it("an unnamed project falls back to a readable placeholder, never a blank title", () => {
    const out = summarizeScheduleHealth({ "1": { tasks: [{ id: 1, health: "gray", end: daysAgo(1) }] } }, NOW);
    expect(out[0].name).toBe("Untitled schedule");
  });

  it("handles a missing/malformed projects map without throwing", () => {
    expect(summarizeScheduleHealth(null, NOW)).toEqual([]);
    expect(summarizeScheduleHealth(undefined, NOW)).toEqual([]);
  });
});
