/* Settings › Team redesign (NEW-1, B2038784): the roster is grouped by role, empty sections vanish,
 * the current user has no ⋯, a role change moves a person between sections, and Resend goes through
 * the one send path without adding an invite row. The DOM half is e2e/team-settings-layout.spec.js. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { groupRoster, canManage, initialsOf, countsLine } from "../src/workspaces/site-planner/lib/teamRoster.js";

const ME = "u-me";
const members = [
  { userId: ME, role: "admin", displayName: "Michael Butler", email: "me@x.com" },
  { userId: "u2", role: "admin", displayName: "Michael Butler", email: "other@x.com" },
  { userId: "u3", role: "member", displayName: "Ana Ruiz", email: "ana@x.com" },
];
const invites = [{ id: "i1", email: "ryan@x.com", role: "member" }];

describe("groupRoster", () => {
  it("renders Admins / Members / Invited from a mixed list, in that order", () => {
    const { sections, memberCount } = groupRoster(members, invites, ME);
    expect(sections.map((s) => s.id)).toEqual(["admins", "members", "invited"]);
    expect(sections[0].rows).toHaveLength(2);
    expect(sections[1].rows.map((r) => r.name)).toEqual(["Ana Ruiz"]);
    expect(memberCount).toBe(3);
  });
  it("hides empty sections (no invites → no Invited; no plain members → no Members)", () => {
    expect(groupRoster(members, [], ME).sections.map((s) => s.id)).toEqual(["admins", "members"]);
    expect(groupRoster([members[0]], [], ME).sections.map((s) => s.id)).toEqual(["admins"]);
  });
  it("keeps the email on every member row (two 'Michael Butler' accounts differ only by email)", () => {
    const admins = groupRoster(members, [], ME).sections[0].rows;
    expect(admins.map((r) => r.email)).toEqual(["me@x.com", "other@x.com"]);
  });
  it("a role change moves the person between sections", () => {
    const after = members.map((m) => (m.userId === "u3" ? { ...m, role: "admin" } : m));
    const g = groupRoster(after, [], ME);
    expect(g.sections.map((s) => s.id)).toEqual(["admins"]);
    expect(g.sections[0].rows.map((r) => r.id)).toContain("u3");
  });
  it("an invite carries its own role into the second line source", () => {
    const g = groupRoster([], [{ id: "i2", email: "a@x.com", role: "admin" }], ME);
    expect(g.sections[0].id).toBe("invited");
    expect(g.sections[0].rows[0]).toMatchObject({ kind: "invite", role: "admin", email: "a@x.com" });
  });
});

describe("canManage (the ⋯ rule)", () => {
  const rows = groupRoster(members, invites, ME).sections.flatMap((s) => s.rows);
  it("the current user's own row has no ⋯, even for an admin", () => {
    const me = rows.find((r) => r.isYou);
    expect(me).toBeTruthy();
    expect(canManage(me, true)).toBe(false);
  });
  it("an admin can manage everyone else and every invite; a non-admin manages nothing", () => {
    rows.filter((r) => !r.isYou).forEach((r) => expect(canManage(r, true)).toBe(true));
    rows.forEach((r) => expect(canManage(r, false)).toBe(false));
  });
});

describe("small helpers", () => {
  it("initials", () => {
    expect(initialsOf("Michael Butler", "")).toBe("MB");
    expect(initialsOf("", "ryan@x.com")).toBe("RY");
  });
  it("counts line pluralises", () => {
    expect(countsLine(3, 22)).toBe("3 members · 22 shared projects");
    expect(countsLine(1, 1)).toBe("1 member · 1 shared project");
  });
});

describe("resendInvite", () => {
  beforeEach(() => vi.resetModules());
  async function load(upsertResult) {
    const upsert = vi.fn().mockResolvedValue(upsertResult);
    const from = vi.fn(() => ({ upsert }));
    vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: { from } }));
    const mod = await import("../src/workspaces/site-planner/lib/teams.js");
    return { mod, upsert, from };
  }
  it("calls the send path exactly once, ignoring duplicates so no second invite row is added", async () => {
    const { mod, upsert, from } = await load({ error: null });
    const r = await mod.resendInvite("t1", " Ryan@X.com ", "member");
    expect(r.ok).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("team_invites");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toEqual({ team_id: "t1", email: "ryan@x.com", role: "member" });
    expect(upsert.mock.calls[0][1]).toMatchObject({ onConflict: "team_id,email", ignoreDuplicates: true });
  });
  it("surfaces a backend failure instead of reporting success (LOUD-FAILURE)", async () => {
    const { mod } = await load({ error: { message: "boom" } });
    expect(await mod.resendInvite("t1", "a@x.com")).toEqual({ ok: false, error: "boom" });
  });
});

describe("TeamPanel source guards", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/components/TeamPanel.jsx", import.meta.url), "utf8");
  it("the removed explainer paragraphs and role pill/buttons are gone", () => {
    expect(src).not.toMatch(/A team is a shared workspace/);
    expect(src).not.toMatch(/Make member|Make admin/);
    expect(src).not.toMatch(/type="checkbox"/);
  });
  it("Resend goes through resendInvite, never a second invite-row insert", () => {
    expect(src).toMatch(/resendInvite\(sel, iv\.email, iv\.role\)/);
  });
});
