// test/scheduleOwnership.test.js
//
// EVERY SCHEDULE HAS AN OWNER — a project, or the organization. These are the teeth for
// src/shared/schedule/scheduleOwnership.js's six numbered invariants.
//
// ⛔ THE FIXTURE IS PRODUCTION, NOT A TIDY SANDBOX, AND THAT IS DELIBERATE (WRONG-CASE). It mirrors
// `public.planar_data` key `hs-v1` at __rev 4232, read 2026-09-08: twelve schedules, three of them
// carrying 301/278/161 tasks, FIVE of them owned by the single Goose Creek site, two owned by
// nothing at all, and an `nTid` counter map still holding entries for eight schedules that no
// longer exist. A simplified fixture — one project, two schedules, a clean counter map — passes
// every assertion below while hiding the two cases that actually matter here: the many-schedules-
// under-one-owner grouping, and the orphaned-counter growth.
import { describe, it, expect } from "vitest";
import {
  ORG_OWNER_KEY, OWNER_KIND_SITE, OWNER_KIND_ORG,
  ownerOf, ownerKeyOf, isOrgOwned, isSiteOwned,
  schedulesForOwner, partitionSchedules,
  scheduleLabelParts, crossScheduleLabel,
  migrateScheduleOwnership, pruneOrphanScheduleRefs, pruneScheduleRefs, normalizeScheduleOwnership,
  nameCollision, validateNewSchedule, suggestScheduleName, describeScheduleDelete,
} from "../src/shared/schedule/scheduleOwnership.js";

const GOOSE = "smqfy48tlk9j";
const GRAND = "smqfy2r7pdec";
const SOUTH = "smqiljx5fngg";
const PAPPA = "smqgpt12zh5o";
const RICH  = "smsdrvzr9gzx";
const RENAME = "smtjb0lrexb3";

// The production document's shape, faithfully: `projects` is an OBJECT keyed by small integer
// STRINGS (not an array), `nTid` is a per-schedule next-task-id map, `lastActiveBySite` is one
// pointer per site. Task arrays are stubbed to the right LENGTH — the assertions below are about
// ownership and reference hygiene, and every one of them would pass just as readily on real task
// objects, but a fixture carrying 780 fabricated tasks would obscure what is being asserted.
function tasks(n) { return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `t${i + 1}` })); }
function productionDoc() {
  const mk = (id, name, n, siteId) => {
    const p = { id, name, tasks: tasks(n) };
    if (siteId) p.linkedSiteId = siteId;
    return p;
  };
  return {
    __rev: 4232,
    nPid: 23,
    aPid: 1,
    // Orphaned counters: 4, 8–14, 17, 18 name schedules that were deleted and never cleaned up.
    nTid: { 1: 302, 2: 279, 3: 162, 4: 5, 5: 16, 6: 43, 7: 8, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1,
            13: 1, 14: 1, 15: 2, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 9 },
    lastActiveBySite: { [GRAND]: 2, [GOOSE]: 22, [RICH]: 15 },
    projects: {
      1:  mk(1,  "Goose Creek",       301, GOOSE),
      2:  mk(2,  "Grand Port",        278, GRAND),
      3:  mk(3,  "8 South",           161, SOUTH),
      5:  mk(5,  "Pursuits",           15, null),
      6:  mk(6,  "Pappadoupolos",      42, PAPPA),
      7:  mk(7,  "Operations",          7, null),
      15: mk(15, "Richfield",           1, RICH),
      16: mk(16, "ZZ-RENAME-TEST-G",    0, RENAME),
      19: mk(19, "Goose Creek (2)",     0, GOOSE),
      20: mk(20, "Goose Creek (3)",     0, GOOSE),
      21: mk(21, "Goose Creek (4)",     0, GOOSE),
      22: mk(22, "TAS Land Sale",       8, GOOSE),
    },
  };
}

