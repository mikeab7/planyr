/* AuthPanel wires the ONE shared Turnstile widget into every logged-out mode (NEW-1, amends
 * B1160720 — which wired sign-up only, so Sign in and Forgot password were refused by Supabase with
 * "captcha protection: request disallowed (no captcha_token found)" and nobody signed out could get
 * back in). A source guard, same shape as authMailCopy.test.js: there is no jsdom in this repo's vitest
 * config, so the load-bearing lines are pinned here, the gate's behaviour is unit-tested in
 * captchaGate.test.js, and the rendered panel is driven in e2e/auth-captcha.spec.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const panelSrc = read("../src/workspaces/site-planner/components/AuthPanel.jsx");
const authSrc = read("../src/workspaces/site-planner/lib/auth.js");

describe("AuthPanel — one shared Turnstile widget (NEW-1)", () => {
  it("imports the shared widget, its config gate and the gate hook, never a local reimplementation", () => {
    expect(panelSrc).toContain('from "../../../shared/turnstile/Turnstile.jsx"');
    expect(panelSrc).toContain('from "../../../shared/turnstile/turnstileConfig.js"');
    expect(panelSrc).toContain('from "../../../shared/turnstile/useCaptchaGate.js"');
  });

  it("mounts exactly ONE <Turnstile> for every mode except recovery and reset, gated on turnstileEnabled()", () => {
    expect(panelSrc.match(/<Turnstile\b/g)).toHaveLength(1);
    // Forgot password (reset) goes through Planyr's own mail route and needs no browser check (NEW-1).
    expect(panelSrc).toMatch(/const captchaOn = turnstileEnabled\(\) && mode !== "recovery" && mode !== "reset"/);
    expect(panelSrc).not.toMatch(/mode === "signup" && turnstileEnabled\(\)/);
    expect(panelSrc).toMatch(/\{captchaOn && \(/);
  });

  it("only sign-up keeps the visible box; sign in / forgot password are interaction-only", () => {
    expect(panelSrc).toMatch(/appearance=\{mode === "signup" \? "always" : "interaction-only"\}/);
  });

  it("the token is forwarded into signIn() AND signUp() — from the gate, not a stand-in; reset sends none", () => {
    expect(panelSrc).toContain("signIn(email.trim(), pw, token || undefined)");
    expect(panelSrc).not.toContain("resetPassword(");
    expect(panelSrc).toContain("token || undefined);"); // signUp's last argument
  });

  it("the submit button is NOT disabled while the token loads, and says Verifying… once pressed", () => {
    const btn = panelSrc.slice(panelSrc.indexOf('data-testid="auth-submit"'));
    const disabled = btn.slice(btn.indexOf("disabled={"), btn.indexOf("onClick={submit}"));
    expect(disabled).not.toMatch(/captcha|Turnstile|token|widget/i);
    expect(disabled).toContain("cv.pending");
    expect(btn).toContain('"Verifying…"');
  });

  it("every press goes through the gate; the form never sends directly", () => {
    expect(panelSrc).toContain("gate.submit({ needsToken: captchaOn })");
    expect(panelSrc).not.toMatch(/onClick=\{perform\}|onClick=\{\(\) => perform/);
  });

  it("a mode switch drops a waiting submit (no dead token, no dead widget)", () => {
    expect(panelSrc).toMatch(/useEffect\(\(\) => \{ gate\.cancelPending\(\); \}, \[mode, gate\]\)/);
  });

  it("never a dead end: a failed / blocked / timed-out check shows plain words and a working Try again", () => {
    expect(panelSrc).toContain("CAPTCHA_UNAVAILABLE_COPY");
    expect(panelSrc).toContain('data-testid="captcha-retry"');
    expect(panelSrc).toContain("gate.retry()");
    expect(panelSrc).toContain("key={widgetKey}");
  });

  it("the old 'Loading verification…' dead-end copy is gone", () => {
    expect(panelSrc).not.toMatch(/Loading verification/);
    expect(panelSrc).not.toMatch(/Couldn't load verification/);
  });
});

describe("auth.js — one place turns a captcha refusal into plain words (NEW-1)", () => {
  it("every error returned to the screen passes through friendlyAuthError", () => {
    expect(authSrc).toMatch(/const errMsg = \(e\) => friendlyAuthError\(e\)/);
    expect(authSrc).not.toMatch(/\(e && e\.message\) \|\| null/);
  });
  it("signIn forwards the token (omit-when-empty), like signUp; there is no Supabase-mailer resetPassword any more", () => {
    expect(authSrc).toMatch(/signIn\(email, password, captchaToken\)/);
    expect(authSrc).not.toMatch(/resetPasswordForEmail/);
  });
});
