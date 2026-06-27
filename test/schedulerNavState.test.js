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
import { sanitizeProjects, parseNavState, deriveCurrentProject, findBySiteId } from "../src/workspaces/scheduler/lib/navState.js";

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