describe("invariant 1 — every schedule resolves to exactly one owner", () => {
  it("never returns null, for any shape, including junk", () => {
    for (const s of [null, undefined, {}, 0, "x", [], { linkedSiteId: null }, { ownerKind: "nonsense" }]) {
      const o = ownerOf(s);
      expect(o).toBeTruthy();
      expect([OWNER_KIND_SITE, OWNER_KIND_ORG]).toContain(o.kind);
      expect(o.key).toBeTruthy();
    }
  });

  it("every schedule on the production document has an owner, before any migration", () => {
    const d = productionDoc();
    for (const p of Object.values(d.projects)) expect(ownerKeyOf(p)).toBeTruthy();
  });

  it("a site link with no explicit kind is inferred as site ownership", () => {
    expect(ownerOf({ linkedSiteId: GOOSE }).kind).toBe(OWNER_KIND_SITE);
    expect(ownerOf({ linkedSiteId: GOOSE }).key).toBe(GOOSE);
  });

  it("no link and no explicit kind belongs to the ORGANIZATION, not to nothing", () => {
    expect(ownerOf({ name: "Pursuits" }).kind).toBe(OWNER_KIND_ORG);
    expect(ownerOf({ name: "Pursuits" }).key).toBe(ORG_OWNER_KEY);
    expect(isOrgOwned({ name: "Pursuits" })).toBe(true);
    expect(isSiteOwned({ name: "Pursuits" })).toBe(false);
  });
});

describe("invariant 4 — the unowned state is unrepresentable", () => {
  it("ownerKind:'site' with a missing site falls back to the organization, never to a fourth state", () => {
    expect(ownerOf({ ownerKind: OWNER_KIND_SITE }).kind).toBe(OWNER_KIND_ORG);
    expect(ownerOf({ ownerKind: OWNER_KIND_SITE, linkedSiteId: "" }).kind).toBe(OWNER_KIND_ORG);
    expect(ownerOf({ ownerKind: OWNER_KIND_SITE, linkedSiteId: null }).key).toBe(ORG_OWNER_KEY);
  });

  it("an explicit org owner wins over a stale link left by an older build", () => {
    expect(ownerOf({ ownerKind: OWNER_KIND_ORG, linkedSiteId: GOOSE }).kind).toBe(OWNER_KIND_ORG);
  });
});

