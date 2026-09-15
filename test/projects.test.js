import { describe, it, expect, beforeEach } from "vitest";
import { groupProjects, filterProjects, relTime, suggestNameMatch, normalizeProjectName, resolveCurrentName, withCurrentProject, unionProjectLists, resolveControlledId, shortenDisplayName, findProjectAtOrigin, distanceFeetBetween, SAME_GROUND_FT, hasSavedProjectRecord, applyFrozenOrder, reorderWithCurrentAndPinned } from "../src/shared/projects/projectModel.js";
import { listProjects } from "../src/shared/projects/projects.js";
import { setActiveUser } from "../src/workspaces/site-planner/lib/activeUser.js";

const SITES_KEY = "planarfit:sites:v1";

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

  // B843792 (NEW-1) — role (pursuit vs tracked) is carried the same way status is.
  it("carries role the same way status is carried: the newest record wins", () => {
    const recs = [
      { id: "p1", groupId: "g1", site: "Old", updatedAt: 100, role: "tracked" },
      { id: "p2", groupId: "g1", site: "New", updatedAt: 500, role: "pursuit" },
    ];
    const [proj] = groupProjects(recs);
    expect(proj.role).toBe("pursuit");
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
    expect(out).toEqual([{ id: "lonely", name: "Untitled site", updatedAt: 1, status: null, role: null, scheduleProjectId: null }]);
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

  // B1112449/NEW-2 — a site with TWO OR MORE linked schedules must never collapse to the single
  // registry row: B881666's "the registry copy already covers it" rule assumed at most one
  // schedule per site, which B1080547 removed elsewhere but not here. Reproduces the exact
  // production shape (pids 16/17, both linkedSiteId "smtjb0lrexb3") measured live 2026-09-03.
  describe("B1112449 — a site with multiple linked schedules keeps every schedule as its own row", () => {
    const site = { id: "smtjb0lrexb3", name: "ZZ-RENAME-TEST-G", updatedAt: 700, status: "active" };
    const tworegistry = [site, { id: "g2", name: "Grand Port", updatedAt: 500 }];
    const twoSchedules = [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: "smtjb0lrexb3", linkedSiteName: "ZZ-RENAME-TEST-G" },
      { id: 17, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: "smtjb0lrexb3", linkedSiteName: "ZZ-RENAME-TEST-G" },
    ];

    it("both schedules appear as their own row — never collapsed to the site's one registry row", () => {
      const out = unionProjectLists(twoSchedules, tworegistry);
      expect(out.map((p) => p.id)).toEqual(["g2", 16, 17]); // the site's own registry row is DROPPED (ambiguous — replaced by its 2 schedules)
      expect(out.find((p) => p.id === 16).name).toBe("ZZ-RENAME-TEST-G");
      expect(out.find((p) => p.id === 17).name).toBe("ZZ-RENAME-TEST-G (2)");
    });

    it("each schedule row carries the site's registry timestamp/status for sensible sorting", () => {
      const out = unionProjectLists(twoSchedules, tworegistry);
      expect(out.find((p) => p.id === 16).updatedAt).toBe(700);
      expect(out.find((p) => p.id === 17).updatedAt).toBe(700);
      expect(out.find((p) => p.id === 17).status).toBe("active");
    });

    it("a THIRD schedule linked to the same site also gets its own row (not just the first two)", () => {
      const three = [...twoSchedules, { id: 18, name: "ZZ-RENAME-TEST-G (3)", linkedSiteId: "smtjb0lrexb3", linkedSiteName: "ZZ-RENAME-TEST-G" }];
      const out = unionProjectLists(three, tworegistry);
      expect(out.map((p) => p.id)).toEqual(["g2", 16, 17, 18]);
    });

    it("a DIFFERENT site with exactly one linked schedule is unaffected — still collapses to its registry row (unchanged prior behavior)", () => {
      const mixed = [...twoSchedules, { id: 9, name: "Grand Port", linkedSiteId: "g2", linkedSiteName: "Grand Port" }];
      const out = unionProjectLists(mixed, tworegistry);
      expect(out.map((p) => p.id)).toEqual(["g2", 16, 17]); // g2's own bridged copy (id 9) is dropped, same as B881666
    });
  });
});

