import { describe, it, expect } from "vitest";
import { pursuitsByCounty } from "../src/workspaces/dashboard/lib/pursuitsByCounty.js";

describe("pursuitsByCounty", () => {
  it("groups pursuit PROJECTS by county with project count, plan count, and active count", () => {
    const sites = [
      { id: "a1", groupId: "g1", role: "pursuit", status: "active", county: "harris", updatedAt: 10 },
      { id: "a2", groupId: "g1", role: "pursuit", status: "active", county: "harris", updatedAt: 5 }, // 2nd plan, same project
      { id: "b1", groupId: "g2", role: "pursuit", status: "onhold", county: "harris", updatedAt: 3 },
      { id: "c1", groupId: "g3", role: "pursuit", status: "active", county: "fortbend", updatedAt: 1 },
      { id: "d1", groupId: "g4", role: "tracked", status: "active", county: "harris", updatedAt: 1 }, // excluded: not a pursuit
    ];
    const out = pursuitsByCounty(sites);
    const harris = out.find((r) => r.county === "harris");
    expect(harris).toEqual({ county: "harris", projectCount: 2, planCount: 3, activeCount: 1 });
    const fortbend = out.find((r) => r.county === "fortbend");
    expect(fortbend).toEqual({ county: "fortbend", projectCount: 1, planCount: 1, activeCount: 1 });
  });

  it("buckets a missing county as 'unknown' rather than dropping the project", () => {
    const out = pursuitsByCounty([{ id: "a1", groupId: "g1", role: "pursuit", status: "pursuit", updatedAt: 1 }]);
    expect(out).toEqual([{ county: "unknown", projectCount: 1, planCount: 1, activeCount: 0 }]);
  });

  it("sorts by active count, then project count, descending", () => {
    const out = pursuitsByCounty([
      { id: "a1", groupId: "g1", role: "pursuit", status: "onhold", county: "waller", updatedAt: 1 },
      { id: "b1", groupId: "g2", role: "pursuit", status: "active", county: "chambers", updatedAt: 1 },
    ]);
    expect(out[0].county).toBe("chambers");
  });

  it("handles an empty list", () => {
    expect(pursuitsByCounty([])).toEqual([]);
  });
});
