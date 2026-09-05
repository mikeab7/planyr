import { describe, it, expect } from "vitest";
import { latestPerGroup, pipelineCounts } from "../src/workspaces/dashboard/lib/pipelineCounts.js";

const rows = [
  { id: "a1", groupId: "g1", role: "pursuit", status: "active", updatedAt: 10 },
  { id: "a2", groupId: "g1", role: "pursuit", status: "pursuit", updatedAt: 20 }, // newer plan, same project
  { id: "b1", groupId: "g2", role: "pursuit", status: "onhold", updatedAt: 5 },
  { id: "c1", groupId: "g3", role: "tracked", status: "pursuit", updatedAt: 1 },
  { id: "d1", groupId: "g4", role: "pursuit", status: "complete", updatedAt: 2 },
];

describe("latestPerGroup", () => {
  it("takes the most-recently-updated plan per groupId", () => {
    const out = latestPerGroup(rows);
    const g1 = out.find((r) => r.groupId === "g1");
    expect(g1.id).toBe("a2");
    expect(out.length).toBe(4); // g1, g2, g3, g4
  });
});

describe("pipelineCounts", () => {
  it("counts by PROJECT (one vote per group), status tally includes every status key, tracked counted separately", () => {
    const out = pipelineCounts(rows);
    expect(out.total).toBe(3); // g1 (pursuit, latest=pursuit status), g2 (onhold), g4 (complete)
    expect(out.byStatus).toEqual({ pursuit: 1, active: 0, onhold: 1, complete: 1, dead: 0 });
    expect(out.trackedCount).toBe(1); // g3
  });

  it("handles an empty list", () => {
    expect(pipelineCounts([])).toEqual({ total: 0, byStatus: { pursuit: 0, active: 0, onhold: 0, complete: 0, dead: 0 }, trackedCount: 0 });
  });
});
