/* /api/ops/signin-health — the sign-in alarm (NEW-1, 2026-11-02). Thin Pages Function wrapper; the whole contract and
 * the rules live in ../lib/signinHealthRoute.js and src/shared/auth/signinHealth.js. Only the signin-health workflow on
 * this repo's main branch may call it (GitHub OIDC — no stored secret).
 * Needs Cloudflare Pages env: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (both already set for /api/auth/e2e-session) and,
 * to actually send the email, GMAIL_SERVICE_ACCOUNT_JSON · INVITE_SENDER (the same pair the team-invite email uses). */
import { handleSigninHealth } from "../lib/signinHealthRoute.js";

export async function onRequest({ env, request }) {
  return handleSigninHealth({ env, request });
}
