/* NEW-1 (amends B1160720) — Sign in and Sign up carry the Turnstile token (Forgot password no longer does: it goes
 * through Planyr's own mail route, e2e/auth-email-link.spec.js), and a
 * captcha refusal never reaches the screen as jargon. Drives the real built app with BOTH
 * Supabase's auth endpoints and Cloudflare's Turnstile script MOCKED, so it needs a build with dummy
 * Supabase + Turnstile config baked in:
 *
 *   VITE_SUPABASE_URL="https://authcaptcha1.supabase.co" VITE_SUPABASE_ANON_KEY="authcaptcha1-dummy" \
 *   VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" npx playwright test e2e/auth-captcha.spec.js
 *
 * The fake Supabase behaves like GoTrue with captcha ON: no token (or a token it already saw — they
 * are SINGLE USE) → 400 captcha_failed with the raw words; wrong password → 400 invalid_credentials;
 * right password → a session. The fake Turnstile issues a NEW token on render and on every reset(), after
 * a delay the test controls (`window.__tsGate`), and records how it was rendered. This proves the wire
 * shape and the panel's behaviour; whether Cloudflare accepts a real headless browser is the separate
 * live check (V-entry on the item). */
import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : "";
const SITE_KEY = process.env.VITE_TURNSTILE_SITE_KEY || "";
const RAW = "captcha protection: request disallowed (no captcha_token found)";
const USER = { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };

const FAKE_TURNSTILE = `
  (function () {
    var n = 0, widgets = {}, gateOpen = true, waiting = [];
    var last = null;
    window.__ts = { renders: [], resets: 0, removes: 0 };
    window.__tsDeliver = function (t) { if (last) last.callback(t); };
    window.__tsHold = function () { gateOpen = false; };
    window.__tsRelease = function () { gateOpen = true; var w = waiting; waiting = []; w.forEach(function (f) { f(); }); };
    function issue(id) {
      var go = function () { var w = widgets[id]; if (w) w.callback("tok-" + (++n)); };
      if (gateOpen) setTimeout(go, 30); else waiting.push(go);
    }
    window.turnstile = {
      render: function (el, o) {
        var id = "w" + (++n);
        widgets[id] = o; last = o; window.__ts.renders.push({ appearance: o.appearance, sitekey: o.sitekey, refresh: o["refresh-expired"] });
        if (!window.__tsNoToken) issue(id);
        return id;
      },
      reset: function (id) { window.__ts.resets++; if (widgets[id] && !window.__tsNoToken) issue(id); },
      remove: function (id) { window.__ts.removes++; delete widgets[id]; },
    };
  })();
`;

