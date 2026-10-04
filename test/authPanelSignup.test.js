/* Sign-up panel feedback + layout (NEW-1/2/3, auth panel). No jsdom in this repo, so this file
 * covers the pure decision (both signUp branches), the real AuthPanel render per tab
 * (placement + tab-scoping, asserted on the markup), and source guards on the wiring. The
 * state transition itself (form gone, success shown, button pending) is driven in a real browser
 * by e2e/signup-success.spec.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthPanel from "../src/workspaces/site-planner/components/AuthPanel.jsx";
import { signupOutcome, passwordHintVisible, checkEmailCopy, PASSWORD_MIN_HINT } from "../src/workspaces/site-planner/lib/signupOutcome.js";
import { AUTH_SENDER_LABEL } from "../src/workspaces/site-planner/lib/authMail.js";

const src = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");
const authSrc = readFileSync(new URL("../src/workspaces/site-planner/lib/auth.js", import.meta.url), "utf8");
const render = (initialMode) => renderToStaticMarkup(createElement(AuthPanel, { user: null, initialMode, onClose: () => {} }));

describe("NEW-1 — signup outcome branches on the response, not a flag", () => {
  it("session present → signed in (land in the app)", () => {
    expect(signupOutcome({ error: null, needsConfirm: false, signedIn: true })).toBe("signed-in");
  });
  it("session absent → check your email", () => {
    expect(signupOutcome({ error: null, needsConfirm: true, signedIn: false })).toBe("check-email");
  });
  it("neither error nor session is never read as signed in", () => {
    expect(signupOutcome({ error: null, needsConfirm: false, signedIn: false })).toBe("check-email");
  });
  it("an error stays an error", () => {
    expect(signupOutcome({ error: "nope" })).toBe("error");
    expect(signupOutcome(undefined)).toBe("error");
  });
  it("the success copy names the address and the real sender", () => {
    const c = checkEmailCopy("a@b.co");
    expect(c.sent).toContain("a@b.co");
    expect(c.sender).toContain(AUTH_SENDER_LABEL);
  });
  it("signUp() reports session presence from the response itself", () => {
    expect(authSrc).toMatch(/signedIn: !!\(data && data\.session\)/);
  });
  it("AuthPanel wires the success state, clears the password and guards double submit", () => {
    expect(src).toMatch(/signupOutcome\(res\)/);
    expect(src).toMatch(/setPw\(""\);[^\n]*never leave the typed password/);
    expect(src).toMatch(/if \(done\) \{/);
    expect(src).toMatch(/if \(submitting\.current\) return;/);
    expect(src).toMatch(/submitting\.current = false; setBusy\(false\)/);
    expect(src).toContain("Creating account…");
  });
  it("the success state renders no inputs (no password field behind it)", () => {
    const block = src.slice(src.indexOf("if (done) {"), src.indexOf("// Logged-out forms"));
    expect(block).not.toMatch(/<input/);
  });
});

describe("NEW-2 — the minimum-length hint sits under the password field, signup only", () => {
  it("is visible only when useful: focused, or typed-but-short", () => {
    expect(passwordHintVisible(false, "")).toBe(false);
    expect(passwordHintVisible(true, "")).toBe(true);
    expect(passwordHintVisible(false, "abc")).toBe(true);
    expect(passwordHintVisible(false, "abcdef")).toBe(false);
    expect(passwordHintVisible(true, "abcdef")).toBe(true);
  });
  it("is rendered directly after the password input and before the submit button", () => {
    const m = src.indexOf('aria-label="Password"');
    const hint = src.indexOf('data-testid="password-hint"');
    const submit = src.indexOf('data-testid="auth-submit"');
    expect(m).toBeGreaterThan(0);
    expect(hint).toBeGreaterThan(m);
    expect(hint).toBeLessThan(submit);
    // nothing between the password input and the hint but the closing of the same field block
    const between = src.slice(src.indexOf("/>", m), hint);
    expect(between).not.toMatch(/<button|Turnstile|Forgot/);
  });
  it("the old bottom-row 'Min 6 characters' span is gone", () => {
    expect(src).not.toMatch(/<span[^>]*>Min 6 characters<\/span>/);
    expect(src).not.toContain("Min 6 characters");
    expect(PASSWORD_MIN_HINT).toBe("Min 6 characters");
  });
  it("never appears in the Sign in markup, and is hidden at rest on Sign up", () => {
    expect(render("signin")).not.toContain("Min 6");
    expect(render("signup")).not.toContain("Min 6"); // unfocused + empty at first paint
    expect(render("signup")).toContain('aria-describedby="auth-pw-hint"');
    expect(render("signin")).not.toContain("auth-pw-hint");
  });
});

describe("NEW-3 — controls are scoped to their tab", () => {
  it("Forgot password shows on Sign in only", () => {
    expect(render("signin")).toContain("Forgot password?");
    expect(render("signup")).not.toContain("Forgot password?");
  });
  it("sign-up-only controls (name fields, org) never render on Sign in", () => {
    const si = render("signin"), su = render("signup");
    for (const label of ["First name", "Last name", "Organization or company"]) {
      expect(su).toContain(label);
      expect(si).not.toContain(label);
    }
  });
  it("the Turnstile widget is gated on the signup tab", () => {
    expect(src).toMatch(/mode === "signup" && turnstileEnabled\(\)/);
  });
});
