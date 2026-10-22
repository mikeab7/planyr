/* signedInSession — THE ONE shared sign-in for any session/harness that must verify a change
 * signed in as the throwaway test account (e2e@planyr.test) against a real deploy.
 *
 * Owner decision 2026-10-04: a session's own live signed-in check on the test account COUNTS as
 * verified. `Blocker: auth` no longer parks a check.
 *
 * HOW IT SIGNS IN (NEW-1): Supabase Turnstile captcha blocks password sign-in headlessly, so when
 * E2E_LOGIN_KEY is set this POSTs it (header, never URL) to the deploy's own /api/auth/e2e-session
 * — a route that can only ever mint a session for the test account (functions/api/auth/e2e-session.js)
 * — and hands the returned tokens to the page's Supabase client (`window.pfSupabase.auth.setSession`).
 * The fetch runs INSIDE the page (same-origin), so it uses Chromium's trust store, not Node's.
 * A route that answers 404 means E2E_LOGIN_KEY is not set on that deploy (or is wrong) — reported as such.
 * Without E2E_LOGIN_KEY it falls back to E2E_EMAIL/E2E_PASSWORD (which captcha will currently refuse).
 *
 * SIGNED-IN PROOF is never "the module tabs are visible" (they show signed out too): it is the
 * Supabase user's email === the test account AND the fixture site row (e2e-fixture-site), which RLS
 * only returns to its owner.
 *
 * Trust: the sandbox egress proxy re-signs HTTPS with its own CA, imported into $HOME/.pki/nssdb by
 * the environment setup script. NEVER pass --ignore-certificate-errors* flags (owner-ruled-out).
 *
 * Usage:
 *   const s = await openSignedIn({ base: "https://planyr.io" });   // or a *.planyr.pages.dev preview
 *   ... s.page ...; console.log(s.build, s.proof);  await s.close();
 */
import { chromium, webkit, devices } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export const FIXTURE_SITE_ID = "e2e-fixture-site";
export const TEST_ACCOUNT_EMAIL = "e2e@planyr.test";
/* B2244017 — the second pinned test account (the route's `x-e2e-account: teammate`), for checks that need
 * two people on one team. It owns no fixture, so its proof is the email alone. */
export const TEAMMATE_ACCOUNT_EMAIL = "e2e-teammate@planyr.test";
export const ACCOUNT_EMAILS = Object.freeze({ primary: TEST_ACCOUNT_EMAIL, teammate: TEAMMATE_ACCOUNT_EMAIL });
const emailFor = (account) => { const e = ACCOUNT_EMAILS[account]; if (!e) throw new Error("signedInSession: unknown account " + account); return e; };

/** Pure: turn a route response into a readable failure, or null when it is a usable session. */
export function routeFailure(status, body) {
  if (status === 404) return "e2e-session route answered 404 — E2E_LOGIN_KEY is not set (or is wrong) on that deploy";
  if (status === 405) return "e2e-session route answered 405 (wrong method)";
  if (status !== 200) {
    const why = body && [body.error, body.stage && `stage ${body.stage}`, body.upstream_status && `upstream ${body.upstream_status}`, body.upstream_error, body.network_error].filter(Boolean).join(", ");
    return `e2e-session route answered ${status}${why ? " — " + why : ""}`;
  }
  if (!body || !body.access_token || !body.refresh_token) return "e2e-session route answered 200 without tokens";
  return null;
}

/* SESSION CACHE (B2154049): minting a fresh sign-in per check hammers Supabase admin generate_link and was
 * the load that coincided with the 502 stretches. The test account's session is cached on disk (mode 0600,
 * tokens only ever in this file — never printed) and reused: supabase-js refreshes it on setSession, and the
 * refreshed pair is written back. The route is only called when there is no usable cache. */
export const sessionCachePath = (account = "primary") => account === "primary"
  ? (process.env.E2E_SESSION_CACHE || join(tmpdir(), "planyr-e2e-session.json"))
  : join(tmpdir(), `planyr-e2e-session-${account}.json`);

