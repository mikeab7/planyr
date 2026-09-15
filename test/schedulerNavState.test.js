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

  // B1404352 — taskCount rides along so the shell's delete confirmation can name what it removes.
  it("a schedule with a reported taskCount carries it through", () => {
    expect(sanitizeProjects([{ id: 22, name: "TAS Land Sale", taskCount: 8 }]))
      .toEqual([{ id: 22, name: "TAS Land Sale", taskCount: 8 }]);
  });

  it("a schedule with NO reported taskCount keeps the exact prior shape — no null-field noise", () => {
    expect(sanitizeProjects([{ id: 1, name: "Goose Creek" }])).toEqual([{ id: 1, name: "Goose Creek" }]);
  });

  it("a taskCount of exactly 0 is carried through, not dropped as falsy", () => {
    expect(sanitizeProjects([{ id: 19, name: "Goose Creek (2)", taskCount: 0 }]))
      .toEqual([{ id: 19, name: "Goose Creek (2)", taskCount: 0 }]);
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

  it("GREEN: the routed site has no schedule at all — the empty state owns that case, not this gate", () => {
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

/* B1644368 (NEW-1 amendment, 2026-09-15) — a PROJECT-LESS route used to be an automatic "not
 * mismatched" (`siteId == null` short-circuited straight to `false`), and that was itself the bug
 * this session fixed: PR #1712 made the ROUTE and the BREADCRUMB honest on a project-less Schedule
 * arrival, but the GRID kept showing whatever project the embedded app's own account-wide `aPid`
 * field happened to hold — live-synced, fully visible, and fully clickable — reproduced live as a
 * project-less `#/schedule` rendering Goose Creek's real Master Schedule under a breadcrumb reading
 * "Select a project." These lock the corrected gate: a project-less route now has exactly one
 * honest "matched" answer (the iframe confirmed it switched to its own neutral reports view), same
 * as a routed project has exactly one ("the routed site's own linked schedule is active"). */
describe("isGridMismatched — the project-less case now matches too (B1644368)", () => {
  const RICHFIELD = sanitizeProjects([
    { id: 6, name: "Pappadoupolos", linkedSiteId: "pap" },
    { id: 15, name: "Richfield", linkedSiteId: "rf" },
    { id: 5, name: "Pursuits" }, // unlinked, cross-cutting
  ]);

  it("RED: no route, but the grid is still confirmed showing SOME project's own projects section — the exact live repro", () => {
    expect(isGridMismatched(RICHFIELD, null, 6, /* pickShowing */ false, /* navConfirmed */ true, "projects")).toBe(true);
  });

  it("GREEN: no route, and the grid has CONFIRMED it switched to its own neutral cross-project view", () => {
    expect(isGridMismatched(RICHFIELD, null, 6, false, true, "reports")).toBe(false);
  });

  it("RED: no route, unconfirmed load — fails closed exactly as a routed project would, never assumed safe by omission", () => {
    expect(isGridMismatched(RICHFIELD, null, 6, false, /* navConfirmed */ false, "reports")).toBe(true);
  });

  it("GREEN: no route, but a deliberate cross-cutting pick is genuinely showing — pickShowing still wins outright", () => {
    expect(isGridMismatched(RICHFIELD, null, 5, /* pickShowing */ true, true, "projects")).toBe(false);
  });

  it("omitting section defaults to \"projects\" — a project-less caller that says nothing is treated as still mismatched, not silently waved through", () => {
    expect(isGridMismatched(RICHFIELD, null, 6, false, true)).toBe(true);
  });
});

describe("newProjectAction — '+ New schedule' ASKS. It never names a schedule or picks an owner", () => {
  /* ⛔ RED-PROOF. Every assertion in this block FAILS on current main, where newProjectAction
   * returns `{ type: "create-linked", name: "Richfield (2)", … }` — a schedule created, named and
   * owned without anyone being asked. That behaviour is why production carries three empty
   * schedules called "Goose Creek (2)", "(3)" and "(4)": three presses, three duplicates, no
   * prompt at any point. The old block asserted the auto-naming as the CORRECT behaviour, which is
   * why nothing here caught it; these are its replacement, not an addition beside it. */

  it("never creates anything — the only action is to open the dialog", () => {
    for (const args of [
      { projectId: "rf", routedSiteName: "Richfield" },
      { projectId: null, routedSiteName: null },
      { projectId: "rf", routedSiteName: null },
      {},
    ]) {
      const a = newProjectAction(args);
      expect(a.type).toBe("prompt");
      // No name is decided here, by any path. A `name` in this result is the defect itself.
      expect(a.name).toBeUndefined();
    }
  });

  it("⛔ NEVER produces a '(2)'-style auto-name for a project that already has a schedule", () => {
    const a = newProjectAction({ projectId: "rf", routedSiteName: "Richfield" });
    expect(JSON.stringify(a)).not.toMatch(/\(\d+\)/);
    expect(JSON.stringify(a)).not.toMatch(/create-linked/);
  });

  it("pre-selects the routed project as the owner, as a suggestion the dialog can change", () => {
    expect(newProjectAction({ projectId: "rf", routedSiteName: "Richfield" }))
      .toEqual({ type: "prompt", siteId: "rf", siteName: "Richfield" });
  });

  it("outside a routed project it pre-selects nothing — the dialog opens on the Organization", () => {
    expect(newProjectAction({ projectId: null, routedSiteName: null }))
      .toEqual({ type: "prompt", siteId: null, siteName: null });
  });

  it("a routed project whose name hasn't resolved pre-selects nothing (B560 — never name a raw id)", () => {
    expect(newProjectAction({ projectId: "rf", routedSiteName: null }))
      .toEqual({ type: "prompt", siteId: null, siteName: null });
  });
});

/* B748064 — the owner's report: on a project with no linked schedule (the empty-state screen),
 * clicking a switcher row does nothing. A LINKED target works today because picking it also moves
 * the route (onProjectChange). A CROSS-CUTTING unlinked target (Operations/Pursuits) never moves
 * the route — it can't, it isn't tied to any site — so the fix has to let the pick win on its own
 * merits once it is genuinely showing in the embed. */
describe("isPickShowing — a deliberate switcher pick overrides the route-derived project", () => {
  it("false with no pick recorded (initial mount — must never match by coincidence)", () => {
    expect(isPickShowing(null, null, "projects", "gc")).toBe(false);
    expect(isPickShowing(undefined, null, "projects", "gc")).toBe(false);
  });

  it("false while the embed hasn't caught up to the pick yet (activeId still the old project)", () => {
    expect(isPickShowing({ id: 7, projectId: "gc" }, 1, "projects", "gc")).toBe(false);
  });

  it("true once the embed reports the picked id as active, on the projects section, while still routed on the pick's own project", () => {
    expect(isPickShowing({ id: 7, projectId: "gc" }, 7, "projects", "gc")).toBe(true);
  });

  it("false on the embed's own Dashboard (reports) even if the id happens to match", () => {
    expect(isPickShowing({ id: 7, projectId: "gc" }, 7, "reports", "gc")).toBe(false);
    expect(isPickShowing({ id: 7, projectId: "gc" }, 7, undefined, "gc")).toBe(false);
  });

  it("false once a later pick or the carry-in moves activeId on — self-clearing, no reset needed", () => {
    expect(isPickShowing({ id: 7, projectId: "gc" }, 2, "projects", "gc")).toBe(false);
  });

  /* ⛔ B1341184 — THE DEADLOCK. Before this fix, `isPickShowing` never looked at the routed
   * project at all, so a pick made under project A kept reading "showing" forever once activeId
   * caught up to it — even after the user switched the PROJECT breadcrumb to an unrelated project
   * B. Since `pickShowing` also gates the self-healing carry-in effect (Scheduler.jsx), nothing
   * could ever move `activeId` off the pick again: the schedule crumb was stuck naming project A's
   * schedule regardless of which project was routed. Reproduced live on planyr.io: pick "TAS Land
   * Sale" under Goose Creek, switch to Mesa/Grand Port/Richfield — the crumb never moved. */
  it("⛔ false once the ROUTED PROJECT changes away from the pick's own project, even though activeId hasn't moved yet — this is what re-enables the carry-in", () => {
    // TAS Land Sale (id 22) was picked under Goose Creek ("gc"); the embed still reports it
    // active, but the breadcrumb has since been switched to Grand Port ("grand").
    expect(isPickShowing({ id: 22, projectId: "gc" }, 22, "projects", "grand")).toBe(false);
  });

  it("true for a cross-cutting (unlinked) pick as long as the routed project hasn't changed", () => {
    // Pursuits (org-owned, no linkedSiteId) picked while routed on Goose Creek — the pick's
    // recorded project is the routed one at pick time, not a link the schedule doesn't have.
    expect(isPickShowing({ id: 5, projectId: "gc" }, 5, "projects", "gc")).toBe(true);
  });

  it("false for that same cross-cutting pick once the routed project changes", () => {
    expect(isPickShowing({ id: 5, projectId: "gc" }, 5, "projects", "grand")).toBe(false);
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

  // B1644368 (NEW-1 amendment) — the SCHEDULE crumb must never name a schedule the grid itself is
  // hidden for being wrong/unconfirmed about — that was the dispatch's exact reported repro
  // ("Select a project" beside "Master Schedule" in the same trail). `gridMismatched` must be
  // declared BEFORE `showScheduleCrumb` reads it (a `const` used before its declaration throws), and
  // `showScheduleCrumb`'s own condition must include it.
  it("the SCHEDULE crumb is suppressed while the grid is mismatched — the self-contradicting breadcrumb this session fixed", () => {
    const gridIdx = SRC.indexOf("const gridMismatched = ready && isGridMismatched(");
    const crumbIdx = SRC.indexOf("const showScheduleCrumb = ready && section ===");
    expect(gridIdx).toBeGreaterThan(-1);
    expect(crumbIdx).toBeGreaterThan(-1);
    expect(gridIdx, "gridMismatched must be declared before showScheduleCrumb reads it").toBeLessThan(crumbIdx);
    const line = SRC.slice(crumbIdx, SRC.indexOf(";", crumbIdx) + 1);
    expect(line).toMatch(/const showScheduleCrumb = ready && section === "projects" && !gridMismatched;/);
  });

  // B1435888 — SUPERSEDES the old "routed project names the breadcrumb even while the embed
  // reports its Dashboard" test. `currentProject` no longer reconciles against the embed's
  // transient `activeId`/`section` at all — it is a plain route-derived value, exactly like every
  // other workspace's project crumb, because the SCHEDULE (which does track activeId/section) is
  // now a separate crumb (`ScheduleCrumb`, planSlot). See the "the PROJECT crumb" test below.
  it("the PROJECT crumb is derived purely from the route (projectId/routedSiteName) — no branch on activeId or section", () => {
    const i = SRC.indexOf("const currentProject = projectId != null && routedSiteName");
    expect(i, "currentProject must be the plain route-derived ternary").toBeGreaterThan(-1);
  });

  // "+ New project" (the PROJECT crumb) must create a genuine new SITE project — the same action
  // every other workspace's breadcrumb offers — never a schedule.
  it('the PROJECT crumb\'s "+ New project" passes straight through to the real project-creation handler', () => {
    expect(SRC).toMatch(/onNewProject=\{onNewProject\}/);
  });

  // "+ New schedule" (the SCHEDULE crumb) must OPEN THE DIALOG, never post a create straight into
  // the iframe. Also red-proof: on main this block reads `post(action.type === "create-linked" ? …
  // )` and creates.
  it('the SCHEDULE crumb\'s "+ New schedule" opens the dialog rather than creating a schedule', () => {
    const i = SRC.indexOf("onCreate={() => setNewSchedulePrompt(");
    expect(i, '"+ New schedule" must route through setNewSchedulePrompt').toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 220);
    expect(block).toMatch(/newProjectAction\(\{ projectId, routedSiteName \}\)/);
    // The create post must NOT be reachable from this handler — the dialog owns it now.
    expect(block).not.toMatch(/planar:nav-create-linked/);
  });

  // The dialog is the ONE creation path: the empty state's own Create routes through it too, so
  // the two paths cannot drift into one that requires an owner and one that does not.
  it("the New-schedule dialog is the only thing that posts a create", () => {
    const posts = SRC.match(/planar:nav-create-linked/g) || [];
    expect(posts.length).toBe(1);
    const i = SRC.indexOf("planar:nav-create-linked");
    // ...and it sits inside NewScheduleModal's onCreate, which validated name + owner first.
    expect(SRC.slice(Math.max(0, i - 900), i)).toMatch(/<NewScheduleModal/);
    expect(SRC.slice(Math.max(0, i - 400), i)).toMatch(/ownerKind/);
  });

  // NEW-2/B1080546, RELOCATED by B1435888 — Duplicate is reachable from the SCHEDULE crumb's own
  // row now (ScheduleCrumb → ScheduleOwnerList), not the project crumb's kebab. It moved because
  // the project crumb became a genuine, uncontrolled site-project switcher with no schedule id to
  // resolve — see ScheduleOwnerList.jsx's own header on why the old kebab location would have
  // posted the wrong kind of id had it stayed. The browser-driven proof is
  // `e2e/scheduler-duplicate-menu.spec.js`, which mounts the real Scheduler chain and asserts the
  // Duplicate icon actually renders on the row and posts on click.
  it("onDuplicate on the SCHEDULE crumb is wired to the embedded app's nav-duplicate bridge", () => {
    const i = SRC.indexOf("<ScheduleCrumb");
    expect(i, "<ScheduleCrumb> must be rendered as the breadcrumb's planSlot").toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("/>", i) + 2);
    expect(block).toMatch(/onDuplicate=\{\(id\) => post\(\{ type: "planar:nav-duplicate", id \}\)\}/);
  });
});

/* B1112449/NEW-2 — the switcher must never collapse a site's MULTIPLE linked schedules down to
 * one unreachable row, and picking a schedule directly (never through the ambiguous site-id
 * fallback) must resolve unambiguously. */
describe("selectSchedule — a bare site id resolves definitely, not to always-the-first (B1112449/NEW-2)", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");
  // B1358128 — the resolution itself moved into projectModel.js's resolveControlledId (shared
  // with ProjectBreadcrumb.jsx's rename/delete/duplicate, which needed the identical logic and
  // never had it); selectSchedule now calls that shared function rather than reimplementing the
  // findAllBySiteId + prefer-active-schedule shape inline. Assert the call site here, and assert
  // the shared function itself still carries the real behavior in its own describe block below.
  it("delegates to the shared resolveControlledId(projects, id, activeId) rather than reimplementing resolution inline", () => {
    const i = SRC.indexOf("const selectSchedule = (id) => {");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("};", i));
    expect(block).toMatch(/resolveControlledId\(projects,\s*id,\s*activeId\)/);
    // The pre-fix shape — a bare `.find(p => p.linkedSiteId === id)` with no preference for the
    // already-active schedule — must not survive as the resolution path, in this file or the
    // shared one it now delegates to.
    expect(SRC).not.toMatch(/projects\.find\(\(p\) => p && p\.linkedSiteId === id\)/);
  });
});

describe("resolveControlledId — the shared resolution selectSchedule delegates to (B1358128)", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/shared/projects/projectModel.js", import.meta.url)), "utf8");
  it("uses list.filter (findAllBySiteId's own shape) + prefers the already-active schedule over the old always-first .find()", () => {
    const i = SRC.indexOf("export function resolveControlledId(");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("\n}", i));
    expect(block).toMatch(/list\.filter\(\(p\) => p && p\.linkedSiteId != null && p\.linkedSiteId === id\)/);
    expect(block).toMatch(/linked\.find\(\(p\) => p\.id === preferId\)/);
    expect(SRC).not.toMatch(/list\.find\(\(p\) => p && p\.linkedSiteId === id\)/);
  });
});

