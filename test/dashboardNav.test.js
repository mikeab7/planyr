/* B1128272 — the header's wordmark and its breadcrumb Dashboard crumb used to be fed
 * the SAME handler on every module, including Schedule, which has its own in-module
 * dashboard. dashboardNav.js splits the wordmark's action/tooltip from the crumb's so
 * a caller (Schedule) can make them genuinely different; every other caller omits the
 * overrides and must get byte-identical behavior to before this module existed.
 */
import { describe, it, expect } from "vitest";
import { logoDashboardAction, crumbDashboardTitle } from "../src/shared/ui/dashboardNav.js";

describe("logoDashboardAction", () => {
  it("falls back to onDashboard when no onLogoDashboard is supplied (every module but Schedule)", () => {
    const onDashboard = () => {};
    const { onClick, title } = logoDashboardAction({ onDashboard });
    expect(onClick).toBe(onDashboard);
    expect(title).toBe("Dashboard: all projects");
  });

  it("prefers onLogoDashboard over onDashboard when both are supplied — genuinely different actions", () => {
    const onDashboard = () => {};
    const onLogoDashboard = () => {};
    const { onClick, title } = logoDashboardAction({
      onDashboard, onLogoDashboard, logoDashboardTitle: "Leave Schedule — go to the Site Planner map",
    });
    expect(onClick).toBe(onLogoDashboard);
    expect(onClick).not.toBe(onDashboard);
    expect(title).toBe("Leave Schedule — go to the Site Planner map");
  });

  it("uses the default title when onLogoDashboard is supplied with no title override", () => {
    const { title } = logoDashboardAction({ onLogoDashboard: () => {} });
    expect(title).toBe("Dashboard: all projects");
  });

  it("no handler wired at all → no click action and no tooltip (matches the pre-existing bare-logo state)", () => {
    const { onClick, title } = logoDashboardAction({});
    expect(onClick).toBeUndefined();
    expect(title).toBeUndefined();
  });
});

describe("crumbDashboardTitle", () => {
  it("defaults to 'All projects: <homeLabel>' — unchanged for every module without an override", () => {
    expect(crumbDashboardTitle({ homeLabel: "Dashboard" })).toBe("All projects: Dashboard");
    expect(crumbDashboardTitle({ homeLabel: "Map" })).toBe("All projects: Map");
  });

  it("uses the override when the crumb's action genuinely differs from 'all projects' (Schedule)", () => {
    expect(crumbDashboardTitle({
      homeLabel: "Dashboard", dashboardTitle: "Schedule dashboard — reports for every project",
    })).toBe("Schedule dashboard — reports for every project");
  });
});
