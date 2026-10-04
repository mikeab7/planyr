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
 *   3. The account is a CONSTANT in code (E2E_EMAIL + pinned E2E_USER_ID). The request body is never
 *      read, so nothing a caller sends can choose the account. The resolved user id is checked
 *      against the pin BEFORE a session is issued, and the issued session's user again before return.
 *   4. The service-role key stays server-side; it, the magic-link token and the login key are never
 *      returned or logged. Only the test account's own tokens leave this function.
 * Logic lives in handleE2eSession(request, env, deps) so it is unit-tested with a fake fetch.
 */

export const E2E_EMAIL = "e2e@planyr.test";
export const E2E_USER_ID = "a96e544f-8537-45cf-81a2-007965fbc04c";
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

  // From here the caller holds the key. Misconfiguration is reported plainly (no secrets in it).
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const service = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY;
  if (!base || !service || !anon) { log(false, "not-configured", request); return reply(503, { error: "not configured" }); }

  try {
    // 1) Admin generate_link for the FIXED email. Never sends an email. The body is a constant.
    const gen = await doFetch(`${base}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: E2E_EMAIL }),
      signal: AbortSignal.timeout(10000),
    });
    const g = await gen.json().catch(() => null);
    const hashed = g && (g.hashed_token || (g.properties && g.properties.hashed_token));
    if (!gen.ok || !hashed) { log(false, `generate_link-${gen.status}`, request); return reply(502, { error: "could not issue link" }); }
    // PIN CHECK 1 — before anything is exchanged.
    if (g.id !== E2E_USER_ID || String(g.email || "").toLowerCase() !== E2E_EMAIL) { log(false, "pin-mismatch-link", request); return reply(403, { error: "account pin mismatch" }); }

    // 2) Exchange the token hash for a session. /verify is not captcha-gated (measured 2026-10-04).
    const ver = await doFetch(`${base}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
      signal: AbortSignal.timeout(10000),
    });
    const s = await ver.json().catch(() => null);
    if (!ver.ok || !s || !s.access_token || !s.refresh_token) { log(false, `verify-${ver.status}`, request); return reply(502, { error: "could not exchange link" }); }
    // PIN CHECK 2 — the session we are about to hand out must be the test account's.
    if (!s.user || s.user.id !== E2E_USER_ID || String(s.user.email || "").toLowerCase() !== E2E_EMAIL) { log(false, "pin-mismatch-session", request); return reply(403, { error: "account pin mismatch" }); }

    log(true, "issued", request);
    return reply(200, {
      access_token: s.access_token, refresh_token: s.refresh_token, token_type: s.token_type || "bearer",
      expires_in: s.expires_in, expires_at: s.expires_at, user: { id: s.user.id, email: s.user.email },
    });
  } catch (_) {
    log(false, "exception", request);
    return reply(502, { error: "upstream failure" });
  }
}

export const onRequest = (context) => handleE2eSession(context.request, context.env);
