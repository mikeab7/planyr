import { describe, it, expect } from "vitest";
import { groupProjects, filterProjects, relTime, suggestNameMatch, normalizeProjectName, resolveCurrentName, withCurrentProject, unionProjectLists } from "../src/shared/projects/projectModel.js";

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

// B853266/NEW-1 — the project the user is standing in must never be missing from its own
// switcher: a stale/diverged on-device cache can drop an actively-worked project from
// listProjects() even though the route/currentProject prop proves it's real and open right now.
describe("withCurrentProject — the routed project is never invisible to its own switcher (B853266/NEW-1)", () => {
  const projects = [
    { id: "g1", name: "Grand Port" },
    { id: "g2", name: "Goose Creek" },
  ];
  it("passes an untouched list through when the current project is already present", () => {
    expect(withCurrentProject(projects, { id: "g1", name: "Grand Port" })).toBe(projects);
  });
  it("backfills a missing current project at the front of the list (union, never a swap)", () => {
    const out = withCurrentProject(projects, { id: "g9", name: "Richfield" });
    expect(out.map((p) => p.id)).toEqual(["g9", "g1", "g2"]);
    expect(out[0]).toMatchObject({ id: "g9", name: "Richfield" });
    // Every original entry survives untouched — this is a union, never a narrowing.
    expect(out[1]).toBe(projects[0]);
    expect(out[2]).toBe(projects[1]);
  });
  it("falls back to 'Untitled site' for a nameless current project, matching groupProjects", () => {
    expect(withCurrentProject([], { id: "g9" })[0].name).toBe("Untitled site");
  });
  it("no-ops with no current project (the Dashboard view) or no id", () => {
    expect(withCurrentProject(projects, null)).toBe(projects);
    expect(withCurrentProject(projects, {})).toBe(projects);
  });
  // NEW-2's own repro ("type its own name → 'No matching projects'") is this exact gap: once the
  // current project is unconditionally in the base list, the existing filterProjects search finds
  // it like any other project — no separate search-side fix is needed.
  it("once backfilled, searching the current project's own name finds it (closes NEW-2's repro)", () => {
    const withCurrent = withCurrentProject(projects, { id: "g9", name: "Richfield" });
    expect(filterProjects(withCurrent, "richfield").map((p) => p.id)).toEqual(["g9"]);
  });
});

// B854xxx/NEW-2 — Scheduler's controlled switcher was a static, un-reconciled bridge list with no
// timestamps, current marker or recently-deleted bin, because "controlled" skipped the whole
// registry data layer. unionProjectLists is what lets a controlled caller show the SAME real
// projects every other route shows, plus its own schedule-only pseudo-projects (Pursuits/
// Operations — no site id, so a registry lookup can never produce them).
describe("unionProjectLists — a controlled switcher (Scheduler) sees the real registry, not just its own bridge list (B854xxx/NEW-2)", () => {
  const registry = [
    { id: "g1", name: "Richfield", updatedAt: 900 },
    { id: "g2", name: "Grand Port", updatedAt: 500 },
  ];
  it("registry entries lead, in the registry's own (newest-first) order", () => {
    const out = unionProjectLists([], registry);
    expect(out).toEqual(registry);
  });
  it("a controlled entry with no matching registry id (a schedule-only pseudo-project) is appended, not dropped", () => {
    const controlled = [{ id: "sched-pursuits", name: "Pursuits" }, { id: "sched-ops", name: "Operations" }];
    const out = unionProjectLists(controlled, registry);
    expect(out.map((p) => p.id)).toEqual(["g1", "g2", "sched-pursuits", "sched-ops"]);
  });
  it("a shared id is resolved from the REGISTRY (richer: timestamp/status), never the bare controlled stub", () => {
    const controlled = [{ id: "g1", name: "Richfield" }]; // no updatedAt — a bare bridge entry
    const out = unionProjectLists(controlled, registry);
    expect(out).toEqual(registry); // g1 keeps its registry timestamp; nothing duplicated
  });
  it("drops falsy / id-less entries from either side without throwing", () => {
    expect(unionProjectLists([null, { name: "no id" }, { id: "x", name: "X" }], [])).toEqual([{ id: "x", name: "X" }]);
    expect(unionProjectLists([], [null, { id: "g1", name: "Richfield" }])).toEqual([{ id: "g1", name: "Richfield" }]);
  });
  it("no-ops to an empty list with nothing on either side", () => {
    expect(unionProjectLists([], [])).toEqual([]);
    expect(unionProjectLists(undefined, undefined)).toEqual([]);
  });

  // B881666 — a controlled entry's OWN `id` is a DIFFERENT namespace from a registry id (a
  // schedule id vs. a site-group id), so "a shared id" never actually happened for a linked
  // project: every one fell straight into `extra` beside its own registry row, TWICE — the
  // "current project listed twice in the project switcher" bug. A controlled entry names its
  // real project via `linkedSiteId`, not `id`.
  it("B881666 — a controlled entry LINKED to an already-present registry project is dropped, not duplicated", () => {
    const controlled = [{ id: "sched-1", name: "Goose Creek", linkedSiteId: "g1", linkedSiteName: "Goose Creek" }];
    const out = unionProjectLists(controlled, registry);
    expect(out).toEqual(registry); // only the registry's Richfield/Grand Port rows — no third "Goose Creek" row
  });
  it("B881666 — a controlled entry linked to a project NOT (yet) in the registry still appears (nothing to prefer)", () => {
    const controlled = [{ id: "sched-3", name: "Woods Road", linkedSiteId: "g3", linkedSiteName: "Woods Road" }];
    const out = unionProjectLists(controlled, registry);
    expect(out.map((p) => p.id)).toEqual(["g1", "g2", "sched-3"]);
  });
  it("B881666 — a genuinely unlinked pseudo-project (Operations/Pursuits) is unaffected by the linkedSiteId check", () => {
    const controlled = [{ id: "sched-ops", name: "Operations", linkedSiteId: null, linkedSiteName: null }];
    const out = unionProjectLists(controlled, registry);
    expect(out.map((p) => p.id)).toEqual(["g1", "g2", "sched-ops"]);
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
