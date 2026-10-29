/* NEW-1 (invite inbox) — the pure half: row mapping, the badge label, the words, and the menu wiring. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapInviteRows, inviteLine, badgeLabel, answerNote, roleWord, TEAMS_CHANGED_EVENT } from "../src/shared/teams/teamInviteModel.js";
import { groupRoster } from "../src/workspaces/site-planner/lib/teamRoster.js";

const src = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

describe("mapInviteRows / inviteLine", () => {
  it("maps list_my_invites rows and words the line", () => {
    const [inv] = mapInviteRows([{ invite_id: "i1", team_id: "t1", team_name: "USEC", role: "admin", invited_by_name: "Chris Seward", created_at: "2026-10-28T18:14:16Z" }]);
    expect(inv).toEqual({ id: "i1", teamId: "t1", teamName: "USEC", role: "admin", invitedBy: "Chris Seward", createdAt: "2026-10-28T18:14:16Z" });
    expect(inviteLine(inv)).toBe("Chris Seward invited you as admin");
  });
  it("is defensive about junk and missing names", () => {
    expect(mapInviteRows(null)).toEqual([]);
    expect(mapInviteRows([null, {}, { invite_id: "i2" }])[0]).toMatchObject({ teamName: "A team", invitedBy: "A teammate", role: "member" });
    expect(roleWord("owner")).toBe("member");
  });
});

describe("badgeLabel", () => {
  it("shows nothing at zero, the count, and 9+ past nine", () => {
    expect([0, -1, NaN, 1, 9, 10, 40].map(badgeLabel)).toEqual(["", "", "", "1", "9", "9+", "9+"]);
  });
});

describe("answerNote", () => {
  it("words success for both answers and every refusal in plain language", () => {
    expect(answerNote({ ok: true, status: "accepted" }, true, "USEC")).toEqual({ ok: true, text: "You joined USEC." });
    expect(answerNote({ ok: true, status: "declined" }, false, "USEC")).toEqual({ ok: true, text: "Declined the invitation to USEC." });
    expect(answerNote({ ok: false, reason: "not_found" }, true, "USEC").text).toMatch(/no longer there/);
    expect(answerNote({ ok: false, reason: "declined" }, true, "USEC").text).toMatch(/declined/);
    expect(answerNote({ ok: false, error: "boom" }, true, "USEC")).toEqual({ ok: false, text: "boom" });
    expect(answerNote(null, true, "USEC").ok).toBe(false);
  });
});

describe("inviter's pending list reflects a decline", () => {
  it("an invited row carries declinedAt so the panel can say 'declined'", () => {
    const { sections } = groupRoster([], [{ id: "a", email: "p@x.com", role: "admin", declinedAt: "2026-10-28T19:00:00Z" }, { id: "b", email: "q@x.com", role: "member" }], null);
    const rows = sections.find((s) => s.id === "invited").rows;
    expect(rows.map((r) => r.declinedAt)).toEqual(["2026-10-28T19:00:00Z", null]);
    expect(src("src/workspaces/site-planner/components/TeamPanel.jsx")).toMatch(/r\.declinedAt \? "declined"/);
  });
});

describe("the account menu is wired to the inbox", () => {
  const ac = src("src/app/AccountControl.jsx");
  it("badge on the trigger, invitation cards above Profile, Accept and Decline per card", () => {
    expect(ac).toMatch(/account-invite-badge/);
    expect(ac).toMatch(/useTeamInvites\(user\)/);
    expect(ac.indexOf("account-invites")).toBeLessThan(ac.indexOf('onOpenAccount("profile")'));
    expect(ac).toMatch(/account-invite-accept/);
    expect(ac).toMatch(/account-invite-decline/);
  });
  it("uses design tokens, not raw hex or off-scale radii", () => {
    const block = ac.slice(ac.indexOf("const inviteBadge"), ac.indexOf("const acctDivider"));
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/rgba?\(/);
  });
  it("the store never imports lib/teams.js (it is kept off the shell chunk)", () => {
    const imports = src("src/app/teamInvites.js").split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(imports).not.toMatch(/lib\/teams\.js/);
  });
  it("exports one event name", () => { expect(TEAMS_CHANGED_EVENT).toBe("planyr:teams-changed"); });
});
