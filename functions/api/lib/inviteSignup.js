/* /api/auth/invite-signup — create an account FROM A VALID INVITE LINK, with no Turnstile (NEW-1, 2026-11-02, item 8).
 *
 * WHY: sign-up, sign-in and password reset are all Turnstile-gated, so a person that Cloudflare blocks cannot create
 * an account at all — even one whose team just invited them. The invite link already proves they hold the mailbox the
 * team wrote to, so a person arriving by a valid, open link may create their account here instead. Captcha stays ON
 * for everyone else; this is a separate door that opens onto ONE thing: "make the account for THIS invite's address".
 *
 * THE FLOW (all server-side, service role):
 *   1. invite_signup_begin(invite)  — the invite exists, is open, its address has NO account yet, and fewer than 8
 *      attempts in the last 24 h (the per-invite cap; counted here, in the database).
 *   2. GoTrue admin createUser      — email = the INVITE's address (never one the caller types), email_confirm true,
 *      the password and name the person chose.
 *   3. invite_signup_finish(invite, user) — records the mailbox proof and joins the team (idempotent).
 *   4. a session for that new user  — admin generate_link (magiclink) → /verify, exactly as /api/auth/e2e-session does
 *      (the verify call is not captcha-gated), pinned to the user just created. The browser setSession()s with it.
 *
 * SECURITY INVARIANTS — do not loosen without re-reading the threat model in the PR:
 *   1. POST only; NO CORS headers (no other website can call it from a browser).
 *   2. The address comes from the invite row, never from the request. The body carries the invite uuid (unguessable,
 *      122 random bits — the same bearer secret as the link), a password and a name.
 *   3. A used / declined / unknown invite, or an address that already has an account, creates nothing.
 *   4. The service-role key, the magic-link token and the password are never returned or logged. Only the new user's own
 *      session tokens leave this function.
 * Logic lives in handleInviteSignup(request, env, deps) so it is unit-tested with a fake fetch.
 */
import { callUpstream, safeUpstreamMessage } from "../auth/e2e-session.js";

export const MIN_PASSWORD = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

const log = (ok, reason, request) => {
  // No secrets, no body, no address — only the outcome and where it came from.
  try { console.log(JSON.stringify({ evt: "invite-signup", ok, reason, ip: request.headers.get("cf-connecting-ip") || null, ts: new Date().toISOString() })); } catch (_) { /* logging must never break the route */ }
};

// ONE attempt, never retried: a retried createUser after a timeout that actually succeeded would read as "already registered".
async function once(doFetch, url, init) {
  try {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, attempts: 1, netError: null };
  } catch (e) { return { ok: false, status: 0, body: null, attempts: 1, netError: (e && e.name) || "Error" }; }
}

const clean = (s, max) => String(s == null ? "" : s).trim().slice(0, max);

