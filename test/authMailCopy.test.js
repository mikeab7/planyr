/* The auth-mail copy must NAME the address each email arrives from, and the name must be TRUE.
 *
 * The bug it guards: "check your email" tells a person nothing about what to look for, so someone watching for
 * a planyr.io message never finds the one that arrived, decides it broke, and retries or leaves. Since NEW-1
 * (2026-11-02) sign-in links and password resets come from Planyr (no-reply@planyr.io) through the Google
 * Workspace mailbox; the sign-up confirmation would still come from Supabase's mailer (it is off today). Each
 * message is generated from its own sender constant and these tests fail the build if one stops carrying it. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AUTH_SENDER_EMAIL, AUTH_SENDER_NAME, AUTH_SENDER_LABEL, SUPPORT_EMAIL,
  SIGNUP_CONFIRM_MSG, SIGNUP_CONFIRM_SENDER_LABEL, SIGNUP_CONFIRM_SENDER_EMAIL,
} from "../src/workspaces/site-planner/lib/authMail.js";
import { sentCopy, failureCopy, BLOCKED_CHECK_COPY } from "../src/workspaces/site-planner/lib/emailLinkCopy.js";
import { buildAuthEmail } from "../functions/api/lib/authEmail.js";
import { INVITE_FROM_DEFAULT } from "../functions/api/lib/inviteEmail.js";
import { FROM_DEFAULT } from "../functions/api/auth/email-link.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const panelSrc = read("../src/workspaces/site-planner/components/AuthPanel.jsx");

describe("auth mail copy — the sender is named, and it is the configured one", () => {
  it("Planyr's own sender is no-reply@planyr.io, and that is what the server really sends as", () => {
    expect(AUTH_SENDER_EMAIL).toBe("no-reply@planyr.io");
    expect(AUTH_SENDER_NAME).toBe("Planyr");
    expect(FROM_DEFAULT).toBe(AUTH_SENDER_EMAIL);          // functions/api/auth/email-link.js
    expect(INVITE_FROM_DEFAULT).toBe(AUTH_SENDER_EMAIL);   // the invite email — one From for all Planyr mail
  });
  it("the 'check your inbox' line names Planyr and the address, for both purposes", () => {
    for (const purpose of ["reset", "signin"]) {
      const c = sentCopy("me@x.example", purpose);
      expect(c.inbox).toBe(`Check your inbox at me@x.example. It comes from ${AUTH_SENDER_LABEL}.`);
      expect(c.inbox).toContain("Planyr (no-reply@planyr.io)");
      expect(c.spam).toMatch(/spam/i);
      expect(c.support).toContain(SUPPORT_EMAIL);
      expect(c.valid).toMatch(/1 hour/);
    }
  });
  it("the sign-up confirmation (off today) still names the sender that would really send it — Supabase's", () => {
    expect(SIGNUP_CONFIRM_MSG).toContain(SIGNUP_CONFIRM_SENDER_EMAIL);
    expect(SIGNUP_CONFIRM_MSG).toContain(SIGNUP_CONFIRM_SENDER_LABEL);
    expect(SIGNUP_CONFIRM_MSG).toMatch(/spam/i);
    expect(SIGNUP_CONFIRM_MSG).toMatch(/account created/i);
    expect(SIGNUP_CONFIRM_MSG.length).toBeLessThanOrEqual(150);
  });
  it("holds real addresses — not placeholders", () => {
    for (const a of [AUTH_SENDER_EMAIL, SIGNUP_CONFIRM_SENDER_EMAIL, SUPPORT_EMAIL]) { expect(a).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i); expect(a).not.toMatch(/example|your-|todo|tbd/i); }
  });
  it("the email itself: clear subjects, plain branded body, valid for one hour, the support line", () => {
    const reset = buildAuthEmail({ kind: "reset", link: "https://planyr.io/?app&authlink=x" });
    const signin = buildAuthEmail({ kind: "signin", link: "https://planyr.io/?app&authlink=x" });
    expect(reset.subject).toBe("Planyr password reset"); expect(signin.subject).toBe("Your Planyr sign-in link");
    for (const m of [reset, signin]) {
      expect(m.text).toContain("1 hour"); expect(m.html).toContain("1 hour"); expect(m.text).toContain(SUPPORT_EMAIL);
      expect(m.html).toContain('href="https://planyr.io/?app&amp;authlink=x"');
      expect(m.html).toMatch(/background:#1d4ed8/);   // the same button as the invite email
    }
    expect(reset.text).toMatch(/not changed/i); expect(signin.text).toMatch(/ignore/i);
  });
});

describe("failures are never worded as a send", () => {
  it("every failure reason says nothing went out (or offers support) and never claims success", () => {
    for (const reason of ["network", "send_failed", "link_failed", "unavailable", "not_configured", "mystery"]) {
      const t = failureCopy({ reason });
      expect(t).toContain(SUPPORT_EMAIL);
      expect(t).not.toMatch(/^(sent|check your inbox)/i);
      // the honest negations are allowed; any affirmative claim of a send is not
      expect(t.replace(/no email (was sent|went out)|nothing is on its way/gi, "")).not.toMatch(/on its way|we sent|has been sent|was sent|went out/i);
    }
    expect(failureCopy({ reason: "throttled", retryAfterSeconds: 2400 })).toMatch(/about 40 minutes/);
  });
  it("the blocked-network line says the NETWORK stopped the check, and offers no 'use phone data' detour", () => {
    expect(BLOCKED_CHECK_COPY).toMatch(/network blocked/i);
    expect(BLOCKED_CHECK_COPY).not.toMatch(/phone|cellular|mobile data|hotspot/i);
    expect(panelSrc).not.toMatch(/phone data|cellular|mobile data|hotspot/i);
  });
});

describe("AuthPanel renders the generated copy, not its own", () => {
  it("uses the shared copy, names no sender itself, and has no surviving old wording", () => {
    expect(panelSrc).toContain("checkEmailCopy");
    expect(panelSrc).toContain("failureCopy");
    expect(panelSrc).toContain('from "../lib/emailLinkCopy.js"');
    expect(panelSrc).not.toMatch(/check your email for a confirmation link/i);
    expect(panelSrc).not.toMatch(/Password-reset email sent/i);
    expect(panelSrc).not.toMatch(/Supabase Auth|mail\.app\.supabase/);
    expect(read("../src/workspaces/site-planner/lib/signupOutcome.js")).toContain("SIGNUP_CONFIRM_SENDER_LABEL");
  });
});