// B1358128 — unionProjectLists shows a site with exactly one linked schedule (or none at all)
// using the SITE's own registry id, standing in for it. `onDeleteProject`/`onRenameProject`/
// `onDuplicateProject` (the Schedule module's bridge to its own embedded hs-v1 project map) only
// understand THEIR OWN ids — a registry-standin id reaching them unresolved is a genuine id-space
// mismatch, and the bridge silently does nothing with it. resolveControlledId is the fix: it
// mirrors selectSchedule's own pre-existing resolution (which only ever covered PICKING a
// project) so Rename/Delete/Duplicate get the identical treatment.
describe("resolveControlledId — resolves a switcher row's id to what a controlled bridge actually understands (B1358128)", () => {
  const schedules = [
    { id: 16, name: "Richfield", linkedSiteId: "g1", linkedSiteName: "Richfield" },
    { id: 17, name: "Grand Port", linkedSiteId: "g2", linkedSiteName: "Grand Port" },
    { id: 18, name: "Operations", linkedSiteId: null },
  ];
  it("a controlled entry's own id resolves to itself unchanged", () => {
    expect(resolveControlledId(schedules, 17)).toBe(17);
    expect(resolveControlledId(schedules, 18)).toBe(18);
  });
  it("a single-linked-schedule registry-standin id (a bare site id) resolves to that schedule's own id — the exact case that silently no-op'd Delete/Rename in the Schedule module", () => {
    expect(resolveControlledId(schedules, "g1")).toBe(16);
    expect(resolveControlledId(schedules, "g2")).toBe(17);
  });
  it("a registry id with NO linked schedule at all resolves to null — the caller's signal to fall back rather than silently no-op", () => {
    expect(resolveControlledId(schedules, "g-no-schedule")).toBeNull();
  });
  it("a site with multiple linked schedules prefers the currently-active one over always-the-first (mirrors selectSchedule's pre-existing B1112449/NEW-2 fix)", () => {
    const multi = [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: "g3" },
      { id: 17, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: "g3" },
    ];
    expect(resolveControlledId(multi, "g3", 17)).toBe(17); // prefers the active id when given
    expect(resolveControlledId(multi, "g3")).toBe(16);     // falls back to the first when no preference resolves
    expect(resolveControlledId(multi, "g3", 999)).toBe(16); // an unmatched preference falls back too, never throws
  });
  it("null-safe on an empty or missing list", () => {
    expect(resolveControlledId([], "g1")).toBeNull();
    expect(resolveControlledId(undefined, "g1")).toBeNull();
  });
});

