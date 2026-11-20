/* POST /api/ops/signin-heartbeat — the FAST sign-in check (NEW-1, 2026-11-04, B2650848).
 *
 * WHY: the hourly GitHub workflow is meant to run at :17 every hour; measured 2026-11-04 it ran five times in 33 hours, because
 * GitHub's scheduler is throttled for this repo (so is every other scheduled workflow here). A sign-in outage could sit unseen
 * for hours. The cheap checks — the live bundle's bot-check key, Supabase's bot-check gate, the sign-in email route — need no
 * browser, so they run HERE, on Planyr's own server, called every 15 minutes by a Supabase pg_cron job through pg_net
 * (src/shared/auth/db/signin_health_edge_cron.sql). The browser checks stay on GitHub, now best-effort.
 *
 * AUTH: none, on purpose — there is no secret to paste. The route ignores the request body entirely and runs the checks itself,
 * so a caller can only make it LOOK at the live site; it cannot supply, forge or suppress a result. It refuses to run twice
 * inside THRESHOLDS.edgeMinGapMin minutes, so hammering it costs one cheap database read per request and nothing else.
 *
 * A failed first attempt is re-checked ~20 s later in the same request (a blip never alarms); "two failures in a row" is then
 * reached in one beat. The report goes through the same recordReport() the GitHub path uses — same rules, same one-email-per-incident,
 * same dead-man's switch — with source "edge". Answers 200 { ok, skipped? | overall, decision, delivery, … } (pg_net records it in
 * net._http_response). The store, fetch, clock, sleeper and mail sender are injected so test/signinHeartbeatRoute.test.js runs it all. */
import { checkSiteKey, checkGate, checkEmailLink, extractSupabaseConfig } from "../../../scripts/lib/signinChecks.mjs";
import { overallOf, THRESHOLDS } from "../../../src/shared/auth/signinHealth.js";
import { sendViaGmail } from "./gmailSend.js";
import { createPostgrestStore, recordReport, isNotMigrated } from "./signinHealthRoute.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const EDGE_BASE = "https://planyr.io";
export const EDGE_MAX_BUNDLE_FILES = 25;     // the live bundle is read until the site key turns up; bounded so a broken site cannot make this run away
export const EDGE_RETRY_WAIT_MS = 20000;

/** One pass of the three network checks. Pure of the clock; network injected. */
export async function runEdgeChecks({ base = EDGE_BASE, fetchImpl = fetch } = {}) {
  const sk = await checkSiteKey({ base, fetchImpl, maxFiles: EDGE_MAX_BUNDLE_FILES });
  // The Supabase address + key are read from the LIVE bundle (what a visitor's browser would use), never from this server's env.
  const cfg = extractSupabaseConfig(sk.texts, {});
  const checks = [sk.check, await checkGate({ supabaseUrl: cfg.url, anonKey: cfg.anon, siteKey: sk.siteKey, fetchImpl }), await checkEmailLink({ base, fetchImpl })];
  return { checks, overall: overallOf(checks) };
}

export async function handleSigninHeartbeat({ request, env, store, fetchImpl = fetch, send = sendViaGmail, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date().toISOString(), base = (env && env.SIGNIN_CHECK_BASE) || EDGE_BASE }) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });

  try {
    const db = store || createPostgrestStore(env, fetchImpl);
    const last = await db.lastCheckAt({ synthetic: false, source: "edge" });
    if (last && (Date.parse(now()) - Date.parse(last)) / 60000 < THRESHOLDS.edgeMinGapMin) return json({ ok: true, skipped: "too-soon", lastCheckAt: last });

    const attempts = [];
    attempts.push(await runEdgeChecks({ base, fetchImpl }));
    if (attempts[0].overall === "fail") { await sleep(EDGE_RETRY_WAIT_MS); attempts.push(await runEdgeChecks({ base, fetchImpl })); }
    return recordReport({ env, store: db, source: "edge", attempts: attempts.map((a) => ({ checks: a.checks, overall: a.overall })), runUrl: null, synthetic: false, send, fetchImpl, now });
  } catch (e) {
    if (isNotMigrated(e)) return json({ ok: false, reason: "not_migrated", error: "Run src/shared/auth/db/signin_health_edge.sql." }, 503);
    return json({ ok: false, error: `heartbeat failed: ${(e && e.message) || e}`.slice(0, 300) }, 502);
  }
}