// B1939344 (NEW-1) — crossScheduleLabel/scheduleLabelParts moved INTO this module from
// public/sequence/index.html so the Dashboard's Schedule health / Needs Attention / "Since you
// were last here" cards can share the exact same "<Project> / <Schedule>" label the Reports tab
// has used since PR #1849, instead of a second hand-copy. This is the first time these functions
// are exercised by a plain `vitest` unit test rather than only a source-pattern check against the
// scheduler HTML page (test/schedulerEngine.test.js, which tests a separate hand-maintained mirror,
// ui-audit/stress/scheduler-engine.mjs).
describe("crossScheduleLabel / scheduleLabelParts — the qualified '<Project> / <Schedule>' label", () => {
  it("RED-PROOF (fails on unmodified main): two schedules named identically under different projects must not produce the same string", () => {
    const a = { name: "Master Schedule", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" };
    const b = { name: "Master Schedule", linkedSiteId: GRAND, linkedSiteName: "Grand Port" };
    expect(crossScheduleLabel(a)).toBe("Goose Creek / Master Schedule");
    expect(crossScheduleLabel(b)).toBe("Grand Port / Master Schedule");
    expect(crossScheduleLabel(a)).not.toBe(crossScheduleLabel(b));
  });

  it("the owner's real four same-named 'Master Schedule' rows (ids 1/2/3/6) each get their own distinct label", () => {
    const schedules = [
      { id: 1, name: "Master Schedule", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" },
      { id: 2, name: "Master Schedule", linkedSiteId: GRAND, linkedSiteName: "Grand Port" },
      { id: 3, name: "Master Schedule", linkedSiteId: SOUTH, linkedSiteName: "8 South" },
      { id: 6, name: "Master Schedule", linkedSiteId: PAPPA, linkedSiteName: "Pappadoupolos" },
    ];
    const labels = schedules.map(crossScheduleLabel);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual([
      "Goose Creek / Master Schedule",
      "Grand Port / Master Schedule",
      "8 South / Master Schedule",
      "Pappadoupolos / Master Schedule",
    ]);
  });

  it("an org-owned schedule always prints the fixed 'Organization' label, never a bare name", () => {
    expect(crossScheduleLabel({ name: "Pursuits", ownerKind: OWNER_KIND_ORG })).toBe("Organization / Pursuits");
    expect(crossScheduleLabel({ name: "Operations", ownerKind: OWNER_KIND_ORG })).toBe("Organization / Operations");
  });

  it("a site-owned schedule with no cached linkedSiteName yet falls back to a left half that can't be mistaken for a real project", () => {
    expect(crossScheduleLabel({ name: "Master Schedule", linkedSiteId: GOOSE, linkedSiteName: null }))
      .toBe("an unnamed project / Master Schedule");
    expect(crossScheduleLabel({ name: "Master Schedule", linkedSiteId: GOOSE, linkedSiteName: "" }))
      .toBe("an unnamed project / Master Schedule");
  });

  it("a nameless schedule keeps the existing 'Untitled schedule' fallback, qualified by its owner", () => {
    expect(crossScheduleLabel({ linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" })).toBe("Goose Creek / Untitled schedule");
    expect(crossScheduleLabel({ name: "", ownerKind: OWNER_KIND_ORG })).toBe("Organization / Untitled schedule");
  });

  it("never throws on junk input, and still names something", () => {
    for (const junk of [null, undefined, 0, "x", []]) {
      expect(() => crossScheduleLabel(junk)).not.toThrow();
      expect(crossScheduleLabel(junk)).toContain("Untitled schedule");
    }
  });

  it("scheduleLabelParts exposes the two halves crossScheduleLabel joins with ' / ', for sort/group use", () => {
    const schedule = { name: "Master Schedule", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek" };
    const { ownerLabel, name } = scheduleLabelParts(schedule);
    expect(ownerLabel).toBe("Goose Creek");
    expect(name).toBe("Master Schedule");
    expect(crossScheduleLabel(schedule)).toBe(`${ownerLabel} / ${name}`);
  });
});

describe("invariants 2 + 3 — migration is additive, idempotent, and never overwrites a decision", () => {
  it("assigns the production document exactly as the PR's table says, losing nothing", () => {
    const before = productionDoc();
    const after = migrateScheduleOwnership(before);

    // The assignment table. Ten site-owned (the link the data already carries), two org-owned —
    // and NOT ONE of them guessed from a name. See the module header for why name-matching, which
    // the dispatch brief anticipated needing, is deliberately not built.
    const table = Object.fromEntries(
      Object.values(after.projects).map((p) => [p.name, ownerOf(p).kind + ":" + (ownerOf(p).siteId || "org")])
    );
    expect(table).toEqual({
      "Goose Creek":       `site:${GOOSE}`,
      "Goose Creek (2)":   `site:${GOOSE}`,
      "Goose Creek (3)":   `site:${GOOSE}`,
      "Goose Creek (4)":   `site:${GOOSE}`,
      "TAS Land Sale":     `site:${GOOSE}`,
      "Grand Port":        `site:${GRAND}`,
      "8 South":           `site:${SOUTH}`,
      "Pappadoupolos":     `site:${PAPPA}`,
      "Richfield":         `site:${RICH}`,
      "ZZ-RENAME-TEST-G":  `site:${RENAME}`,
      "Pursuits":          "org:org",
      "Operations":        "org:org",
    });
  });

  it("NOTHING LOSES ITS TASKS and NOTHING BECOMES UNREACHABLE", () => {
    const before = productionDoc();
    const after = migrateScheduleOwnership(before);
    expect(Object.keys(after.projects).sort()).toEqual(Object.keys(before.projects).sort());
    for (const [pid, p] of Object.entries(before.projects)) {
      expect(after.projects[pid].tasks).toBe(p.tasks);          // the SAME array, never rebuilt
      expect(after.projects[pid].tasks.length).toBe(p.tasks.length);
      expect(after.projects[pid].name).toBe(p.name);
      expect(after.projects[pid].id).toBe(p.id);
    }
    // 301 + 278 + 161 + 15 + 42 + 7 + 1 + 8 = 813 tasks in, 813 out.
    const count = (d) => Object.values(d.projects).reduce((n, p) => n + p.tasks.length, 0);
    expect(count(after)).toBe(813);
    expect(count(after)).toBe(count(before));
  });

  it("is idempotent, and returns the SAME object once there is nothing to do", () => {
    const once = migrateScheduleOwnership(productionDoc());
    const twice = migrateScheduleOwnership(once);
    expect(twice).toBe(once);            // identity — never bumps __rev on a re-boot
    expect(twice).toEqual(once);
  });

  it("never overwrites an ownerKind someone already chose", () => {
    const d = { projects: { 1: { id: 1, name: "Pursuits", ownerKind: OWNER_KIND_ORG, linkedSiteId: GOOSE, tasks: [] } } };
    expect(migrateScheduleOwnership(d).projects[1].ownerKind).toBe(OWNER_KIND_ORG);
  });

  it("leaves a document with no projects completely alone", () => {
    for (const d of [null, undefined, {}, { projects: null }, 5]) expect(migrateScheduleOwnership(d)).toBe(d);
  });
});

describe("invariant 6 — deleting a schedule prunes every reference to it", () => {
  it("sweeps the eight orphaned next-task-id counters production is carrying", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    expect(Object.keys(d.nTid).sort((a, b) => a - b).map(Number))
      .toEqual([1, 2, 3, 5, 6, 7, 15, 16, 19, 20, 21, 22]);
    // Counters for schedules that still exist are untouched — this prunes, it never resets.
    expect(d.nTid[1]).toBe(302);
    expect(d.nTid[22]).toBe(9);
  });

  it("drops the deleted schedule's counter AND any last-active pointer aimed at it", () => {
    const before = normalizeScheduleOwnership(productionDoc());
    expect(before.lastActiveBySite[GOOSE]).toBe(22);
    const projects = { ...before.projects };
    delete projects[22];                                   // the owner deletes "TAS Land Sale"
    const after = pruneScheduleRefs({ ...before, projects });
    expect(after.nTid[22]).toBeUndefined();
    expect(after.lastActiveBySite[GOOSE]).toBeUndefined(); // no pointer left aimed at a ghost
    expect(after.lastActiveBySite[GRAND]).toBe(2);         // live pointers untouched
    expect(after.lastActiveBySite[RICH]).toBe(15);
  });

  it("deleting the three empty Goose Creek duplicates leaves the real one and its tasks intact", () => {
    let d = normalizeScheduleOwnership(productionDoc());
    for (const pid of [19, 20, 21]) {
      const projects = { ...d.projects };
      delete projects[pid];
      d = pruneScheduleRefs({ ...d, projects });
    }
    expect(schedulesForOwner(d.projects, GOOSE).map((p) => p.name)).toEqual(["Goose Creek", "TAS Land Sale"]);
    expect(d.projects[1].tasks.length).toBe(301);
    expect(d.projects[22].tasks.length).toBe(8);
    for (const pid of [19, 20, 21]) expect(d.nTid[pid]).toBeUndefined();
  });

  it("returns the same object when there is nothing orphaned", () => {
    const clean = { projects: { 1: { id: 1, name: "A", tasks: [] } }, nTid: { 1: 1 }, lastActiveBySite: {} };
    expect(pruneOrphanScheduleRefs(clean)).toBe(clean);
  });
});

describe("a project holds MORE THAN ONE schedule, and the organization is a container beside it", () => {
  // ⚠ HONEST NOTE, and it corrects the dispatch brief: this one does NOT fail on current main.
  // The brief's premise — that the data model had no room for a second schedule per project — was
  // measured at __rev 4195 and had already stopped being true by __rev 4232: production carries
  // FIVE schedules under the Goose Creek site right now, one of them ("TAS Land Sale", 8 tasks)
  // actively in use. This is kept as a REGRESSION guard, not presented as a fix.
  it("Goose Creek owns five schedules, each independently addressable", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    expect(schedulesForOwner(d.projects, GOOSE).map((p) => p.name))
      .toEqual(["Goose Creek", "Goose Creek (2)", "Goose Creek (3)", "Goose Creek (4)", "TAS Land Sale"]);
  });

  it("the organization is an owner in the same list, never an 'unassigned' pile", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    expect(schedulesForOwner(d.projects, ORG_OWNER_KEY).map((p) => p.name)).toEqual(["Pursuits", "Operations"]);
  });

  it("partitions into this project / the organization / everything else, with nothing dropped", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    const { here, org, elsewhere } = partitionSchedules(d.projects, GOOSE);
    expect(here.map((p) => p.name)).toEqual(["Goose Creek", "Goose Creek (2)", "Goose Creek (3)", "Goose Creek (4)", "TAS Land Sale"]);
    expect(org.map((p) => p.name)).toEqual(["Pursuits", "Operations"]);
    expect(elsewhere.map((p) => p.name)).toEqual(["Grand Port", "8 South", "Pappadoupolos", "Richfield", "ZZ-RENAME-TEST-G"]);
    expect(here.length + org.length + elsewhere.length).toBe(Object.keys(d.projects).length);
  });

  it("with no routed project, nothing is 'here' and every schedule is still accounted for", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    const { here, org, elsewhere } = partitionSchedules(d.projects, null);
    expect(here).toEqual([]);
    expect(org.length).toBe(2);
    expect(here.length + org.length + elsewhere.length).toBe(12);
  });

  it("a project with ZERO schedules partitions cleanly rather than throwing", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    const { here, org } = partitionSchedules(d.projects, "smq-no-such-project");
    expect(here).toEqual([]);
    expect(org.length).toBe(2);
  });

  it("accepts the shell's ARRAY shape as well as the document's OBJECT shape", () => {
    const d = normalizeScheduleOwnership(productionDoc());
    const asArray = Object.values(d.projects);
    expect(schedulesForOwner(asArray, GOOSE).length).toBe(schedulesForOwner(d.projects, GOOSE).length);
  });
});

