#!/usr/bin/env node
/* Unresolved-county watch (NEW-1, 2026-11-12) — nightly, from .github/workflows/ops-digest.yml.
 *
 * Asks the token-gated `ops_unresolved_county_watch` function (src/workspaces/admin/db/admin_ops_county_watch.sql) how many live plans
 * carry drawn parcels but no `sites.county` (a plan that never resolved its county falls out of every county-keyed feature and out of
 * the weekly "where people are working" sweep). READ-ONLY on the plans: the function returns a count and dates, never an id, and this
 * script never touches a plan.
 *
 *   count 0                         → green, said plainly
 *   count > 0, for a week or less   → green, a ::warning:: line (a plan can be mid-edit)
 *   count > 0 for MORE THAN A WEEK  → exit 1 (a red nightly run) with the count and when it began
 *   OPS_INGEST_TOKEN unset, or the SQL function not created yet → a loud ::warning:: and exit 0 (setup not done — same contract as the digest push)
 *   any other failure (network, HTTP 4xx/5xx) → exit 1
 *
 *   node scripts/ops-county-watch.mjs
 */
export const ALERT_AFTER_DAYS = 7;

/** The RPC request. Pure — the token goes in the body only, never a URL or a log. */
export function buildWatchRequest({ url, anonKey, token }) {
  return {
    url: `${String(url).replace(/\/+$/, "")}/rest/v1/rpc/ops_unresolved_county_watch`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ p_token: token }),
    },
  };
}

/** PostgREST answers a missing function with HTTP 404 / code PGRST202 (or 42883 from Postgres). */
const isMissingFunction = (status, body) => status === 404 || /PGRST202|42883|could not find the function/i.test(body || "");

/** result = { count, since, days, alert } from the function. → { code, line, level } Pure. */
export function judgeWatch(result) {
  const n = result && typeof result.count === "number" ? result.count : NaN; // Number(null) is 0 — a missing answer must never read as "clean"
  if (!Number.isInteger(n) || n < 0) return { code: 1, level: "error", line: `unresolved-county watch: the answer was not a count (${JSON.stringify(result)})` };
  if (n === 0) return { code: 0, level: "notice", line: "unresolved-county watch: 0 live plans have drawn parcels and no county — clean." };
  const since = result.since ? String(result.since).slice(0, 10) : "unknown";
  const days = Number(result.days);
  const dayText = Number.isFinite(days) ? `${days.toFixed(1)} day(s)` : "an unknown time";
  if (result.alert === true || (Number.isFinite(days) && days > ALERT_AFTER_DAYS)) {
    return { code: 1, level: "error", line: `unresolved-county watch: ${n} live plan(s) have drawn parcels but NO county, for ${dayText} (since ${since}) — over the ${ALERT_AFTER_DAYS}-day line. They are invisible to every county-keyed feature and to the weekly sweep. Find them with: select id, created_at from sites where deleted_at is null and county is null and jsonb_array_length(coalesce(data->'parcels','[]'::jsonb))>0 (read-only — never edit the plan from here).` };
  }
  return { code: 0, level: "warning", line: `unresolved-county watch: ${n} live plan(s) have drawn parcels but no county, ${dayText} so far (since ${since}) — alerts after ${ALERT_AFTER_DAYS} days.` };
}

export async function runWatch({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const url = env.VITE_SUPABASE_URL, anonKey = env.VITE_SUPABASE_ANON_KEY, token = env.OPS_INGEST_TOKEN;
  if (!token) {
    log("::warning title=Unresolved-county watch NOT running::OPS_INGEST_TOKEN is not set as a GitHub Actions secret. Setup: see src/workspaces/admin/db/admin_ops_ingest.sql, then admin_ops_county_watch.sql.");
    return { code: 0, skipped: true };
  }
  if (!url || !anonKey) { log("unresolved-county watch: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — cannot run"); return { code: 1 }; }
  const req = buildWatchRequest({ url, anonKey, token });
  let res;
  try { res = await fetchImpl(req.url, req.init); } catch (e) { log("unresolved-county watch: request failed — " + ((e && e.message) || e)); return { code: 1 }; }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (isMissingFunction(res.status, text)) {
      log("::warning title=Unresolved-county watch NOT running::ops_unresolved_county_watch does not exist in the database yet. Run src/workspaces/admin/db/admin_ops_county_watch.sql once in the Supabase SQL editor.");
      return { code: 0, skipped: true };
    }
    log(`unresolved-county watch: the server refused it (HTTP ${res.status}) ${text.slice(0, 200).split(token).join("<token>")}`);
    return { code: 1 };
  }
  let result;
  try { result = JSON.parse(text); } catch { log("unresolved-county watch: the answer was not JSON"); return { code: 1 }; }
  const j = judgeWatch(result);
  log(j.level === "error" ? `::error title=Unresolved-county watch::${j.line}` : j.level === "warning" ? `::warning title=Unresolved-county watch::${j.line}` : j.line);
  return { code: j.code, result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWatch().then((r) => { process.exitCode = r.code; });
}
