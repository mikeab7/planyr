/* Sign-in health — the ONE place that decides whether sign-in is broken, whether the owner is told, and what the
 * email says (NEW-1, 2026-11-02, after B2619760: sign-in was dead for every signed-out person and no system noticed;
 * the owner found it on his phone).
 *
 * Pure and dependency-free so the rules are unit-tested in Node and the same functions serve:
 *   · the alarm route (functions/api/lib/signinHealthRoute.js) — decides, emails (the email copy lives beside it, server-only), writes the snapshot
 *   · the Ops page card (admin OpsSection) and `node scripts/ops-snapshot.mjs --signin` — read the snapshot and say
 *     "ok / broken / stopped checking" in plain words
 *   · the hourly outside-in check (scripts/lib/signinChecks.mjs) — status vocabulary
 *
 * ⛔ THREE STATUSES, NEVER TWO. A check is `pass`, `fail` or `unknown`. `unknown` is "this runner could not tell"
 * (e.g. Cloudflare refused a datacenter browser) — it is NEVER a pass and NEVER a fail. `skipped` is "this step has
 * nothing to run yet" (a route that does not exist, a secret not set) and is neither.
 *
 * ⛔ THRESHOLDS (chosen before measuring, with the reasoning, because a guess nobody wrote down cannot be argued with):
 *   failStreak 2  — two failed outside-in checks in a row. The hourly job re-runs a failed check ~4 minutes later inside
 *                   the same run, so two-in-a-row is reached in about 5 minutes, not two hours, and one network blip
 *                   (which a retry clears) never emails anyone.
 *   refusedMin 3  — and refusals must outnumber successful sign-ins in the same hour. About 15 accounts means a normal
 *                   hour holds 0–5 sign-ins; a total break refuses EVERY attempt, so three refusals with fewer
 *                   successes is "people are trying and failing", while one person fat-fingering a blocked browser
 *                   once is a count in the sweep, not an email. Bias is to alert: the floor is deliberately low.
 *   windowMin 60  — long enough to see a quiet hour's few attempts, short enough that recovery clears it by itself.
 *   staleMin 150  — the check runs hourly; 2.5 hours with no report means the CHECK stopped (the dead-man's switch the
 *                   daily sweep reads).
 *   blindStreak 24 — a full day of `unknown` (every counted step, or any counted step stuck unknown) means the check cannot confirm
 *                   sign-in: said once. A runner-refused real sign-in is NOT counted here (see COVERAGE_GAP_TEXT) — it is a gap the sweep reports.
 *   cooldownMin 60 — a flapping break does not send a second alert inside an hour of the last one.
 * One email per incident, ever: an incident that persists sends nothing more; recovery sends one note. */

export const THRESHOLDS = Object.freeze({
  failStreak: 2,
  refusedMin: 3,
  windowMin: 60,
  staleMin: 150,
  blindStreak: 24,
  cooldownMin: 60,
});

export const CHECK_NAMES = Object.freeze(["site-key-in-bundle", "server-gate", "panel-renders", "real-sign-in", "email-link"]);
export const STATUSES = Object.freeze(["pass", "fail", "unknown", "skipped"]);

/** Plain-words labels for the checks (the email and the Ops card never show the internal id). */
export const CHECK_LABELS = Object.freeze({
  "site-key-in-bundle": "The live site still carries its bot-check key",
  "server-gate": "Supabase's bot check answers the way the site expects",
  "panel-renders": "The sign-in form opens and shows its fields and button",
  "real-sign-in": "A real sign-in as the test account works",
  "email-link": "The sign-in email route answers",
});

/* ── Coverage gaps (owner decision 2026-11-03, V2075968) ───────────────────────────────────────────────────────────
 * A step that CANNOT run from GitHub's runner — the real sign-in through the panel, which Cloudflare answers with a visible
 * challenge for a datacenter browser — is not an outage and not "the check is blind": it is a standing GAP IN COVERAGE. It is
 * flagged `uncovered: true` on the check, left OUT of the overall verdict (so it can never feed the 24-unknown blind email, an
 * alarm that fires because a check can never run is noise) and REPORTED in the daily sweep and the Ops card every day, so it is
 * never mistaken for a pass. The blind email stays for what it was for: the check itself not running, or every counted step
 * unknown. Only an `unknown` step may be uncovered — a pass or a fail is evidence and is never discounted. */
export const COVERAGE_GAP_TEXT = Object.freeze({
  "real-sign-in": "Real sign-in through the panel is NOT covered from GitHub's runner: Cloudflare shows the datacenter browser a challenge it cannot finish. The other checks still run; this one step is not verified.",
});
export const isUncovered = (c) => !!(c && c.uncovered === true && c.status === "unknown");

