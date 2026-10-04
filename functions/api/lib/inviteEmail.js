/* Team invite email — pure content + the testable core of /api/team/invite-email (NEW-1).
 * No Cloudflare imports, network is injected, so test/teamInviteEmail.test.js drives the whole
 * claim → send → release flow with fakes. The Pages Function file is a thin wrapper.
 *
 * Provider: Resend (https://resend.com) — one HTTPS call with a bearer key, plain JSON, and a
 * domain-verification step that fits planyr.io's existing DNS. Env (Cloudflare Pages secrets,
 * never the repo): RESEND_API_KEY (required) · INVITE_FROM (optional, default below) ·
 * PUBLIC_APP_URL (optional, default https://planyr.io).
 */
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";

export const DEFAULT_FROM = "Planyr <no-reply@planyr.io>";
export const DEFAULT_APP_URL = "https://planyr.io";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const roleLabel = (r) => (r === "admin" ? "an admin" : "a member");

// One button to planyr.io, opening the sign-in tab with the invited address prefilled
// (Shell reads ?auth=signin&email=…).
export function inviteLink(appUrl, email) {
  const base = String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, "");
  return `${base}/?app&auth=signin&email=${encodeURIComponent(email)}`;
}

export function buildInviteEmail({ inviterName, teamName, role, email, appUrl }) {
  const link = inviteLink(appUrl, email);
  const subject = `${inviterName} invited you to ${teamName} on Planyr`;
  const who = `${inviterName} invited you to join ${teamName} on Planyr as ${roleLabel(role)}.`;
  const note = `Sign in with this exact address (${email}) and you'll be added to the team automatically.`;
  const text = `${who}\n\nOpen Planyr: ${link}\n\n${note}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${esc(inviterName)} invited you to join <strong>${esc(teamName)}</strong> on Planyr as ${roleLabel(role)}.</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">Open Planyr</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#374151">Sign in with this exact address (<strong>${esc(email)}</strong>) and you'll be added to the team automatically.</p>
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
 * 503 { reason:"not_configured" } no RESEND_API_KEY yet (slot released). */
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

  if (!env.RESEND_API_KEY) {
    await release();
    return json({ ok: false, reason: "not_configured", error: "Email sending isn't configured yet." }, 503);
  }

  const mail = buildInviteEmail({ inviterName: c.inviter_name, teamName: c.team_name, role: c.role, email: c.email, appUrl: env.PUBLIC_APP_URL });
  let res;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.INVITE_FROM || DEFAULT_FROM, to: [c.email], subject: mail.subject, html: mail.html, text: mail.text }),
    });
  } catch (e) {
    await release();
    return json({ ok: false, reason: "send_failed", error: `Provider unreachable: ${e && e.message ? e.message : e}` }, 502);
  }
  if (!res.ok) {
    await release();
    let detail = ""; try { detail = (await res.text()).slice(0, 200); } catch (_) { /* ignore */ }
    return json({ ok: false, reason: "send_failed", error: `Provider refused the send (${res.status}). ${detail}`.trim() }, 502);
  }
  return json({ ok: true });
}
