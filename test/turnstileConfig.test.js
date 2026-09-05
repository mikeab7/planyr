/* Cloudflare Turnstile config (B1160720, NEW-1) — turnstileEnabled() is the ONE thing that
 * decides whether the sign-up form renders a CAPTCHA widget at all, and it must degrade
 * cleanly (no widget, no captchaToken, form still works) when no site key is configured —
 * this repo's test env, local dev without a .env.local, and the seeded e2e account all rely
 * on that default. */
import { describe, it, expect } from "vitest";
import { TURNSTILE_SITE_KEY, turnstileEnabled } from "../src/shared/turnstile/turnstileConfig.js";

describe("Turnstile config (B1160720, NEW-1)", () => {
  it("turnstileEnabled() agrees exactly with whether a site key is present", () => {
    expect(turnstileEnabled()).toBe(!!TURNSTILE_SITE_KEY);
  });

  it("is a real value or a real absence, never a placeholder that looks configured", () => {
    if (TURNSTILE_SITE_KEY) {
      expect(TURNSTILE_SITE_KEY).not.toMatch(/your-cloudflare|example|todo|tbd/i);
    } else {
      expect(turnstileEnabled()).toBe(false);
    }
  });
});
