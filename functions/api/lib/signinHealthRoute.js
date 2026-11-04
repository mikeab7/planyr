/* POST /api/ops/signin-health — the alarm (NEW-1, 2026-11-02, after B2619760).
 *
 * The hourly outside-in check (.github/workflows/signin-health.yml → scripts/signin-health-check.mjs) posts what it
 * saw. This route stores it, decides — with the pure rules in src/shared/auth/signinHealth.js — whether sign-in is
 * broken, and if so emails the owner THROUGH THE SAME Gmail sender the invite emails use, exactly once per
 * incident, with a recovery note when it clears. It also writes the `signin` snapshot the Ops page and the daily sweep
 * read, and — because that snapshot carries `lastCheckAt` — a check that stops running shows up there as STALE.
 *
 * Who may call it: ONLY the signin-health workflow on this repo's main branch, proved by GitHub's signed OIDC token
 * (lib/githubOidc.js) — no shared secret to paste anywhere. Anything else is 401.
 *
 * Body: { attempts: [{ checks: [{ name, status, detail }] }, …1–3], runUrl, synthetic, stopDrill }
 *   `attempts` is 1–3 runs of the checks made a few minutes apart inside one workflow run (a failing first attempt is
 *   re-run), stored oldest-first so "two failures in a row" is reached in minutes, not hours. The overall verdict is
 *   computed HERE from the check statuses; a client-supplied verdict is ignored.
 *   `synthetic: true` is the alarm DRILL: it runs the identical decision + email path in its own lane (separate history,
 *   separate incident, "[TEST]" in the subject) so a drill can prove "one incident, one email" without touching the real state.
 * Answers 200 { ok, overall, failStreak, decision, delivery, mail } — `delivery` is "not-needed" | "sent" | "failed" |
 * "not-configured"; the workflow turns anything but the first two into a second, mail-independent alert.
 * The store, the verifier, the sender and the clock are injected so test/signinHealthRoute.test.js runs the whole flow. */
import { verifyGithubOidc } from "./githubOidc.js";
import { sendViaGmail } from "./gmailSend.js";
import { INVITE_FROM_DEFAULT } from "./inviteEmail.js";
import { STATUSES, SOURCES, THRESHOLDS, overallOf, summariseEvents, decide, buildSnapshot, effectiveHistory, mergeLatestChecks, evaluateStops, staleLimitMin, unknownStreak } from "../../../src/shared/auth/signinHealth.js";
import { ALARM_TO, buildAlertEmail, buildRecoveryEmail, buildStoppedEmail } from "./signinHealthEmail.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/* ── Validation ───────────────────────────────────────────────────────────────────────────────────────────────── */
export function normaliseAttempts(body) {
  const raw = body && Array.isArray(body.attempts) ? body.attempts : null;
  if (!raw || raw.length < 1 || raw.length > 3) return { error: "attempts must hold 1 to 3 runs" };
  const out = [];
  for (const a of raw) {
    const list = a && Array.isArray(a.checks) ? a.checks : null;
    if (!list || list.length < 1 || list.length > 12) return { error: "each attempt needs 1 to 12 checks" };
    const checks = [];
    for (const c of list) {
      if (!c || typeof c.name !== "string" || !/^[a-z0-9-]{1,40}$/.test(c.name)) return { error: "bad check name" };
      if (!STATUSES.includes(c.status)) return { error: `bad status for ${c.name}` };
      // `uncovered` is honoured ONLY on an unknown step (a coverage gap); anywhere else it is dropped, so it can never discount evidence.
      checks.push({ name: c.name, status: c.status, ...(c.uncovered === true && c.status === "unknown" ? { uncovered: true } : {}), detail: String(c.detail == null ? "" : c.detail).replace(/[\r\n]+/g, " ").slice(0, 300) });
    }
    out.push({ checks, overall: overallOf(checks) });
  }
  return { attempts: out };
}

