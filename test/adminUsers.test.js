import { describe, it, expect, vi } from "vitest";
import {
  fetchUsersOverview, fetchUserActivity, shapeUsers, userStatus, isInternalEmail, filterUsers, statusCounts, sortUsers, overviewStats, newestSignups, teamLabel, shapeUserActivity,
} from "../src/workspaces/admin/lib/adminUsers.js";

const NOW = new Date("2026-10-05T12:00:00Z").getTime();
const ago = (d) => new Date(NOW - d * 86_400_000 - 1000).toISOString();
const raw = (o) => ({ id: "u" + Math.random(), email: "a@b.com", created_at: ago(40), last_sign_in_at: ago(1), email_confirmed_at: ago(40), projects: 1, plans: 2, files: 0, reviews: 0, schedules: 0, last_activity: ago(1), ...o });

describe("RPC wrappers", () => {
  it("call the gated RPCs with the right args", async () => {
    const c = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    await fetchUsersOverview(c); expect(c.rpc).toHaveBeenCalledWith("admin_users_overview", undefined);
    await fetchUserActivity(c, "u1"); expect(c.rpc).toHaveBeenCalledWith("admin_user_activity", { p_user: "u1" });
  });
  it("a failure is a visible error, never an empty list", async () => {
    const c = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "not authorized" } }) };
    expect(await fetchUsersOverview(c)).toEqual({ data: null, error: "not authorized" });
  });
});

describe("status chip rules", () => {
  const s = (o) => userStatus({ projects: 1, plans: 1, files: 0, reviews: 0, schedules: 0, ...o }, NOW);
  it("Active = activity within 7 days (the 7th day still counts)", () => {
    expect(s({ lastActivity: ago(0) })).toBe("active");
    expect(s({ lastActivity: ago(7) })).toBe("active");
  });
  it("Quiet = 8–30 days", () => { expect(s({ lastActivity: ago(8) })).toBe("quiet"); expect(s({ lastActivity: ago(30) })).toBe("quiet"); });
  it("Dormant = over 30 days", () => { expect(s({ lastActivity: ago(31) })).toBe("dormant"); expect(s({ lastActivity: ago(400) })).toBe("dormant"); });
  it("Never used = signed up, created nothing — even with a recent sign-in", () => {
    expect(userStatus({ projects: 0, plans: 0, files: 0, reviews: 0, schedules: 0, lastActivity: null, lastSignIn: ago(0) }, NOW)).toBe("never");
  });
  it("owns things but no activity date → falls back to last sign-in rather than 'never'", () => {
    expect(s({ lastActivity: null, lastSignIn: ago(2) })).toBe("active");
  });
});

describe("internal accounts", () => {
  it("flags the test domain, Planyr's own, e2e/test local parts, the admin's own and hand-marked ones", () => {
    expect(isInternalEmail("e2e@planyr.test")).toBe(true);
    expect(isInternalEmail("x@planyr.io")).toBe(true);
    expect(isInternalEmail("e2e.fixture@gmail.com")).toBe(true);
    expect(isInternalEmail("Boss@Corp.com", { selfEmail: "boss@corp.com" })).toBe(true);
    expect(isInternalEmail("pal@corp.com", { marked: new Set(["pal@corp.com"]) })).toBe(true);
    expect(isInternalEmail("tester@customer.com")).toBe(false);
    expect(isInternalEmail("latest@customer.com")).toBe(false); // not a bare 'test' prefix
    expect(isInternalEmail("")).toBe(false);
  });
});

describe("filter / count / sort / overview", () => {
  const users = shapeUsers([
    raw({ id: "1", email: "real1@acme.com", name: "Ann Real", last_activity: ago(2) }),
    raw({ id: "2", email: "real2@acme.com", last_activity: ago(20), last_sign_in_at: ago(20) }),
    raw({ id: "3", email: "e2e@planyr.test", last_activity: ago(0) }),
    raw({ id: "4", email: "new@acme.com", created_at: ago(1), projects: 0, plans: 0, last_activity: null, last_sign_in_at: ago(1) }),
  ], { now: NOW });
  it("hide-internal is on by default and counts follow it", () => {
    const shown = filterUsers(users);
    expect(shown.map((u) => u.id).sort()).toEqual(["1", "2", "4"]);
    expect(statusCounts(shown)).toEqual({ active: 1, quiet: 1, dormant: 0, never: 1 });
    expect(filterUsers(users, { hideInternal: false })).toHaveLength(4);
  });
  it("status chip filter and search over name/email", () => {
    expect(filterUsers(users, { status: "quiet" }).map((u) => u.id)).toEqual(["2"]);
    expect(filterUsers(users, { query: "ann" }).map((u) => u.id)).toEqual(["1"]);
    expect(filterUsers(users, { query: "ACME", status: "never" }).map((u) => u.id)).toEqual(["4"]);
  });
  it("default sort: last activity newest first; never-used at the bottom", () => {
    expect(sortUsers(filterUsers(users)).map((u) => u.id)).toEqual(["1", "2", "4"]);
    expect(sortUsers(filterUsers(users), "name", "asc").map((u) => u.id)).toEqual(["1", "4", "2"]); // by name, else email: ann real · new@ · real2@
  });
  it("overview headline counts follow the toggle", () => {
    expect(overviewStats(filterUsers(users), NOW)).toEqual({ accounts: 3, active7: 2, active30: 3, newSignups7: 1 });
    expect(overviewStats(filterUsers(users, { hideInternal: false }), NOW).accounts).toBe(4);
    expect(newestSignups(filterUsers(users), 1)[0].id).toBe("4");
  });
  it("team label and activity shaping", () => {
    expect(teamLabel({ org: "Acme", team: "Ops", teamRole: "admin" })).toBe("Acme · Ops (admin)");
    expect(shapeUserActivity({ plans: ["2026-10-01T00:00:00Z"] }).map((g) => [g.key, g.dates.length])).toEqual([["plans", 1], ["reviews", 0], ["schedules", 0], ["files", 0]]);
  });
});
