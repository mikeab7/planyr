/* B380 — the Schedule module's embedded-app bridge must never hand the shared header
 * a value it will dereference into a crash. The whole nav-state contract funnels
 * through three pure functions, so this locks the invariant that the
 * "first-render-before-data" race (and any malformed message) resolves to a clean
 * empty/null state instead of "Cannot read properties of undefined":
 *
 *   - sanitizeProjects(list)                     → always an array of plain objects
 *   - parseNavState(message)                     → validated nav state, or null
 *   - deriveCurrentProject(projects, id, section)→ a project, or null (never undefined/throw)
 *
 * Behaviour for the real embedded app's well-formed {id,name} payload must be
 * IDENTICAL to the previous inline logic; the extra coverage is the not-ready /
 * malformed shapes that used to be one undefined-entry away from tripping the
 * workspace ErrorBoundary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sanitizeProjects, parseNavState, deriveCurrentProject, findBySiteId, findAllBySiteId,
  needsScheduleCarryIn, dashboardNavActions, isPickShowing, isGridMismatched, newProjectAction,
} from "../src/workspaces/scheduler/lib/navState.js";

const WELL_FORMED = [{ id: 1, name: "Goose Creek" }, { id: 3, name: "Grand Port Logistics" }];
const navMsg = (over = {}) => ({ source: "planar-seq", type: "planar:nav-state", section: "projects", activeId: 3, projects: WELL_FORMED, ...over });

describe("sanitizeProjects — always a safe array of objects", () => {
  it("passes the real embedded payload through unchanged in shape", () => {
    expect(sanitizeProjects(WELL_FORMED)).toEqual([{ id: 1, name: "Goose Creek" }, { id: 3, name: "Grand Port Logistics" }]);
  });

  it("coerces a non-array (undefined/null/object/string) to []", () => {
    expect(sanitizeProjects(undefined)).toEqual([]);
    expect(sanitizeProjects(null)).toEqual([]);
    expect(sanitizeProjects({})).toEqual([]);
    expect(sanitizeProjects("nope")).toEqual([]);
  });

  it("drops null/undefined/primitive entries — the values that would throw on a later p.id read", () => {
    const out = sanitizeProjects([{ id: 1, name: "A" }, undefined, null, 5, "x", { id: 2, name: "B" }]);
    expect(out).toEqual([{ id: 1, name: "A" }, { id: 2, name: "B" }]);
    // every surviving entry is a real object → p.id / p.name can't throw
    out.forEach((p) => expect(typeof p).toBe("object"));
  });

  it("keeps an object entry that lacks an id (id → null) rather than dropping it", () => {
    expect(sanitizeProjects([{ name: "No id yet" }])).toEqual([{ id: null, name: "No id yet" }]);
  });
});

describe("parseNavState — validate + sanitize at the source", () => {
  it("returns the validated, sanitized nav state for a real message", () => {
    expect(parseNavState(navMsg())).toEqual({ section: "projects", activeId: 3, projects: WELL_FORMED });
  });

  it("ignores anything that isn't the embedded scheduler's nav-state", () => {
    expect(parseNavState(null)).toBeNull();
    expect(parseNavState(undefined)).toBeNull();
    expect(parseNavState({ source: "someone-else", type: "planar:nav-state" })).toBeNull();
    expect(parseNavState({ source: "planar-seq", type: "planar:other" })).toBeNull();
    expect(parseNavState("string-message")).toBeNull();
  });

  it("defaults section to 'projects' and activeId to null when absent", () => {
    const nav = parseNavState({ source: "planar-seq", type: "planar:nav-state", projects: [] });
    expect(nav).toEqual({ section: "projects", activeId: null, projects: [] });
  });

  it("sanitizes a malformed project list inside the message (no undefined entries survive)", () => {
    const nav = parseNavState(navMsg({ projects: [{ id: 1, name: "A" }, undefined, null] }));
    expect(nav.projects).toEqual([{ id: 1, name: "A" }]);
  });
});

describe("deriveCurrentProject — a project or null, never undefined, never a throw", () => {
  it("returns the active project when activeId matches", () => {
    expect(deriveCurrentProject(WELL_FORMED, 3, "projects")).toEqual({ id: 3, name: "Grand Port Logistics" });
  });

  it("returns null on the Dashboard (reports) view even with an activeId", () => {
    expect(deriveCurrentProject(WELL_FORMED, 3, "reports")).toBeNull();
  });

  it("returns null (not undefined) when activeId is absent or not in the list — the race window", () => {
    expect(deriveCurrentProject([], null, "projects")).toBeNull();
    expect(deriveCurrentProject(WELL_FORMED, 999, "projects")).toBeNull();
    expect(deriveCurrentProject(WELL_FORMED, null, "projects")).toBeNull();
  });

  it("never throws on a non-array or a list with falsy entries (defense-in-depth)", () => {
    expect(deriveCurrentProject(undefined, 1, "projects")).toBeNull();
    expect(deriveCurrentProject(null, 1, "projects")).toBeNull();
    expect(() => deriveCurrentProject([undefined, null, { id: 1, name: "A" }], 1, "projects")).not.toThrow();
    expect(deriveCurrentProject([undefined, null, { id: 1, name: "A" }], 1, "projects")).toEqual({ id: 1, name: "A" });
  });
});

describe("cross-module link (schema v9) — carry linkedSiteId and find a schedule by site", () => {
  it("an UNLINKED schedule keeps the exact prior {id,name} shape (no null-field noise)", () => {
    expect(sanitizeProjects([{ id: 1, name: "Goose Creek" }])).toEqual([{ id: 1, name: "Goose Creek" }]);
  });

  it("a LINKED schedule carries linkedSiteId/linkedSiteName through", () => {
    const out = sanitizeProjects([{ id: 2, name: "Pappadoupolos", linkedSiteId: "grp-9", linkedSiteName: "Pappadoupolos" }]);
    expect(out).toEqual([{ id: 2, name: "Pappadoupolos", linkedSiteId: "grp-9", linkedSiteName: "Pappadoupolos" }]);
  });

  it("a link with no cached name defaults linkedSiteName to null but keeps the id", () => {
    expect(sanitizeProjects([{ id: 3, name: "X", linkedSiteId: "grp-1" }]))
      .toEqual([{ id: 3, name: "X", linkedSiteId: "grp-1", linkedSiteName: null }]);
  });

  it("parseNavState passes the link fields through for the project-aware breadcrumb", () => {
    const linked = [{ id: 2, name: "Pappadoupolos", linkedSiteId: "grp-9", linkedSiteName: "Pappadoupolos" }];
    const nav = parseNavState({ source: "planar-seq", type: "planar:nav-state", section: "projects", activeId: 2, projects: linked });
    expect(nav.projects).toEqual(linked);
  });

  it("findBySiteId returns the schedule linked to a Site Planner project (group_id)", () => {
    const projects = sanitizeProjects([
      { id: 1, name: "Goose Creek" },
      { id: 2, name: "Pappadoupolos", linkedSiteId: "grp-9", linkedSiteName: "Pappadoupolos" },
    ]);
    expect(findBySiteId(projects, "grp-9")).toEqual({ id: 2, name: "Pappadoupolos", linkedSiteId: "grp-9", linkedSiteName: "Pappadoupolos" });
  });

  it("findBySiteId returns null when nothing is linked to that site, or args are missing", () => {
    const projects = sanitizeProjects([{ id: 1, name: "Goose Creek" }]);
    expect(findBySiteId(projects, "grp-9")).toBeNull();
    expect(findBySiteId(projects, null)).toBeNull();
    expect(findBySiteId(undefined, "grp-9")).toBeNull();
  });
});

describe("needsScheduleCarryIn — re-drive the grid onto the routed site's schedule (boot-race self-heal)", () => {
  const LINKED = sanitizeProjects([
    { id: 1, name: "Goose Creek", linkedSiteId: "gc", linkedSiteName: "Goose Creek" },
    { id: 2, name: "Grand Port", linkedSiteId: "gp", linkedSiteName: "Grand Port" },
    { id: 5, name: "Pursuits" }, // unlinked, cross-cutting schedule
  ]);

  it("false once the iframe's active schedule already IS the routed site's linked one (adopted → stop driving)", () => {
    expect(needsScheduleCarryIn(LINKED, "gc", 1)).toBe(false);
  });

  it("true when the grid is on a DIFFERENT schedule than the routed link (the reported divergence: route=Goose Creek, grid=Grand Port)", () => {
    expect(needsScheduleCarryIn(LINKED, "gc", 2)).toBe(true);
  });

  it("true while the embed's projects haven't loaded yet — keeps driving until the iframe can switch (the dropped-select race)", () => {
    expect(needsScheduleCarryIn([], "gc", null)).toBe(true);
    expect(needsScheduleCarryIn(undefined, "gc", 2)).toBe(true);
  });

  it("false when there is no routed site — nothing to carry", () => {
    expect(needsScheduleCarryIn(LINKED, null, 2)).toBe(false);
    expect(needsScheduleCarryIn(LINKED, undefined, 2)).toBe(false);
  });

  it("true for a routed site with no linked schedule — post is an inert no-op in the iframe; the resolution panel handles create/link", () => {
    expect(needsScheduleCarryIn(LINKED, "unlinked-site", 1)).toBe(true);
  });

  /* NEW-2 — "showing the routed site's schedule" is TWO facts: the right project is ACTIVE and the
   * embed is on its PROJECTS section rather than its own Dashboard (reports). Comparing only the
   * active id is what made jumping Site Planner → Schedule inside a project land on the dashboard:
   * the embed persists `section:"reports"` after a Dashboard press while `aPid` still names the
   * routed project's schedule, so the carry-in answered "nothing to do" and posted nothing. */
  it("true when the routed schedule is active but the embed is on its own Dashboard (the reported landing)", () => {
    expect(needsScheduleCarryIn(LINKED, "gp", 2, "reports")).toBe(true);
  });

  it("false only when the routed schedule is active AND the embed is on the projects section", () => {
    expect(needsScheduleCarryIn(LINKED, "gp", 2, "projects")).toBe(false);
  });

  it("a deliberate Dashboard press inside Schedule is NOT caught by this — it clears the routed site first", () => {
    // dashboardNavActions sets clearRoute when a project is routed, so by the time the embed
    // reports "reports" the route carries nothing and there is nothing to carry in.
    expect(dashboardNavActions({ projectId: "gp" }).clearRoute).toBe(true);
    expect(needsScheduleCarryIn(LINKED, null, 2, "reports")).toBe(false);
  });

  it("an omitted section keeps the previous behaviour exactly (older caller / not reported yet)", () => {
    for (const s of [undefined, null]) {
      expect(needsScheduleCarryIn(LINKED, "gp", 2, s)).toBe(false);
      expect(needsScheduleCarryIn(LINKED, "gc", 2, s)).toBe(true);
    }
  });

  /* NEW-3/B1080547 — a site with TWO linked schedules: switching between them must never read as
   * "needs carry-in" (which would fight the switch back to whichever one the carry-in defaults to). */
  it("false for EITHER schedule once a site has two linked schedules — no fight between them", () => {
    const TWO = sanitizeProjects([
      { id: 1, name: "Richfield", linkedSiteId: "rf", linkedSiteName: "Richfield" },
      { id: 9, name: "Richfield (2)", linkedSiteId: "rf", linkedSiteName: "Richfield" },
    ]);
    expect(needsScheduleCarryIn(TWO, "rf", 1)).toBe(false);
    expect(needsScheduleCarryIn(TWO, "rf", 9)).toBe(false);
    expect(needsScheduleCarryIn(TWO, "rf", 999)).toBe(true); // a third, unrelated id is still a real mismatch
  });
});