describe("invariant 5 — creating a schedule REQUIRES a name and an explicit owner", () => {
  const projects = () => normalizeScheduleOwnership(productionDoc()).projects;

  it("refuses a blank, whitespace-only or missing name", () => {
    for (const name of ["", "   ", "\t\n", null, undefined, 5]) {
      const r = validateNewSchedule({ name, ownerKind: OWNER_KIND_SITE, siteId: GOOSE, projects: projects() });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/name/i);
    }
  });

  it("refuses a missing or bogus owner — an owner must be CHOSEN, never defaulted", () => {
    for (const ownerKind of [null, undefined, "", "unassigned", "none", "site "]) {
      const r = validateNewSchedule({ name: "Master Schedule", ownerKind, siteId: GOOSE, projects: projects() });
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    }
  });

  it("refuses a site owner with no site named", () => {
    const r = validateNewSchedule({ name: "Master Schedule", ownerKind: OWNER_KIND_SITE, siteId: null, projects: projects() });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/project/i);
  });

  it("accepts a named schedule under a project, and trims the name", () => {
    const r = validateNewSchedule({ name: "  Land Sale  ", ownerKind: OWNER_KIND_SITE, siteId: GOOSE, siteName: "Goose Creek", projects: projects() });
    expect(r.ok).toBe(true);
    expect(r.name).toBe("Land Sale");
    expect(r.ownerKind).toBe(OWNER_KIND_SITE);
    expect(r.siteId).toBe(GOOSE);
    expect(r.warning).toBeNull();
  });

  it("accepts a named schedule under the ORGANIZATION, and drops any stray site fields", () => {
    const r = validateNewSchedule({ name: "Pursuits 2027", ownerKind: OWNER_KIND_ORG, siteId: GOOSE, siteName: "Goose Creek", projects: projects() });
    expect(r.ok).toBe(true);
    expect(r.siteId).toBeNull();
    expect(r.siteName).toBeNull();
  });

  it("WARNS about a same-owner name collision but does not block it", () => {
    const r = validateNewSchedule({ name: "goose creek ", ownerKind: OWNER_KIND_SITE, siteId: GOOSE, projects: projects() });
    expect(r.ok).toBe(true);            // he is allowed to mean it
    expect(r.warning).toMatch(/already/i);
  });

  it("the SAME name under a DIFFERENT owner is not a collision at all", () => {
    const r = validateNewSchedule({ name: "Goose Creek", ownerKind: OWNER_KIND_SITE, siteId: GRAND, projects: projects() });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeNull();
    expect(nameCollision(projects(), GRAND, "Goose Creek")).toBe(false);
    expect(nameCollision(projects(), GOOSE, "Goose Creek")).toBe(true);
  });
});

