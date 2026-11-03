/* NEW-2 — the invite-link landing decision table (src/shared/teams/inviteLandingModel.js) and its wiring.
 * Rows: signed out (account / no account) · signed in as the invited address (any case) · signed in as ANOTHER
 * address (must never offer Accept) · used / declined / unknown / unreachable. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inviteIdFromSearch, stripInviteParam, inviteLandingPlan, sameAddress, isInviteId, signupCardProblem, signupFailure } from "../src/shared/teams/inviteLandingModel.js";

const ID = "2c2c2b7e-9b88-46f6-97de-a807a4b756b3";
const OPEN = { ok: true, status: "open", invite_id: ID, email: "Paul@Example.com", role: "member", team_name: "HIP Houston", invited_by_name: "Michael Butler", has_account: true };
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the link", () => {
  it("reads only a real uuid out of the address bar", () => {
    expect(inviteIdFromSearch(`?app&invite=${ID}`)).toBe(ID);
    expect(inviteIdFromSearch("?app&invite=a@b.com")).toBeNull();
    expect(inviteIdFromSearch("?app&invite=")).toBeNull();
    expect(inviteIdFromSearch("?app")).toBeNull();
    expect(isInviteId("not-an-id")).toBe(false);
  });
  it("strips the param once and leaves a bare ?app alone", () => {
    expect(stripInviteParam(`?app&invite=${ID}`)).toBe("?app");
    expect(stripInviteParam(`?invite=${ID}&app`)).toBe("?app");
    expect(stripInviteParam(`?invite=${ID}`)).toBe("");
    expect(stripInviteParam("?app")).toBe("?app");
  });
});

describe("decision table — every state has a next step", () => {
  const owner = { id: "u1", email: "paul@example.com" };
  it("signed out + account exists → sign-in screen, address filled in", () => {
    expect(inviteLandingPlan({ preview: OPEN, user: null })).toEqual({ kind: "auth", email: "Paul@Example.com", mode: "signin" });
  });
  it("signed out + no account → the create-account card (no Turnstile), address filled in, who invited, which team", () => {
    expect(inviteLandingPlan({ preview: { ...OPEN, has_account: false }, user: null })).toMatchObject({ kind: "signup", email: "Paul@Example.com", teamName: "HIP Houston", invitedBy: "Michael Butler", invite: { id: ID } });
  });
  it("signed in as the invited address (any case) → Accept / Decline for THAT invite", () => {
    expect(inviteLandingPlan({ preview: OPEN, user: owner })).toMatchObject({ kind: "answer", teamName: "HIP Houston", invitedBy: "Michael Butler", invite: { id: ID, teamName: "HIP Houston" } });
  });
  it("signed in as a DIFFERENT address → says which address the invite is for, names the current account, offers a switch — never an Accept", () => {
    const p = inviteLandingPlan({ preview: OPEN, user: { id: "u2", email: "someone@else.com" } });
    expect(p.kind).toBe("wrong-account");
    expect(p.email).toBe("Paul@Example.com");
    expect(p.text).toBe("This invitation to HIP Houston is for Paul@Example.com. You're signed in as someone@else.com.");
    expect(p.invite).toBeUndefined();
  });
  it("JUST JOINED in this tab → \"You're on X.\" — never \"already been used\" (item 7), whatever the preview now says", () => {
    for (const preview of [{ ok: true, status: "claimed", team_name: "HIP Houston" }, OPEN, null]) {
      for (const user of [null, owner]) {
        const p = inviteLandingPlan({ preview, user, joined: { teamName: "HIP Houston" } });
        expect(p).toMatchObject({ kind: "joined", text: "You're on HIP Houston." });
      }
    }
  });
  it("already used → the plain line PLUS what to do: sign in (signed out) or go to the projects (signed in)", () => {
    const out = inviteLandingPlan({ preview: { ok: true, status: "claimed", team_name: "HIP Houston" }, user: null });
    expect(out).toMatchObject({ kind: "notice", action: "signin" });
    expect(out.text).toMatch(/^This invitation to HIP Houston has already been used\./);
    expect(out.text).toMatch(/ask a team admin to invite you again/);
    expect(inviteLandingPlan({ preview: { ok: true, status: "claimed", team_name: "HIP Houston" }, user: owner })).toMatchObject({ kind: "notice", action: "work" });
  });
  it("declined / unknown / replaced (re-invited) / team deleted → a next step, and no address is revealed", () => {
    for (const preview of [{ ok: true, status: "declined", team_name: "HIP Houston" }, { ok: false, reason: "not_found" }, null, { ok: true, status: "weird" }]) {
      for (const user of [null, owner]) {
        const p = inviteLandingPlan({ preview, user });
        expect(p.kind).toBe("notice");
        expect(["signin", "work"]).toContain(p.action);
        expect(p.text).toMatch(/ask a team admin to invite you again|check your email for the latest/i);
        expect(JSON.stringify(p)).not.toMatch(/@/);
      }
    }
  });
  it("an unreachable preview is said, with Try again — not mistaken for a gone invite (LOUD-FAILURE)", () => {
    expect(inviteLandingPlan({ preview: null, user: null, unreachable: true })).toMatchObject({ kind: "notice", tone: "warn", action: "retry" });
  });
  it("sameAddress never matches blanks", () => { expect(sameAddress("", "")).toBe(false); expect(sameAddress(" A@b.com ", "a@B.com")).toBe(true); });
});

describe("the create-account card (item 8)", () => {
  it("validates before anything is sent", () => {
    expect(signupCardProblem({ firstName: "", lastName: "X", password: "abcdef" })).toMatch(/First and last name/);
    expect(signupCardProblem({ firstName: "A", lastName: "B", password: "abc" })).toMatch(/at least 6/);
    expect(signupCardProblem({ firstName: "A", lastName: "B", password: "abcdef" })).toBe("");
  });
  it("every server answer has plain words and a next step", () => {
    expect(signupFailure(409, { reason: "has_account" })).toMatchObject({ next: "signin" });
    expect(signupFailure(502, { reason: "account_created", error: "Your account was created…" })).toMatchObject({ next: "signin" });
    expect(signupFailure(429, { reason: "too_many", error: "Too many tries" })).toMatchObject({ next: "form" });
    expect(signupFailure(404, { reason: "not_available" }).text).toMatch(/ask a team admin to invite you again/i);
    expect(signupFailure(0, null).text).toMatch(/Couldn't reach Planyr/);
    expect(signupFailure(500, null).text).toMatch(/try again/i);
  });
});

describe("wiring", () => {
  it("Shell loads the landing lazily, only when the address carries ?invite=", () => {
    const shell = src("../src/app/Shell.jsx");
    expect(shell).toMatch(/lazy\(\(\) => import\("\.\/InviteLanding\.jsx"\)\)/);
    expect(shell).toMatch(/hasInviteLink && <Suspense/);
    expect(shell).not.toMatch(/^import InviteLanding/m);
  });
  it("the landing joins through redeemInvite (the link is the proof), never respond_to_invite, and signs out through the one signOut", () => {
    const c = src("../src/app/InviteLanding.jsx");
    expect(c).toMatch(/import \{ redeemInvite \} from "\.\/teamInvites\.js"/);
    expect(c).not.toMatch(/answerInvite/);
    expect(c).toMatch(/import \{ signOut \} from/);
    expect(c).toMatch(/rpc\("invite_preview"/);
    expect(c).toMatch(/\/api\/auth\/invite-signup/);
    expect(src("../src/app/teamInvites.js")).toMatch(/rpc\("redeem_invite_link"/);
  });
  it("a notice that names no team is the only thing an unproven account sees (WaitingInviteNotice, once per session)", () => {
    const n = src("../src/app/WaitingInviteNotice.jsx");
    expect(n).not.toMatch(/teamName|team_name/);
    expect(n).toMatch(/sessionStorage/);
    expect(src("../src/app/Shell.jsx")).toMatch(/lazy\(\(\) => import\("\.\/WaitingInviteNotice\.jsx"\)\)/);
  });
  it("the email never puts the address in the URL", () => {
    expect(src("../functions/api/lib/inviteEmail.js")).not.toMatch(/email=\$\{/);
  });
});