describe("findAllBySiteId — every schedule linked to a site, not just the first (NEW-3/B1080547)", () => {
  it("returns every match, in list order", () => {
    const projects = sanitizeProjects([
      { id: 1, name: "Richfield", linkedSiteId: "rf", linkedSiteName: "Richfield" },
      { id: 2, name: "Other" },
      { id: 9, name: "Richfield (2)", linkedSiteId: "rf", linkedSiteName: "Richfield" },
    ]);
    expect(findAllBySiteId(projects, "rf").map((p) => p.id)).toEqual([1, 9]);
  });

  it("[] when nothing is linked, or args are missing — findBySiteId still returns the first match", () => {
    expect(findAllBySiteId([{ id: 1, name: "X" }], "rf")).toEqual([]);
    expect(findAllBySiteId(null, "rf")).toEqual([]);
    expect(findAllBySiteId([{ id: 1, name: "X" }], null)).toEqual([]);
    const projects = sanitizeProjects([
      { id: 1, name: "A", linkedSiteId: "rf", linkedSiteName: "A" },
      { id: 2, name: "B", linkedSiteId: "rf", linkedSiteName: "A" },
    ]);
    expect(findBySiteId(projects, "rf").id).toBe(1);
  });
});

/* NEW-5/B1080544 — THE PROVE-IT-RED CHECK the owner explicitly asked for: reproduce the reported
 * mechanism (a global, drifted `aPid` disagreeing with the route) and confirm the render gate
 * catches it — then confirm a LEGITIMATE state (the routed site's own schedule, or a deliberately
 * picked cross-cutting one) never gets caught by it. Owner repro, verbatim from production: routed
 * on Richfield (linkedSiteId "rf", its own schedule id 15), `aPid` reading 6 (Pappadoupolos, unrelated
 * to "rf") — breadcrumb said Richfield, the grid rendered Pappadoupolos's 41 tasks. */
