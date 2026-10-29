/* Team invite email — pure content + the testable core of /api/team/invite-email (NEW-1).
 * No Cloudflare imports, network is injected, so test/teamInviteEmail.test.js drives the whole
 * claim → send → release flow with fakes. The Pages Function file is a thin wrapper.
 *
 * Provider: the Gmail API as a planyr.io Google Workspace user via a service account with
 * domain-wide delegation (lib/gmailSend.js) — no third-party email service. Env (Cloudflare Pages,
 * never the repo): GMAIL_SERVICE_ACCOUNT_JSON (secret, required) · INVITE_SENDER (planyr.io mailbox
 * to authenticate as, required) · INVITE_FROM (optional From address, default no-reply@planyr.io) · INVITE_REPLY_TO (optional
 * Reply-To, default support@planyr.io) · PUBLIC_APP_URL (optional, default https://planyr.io).
 *
 * NOTE on From: Gmail only honours a From other than the authenticated mailbox when that address is a verified
 * "Send mail as" alias OF THAT MAILBOX (Gmail → Settings → Accounts). A Workspace alias alone is not enough —
 * without it Gmail silently rewrites From to the mailbox's own name/address (measured 2026-10-28, B2485776).
 */
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { sendViaGmail } from "./gmailSend.js";

/* Public From address on invite mail (a Workspace alias of the INVITE_SENDER mailbox, which still
 * authenticates the send). INVITE_FROM overrides it. */
export const INVITE_FROM_DEFAULT = "no-reply@planyr.io";

/* Replies go to a real monitored alias, never to the no-reply From. INVITE_REPLY_TO overrides it. */
export const INVITE_REPLY_TO_DEFAULT = "support@planyr.io";

export const DEFAULT_APP_URL = "https://planyr.io";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const roleLabel = (r) => (r === "admin" ? "an admin" : "a member");

// One button to planyr.io carrying the invite's own opaque id (a random uuid) — never the email. The app
// resolves the id (rpc invite_preview) to pre-fill the sign-in / sign-up screen (Shell + InviteLanding).
export function inviteLink(appUrl, inviteId) {
  const base = String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, "");
  return inviteId ? `${base}/?app&invite=${encodeURIComponent(inviteId)}` : `${base}/?app`;
}

/* What the email says depends on whether the address already has a Planyr account (claim_invite_send's
 * has_account): true → accept it; false → create the account and you're added at signup; anything else
 * (an older database without the key) → the neutral wording that is true either way. */
export function inviteCopy(hasAccount) {
  if (hasAccount === true) return { button: "Accept invitation", note: "Open Planyr and accept from your account menu." };
  if (hasAccount === false) return { button: "Join team", note: "Create your Planyr account to join \u2014 you'll be added to the team as soon as you sign up." };
  return { button: "Open Planyr", note: "Sign in or create your Planyr account to join." };
}

export function buildInviteEmail({ inviterName, teamName, role, inviteId, hasAccount, appUrl }) {
  const link = inviteLink(appUrl, inviteId);
  const copy = inviteCopy(hasAccount);
  const subject = `${inviterName} invited you to ${teamName} on Planyr`;
  const who = `${inviterName} invited you to join ${teamName} on Planyr as ${roleLabel(role)}.`;
  const text = `${who}\n\n${copy.button}: ${link}\n\n${copy.note}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${esc(inviterName)} invited you to join <strong>${esc(teamName)}</strong> on Planyr as ${roleLabel(role)}.</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${esc(copy.button)}</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#374151">${esc(copy.note)}</p>
</div></body></html>`;
  return { subject, html, text };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function rpc(env, token, name, args, fetchImpl) {
  const res = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* leave null */ }
  return { ok: res.ok, status: res.status, data };
}

/* POST { teamId, email } with the caller's Supabase bearer token.
 * 200 { ok:true } sent · 429 { reason:"throttled", retryAfterSeconds } · 403/404 not allowed / no
 * such pending invite · 502 { reason:"send_failed" } provider failed (slot released, row kept) ·
 * 503 { reason:"not_configured" } no Gmail credentials yet (slot released). */
export async function handleInviteEmail({ env, request, fetchImpl = fetch }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, fetchImpl });
  if (!v.ok) return json({ ok: false, error: v.error }, 401);

  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Expected a JSON body." }, 400); }
  const { teamId, email } = body || {};
  if (!teamId || !email) return json({ ok: false, error: "Missing teamId or email." }, 400);

  const claim = await rpc(env, token, "claim_invite_send", { p_team: teamId, p_email: email }, fetchImpl);
  if (!claim.ok || !claim.data) {
    // Most likely the migration (db/team_invite_email.sql) hasn't been run — say so, don't guess.
    return json({ ok: false, reason: "claim_failed", error: `Invite email setup incomplete (${claim.status}).` }, 502);
  }
  const c = claim.data;
  if (!c.ok) {
    if (c.reason === "throttled") return json({ ok: false, reason: "throttled", retryAfterSeconds: c.retry_after_seconds }, 429);
    if (c.reason === "not_found") return json({ ok: false, reason: "not_found", error: "No pending invite for that address." }, 404);
    return json({ ok: false, reason: "forbidden", error: "Only a team admin can send invites." }, 403);
  }

  const release = () => rpc(env, token, "release_invite_send", { p_invite: c.invite_id, p_prev: c.prev_sent_at }, fetchImpl).catch(() => null);

  if (!env.GMAIL_SERVICE_ACCOUNT_JSON || !env.INVITE_SENDER) {
    await release();
    return json({ ok: false, reason: "not_configured", error: "Email sending isn't configured yet." }, 503);
  }

  const mail = buildInviteEmail({ inviterName: c.inviter_name, teamName: c.team_name, role: c.role, inviteId: c.invite_id, hasAccount: c.has_account, appUrl: env.PUBLIC_APP_URL });
  const sent = await sendViaGmail({ serviceAccountJson: env.GMAIL_SERVICE_ACCOUNT_JSON, sender: env.INVITE_SENDER, fromEmail: env.INVITE_FROM || INVITE_FROM_DEFAULT, replyTo: env.INVITE_REPLY_TO || INVITE_REPLY_TO_DEFAULT, to: c.email, subject: mail.subject, html: mail.html, text: mail.text, fetchImpl });
  if (!sent.ok) {
    await release();
    return json({ ok: false, reason: "send_failed", error: sent.error }, 502);
  }
  return json({ ok: true, messageId: sent.id || null });
}
