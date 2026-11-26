/* The typed one-time code beside the emailed sign-in link: for a browser that cannot pass Turnstile or open the link
 * (Claude's built-in browser pane). Same single-use token as the link; verifyOtp is not behind the captcha. */
import { describe, it, expect, vi } from "vitest";
import { buildAuthEmail, isEmailCode } from "../functions/api/lib/authEmail.js";
import { handleEmailLink } from "../functions/api/auth/email-link.js";
import { codeFailureCopy, CODE_COPY } from "../src/workspaces/site-planner/lib/emailLinkCopy.js";

describe("email body", () => {
  it("sign-in email carries the code beside the link; reset never does", () => {
    const m = buildAuthEmail({ kind: "signin", link: "https://planyr.io/?x", code: "123456" });
    expect(m.text).toContain("123456"); expect(m.html).toContain("123456"); expect(m.text).toContain("https://planyr.io/?x");
    const r = buildAuthEmail({ kind: "reset", link: "https://planyr.io/?x", code: "123456" });
    expect(r.text).not.toContain("123456"); expect(r.html).not.toContain("123456");
  });
  it("no code, or a malformed one, leaves the email exactly as before", () => {
    for (const code of [undefined, "", "12ab56", "<script>", "123"]) {
      const m = buildAuthEmail({ kind: "signin", link: "L", code });
      expect(m.text).not.toMatch(/code/i); expect(m.html).not.toMatch(/code/i);
    }
    expect(isEmailCode("123456")).toBe(true); expect(isEmailCode("12345")).toBe(false);
  });
});

describe("route", () => {
  const USER = { id: "11111111-1111-4111-8111-111111111111", email: "me@x.example" };
  const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "S", GMAIL_SERVICE_ACCOUNT_JSON: "{}", INVITE_SENDER: "m@planyr.io", PUBLIC_APP_URL: "https://planyr.io" };
  const go = async (purpose, genExtra) => {
    const fetch = vi.fn(async (url) => {
      if (url.endsWith("/rpc/claim_auth_email_link")) return Response.json({ ok: true, claim_id: 1, user_id: USER.id, cooldown_seconds: 60 });
      if (url.endsWith("/auth/v1/admin/generate_link")) return Response.json({ id: USER.id, email: USER.email, hashed_token: "t".repeat(56), ...genExtra });
      return new Response(null, { status: 204 });
    });
    const send = vi.fn(async () => ({ ok: true }));
    const res = await handleEmailLink(new Request("https://planyr.io/api/auth/email-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: USER.email, purpose }) }), ENV, { fetch, send, sleep: async () => {}, random: () => 0.5 });
    return { res, mail: send.mock.calls[0] && send.mock.calls[0][0] };
  };
  it("the code from generate_link reaches the sign-in mail, and is never in the reply", async () => {
    const { res, mail } = await go("signin", { email_otp: "654321" });
    expect(mail.text).toContain("654321");
    expect(JSON.stringify(await res.json())).not.toContain("654321");
  });
  it("older generate_link answers (no code) still send the plain link mail; reset gets no code", async () => {
    expect((await go("signin", {})).mail.text).not.toContain("654321");
    expect((await go("reset", { email_otp: "654321" })).mail.text).not.toContain("654321");
  });
});

describe("copy", () => {
  it("every failure kind has plain words and a way forward", () => {
    for (const k of ["bad_code", "rate", "network", "other"]) expect(codeFailureCopy(k).length).toBeGreaterThan(20);
    expect(CODE_COPY.label).toMatch(/code/i);
  });
});