// B1442592 ("An empty new project is never written to the server") — a lazily-created project (the
// "+ New project" button, never edited) has no public.sites row and no local plan record, so it
// can only ever show up here via withCurrentProject's synthetic placeholder. This is the pure
// decision the delete confirmation uses to stop promising "moves to Recently deleted" for a
// project that has nothing anywhere to move.
describe("hasSavedProjectRecord — does this project id actually have a saved record behind it (B1442592)", () => {
  const registry = [
    { id: "g1", name: "Grand Port" },
    { id: "g2", name: "Goose Creek" },
  ];
  it("true for an id present in the real registry", () => {
    expect(hasSavedProjectRecord("g1", registry)).toBe(true);
  });
  it("false for an id absent from the registry — the lazily-created, never-edited case", () => {
    expect(hasSavedProjectRecord("g9", registry)).toBe(false);
  });
  it("MUST be asked of the real registry, never a list already unioned with the synthetic current-project placeholder", () => {
    // withCurrentProject would make g9 answer true here — that's exactly the false positive
    // this function exists to avoid, which is why callers must pass listProjects(), not
    // withCurrentProject(listProjects(), current).
    const unioned = withCurrentProject(registry, { id: "g9", name: "Untitled site" });
    expect(hasSavedProjectRecord("g9", unioned)).toBe(true); // demonstrates the trap...
    expect(hasSavedProjectRecord("g9", registry)).toBe(false); // ...which asking the real registry avoids
  });
  it("false for a missing id, and never throws on junk", () => {
    expect(hasSavedProjectRecord(null, registry)).toBe(false);
    expect(hasSavedProjectRecord(undefined, registry)).toBe(false);
    expect(hasSavedProjectRecord("g1", [null, undefined, {}])).toBe(false);
    expect(hasSavedProjectRecord("g1")).toBe(false);
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

describe("relTime — the ISO-string case behind the deleted-project screen's stray space", () => {
  /* ⛔ RED-PROOF. Every assertion here fails on current main, where `Number(ts) || 0` turns an ISO
   * timestamp into NaN → 0 → "". `cloudCheckDeleted` hands `deletedAt` through from Postgres,
   * where `deleted_at` IS an ISO string, so the deleted-project screen rendered
   * "was moved to Recently deleted ." — the reported stray space was the missing relative time,
   * not a typo. The bin LIST was unaffected (`listDeletedProjects` calls toMs first), which is
   * exactly how one broken caller stayed invisible beside a correct one. */
  const now = Date.parse("2026-09-08T12:00:00.000Z");

  it("parses the Postgres ISO timestamp the deleted-project screen actually receives", () => {
    expect(relTime("2026-09-08T11:55:00.000Z", now)).toBe("5m ago");
    expect(relTime("2026-09-08T09:00:00.000Z", now)).toBe("3h ago");
    expect(relTime("2026-09-06T12:00:00.000Z", now)).toBe("2d ago");
    expect(relTime("2026-09-08T11:59:50.000Z", now)).toBe("just now");
  });

  it("still reads a numeric epoch, whether as a number or a numeric string", () => {
    expect(relTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relTime(String(now - 5 * 60_000), now)).toBe("5m ago");
  });

  it("returns empty — never a partial string — for something genuinely unparseable", () => {
    for (const junk of ["", "not a date", null, undefined, 0, {}, []]) {
      expect(relTime(junk, now)).toBe("");
    }
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

// Adversarial review of B1156864 (NEW-1) — measured live: three "tracked" market records
// (comps-only, no plan/layout) polluted every cross-workspace "pick a project" surface this
// function feeds (AppHeader -> ProjectBreadcrumb, plus the Model/Notes/Scheduler workspaces'
// own project switchers), because `loadSiteSummaries()` is a plain passthrough of whatever role
// a record carries and nothing downstream of it filtered. `SitePlannerApp.jsx`'s own `siteGroups`
// (the map's Sites list) already filtered correctly — this closes the SAME gap at the other
// choke point every other workspace actually calls through.
describe("listProjects — pursuit-only by default (NEW-1)", () => {
  beforeEach(() => {
    setActiveUser(null); // logged-out store — deterministic, no network
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
  });

  it("excludes a tracked site from the project switcher", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      real: { id: "real", groupId: "real", site: "Goose Creek", role: "pursuit", updatedAt: 100 },
      trk1: { id: "trk1", groupId: "trk1", site: "Core 5 - West Hardy", name: "Market record", role: "tracked", updatedAt: 200 },
    }));
    const out = listProjects();
    expect(out.map((p) => p.id)).toEqual(["real"]);
  });

  it("still includes every ordinary (role-less legacy, or explicit pursuit) project", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      legacy: { id: "legacy", groupId: "legacy", site: "Pre-feature site", updatedAt: 50 }, // no role key at all
      fresh: { id: "fresh", groupId: "fresh", site: "Fresh site", role: "pursuit", updatedAt: 60 },
    }));
    expect(listProjects().map((p) => p.id).sort()).toEqual(["fresh", "legacy"]);
  });
});