/* SUPERSEDED (B1435888) — B1112450/NEW-3 made `currentProject` follow the ACTIVE schedule on a
 * multi-schedule site, so the ONE breadcrumb named whichever schedule was really on screen. That
 * mechanism (`activeLinkedSchedule`/`linkedSchedules`) is gone along with the combined crumb it
 * fed: the SCHEDULE crumb now receives `activeId` directly and resolves its own displayed name
 * from it (see ScheduleCrumb.jsx), independently of the project crumb — which never needs to know
 * which schedule is active at all. */
describe("the SCHEDULE crumb (not currentProject) tracks the ACTIVE schedule on a multi-schedule site", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");
  it("<ScheduleCrumb> is handed activeId and the full bridged schedule list directly, not a pre-resolved single schedule", () => {
    const i = SRC.indexOf("<ScheduleCrumb");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("/>", i) + 2);
    expect(block).toMatch(/schedules=\{projects\}/);
    // B1341184 — never the bare `activeId`: while this project owns no schedule of its own, the
    // embed's activeId still names whatever OTHER project's schedule was last open, and the crumb
    // must not repeat that foreign name. See that fix's own note just above this prop in the source.
    expect(block).toMatch(/activeId=\{showEmptyState \? null : activeId\}/);
  });
});

/* B851 ×4 (NEW-1) — the ×3 fix's render gate (`isGridMismatched`) was correctly wired and its own
 * unit tests are sound — and STILL demonstrably not engaged over a wrong grid in production. LIVE
 * REPRODUCTION (planyr.io, signed in, 2026-09-03, on merge commit 2a9afc5 / PR #1367): routed on
 * Richfield (its own linked schedule id 15, 1 task), breadcrumb correctly read "Richfield", the grid
 * rendered ZERO rows — the iframe was actually showing project 16 (ZZ-RENAME-TEST-G, 0 tasks), and
 * `isGridMismatched` was returning false (not engaged) at that exact moment. Root cause: the gate
 * compares the ROUTE against the shell's BELIEF (`activeId`), and that belief only updates when the
 * embedded app posts a fresh `planar:nav-state` — which a backgrounded tab's silent self-reload
 * (B850) can leave stale for an arbitrary stretch, during which the reloaded document may already be
 * rendering a different project entirely. `navConfirmed` is the fix: false the instant the iframe's
 * `load` event fires (a fresh boot OR a reload), true only once a genuine nav-state lands for THAT
 * load — so an un-announced grid reads as mismatched even when the STALE belief it's being compared
 * against happens to already agree with the route. This is the exact case the ×3 fix's own tests
 * could never catch: they fed `isGridMismatched` a belief and asked whether IT was self-consistent,
 * never asked whether that belief was still current for what the iframe is actually showing. */
