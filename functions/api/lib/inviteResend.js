/* /api/team/invite-resend — "email me my invitation again" for the SIGNED-IN INVITEE (NEW-1, 2026-11-02).
 *
 * WHY THIS EXISTS: with email confirmation off, a matching address is not proof of the mailbox, so an account that
 * has not yet proven its mailbox cannot accept an invitation from the account menu — it must use the emailed link.
 * This route re-sends that email. It is the invitee-side twin of /api/team/invite-email (which is admin-only).
 *
 * SECURITY INVARIANTS
 *   1. The invite ids never reach the browser. They are the bearer secret inside the emailed link, so the DB function
 *      that returns them (claim_invite_resend_for) is granted to the SERVICE ROLE only and this route answers the
 *      browser with a count and the account's own address — nothing else.
 *   2. The caller is identified ONLY by their verified bearer token (verifySupabaseUser); the body is never read, so
 *      nothing a caller sends can name someone else's address.
 *   3. The 60 s throttle is enforced in the database (per invite), not here.
 *   4. A provider failure hands the throttle slot back (release_invite_resend) so "Resend" is not blocked by mail that
 *      never left.
 * Needs Cloudflare Pages env: SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY · GMAIL_SERVICE_ACCOUNT_JSON ·
 * INVITE_SENDER (the same Gmail variables as invite-email).
 */
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { sendViaGmail } from "./gmailSend.js";
import { buildInviteEmail, INVITE_FROM_DEFAULT, INVITE_REPLY_TO_DEFAULT } from "./inviteEmail.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function serviceRpc(env, name, args, fetchImpl) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* leave null */ }
  return { ok: res.ok, status: res.status, data };
}

/** POST with the caller's Supabase bearer token (no body needed).
 *  200 { ok:true, sent, email } · 429 { reason:"throttled", retryAfterSeconds } · 404 { reason:"no_invites" } ·
 *  401 not signed in · 502 { reason:"send_failed" } · 503 { reason:"not_configured" }. */
export async function handleInviteResend({ env, request, fetchImpl = fetch }) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, fetchImpl });
  if (!v.ok) return json({ ok: false, error: v.error }, 401);
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.GMAIL_SERVICE_ACCOUNT_JSON || !env.INVITE_SENDER) {
    return json({ ok: false, reason: "not_configured", error: "Email sending isn't configured yet." }, 503);
  }

  const claim = await serviceRpc(env, "claim_invite_resend_for", { p_user: v.user.id }, fetchImpl);
  if (!claim.ok || !claim.data) return json({ ok: false, reason: "claim_failed", error: `Invite email setup incomplete (${claim.status}).` }, 502);
  const c = claim.data;
  if (!c.ok) {
    if (c.reason === "throttled") return json({ ok: false, reason: "throttled", retryAfterSeconds: c.retry_after_seconds }, 429);
    if (c.reason === "no_invites") return json({ ok: false, reason: "no_invites", error: "There is no invitation waiting for this account." }, 404);
    return json({ ok: false, reason: "not_found", error: "Couldn't find this account." }, 404);
  }

  let sent = 0, lastError = null;
  for (const it of c.items || []) {
    const mail = buildInviteEmail({ inviterName: it.inviter_name, teamName: it.team_name, role: it.role, inviteId: it.invite_id, hasAccount: true, appUrl: env.PUBLIC_APP_URL });
    const r = await sendViaGmail({
      serviceAccountJson: env.GMAIL_SERVICE_ACCOUNT_JSON, sender: env.INVITE_SENDER, fromEmail: env.INVITE_FROM || INVITE_FROM_DEFAULT,
      replyTo: env.INVITE_REPLY_TO || INVITE_REPLY_TO_DEFAULT, to: c.email, subject: mail.subject, html: mail.html, text: mail.text, fetchImpl,
    });
    if (r.ok) sent += 1;
    else {
      lastError = r.error;
      await serviceRpc(env, "release_invite_resend", { p_invite: it.invite_id, p_prev: it.prev_sent_at }, fetchImpl).catch(() => null);
    }
  }
  if (sent === 0) return json({ ok: false, reason: "send_failed", error: lastError || "The email could not be sent." }, 502);
  return json({ ok: true, sent, email: c.email });
}
