/* NEW-1 (follow-up to B2619760) — the sign-in panel has no dead ends and no raw errors. Drives the
 * REAL built app with Supabase's auth endpoints AND Cloudflare's Turnstile script mocked
 * (e2e/lib/authMock.js), so it needs a build with dummy config baked in:
 *
 *   VITE_SUPABASE_URL="https://authcaptcha1.supabase.co" VITE_SUPABASE_ANON_KEY="authcaptcha1-dummy" \
 *   VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" npx playwright test e2e/auth-dead-ends.spec.js
 *
 * Runs in the chromium project AND, with PW_WEBKIT_PHONE=1, in mobile WebKit at iPhone size.
 * One test per numbered point of the brief (1–9); every one was RED on main c195614 before the fix.
 * What this cannot prove (a real Cloudflare token, a real password manager, real e-mail links, a real
 * on-screen keyboard) is listed in the V-entry on the item, not claimed here. */
import { test, expect } from "@playwright/test";
import { mockAuth, dlg, submit, fillSignIn, HOST, SITE_KEY, STORAGE_KEY, sessionFor, siteRow } from "./lib/authMock.js";
import { readFileSync } from "node:fs";

const EXPIRED = "That link has expired. Send yourself a new one.";
const unknownPatterns = [/captcha/i, /AuthApiError/i, /AuthRetryableFetchError/i, /Failed to fetch/i, /Load failed/i, /over_request_rate_limit/, /over_email_send_rate_limit/, /user_already_exists/, /User already registered/i, /Invalid login credentials/, /Auth session missing/i, /Password should be/i, /unexpected_failure/, /Database error/i, /\[object Object\]/];
const noRaw = async (page) => { const t = await dlg(page).innerText(); for (const p of unknownPatterns) expect(t).not.toMatch(p); };

