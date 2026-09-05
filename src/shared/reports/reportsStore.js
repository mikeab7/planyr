/* Problem / "something was slow" report submission (B842866).
 *
 * Backs the global help/report control in the app shell (HelpReportControl.jsx). Writes to
 * `public.problem_reports` (problem_reports.sql) via the existing anon Supabase client — the
 * same "insert always works, even signed out or half-broken" discipline `clientErrors.js`
 * already follows, because a report about a problem is exactly the kind of thing that must
 * not depend on a healthy session to send.
 *
 * ⛔ LOUD-FAILURE: a report that silently vanishes is worse than no button at all. If the
 * insert fails (offline, RLS misconfigured, a dropped connection) the row is queued to
 * localStorage and retried on next load (`retryQueuedReports`, called once from Shell at
 * boot) — never dropped in silence.
 *
 * The context blob follows the SAME allowlist discipline as the performance recorder's
 * capture payload (perfCapture.js): counters, labels and view state only — never drawing
 * geometry, addresses, or names. It's built from `perfRecorderHandle.js`'s always-loaded
 * context (plan id already sanitised via `safePlanId`, GIS layer keys already public/
 * sanitised) so this module never needs to pull in the heavy recorder chunk.
 */
/* global __BUILD_ID__ */
import { supabase, supabaseConfigured } from "../../workspaces/site-planner/lib/supabase.js";
import { safePlanId } from "../telemetry/perfCapture.js";
import { perfContext } from "../telemetry/perfRecorderHandle.js";
import { reportClientEvent } from "../telemetry/clientErrors.js";

const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const QUEUE_KEY = "planyr:reports:queue:v1";
const SESSION_KEY = "planyr:reports:sessionId:v1";
const QUEUE_MAX = 20;       // a stuck outbox should not grow without bound
const DESC_MAX = 4000;

const truncate = (v, n) => { const s = v == null ? "" : String(v); return s.length > n ? s.slice(0, n) : s; };
const safeNum = (fn) => { try { const v = fn(); return Number.isFinite(v) ? v : undefined; } catch (_) { return undefined; } };
const safeStr = (fn) => { try { const v = fn(); return typeof v === "string" ? v : ""; } catch (_) { return ""; } };

function routeId() {
  try {
    const h = String(window.location.hash || "").replace(/^#\/?/, "");
    const seg = h.split(/[/?]/)[0];
    return /^[a-z-]{1,24}$/.test(seg) ? seg : "site";
  } catch (_) { return ""; }
}

/** A stable per-browser id, so a signed-out reporter's later reports can be recognised as
 *  the same visitor without asking them to sign in. Not a security boundary — RLS never
 *  reads it — purely for the admin list's own correlation. Never throws. */
export function reportSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (id) return id;
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch (_) { return ""; }
}

/** The context every report carries, shown to the user before they submit ("no silent
 *  payloads"). `extra.perf` folds in the perf-recorder outcome for a "slow" report
 *  (captureTaken / captureDelivered); omitted for a plain problem report. Never throws. */
export function buildReportContext(extra = {}) {
  try {
    const ctx = perfContext();
    const plan = safePlanId(ctx.planId);
    const out = {
      route: routeId(),
      build: BUILD_ID,
      viewportW: safeNum(() => window.innerWidth),
      viewportH: safeNum(() => window.innerHeight),
      dpr: safeNum(() => window.devicePixelRatio),
      ua: truncate(safeStr(() => navigator.userAgent), 200),
    };
    if (plan.plan) out.plan = plan.plan;
    if (Number.isFinite(ctx.ppf)) out.ppf = +ctx.ppf.toFixed(3);
    if (ctx.layers) out.layers = ctx.layers;
    if (extra.perf && typeof extra.perf === "object") Object.assign(out, extra.perf);
    return out;
  } catch (_) { return { route: routeId(), build: BUILD_ID }; }
}

function readQueue() {
  try { const v = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}
function writeQueue(list) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch (_) { /* storage full/unavailable */ }
}
function queueReport(row) {
  const list = readQueue();
  list.push(row);
  while (list.length > QUEUE_MAX) list.shift(); // oldest dropped first — a full outbox is itself reported
  writeQueue(list);
  if (list.length >= QUEUE_MAX) reportClientEvent("report-queue-full", `report outbox at ${QUEUE_MAX}`);
}

/** How many reports are waiting to be delivered — drives a small "N queued" hint in the UI
 *  so a queued report is never silently invisible to the person who sent it. */
export function queuedReportCount() { return readQueue().length; }

async function insertRow(row) {
  const { error } = await supabase.from("problem_reports").insert(row);
  return error ? { ok: false, error } : { ok: true, error: null };
}

/** File a report. Returns `{ ok, queued, error }` — `ok` means it reached the server just
 *  now; `queued` means it's safe on this device and will retry on next load (never both
 *  false, so a caller can always say something true to the user). Never throws. */
export async function submitReport({ category, description, userId, userEmail, context } = {}) {
  const row = {
    category: category === "slow" ? "slow" : "problem",
    description: description ? truncate(description, DESC_MAX) : null,
    context: context || null,
    build: (context && context.build) || BUILD_ID,
    route: (context && context.route) || routeId(),
    user_id: userId || null,
    user_email: userId ? (userEmail || null) : null, // never attach an email to an anonymous row
    session_id: reportSessionId(),
  };
  try {
    if (!supabaseConfigured() || !supabase) { queueReport(row); return { ok: false, queued: true, error: "no-cloud" }; }
    const r = await insertRow(row);
    if (r.ok) return { ok: true, queued: false, error: null };
    queueReport(row);
    return { ok: false, queued: true, error: (r.error && r.error.message) || String(r.error) };
  } catch (e) {
    queueReport(row);
    return { ok: false, queued: true, error: (e && e.message) || String(e) };
  }
}

/** Drain the local outbox on next load. Fire-and-forget from Shell at boot; never throws. */
export async function retryQueuedReports() {
  const list = readQueue();
  if (!list.length) return { sent: 0, remaining: 0 };
  if (!supabaseConfigured() || !supabase) return { sent: 0, remaining: list.length };
  const remaining = [];
  let sent = 0;
  for (const row of list) {
    try {
      const r = await insertRow(row);
      if (r.ok) sent++; else remaining.push(row);
    } catch (_) { remaining.push(row); }
  }
  writeQueue(remaining);
  return { sent, remaining: remaining.length };
}
