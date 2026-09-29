import { describe, it, expect } from "vitest";
import { summarizeProjectHealth, summarizeScheduleHealth } from "../src/workspaces/dashboard/lib/scheduleHealth.js";

const NOW = Date.parse("2026-09-05T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
// B1953795 (S4) — health is evaluated by the SAME rules the grid uses (the account's settings.healthRules;
// here the grid's own suggested defaults: 1+ day past finish = red, due within 3 days = yellow, each
// "unless Complete/Paused"). The old fixed 7-day heuristic is gone.
import { DEFAULT_HEALTH_RULES } from "../src/shared/schedule/healthEngine.js";
const RULES = { healthRules: DEFAULT_HEALTH_RULES };

describe("summarizeProjectHealth", () => {
  it("buckets a mix of tasks into complete / overdue / at-risk / on-track", () => {
    const project = {
      tasks: [
        { id: 1, health: "green", end: daysAgo(30) },              // complete — health wins regardless of date
        { id: 2, health: "gray", end: daysAgo(5) },                 // overdue — past end, not complete/paused
        { id: 3, health: "red", end: daysAgo(1) },                  // overdue
        { id: 4, health: "gray", end: daysFromNow(3) },             // at-risk — due within the grid's 3-day window
        { id: 5, health: "gray", end: daysFromNow(30) },            // on-track — due later
        { id: 6, health: "paused", end: daysAgo(90) },              // on-track — paused is exempt from overdue
        { id: 7, health: "gray", end: "" },                         // on-track — no end date at all
      ],
    };
    expect(summarizeProjectHealth(project, NOW, RULES)).toEqual({
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
    expect(summarizeProjectHealth(project, NOW, RULES)).toEqual({ complete: 1, overdue: 1, atRisk: 0, onTrack: 0, total: 2 });
  });

  it("an end exactly 1 day in the past is overdue; today or tomorrow is not", () => {
    const p1 = { tasks: [{ id: 1, health: "gray", end: daysAgo(1) }] };
    const p2 = { tasks: [{ id: 1, health: "gray", end: daysFromNow(0) }] };
    expect(summarizeProjectHealth(p1, NOW, RULES).overdue).toBe(1);
    expect(summarizeProjectHealth(p2, NOW, RULES).overdue).toBe(0);
  });

  // B1953795 (S4) — RED-PROOF (fails on main): main hard-coded a 7-day at-risk window and "complete =
  // status green only", so a task due in 5 days counted at-risk here while the grid (3-day rule) showed
  // it on track, and a 100% task with a stale gray pill counted overdue here while the grid showed it
  // complete.
  it("S4: a task 5 days out is ON TRACK under the grid's 3-day rule (main said at-risk); a custom 10-day rule flips it", () => {
    const p = { tasks: [{ id: 1, health: "gray", end: daysFromNow(5) }] };
    expect(summarizeProjectHealth(p, NOW, RULES)).toMatchObject({ atRisk: 0, onTrack: 1 });
    const custom = { healthRules: [{ id: "c", when: [{ field: "finish", op: "withinDays", value: 10 }], whenCombinator: "AND", color: "yellow", unless: [], unlessCombinator: "OR" }] };
    expect(summarizeProjectHealth(p, NOW, custom)).toMatchObject({ atRisk: 1, onTrack: 0 });
  });
  it("S4: a task at 100% with a stale gray pill is COMPLETE, not overdue (the grid's own answer)", () => {
    const p = { tasks: [{ id: 1, health: "gray", percentComplete: 100, end: daysAgo(10) }] };
    expect(summarizeProjectHealth(p, NOW, RULES)).toMatchObject({ complete: 1, overdue: 0 });
  });

  it("no tasks summarizes to all zeros", () => {
    expect(summarizeProjectHealth({ tasks: [] }, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
    expect(summarizeProjectHealth({}, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
    expect(summarizeProjectHealth(null, NOW)).toEqual({ complete: 0, overdue: 0, atRisk: 0, onTrack: 0, total: 0 });
  });
});

describe("summarizeScheduleHealth", () => {
  // B1939344 (NEW-1) — `name` is the qualified "<Project> / <Schedule>" label (crossScheduleLabel),
  // not the bare schedule name: project 1 is site-owned (a name + a linkedSiteName), project 2 is
  // org-owned (no linkedSiteId at all).
  const projectsMap = {
    "1": { id: 1, name: "Master Schedule", linkedSiteId: "smqfy48tlk9j", linkedSiteName: "Goose Creek", tasks: [{ id: 1, health: "gray", end: daysAgo(5) }] },
    "2": { id: 2, name: "Healthy Project", linkedSiteId: null, tasks: [{ id: 1, health: "green", end: daysAgo(5) }] },
    "3": { id: 3, name: "Empty Schedule", tasks: [] },
  };

  it("reads the projects MAP (keyed by string id), not an array", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW, RULES);
    expect(out.map((p) => p.name).sort()).toEqual(["Goose Creek / Master Schedule", "Organization / Healthy Project"]);
  });

  it("drops a schedule with zero leaf tasks entirely (an empty project is not a health row)", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW, RULES);
    expect(out.find((p) => p.id === 3)).toBeUndefined();
  });

  it("carries linkedSiteId through for the Site Planner cross-link, null when never linked", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW, RULES);
    expect(out.find((p) => p.id === 1).linkedSiteId).toBe("smqfy48tlk9j");
    expect(out.find((p) => p.id === 2).linkedSiteId).toBe(null);
  });

  it("sorts the worst overdue-share schedule first", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW, RULES);
    expect(out[0].id).toBe(1); // 100% overdue vs. 0%
  });

  it("names each row with the qualified '<Project> / <Schedule>' label, never a bare (possibly ambiguous) name — B1939344", () => {
    const out = summarizeScheduleHealth(projectsMap, NOW, RULES);
    expect(out.find((p) => p.id === 1).name).toBe("Goose Creek / Master Schedule");
    expect(out.find((p) => p.id === 2).name).toBe("Organization / Healthy Project");
  });

  it("RED-PROOF (fails on unmodified main): two schedules named identically under different projects come back as distinct rows — B1939344", () => {
    const sameNamed = {
      "1": { id: 1, name: "Master Schedule", linkedSiteId: "g1", linkedSiteName: "Goose Creek", tasks: [{ id: 1, health: "gray", end: daysAgo(5) }] },
      "2": { id: 2, name: "Master Schedule", linkedSiteId: "g2", linkedSiteName: "Grand Port", tasks: [{ id: 1, health: "gray", end: daysAgo(5) }] },
    };
    const out = summarizeScheduleHealth(sameNamed, NOW, RULES);
    const names = out.map((p) => p.name).sort();
    expect(new Set(names).size).toBe(2);
    expect(names).toEqual(["Goose Creek / Master Schedule", "Grand Port / Master Schedule"]);
  });

  it("an unnamed, org-owned project falls back to a readable placeholder, never a blank title", () => {
    const out = summarizeScheduleHealth({ "1": { tasks: [{ id: 1, health: "gray", end: daysAgo(1) }] } }, NOW);
    expect(out[0].name).toBe("Organization / Untitled schedule");
  });

  it("an unnamed, site-owned project qualifies 'Untitled schedule' with the real project name", () => {
    const out = summarizeScheduleHealth({ "1": { linkedSiteId: "g1", linkedSiteName: "Goose Creek", tasks: [{ id: 1, health: "gray", end: daysAgo(1) }] } }, NOW);
    expect(out[0].name).toBe("Goose Creek / Untitled schedule");
  });

  it("handles a missing/malformed projects map without throwing", () => {
    expect(summarizeScheduleHealth(null, NOW)).toEqual([]);
    expect(summarizeScheduleHealth(undefined, NOW)).toEqual([]);
  });
});