/** Pure: is this cached record worth trying? (shape + a refresh token; expiry is handled by the refresh.) */
export function cacheUsable(c, nowSec = Math.floor(Date.now() / 1000), email = TEST_ACCOUNT_EMAIL) {
  return !!(c && typeof c.access_token === "string" && typeof c.refresh_token === "string" && c.user_email === email
    && (!c.saved_at || nowSec - c.saved_at < 50 * 24 * 3600));
}
export function readSessionCache(path = sessionCachePath(), email = TEST_ACCOUNT_EMAIL) {
  try { const c = JSON.parse(readFileSync(path, "utf8")); return cacheUsable(c, undefined, email) ? c : null; } catch { return null; }
}
export function writeSessionCache(tok, path = sessionCachePath(), email = TEST_ACCOUNT_EMAIL) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ access_token: tok.access_token, refresh_token: tok.refresh_token, user_email: email, saved_at: Math.floor(Date.now() / 1000) }), { mode: 0o600 });
  } catch { /* a cache that cannot be written only costs a fresh sign-in next time */ }
}

/** Try the cached session on this page; true only if it is live AND is the test account. Refreshed tokens are written back. */
async function tryCachedSession(page, account = "primary") {
  const email = emailFor(account), path = sessionCachePath(account);
  const c = readSessionCache(path, email);
  if (!c) return false;
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 });
  const out = await page.evaluate(async (t) => {
    const { data, error } = await window.pfSupabase.auth.setSession({ access_token: t.access_token, refresh_token: t.refresh_token });
    const ses = data && data.session;
    return error || !ses ? { ok: false } : { ok: ses.user && ses.user.email, access_token: ses.access_token, refresh_token: ses.refresh_token };
  }, c).catch(() => ({ ok: false }));
  if (out.ok !== email) return false;
  writeSessionCache(out, path, email);
  return true;
}

/** Sign the page in via the key route. Returns the proof object; throws with the exact error. */
export async function signInViaRoute(page, key, account = "primary") {
  if (await tryCachedSession(page, account)) return;
  // The route intermittently answers 5xx (a 502 for ~3 min during every Pages deploy, measured 2026-10-06); retry those only — a 404/401 is a real answer.
  let r;
  for (let attempt = 0; attempt < 14; attempt++) {
    r = await page.evaluate(async ([k, acct]) => {
      const headers = { "x-e2e-login-key": k, ...(acct === "primary" ? {} : { "x-e2e-account": acct }) };
      const res = await fetch("/api/auth/e2e-session", { method: "POST", headers }).catch(() => null);
      return res ? { status: res.status, body: await res.json().catch(() => null) } : { status: 599, body: null };
    }, [key, account]);
    if (r.status < 500) break;
    await page.waitForTimeout(15000); // a Pages deploy in flight answers 502 for ~3 min
  }
  const fail = routeFailure(r.status, r.body);
  if (fail) throw new Error("signedInSession: " + fail);
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 });
  let set = null; // setSession can answer "Failed to fetch" on a flaky egress hop (measured 2026-10-06): retry a few times
  for (let attempt = 0; attempt < 4; attempt++) {
    set = await page.evaluate(async (t) => {
      const { error } = await window.pfSupabase.auth.setSession({ access_token: t.access_token, refresh_token: t.refresh_token });
      return error ? String(error.message || error) : null;
    }, r.body);
    if (!set || !/failed to fetch|network|timeout/i.test(set)) break;
    await page.waitForTimeout(2000);
  }
  if (set) throw new Error("signedInSession: setSession failed — " + set);
  writeSessionCache(r.body, sessionCachePath(account), emailFor(account));
}