/** The standing coverage gaps in one run's checks: [{ name, text }]. */
export function coverageGaps(checks) {
  return (Array.isArray(checks) ? checks : []).filter(isUncovered).map((c) => ({ name: c.name, text: COVERAGE_GAP_TEXT[c.name] || `${CHECK_LABELS[c.name] || c.name} is not covered from this runner.` }));
}

/** The overall verdict of one run of the checks. skipped and uncovered count as nothing; any other unknown can never become pass. */
export function overallOf(checks) {
  const list = (Array.isArray(checks) ? checks : []).filter((c) => c && c.status !== "skipped" && !isUncovered(c));
  if (list.some((c) => c.status === "fail")) return "fail";
  if (list.length === 0) return "unknown";
  if (list.some((c) => c.status !== "pass")) return "unknown";
  return "pass";
}

/* ── Client-reported events ─────────────────────────────────────────────────────────────────────────────────────── */
export const EVENT_PREFIX = "event:auth-";
/** source → bucket name used in the snapshot / rate rule. */
export const EVENT_BUCKETS = Object.freeze({
  "event:auth-ok": "ok",
  "event:auth-captcha-refused": "refused",
  "event:auth-captcha-blocked": "blocked",
  "event:auth-captcha-widget-error": "widgetError",
  "event:auth-captcha-timeout": "timeout",
  "event:auth-network": "network",
  "event:auth-unexpected": "unexpected",
  "event:auth-wrong-password": "wrongPassword",
  "event:auth-user-error": "userError",
});

/** rows: [{ source, n }] from the DB's grouped count → { ok, refused, … } (every bucket present, 0 when absent). */
export function summariseEvents(rows) {
  const out = {};
  for (const b of Object.values(EVENT_BUCKETS)) out[b] = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = EVENT_BUCKETS[r && r.source];
    if (b) out[b] += Number(r.n) || 0;
  }
  return out;
}

/** The ONLY client-report rule that can alarm. Wrong passwords, blocked scripts and widget errors are counts, never alarms. */
export function rateAlarm(events, t = THRESHOLDS) {
  const e = events || {};
  const refused = Number(e.refused) || 0;
  const ok = Number(e.ok) || 0;
  if (refused >= t.refusedMin && refused > ok) {
    return { fire: true, reason: `${refused} sign-in attempts in the last hour were refused by the bot check, against ${ok} that got through.` };
  }
  return { fire: false, reason: "" };
}

/* ── Streaks over the outside-in history ────────────────────────────────────────────────────────────────────────── */
/** history: overall strings, NEWEST FIRST. `fail` counts; `unknown` is skipped over; `pass` ends the streak. */
export function failStreak(history) {
  let n = 0;
  for (const o of history || []) {
    if (o === "fail") n++;
    else if (o === "unknown") continue;
    else break;
  }
  return n;
}
/** Consecutive `unknown` reports from the newest; anything else ends it. */
export function unknownStreak(history) {
  let n = 0;
  for (const o of history || []) { if (o === "unknown") n++; else break; }
  return n;
}

/* ── The decision ───────────────────────────────────────────────────────────────────────────────────────────────── */
const minutes = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / 60000;

/**
 * Inputs: history (overall strings, newest first, INCLUDING the report just stored), events (summariseEvents), incident
 * (the open one or null: { kind, alert_emailed_at }), lastAlertAt (ISO or null), now (ISO).
 * Output: { action: "none"|"open"|"retry-alert"|"close", kind, reason, email: null|"alert"|"recovery", suppressed? }
 */
export function decide({ history, events, incident, lastAlertAt, now, t = THRESHOLDS }) {
  const fs = failStreak(history);
  const us = unknownStreak(history);
  const latest = (history && history[0]) || null;
  const rate = rateAlarm(events, t);

  let alarm = null;
  if (fs >= t.failStreak) alarm = { kind: "outside-in", reason: `The hourly outside check failed ${fs} times in a row.` };
  else if (rate.fire) alarm = { kind: "client-rate", reason: rate.reason };
  const blind = !alarm && us >= t.blindStreak;

  if (!incident) {
    const want = alarm || (blind ? { kind: "blind", reason: `The outside check has not been able to confirm sign-in for ${us} runs in a row.` } : null);
    if (!want) return { action: "none", kind: null, reason: "", email: null };
    const recent = lastAlertAt && minutes(now, lastAlertAt) < t.cooldownMin;
    return { action: "open", kind: want.kind, reason: want.reason, email: recent ? null : "alert", suppressed: recent ? "cooldown" : undefined };
  }

  const stillBad = incident.kind === "blind" ? blind || !!alarm : !!alarm;
  if (stillBad) {
    // The alert never got out (mail not set up, Gmail refused): try again on the next report. Otherwise: one email per incident.
    return incident.alert_emailed_at
      ? { action: "none", kind: incident.kind, reason: "", email: null }
      : { action: "retry-alert", kind: incident.kind, reason: alarm ? alarm.reason : "", email: "alert" };
  }
  // Recovery needs PROOF, not silence: a fresh passing run (a client-rate incident also needs the rate to be clear).
  const proven = incident.kind === "blind" ? latest && latest !== "unknown" : latest === "pass";
  if (proven) return { action: "close", kind: incident.kind, reason: "", email: incident.alert_emailed_at ? "recovery" : null };
  return { action: "none", kind: incident.kind, reason: "", email: null };
}

