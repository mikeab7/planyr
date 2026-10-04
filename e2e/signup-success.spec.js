/* NEW-1/2/3 (auth panel) — a successful sign-up must SAY so, and the panel's controls belong to
 * their tab. Drives the real built app with Supabase's sign-up endpoint mocked, so it needs a build
 * with a (dummy) Supabase config — otherwise signUp() answers "Cloud not configured." before any
 * request is made:
 *
 *   VITE_SUPABASE_URL="https://signupsuccess1.supabase.co" \
 *     VITE_SUPABASE_ANON_KEY="signupsuccess1-dummy-key" \
 *     npx playwright test e2e/signup-success.spec.js
 *
 * Both signUp answers are covered (the app branches on session present vs absent, not a flag):
 *   absent  → the form is replaced by "Check your email" naming the address + the real sender
 *   present → signed in already; the panel closes, no check-your-email screen
 * plus the double-submit guard (one request however many presses) and tab-scoping. */
import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : "";
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "new@example.com", app_metadata: {}, user_metadata: { first_name: "N", last_name: "U" }, created_at: new Date().toISOString() };

async function mock(page, { session, gate, calls }) {
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== HOST) return route.abort();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/auth/v1/signup") {
      calls.push(route.request().postData());
      if (gate) await gate;
      return json(session
        ? { access_token: "tok", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "ref", user: USER }
        : USER);
    }
    if (u.pathname === "/auth/v1/user") return json(USER);
    if (u.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

async function fill(page, pw = "secret123") {
  await page.getByLabel("First name").fill("N");
  await page.getByLabel("Last name").fill("U");
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password").fill(pw);
}

test.describe("sign-up panel — success feedback and tab scoping", () => {
  test.skip(!HOST, "needs VITE_SUPABASE_URL baked into the build (see the header)");

  test("confirmation ON (no session): the form is replaced by a check-your-email state", async ({ page }) => {
    const calls = [];
    await mock(page, { session: false, calls });
    await page.goto("/?app&auth=signup");
    await fill(page);
    await page.getByTestId("auth-submit").click();
    const ok = page.getByTestId("signup-success");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("new@example.com");
    await expect(ok).toContainText("Supabase Auth"); // the real sender is named
    // the form is GONE, not annotated — and no password field is left holding the typed value
    await expect(page.getByTestId("auth-submit")).toHaveCount(0);
    await expect(page.locator('[role="dialog"] input')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML.includes("secret123"))).toBe(false);
    expect(calls).toHaveLength(1);
    // the way forward is a real control
    await page.getByTestId("signup-success-signin").click();
    await expect(page.getByTestId("auth-submit")).toHaveText("Sign in");
  });

  test("confirmation OFF (session present): signed in, panel closes, no check-your-email screen", async ({ page }) => {
    const calls = [];
    await mock(page, { session: true, calls });
    await page.goto("/?app&auth=signup");
    await fill(page);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("signup-success")).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });

  test("the button goes pending and a second press (click or Enter) sends nothing", async ({ page }) => {
    const calls = []; let release; const gate = new Promise((r) => { release = r; });
    await mock(page, { session: false, calls, gate });
    await page.goto("/?app&auth=signup");
    await fill(page);
    const btn = page.getByTestId("auth-submit");
    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText("Creating account…");
    await page.getByLabel("Password").press("Enter");
    await page.getByLabel("Password").press("Enter");
    await page.waitForTimeout(300);
    expect(calls).toHaveLength(1);
    release();
    await expect(page.getByTestId("signup-success")).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test("placement and tab-scoping: hint under the password field, signup only; Forgot password on Sign in only", async ({ page }) => {
    await mock(page, { session: false, calls: [] });
    await page.goto("/?app&auth=signup");
    const dlg = page.getByRole("dialog");
    const pw = dlg.getByLabel("Password");
    await expect(dlg.getByText("Forgot password?")).toHaveCount(0);
    await expect(dlg.getByTestId("password-hint")).toHaveCount(0); // not permanent chrome
    await pw.focus();
    const hint = dlg.getByTestId("password-hint");
    await expect(hint).toHaveText("Min 6 characters");
    const [p, h, s] = await Promise.all([pw.boundingBox(), hint.boundingBox(), dlg.getByTestId("auth-submit").boundingBox()]);
    expect(h.y).toBeGreaterThanOrEqual(p.y + p.height - 1); // directly beneath the input…
    expect(h.y - (p.y + p.height)).toBeLessThan(16);         // …touching it, not at the panel bottom
    expect(h.y + h.height).toBeLessThanOrEqual(s.y);        // and above the submit button
    expect(Math.abs(h.x - p.x)).toBeLessThan(16);           // left-aligned with the field
    await dlg.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect(dlg.getByText("Forgot password?")).toBeVisible();
    await expect(dlg.getByTestId("password-hint")).toHaveCount(0);
    await dlg.getByLabel("Password").focus();
    await expect(dlg.getByTestId("password-hint")).toHaveCount(0);
  });
});
