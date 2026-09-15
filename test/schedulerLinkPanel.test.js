/* The Schedule tab's "no schedule for this project" surface must never strand a project.
 *
 * B1050 fixed the original trap (the panel sat over the dashboard with no way out) by making
 * Dashboard clear the outer route, and belt-and-braced it with TWO suppressors — a user dismissal
 * and an "only while the iframe is on its projects section" gate. Both turned out to be strands of
 * their own, each reproduced headless against the shipped build
 * (ui-audit/diagnose-schedule-strand.mjs):
 *
 *   NEW-1 (the owner's report — Tsakiris showed no create/link surface AT ALL, Sylvestri was fine):
 *     the dismissal was per-project component state in a KEPT-ALIVE workspace, so one press of the
 *     new X removed the ONLY create/link entry point for that project for the rest of the session.
 *     Per-project state predicts exactly that asymmetry, and the repro confirmed it.
 *   The second strand: the section gate suppressed the surface whenever the embed reported its
 *     dashboard section — and a routed site with NO link is never switched off that section, since
 *     the embed's nav-select-by-site handler returns its state UNCHANGED when it can't resolve the
 *     link. Session-wide, so it could not by itself explain the asymmetry, but a strand all the same.
 *
 * NEW-2 removes the need for either: the surface is the Schedule tab's EMPTY STATE, rendered
 * instead of the iframe rather than over it. Nothing is covered ⇒ nothing to dismiss, and the gate
 * is derived purely from the outer route. These lock that decision layer (Scheduler.jsx keeps no
 * logic of its own here).
 */
import { describe, it, expect } from "vitest";
import {
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute, shouldNeutralizeToReports,
} from "../src/workspaces/scheduler/lib/navState.js";

// The owner's starting state: routed at an unlinked site, iframe ready, empty state showing.
const UNLINKED = {
  ready: true, projectId: "smrjdgmlinea",
  linkedSchedule: null, routedSiteName: "Tsakiris",
};

describe("Dashboard is the way out (B1050)", () => {
  it("the empty state is up on a project route with no linked schedule", () => {
    expect(shouldShowLinkPanel(UNLINKED)).toBe(true);
  });

  it("pressing Dashboard posts to the iframe AND clears the outer route", () => {
    const act = dashboardNavActions({ projectId: UNLINKED.projectId });
    expect(act.post).toEqual({ type: "planar:nav-dashboard" });
    expect(act.clearRoute).toBe(true); // the half that was missing — this is the original bug
  });

  it("after the Dashboard action the outer route is cleared and the empty state is GONE", () => {
    const act = dashboardNavActions({ projectId: UNLINKED.projectId });
    const routed = act.clearRoute ? null : UNLINKED.projectId;
    expect(routed).toBeNull();
    expect(shouldShowLinkPanel({ ...UNLINKED, projectId: routed })).toBe(false);
  });

  it("clearing the route is a no-op when the route carries no project (Dashboard from the dashboard)", () => {
    expect(dashboardNavActions({ projectId: null }).clearRoute).toBe(false);
    expect(dashboardNavActions({}).clearRoute).toBe(false);
  });
});

describe("NEW-1 — nothing may suppress the only create/link entry point", () => {
  it("there is no dismissal input: a stale `dismissed` flag cannot hide it", () => {
    // The regression, stated as an invariant. `dismissed` was the whole bug; passing it must now
    // change nothing, so no caller can reintroduce a per-project suppression by accident.
    expect(shouldShowLinkPanel({ ...UNLINKED, dismissed: true })).toBe(true);
  });

  it("the iframe's internal section has no say — a routed unlinked project always shows it", () => {
    // The second strand: the embed sits on "reports" (it booted there, or the user pressed
    // Dashboard inside it) and NEVER leaves, because an unlinked site gives nav-select-by-site
    // nothing to switch to. Under the old gate that hid the surface for every project at once.
    for (const section of ["reports", "projects", "settings", "", null, undefined]) {
      expect(shouldShowLinkPanel({ ...UNLINKED, section })).toBe(true);
    }
  });

  it("routing away and back to the SAME project always brings it back", () => {
    // The owner's exact sequence: leave the Schedule tab, come back to the same project. The gate
    // is a pure function of the route, so it cannot carry a memory of a previous visit.
    const away = shouldShowLinkPanel({ ...UNLINKED, projectId: null });
    const back = shouldShowLinkPanel(UNLINKED);
    expect(away).toBe(false);
    expect(back).toBe(true);
  });

  it("a different project is never affected by what happened on another one", () => {
    expect(shouldShowLinkPanel({ ...UNLINKED, projectId: "g-sylvestri", routedSiteName: "Sylvestri" })).toBe(true);
  });
});

describe("the pre-existing gates all survive", () => {
  it("not before ready, not without a resolved site name, not when already linked, not without a route", () => {
    expect(shouldShowLinkPanel({ ...UNLINKED, ready: false })).toBe(false);
    expect(shouldShowLinkPanel({ ...UNLINKED, routedSiteName: null })).toBe(false); // B560 — never surface the raw id
    expect(shouldShowLinkPanel({ ...UNLINKED, routedSiteName: "" })).toBe(false);
    expect(shouldShowLinkPanel({ ...UNLINKED, linkedSchedule: { id: 4, name: "Tsakiris" } })).toBe(false);
    expect(shouldShowLinkPanel({ ...UNLINKED, projectId: null })).toBe(false);
    expect(shouldShowLinkPanel()).toBe(false); // defensive: no args → nothing to resolve
  });
});