describe("the pre-filled name is a SUGGESTION, never a silent auto-name", () => {
  const projects = () => normalizeScheduleOwnership(productionDoc()).projects;

  it("suggests the project's own name when it has no schedule yet", () => {
    expect(suggestScheduleName(projects(), OWNER_KIND_SITE, "smq-brand-new", "Bayou Bend")).toBe("Bayou Bend");
  });

  it("⛔ NEVER suggests 'Goose Creek (5)' — leaving it EMPTY is the whole fix", () => {
    // The three empty "Goose Creek (2)/(3)/(4)" schedules on production are what the old
    // auto-naming produced: three presses, three duplicates, no prompt at any point. A second
    // schedule under a project is a DIFFERENT thing (a master schedule and a land sale), so the
    // suggestion is withheld and the field is left for him to fill.
    const s = suggestScheduleName(projects(), OWNER_KIND_SITE, GOOSE, "Goose Creek");
    expect(s).toBe("");
    expect(s).not.toMatch(/\(\d+\)/);
  });

  it("suggests nothing for the organization — a cross-project schedule has to be named", () => {
    expect(suggestScheduleName(projects(), OWNER_KIND_ORG, null, null)).toBe("");
  });

  it("an empty suggestion cannot pass validation — so nothing can be created unnamed", () => {
    const suggested = suggestScheduleName(projects(), OWNER_KIND_SITE, GOOSE, "Goose Creek");
    expect(validateNewSchedule({ name: suggested, ownerKind: OWNER_KIND_SITE, siteId: GOOSE, projects: projects() }).ok).toBe(false);
  });
});

