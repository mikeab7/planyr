/* auth.js signUp() / signIn() forward a Turnstile captchaToken to Supabase but never fabricates one
 * (B1160720, NEW-1). Supabase Auth (GoTrue) is the one that actually VERIFIES the token —
 * server-side, against Cloudflare, using the secret key in the Supabase dashboard — so the
 * only thing this repo's code can be responsible for, and the only thing worth unit-testing,
 * is that the token the widget produced is the exact one that reaches supabase.auth.signUp,
 * and that an absent/empty token is never silently turned into one.
 *
 * The supabase client module is mocked (same approach as reviewDeleteSafety.test.js /
 * reconcileSite.test.js) so this never makes a real network call — CI's build job carries
 * real production Supabase secrets as env vars, and an unmocked signUp() here would attempt
 * a genuine account-creation call against production auth.users on every test run. */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [], signUpFail: null, reply: () => ({ data: {}, error: null }) }));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    auth: {
      signInWithPassword: async (args) => { h.calls.push(args); return h.reply("signIn", args); },
      resetPasswordForEmail: async (email, options) => { h.calls.push({ email, options }); return h.reply("reset", { email, options }); },
      signUp: async (args) => {
        h.calls.push(args);
        if (h.signUpFail) return { data: { user: null, session: null }, error: h.signUpFail };
        return { data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null };
      },
    },
  },
  supabaseConfigured: () => true,
}));

import { signUp, signIn } from "../src/workspaces/site-planner/lib/auth.js";
import { CAPTCHA_FAILED_COPY, isCaptchaError } from "../src/shared/turnstile/captchaCopy.js";

describe("signUp() — Turnstile captchaToken forwarding (B1160720, NEW-1)", () => {
  it("passes options.captchaToken through unmodified when the caller supplies one", async () => {
    h.calls.length = 0;
    await signUp("a@example.com", "password1", {}, "the-real-turnstile-token");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].options.captchaToken).toBe("the-real-turnstile-token");
  });

  it("omits captchaToken entirely when the caller has none (Turnstile unconfigured)", async () => {
    h.calls.length = 0;
    await signUp("b@example.com", "password1", {});
    expect(h.calls).toHaveLength(1);
    expect("captchaToken" in h.calls[0].options).toBe(false);
  });

  it("omits captchaToken for an explicit empty string (widget hasn't produced one yet)", async () => {
    h.calls.length = 0;
    await signUp("c@example.com", "password1", {}, "");
    expect("captchaToken" in h.calls[0].options).toBe(false);
  });

  it("still forwards the profile metadata and redirect regardless of captcha state", async () => {
    h.calls.length = 0;
    await signUp("d@example.com", "password1", { firstName: "A", lastName: "B", org: "C" }, "tok");
    const call = h.calls[0];
    expect(call.options.data).toEqual({ first_name: "A", last_name: "B", org: "C" });
    expect(call.options.captchaToken).toBe("tok");
  });
});

describe("signIn() — Turnstile captchaToken forwarding (NEW-1)", () => {
  it("passes options.captchaToken to signInWithPassword", async () => {
    h.calls.length = 0;
    await signIn("a@example.com", "pw123456", "the-token");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].email).toBe("a@example.com");
    expect(h.calls[0].password).toBe("pw123456");
    expect(h.calls[0].options.captchaToken).toBe("the-token");
  });
  it("omits options/captchaToken when there is none or it is empty (never an empty string)", async () => {
    for (const tok of [undefined, ""]) {
      h.calls.length = 0;
      await signIn("a@example.com", "pw123456", tok);
      expect("options" in h.calls[0]).toBe(false);
    }
  });
});

describe("a captcha refusal never reaches the screen as the server's raw words (NEW-1)", () => {
  const RAW = "captcha protection: request disallowed (no captcha_token found)";
  const refusals = [
    { name: "AuthError with code", err: { message: RAW, code: "captcha_failed", status: 400 } },
    { name: "message only", err: { message: RAW } },
    { name: "code only, odd wording", err: { message: "request disallowed", code: "captcha_failed" } },
    { name: "verification failed wording", err: { message: "captcha verification process failed" } },
  ];
  for (const { name, err } of refusals) {
    it(`signIn / signUp both say it in plain words — ${name}`, async () => {
      h.reply = () => ({ data: { user: null, session: null }, error: err });
      h.signUpFail = err;
      const results = [
        (await signIn("a@example.com", "pw123456")).error,
        (await signUp("a@example.com", "pw123456", {})).error,
      ];
      for (const text of results) {
        expect(text).toBe(CAPTCHA_FAILED_COPY);
        expect(text).not.toMatch(/captcha/i);
        expect(text).not.toMatch(/disallowed|token/i);
      }
      h.reply = () => ({ data: {}, error: null });
      h.signUpFail = null;
    });
  }
  it("every other error gets its own plain words too (NEW-1 point 2 — the server's text is never shown)", async () => {
    h.reply = () => ({ data: {}, error: { message: "Invalid login credentials", code: "invalid_credentials" } });
    const r = await signIn("a@example.com", "x");
    expect(r.error).toBe("That email and password don't match.");
    expect(r.errorKind).toBe("invalid_credentials");
    h.reply = () => ({ data: {}, error: null });
  });
  it("isCaptchaError reads both the code and the text", () => {
    expect(isCaptchaError({ code: "captcha_failed", message: "x" })).toBe(true);
    expect(isCaptchaError("captcha protection: nope")).toBe(true);
    expect(isCaptchaError({ message: "Invalid login credentials" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});
