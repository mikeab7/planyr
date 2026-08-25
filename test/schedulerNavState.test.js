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
import { sanitizeProjects, parseNavState, deriveCurrentProject, findBySiteId, needsScheduleCarryIn, dashboardNavActions, isPickShowing } from "../src/workspaces/scheduler/lib/navState.js";

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
    expect(SRC).toMatch(/\[ready,\s*projectId,\s*projects,\s*activeId,\s*section\]/);
  });

  it('the "already carried" latch is scoped to the projects section, so a return visit re-drives', () => {
    expect(SRC).toMatch(/carriedRef\.current === projectId && section === "projects"/);
  });

  it("a routed project names the breadcrumb even while the embed reports its Dashboard", () => {
    const i = SRC.indexOf("let currentProject;");
    const block = SRC.slice(i, i + 420);
    // The routed-project branch must come FIRST; `section === "reports"` may only answer for a
    // route with no project (which is what pressing Dashboard leaves behind).
    expect(block.indexOf("if (projectId != null)")).toBeLessThan(block.indexOf('section === "reports"'));
  });
});