// B1407824 — a truncated project/plan name was rendering with a dangling trailing comma and no
// ellipsis ("ALUMAX RD, NASH,") on five Dashboard surfaces (the Locations map pin, the Pursuits
// table, the Recent plans tile caption, and the Since-you-were-last-here feed's plan rows).
// `shortenDisplayName` is the ONE shared place that decides how a name shortens for all of them —
// and, per the production evidence surfaced by the sibling B1399568 fix below (the exact same
// stored value, read straight off two real `sites` rows), the reported name is not actually long:
// it's exactly "ALUMAX RD, NASH," with nothing more ever following, so a length-only truncate can
// never fix it — there's nothing left to cut. This function does two different things accordingly.
describe("shortenDisplayName", () => {
  // The adjacent-case table the fix was built against, one row per case.
  it("a name shorter than the limit, with no dangling punctuation, is returned untouched", () => {
    expect(shortenDisplayName("Short Name", 20)).toBe("Short Name");
  });

  it("a name exactly at the limit is returned untouched — fits exactly, not 'cut'", () => {
    expect(shortenDisplayName("ExactlyTenChars!", 16)).toBe("ExactlyTenChars!");
  });

  it("a name cut mid-word is shortened cleanly — a mid-word cut IS an ordinary shortened name", () => {
    expect(shortenDisplayName("Alumax Road Industrial Park", 10)).toBe("Alumax Roa…");
  });

  it("a name cut immediately after a comma trims the comma before marking it shortened", () => {
    expect(shortenDisplayName("ALUMAX RD, NASH, TX 75569", 16)).toBe("ALUMAX RD, NASH…");
  });

  it("a name that FITS but itself dangles on a comma is cleaned, with no ellipsis — nothing was cut, there's nothing left to shorten it to", () => {
    // The exact reported production string, confirmed elsewhere in this file (see
    // findProjectAtOrigin's own fixture below) to be the real, complete stored value — not a
    // truncated prefix of something longer. A length-based cut can't fix this; only cleanup can.
    expect(shortenDisplayName("ALUMAX RD, NASH,", 16)).toBe("ALUMAX RD, NASH");
    expect(shortenDisplayName("ALUMAX RD, NASH,", 100)).toBe("ALUMAX RD, NASH");
  });

  it("a name cut immediately after a period trims the period before marking it shortened", () => {
    expect(shortenDisplayName("Building A. Extra text here", 11)).toBe("Building A…");
  });

  it("a name cut immediately after a hyphen trims the hyphen before marking it shortened", () => {
    expect(shortenDisplayName("Alumax-Rd-Extension", 10)).toBe("Alumax-Rd…");
  });

  it("a name cut immediately after a space trims the space before marking it shortened", () => {
    expect(shortenDisplayName("Foo Bar Baz Qux", 8)).toBe("Foo Bar…");
  });

  it("one long word with no separators — nothing to trim back to, so it just cuts and marks it", () => {
    expect(shortenDisplayName("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif…");
  });

  it("a run of several trailing separators is trimmed in full, not just the last one", () => {
    expect(shortenDisplayName("Foo Bar, , TX", 9)).toBe("Foo Bar…");
  });

  it("a fitting name's trailing SPACE is left alone — plain whitespace isn't 'broken text'", () => {
    expect(shortenDisplayName("Trailing Space  ", 20)).toBe("Trailing Space  ");
  });

  it("null/empty/undefined never throw and never fabricate a mark", () => {
    expect(shortenDisplayName(null, 10)).toBe("");
    expect(shortenDisplayName(undefined, 10)).toBe("");
    expect(shortenDisplayName("", 10)).toBe("");
  });

  // RED-PROOF — no name this function returns may end on a dangling comma, period or hyphen, and
  // every name it genuinely SHORTENED (cut for space) must carry the one visible mark that it was.
  // Run across a spread of inputs and limits so this is a property of the function, not one lucky
  // case — including the "fits but dangles" shape the naive length-only design above couldn't
  // reach at all.
  it("RED-PROOF: never ends on a comma/period/hyphen, and every space-driven cut is visibly marked", () => {
    const names = [
      "ALUMAX RD, NASH, TX 75569",
      "ALUMAX RD, NASH,", // fits under every maxLen tried below — the reported case itself
      "Building A. Extra text here",
      "Alumax-Rd-Extension Industrial",
      "Foo Bar Baz Qux Industrial Park",
      "Supercalifragilisticexpialidocious",
      "St. Louis, MO - Industrial Park",
      "One,Two,Three,Four,Five,Six,Seven",
    ];
    for (const name of names) {
      for (let maxLen = 1; maxLen <= name.length + 2; maxLen++) {
        const out = shortenDisplayName(name, maxLen);
        expect(out).not.toMatch(/[,.\-]$/); // never ends on a dangling comma/period/hyphen
        if (name.length <= maxLen) {
          expect(out.endsWith("…")).toBe(false); // nothing was cut for space — no mark
          continue;
        }
        expect(out.endsWith("…")).toBe(true); // genuinely shortened — always visibly marked
        expect(out.slice(0, -1)).not.toMatch(/\s$/); // and never on a dangling space either
      }
    }
  });
});

// B1399568 — ADOPT, DON'T MINT: planning a site on ground that already carries a project must
// find that project rather than let a second `group_id = id` row be minted. Production evidence:
// two projects born 51s apart at byte-identical origin coordinates (lat 33.44769381770632, lon
// -94.13769222822577 — "ALUMAX RD, NASH,", Bowie county), both empty shells. `findProjectAtOrigin`
// is the pure decision SitePlannerApp.jsx's newSiteFromMap/newBlankSite consult before minting —
// see its header in projectModel.js. Full mint-vs-adopt integration proof (through the real
// storage.js saveSite/loadSitesList) lives in test/duplicateProjectOrigin.test.js; this suite
// covers the matching rule itself.
describe("distanceFeetBetween — pure haversine distance", () => {
  it("is 0 for the identical point", () => {
    expect(distanceFeetBetween({ lat: 33.4, lon: -94.1 }, { lat: 33.4, lon: -94.1 })).toBe(0);
  });

  it("is Infinity for a missing or non-finite point on either side", () => {
    expect(distanceFeetBetween(null, { lat: 1, lon: 1 })).toBe(Infinity);
    expect(distanceFeetBetween({ lat: 1, lon: 1 }, { lat: NaN, lon: 1 })).toBe(Infinity);
    expect(distanceFeetBetween({ lat: 1, lon: 1 }, undefined)).toBe(Infinity);
  });

  it("reports a real distance in the right ballpark for a known-separated pair", () => {
    // Roughly a degree of latitude apart ≈ 364,000-366,000 ft (~69 miles) at this latitude.
    const d = distanceFeetBetween({ lat: 33.0, lon: -94.0 }, { lat: 34.0, lon: -94.0 });
    expect(d).toBeGreaterThan(360000);
    expect(d).toBeLessThan(367000);
  });
});

describe("findProjectAtOrigin — the ADOPT decision", () => {
  const ORIGIN = { lat: 33.44769381770632, lon: -94.13769222822577 };

  it("returns null when nothing exists at this ground yet", () => {
    const records = [{ id: "g1", groupId: "g1", origin: { lat: 40, lon: -100 }, updatedAt: 100 }];
    expect(findProjectAtOrigin(records, ORIGIN)).toBeNull();
  });

  it("returns null for an unusable origin (missing / non-finite)", () => {
    const records = [{ id: "g1", groupId: "g1", origin: ORIGIN, updatedAt: 100 }];
    expect(findProjectAtOrigin(records, null)).toBeNull();
    expect(findProjectAtOrigin(records, { lat: NaN, lon: ORIGIN.lon })).toBeNull();
  });

  it("finds a project at the byte-identical production origin", () => {
    const records = [{ id: "smtu8o27freg", groupId: "smtu8o27freg", site: "ALUMAX RD, NASH,", origin: ORIGIN, updatedAt: 1000 }];
    expect(findProjectAtOrigin(records, ORIGIN)).toBe("smtu8o27freg");
  });

  it("matches any plan in a group, not only the anchor row (a plan's origin mirrors its project's)", () => {
    const records = [
      { id: "anchorA", groupId: "anchorA", origin: ORIGIN, updatedAt: 100 },
      { id: "plan2", groupId: "anchorA", origin: ORIGIN, updatedAt: 500 }, // a second plan of the SAME project
    ];
    expect(findProjectAtOrigin(records, ORIGIN)).toBe("anchorA");
  });

  it("does not match a genuinely different location", () => {
    const records = [{ id: "g1", groupId: "g1", origin: { lat: 29.76, lon: -95.37 }, updatedAt: 100 }]; // Houston, TX — far away
    expect(findProjectAtOrigin(records, ORIGIN)).toBeNull();
  });

  it("tolerates float jitter within SAME_GROUND_FT but not beyond it", () => {
    const records = [{ id: "g1", groupId: "g1", origin: ORIGIN, updatedAt: 100 }];
    // ~1e-6 deg of lat is on the order of a few inches — well inside the tolerance.
    const nudgedIn = { lat: ORIGIN.lat + 0.000001, lon: ORIGIN.lon };
    expect(findProjectAtOrigin(records, nudgedIn)).toBe("g1");
    // A degree of latitude is tens of miles — far outside SAME_GROUND_FT.
    const farAway = { lat: ORIGIN.lat + 1, lon: ORIGIN.lon };
    expect(findProjectAtOrigin(records, farAway)).toBeNull();
    expect(SAME_GROUND_FT).toBeLessThan(500); // sanity: this is a tight "same click" tolerance, not a neighborhood radius
  });

  it("excludes a given group id (never adopts itself)", () => {
    const records = [{ id: "g1", groupId: "g1", origin: ORIGIN, updatedAt: 100 }];
    expect(findProjectAtOrigin(records, ORIGIN, { excludeGroupId: "g1" })).toBeNull();
  });

  it("breaks a tie between pre-existing duplicates by picking the most recently updated group", () => {
    const records = [
      { id: "older", groupId: "older", origin: ORIGIN, updatedAt: 100 },
      { id: "newer", groupId: "newer", origin: ORIGIN, updatedAt: 900 },
    ];
    expect(findProjectAtOrigin(records, ORIGIN)).toBe("newer");
  });

  it("ignores records with no origin at all", () => {
    const records = [{ id: "g1", groupId: "g1", origin: null, updatedAt: 100 }];
    expect(findProjectAtOrigin(records, ORIGIN)).toBeNull();
  });
});

// NEW-2 — a rename bumps `updatedAt`, and `groupProjects`' sort is most-recent-first, so a rename
// jumps the renamed row to the top the instant it commits — while a keyboard user's focus (and a
// mouse user's pointer) inside the still-open switcher dropdown is resolved against the layout
// from BEFORE that jump. `applyFrozenOrder` is what ProjectBreadcrumb.jsx applies for as long as
// the dropdown stays open, so the reported failure ("renamed Aldine Bender 1, pressed Enter, the
// app opened Ta Chen — the row that was sitting at the top") is a MODEL-LEVEL property, not just
// a UI screenshot: the row order a caller sees must not move mid-edit no matter what the
// underlying recency sort says happened to `updatedAt`.
describe("applyFrozenOrder", () => {
  const ROWS = [
    { id: "tachen", name: "Ta Chen", updatedAt: 3000 },
    { id: "third", name: "Third Project", updatedAt: 2000 },
    { id: "aldine", name: "Aldine Bender 1", updatedAt: 1000 },
  ];

  it("with no snapshot, is a pass-through (the ordinary, un-frozen case)", () => {
    expect(applyFrozenOrder(ROWS, null)).toBe(ROWS); // same reference — never a needless copy
    expect(applyFrozenOrder(ROWS, [])).toBe(ROWS);
  });

  it("⛔ THE REPORTED CASE: a rename that bumps the renamed row to #1 does not move it in the FROZEN view", () => {
    const snapshot = ROWS.map((r) => r.id); // taken the moment the rename started
    // The rename lands: Aldine's updatedAt jumps past everyone, which is exactly what
    // `groupProjects`' real recency sort would now do — re-sort as `groupProjects` does.
    const resorted = [...ROWS].map((r) => (r.id === "aldine" ? { ...r, updatedAt: 9999 } : r))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // The naive reorder: Aldine jumps to #1 and Ta Chen — the row that WAS #1 — slides to #2.
    expect(resorted.map((r) => r.id)).toEqual(["aldine", "tachen", "third"]);
    // Frozen: Ta Chen stays exactly where it was — first — never displaced into the slot Aldine
    // vacated, which is the slot a stray keystroke would otherwise fall through onto.
    const frozen = applyFrozenOrder(resorted, snapshot);
    expect(frozen.map((r) => r.id)).toEqual(["tachen", "third", "aldine"]);
    expect(frozen[0].id).toBe("tachen"); // still #1, exactly as before the rename
    expect(frozen[0].updatedAt).toBe(3000);
  });

  it("still reflects updated CONTENT (name/updatedAt) for the frozen id — only its POSITION is held", () => {
    const snapshot = ROWS.map((r) => r.id);
    const renamed = ROWS.map((r) => (r.id === "aldine" ? { ...r, name: "Aldine Bender 1 RENAMED", updatedAt: 9999 } : r));
    const frozen = applyFrozenOrder(renamed, snapshot);
    expect(frozen.map((r) => r.id)).toEqual(["tachen", "third", "aldine"]); // position unchanged
    expect(frozen[2].name).toBe("Aldine Bender 1 RENAMED"); // content is live
  });

  it("a project that did not exist at snapshot time is appended, never dropped", () => {
    const snapshot = ["tachen", "third"]; // "aldine" not yet known when the snapshot was taken
    const frozen = applyFrozenOrder(ROWS, snapshot);
    expect(frozen.map((r) => r.id)).toEqual(["tachen", "third", "aldine"]);
  });

  it("a project the snapshot names but the live list no longer has is simply absent, not a crash", () => {
    const snapshot = ["tachen", "ghost", "third", "aldine"];
    const frozen = applyFrozenOrder(ROWS, snapshot);
    expect(frozen.map((r) => r.id)).toEqual(["tachen", "third", "aldine"]);
  });

  it("ignores falsy entries in the list rather than throwing", () => {
    const withHole = [ROWS[0], null, ROWS[1]];
    expect(() => applyFrozenOrder(withHole, ["tachen", "third"])).not.toThrow();
  });
});

describe("reorderWithCurrentAndPinned (NEW-3/NEW-4 — the switcher's real display order)", () => {
  const LIST = [
    { id: "a", name: "A", updatedAt: 3000 },
    { id: "b", name: "B", updatedAt: 2000 },
    { id: "c", name: "C", updatedAt: 1000 },
    { id: "d", name: "D", updatedAt: 900 },
  ];

  it("with no current project and no pins, the list is unchanged", () => {
    expect(reorderWithCurrentAndPinned(LIST, null, [])).toEqual(LIST);
  });

  it("lifts the CURRENT project to the very top, wherever it sat", () => {
    const out = reorderWithCurrentAndPinned(LIST, "c", []);
    expect(out.map((p) => p.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("a project that is already #1 stays #1 (must not render twice)", () => {
    const out = reorderWithCurrentAndPinned(LIST, "a", []);
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("pinned projects follow current, in the caller's pin order, ahead of everyone else", () => {
    const out = reorderWithCurrentAndPinned(LIST, "c", ["d", "b"]);
    expect(out.map((p) => p.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("⛔ CURRENT WINS OVER PINNED: a project that is both current and pinned appears ONCE, at the top", () => {
    const out = reorderWithCurrentAndPinned(LIST, "b", ["b", "d"]);
    expect(out.map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
    expect(out.filter((p) => p.id === "b")).toHaveLength(1);
  });

  it("a pinned id no longer in the list is simply skipped, not a crash", () => {
    const out = reorderWithCurrentAndPinned(LIST, null, ["ghost", "d"]);
    expect(out.map((p) => p.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("a current id no longer in the list falls through to plain pin ordering", () => {
    const out = reorderWithCurrentAndPinned(LIST, "ghost", ["d"]);
    expect(out.map((p) => p.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("ignores falsy entries in the list rather than throwing", () => {
    const withHole = [LIST[0], null, LIST[1]];
    expect(() => reorderWithCurrentAndPinned(withHole, "a", ["b"])).not.toThrow();
  });

  it("composes with filterProjects: current still leads a search match, and drops out when it doesn't match", () => {
    const reordered = reorderWithCurrentAndPinned(LIST, "c", ["d"]);
    expect(filterProjects(reordered, "c").map((p) => p.id)).toEqual(["c"]);
    // "b" doesn't match "d" or "c" — current ("c") is absent from a query it doesn't match,
    // never force-shown.
    expect(filterProjects(reordered, "z-no-match").map((p) => p.id)).toEqual([]);
  });
});