/* ── The PostgREST store (service role; the tables have no client policies) ───────────────────────────────────── */
export function createPostgrestStore(env, fetchImpl = fetch) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = (extra) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...extra });
  async function call(stage, path, init = {}) {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, { ...init, headers: headers(init.headers) });
    if (!res.ok) {
      let d = ""; try { d = (await res.text()).slice(0, 160); } catch (_) { /* ignore */ }
      const err = new Error(`${stage}: HTTP ${res.status} ${d}`.trim());
      err.status = res.status; err.detail = d;
      throw err;
    }
    if (res.status === 204) return null;
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  return {
    async recentChecks({ synthetic, limit, source }) {
      return call("history", `signin_health_checks?select=overall,at,checks,run_url,source&synthetic=eq.${!!synthetic}${source ? `&source=eq.${encodeURIComponent(source)}` : ""}&order=at.desc,id.desc&limit=${limit}`) || [];
    },
    async lastCheckAt({ synthetic, source }) {
      const r = await call("last-check", `signin_health_checks?select=at&synthetic=eq.${!!synthetic}&source=eq.${encodeURIComponent(source)}&order=at.desc&limit=1`);
      return (r && r[0] && r[0].at) || null;
    },
    async stopStates() {
      const r = await call("stops", "signin_stop_alerts?select=source,since,emailed_at") || [];
      return Object.fromEntries(r.map((x) => [x.source, x]));
    },
    async setStop(source, patch) {
      await call("stop-state", "signin_stop_alerts?on_conflict=source", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ source, ...patch, updated_at: new Date().toISOString() }) });
    },
    async insertChecks(rows) {
      await call("store-checks", "signin_health_checks", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
    },
    async openIncident({ synthetic }) {
      const r = await call("incident", `signin_incidents?select=*&closed_at=is.null&synthetic=eq.${!!synthetic}&limit=1`);
      return (r && r[0]) || null;
    },
    async lastAlertAt({ synthetic }) {
      const r = await call("last-alert", `signin_incidents?select=alert_emailed_at&alert_emailed_at=not.is.null&synthetic=eq.${!!synthetic}&order=alert_emailed_at.desc&limit=1`);
      return (r && r[0] && r[0].alert_emailed_at) || null;
    },
    async eventCounts(minutes) {
      return call("events", "rpc/signin_event_counts", { method: "POST", body: JSON.stringify({ p_minutes: minutes }) }) || [];
    },
    async createIncident(row) {
      const r = await call("open-incident", "signin_incidents", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) });
      return r && r[0];
    },
    async updateIncident(id, patch) {
      await call("update-incident", `signin_incidents?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch) });
    },
    async setSnapshot(snapKey, payload, at) {
      await call("snapshot", "ops_snapshots?on_conflict=key", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: snapKey, payload, updated_at: at }) });
    },
    async prune(beforeIso) {
      await call("prune", `signin_health_checks?at=lt.${encodeURIComponent(beforeIso)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    },
  };
}

/* ── Mail ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
/* PostgREST says a table/function is missing with PGRST205 / PGRST202 (or the raw 42P01 / 42883): the migration
 * (src/shared/auth/db/signin_health.sql) has not been applied yet. That is a SETUP state, not an outage — answered 503
 * `not_migrated` so the hourly job can say so plainly and skip cleanly instead of going red every hour. */
export const isNotMigrated = (e) => !!e && /PGRST20[25]|42P01|42883|does not exist|Could not find the (table|function)/i.test(String(e.detail || e.message || ""));

export const mailConfigured = (env) => !!(env && env.GMAIL_SERVICE_ACCOUNT_JSON && env.INVITE_SENDER);

async function sendMail({ env, mail, send, fetchImpl }) {
  if (!mailConfigured(env)) return { delivery: "not-configured", error: "GMAIL_SERVICE_ACCOUNT_JSON / INVITE_SENDER are not set in Cloudflare Pages." };
  const r = await send({
    serviceAccountJson: env.GMAIL_SERVICE_ACCOUNT_JSON, sender: env.INVITE_SENDER, fromEmail: env.INVITE_FROM || INVITE_FROM_DEFAULT,
    to: env.SIGNIN_ALARM_TO || ALARM_TO, subject: mail.subject, html: mail.html, text: mail.text, fetchImpl,
  });
  return r.ok ? { delivery: "sent", messageId: r.id || null } : { delivery: "failed", error: r.error };
}

/* ── The shared core: store → decide → (email) → snapshot ─────────────────────────────────────────────────────────────── */
/* Both callers use it — the GitHub runner's OIDC-authenticated report (source "runner") and the fast check's own report
 * (source "edge", /api/ops/signin-heartbeat). `stopDrill` ("stale" | "fresh") is the alarm drill's extra step for the
 * dead-man's switch: it runs the identical stop-detector + email on a synthetic source so the stopped-check email can be proven. */
