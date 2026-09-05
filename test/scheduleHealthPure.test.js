import { describe, it, expect } from "vitest";
import {
  isTaskComplete, isTaskOverdue, isTaskAtRisk, isUnassigned, summarizeScheduleHealth, unassignedOverdueTasks,
} from "../src/workspaces/dashboard/lib/scheduleHealthPure.js";

const TODAY = "2026-09-05";

describe("scheduleHealthPure — task classification", () => {
  it("complete is percentComplete >= 100, regardless of dates", () => {
    expect(isTaskComplete({ percentComplete: 100, end: "2000-01-01" })).toBe(true);
    expect(isTaskComplete({ percentComplete: 99 })).toBe(false);
    expect(isTaskComplete({})).toBe(false);
  });

  it("overdue is past-end and not complete", () => {
    expect(isTaskOverdue({ end: "2026-09-01" }, TODAY)).toBe(true);
    expect(isTaskOverdue({ end: "2026-09-01", percentComplete: 100 }, TODAY)).toBe(false);
    expect(isTaskOverdue({ end: TODAY }, TODAY)).toBe(false); // due today is not yet overdue
    expect(isTaskOverdue({}, TODAY)).toBe(false);
  });

  it("at-risk is due within the window, not complete, not already overdue", () => {
    expect(isTaskAtRisk({ end: "2026-09-06" }, TODAY)).toBe(true);
    expect(isTaskAtRisk({ end: "2026-09-08" }, TODAY)).toBe(true); // 3 days out, within window
    expect(isTaskAtRisk({ end: "2026-09-09" }, TODAY)).toBe(false); // outside the window
    expect(isTaskAtRisk({ end: "2026-09-01" }, TODAY)).toBe(false); // already overdue, not "at risk"
    expect(isTaskAtRisk({ end: "2026-09-06", percentComplete: 100 }, TODAY)).toBe(false);
  });

  it("unassigned is a blank/whitespace-only owner", () => {
    expect(isUnassigned({})).toBe(true);
    expect(isUnassigned({ responsibleParty: "" })).toBe(true);
    expect(isUnassigned({ responsibleParty: "   " })).toBe(true);
    expect(isUnassigned({ responsibleParty: "Mike" })).toBe(false);
  });
});

describe("summarizeScheduleHealth", () => {
  const projects = {
    p1: {
      id: "p1", name: "Warehouse A", tasks: [
        { id: "t1", percentComplete: 100 },
        { id: "t2", end: "2026-09-01" }, // overdue
        { id: "t3", end: "2026-09-06" }, // at risk
        { id: "t4", end: "2026-10-01" }, // fine
      ],
    },
    p2: { id: "p2", name: "Empty schedule", tasks: [] },
  };

  it("tallies complete/overdue/at-risk per schedule", () => {
    const out = summarizeScheduleHealth(projects, TODAY);
    const a = out.find((r) => r.id === "p1");
    expect(a).toEqual({ id: "p1", name: "Warehouse A", taskCount: 4, complete: 1, overdue: 1, atRisk: 1 });
    const b = out.find((r) => r.id === "p2");
    expect(b).toEqual({ id: "p2", name: "Empty schedule", taskCount: 0, complete: 0, overdue: 0, atRisk: 0 });
  });

  it("sorts worst (most overdue) first", () => {
    const out = summarizeScheduleHealth(projects, TODAY);
    expect(out[0].id).toBe("p1");
  });

  it("handles a missing/empty projects object without throwing", () => {
    expect(summarizeScheduleHealth(null, TODAY)).toEqual([]);
    expect(summarizeScheduleHealth({}, TODAY)).toEqual([]);
  });
});

describe("unassignedOverdueTasks", () => {
  it("finds only unassigned AND overdue tasks, oldest due date first", () => {
    const projects = {
      p1: {
        id: "p1", name: "Warehouse A", tasks: [
          { id: "t1", name: "Assigned overdue", end: "2026-09-01", responsibleParty: "Mike" },
          { id: "t2", name: "Unassigned overdue, older", end: "2026-08-20" },
          { id: "t3", name: "Unassigned overdue, newer", end: "2026-09-02" },
          { id: "t4", name: "Unassigned, not due yet", end: "2026-12-01" },
          { id: "t5", name: "Unassigned, complete", end: "2026-08-01", percentComplete: 100 },
        ],
      },
    };
    const out = unassignedOverdueTasks(projects, TODAY);
    expect(out.map((t) => t.taskId)).toEqual(["t2", "t3"]);
    expect(out[0].projectName).toBe("Warehouse A");
  });

  it("handles a missing/empty projects object without throwing", () => {
    expect(unassignedOverdueTasks(null, TODAY)).toEqual([]);
  });
});
