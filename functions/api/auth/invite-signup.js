/* POST /api/auth/invite-signup — create an account from a valid team-invite link, no Turnstile (NEW-1, 2026-11-02).
 * Thin Pages Function wrapper; the contract, threat model and logic live in ../lib/inviteSignup.js.
 * Needs Cloudflare Pages env: SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY. */
import { handleInviteSignup } from "../lib/inviteSignup.js";

export const onRequest = (context) => handleInviteSignup(context.request, context.env);