describe("isGridMismatched — the route↔grid mismatch is made IMPOSSIBLE TO SEE (NEW-5/B1080544)", () => {
  const RICHFIELD = sanitizeProjects([
    { id: 6, name: "Pappadoupolos", linkedSiteId: "pap" },
    { id: 15, name: "Richfield", linkedSiteId: "rf" },
    { id: 5, name: "Pursuits" }, // unlinked, cross-cutting
  ]);

  it("RED: the exact production repro — routed on Richfield, a foreign aPid (Pappadoupolos) active", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 6, false)).toBe(true);
  });

  it("GREEN: the routed site's own schedule is active — never flagged", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 15, false)).toBe(false);
  });

  it("GREEN: a deliberately picked cross-cutting schedule is never flagged, even though its id doesn't match the route", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 5, /* pickShowing */ true)).toBe(false);
  });

  it("GREEN: no route, or the routed site has no schedule at all — the empty state owns that case, not this gate", () => {
    expect(isGridMismatched(RICHFIELD, null, 6, false)).toBe(false);
    expect(isGridMismatched(RICHFIELD, "unlinked-site", 6, false)).toBe(false);
  });

  it("RED persists across repeated checks — there is no latch that ever suppresses this (the defect this replaces)", () => {
    // The OLD Scheduler.jsx latched a `carriedRef` the first time it successfully carried a routed
    // project in, and never re-armed for that same project — so a LATER drift of `aPid` away from
    // the correct link went uncorrected forever. These pure helpers carry no such memory: the same
    // mismatch reads RED every single time it's asked, with no history dependence at all.
    for (let i = 0; i < 5; i++) {
      expect(isGridMismatched(RICHFIELD, "rf", 6, false)).toBe(true);
    }
  });
});