describe("isGridMismatched — navConfirmed makes the gate fail CLOSED across a reload with no fresh nav-state (B851 ×4/NEW-1)", () => {
  const RICHFIELD = sanitizeProjects([
    { id: 15, name: "Richfield", linkedSiteId: "rf" },
    { id: 16, name: "ZZ-RENAME-TEST-G" }, // unlinked — the production repro's foreign aPid
  ]);

  it("GREEN before any reload: the shell's belief (activeId 15) genuinely matches the route", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 15, false, /* navConfirmed */ true)).toBe(false);
  });

  it('RED: the exact production defect — a STALE belief that still reads "matched" must be treated as mismatched the instant it is unconfirmed, never assumed still-correct', () => {
    // The shell's `activeId` is untouched (still 15, still "correct" on paper) — nothing has told it
    // otherwise. The iframe, meanwhile, has silently reloaded and may be rendering ANY project by now
    // (in production it was rendering 16's zero-task grid). The old gate — no navConfirmed dimension
    // — read this as matched. The fixed gate must not, because "matched" was never re-proven for this
    // load.
    expect(isGridMismatched(RICHFIELD, "rf", 15, false, /* navConfirmed */ false)).toBe(true);
  });

  it("RED persists regardless of what the stale belief happens to say, including a value that would otherwise be a genuine mismatch too", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 16, false, false)).toBe(true);
    expect(isGridMismatched(RICHFIELD, "rf", null, false, false)).toBe(true);
  });

  it("GREEN once the reload's OWN nav-state lands and it genuinely matches — confirmation, not time, clears the gate", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 15, false, true)).toBe(false);
  });

  it("stays RED once confirmed if the reload's own nav-state reveals a genuine drift — this is the ×3 fix's original case, untouched", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 16, false, true)).toBe(true);
  });

  it("omitting navConfirmed preserves EVERY pre-×4 caller's exact prior behaviour (default true)", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 15, false)).toBe(false);
    expect(isGridMismatched(RICHFIELD, "rf", 16, false)).toBe(true);
  });

  it("an unconfirmed load never overrides a deliberate cross-cutting pick — pickShowing still short-circuits first", () => {
    expect(isGridMismatched(RICHFIELD, "rf", 16, /* pickShowing */ true, false)).toBe(false);
  });

  // B1644368 — SUPERSEDES the old assertion here that a project-less `siteId` bypassed
  // `navConfirmed` and read as matched regardless. It no longer does: an unconfirmed load fails
  // closed the same way whether or not the route names a project — see that item's own note on
  // `isGridMismatched` for why "unrouted" stopped being an automatic pass.
  it("an unconfirmed load on a project-less route ALSO fails closed now — unrouted no longer bypasses navConfirmed", () => {
    expect(isGridMismatched(RICHFIELD, null, 16, false, false)).toBe(true);
  });
});

