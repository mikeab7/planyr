import { describe, it, expect, vi } from "vitest";
import {
  callAdminRpc, fetchErrorGroups, fetchErrorGroupRows, shapeErrorGroups, groupRowArgs, fetchSupportReports,
  setReportStatus, fetchRecentErrorsForUser, shapeTickets, ticketFrom, fetchUsage, shapeUsage, fetchOps,
  recordSessionSweep, shapeOps, parseStillOpen, ago,
} from "../src/workspaces/admin/lib/adminPanels.js";

const ok = (data) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

describe("callAdminRpc — failures are always visible", () => {
  it("passes data through", async () => { expect(await callAdminRpc(ok([1]), "x")).toEqual({ data: [1], error: null }); });
  it("an RPC error becomes a readable string, never silent", async () => {
    const c = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "not authorized" } }) };
    expect(await callAdminRpc(c, "x")).toEqual({ data: null, error: "not authorized" });
  });
  it("a thrown call and a missing client are errors too", async () => {
    expect((await callAdminRpc({ rpc: () => { throw new Error("net down"); } }, "x")).error).toBe("net down");
    expect((await callAdminRpc(null, "x")).error).toBe("Not connected.");
  });
});

describe("Issues", () => {
  it("calls the right RPCs with the right args", async () => {
    const c = ok([]);
    await fetchErrorGroups(c, "event", 7);
    expect(c.rpc).toHaveBeenCalledWith("admin_error_groups", { p_kind: "event", p_days: 7 });
    await fetchErrorGroupRows(c, { kind: "error", source: "react", message: "boom" }, 10);
    expect(c.rpc).toHaveBeenCalledWith("admin_error_group_rows", { p_kind: "error", p_source: "react", p_message: "boom", p_limit: 10 });
  });
  it("shapes groups: coerces bigint strings, labels blank messages, newest first", () => {
    const g = shapeErrorGroups([
      { kind: "error", source: "react", message: "old", occurrences: "3", accounts: 1, last_seen: "2026-10-01T00:00:00Z", builds: 1 },
      { kind: "error", source: "window.onerror", message: "  ", occurrences: 2, accounts: "2", last_seen: "2026-10-04T00:00:00Z", last_build: "abc", builds: 2 },
    ]);
    expect(g.map((x) => x.message)).toEqual(["(no message)", "old"]);
    expect(g[1].occurrences).toBe(3);
    expect(g[0].accounts).toBe(2);
    expect(groupRowArgs(g[0])).toEqual({ kind: "error", source: "window.onerror", message: "  " }); // original key, not the label
  });
  it("null / junk input shapes to an empty list", () => { expect(shapeErrorGroups(null)).toEqual([]); });
});

describe("Support", () => {
  it("RPC wrappers", async () => {
    const c = ok(true);
    await fetchSupportReports(c); expect(c.rpc).toHaveBeenCalledWith("admin_list_support_reports", undefined);
    await setReportStatus(c, "id1", "closed"); expect(c.rpc).toHaveBeenCalledWith("admin_set_report_status", { p_id: "id1", p_status: "closed" });
    await fetchRecentErrorsForUser(c, "u1"); expect(c.rpc).toHaveBeenCalledWith("admin_recent_errors_for_user", { p_user: "u1", p_limit: 15 });
  });
  it("open tickets first and oldest-waiting first; closed newest first", () => {
    const { open, closed } = shapeTickets([
      { id: "a", at: "2026-10-03T00:00:00Z", status: "open", category: "problem" },
      { id: "b", at: "2026-10-01T00:00:00Z", status: "open", category: "slow" },
      { id: "c", at: "2026-09-01T00:00:00Z", status: "closed", category: "problem" },
      { id: "d", at: "2026-09-02T00:00:00Z", status: "closed", category: "problem" },
      { id: "e", at: "2026-09-02T00:00:00Z", category: "problem" }, // missing status → open
    ]);
    expect(open.map((t) => t.id)).toEqual(["e", "b", "a"]);
    expect(closed.map((t) => t.id)).toEqual(["d", "c"]);
  });
  it("who filed it", () => {
    expect(ticketFrom({ email: "a@b.c" })).toBe("a@b.c");
    expect(ticketFrom({ userId: "u" })).toBe("signed-in account");
    expect(ticketFrom({})).toBe("signed out");
  });
});

