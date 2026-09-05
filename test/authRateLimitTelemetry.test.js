/* auth.js signUp() — best-effort client telemetry when the server-side signup rate limit
 * (B1160721, NEW-2) blocks a signup. The Postgres trigger is the real enforcement and
 * cannot be bypassed; this is only visibility for the browser-driven case, reported
 * through the existing client_errors channel with a DOMAIN only, never the full address.
 *
 * Both supabase.js AND clientErrors.js are mocked — same reasoning as authCaptcha.test.js:
 * CI's build job carries real production Supabase secrets, so an unmocked call here could
 * write real telemetry rows (harmless-ish, but still a real network call this unit test
 * has no business making) or worse, attempt a real signup.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ events: [] }));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: { auth: { signUp: async () => ({ data: null, error: null }) } },
  supabaseConfigured: () => true,
}));

vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (kind, message, extra) => { h.events.push({ kind, message, extra }); },
}));

import { SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT } from "../src/shared/auth/rateLimitCopy.js";

async function signUpWithError(errorMessage) {
  vi.resetModules();
  h.events.length = 0;
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({
    supabase: { auth: { signUp: async () => ({ data: null, error: errorMessage ? { message: errorMessage } : null }) } },
    supabaseConfigured: () => true,
  }));
  vi.doMock("../src/shared/telemetry/clientErrors.js", () => ({
    reportClientEvent: (kind, message, extra) => { h.events.push({ kind, message, extra }); },
  }));
  const { signUp } = await import("../src/workspaces/site-planner/lib/auth.js");
  return signUp("someone@floodattempt.example", "password1", {});
}

describe("signUp() — rate-limit telemetry (B1160721, NEW-2)", () => {
  it("logs a signup-rate-limited event, with domain only, when the server rejects for rate limiting", async () => {
    await signUpWithError(`${SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT}. Please try again later.`);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].kind).toBe("signup-rate-limited");
    expect(h.events[0].extra.domain).toBe("floodattempt.example");
    expect(JSON.stringify(h.events[0])).not.toContain("someone@");
  });

  it("does not fire for an unrelated signup error", async () => {
    await signUpWithError("Password should be at least 6 characters.");
    expect(h.events).toHaveLength(0);
  });

  it("does not fire on a clean signup", async () => {
    await signUpWithError(null);
    expect(h.events).toHaveLength(0);
  });
});
