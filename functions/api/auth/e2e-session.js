/* POST /api/auth/e2e-session — sign-in route for the automated e2e TEST ACCOUNT ONLY (NEW-1).
 *
 * WHY: Supabase Turnstile captcha gates password sign-in, so a headless session cannot sign in as
 * e2e@planyr.test. Captcha stays ON for everyone; this is a separate door that can only ever open
 * onto that one account. (Owner decision 2026-10-04.)
 *
 * SECURITY INVARIANTS — do not loosen without re-reading the threat model in the PR:
 *   1. POST only (405 otherwise). NO CORS headers on any response, so no other website can call it
 *      from a browser (and a preflight gets no Access-Control-Allow-*).
 *   2. Disabled unless env.E2E_LOGIN_KEY is set AND >= 32 chars: 404, as if the route did not exist.
 *      A missing or wrong key (header `x-e2e-login-key`, never the URL) gets the SAME 404.
 *   3. The account is a CONSTANT in code (E2E_EMAIL + pinned E2E_USER_ID, or — by the `x-e2e-account:
 *      teammate` header — the second pinned test account, B2244017). The request body is never read, so
 *      nothing a caller sends can name an account outside those two. The resolved user id is checked
 *      against the pin BEFORE a session is issued, and the issued session's user again before return.
 *   4. The service-role key stays server-side; it, the magic-link token and the login key are never
 *      returned or logged. Only the test account's own tokens leave this function.
 * Logic lives in handleE2eSession(request, env, deps) so it is unit-tested with a fake fetch.
 */

export const E2E_EMAIL = "e2e@planyr.test";
export const E2E_USER_ID = "a96e544f-8537-45cf-81a2-007965fbc04c";
/* B2244017 — a SECOND pinned test account, the teammate half of a two-account sharing check. It is
 * chosen by the `x-e2e-account: teammate` HEADER (never the body, which is still never read), and it is
 * a constant exactly like the first: an unknown header value is a 404, the same as no key, so the set of
 * accounts this door can open is these two and nothing a caller sends can widen it. The account owns
 * nothing and is on no team except the throwaway one a check creates (and deletes). */
export const E2E_TEAMMATE_EMAIL = "e2e-teammate@planyr.test";
export const E2E_TEAMMATE_USER_ID = "e2e7ea4a-0b5f-4c1e-9d2a-224401700001";
export const E2E_ACCOUNTS = Object.freeze({
  primary: Object.freeze({ email: E2E_EMAIL, id: E2E_USER_ID }),
  teammate: Object.freeze({ email: E2E_TEAMMATE_EMAIL, id: E2E_TEAMMATE_USER_ID }),
});
export const MIN_KEY_LEN = 32;

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (status, obj) => new Response(obj === undefined ? null : JSON.stringify(obj), { status, headers: HEADERS });
const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

/* Constant-time equality: hash both sides to a fixed 32 bytes first (so length never leaks), then
 * XOR-accumulate over every byte with no early exit. */
export async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i] || 0);
  return diff === 0;
}

/* Upstream calls (B2154049). A bare 502 hid WHY a sign-in failed, and one transient blip failed the whole
 * sign-in. So: retry network errors / timeouts / 429 / 5xx with a short backoff (3 attempts), and on final
 * failure report the stage, the upstream status and a sanitised upstream error message — never a token,
 * key, or the raw body. */
export const UPSTREAM_ATTEMPTS = 3;
const retryable = (status) => status === 429 || status >= 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callUpstream(doFetch, url, init, deps = {}) {
  const wait = deps.sleep || sleep;
  let last = { ok: false, status: 0, body: null, attempts: 0, netError: null };
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(10000) });
      const body = await res.json().catch(() => null);
      last = { ok: res.ok, status: res.status, body, attempts: attempt, netError: null };
      if (res.ok || !retryable(res.status)) return last;
    } catch (e) {
      last = { ok: false, status: 0, body: null, attempts: attempt, netError: (e && e.name) || "Error" };
    }
    if (attempt < UPSTREAM_ATTEMPTS) await wait(400 * 3 ** (attempt - 1));
  }
  return last;
}

