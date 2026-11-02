/* NEW-1 — "Planyr emails you a sign-in / reset link": every state from "I can't get in" to "I'm in".
 * Drives the real built app with Supabase's auth endpoints, Cloudflare's Turnstile script and Planyr's own
 * /api/auth/email-link route MOCKED (the route itself is unit-tested in test/emailLinkRoute.test.js and the live
 * pass is V-entry NEW-1). Needs a build with dummy Supabase + Turnstile config baked in:
 *
 *   VITE_SUPABASE_URL="https://authlink1.supabase.co" VITE_SUPABASE_ANON_KEY="authlink1-dummy" \
 *   VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" npx playwright test e2e/auth-email-link.spec.js
 *
 * What it proves that a unit test cannot: opening the link spends NOTHING (no /verify until the button), the reset
 * form opens by itself and cannot be dismissed, a blocked Turnstile script still leaves a way in, and a page reload
 * during a pending reset brings the form back. */
import { test, expect } from "@playwright/test";
import { accountHint } from "../src/shared/auth/authLink.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : "";
const SITE_KEY = process.env.VITE_TURNSTILE_SITE_KEY || "";
const STORAGE_KEY = HOST ? `sb-${HOST.split(".")[0]}-auth-token` : "";
const TOKEN = "t".repeat(56);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const user = (id, email) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const ME = user("00000000-0000-4000-8000-0000000000aa", "me@example.com");
const OTHER = user("00000000-0000-4000-8000-0000000000bb", "other@example.com");
const session = (u) => ({ access_token: jwt(u.id), refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: u });

const FAKE_TURNSTILE = `(function(){var n=0,w={};window.turnstile={render:function(el,o){var id="w"+(++n);w[id]=o;setTimeout(function(){o.callback("tok-"+(++n));},30);return id;},reset:function(id){if(w[id])setTimeout(function(){w[id].callback("tok-"+(++n));},30);},remove:function(id){delete w[id];}};})();`;

/* One mock for everything. `world.verify` decides what /verify answers; `world.link` what the mail route answers. */
async function mock(page, world) {
  world.calls = world.calls || [];
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    const body = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch (_) { return {}; } })();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/api/auth/email-link") {
      world.calls.push({ path: u.pathname, body });
      const r = world.link ? world.link(body) : { status: 200, body: { ok: true, retryAfterSeconds: 60, expiresMinutes: 60 } };
      return json(r.body, r.status);
    }
    if (u.pathname === "/api/auth/mailbox-proof") {   // the server records "this mailbox is proven" after a redeemed emailed link
      world.calls.push({ path: u.pathname, auth: route.request().headers()["authorization"] || "" });
      const r = world.proof ? world.proof() : { status: 200, body: { ok: true } };
      return json(r.body, r.status);
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname === "challenges.cloudflare.com") {
      if (world.blockTurnstile) return route.abort();
      return route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_TURNSTILE });
    }
    if (u.hostname !== HOST) return route.abort();
    if (u.pathname === "/auth/v1/verify") {
      world.calls.push({ path: u.pathname, body });
      const v = world.verify ? world.verify(body, world.calls.filter((c) => c.path === u.pathname).length) : null;
      if (v === "abort") return route.abort();
      if (v) return json(v.body, v.status);
      return json(session(world.verifiesTo || ME));
    }
    if (u.pathname === "/auth/v1/user") {
      world.calls.push({ path: u.pathname, method: route.request().method(), body });
      return json(world.verifiesTo || ME);
    }
    if (u.pathname === "/auth/v1/token") return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
    if (u.pathname.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}
const verifyCalls = (w) => w.calls.filter((c) => c.path === "/auth/v1/verify");
const proofCalls = (w) => w.calls.filter((c) => c.path === "/api/auth/mailbox-proof");
const dlg = (page) => page.getByRole("dialog");
const landing = (page) => page.getByTestId("auth-link-landing");
const seed = (page, u) => page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} }, [STORAGE_KEY, session(u)]);
async function linkUrl(kind, u, extra = "") { return `/?app&authlink=${TOKEN}&kind=${kind}&h=${await accountHint(u.email)}${extra}`; }

