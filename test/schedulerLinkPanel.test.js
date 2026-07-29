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
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute,
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
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: true, section: "projects", projectId: null, dashboardIntent: true })).toBe(false);
  });

  it("still adopts normally once the intent is cleared by the next nav-state", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: true, section: "projects", projectId: null, dashboardIntent: false })).toBe(true);
  });

  it("stays inert once the iframe is actually on reports, intent or not", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: true, section: "reports", projectId: null, dashboardIntent: false })).toBe(false);
  });

  it("keeps the keep-alive gate: a HIDDEN scheduler never writes the route", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: false, section: "projects", projectId: null, dashboardIntent: false })).toBe(false);
  });

  it("keeps the loop-free gate: a route that already carries a project is never re-written", () => {
    expect(shouldAdoptLinkedSiteIntoRoute({ isActive: true, section: "projects", projectId: "gid", dashboardIntent: false })).toBe(false);
  });
});
