/* auth.js signUp() forwards a Turnstile captchaToken to Supabase but never fabricates one
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

const h = vi.hoisted(() => ({ calls: [] }));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    auth: {
      signUp: async (args) => {
        h.calls.push(args);
        return { data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null };
      },
    },
  },
  supabaseConfigured: () => true,
}));

import { signUp } from "../src/workspaces/site-planner/lib/auth.js";

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