/* The SHELL↔IFRAME BOUNDARY itself, simulated: this reproduces the exact sequence the live repro
 * went through — boot, confirm, silent reload, (no fresh nav-state yet), and only then either a
 * matching or a drifted confirmation — using the same state shape Scheduler.jsx threads through
 * (`navConfirmed` reset by every iframe `load`, set true only by a genuine nav-state message for
 * that load). Repo convention for this component is source-guard regex tests (no jsdom/React
 * rendering harness is configured — see vitest.config.js, Node environment only), so the boundary
 * is proven at the level Scheduler.jsx actually implements it: the same transition sequence its own
 * refs/state go through, run against the real pure gate function. */
describe("shell↔iframe boundary — an iframe reload with no fresh nav-state must never render as matched", () => {
  const RICHFIELD = sanitizeProjects([
    { id: 15, name: "Richfield", linkedSiteId: "rf" },
    { id: 16, name: "ZZ-RENAME-TEST-G" },
  ]);

  // Mirrors Scheduler.jsx's own state machine: onIframeLoad → navConfirmed=false;
  // onMsg(nav-state) → activeId/projects/navConfirmed=true.
  function simulateShell() {
    let activeId = null;
    let navConfirmed = false;
    return {
      onIframeLoad() { navConfirmed = false; },              // fires on EVERY load, reload included
      onNavState(id) { activeId = id; navConfirmed = true; }, // fires only when the iframe announces
      gridMismatched(siteId, pickShowing = false) {
        return isGridMismatched(RICHFIELD, siteId, activeId, pickShowing, navConfirmed);
      },
    };
  }

  it("initial boot: hidden until the first nav-state confirms, then reflects reality", () => {
    const shell = simulateShell();
    shell.onIframeLoad(); // the very first <iframe> load
    expect(shell.gridMismatched("rf")).toBe(true); // nothing confirmed yet → fail closed
    shell.onNavState(15); // embed's first boot: correctly on Richfield's own schedule
    expect(shell.gridMismatched("rf")).toBe(false);
  });

  it("THE PRODUCTION CASE: a silent reload with a still-stale-but-matching belief must not render as matched", () => {
    const shell = simulateShell();
    shell.onIframeLoad();
    shell.onNavState(15); // confirmed match, exactly as before the background reload
    expect(shell.gridMismatched("rf")).toBe(false);

    // The tab backgrounds; the embedded app silently self-reloads (B850). The iframe element's own
    // `load` fires again — this is the ONE thing the shell can observe here, since the reload was
    // never asked for and no nav-state has arrived yet. The shell's `activeId` belief is untouched.
    shell.onIframeLoad();
    // OLD gate (no navConfirmed): would read isGridMismatched(RICHFIELD, "rf", 15, false) → false —
    // "still matched" — while the iframe underneath may already be showing a different project. This
    // is the exact live defect: matched-by-stale-belief instead of matched-by-proof.
    expect(shell.gridMismatched("rf")).toBe(true); // fixed gate: fails closed until re-proven
  });

  it("the reload's own nav-state resolves it — matching case", () => {
    const shell = simulateShell();
    shell.onIframeLoad();
    shell.onNavState(15);
    shell.onIframeLoad(); // reload
    expect(shell.gridMismatched("rf")).toBe(true); // unconfirmed
    shell.onNavState(15); // this load's own announcement: still Richfield
    expect(shell.gridMismatched("rf")).toBe(false);
  });

  it("the reload's own nav-state resolves it — genuinely drifted case (aPid moved to a different project)", () => {
    const shell = simulateShell();
    shell.onIframeLoad();
    shell.onNavState(15);
    shell.onIframeLoad(); // reload
    shell.onNavState(16); // this load's own announcement: the shared aPid had actually drifted
    expect(shell.gridMismatched("rf")).toBe(true); // stays hidden — the carry-in effect re-drives it
  });

  it("repeated reloads with no announcement in between never accidentally read as matched", () => {
    const shell = simulateShell();
    shell.onIframeLoad();
    shell.onNavState(15);
    for (let i = 0; i < 4; i++) shell.onIframeLoad(); // several reloads, none yet answered
    expect(shell.gridMismatched("rf")).toBe(true);
  });
});

