/* NEW-2 — the invite-link landing decision table (src/shared/teams/inviteLandingModel.js) and its wiring.
 * Rows: signed out (account / no account) · signed in as the invited address (any case) · signed in as ANOTHER
 * address (must never offer Accept) · used / declined / unknown / unreachable. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inviteIdFromSearch, stripInviteParam, inviteLandingPlan, sameAddress, isInviteId } from "../src/shared/teams/inviteLandingModel.js";

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

describe("decision table", () => {
  it("signed out + account exists → sign-in tab, address filled in", () => {
    expect(inviteLandingPlan({ preview: OPEN, user: null })).toEqual({ kind: "auth", email: "Paul@Example.com", mode: "signin" });
  });
  it("signed out + no account → sign-up tab, address filled in", () => {
    expect(inviteLandingPlan({ preview: { ...OPEN, has_account: false }, user: null })).toMatchObject({ kind: "auth", mode: "signup", email: "Paul@Example.com" });
  });
  it("signed in as the invited address (case-insensitive) → Accept / Decline prompt for THAT invite", () => {
    const p = inviteLandingPlan({ preview: OPEN, user: { id: "u1", email: "paul@example.com" } });
    expect(p).toMatchObject({ kind: "answer", teamName: "HIP Houston", invitedBy: "Michael Butler", invite: { id: ID, teamName: "HIP Houston" } });
  });
  it("signed in as a DIFFERENT address → plain wrong-account message, never an Accept", () => {
    const p = inviteLandingPlan({ preview: OPEN, user: { id: "u2", email: "someone@else.com" } });
    expect(p.kind).toBe("wrong-account");
    expect(p.text).toBe("This invite was sent to Paul@Example.com. Sign out and sign in with that address to accept.");
    expect(p.invite).toBeUndefined();
  });
  it("a used / declined / unknown invite says so and reveals no address", () => {
    for (const preview of [{ ok: true, status: "claimed", team_name: "HIP Houston" }, { ok: true, status: "declined", team_name: "HIP Houston" }, { ok: false, reason: "not_found" }, null]) {
      for (const user of [null, { id: "u", email: "x@y.com" }]) {
        const p = inviteLandingPlan({ preview, user });
        expect(p.kind).toBe("notice");
        expect(JSON.stringify(p)).not.toMatch(/@/);
      }
    }
  });
  it("an unreachable preview is said, not mistaken for a gone invite (LOUD-FAILURE)", () => {
    expect(inviteLandingPlan({ preview: null, user: null, unreachable: true })).toMatchObject({ kind: "notice", tone: "warn" });
  });
  it("sameAddress never matches blanks", () => { expect(sameAddress("", "")).toBe(false); expect(sameAddress(" A@b.com ", "a@B.com")).toBe(true); });
});

describe("wiring", () => {
  it("Shell loads the landing lazily, only when the address carries ?invite=", () => {
    const shell = src("../src/app/Shell.jsx");
    expect(shell).toMatch(/lazy\(\(\) => import\("\.\/InviteLanding\.jsx"\)\)/);
    expect(shell).toMatch(/hasInviteLink && <Suspense/);
    expect(shell).not.toMatch(/^import InviteLanding/m);
  });
  it("the landing answers through the SAME answerInvite the account menu uses and signs out through the one signOut", () => {
    const c = src("../src/app/InviteLanding.jsx");
    expect(c).toMatch(/import \{ answerInvite \} from "\.\/teamInvites\.js"/);
    expect(c).toMatch(/import \{ signOut \} from/);
    expect(c).toMatch(/rpc\("invite_preview"/);
  });
  it("the email never puts the address in the URL", () => {
    expect(src("../functions/api/lib/inviteEmail.js")).not.toMatch(/email=\$\{/);
  });
});