// B1404352 — the delete confirmation's own sentence. Must NAME the schedule and say what happens
// to its tasks (the item's own wording) — asserted here so the copy can't silently drift from
// what ScheduleOwnerList.jsx actually renders.
describe("describeScheduleDelete — the shell's inline delete confirmation sentence", () => {
  it("names the schedule and the exact task count when it has tasks", () => {
    expect(describeScheduleDelete("TAS Land Sale", 8)).toBe("Delete “TAS Land Sale”? This removes 8 tasks.");
  });

  it("singularizes for exactly one task", () => {
    expect(describeScheduleDelete("Richfield", 1)).toBe("Delete “Richfield”? This removes 1 task.");
  });

  it("says the schedule is empty rather than 'This removes 0 tasks'", () => {
    expect(describeScheduleDelete("Goose Creek (2)", 0)).toBe("Delete “Goose Creek (2)”? This schedule has no tasks.");
  });

  it("treats a missing/non-finite count as empty rather than throwing or printing NaN", () => {
    expect(describeScheduleDelete("Goose Creek (2)", undefined)).toBe("Delete “Goose Creek (2)”? This schedule has no tasks.");
    expect(describeScheduleDelete("Goose Creek (2)", null)).toBe("Delete “Goose Creek (2)”? This schedule has no tasks.");
    expect(describeScheduleDelete("Goose Creek (2)", NaN)).toBe("Delete “Goose Creek (2)”? This schedule has no tasks.");
  });

  it("falls back to a generic label rather than an empty/blank name", () => {
    expect(describeScheduleDelete("", 3)).toBe("Delete “this schedule”? This removes 3 tasks.");
    expect(describeScheduleDelete(null, 3)).toBe("Delete “this schedule”? This removes 3 tasks.");
  });

  it("trims whitespace in the name the same way every other schedule-name path does", () => {
    expect(describeScheduleDelete("  TAS Land Sale  ", 2)).toBe("Delete “TAS Land Sale”? This removes 2 tasks.");
  });
});
