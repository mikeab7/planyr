import { describe, it, expect } from "vitest";
import { groupProjects, filterProjects, relTime } from "../src/shared/projects/projectModel.js";

describe("groupProjects", () => {
  it("collapses plans of one site into a single project entry", () => {
    const recs = [
      { id: "p1", groupId: "g1", site: "Schiel Road", name: "Plan 1", updatedAt: 100 },
      { id: "p2", groupId: "g1", site: "Schiel Road", name: "Plan 2", updatedAt: 300 },
      { id: "p3", groupId: "g2", site: "JFK", name: "Plan 1", updatedAt: 200 },
    ];
    const out = groupProjects(recs);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id)).toEqual(["g1", "g2"]); // g1 newest (300) first
  });

  it("uses the newest record's name + status and the max timestamp per group", () => {
    const recs = [
      { id: "p1", groupId: "g1", site: "Old Name", updatedAt: 100, status: "pursuit" },
      { id: "p2", groupId: "g1", site: "New Name", updatedAt: 500, status: "active" },
    ];
    const [proj] = groupProjects(recs);
    expect(proj.name).toBe("New Name");
    expect(proj.updatedAt).toBe(500);
    expect(proj.status).toBe("active");
  });

  it("sorts projects most-recently-edited first", () => {
    const recs = [
      { id: "a", groupId: "a", site: "A", updatedAt: 10 },
      { id: "b", groupId: "b", site: "B", updatedAt: 999 },
      { id: "c", groupId: "c", site: "C", updatedAt: 50 },
    ];
    expect(groupProjects(recs).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("falls back to id when groupId is absent and to 'Untitled site' for a nameless record", () => {
    const out = groupProjects([{ id: "lonely", updatedAt: 1 }]);
    expect(out).toEqual([{ id: "lonely", name: "Untitled site", updatedAt: 1, status: null }]);
  });

  it("ignores null/blank records and never throws on junk", () => {
    expect(groupProjects([null, undefined, {}, { updatedAt: 5 }])).toEqual([]);
    expect(groupProjects()).toEqual([]);
  });
});

describe("filterProjects", () => {
  const projects = [
    { id: "g1", name: "Schiel Road" },
    { id: "g2", name: "JFK Logistics" },
    { id: "g3", name: "Katy Freeway" },
  ];
  it("returns all when the query is empty/whitespace", () => {
    expect(filterProjects(projects, "")).toHaveLength(3);
    expect(filterProjects(projects, "   ")).toHaveLength(3);
  });
  it("filters case-insensitively by name substring", () => {
    expect(filterProjects(projects, "ka").map((p) => p.id)).toEqual(["g3"]);
    expect(filterProjects(projects, "o").map((p) => p.id)).toEqual(["g1", "g2"]);
  });
});

describe("relTime", () => {
  const now = 1_000_000_000_000;
  it("reports 'just now' under 45s and blank for missing timestamps", () => {
    expect(relTime(now - 10_000, now)).toBe("just now");
    expect(relTime(0, now)).toBe("");
    expect(relTime(undefined, now)).toBe("");
  });
  it("scales minutes → hours → days → weeks", () => {
    expect(relTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(relTime(now - 14 * 86_400_000, now)).toBe("2w ago");
  });
  it("falls back to a short date past ~a month", () => {
    const out = relTime(now - 60 * 86_400_000, now);
    expect(out).not.toMatch(/ago|just now/);
  });
});
