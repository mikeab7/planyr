/* /api/ops/signin-heartbeat — the fast sign-in check (NEW-1, 2026-11-04, B2650848). Thin Pages Function wrapper; the contract and
 * the reasoning live in ../lib/signinHeartbeatRoute.js. Called every 15 minutes by a Supabase pg_cron job (pg_net) — no secret,
 * the route takes nothing from the caller. Needs the same Cloudflare Pages env as /api/ops/signin-health. */
import { handleSigninHeartbeat } from "../lib/signinHeartbeatRoute.js";

export async function onRequest({ env, request }) {
  return handleSigninHeartbeat({ env, request });
}