describe("Scheduler.jsx — the shell invalidates its nav belief on EVERY iframe load, not only the first (B851 ×4/NEW-1)", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");

  it("navConfirmed state + ref exist, both starting false", () => {
    expect(SRC).toMatch(/const navConfirmedRef = useRef\(false\)/);
    expect(SRC).toMatch(/const \[navConfirmed, setNavConfirmed\] = useState\(false\)/);
  });

  it("onIframeLoad resets navConfirmed to false BEFORE its retry loop runs, every time it fires — not gated behind readyRef", () => {
    const i = SRC.indexOf("const onIframeLoad = useCallback(() => {");
    expect(i).toBeGreaterThan(-1);
    const askIdx = SRC.indexOf("const ask = () => {", i);
    const block = SRC.slice(i, askIdx);
    expect(block).toMatch(/setNavConfirmedBoth\(false\)/);
  });

  it("the retry loop's early-return no longer permanently gates on readyRef — a reload gets its own fresh retries", () => {
    const i = SRC.indexOf("const ask = () => {");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 600);
    expect(block).not.toMatch(/if \(readyRef\.current\) return;/);
    expect(block).toMatch(/if \(navConfirmedRef\.current\) return;/);
  });

  it("the nav-state message handler confirms THIS load before markReady", () => {
    const i = SRC.indexOf("setSection(nav.section);");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 400);
    expect(block.indexOf("setNavConfirmedBoth(true)")).toBeGreaterThan(-1);
    expect(block.indexOf("setNavConfirmedBoth(true)")).toBeLessThan(block.indexOf("markReady()"));
  });

  it("the render gate is fed navConfirmed, not just projects/activeId/pickShowing", () => {
    expect(SRC).toMatch(/isGridMismatched\(projects, projectId, activeId, pickShowing, navConfirmed, section\)/);
  });
});

