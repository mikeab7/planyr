/* AI agent access, sign-in fix (owner-approved mockup 2026-11-27). Drives the REAL built app with Supabase and
 * Cloudflare's Turnstile script MOCKED (same fake world as auth-email-link.spec.js), so it needs a build with
 * dummy config baked in:
 *
 *   VITE_SUPABASE_URL="https://authagent1.supabase.co" VITE_SUPABASE_ANON_KEY="authagent1-dummy" \
 *   VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" npx playwright test e2e/auth-agent-browser.spec.js
 *
 * Every arm, in both directions: an agent's browser (webdriver, or the Claude app's "Claude/" name with webdriver
 * false) gets the code-first panel end to end through a typed code; a person's browser gets the unchanged password
 * form; the password form is one tap away for an agent; Sign up and Forgot password are unchanged for an agent;
 * a blocked check in a person's browser promotes the code with the new words; a phone-width panel fits. */
import { test, expect } from "@playwright/test";
import { asHumanBrowser } from "./lib/humanBrowser.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : "";
const SITE_KEY = process.env.VITE_TURNSTILE_SITE_KEY || "";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const ME = { id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated", email: "me@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const session = (u) => ({ access_token: jwt(u.id), refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: u });
const FAKE_TURNSTILE = `(function(){var n=0,w={};window.__tsRenders=0;window.turnstile={render:function(el,o){window.__tsRenders++;var id="w"+(++n);w[id]=o;setTimeout(function(){o.callback("tok-"+(++n));},30);return id;},reset:function(id){if(w[id])setTimeout(function(){w[id].callback("tok-"+(++n));},30);},remove:function(id){delete w[id];}};})();`;
const CLAUDE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.4.0 Chrome/131.0.0.0 Electron/33.0.0 Safari/537.36";

async function mock(page, w) {
  w.calls = [];
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    const body = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch (_) { return {}; } })();
    if (u.pathname === "/api/auth/email-link") { w.calls.push({ path: u.pathname, body }); return json({ ok: true, retryAfterSeconds: 60, expiresMinutes: 60 }); }
    if (u.pathname === "/api/auth/mailbox-proof") { w.calls.push({ path: u.pathname }); return json({ ok: true }); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname === "challenges.cloudflare.com") {
      w.calls.push({ path: "turnstile-script" });
      if (w.blockTurnstile) return route.abort();
      return route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_TURNSTILE });
    }
    if (u.hostname !== HOST) return route.abort();
    if (u.pathname === "/auth/v1/verify") {
      w.calls.push({ path: u.pathname, body });
      if (body.token !== "123456") return json({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }, 403);
      return json(session(ME));
    }
    if (u.pathname === "/auth/v1/user") return json(ME);
    if (u.pathname === "/auth/v1/token") {
      w.calls.push({ path: u.pathname, body });
      const tok = body.gotrue_meta_security && body.gotrue_meta_security.captcha_token;
      if (!tok) return json({ code: 400, error_code: "captcha_failed", msg: "captcha protection: request disallowed (no captcha_token found)" }, 400);
      if (body.password !== "right-password") return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      return json(session(ME));
    }
    if (u.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}
const dlg = (page) => page.getByRole("dialog");
const bg = (loc) => loc.evaluate((n) => getComputedStyle(n).backgroundColor);
const isPrimary = async (page, loc) => (await bg(loc)) === (await page.evaluate(() => {
  const d = document.createElement("div"); d.style.background = "var(--accent)"; document.body.appendChild(d);
  const c = getComputedStyle(d).backgroundColor; d.remove(); return c;
}));

