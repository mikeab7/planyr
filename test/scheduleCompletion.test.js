import { describe, it, expect } from "vitest";
import {
  isCompleteTask, leafPercent, effectivePercentComplete, completionDelta, cascadeDelta,
  displayHealth, DEFAULT_HEALTH_RULES,
} from "../src/shared/schedule/healthEngine.js";

/* B1953795 (S2) — "Complete" has ONE answer. Before: task.health==="green" and task.percentComplete
 * were two stores; leaf writers set one, readers read either, so a task could be a green pill + solid
 * Gantt bar + "0%" in the grid + still "Needs Attn." after typing 100. */
const RULES = { healthRules: DEFAULT_HEALTH_RULES };
const NOW = "2026-09-29";

describe("isCompleteTask / effectivePercentComplete — one answer for every reader", () => {
  it("green status alone is complete and reads 100% (main's grid said 0%)", () => {
    const t = { id: 1, health: "green", percentComplete: 0 };
    expect(isCompleteTask(t)).toBe(true);
    expect(effectivePercentComplete(t)).toBe(100);
  });
  it("100% alone is complete even with a stale gray pill", () => {
    expect(isCompleteTask({ health: "gray", percentComplete: 100 })).toBe(true);
  });
  it("paused is never complete; a partial % is not complete", () => {
    expect(isCompleteTask({ health: "paused", percentComplete: 100 })).toBe(false);
    expect(isCompleteTask({ health: "gray", percentComplete: 99 })).toBe(false);
    expect(isCompleteTask(null)).toBe(false);
  });
  it("garbage % coerces to 0, clamps to 0..100", () => {
    expect(leafPercent({ percentComplete: "abc" })).toBe(0);
    expect(leafPercent({ percentComplete: 250 })).toBe(100);
    expect(leafPercent({ percentComplete: -5 })).toBe(0);
  });
  it("a parent's % is DERIVED from its leaves (duration-weighted), not its stale stored leftover", () => {
    const all = [
      { id: 1, parentId: null, percentComplete: 0, health: "gray", duration: 0 },     // stale stored leftover
      { id: 2, parentId: 1, percentComplete: 0, health: "green", duration: 1 },       // complete via status
      { id: 3, parentId: 1, percentComplete: 50, health: "gray", duration: 1 },
      { id: 4, parentId: 1, percentComplete: 0, health: "gray", duration: 2 },
    ];
    // (100*1 + 50*1 + 0*2) / 4 = 37.5 -> 38
    expect(effectivePercentComplete(all[0], all)).toBe(38);
    // a leaf ignores the list
    expect(effectivePercentComplete(all[2], all)).toBe(50);
  });
  it("a parent chain and a cycle do not hang", () => {
    const all = [{ id: 1, parentId: 2, duration: 1 }, { id: 2, parentId: 1, duration: 1 }];
    expect(() => effectivePercentComplete(all[0], all)).not.toThrow();
  });
});