/* Safe, bounded description of an upstream error body: only the well-known message fields, truncated,
 * with anything token/key-shaped (JWT or long opaque run) masked. */
export function safeUpstreamMessage(body) {
  if (!body || typeof body !== "object") return null;
  const raw = body.msg || body.message || body.error_description || body.error || body.error_code;
  if (typeof raw !== "string") return null;
  return raw.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[jwt]").replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 200);
}

function upstreamFailure(stage, r) {
  return reply(502, {
    error: stage === "generate_link" ? "could not issue link" : "could not exchange link",
    stage, upstream_status: r.status || null, upstream_error: safeUpstreamMessage(r.body),
    network_error: r.netError || undefined, attempts: r.attempts,
  });
}

const log = (ok, reason, request) => {
  // No secrets, no body, no key material — only the outcome and where it came from.
  try { console.log(JSON.stringify({ evt: "e2e-session", ok, reason, ip: request.headers.get("cf-connecting-ip") || null, ts: new Date().toISOString() })); } catch (_) { /* logging must never break the route */ }
};

export async function handleE2eSession(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });

  const loginKey = env && env.E2E_LOGIN_KEY;
  if (typeof loginKey !== "string" || loginKey.length < MIN_KEY_LEN) { log(false, "disabled", request); return notFound(); }
  const presented = request.headers.get("x-e2e-login-key") || "";
  if (!(await safeEqual(presented, loginKey))) { log(false, "bad-key", request); return notFound(); }

  const which = (request.headers.get("x-e2e-account") || "primary").trim();
  const acct = Object.prototype.hasOwnProperty.call(E2E_ACCOUNTS, which) ? E2E_ACCOUNTS[which] : null;
  if (!acct) { log(false, "unknown-account", request); return notFound(); }

  // From here the caller holds the key. Misconfiguration is reported plainly (no secrets in it).
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const service = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY;
  if (!base || !service || !anon) { log(false, "not-configured", request); return reply(503, { error: "not configured" }); }

  try {
    // 1) Admin generate_link for the FIXED email. Never sends an email. The body is a constant.
    const gen = await callUpstream(doFetch, `${base}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: acct.email }),
    }, deps);
    const g = gen.body;
    const hashed = g && (g.hashed_token || (g.properties && g.properties.hashed_token));
    if (!gen.ok || !hashed) { log(false, `generate_link-${gen.status}`, request); return upstreamFailure("generate_link", gen); }
    // PIN CHECK 1 — before anything is exchanged.
    if (g.id !== acct.id || String(g.email || "").toLowerCase() !== acct.email) { log(false, "pin-mismatch-link", request); return reply(403, { error: "account pin mismatch" }); }

    // 2) Exchange the token hash for a session. /verify is not captcha-gated (measured 2026-10-04).
    const ver = await callUpstream(doFetch, `${base}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
    }, deps);
    const s = ver.body;
    if (!ver.ok || !s || !s.access_token || !s.refresh_token) { log(false, `verify-${ver.status}`, request); return upstreamFailure("verify", ver); }
    // PIN CHECK 2 — the session we are about to hand out must be the test account's.
    if (!s.user || s.user.id !== acct.id || String(s.user.email || "").toLowerCase() !== acct.email) { log(false, "pin-mismatch-session", request); return reply(403, { error: "account pin mismatch" }); }

    log(true, "issued", request);
    return reply(200, {
      access_token: s.access_token, refresh_token: s.refresh_token, token_type: s.token_type || "bearer",
      expires_in: s.expires_in, expires_at: s.expires_at, user: { id: s.user.id, email: s.user.email },
    });
  } catch (_) {
    log(false, "exception", request);
    return reply(502, { error: "upstream failure", stage: "worker" });
  }
}

export const onRequest = (context) => handleE2eSession(context.request, context.env);
