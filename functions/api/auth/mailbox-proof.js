/* POST /api/auth/mailbox-proof — record that this person just proved they control their mailbox (NEW-1, B2626128).
 *
 * WHY. Redeeming an emailed sign-in / reset link IS proof of the mailbox: only the inbox the link was mailed to could have
 * opened it. The team-invite functions consume that fact (`public.mailbox_proofs`, read by `mailbox_is_proven`,
 * `redeem_invite_link`, `invite_signup_finish`), written by `public.prove_mailbox(p_user, p_email, p_via)` — SECURITY DEFINER,
 * EXECUTE for service_role only, so only a server can write it. The landing page (src/app/AuthLinkLanding.jsx) redeems the
 * token in the browser, straight against Supabase, so it asks THIS route, with the session it just got, to record the proof.
 *
 * SECURITY INVARIANTS — the proof is only worth anything if a session that did NOT come from an emailed token can never claim one:
 *   1. POST only; no CORS; a request from another website's page is refused. Bearer token required.
 *   2. The token is checked by Supabase itself (GET /auth/v1/user) — expired or forged → 401, nothing recorded.
 *   3. The session must have been authenticated BY AN EMAILED TOKEN, read from its own `amr` claim (the authentication-method
 *      record Supabase signs into every access token). Measured on production 2026-11-02: redeeming an emailed token gives
 *      amr [{"method":"otp"}]; a password session says "password". A password sign-in proves a password, not a mailbox, so it
 *      is refused. "magiclink" and "recovery" are accepted as well for the same reason (the recovery variant could not be
 *      measured without a mailbox — the live checklist V2070800 records it). The sign-in must be recent (10 min): this is
 *      called seconds after the redemption.
 *   4. The user id and the address come from the account Supabase resolved the token to — NEVER from the request body — and
 *      the token's own `sub` must match it. `prove_mailbox` additionally re-checks the address against auth.users.
 *   5. The service-role key stays here; replies carry no token, key or address; the log carries outcomes only.
 * Logic lives in handleMailboxProof(request, env, deps) so it is unit-tested with a fake fetch. */
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { originAllowed } from "./email-link.js";

export const EMAILED_TOKEN_METHODS = Object.freeze(["otp", "magiclink", "recovery"]);
export const MAX_REDEMPTION_AGE_S = 10 * 60;
export const PROOF_VIA = "emailed_link";

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const log = (evt) => { try { console.log(JSON.stringify({ evt: "mailbox-proof", ...evt, ts: new Date().toISOString() })); } catch (_) { /* logging must never break the route */ } };

/* The claims of an access token. Called only AFTER Supabase has accepted the token, so the payload is the one it signed. */
function claimsOf(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const p = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
  } catch (_) { return null; }
}

export async function handleMailboxProof(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const nowS = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  const e = env || {};
  if (!originAllowed(request, e)) { log({ ok: false, reason: "origin" }); return reply(403, { ok: false, reason: "forbidden" }); }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(401, { ok: false, reason: "no_session" });
  const base = String(e.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base || !e.SUPABASE_ANON_KEY || !e.SUPABASE_SERVICE_ROLE_KEY) { log({ ok: false, reason: "not-configured" }); return reply(503, { ok: false, reason: "not_configured" }); }

  const v = await verifySupabaseUser({ token, supabaseUrl: base, anonKey: e.SUPABASE_ANON_KEY, fetchImpl: doFetch });
  if (!v.ok) { log({ ok: false, reason: "session-rejected" }); return reply(401, { ok: false, reason: "no_session" }); }

  const claims = claimsOf(token);
  if (!claims) { log({ ok: false, reason: "unreadable-token" }); return reply(401, { ok: false, reason: "no_session" }); }
  if (claims.sub !== v.user.id) { log({ ok: false, reason: "claims-mismatch" }); return reply(403, { ok: false, reason: "not_emailed_link" }); }
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  // Every method the session was authenticated by must be an emailed-token one: a session that ALSO involved a password is not clean evidence.
  const clean = amr.length > 0 && amr.every((a) => a && typeof a === "object" && EMAILED_TOKEN_METHODS.includes(a.method) && Number.isFinite(a.timestamp));
  if (!clean) { log({ ok: false, reason: "not-emailed-link" }); return reply(403, { ok: false, reason: "not_emailed_link" }); }
  if (nowS - Math.max(...amr.map((a) => a.timestamp)) > MAX_REDEMPTION_AGE_S) { log({ ok: false, reason: "stale" }); return reply(403, { ok: false, reason: "stale" }); }
  if (!v.user.email) { log({ ok: false, reason: "no-email" }); return reply(403, { ok: false, reason: "not_emailed_link" }); }

  let res, body = null;
  try {
    res = await doFetch(`${base}/rest/v1/rpc/prove_mailbox`, {
      method: "POST",
      headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_user: v.user.id, p_email: v.user.email, p_via: PROOF_VIA }),
      signal: AbortSignal.timeout(10000),
    });
    try { body = await res.json(); } catch (_) { /* empty */ }
  } catch (_) { log({ ok: false, reason: "rpc-network" }); return reply(502, { ok: false, reason: "unavailable" }); }

  if (!res.ok || !body || typeof body.ok !== "boolean") { log({ ok: false, reason: "rpc-failed", status: res.status }); return reply(502, { ok: false, reason: "unavailable" }); }
  if (!body.ok) { log({ ok: false, reason: String(body.reason || "refused") }); return reply(409, { ok: false, reason: String(body.reason || "refused") }); }
  log({ ok: true, reason: "proven" });
  return reply(200, { ok: true });
}

export const onRequest = (context) => handleMailboxProof(context.request, context.env);
