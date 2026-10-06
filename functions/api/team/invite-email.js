/* /api/team/invite-email — emails a team invite (NEW-1, 2026-10-04). Thin Pages Function wrapper;
 * all logic + the contract live in ../lib/inviteEmail.js. The invite ROW is still created by the
 * browser (RLS, unchanged); this only sends mail, server-side, where the Gmail service-account key lives.
 * Needs Cloudflare Pages env: GMAIL_SERVICE_ACCOUNT_JSON (secret) · INVITE_SENDER · SUPABASE_URL · SUPABASE_ANON_KEY. */
import { handleInviteEmail } from "../lib/inviteEmail.js";

export async function onRequestPost({ env, request }) {
  return handleInviteEmail({ env, request });
}