describe("no ping-pong between the Dashboard clear and the carry-OUT adoption", () => {
  it("suppresses the carry-out adoption in the window before the iframe confirms reports", () => {
    // Route just cleared; the iframe hasn't reported section "reports" yet. Without the guard the
    // carry-out would re-adopt the active schedule's linked site → the empty state reappears.
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: true, section: "projects", projectId: null, dashboardIntent: true, bootCarryOutAllowed: true,
    })).toBe(false);
  });

  it("still adopts normally once the intent is cleared by the next nav-state, WHILE the boot privilege stands", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: true, section: "projects", projectId: null, dashboardIntent: false, bootCarryOutAllowed: true,
    })).toBe(true);
  });

  it("stays inert once the iframe is actually on reports, intent or not", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: true, section: "reports", projectId: null, dashboardIntent: false, bootCarryOutAllowed: true,
    })).toBe(false);
  });

  it("keeps the keep-alive gate: a HIDDEN scheduler never writes the route", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: false, section: "projects", projectId: null, dashboardIntent: false, bootCarryOutAllowed: true,
    })).toBe(false);
  });

  it("keeps the loop-free gate: a route that already carries a project is never re-written", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: true, section: "projects", projectId: "gid", dashboardIntent: false, bootCarryOutAllowed: true,
    })).toBe(false);
  });
});

/* NEW-1 (owner report, 2026-09-15 — "sometimes when I'm clicking between modules... it takes me
 * to the wrong place"). REPRODUCED live: a module-tab click from Site's own project-less "Select a
 * project" state landed on a specific project's schedule nobody chose; a hand-typed `#/schedule`
 * (no project id anywhere in the URL) did the same. Root cause: the carry-out effect above adopted
 * whatever the embedded app's own persisted, ACCOUNT-WIDE `aPid` field happened to hold — "what
 * schedule was last open" (possibly from a different tab, device or session), not "what the user
 * just chose" — on EVERY arrival at a project-less route, not only the app's own genuine boot.
 * `bootCarryOutAllowed` closes that: it must be explicitly granted (the same boot-resume privilege
 * SitePlannerApp.jsx's `mayResumeLastSite` already gates on), never assumed true by default.
 */
describe("NEW-1 — the carry-out adoption requires the boot-resume privilege, not just an empty route", () => {
  it("a project-less route with no boot privilege never silently adopts the iframe's ambient project", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({
      isActive: true, section: "projects", projectId: null, dashboardIntent: false, bootCarryOutAllowed: false,
    })).toBe(false);
  });

  it("defaults to false when the caller omits it entirely — never a silent opt-in", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: true, section: "projects", projectId: null })).toBe(false);
  });

  it("the boot privilege is the ONLY thing separating this from the pre-fix always-adopt behaviour", () => {
    const base = { isActive: true, section: "projects", projectId: null, dashboardIntent: false };
    expect(shouldAdoptLinkedSiteIntoRoute({ ...base, bootCarryOutAllowed: true })).toBe(true);
    expect(shouldAdoptLinkedSiteIntoRoute({ ...base, bootCarryOutAllowed: false })).toBe(false);
  });
});

describe("NEW-1 — shouldNeutralizeToReports: the honest counterpart when carry-out is refused", () => {
  it("tells the iframe to show its neutral cross-project view when the route is honestly project-less", () => {
    expect(shouldNeutralizeToReports({
      isActive: true, section: "projects", projectId: null, bootCarryOutAllowed: false, dashboardIntent: false,
    })).toBe(true);
  });

  it("stands down while the boot privilege still stands — let carry-out try adopting first", () => {
    expect(shouldNeutralizeToReports({
      isActive: true, section: "projects", projectId: null, bootCarryOutAllowed: true, dashboardIntent: false,
    })).toBe(false);
  });

  it("stands down once the iframe is already on reports — nothing left to correct", () => {
    expect(shouldNeutralizeToReports({
      isActive: true, section: "reports", projectId: null, bootCarryOutAllowed: false, dashboardIntent: false,
    })).toBe(false);
  });

  it("stands down on a routed project — this is the project-less case only", () => {
    expect(shouldNeutralizeToReports({
      isActive: true, section: "projects", projectId: "gid", bootCarryOutAllowed: false, dashboardIntent: false,
    })).toBe(false);
  });

  it("stands down while hidden (keep-alive gate) and during a pending Dashboard press", () => {
    expect(shouldNeutralizeToReports({
      isActive: false, section: "projects", projectId: null, bootCarryOutAllowed: false, dashboardIntent: false,
    })).toBe(false);
    expect(shouldNeutralizeToReports({
      isActive: true, section: "projects", projectId: null, bootCarryOutAllowed: false, dashboardIntent: true,
    })).toBe(false);
  });

  it("the two functions are never both true at once — mutually exclusive by construction", () => {
    for (const bootCarryOutAllowed of [true, false]) {
      for (const dashboardIntent of [true, false]) {
        const args = { isActive: true, section: "projects", projectId: null, bootCarryOutAllowed, dashboardIntent };
        const adopt = shouldAdoptLinkedSiteIntoRoute(args);
        const neutralize = shouldNeutralizeToReports(args);
        expect(adopt && neutralize).toBe(false);
      }
    }
  });
});