export async function handleInviteSignup(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });

  const base = String((env && env.SUPABASE_URL) || "").replace(/\/+$/, "");
  const service = env && env.SUPABASE_SERVICE_ROLE_KEY, anon = env && env.SUPABASE_ANON_KEY;
  if (!base || !service || !anon) { log(false, "not-configured", request); return reply(503, { ok: false, reason: "not_configured", error: "Account creation from an invitation isn't configured yet." }); }

  let body = null;
  try { body = await request.json(); } catch (_) { return reply(400, { ok: false, reason: "bad_request", error: "Expected a JSON body." }); }
  const invite = clean(body && body.invite, 64);
  const password = String((body && body.password) || "");
  const firstName = clean(body && body.firstName, 80), lastName = clean(body && body.lastName, 80), org = clean(body && body.org, 120);
  if (!UUID.test(invite)) return reply(400, { ok: false, reason: "bad_invite", error: "This invitation link isn't valid." });
  if (!firstName || !lastName) return reply(400, { ok: false, reason: "name_required", error: "First and last name are required." });
  if (password.length < MIN_PASSWORD) return reply(400, { ok: false, reason: "weak_password", error: `Choose a password of at least ${MIN_PASSWORD} characters.` });

  const svcHeaders = { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" };
  const rpc = (name, args) => callUpstream(doFetch, `${base}/rest/v1/rpc/${name}`, { method: "POST", headers: svcHeaders, body: JSON.stringify(args) }, deps);

  try {
    // 1) The invite must be open, its address must have no account, and the per-invite cap must not be spent.
    const begin = await rpc("invite_signup_begin", { p_invite: invite });
    const b = begin.body;
    if (!begin.ok || !b) { log(false, `begin-${begin.status}`, request); return reply(502, { ok: false, reason: "upstream", error: "Couldn't check this invitation — try again in a moment." }); }
    if (!b.ok) {
      log(false, `begin-${b.reason}`, request);
      if (b.reason === "has_account") return reply(409, { ok: false, reason: "has_account", error: "This address already has a Planyr account — sign in to accept." });
      if (b.reason === "too_many") return reply(429, { ok: false, reason: "too_many", error: "Too many tries for this invitation. Try again tomorrow, or ask for a new invitation." });
      return reply(404, { ok: false, reason: "not_available", error: "This invitation is no longer available." });
    }
    const email = String(b.email || "").toLowerCase();

    // 2) Create the (already-confirmed) account for the INVITE's address.
    const created = await once(doFetch, `${base}/auth/v1/admin/users`, {
      method: "POST", headers: svcHeaders,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, ...(org ? { org } : {}) } }),
    });
    const u = created.body;
    if (!created.ok || !u || !u.id) {
      log(false, `create-${created.status}`, request);
      if (created.status === 422 || created.status === 400) return reply(400, { ok: false, reason: "rejected", error: safeUpstreamMessage(u) || "That password or name was not accepted." });
      return reply(502, { ok: false, reason: "create_failed", error: "Couldn't create the account — try again in a moment." });
    }

    // 3) Prove the mailbox and join. (The account now exists, so every failure after this point says so.)
    const fin = await rpc("invite_signup_finish", { p_invite: invite, p_user: u.id });
    if (!fin.ok || !fin.body || !fin.body.ok) {
      log(false, `finish-${(fin.body && fin.body.reason) || fin.status}`, request);
      return reply(502, { ok: false, reason: "account_created", error: "Your account was created, but joining the team didn't finish. Sign in and open the invitation link again." });
    }

    // 4) A session for that user, pinned to the account just made. /verify is not captcha-gated (measured 2026-10-04).
    const gen = await callUpstream(doFetch, `${base}/auth/v1/admin/generate_link`, { method: "POST", headers: svcHeaders, body: JSON.stringify({ type: "magiclink", email }) }, deps);
    const g = gen.body;
    const hashed = g && (g.hashed_token || (g.properties && g.properties.hashed_token));
    if (!gen.ok || !hashed || g.id !== u.id) { log(false, `generate_link-${gen.status}`, request); return reply(502, { ok: false, reason: "account_created", team: fin.body.team_name, error: "Your account was created and you've joined the team. Sign in with the password you just chose." }); }
    const ver = await callUpstream(doFetch, `${base}/auth/v1/verify`, { method: "POST", headers: { apikey: anon, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: hashed }) }, deps);
    const s = ver.body;
    if (!ver.ok || !s || !s.access_token || !s.refresh_token || !s.user || s.user.id !== u.id) {
      log(false, `verify-${ver.status}`, request);
      return reply(502, { ok: false, reason: "account_created", team: fin.body.team_name, error: "Your account was created and you've joined the team. Sign in with the password you just chose." });
    }

    log(true, "issued", request);
    return reply(200, {
      ok: true, access_token: s.access_token, refresh_token: s.refresh_token, token_type: s.token_type || "bearer",
      expires_in: s.expires_in, expires_at: s.expires_at,
      user: { id: s.user.id, email: s.user.email }, team: { id: fin.body.team_id, name: fin.body.team_name },
    });
  } catch (_) {
    log(false, "exception", request);
    return reply(502, { ok: false, reason: "upstream", error: "Something went wrong — try again in a moment." });
  }
}