/* ── Snapshot (what the Ops page and the sweep read) ────────────────────────────────────────────────────────────── */
export function buildSnapshot({ now, latestChecks, latestOverall, latestAt, runUrl, history, events, incident, mail, lastDrill }) {
  return {
    updatedAt: now,
    lastCheckAt: latestAt || null,
    overall: latestOverall || null,
    checks: (latestChecks || []).map((c) => ({ name: c.name, status: c.status, ...(isUncovered(c) ? { uncovered: true } : {}), detail: String(c.detail || "").slice(0, 200) })),
    gaps: coverageGaps(latestChecks),
    runUrl: runUrl || null,
    failStreak: failStreak(history),
    unknownStreak: unknownStreak(history),
    events,
    incident: incident ? { kind: incident.kind, openedAt: incident.opened_at || incident.openedAt || null, emailedAt: incident.alert_emailed_at || incident.emailedAt || null } : null,
    mail: mail || null,
    lastDrill: lastDrill || null,
    thresholds: THRESHOLDS,
  };
}

/**
 * Plain-language state of the snapshot AT READ TIME. `stale` is computed here, from the clock, because a snapshot that
 * says "all fine" and has not been touched for a day is the dead-man's-switch case the sweep exists to catch.
 * → { state: "none"|"ok"|"broken"|"blind"|"stale", line }
 */
export function snapshotHealth(snap, now = Date.now(), t = THRESHOLDS) {
  const r = snapshotState(snap, now, t);
  // The standing coverage gaps ride on EVERY state (a healthy "ok" still has one): they are what the daily sweep reports.
  return { ...r, gaps: snap && Array.isArray(snap.checks) ? coverageGaps(snap.checks) : [] };
}

function snapshotState(snap, now, t) {
  if (!snap || !snap.lastCheckAt) return { state: "none", line: "No sign-in check has ever reported. The hourly check is not running, or its first run has not landed." };
  const ageMin = (new Date(now).getTime() - new Date(snap.lastCheckAt).getTime()) / 60000;
  if (ageMin > t.staleMin) {
    const h = Math.round(ageMin / 60);
    return { state: "stale", line: `The sign-in check has not reported for about ${h} hour${h === 1 ? "" : "s"} — the check itself has stopped. Last known result: ${snap.overall || "none"}.` };
  }
  if (snap.incident && snap.incident.kind !== "blind") {
    return { state: "broken", line: `Sign-in is flagged BROKEN (${snap.incident.kind === "client-rate" ? "browsers are being refused" : "the hourly check is failing"})${snap.incident.emailedAt ? "; you were emailed" : "; the email has NOT gone out"}.` };
  }
  if (snap.incident && snap.incident.kind === "blind") return { state: "blind", line: "The outside check has been unable to confirm sign-in for a day or more (its counted steps are unknown, or the check itself is not running properly)." };
  if (snap.overall === "fail") return { state: "broken", line: `The latest outside check failed (${snap.failStreak} in a row); an email goes out at ${t.failStreak}.` };
  if (snap.overall === "unknown") return { state: "blind", line: "The latest outside check could not confirm one or more of its steps (unknown, not a pass)." };
  return { state: "ok", line: "Sign-in checked from outside within the last hour; nothing is wrong." };
}

/** One sentence the daily sweep can quote, including the client-side counts. */
export function sweepLine(snap, now = Date.now()) {
  const h = snapshotHealth(snap, now);
  const e = (snap && snap.events) || {};
  const counts = snap ? ` Last hour from browsers: ${e.ok || 0} signed in, ${e.wrongPassword || 0} wrong passwords, ${e.refused || 0} refused by the bot check, ${e.blocked || 0} blocked scripts, ${e.widgetError || 0} widget errors, ${e.network || 0} network failures.` : "";
  // The coverage gap is reported EVERY day, in words — never left to be inferred from a green state.
  const gap = h.gaps && h.gaps.length ? " Coverage gap: " + h.gaps.map((g) => g.text).join(" ") : "";
  return h.line + counts + gap;
}