/* B1644368 (NEW-1 amendment) — the neutralize-to-reports post must RETRY, not fire once. A single
 * post at mount races the iframe's own document load (its message listener isn't attached yet —
 * the exact race `onIframeLoad`'s own `ask()` loop already guards against for `nav-request`), and
 * unlike the carry-in effect this one has no natural re-drive: `setSection(nav.section)` is a no-op
 * once the embed's first real report already reads "projects", so a lost first post was never
 * retried and the stale, fully-clickable grid stayed on screen indefinitely. */
describe("Scheduler.jsx — the neutralize-to-reports post retries (B1644368)", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url)), "utf8");

  it("the neutralize effect posts more than once, on an interval, not a single fire-and-forget call", () => {
    const i = SRC.indexOf("if (!shouldNeutralizeToReports({");
    expect(i).toBeGreaterThan(-1);
    const effectEnd = SRC.indexOf("}, [isActive, section, projectId]);", i);
    expect(effectEnd).toBeGreaterThan(-1);
    const block = SRC.slice(i, effectEnd);
    expect(block).toMatch(/setInterval\(/);
    // and it cleans the interval up rather than leaking one per re-render
    expect(block).toMatch(/return \(\) => clearInterval\(t\);/);
  });
});

// SUPERSEDED (B1435888) — the `scheduleCrumbLabel` / `labelMultiScheduleRows` tests that used to
// sit here are gone along with the functions themselves (see navState.js's own SUPERSEDED note).
// B1404352's combined-crumb fix ("Goose Creek / TAS Land Sale" in one label) is replaced outright
// by two independent breadcrumb crumbs — see test/schedulerNavState.test.js's own updated Scheduler.jsx
// source guards above, and e2e/schedule-ownership.spec.js's "B1435888" describe block for the
// browser-driven proof.