test.describe("auth panel — no dead ends (NEW-1)", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");

  // ── 1. a dead reset link ────────────────────────────────────────────────────────────────────
  test("1. an expired or used reset link opens Forgot password with a plain message, and the bar is cleaned", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page)).toContainText(EXPIRED);
    await expect(dlg(page).getByRole("heading", { name: "Reset password" })).toBeVisible();
    expect(await page.evaluate(() => location.hash)).not.toMatch(/error/);
    await dlg(page).getByLabel("Email").fill("a@example.com");
    await page.waitForTimeout(150);
    await submit(page).click();
    await expect(dlg(page)).toContainText("reset");
    expect(m.calls.filter((c) => c.path === "/auth/v1/recover")).toHaveLength(1);
  });

  test("1b. a different link error still lands somewhere with a next step (and the query-string form too)", async ({ page }) => {
    await mockAuth(page);
    await page.goto("/?app&error=access_denied&error_code=something_else&error_description=nope#/site");
    await expect(dlg(page)).toContainText("That link didn't work. Send yourself a new one.");
    await expect(dlg(page).getByLabel("Email")).toBeVisible();
    expect(await page.evaluate(() => location.search + location.hash)).not.toMatch(/error/);
  });

  // ── 2. raw server text ──────────────────────────────────────────────────────────────────────
  test("2a. a network failure says it could not reach Planyr and Try again re-sends", async ({ page }) => {
    const m = await mockAuth(page);
    let down = true;
    m.cfg.respond = (u) => (down && u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "password" ? "abort" : undefined);
    await page.goto("/?app&auth=signin");
    await fillSignIn(page, "right-password");
    await page.waitForTimeout(150);
    await submit(page).click();
    await expect(dlg(page)).toContainText("couldn't reach Planyr");
    await noRaw(page);
    down = false;
    await dlg(page).getByRole("button", { name: "Try again" }).click();
    await expect(dlg(page)).toHaveCount(0);
  });

  test("2b. rate limits, existing account, wrong password, weak password, unknown — plain words, each with a next step", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app&auth=signin");
    await page.waitForTimeout(150);
    const answer = (status, body) => { m.cfg.respond = (u) => (/^\/auth\/v1\/(token|signup|recover)$/.test(u.pathname) && u.searchParams.get("grant_type") !== "refresh_token" ? { status, json: body } : undefined); };
    const press = async () => { await page.waitForTimeout(120); await submit(page).click(); };
    await fillSignIn(page, "whatever1");

    answer(429, { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" });
    await press();
    await expect(dlg(page)).toContainText("Wait a minute");
    await expect(dlg(page)).toContainText("shared office");
    await noRaw(page);

    answer(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    await press();
    await expect(dlg(page)).toContainText("don't match");
    await expect(dlg(page).getByRole("button", { name: "Reset your password" })).toBeVisible();
    await noRaw(page);
    await dlg(page).getByRole("button", { name: "Reset your password" }).click();
    await expect(dlg(page).getByLabel("Email")).toHaveValue("a@example.com");   // the address is kept
    answer(429, { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" });
    await press();
    await expect(dlg(page)).toContainText("several emails");
    await noRaw(page);

    await dlg(page).getByRole("button", { name: "← Back to sign in" }).click();
    await dlg(page).getByRole("button", { name: "Sign up", exact: true }).click();
    await dlg(page).getByLabel("First name").fill("N"); await dlg(page).getByLabel("Last name").fill("U");
    await fillSignIn(page, "secret123");
    answer(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    await press();
    await expect(dlg(page)).toContainText("already exists");
    await noRaw(page);
    await dlg(page).getByRole("button", { name: "Sign in instead" }).click();
    await expect(dlg(page).getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(dlg(page).getByLabel("Email")).toHaveValue("a@example.com");   // one tap, address kept

    await dlg(page).getByRole("button", { name: "Sign up", exact: true }).click();
    await dlg(page).getByLabel("First name").fill("N"); await dlg(page).getByLabel("Last name").fill("U");
    answer(422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters.", weak_password: { reasons: ["length"] } });
    await press();
    await expect(dlg(page)).toContainText("too weak");
    await noRaw(page);

    answer(500, { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" });
    await press();
    await expect(dlg(page)).toContainText("support@planyr.io");
    await noRaw(page);

    answer(400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
    await dlg(page).getByRole("button", { name: "Sign in", exact: true }).first().click();
    await press();
    await expect(dlg(page)).toContainText("Confirm your email");
    await noRaw(page);
  });

  test("2c. an empty email on Enter says what is missing instead of doing nothing", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app&auth=signin");
    await dlg(page).getByLabel("Password").fill("right-password");
    await dlg(page).getByLabel("Password").press("Enter");
    await expect(dlg(page)).toContainText("Enter your email address.");
    expect(m.calls).toHaveLength(0);
    await dlg(page).getByLabel("Email").fill("a@example.com");
    await dlg(page).getByLabel("Password").fill("");
    await submit(page).click();
    await expect(dlg(page)).toContainText("Enter your password.");
    expect(m.calls).toHaveLength(0);
  });

  // ── 3. password managers ────────────────────────────────────────────────────────────────────
  test("3. a real <form>: values the page never heard about (autofill) still submit; Enter works from either field; the button is not grey", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app&auth=signin");
    await expect(dlg(page).locator("form")).toHaveCount(1);
    // The fields keep the values a password manager keys on.
    await expect(dlg(page).getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(dlg(page).getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(submit(page)).toBeEnabled();                                  // empty form: not greyed out
    await page.waitForTimeout(150);
    // Fill the DOM directly, with NO input/change events — what a password manager may do.
    await page.evaluate(() => {
      const set = (label, v) => { const el = document.querySelector(`[role=dialog] input[aria-label="${label}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); };
      set("Email", "a@example.com"); set("Password", "right-password");
    });
    await expect(submit(page)).toBeEnabled();
    await dlg(page).getByLabel("Email").press("Enter");                        // Enter from the EMAIL field
    await expect(dlg(page)).toHaveCount(0);
    const rec = m.calls.filter((c) => c.path === "/auth/v1/token");
    expect(rec).toHaveLength(1);
    expect(rec[0].body.email).toBe("a@example.com");
    expect(rec[0].body.password).toBe("right-password");
  });

  // ── 4. bad-signal boot ──────────────────────────────────────────────────────────────────────
  test("4. expired token + no network at boot: no 'Sign in' pill while a session is stored; when it recovers Site switches to the signed-in store", async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(([k, s]) => {
      localStorage.setItem(k, s);
      window.__authEvents = []; window.__sawSignIn = false;
      const iv = setInterval(() => { if (window.pfSupabase) { clearInterval(iv); window.pfSupabase.auth.onAuthStateChange((e, ses) => window.__authEvents.push([e, !!ses])); } }, 5);
      new MutationObserver(() => { if (document.querySelector('[data-testid="account-signed-out"]')) window.__sawSignIn = true; }).observe(document, { subtree: true, childList: true });
    }, [STORAGE_KEY, JSON.stringify(sessionFor(undefined, { expiresAt: 1 }))]);
    const m = await mockAuth(page, { cfg: { refreshOk: false } });
    await page.goto("/?app#/site");
    await expect(page.getByTestId("account-auth-pending").first()).toBeVisible();
    for (let i = 0; i < 16; i++) await page.clock.runFor(5000);                 // supabase-js retries ~40 s, then reports "no session yet"
    // Known-good arm: the scenario really happened — the app was told "no session" while one is still stored.
    expect(await page.evaluate(() => window.__authEvents)).toContainEqual(["INITIAL_SESSION", false]);
    expect(await page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);
    expect(m.calls.filter((c) => c.refresh).length).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.__sawSignIn)).toBe(false);          // never rendered as signed out
    await expect(page.getByTestId("account-signed-out")).toHaveCount(0);
    await expect(page.getByTestId("account-reconnecting")).toBeVisible();        // not a dead end: it says what it is doing and can be pressed
    expect(m.rest.filter((p) => p.startsWith("/rest/v1/sites"))).toHaveLength(0);
    m.cfg.refreshOk = true;                                                      // the network is back; the next refresh succeeds on its own
    for (let i = 0; i < 8; i++) await page.clock.runFor(5000);
    expect(await page.evaluate(() => window.__authEvents.map((e) => e[0]))).toContain("TOKEN_REFRESHED");
    await expect(page.getByTestId("account-signed-out")).toHaveCount(0);
    await expect.poll(() => m.rest.filter((p) => p.startsWith("/rest/v1/sites")).length).toBeGreaterThan(0);   // Site pulled the signed-in store
  });

  // ── 5. a real sign-out ──────────────────────────────────────────────────────────────────────
  test("5. a dead session says so, keeps the route, and a deliberate sign-out shows nothing", async ({ page }) => {
    await page.addInitScript(([k, s]) => { localStorage.setItem(k, s); }, [STORAGE_KEY, JSON.stringify(sessionFor())]);
    const m = await mockAuth(page, { cfg: { sites: [siteRow()] } });
    await page.goto("/?app#/project/smtestgroup01/site");
    await expect(page.getByTestId("account-signed-out")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!(window.pfSupabase))).toBe(true);
    // The server revokes the refresh token behind our back.
    m.cfg.respond = (u) => (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token" ? { status: 400, json: { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" } } : undefined);
    await page.evaluate(() => window.pfSupabase.auth.refreshSession().catch(() => {}));
    await expect(page.getByTestId("signed-out-notice")).toContainText("You were signed out. Sign in to continue.");
    expect(await page.evaluate(() => location.hash)).toContain("/project/smtestgroup01");     // the route is kept
    await page.getByTestId("signed-out-notice").getByRole("button", { name: "Sign in" }).click();
    await expect(dlg(page)).toBeVisible();
    await fillSignIn(page, "right-password");
    m.cfg.respond = null;
    await page.waitForTimeout(150);
    await submit(page).click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.getByTestId("signed-out-notice")).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toContain("/project/smtestgroup01");     // and still there after sign-in
    // Deliberate sign-out: no notice.
    await page.evaluate(() => window.pfSupabase.auth.getSession());
    await page.getByRole("button", { name: /^Account:/ }).first().click();
    await page.getByText("Sign out", { exact: true }).first().click();
    await expect(page.getByTestId("account-signed-out").first()).toBeVisible();
    await expect(page.getByTestId("signed-out-notice")).toHaveCount(0);
  });

  // ── 6. the set-new-password form ────────────────────────────────────────────────────────────
  test("6. a recovery link opens a form that cannot be dismissed; a failed update stays with a plain reason", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app#access_token=recov-tok&refresh_token=ref&expires_in=3600&token_type=bearer&type=recovery");
    await expect(dlg(page).getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(dlg(page).getByRole("button", { name: /close/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(2, 2);                                              // the backdrop
    await expect(dlg(page).getByRole("heading", { name: "Set a new password" })).toBeVisible();
    m.cfg.respond = (u, body, req) => (u.pathname === "/auth/v1/user" && req.method() === "PUT" ? { status: 422, json: { code: 422, error_code: "same_password", msg: "New password should be different from the old password." } } : undefined);
    await dlg(page).getByLabel("New password").fill("old-password");
    await dlg(page).getByLabel("New password").press("Enter");
    await expect(dlg(page)).toContainText("different from your current");
    await expect(dlg(page).getByRole("heading", { name: "Set a new password" })).toBeVisible();   // still on the form
    await noRaw(page);
    m.cfg.respond = null;
    await dlg(page).getByLabel("New password").fill("a-new-password");
    await submit(page).click();
    await expect(dlg(page)).toContainText("Password updated");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("6b. a recovery whose session is gone says the link expired and offers a new one", async ({ page }) => {
    const m = await mockAuth(page);
    await page.goto("/?app#access_token=recov-tok&refresh_token=ref&expires_in=3600&token_type=bearer&type=recovery");
    await expect(dlg(page).getByRole("heading", { name: "Set a new password" })).toBeVisible();
    m.cfg.respond = (u, body, req) => (u.pathname === "/auth/v1/user" && req.method() === "PUT" ? { status: 401, json: { code: 401, error_code: "session_not_found", msg: "Auth session missing!" } } : undefined);
    await dlg(page).getByLabel("New password").fill("a-new-password");
    await submit(page).click();
    await expect(dlg(page)).toContainText(EXPIRED);
    await dlg(page).getByRole("button", { name: "Send a new link" }).click();
    await expect(dlg(page).getByRole("heading", { name: "Reset password" })).toBeVisible();
  });

  // ── 7. gate edge cases ──────────────────────────────────────────────────────────────────────
  test("7a. after Cloudflare's own timeout the next press does not wait with no clock; Try again finishes the pending submit by itself", async ({ page }) => {
    const m = await mockAuth(page);
    await page.addInitScript(() => { window.__tsNoToken = true; });
    await page.goto("/?app&auth=signin");
    await expect.poll(() => page.evaluate(() => (window.__ts ? window.__ts.renders.length : 0))).toBe(1);
    await page.evaluate(() => { window.__tsInteractive(); window.__tsTimeout(); });
    await fillSignIn(page, "right-password");
    await submit(page).click();                                                // press AFTER the timeout
    await expect(page.getByTestId("captcha-unavailable")).toBeVisible();      // fails fast, with the way out
    await expect(submit(page)).not.toHaveText("Verifying…");
    expect(m.calls).toHaveLength(0);
    await page.evaluate(() => { window.__tsNoToken = false; });
    await page.getByTestId("captcha-retry").click();
    await expect(dlg(page)).toHaveCount(0);                                    // sent by itself, signed in
    expect(m.calls.filter((c) => c.path === "/auth/v1/token")).toHaveLength(1);
  });

  test("7b. the widget is size 'flexible' and a visible challenge keeps Sign in on screen with the keyboard up", async ({ page, viewport }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: 360, height: 360 });                   // a small phone with the keyboard up
    await page.goto("/?app&auth=signin");
    await expect.poll(() => page.evaluate(() => (window.__ts ? window.__ts.renders.map((r) => r.size) : []))).toEqual(["flexible"]);
    await page.evaluate(() => window.__tsInteractive());
    await expect(page.getByTestId("turnstile-widget")).toHaveAttribute("data-turnstile-state", "interactive");
    await expect.poll(async () => { const b = await submit(page).boundingBox(); return b && b.y >= 0 && b.y + b.height <= 360; }).toBe(true);
    if (viewport) await page.setViewportSize(viewport);
  });

  // ── 8. stale directions ─────────────────────────────────────────────────────────────────────
  test("8. standalone /sequence/ has a working way to the sign-in panel (the page says 'sign in above' no more)", async () => {
    const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/sign in above/);
    expect(html).toContain('data-testid="sequence-signin-link"');
    expect(html).toContain('href="/?app&auth=signin#/schedule"');           // the Shell opens the panel from ?auth=signin
  });

  test("8b. no screen tells anyone to sign in 'from the Site Planner' and the minimum password length has one home", async () => {
    const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    expect(read("src/workspaces/library/components/FileBrowser.jsx")).not.toMatch(/sign in from the Site Planner/);
    expect(read("src/workspaces/doc-review/components/ReviewsBar.jsx")).not.toMatch(/in the Site Planner workspace/);
    expect(read("src/workspaces/site-planner/components/AuthPanel.jsx")).not.toMatch(/pw\.length (>=|<) 6/);
  });
});

test.describe("www host", () => {
  test("9. index.html sends www.planyr.io to planyr.io before anything else runs, keeping path, query and hash", async () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const m = html.match(/<script>\s*\(function \(\) \{\s*\/\/ www redirect[\s\S]*?<\/script>/);
    expect(m).toBeTruthy();
    const src = m[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
    const run = (hostname) => { const out = []; const location = { hostname, pathname: "/", search: "?app", hash: "#access_token=abc&type=recovery", replace: (u) => out.push(u) }; new Function("location", "window", src)(location, { location }); return out; };
    expect(run("www.planyr.io")).toEqual(["https://planyr.io/?app#access_token=abc&type=recovery"]);
    expect(run("planyr.io")).toEqual([]);
    expect(run("localhost")).toEqual([]);
    expect(html.indexOf("// www redirect")).toBeLessThan(html.indexOf("Front door"));   // first script of the page
  });
});