async function mock(page, { calls, rawOnly = false, scriptOk = true }) {
  const seen = new Set();
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    if (u.pathname === "/api/auth/email-link") {   // Planyr's own mail route (NEW-1) — Forgot password no longer touches Supabase or Turnstile
      calls.push({ path: u.pathname, body: (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch (_) { return {}; } })() });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, retryAfterSeconds: 60, expiresMinutes: 60 }) });
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname === "challenges.cloudflare.com") {
      if (!scriptOk) return route.abort();
      return route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_TURNSTILE });
    }
    if (u.hostname !== HOST) return route.abort();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    const refuse = () => json({ code: 400, error_code: "captcha_failed", msg: RAW }, 400);
    const body = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch (_) { return {}; } })();
    const tok = body.gotrue_meta_security && body.gotrue_meta_security.captcha_token;
    const gated = u.pathname === "/auth/v1/token" || u.pathname === "/auth/v1/recover" || u.pathname === "/auth/v1/signup";
    if (gated) {
      calls.push({ path: u.pathname, tok, body });
      if (rawOnly || !tok || seen.has(tok)) return refuse(); // single use: a spent token is refused
      seen.add(tok);
    }
    if (u.pathname === "/auth/v1/token") {
      if (body.password !== "right-password") return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      return json({ access_token: "tok", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "ref", user: USER });
    }
    if (u.pathname === "/auth/v1/recover") return json({});
    if (u.pathname === "/auth/v1/signup") return json(USER);
    if (u.pathname === "/auth/v1/user") return json(USER);
    if (u.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

const dlg = (page) => page.getByRole("dialog");
async function fillSignIn(page, pw) {
  await dlg(page).getByLabel("Email").fill("a@example.com");
  await dlg(page).getByLabel("Password").fill(pw);
}
const submit = (page) => page.getByTestId("auth-submit");

test.describe("auth panel — captcha on sign in, forgot password and sign up", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");

  test("sign in: wrong password first, then the right one — the retry uses a FRESH token", async ({ page }) => {
    const calls = []; await mock(page, { calls });
    await page.goto("/?app&auth=signin");
    await fillSignIn(page, "wrong-password");
    await submit(page).click();
    await expect(dlg(page)).toContainText("That email and password don't match.");   // plain words (NEW-1 point 2), never the server's "Invalid login credentials"
    await expect(dlg(page)).not.toContainText(/captcha/i);
    await dlg(page).getByLabel("Password").fill("right-password");
    await submit(page).click();
    await expect(dlg(page)).toHaveCount(0);
    const toks = calls.filter((c) => c.path === "/auth/v1/token").map((c) => c.tok);
    expect(toks).toHaveLength(2);
    expect(toks[0]).toBeTruthy(); expect(toks[1]).toBeTruthy();
    expect(toks[0]).not.toBe(toks[1]);                       // the burnt token was NOT resent
    expect(await page.evaluate(() => window.__ts.resets)).toBeGreaterThanOrEqual(2); // reset after pass AND fail
  });

  test("sign in is quiet: interaction-only, one widget, nothing added to the form", async ({ page }) => {
    await mock(page, { calls: [] });
    await page.goto("/?app&auth=signin");
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window.__ts ? window.__ts.renders.map((r) => r.appearance) : []))).toEqual(["interaction-only"]);
    await expect(dlg(page)).not.toContainText(/verif|captcha|robot/i);
    const btn = submit(page);
    await dlg(page).getByLabel("Email").fill("a@example.com");
    await dlg(page).getByLabel("Password").fill("right-password");
    await expect(btn).toBeEnabled();                          // never greyed out for the token
  });

  test("submit-before-token (Keychain fill + immediate tap): Verifying…, one request when the token lands, no double submit", async ({ page }) => {
    const calls = []; await mock(page, { calls });
    await page.addInitScript(() => { window.__tsNoToken = true; });   // the widget has produced nothing yet
    await page.goto("/?app&auth=signin");
    await fillSignIn(page, "right-password");
    const btn = submit(page);
    await expect(btn).toBeEnabled();                                  // not greyed out while the token loads
    await btn.click();
    await expect(btn).toHaveText("Verifying…");
    await expect(btn).toBeDisabled();
    await dlg(page).getByLabel("Password").press("Enter");
    await dlg(page).getByLabel("Password").press("Enter");
    await page.waitForTimeout(200);
    expect(calls).toHaveLength(0);                                    // nothing sent without a token
    await page.evaluate(() => window.__tsDeliver("tok-late"));        // Cloudflare answers
    await expect(dlg(page)).toHaveCount(0);                           // sent by itself, signed in
    expect(calls).toHaveLength(1);
    expect(calls[0].tok).toBe("tok-late");
  });

  test("forgot password goes through Planyr's own mail route: no Turnstile, no Supabase /recover (NEW-1)", async ({ page }) => {
    const calls = []; await mock(page, { calls });
    await page.goto("/?app&auth=signin");
    await dlg(page).getByText("Forgot password?").click();
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(0);   // nothing for Cloudflare to block
    await dlg(page).getByLabel("Email").fill("a@example.com");
    await submit(page).click();
    await expect(dlg(page).getByTestId("email-link-inbox")).toContainText("Check your inbox at a@example.com. It comes from Planyr (no-reply@planyr.io).");
    await expect(dlg(page)).not.toContainText(/captcha/i);
    expect(calls.filter((c) => c.path === "/auth/v1/recover")).toHaveLength(0);
    const sent = calls.filter((c) => c.path === "/api/auth/email-link");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ email: "a@example.com", purpose: "reset" });
  });

  test("the raw refusal never reaches the screen — sign in and sign up", async ({ page }) => {
    const calls = []; await mock(page, { calls, rawOnly: true });
    await page.goto("/?app&auth=signin");
    await page.waitForTimeout(150);
    await fillSignIn(page, "right-password");
    await submit(page).click();
    await expect(dlg(page)).toContainText("We couldn't verify this browser. Try again.");
    // (Forgot password is not captcha-gated any more — NEW-1 — so there is no refusal to show there.)
    await dlg(page).getByRole("button", { name: "Sign up", exact: true }).click();
    await dlg(page).getByLabel("First name").fill("N"); await dlg(page).getByLabel("Last name").fill("U");
    await fillSignIn(page, "secret123");
    await page.waitForTimeout(150);
    await submit(page).click();
    await expect(dlg(page)).toContainText("We couldn't verify this browser. Try again.");
    for (const bad of [/captcha/i, /disallowed/i, /captcha_token/i]) expect(await dlg(page).innerText()).not.toMatch(bad);
  });

  test("switching Sign in → Forgot password → Sign in → Sign up leaves one live widget and a usable token", async ({ page }) => {
    const calls = []; await mock(page, { calls });
    await page.goto("/?app&auth=signin");
    await dlg(page).getByText("Forgot password?").click();
    await dlg(page).getByRole("button", { name: "← Back to sign in" }).click();
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(1);
    await dlg(page).getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(page.getByTestId("turnstile-widget")).toHaveAttribute("data-turnstile-appearance", "always"); // sign-up keeps its visible box
    await dlg(page).getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect(page.getByTestId("turnstile-widget")).toHaveAttribute("data-turnstile-appearance", "interaction-only");
    await page.waitForTimeout(150);
    await fillSignIn(page, "right-password");
    await submit(page).click();
    await expect(dlg(page)).toHaveCount(0);
    expect(calls.filter((c) => c.path === "/auth/v1/token")[0].tok).toBeTruthy();
  });

  test("a blocked script is never a dead end: plain words, then Try again works", async ({ page }) => {
    const calls = [];
    await mock(page, { calls, scriptOk: false });
    await page.goto("/?app&auth=signin");
    await expect(page.getByTestId("captcha-unavailable")).toBeVisible();
    await expect(page.getByTestId("captcha-unavailable")).toContainText("security check");
    await expect(page.getByTestId("captcha-unavailable")).not.toContainText("We couldn't run the browser check"); // one message only
    await fillSignIn(page, "right-password");
    await submit(page).click();                                // fails fast, does not wait forever
    await expect(submit(page)).not.toHaveText("Verifying…");
    expect(calls).toHaveLength(0);
    // the network comes back
    await page.unroute("**/*");
    await mock(page, { calls });
    await page.getByTestId("captcha-retry").click();
    // NEW-1 point 7: Try again finishes the press that failed — no second press needed.
    await expect(dlg(page)).toHaveCount(0);
    expect(calls.filter((c) => c.path === "/auth/v1/token")).toHaveLength(1);
  });

  test("a check that never returns stops waiting and says so, with a working Try again", async ({ page }) => {
    await page.clock.install();
    const calls = []; await mock(page, { calls });
    await page.addInitScript(() => { window.__tsNoToken = true; });
    await page.goto("/?app&auth=signin");
    await fillSignIn(page, "right-password");
    await submit(page).click();
    await expect(submit(page)).toHaveText("Verifying…");
    await page.clock.fastForward(20000);
    await expect(page.getByTestId("captcha-unavailable")).toBeVisible();
    await expect(submit(page)).not.toHaveText("Verifying…");
    expect(calls).toHaveLength(0);
    await page.evaluate(() => { window.__tsNoToken = false; });
    await page.getByTestId("captcha-retry").click();           // re-renders the widget and finishes the press by itself (NEW-1 point 7)
    await page.clock.runFor(200);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("iPhone-size panel: nothing clipped, the submit button reachable, the panel scrolls when short", async ({ page }) => {
    await mock(page, { calls: [] });
    await page.setViewportSize({ width: 390, height: 420 });  // short: like a phone with the keyboard up
    await page.goto("/?app&auth=signup");
    const panel = dlg(page);
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(420);
    await submit(page).scrollIntoViewIfNeeded();
    const b = await submit(page).boundingBox();
    expect(b.y + b.height).toBeLessThanOrEqual(420);
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight || getComputedStyle(el).overflowY === "auto")).toBe(true);
  });
});