export async function recordReport({ env, store, source = "runner", attempts, runUrl, synthetic = false, stopDrill = null, send = sendViaGmail, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  let stage = "start";
  try {
    const db = store || createPostgrestStore(env, fetchImpl);
    const t0 = now();
    stage = "store-checks";
    // Oldest attempt first, so history order is the order they ran. Spaced 1 MILLISECOND apart, not a second: a whole second of
    // back-dating let a report that arrived <1 s after the previous one (the drill's steps) put its first attempt BEFORE that report in
    // history — [fail, pass, fail] — and "two failures in a row" read as one (found live, drill run 41863740549, 2026-11-04).
    const rows = attempts.map((a, i) => ({
      at: new Date(Date.parse(t0) - (attempts.length - 1 - i)).toISOString(), overall: a.overall, checks: a.checks, run_url: runUrl, synthetic, source,
    }));
    await db.insertChecks(rows);

    stage = "history";
    // Each source is read on its OWN (a chatty fast check must never push the slower browser check out of the window).
    const bySource = {};
    for (const src of SOURCES) bySource[src] = (await db.recentChecks({ synthetic, limit: 60, source: src })) || [];
    const hist = SOURCES.flatMap((src) => bySource[src]).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const history = effectiveHistory(hist);
    // The 24-unknown "cannot confirm sign-in" rule follows whichever source is stuck on unknown (its own consecutive runs) — a pass from the
    // OTHER source in between must neither reset it nor hide it (a fast check stuck on unknown for 6 hours is as blind as a browser check stuck for days).
    const blindHistory = SOURCES.map((src) => bySource[src].map((h) => h.overall)).sort((a, b) => unknownStreak(b) - unknownStreak(a))[0];
    const mergedChecks = mergeLatestChecks(hist);
    const latestOverall = overallOf(mergedChecks);
    const newest = hist[0] || { at: t0, run_url: runUrl };

    stage = "events";
    // A drill ignores real browsers' events: it must be repeatable whatever real users are doing.
    const events = synthetic ? summariseEvents([]) : summariseEvents(await db.eventCounts(60));
    stage = "incident";
    let incident = await db.openIncident({ synthetic });
    const lastAlertAt = await db.lastAlertAt({ synthetic });

    const decision = decide({ history, blindHistory, events, incident, lastAlertAt, now: t0 });
    let delivery = "not-needed";
    let mailInfo = { configured: mailConfigured(env), error: null, messageId: null };

    stage = "act";
    if (decision.action === "open") {
      incident = await db.createIncident({ kind: decision.kind, reason: decision.reason, synthetic });
    }
    if ((decision.action === "open" || decision.action === "retry-alert") && decision.email === "alert") {
      const m = buildAlertEmail({ kind: decision.kind, reason: decision.reason || (incident && incident.reason), since: incident && incident.opened_at, checks: mergedChecks, events, runUrl, synthetic });
      const r = await sendMail({ env, mail: m, send, fetchImpl });
      delivery = r.delivery; mailInfo = { configured: mailConfigured(env), error: r.error || null, messageId: r.messageId || null };
      if (r.delivery === "sent" && incident) { await db.updateIncident(incident.id, { alert_emailed_at: t0 }); incident = { ...incident, alert_emailed_at: t0 }; }
    } else if (decision.action === "close" && incident) {
      await db.updateIncident(incident.id, { closed_at: t0 });
      if (decision.email === "recovery") {
        const m = buildRecoveryEmail({ kind: incident.kind, openedAt: incident.opened_at, synthetic, runUrl });
        const r = await sendMail({ env, mail: m, send, fetchImpl });
        delivery = r.delivery === "sent" ? "recovery-sent" : r.delivery; mailInfo = { configured: mailConfigured(env), error: r.error || null, messageId: r.messageId || null };
        if (r.delivery === "sent") await db.updateIncident(incident.id, { recovery_emailed_at: t0 });
      }
      incident = null;
    } else if (decision.suppressed) {
      delivery = "suppressed-" + decision.suppressed;
    }

    // ── The dead-man's switch: every report, from either source, checks whether the OTHER one has gone quiet. ──
    stage = "stops";
    const stopOut = await watchStops({ db, env, source, synthetic, stopDrill, t0, send, fetchImpl });

    stage = "snapshot";
    const lastAt = { edge: bySource.edge[0] ? bySource.edge[0].at : null, runner: bySource.runner[0] ? bySource.runner[0].at : null };
    const snap = buildSnapshot({
      now: t0, latestChecks: mergedChecks, latestOverall, latestAt: newest.at, runUrl: newest.run_url || runUrl, history, blindHistory, events, incident, mail: mailInfo,
      sources: { edge: { lastAt: lastAt.edge }, runner: { lastAt: lastAt.runner } }, stops: stopOut.open,
    });
    if (synthetic) await db.setSnapshot("signin_drill", { ...snap, drill: true }, t0);
    else {
      await db.setSnapshot("signin", snap, t0);
      // Housekeeping, best effort: the table keeps ~90 days.
      try { await db.prune(new Date(Date.parse(t0) - 90 * 86400000).toISOString()); } catch (_) { /* never fails the report */ }
    }

    return json({
      ok: true, overall: latestOverall, failStreak: snap.failStreak, unknownStreak: snap.unknownStreak, source,
      decision: { action: decision.action, kind: decision.kind || null, email: decision.email || null, suppressed: decision.suppressed || null },
      delivery, mail: mailInfo, incidentOpen: !!incident, events,
      stops: stopOut.actions, stopDelivery: stopOut.delivery, stopMail: { messageId: stopOut.messageId, error: stopOut.error },
    });
  } catch (e) {
    if (isNotMigrated(e)) return json({ ok: false, reason: "not_migrated", error: "The sign-in health tables are not in the database yet — run src/shared/auth/db/signin_health.sql and signin_health_edge.sql." }, 503);
    // LOUD-FAILURE: a store/DB failure is a 502 the workflow turns into a mail-independent alert — never a silent 200.
    return json({ ok: false, error: `store failure at ${stage}: ${(e && e.message) || e}`.slice(0, 300) }, 502);
  }
}

/* One pass of the per-source dead-man's switch. The source reporting RIGHT NOW is alive by definition, so it reads `now` (that is
 * also what clears its own open stop). Returns { actions, delivery, messageId, error, open } — `delivery` is "not-needed" | "sent" | "failed" | "not-configured". */
async function watchStops({ db, env, source, synthetic, stopDrill, t0, send, fetchImpl }) {
  const state = (await db.stopStates()) || {};
  let watch, lastAt;
  if (synthetic) {
    // The drill's own lane: never reads or touches the real sources' state.
    if (!stopDrill) return { actions: [], delivery: "not-needed", open: [] };
    watch = { drill: staleLimitMin("drill") };
    lastAt = { drill: stopDrill === "fresh" ? t0 : new Date(Date.parse(t0) - 10 * 86400000).toISOString() };
  } else {
    watch = { edge: THRESHOLDS.staleEdgeMin, runner: THRESHOLDS.staleRunnerMin };
    lastAt = {};
    for (const src of SOURCES) lastAt[src] = src === source ? t0 : await db.lastCheckAt({ synthetic: false, source: src });
  }
  const actions = evaluateStops({ now: t0, lastAt, state, watch });
  let delivery = "not-needed", messageId = null, error = null;
  for (const a of actions) {
    if (a.action === "clear") { await db.setStop(a.source, { since: null, emailed_at: null, cleared_at: t0 }); continue; }
    if (a.action === "open") await db.setStop(a.source, { since: t0, emailed_at: null, cleared_at: null });
    const m = buildStoppedEmail({ source: a.source, ageMin: a.ageMin, limitMin: a.limitMin, lastAt: lastAt[a.source], synthetic });
    const r = await sendMail({ env, mail: m, send, fetchImpl });
    delivery = r.delivery; messageId = r.messageId || messageId; error = r.error || error;
    // "failed" | "not-configured" leaves emailed_at empty: the next report retries ("retry-alert") and the workflow raises the mail-independent issue.
    if (r.delivery === "sent") await db.setStop(a.source, { emailed_at: t0 });
  }
  const after = await db.stopStates();
  const open = Object.values(after || {}).filter((x) => x.since && (synthetic ? x.source === "drill" : x.source !== "drill")).map((x) => ({ source: x.source, since: x.since, emailedAt: x.emailed_at || null }));
  return { actions: actions.map((a) => ({ source: a.source, action: a.action })), delivery, messageId, error, open };
}

/* ── The handler: the GitHub runner's report (OIDC-authenticated) ─────────────────────────────────────────────────── */
export async function handleSigninHealth({ request, env, store, verify = verifyGithubOidc, send = sendViaGmail, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verify({ token, fetchImpl });
  if (!v.ok) return json({ ok: false, error: "not authorized" }, 401);

  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Expected a JSON body." }, 400); }
  const norm = normaliseAttempts(body);
  if (norm.error) return json({ ok: false, error: norm.error }, 400);
  const synthetic = !!(body && body.synthetic);
  const runUrl = typeof body.runUrl === "string" && /^https:\/\/github\.com\//.test(body.runUrl) ? body.runUrl.slice(0, 300) : null;
  const stopDrill = synthetic && (body.stopDrill === "stale" || body.stopDrill === "fresh") ? body.stopDrill : null;
  return recordReport({ env, store, source: "runner", attempts: norm.attempts, runUrl, synthetic, stopDrill, send, fetchImpl, now });
}
