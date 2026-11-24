/* The Dashboard is owner-only (2026-11-24): one gate (the admin is_admin() answer), everyone else
 * lands on the Map and the Dashboard never mounts (so none of its data is fetched). */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  dashboardGate, dashboardTarget, dashboardWord, dashboardCopy,
  setDashboardOwner, getDashboardOwner, MAP_HASH, DASHBOARD_HASH,
} from "../src/shared/ui/dashboardAccess.js";

const U = { id: "u1" };

describe("dashboardGate", () => {
  it("off whenever the hash is not the Dashboard", () => {
    expect(dashboardGate({ isDashboardHash: false, authKnown: true, user: U, adminStatus: "admin" })).toBe("off");
  });
  it("owner (confirmed admin) sees it", () => {
    expect(dashboardGate({ isDashboardHash: true, authKnown: true, user: U, adminStatus: "admin" })).toBe("show");
  });
  it("waits (mounts nothing) until identity and the admin answer are in", () => {
    expect(dashboardGate({ isDashboardHash: true, authKnown: false, user: null, adminStatus: "unknown" })).toBe("wait");
    expect(dashboardGate({ isDashboardHash: true, authKnown: true, user: U, adminStatus: "unknown" })).toBe("wait");
  });
  it("a confirmed non-owner is redirected, never shown", () => {
    expect(dashboardGate({ isDashboardHash: true, authKnown: true, user: U, adminStatus: "not-admin" })).toBe("redirect");
  });
  it("fails closed: an errored admin check redirects", () => {
    expect(dashboardGate({ isDashboardHash: true, authKnown: true, user: U, adminStatus: "error" })).toBe("redirect");
  });
  it("signed-out visitors are redirected", () => {
    expect(dashboardGate({ isDashboardHash: true, authKnown: true, user: null, adminStatus: "unknown" })).toBe("redirect");
  });
});

describe("targets and copy", () => {
  it("owner goes to the Dashboard, everyone else to the Map", () => {
    expect(dashboardTarget(true)).toBe(DASHBOARD_HASH);
    expect(dashboardTarget(false)).toBe(MAP_HASH);
    expect(MAP_HASH).toBe("#/site");
  });
  it("the crumb / button word is Map for non-owners, Dashboard for the owner", () => {
    expect(dashboardWord(true)).toBe("Dashboard");
    expect(dashboardWord(false)).toBe("Map");
    expect(dashboardCopy("Dashboard: all projects", false)).toBe("Map: all projects");
    expect(dashboardCopy("Leave Schedule — go to the Dashboard", false)).toBe("Leave Schedule — go to the Map");
    expect(dashboardCopy("Dashboard: all projects", true)).toBe("Dashboard: all projects");
    expect(dashboardCopy(undefined, false)).toBeUndefined();
  });
});

describe("store fails closed", () => {
  beforeEach(() => setDashboardOwner(false));
  it("defaults to non-owner and flips only on an explicit owner answer", () => {
    expect(getDashboardOwner()).toBe(false);
    setDashboardOwner(true);
    expect(getDashboardOwner()).toBe(true);
  });
});

describe("Shell wiring (source guard)", () => {
  const shell = readFileSync(new URL("../src/app/Shell.jsx", import.meta.url), "utf8");
  it("mounts the Dashboard only when the gate says show, and uses the one admin check", () => {
    expect(shell).toContain('dashGate === "show" && (');
    expect(shell).not.toMatch(/\{isDashboardHash && \(/);
    expect(shell).toContain("useIsAdmin(user)");
  });
  it("goDashboard sends a non-owner to the Map", () => {
    expect(shell).toContain("dashboardTarget(isOwner)");
  });
  it("does not hardcode an account", () => {
    expect(shell).not.toMatch(/@live\.com|mikeabmab/i);
  });
});
