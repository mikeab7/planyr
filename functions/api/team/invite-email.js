/* /api/team/invite-email — emails a team invite (NEW-1, 2026-10-04). Thin Pages Function wrapper;
 * all logic + the contract live in ../lib/inviteEmail.js. The invite ROW is still created by the
 * browser (RLS, unchanged); this only sends mail, server-side, where RESEND_API_KEY lives.
 * Needs Cloudflare Pages env: RESEND_API_KEY (secret) · SUPABASE_URL · SUPABASE_ANON_KEY. */
import { handleInviteEmail } from "../lib/inviteEmail.js";

export async function onRequestPost({ env, request }) {
  return handleInviteEmail({ env, request });
}