/** Proof only a signed-in owner can produce: the auth user's email + the fixture site row. */
export async function proveSignedIn(page) {
  return page.evaluate(async (fixtureId) => {
    const { data } = await window.pfSupabase.auth.getUser();
    const email = (data && data.user && data.user.email) || null;
    const q = await window.pfSupabase.from("sites").select("id").eq("id", fixtureId);
    return { email, fixtureVisible: !!(q.data && q.data.length === 1), fixtureError: q.error ? String(q.error.message) : null };
  }, FIXTURE_SITE_ID);
}

/* engine: "chromium" (default) or "webkit". device: a Playwright descriptor name, e.g. "iPhone 15" — its viewport /
 * touch / UA / scale factor become the context options (an explicit contextOptions still wins). WebKit is
 * installed on demand (initScripts: [[fn, arg], …] run in every page before it loads): `npx playwright install webkit` (docs/PHONE-TESTING.md); a missing build is a LOUD throw. */
export async function openSignedIn({ account = "primary", base = "https://planyr.io", viewport = { width: 1440, height: 900 }, contextOptions = {}, engine = "chromium", device = null, initScripts = [], ignoreDefaultArgs = undefined, launchArgs = [] } = {}) {
  if (device && !devices[device]) throw new Error("signedInSession: unknown device descriptor " + device);
  if (device) { contextOptions = { ...devices[device], ...contextOptions }; viewport = undefined; }
  const key = process.env.E2E_LOGIN_KEY, email = process.env.E2E_EMAIL, pw = process.env.E2E_PASSWORD;
  if (!key && !(email && pw)) throw new Error("signedInSession: set E2E_LOGIN_KEY (preferred) or E2E_EMAIL / E2E_PASSWORD");
  // Pinned-revision mismatch in this sandbox: fall back to the pre-installed Chromium (never download).
  let browser;
  if (engine === "webkit") {
    browser = await webkit.launch(); // no ignore-cert flags, ever
  } else {
    const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", ...launchArgs], ...(ignoreDefaultArgs ? { ignoreDefaultArgs } : {}) }); // ignoreDefaultArgs: ["--hide-scrollbars"] lets a check SEE scrollbars // no ignore-cert flags, ever
  }
  try {
    const context = await browser.newContext({ ...(viewport ? { viewport } : {}), ...contextOptions }); // contextOptions: e.g. a Playwright device descriptor (isMobile/hasTouch) for a phone check
    for (const [fn, arg] of initScripts) await context.addInitScript(fn, arg); // before any navigation (e.g. the iOS keyboard model)
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    if (key) {
      await signInViaRoute(page, key, account);
    } else {
      const emailField = page.locator('input[type="email"]');
      if (!(await emailField.count())) await page.getByRole("button", { name: /sign in|account|log ?in/i }).first().click().catch(() => {});
      await emailField.first().waitFor({ state: "visible", timeout: 20000 });
      await emailField.first().fill(email);
      const pwField = page.locator('input[type="password"]').first();
      await pwField.fill(pw);
      await pwField.press("Enter");
      const gone = await emailField.first().waitFor({ state: "hidden", timeout: 30000 }).then(() => true, () => false);
      if (!gone) {
        const msg = (await page.locator('input[type="password"]').first().locator("xpath=ancestor::form[1]").innerText().catch(() => "")).split("\n").filter(Boolean).pop();
        throw new Error("signedInSession: sign-in rejected — " + (msg || "auth dialog still open"));
      }
    }
    // Polled: the fixture row arrives once the session is live on the client.
    let proof = null;
    const want = emailFor(account), needFixture = account === "primary"; // the teammate owns no fixture
    for (let i = 0; i < 20; i++) { proof = await proveSignedIn(page); if (proof.email === want && (proof.fixtureVisible || !needFixture)) break; await page.waitForTimeout(500); }
    if (!proof || proof.email !== want || (needFixture && !proof.fixtureVisible))
      throw new Error("signedInSession: not provably signed in — " + JSON.stringify(proof));
    const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
    return { browser, context, page, build, proof, errors, close: () => browser.close() };
  } catch (e) { await browser.close().catch(() => {}); throw e; }
}