describe("newProjectAction — '+ New project' while routed links + names it, never mints an orphan (NEW-1/B1080545)", () => {
  it("routed on a project with no schedule yet: create + link + name after the project", () => {
    expect(newProjectAction({ projectId: "rf", routedSiteName: "Richfield", projects: [] }))
      .toEqual({ type: "create-linked", name: "Richfield", siteId: "rf", siteName: "Richfield" });
  });

  it("routed on a project that ALREADY has a schedule (NEW-3): a disambiguated name, never a second identical one", () => {
    const projects = sanitizeProjects([{ id: 1, name: "Richfield", linkedSiteId: "rf" }]);
    expect(newProjectAction({ projectId: "rf", routedSiteName: "Richfield", projects }))
      .toEqual({ type: "create-linked", name: "Richfield (2)", siteId: "rf", siteName: "Richfield" });
  });

  it("not routed (Operations/Pursuits-style, or org/dashboard): unchanged generic creation", () => {
    expect(newProjectAction({ projectId: null, routedSiteName: null, projects: [] })).toEqual({ type: "new" });
  });

  it("routed but the site name hasn't resolved yet: falls back to generic rather than naming a raw id (B560 defence)", () => {
    expect(newProjectAction({ projectId: "rf", routedSiteName: null, projects: [] })).toEqual({ type: "new" });
  });
});

/* B748064 — the owner's report: on a project with no linked schedule (the empty-state screen),
 * clicking a switcher row does nothing. A LINKED target works today because picking it also moves
 * the route (onProjectChange). A CROSS-CUTTING unlinked target (Operations/Pursuits) never moves
 * the route — it can't, it isn't tied to any site — so the fix has to let the pick win on its own
 * merits once it is genuinely showing in the embed. */
describe("isPickShowing — a deliberate switcher pick overrides the route-derived project", () => {
  it("false with no pick recorded (initial mount — must never match by coincidence)", () => {
    expect(isPickShowing(null, null, "projects")).toBe(false);
    expect(isPickShowing(undefined, null, "projects")).toBe(false);
  });

  it("false while the embed hasn't caught up to the pick yet (activeId still the old project)", () => {
    expect(isPickShowing(7, 1, "projects")).toBe(false);
  });

  it("true once the embed reports the picked id as active, on the projects section", () => {
    expect(isPickShowing(7, 7, "projects")).toBe(true);
  });

  it("false on the embed's own Dashboard (reports) even if the id happens to match", () => {
    expect(isPickShowing(7, 7, "reports")).toBe(false);
    expect(isPickShowing(7, 7, undefined)).toBe(false);
  });

  it("false once a later pick or the carry-in moves activeId on — self-clearing, no reset needed", () => {
    expect(isPickShowing(7, 2, "projects")).toBe(false);
  });
});