describe("Usage", () => {
  it("shapes the overview: counts only, numbers coerced, peak never zero", () => {
    expect(shapeUsage(null)).toBeNull();
    const u = shapeUsage({
      totals: { accounts: "10", active_7d: 1, plans: 103 },
      weekly: [{ week: "2026-09-28", signups: 0, plans_created: 4, plans_edited: "9" }],
      accounts: [{ id: "u1", email: null, plans: "5", last_sign_in_at: null }],
    });
    expect(u.totals.accounts).toBe(10);
    expect(u.totals.reviews).toBe(0);
    expect(u.weekly[0]).toEqual({ week: "2026-09-28", signups: 0, plansCreated: 4, plansEdited: 9 });
    expect(u.peak).toBe(9);
    expect(shapeUsage({ weekly: [] }).peak).toBe(1);
    expect(u.accounts[0]).toMatchObject({ email: "(no email)", plans: 5, lastSignIn: null });
    // nothing resembling plan/file CONTENT is carried
    expect(Object.keys(u.accounts[0]).sort()).toEqual(["createdAt", "email", "files", "id", "lastPlanEdit", "lastSignIn", "plans", "projects"]);
  });
  it("calls admin_usage_overview", async () => { const c = ok({}); await fetchUsage(c); expect(c.rpc).toHaveBeenCalledWith("admin_usage_overview", undefined); });
});

describe("Ops", () => {
  it("shapes snapshots + sweeps; tolerates an empty database", () => {
    const o = shapeOps({
      snapshots: { backlog: { updated_at: "t", payload: { open: { count: 5, recent: [{ id: "B1", title: "x" }], topTags: [{ tag: "#ui", count: 2 }] }, verify: { count: 1, recent: [] } } } },
      sweeps: [{ id: "s", at: "2026-10-05T00:00:00Z", archived: "4", still_open: [{ title: "T", waiting_on: "owner" }] }],
    });
    expect(o.backlog.open.count).toBe(5);
    expect(o.backlog.open.topTags[0].tag).toBe("#ui");
    expect(o.verification).toBeNull();
    expect(o.sweeps[0]).toMatchObject({ archived: 4, stillOpen: [{ title: "T", waitingOn: "owner" }] });
    expect(shapeOps({}).sweeps).toEqual([]);
    expect(shapeOps(null).backlog).toBeNull();
  });
  it("record + fetch wrappers", async () => {
    const c = ok("id");
    await fetchOps(c); expect(c.rpc).toHaveBeenCalledWith("admin_get_ops", undefined);
    await recordSessionSweep(c, { archived: 3, stillOpen: [{ title: "a", waiting_on: "b" }], note: "" });
    expect(c.rpc).toHaveBeenCalledWith("admin_record_session_sweep", { p_archived: 3, p_still_open: [{ title: "a", waiting_on: "b" }], p_note: null });
  });
  it("parses the still-open textarea", () => {
    expect(parseStillOpen("Notes pass — waiting on owner review\n\n  Food fix  \nA - B")).toEqual([
      { title: "Notes pass", waiting_on: "waiting on owner review" },
      { title: "Food fix", waiting_on: "" },
      { title: "A", waiting_on: "B" },
    ]);
    expect(parseStillOpen("")).toEqual([]);
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("reads naturally", () => {
    expect(ago(null, now)).toBe("never");
    expect(ago("2026-10-05T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-05T11:15:00Z", now)).toBe("45 min ago");
    expect(ago("2026-10-05T07:00:00Z", now)).toBe("5 hr ago");
    expect(ago("2026-10-01T12:00:00Z", now)).toBe("4 days ago");
    expect(ago("garbage", now)).toBe("—");
  });
});
