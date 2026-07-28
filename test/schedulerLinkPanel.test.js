/* B1050 — the link-schedule resolution panel must never trap the user.
 *
 * The reported dead end (owner, Tsakiris, #/project/<gid>/schedule): the route pointed at a site
 * with no linked schedule, the "No schedule for X yet" panel came up over the Schedule tab, and
 * pressing Dashboard in the breadcrumb ONLY messaged the embedded iframe. The iframe obeyed (the
 * crumb flipped to "Dashboard / Select a project") but the OUTER route kept its projectId — and
 * the panel's gate is derived purely from the outer route, so it stayed up over the dashboard,
 * with no X, no Escape and no click-outside to close it.
 *
 * These lock the decision layer of the fix (Scheduler.jsx keeps no logic of its own here):
 *   (a) the Dashboard action clears the outer route, so the panel unmounts;
 *   (b) the panel never renders while the embedded app is on its dashboard/reports section, so any
 *       FUTURE route↔iframe desync degrades to a missing panel instead of a trapped user;
 *   (c) dismissing (X / Escape) hides it — and links/creates nothing;
 *   + the ping-pong guard: clearing the route on Dashboard must not be instantly undone by the
 *     carry-OUT effect that adopts the active schedule's linked site into an empty route.
 */
import { describe, it, expect } from "vitest";
import {
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute,
} from "../src/workspaces/scheduler/lib/navState.js";

// The owner's exact starting state: routed at an unlinked site, iframe ready, panel up.
const TRAPPED = {
  ready: true, section: "projects", projectId: "smrjdgmlinea",
  linkedSchedule: null, routedSiteName: "Tsakiris", dismissed: false,
};

describe("Dashboard dismisses the link panel (the trap)", () => {
  it("the panel is up on a project route with no linked schedule", () => {
    expect(shouldShowLinkPanel(TRAPPED)).toBe(true);
  });

  it("pressing Dashboard posts to the iframe AND clears the outer route", () => {
    const act = dashboardNavActions({ projectId: TRAPPED.projectId });
    expect(act.post).toEqual({ type: "planar:nav-dashboard" });
    expect(act.clearRoute).toBe(true); // the half that was missing — this is the whole bug
  });

  it("after the Dashboard action the outer route is cleared and the panel is GONE", () => {
    const act = dashboardNavActions({ projectId: TRAPPED.projectId });
    const routed = act.clearRoute ? null : TRAPPED.projectId;
    expect(routed).toBeNull();
    expect(shouldShowLinkPanel({ ...TRAPPED, projectId: routed })).toBe(false);
  });

  it("clearing the route is a no-op when the route carries no project (Dashboard from the dashboard)", () => {
    expect(dashboardNavActions({ projectId: null }).clearRoute).toBe(false);
    expect(dashboardNavActions({}).clearRoute).toBe(false);
  });
});

describe("the panel is project-scoped — belt-and-braces against a route↔iframe desync", () => {
  it("never renders while the embedded app is on its dashboard/reports section", () => {
    // The desync the owner hit: the iframe moved to reports, the route did NOT. Even with the
    // stale projectId still set, the panel must stay down.
    expect(shouldShowLinkPanel({ ...TRAPPED, section: "reports" })).toBe(false);
  });

  it("renders only on the projects section", () => {
    expect(shouldShowLinkPanel({ ...TRAPPED, section: "projects" })).toBe(true);
    for (const section of ["reports", "settings", "", null]) {
      expect(shouldShowLinkPanel({ ...TRAPPED, section })).toBe(false);
    }
  });

  it("keeps every pre-existing gate: not before ready, not without a resolved site name, not when linked", () => {
    expect(shouldShowLinkPanel({ ...TRAPPED, ready: false })).toBe(false);
    expect(shouldShowLinkPanel({ ...TRAPPED, routedSiteName: null })).toBe(false); // B560 — never surface the raw id
    expect(shouldShowLinkPanel({ ...TRAPPED, linkedSchedule: { id: 4, name: "Tsakiris" } })).toBe(false);
    expect(shouldShowLinkPanel({ ...TRAPPED, projectId: null })).toBe(false);
    expect(shouldShowLinkPanel()).toBe(false); // defensive: no args → nothing to resolve
  });

  it("a user dismissal (X / Escape) hides it", () => {
    expect(shouldShowLinkPanel({ ...TRAPPED, dismissed: true })).toBe(false);
  });
});

describe("no ping-pong between the Dashboard clear and the carry-OUT adoption", () => {
  it("suppresses the carry-out adoption in the window before the iframe confirms reports", () => {
    // Route just cleared; the iframe hasn't reported section "reports" yet. Without the guard the
    // carry-out would re-adopt the active schedule's linked site → the panel reappears.
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