/* NEW-2 — source guards on the two Scheduler.jsx decisions the pure helpers can't express.
 * Both are ORDERING facts, and in both the old order let the embed's section outrank the URL. */
describe("Scheduler.jsx — the ROUTE outranks the embed's section", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");

  it("the carry-in passes `section` to needsScheduleCarryIn", () => {
    expect(SRC).toMatch(/needsScheduleCarryIn\(projects,\s*projectId,\s*activeId,\s*section\)/);
    // …and re-runs when the section changes, or a Dashboard→projects transition is never noticed.
    expect(SRC).toMatch(/\[ready,\s*projectId,\s*projects,\s*activeId,\s*section,\s*pickShowing\]/);
  });

  /* NEW-5/B1080544 — the `carriedRef` LATCH is GONE, not merely renamed. It used to suppress the
   * carry-in forever after the first successful drive for a routed project, which is exactly what
   * let a later drift of the shared/global `aPid` go uncorrected (the reported Richfield/
   * Pappadoupolos mismatch). The ONLY thing allowed to suppress a re-drive now is a genuine
   * deliberate pick (`pickShowing`) — never a "already did this once" memory. Both are asserted:
   * the dead code is really gone, AND its replacement is the one true suppression signal. */
  it("the carry-in latch is REMOVED — no `carriedRef` declaration or usage survives as live code", () => {
    // A comment may still name it in prose (explaining what was removed and why); what must be
    // gone is the LATCH ITSELF — the ref declaration and any `.current` read/write of it.
    expect(SRC).not.toMatch(/const carriedRef = useRef/);
    expect(SRC).not.toMatch(/carriedRef\.current/);
  });

  it("the carry-in's only suppression is a deliberate pick (`pickShowing`), computed before the effect", () => {
    const i = SRC.indexOf("const pickShowing = isPickShowing(");
    expect(i).toBeGreaterThan(-1);
    const effectStart = SRC.indexOf("useEffect(() => {", i);
    const block = SRC.slice(effectStart, effectStart + 300);
    expect(block).toMatch(/if \(pickShowing\) return;/);
    expect(block).toMatch(/if \(!needsScheduleCarryIn\(projects, projectId, activeId, section\)\) return;/);
  });

  it("a route↔grid mismatch hides the iframe (visibility) rather than ever rendering it — isGridMismatched wired into the iframe's style", () => {
    expect(SRC).toMatch(/const gridMismatched = ready && isGridMismatched\(/);
    const i = SRC.indexOf("<iframe\n");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("/>", i));
    expect(block).toMatch(/visibility:\s*\(showEmptyState \|\| gridMismatched\)\s*\?\s*"hidden"\s*:\s*"visible"/);
  });

  it("a routed project names the breadcrumb even while the embed reports its Dashboard", () => {
    const i = SRC.indexOf("let currentProject;");
    const block = SRC.slice(i, i + 420);
    // The routed-project branch must come FIRST; `section === "reports"` may only answer for a
    // route with no project (which is what pressing Dashboard leaves behind).
    expect(block.indexOf("if (projectId != null)")).toBeLessThan(block.indexOf('section === "reports"'));
  });

  // NEW-1/B1080545 — "+ New project" must route through newProjectAction (never a bare
  // planar:nav-new post unconditionally) so a routed project can never mint an orphan.
  it('onNewProject decides via newProjectAction, not a bare "planar:nav-new" post', () => {
    const i = SRC.indexOf("onNewProject={() => {");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 400);
    expect(block).toMatch(/newProjectAction\(\{ projectId, routedSiteName, projects \}\)/);
    expect(block).toMatch(/planar:nav-create-linked/);
  });

  // NEW-2/B1080546 — Duplicate is reachable from the shell breadcrumb (the in-iframe project list
  // it used to depend on is hidden whenever the app runs inside the Planyr shell).
  it("onDuplicateProject is wired to the embedded app's nav-duplicate bridge", () => {
    expect(SRC).toMatch(/onDuplicateProject=\{\(id\) => post\(\{ type: "planar:nav-duplicate", id \}\)\}/);
  });
});