describe("completionDelta — writers keep both stores consistent (leaf edits)", () => {
  it("picking Complete writes 100%", () => {
    expect(completionDelta({ health: "gray", percentComplete: 0 }, { health: "green" })).toEqual({ percentComplete: 100 });
  });
  it("typing 100 writes Complete", () => {
    expect(completionDelta({ health: "gray", percentComplete: 0 }, { percentComplete: 100 })).toEqual({ health: "green" });
  });
  it("typing less than 100 on a Complete task un-completes it (else the bar stays solid and the edit looks dead)", () => {
    expect(completionDelta({ health: "green", percentComplete: 100 }, { percentComplete: 40 })).toEqual({ health: "gray" });
  });
  it("leaving Complete via a status pick clears a 100 (both the cascade-set and the legacy unmarked kind)", () => {
    expect(completionDelta({ health: "green", percentComplete: 100 }, { health: "yellow" })).toEqual({ percentComplete: 0 });
    expect(completionDelta({ health: "gray", percentComplete: 100 }, { health: "yellow" })).toEqual({ percentComplete: 0 });
  });
  it("a user-typed partial % is NEVER touched by a status change", () => {
    expect(completionDelta({ health: "gray", percentComplete: 40 }, { health: "yellow" })).toEqual({});
    expect(completionDelta({ health: "gray", percentComplete: 40 }, { health: "green" })).toEqual({ percentComplete: 100 });
  });
  it("an update that names both fields, or neither, is left alone", () => {
    expect(completionDelta({ health: "gray" }, { health: "green", percentComplete: 30 })).toEqual({});
    expect(completionDelta({ health: "gray" }, { name: "x" })).toEqual({});
  });
  it("parent cascade: green sets 100 on each descendant; any other status clears a 100 only", () => {
    expect(cascadeDelta({ percentComplete: 0 }, "green")).toEqual({ percentComplete: 100 });
    expect(cascadeDelta({ percentComplete: 100 }, "gray")).toEqual({ percentComplete: 0 });
    expect(cascadeDelta({ percentComplete: 40 }, "gray")).toEqual({});
  });
});

describe("the rule engine reads the same completion answer (RED-PROOF: main painted these red)", () => {
  const overdue = { id: 1, end: "2026-08-01", start: "2026-07-01", health: "gray", percentComplete: 0, predecessors: [] };
  it("sanity: an overdue, unfinished task is red under the default rules", () => {
    expect(displayHealth(overdue, RULES, NOW)).toBe("red");
  });
  it("typing 100 in % on an overdue task is COMPLETE (green), not Needs Attn.", () => {
    expect(displayHealth({ ...overdue, percentComplete: 100 }, RULES, NOW)).toBe("green");
  });
  it("Complete status on an overdue task stays green; with a rule that has NO 'unless', it is still not red", () => {
    expect(displayHealth({ ...overdue, health: "green" }, RULES, NOW)).toBe("green");
    const naked = { healthRules: [{ id: "n", when: [{ field: "finish", op: "pastDueAtLeast", value: 1 }], whenCombinator: "AND", color: "red", unless: [{ field: "status", op: "is", value: "green" }], unlessCombinator: "OR" }] };
    expect(displayHealth({ ...overdue, percentComplete: 100 }, naked, NOW)).toBe("green");
  });
  it("a '% Complete is at least 100' rule fires for a green-status task (main read the raw 0)", () => {
    const rule = { healthRules: [{ id: "c", when: [{ field: "percentComplete", op: "gte", value: 100 }], whenCombinator: "AND", color: "green", unless: [], unlessCombinator: "OR" }] };
    expect(displayHealth({ id: 1, health: "gray", percentComplete: 0 }, rule, NOW)).toBe("gray");
    expect(displayHealth({ id: 1, health: "green", percentComplete: 0 }, rule, NOW)).toBe("green");
  });
  it("paused stays paused and is exempt from overdue", () => {
    expect(displayHealth({ ...overdue, health: "paused" }, RULES, NOW)).toBe("paused");
  });
  it("a predecessor that is 100% (or green) is not 'late'", () => {
    const rule = { healthRules: [{ id: "p", when: [{ field: "predecessor", op: "isLate" }], whenCombinator: "AND", color: "red", unless: [], unlessCombinator: "OR" }] };
    const byId = { 5: { id: 5, end: "2026-08-01", health: "gray", percentComplete: 100 }, 6: { id: 6, end: "2026-08-01", health: "green", percentComplete: 0 }, 7: { id: 7, end: "2026-08-01", health: "gray", percentComplete: 0 } };
    const dep = (pid) => ({ id: 9, health: "gray", predecessors: [{ id: pid }] });
    expect(displayHealth(dep(5), rule, NOW, byId)).toBe("gray");
    expect(displayHealth(dep(6), rule, NOW, byId)).toBe("gray");
    expect(displayHealth(dep(7), rule, NOW, byId)).toBe("red");
  });
});