/* NEW-1 (2026-11-02, after B2619760) — the break is REPORTED. Reads the page's own telemetry ring (window.pfTelemetry.recent()):
 * automated runs never write to production (B270912), but every row is built and kept locally, so this proves what the app
 * WOULD send. Nothing here may contain a password or a full email address. */
test.describe("auth telemetry — a broken sign-in reports itself", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");
  const rows = (page) => page.evaluate(() => window.pfTelemetry.recent().map((r) => ({ source: r.source, message: r.message })));
  const sources = async (page) => (await rows(page)).map((r) => r.source);

  test("a blocked bot-check script → auth-captcha-blocked, and the widget publishes why", async ({ page }) => {
    await mock(page, { calls: [], scriptOk: false });
    await page.goto("/?app&auth=signin");
    await expect(page.getByTestId("captcha-unavailable")).toBeVisible();
    await expect(page.getByTestId("turnstile-widget")).toHaveAttribute("data-turnstile-error", "script");
    expect(await sources(page)).toContain("event:auth-captcha-blocked");
  });

  test("wrong password then right password → a wrong-password count and an ok count; domain only, never the password", async ({ page }) => {
    await mock(page, { calls: [] });
    await page.goto("/?app&auth=signin");
    await page.waitForTimeout(150);
    await fillSignIn(page, "typed-bad-pw-123");          // anything but the mock's right password; distinct from the event NAMES
    await submit(page).click();
    await expect(dlg(page)).toContainText("That email and password don't match.");
    await dlg(page).getByLabel("Password").fill("right-password");
    await submit(page).click();
    await expect(dlg(page)).toHaveCount(0);
    const r = await rows(page);
    expect(r.map((x) => x.source)).toEqual(expect.arrayContaining(["event:auth-wrong-password", "event:auth-ok"]));
    const blob = JSON.stringify(r);
    expect(blob).not.toContain("typed-bad-pw-123");            // the typed (wrong) password
    expect(blob).not.toContain("right-password");
    expect(blob).not.toContain("a@example.com");               // the full address
    expect(blob).toContain("example.com");                     // the domain is there
  });

  test("a server refusal of the bot-check token → auth-captcha-refused (the one event that can alarm)", async ({ page }) => {
    await mock(page, { calls: [], rawOnly: true });
    await page.goto("/?app&auth=signin");
    await page.waitForTimeout(150);
    await fillSignIn(page, "right-password");
    await submit(page).click();
    await expect(dlg(page)).toContainText("We couldn't verify this browser. Try again.");
    expect(await sources(page)).toContain("event:auth-captcha-refused");
  });
});