test.describe("emailed sign-in / reset link — every state has a next step", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");

  test("1 can't get in → Forgot password: Planyr's page, no Turnstile, the inbox line, a Send again that counts down", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await dlg(page).getByText("Forgot password?").click();
    await expect(page.getByTestId("turnstile-widget")).toHaveCount(0);
    await dlg(page).getByLabel("Email").fill("me@example.com");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("email-link-inbox")).toHaveText("Check your inbox at me@example.com. It comes from Planyr (no-reply@planyr.io).");
    await expect(dlg(page)).toContainText("1 hour");
    await expect(dlg(page)).toContainText("spam");
    await expect(dlg(page)).toContainText("support@planyr.io");
    await expect(page.getByTestId("email-link-resend")).toBeDisabled();
    await expect(page.getByTestId("email-link-resend")).toHaveText(/Send again in 0:\d\d/);
    expect(w.calls.filter((c) => c.path === "/api/auth/email-link")[0].body).toEqual({ email: "me@example.com", purpose: "reset" });
  });

  test("2 Forgot password with the route down: plain words, support address, and it never says an email went out", async ({ page }) => {
    const w = { link: () => ({ status: 503, body: { ok: false, reason: "unavailable" } }) }; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await dlg(page).getByText("Forgot password?").click();
    await dlg(page).getByLabel("Email").fill("me@example.com");
    await page.getByTestId("auth-submit").click();
    await expect(dlg(page)).toContainText("no email was sent");
    await expect(dlg(page)).toContainText("support@planyr.io");
    await expect(page.getByTestId("email-link-sent")).toHaveCount(0);
    await expect(dlg(page)).not.toContainText("Check your inbox");
  });

  test("3 blocked Turnstile script: the network line, the sign-in link is the main action, and it gets you to the sent view", async ({ page }) => {
    const w = { blockTurnstile: true }; await mock(page, w);
    await page.goto("/?app&auth=signin");
    await expect(page.getByTestId("captcha-blocked-note")).toContainText("network blocked");
    const btn = page.getByTestId("email-link-signin");
    await expect(btn).toBeVisible();
    await dlg(page).getByLabel("Email").fill("me@example.com");
    // primary = the filled accent button; Sign in is demoted
    const bg = (el) => el.evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(await bg(btn)).not.toBe(await bg(page.getByTestId("auth-submit")));
    await btn.click();
    await expect(page.getByTestId("email-link-inbox")).toContainText("me@example.com");
    expect(w.calls.filter((c) => c.path === "/api/auth/email-link")[0].body).toMatchObject({ purpose: "signin" });
    await expect(dlg(page)).not.toContainText(/phone|cellular|mobile data/i);
  });

  test("3b the link button is always there, even when the check works", async ({ page }) => {
    await mock(page, {});
    await page.goto("/?app&auth=signin");
    await expect(page.getByTestId("email-link-signin")).toBeVisible();
    await expect(page.getByTestId("captcha-blocked-note")).toHaveCount(0);
  });

  test("4 opening the link spends nothing; the one button signs in on THIS device, on the route they started from", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto(await linkUrl("signin", ME, "&next=%2Flibrary"));
    await expect(page.getByTestId("auth-link-state-ready")).toBeVisible();
    await page.waitForTimeout(400);
    expect(verifyCalls(w)).toHaveLength(0);                    // a scanner opening the page spends nothing
    await expect(page.getByTestId("auth-link-continue")).toHaveText("Continue to Planyr");
    await page.getByTestId("auth-link-continue").click();
    await expect(landing(page)).toHaveCount(0);
    expect(verifyCalls(w)).toHaveLength(1);
    expect(verifyCalls(w)[0].body).toMatchObject({ token_hash: TOKEN, type: "magiclink" });
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/library");
    await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);
    expect(await page.evaluate(() => window.location.search)).not.toContain("authlink");
    await expect.poll(() => proofCalls(w).length).toBe(1);                 // redeeming the emailed link proves the mailbox — once
    expect(proofCalls(w)[0].auth).toMatch(/^Bearer ey/);                    // with the session it just got, not anything typed
  });

  test("4b a mailbox-proof failure never blocks getting in (it is reported, not shown)", async ({ page }) => {
    const w = { proof: () => ({ status: 502, body: { ok: false, reason: "unavailable" } }) }; await mock(page, w);
    await page.goto(await linkUrl("signin", ME));
    await page.getByTestId("auth-link-continue").click();
    await expect(landing(page)).toHaveCount(0);
    await expect.poll(() => proofCalls(w).length).toBe(1);
    await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);   // still signed in
  });

  test("5 reset link: the button, then the set-new-password form opens BY ITSELF and cannot be dismissed; a reload brings it back; done closes it", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto(await linkUrl("reset", ME));
    await expect(page.getByTestId("auth-link-continue")).toHaveText("Set a new password");
    await page.getByTestId("auth-link-continue").click();
    await expect(verifyCalls(w)[0].body).toMatchObject({ token_hash: TOKEN, type: "recovery" });
    await expect(page.getByTestId("recovery-form")).toBeVisible();
    await expect.poll(() => proofCalls(w).length).toBe(1);                 // a reset link proves the mailbox too
    // not dismissable: Escape, a click outside, and there is no Close button
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(page.getByTestId("recovery-form")).toBeVisible();
    await expect(dlg(page).getByRole("button", { name: /close/i })).toHaveCount(0);
    // reload mid-way: still pending, still signed in → the form returns
    await page.reload();
    await expect(page.getByTestId("recovery-form")).toBeVisible();
    await dlg(page).getByLabel("New password").fill("a-brand-new-password");
    await page.getByTestId("recovery-submit").click();
    await expect(dlg(page)).toHaveCount(0, { timeout: 5000 });
    expect(w.calls.some((c) => c.path === "/auth/v1/user" && c.method === "PUT" && c.body.password === "a-brand-new-password")).toBe(true);
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("recovery-form")).toHaveCount(0);   // cleared once done
  });

  test("5b reset form: 'Sign out instead' is the way out that leaves the password unchanged", async ({ page }) => {
    const w = {}; await mock(page, w);
    await page.goto(await linkUrl("reset", ME));
    await page.getByTestId("auth-link-continue").click();
    await page.getByTestId("recovery-signout").click();
    await expect(page.getByTestId("recovery-form")).toHaveCount(0);
    await page.reload(); await page.waitForTimeout(500);
    await expect(page.getByTestId("recovery-form")).toHaveCount(0);
  });

  test("6 expired or already-used: says so, 'Send me a new link' is right there, and the address is pre-filled only from THIS device", async ({ page }) => {
    const w = { verify: () => ({ status: 403, body: { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" } }) }; await mock(page, w);
    await page.addInitScript(() => { try { localStorage.setItem("planyr:auth:lastLinkEmail", "me@example.com"); } catch (_) {} });
    await page.goto(await linkUrl("signin", ME));
    await page.getByTestId("auth-link-continue").click();
    await expect(page.getByTestId("auth-link-title")).toContainText("expired or was already used");
    expect(proofCalls(w)).toHaveLength(0);                                   // a refused link proves nothing
    await page.getByTestId("auth-link-resend").click();
    await expect(page.getByTestId("auth-link-email")).toHaveValue("me@example.com");
    expect(page.url()).not.toContain("me%40"); expect(page.url()).not.toContain("me@");
    await page.getByTestId("auth-link-resend-submit").click();
    await expect(page.getByTestId("email-link-inbox")).toContainText("me@example.com");
    expect(w.calls.filter((c) => c.path === "/api/auth/email-link")[0].body).toMatchObject({ purpose: "signin" });
  });

  test("6b on a device that never asked: the 'new link' form is empty, not guessed", async ({ page }) => {
    const w = { verify: () => ({ status: 403, body: { error_code: "otp_expired", msg: "Email link is invalid or has expired" } }) }; await mock(page, w);
    await page.goto(await linkUrl("reset", ME));
    await page.getByTestId("auth-link-continue").click();
    await page.getByTestId("auth-link-resend").click();
    await expect(page.getByTestId("auth-link-email")).toHaveValue("");
    await expect(page.getByTestId("auth-link-resend-submit")).toBeDisabled();
  });

  test("7 malformed link: says it looks incomplete and offers a new one + sign in — and never calls verify", async ({ page }) => {
    const w = {}; await mock(page, w);
    for (const url of ["/?app&authlink=short&kind=signin", `/?app&authlink=${TOKEN}`, "/?app&authlink=&kind=reset"]) {
      await page.goto(url);
      await expect(page.getByTestId("auth-link-state-malformed")).toBeVisible();
      await expect(page.getByTestId("auth-link-resend")).toBeVisible();
      await expect(page.getByTestId("auth-link-signin")).toBeVisible();
      await expect(page.getByTestId("auth-link-continue")).toHaveCount(0);
    }
    expect(verifyCalls(w)).toHaveLength(0);
    await page.goto(`/?app&authlink=${TOKEN}`);                                           // no kind at all
    await page.getByTestId("auth-link-resend").click();
    await expect(page.getByRole("button", { name: "Password reset" })).toBeVisible();    // kind unknown → the person picks
  });

  test("8 network failure on the button press: 'Couldn't reach Planyr', Try again works and signs in", async ({ page }) => {
    const w = { verify: (b, n) => (n === 1 ? "abort" : null) }; await mock(page, w);
    await page.goto(await linkUrl("signin", ME));
    await page.getByTestId("auth-link-continue").click();
    await expect(page.getByTestId("auth-link-title")).toHaveText("Couldn’t reach Planyr");
    await page.getByTestId("auth-link-retry").click();
    await expect(landing(page)).toHaveCount(0);
    expect(verifyCalls(w)).toHaveLength(2);
    await expect.poll(() => proofCalls(w).length).toBe(1);                   // only the successful redemption proves the mailbox
  });

  test("9 verify rate limit: asks them to wait, keeps the link, Try again works", async ({ page }) => {
    const w = { verify: (b, n) => (n === 1 ? { status: 429, body: { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" } } : null) }; await mock(page, w);
    await page.goto(await linkUrl("signin", ME));
    await page.getByTestId("auth-link-continue").click();
    await expect(page.getByTestId("auth-link-title")).toContainText("Too many tries");
    await expect(page.getByTestId("auth-link-resend")).toBeVisible();
    await page.getByTestId("auth-link-retry").click();
    await expect(landing(page)).toHaveCount(0);
  });

  test("10 already signed in as the SAME account: says so, one button, signs in without a swap warning", async ({ page }) => {
    const w = {}; await mock(page, w); await seed(page, ME);
    await page.goto(await linkUrl("signin", ME));
    await expect(page.getByTestId("auth-link-state-same-account")).toContainText("me@example.com");
    await page.getByTestId("auth-link-continue").click();
    await expect(landing(page)).toHaveCount(0);
  });

  test("11 signed in as a DIFFERENT account: named, Switch or Stay — nothing is spent until they choose", async ({ page }) => {
    const w = { verifiesTo: OTHER }; await mock(page, w); await seed(page, ME);
    await page.goto(await linkUrl("signin", OTHER));
    const st = page.getByTestId("auth-link-state-different-account");
    await expect(st).toContainText("me@example.com");
    await expect(page.getByTestId("auth-link-continue")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(verifyCalls(w)).toHaveLength(0);
    await page.getByTestId("auth-link-stay").click();                 // stay: nothing spent, still me
    await expect(landing(page)).toHaveCount(0);
    expect(verifyCalls(w)).toHaveLength(0);
    // and the other branch: switch
    await page.goto(await linkUrl("signin", OTHER));
    await page.getByTestId("auth-link-switch").click();
    await expect(landing(page)).toHaveCount(0);
    expect(verifyCalls(w)).toHaveLength(1);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).user.email, STORAGE_KEY)).toBe("other@example.com");
  });

  test("12 a hint that wrongly matched is caught after the fact: the swap is SAID, not silent", async ({ page }) => {
    const w = { verifiesTo: OTHER }; await mock(page, w); await seed(page, ME);
    await page.goto(await linkUrl("signin", ME));                      // link claims to be ME's, but the token is OTHER's
    await page.getByTestId("auth-link-continue").click();
    await expect(page.getByTestId("auth-link-swapped")).toContainText("other@example.com instead of me@example.com");
  });
});
