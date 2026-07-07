import { describe, it, expect } from "vitest";
import { groupProjects, filterProjects, relTime, suggestNameMatch, normalizeProjectName, resolveCurrentName } from "../src/shared/projects/projectModel.js";

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
    expect(out).toEqual([{ id: "lonely", name: "Untitled site", updatedAt: 1, status: null, scheduleProjectId: null }]);
  });

  it("ignores null/blank records and never throws on junk", () => {
    expect(groupProjects([null, undefined, {}, { updatedAt: 5 }])).toEqual([]);
    expect(groupProjects()).toEqual([]);
  });

  it("surfaces the cross-module schedule link hint (schema v9) on the project entry", () => {
    const [proj] = groupProjects([{ id: "p1", groupId: "g1", site: "Pappadoupolos", updatedAt: 100, scheduleProjectId: 7 }]);
    expect(proj.scheduleProjectId).toBe(7);
  });

  it("keeps a link hint found on an OLDER plan even when the newest plan is unlinked", () => {
    const [proj] = groupProjects([
      { id: "p1", groupId: "g1", site: "Pappadoupolos", updatedAt: 100, scheduleProjectId: 7 },
      { id: "p2", groupId: "g1", site: "Pappadoupolos", updatedAt: 500 }, // newest, no hint
    ]);
    expect(proj.name).toBe("Pappadoupolos");
    expect(proj.updatedAt).toBe(500);   // newest record still wins label/timestamp
    expect(proj.scheduleProjectId).toBe(7); // but the link isn't lost
  });
});

describe("suggestNameMatch — suggest-and-confirm cross-module linking (never auto-guesses)", () => {
  const sites = [
    { id: "g1", name: "Pappadoupolos" },
    { id: "g2", name: "Grand Port" },
    { id: "g3", name: "Goose Creek" },
  ];
  it("matches a same-name counterpart ignoring case/whitespace/punctuation", () => {
    expect(suggestNameMatch("pappadoupolos ", sites)?.id).toBe("g1");
    expect(suggestNameMatch("Grand-Port", sites)?.id).toBe("g2");
  });
  it("returns null when nothing matches", () => {
    expect(suggestNameMatch("Nowhere Ranch", sites)).toBeNull();
    expect(suggestNameMatch("", sites)).toBeNull();
  });
  it("returns null on an AMBIGUOUS match (>1) — an explicit manual pick is required", () => {
    const dupes = [{ id: "a", name: "Twin" }, { id: "b", name: "twin" }];
    expect(suggestNameMatch("Twin", dupes)).toBeNull();
  });
  it("can exclude an id so a project never matches itself", () => {
    expect(suggestNameMatch("Pappadoupolos", sites, { exclude: "g1" })).toBeNull();
  });
  it("normalizeProjectName collapses punctuation/case/whitespace", () => {
    expect(normalizeProjectName("  Grand—Port!! ")).toBe("grand port");
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

describe("resolveCurrentName — header crumb tracks a live rename (auto-update-name)", () => {
  const projects = [
    { id: "g1", name: "Eight South" },
    { id: "g2", name: "Katy Freeway" },
  ];
  it("prefers the live list name over a stale currentProject prop", () => {
    // The switcher list already carries the new name; the parent's prop is pre-rename.
    expect(resolveCurrentName({ id: "g1", name: "8 South" }, projects)).toBe("Eight South");
  });
  it("falls back to the prop name when the project isn't in the list yet (cold/empty)", () => {
    expect(resolveCurrentName({ id: "g9", name: "New Site" }, projects)).toBe("New Site");
    expect(resolveCurrentName({ id: "g9", name: "New Site" }, [])).toBe("New Site");
  });
  it("returns empty string when there is no current project (Dashboard)", () => {
    expect(resolveCurrentName(null, projects)).toBe("");
    expect(resolveCurrentName(undefined)).toBe("");
  });
  it("never throws on junk entries in the list", () => {
    expect(resolveCurrentName({ id: "g1", name: "x" }, [null, undefined, {}])).toBe("x");
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
