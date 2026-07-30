/* NEW-2 — the sign-up / password-reset copy must NAME the address the email arrives from.
 *
 * The bug it guards: "check your email for a confirmation link" tells a new user nothing
 * about what to look for, so someone watching for a planyr.io message never finds the one
 * that actually arrived, decides the signup broke, and retries or leaves. Naming the sender
 * only helps while the name is TRUE, so the address lives in exactly one constant and both
 * messages are generated from it — these tests fail the build if a message stops carrying
 * it (a re-hardcoded string), or if AuthPanel stops rendering the generated copy. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AUTH_SENDER_EMAIL, AUTH_SENDER_NAME, AUTH_SENDER_LABEL,
  SIGNUP_CONFIRM_MSG, PASSWORD_RESET_MSG,
} from "../src/workspaces/site-planner/lib/authMail.js";

const panelSrc = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");

describe("auth mail copy — the sender is named, and it is the configured one (NEW-2)", () => {
  it("names the configured sender in BOTH messages", () => {
    for (const msg of [SIGNUP_CONFIRM_MSG, PASSWORD_RESET_MSG]) {
      expect(msg).toContain(AUTH_SENDER_EMAIL);
      expect(msg).toContain(AUTH_SENDER_NAME);
      expect(msg).toContain(AUTH_SENDER_LABEL);
    }
  });

  it("holds a real, single address — not a placeholder", () => {
    expect(AUTH_SENDER_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
    expect(AUTH_SENDER_EMAIL).not.toMatch(/example|your-|todo|tbd/i);
  });

  it("tells the user to look in spam, in one short line", () => {
    for (const msg of [SIGNUP_CONFIRM_MSG, PASSWORD_RESET_MSG]) {
      expect(msg).toMatch(/spam/i);
      expect(msg).not.toContain("\n");
      expect(msg.length).toBeLessThanOrEqual(150);
    }
  });

  it("still says what the message is about", () => {
    expect(SIGNUP_CONFIRM_MSG).toMatch(/account created/i);
    expect(SIGNUP_CONFIRM_MSG).toMatch(/confirmation link/i);
    expect(PASSWORD_RESET_MSG).toMatch(/password-reset/i);
  });
});

describe("auth mail copy — AuthPanel renders the generated copy, not its own (NEW-2)", () => {
  it("uses the two constants and hardcodes neither message", () => {
    expect(panelSrc).toContain("SIGNUP_CONFIRM_MSG");
    expect(panelSrc).toContain("PASSWORD_RESET_MSG");
    expect(panelSrc).toContain('from "../lib/authMail.js"');
  });

  it("has no surviving copy of the old sender-less wording", () => {
    expect(panelSrc).not.toMatch(/check your email for a confirmation link/i);
    expect(panelSrc).not.toMatch(/Password-reset email sent/i);
  });
});