test.describe("AI agent access: the sign-in panel", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");

  test("A1 automated browser: the note, no password, no check, the code button is primary, Enter sends it, the typed code signs in", async ({ page }) => {
    const w = {}; await mock(page, w);
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
    await page.goto("/?app&auth=signin");
    const note = page.getByTestId("agent-browser-note");
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute("data-agent-reason", "automated");
    await expect(note).toContainText("Using an AI agent?");
    await expect(note).toContainText("sign-in code");
    await expect(dlg(page).getByLabel("Password")).toHaveCount(0);
    await expect(page.getByTestId("auth-submit")).toHaveCount(0);
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(0);
    expect(w.calls.filter((c) => c.path === "turnstile-script")).toHaveLength(0); // Cloudflare's script never even loads
    const btn = page.getByTestId("email-link-signin");
    await expect(btn).toHaveText("Email me a sign-in code");
    await expect.poll(() => isPrimary(page, btn)).toBe(true);
    // Enter with no address says what is missing (never a silent no-op)
    await dlg(page).getByLabel("Email").press("Enter");
    await expect(dlg(page)).toContainText(/email/i);
    expect(w.calls.filter((c) => c.path === "/api/auth/email-link")).toHaveLength(0);
    await dlg(page).getByLabel("Email").fill("me@example.com");
    await dlg(page).getByLabel("Email").press("Enter");
    await expect(page.getByTestId("email-link-inbox")).toContainText("me@example.com");
    expect(w.calls.filter((c) => c.path === "/api/auth/email-link")[0].body).toMatchObject({ email: "me@example.com", purpose: "signin" });
    // Moment 3: the code box comes BEFORE the link details, and says who supplies the code
    const order = await page.getByTestId("email-link-sent").evaluate((root) => {
      const pos = (sel) => { const el = root.querySelector(sel); return el ? [...root.querySelectorAll("*")].indexOf(el) : -1; };
      const valid = [...root.querySelectorAll("div")].find((d) => /works once/.test(d.textContent) && d.children.length === 0);
      return { inbox: pos('[data-testid="email-link-inbox"]'), code: pos('[data-testid="email-code-input"]'), valid: valid ? [...root.querySelectorAll("*")].indexOf(valid) : -1 };
    });
    expect(order.inbox).toBeLessThan(order.code);
    expect(order.code).toBeLessThan(order.valid);
    await expect(page.getByTestId("email-code-agent-note")).toContainText("only for a sign-in you just started");
    await expect.poll(() => isPrimary(page, page.getByTestId("email-code-submit"))).toBe(true);
    // a wrong code says so; the right one signs in and the panel becomes the signed-in view
    await page.getByTestId("email-code-input").fill("111111");
    await page.getByTestId("email-code-submit").click();
    await expect(page.getByTestId("email-code-problem")).toBeVisible();
    await page.getByTestId("email-code-input").fill("123456");
    await page.getByTestId("email-code-input").press("Enter");
    await expect(page.getByTestId("email-link-sent")).toHaveCount(0);
    const v = w.calls.filter((c) => c.path === "/auth/v1/verify").pop();
    expect(v.body).toMatchObject({ email: "me@example.com", token: "123456" });
    expect(w.calls.filter((c) => c.path === "/auth/v1/token")).toHaveLength(0); // no password grant was ever attempted
  });

  test("A2 the Claude app's browser (webdriver false, named Claude/…) gets the same agent panel", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: CLAUDE_UA });
    const page = await ctx.newPage();
    await asHumanBrowser(page);
    const w = {}; await mock(page, w);
    await page.goto("/?app&auth=signin");
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
    await expect(page.getByTestId("agent-browser-note")).toHaveAttribute("data-agent-reason", "claude");
    await expect(dlg(page).getByLabel("Password")).toHaveCount(0);
    await ctx.close();
  });

  test("A3 'Use my password instead' brings back the normal form, the check runs, and a password sign-in still needs its token", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await page.getByTestId("agent-use-password").click();
    await expect(page.getByTestId("agent-browser-note")).toHaveCount(0);
    await expect(dlg(page).getByLabel("Password")).toBeVisible();
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(1);
    await dlg(page).getByLabel("Email").fill("me@example.com");
    await dlg(page).getByLabel("Password").fill("right-password");
    await page.getByTestId("auth-submit").click();
    await expect(dlg(page)).toHaveCount(0);
    const t = w.calls.filter((c) => c.path === "/auth/v1/token");
    expect(t).toHaveLength(1);
    expect(t[0].body.gotrue_meta_security.captcha_token).toBeTruthy(); // the bot check was NOT skipped
    await expect(page.getByTestId("email-link-signin")).toHaveCount(0);
  });

  test("A4 an agent on Sign up and on Forgot password sees those forms unchanged (sign-up keeps its visible check)", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await dlg(page).getByRole("button", { name: "Sign up" }).first().click();
    await expect(page.getByTestId("agent-browser-note")).toHaveCount(0);
    await expect(dlg(page).getByLabel("Password")).toBeVisible();
    await expect(page.getByTestId("turnstile-widget")).toHaveAttribute("data-turnstile-appearance", "always");
    // back to Sign in: the agent layout returns
    await dlg(page).getByRole("button", { name: "Sign in" }).first().click();
    await expect(page.getByTestId("agent-browser-note")).toBeVisible();
    // Forgot password (reached from the password form) stays the plain email form
    await page.getByTestId("agent-use-password").click();
    await dlg(page).getByText("Forgot password?").click();
    await expect(page.getByTestId("agent-browser-note")).toHaveCount(0);
    await expect(page.getByTestId("auth-submit")).toHaveText("Send reset email");
  });

  test("H1 a person's browser: no note, the normal password form, Sign in is primary", async ({ page }) => {
    await asHumanBrowser(page);
    const w = {}; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await expect(dlg(page).getByLabel("Password")).toBeVisible();
    await expect(page.getByTestId("agent-browser-note")).toHaveCount(0);
    await expect(page.getByTestId("captcha-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(1);
    await expect.poll(() => isPrimary(page, page.getByTestId("auth-submit"))).toBe(true);
    await expect.poll(() => isPrimary(page, page.getByTestId("email-link-signin"))).toBe(false);
    await expect(page.getByTestId("email-link-signin")).toHaveText("Email me a sign-in code");
  });

  test("H2 a person's browser whose check is blocked: the new words, the code becomes primary, Try the check again recovers", async ({ page }) => {
    await asHumanBrowser(page);
    const w = { blockTurnstile: true }; await mock(page, w);
    await page.goto("/?app&auth=signin");
    const box = page.getByTestId("captcha-unavailable");
    await expect(box).toHaveAttribute("data-blocked", "true");
    await expect(box).toContainText("The security check didn’t finish");
    await expect(box).toContainText("Using an AI agent");
    await expect.poll(() => isPrimary(page, page.getByTestId("email-link-signin"))).toBe(true);
    await expect.poll(() => isPrimary(page, page.getByTestId("auth-submit"))).toBe(false);
    w.blockTurnstile = false;
    await page.getByTestId("captcha-retry").click();
    await expect(box).toHaveCount(0);
    await expect.poll(() => isPrimary(page, page.getByTestId("auth-submit"))).toBe(true);
  });

  test("P1 phone width, agent browser: the panel fits and the code button is reachable", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto("/?app&auth=signin");
    const box = await dlg(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(page.getByTestId("email-link-signin")).toBeInViewport();
  });
});
