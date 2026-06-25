/* Client error telemetry (B279).
 *
 * Makes the app self-report runtime errors so silent failures stop being invisible
 * until someone stumbles on them. Three global sources feed one sink: window 'error'
 * (uncaught throws), window 'unhandledrejection' (a rejected promise with no .catch),
 * and Vite's 'vite:preloadError' (a code-split chunk failed to load — the stale-deploy
 * case the B221 guard already RECOVERS from; here we additionally RECORD it so those
 * failures become data, not invisible white screens). The React ErrorBoundary also
 * calls reportClientError() from componentDidCatch.
 *
 * Sink: a new public.client_errors table via the EXISTING anon Supabase client (no new
 * vendor, no new keys — the "Supabase table, not Sentry" decision in B279). The table
 * is INSERT-only under RLS (see client_errors.sql): anyone — including an anonymous or
 * half-broken/logged-out session — can write a row, nobody can read it back from the
 * client (admins read via the dashboard / service role). That's deliberate: an error
 * during login, before any session exists, is exactly when we most want the report, so
 * logging must NOT depend on a working auth session. user_id is left to the table
 * default (auth.uid(), null when anonymous) rather than sent by the client.
 *
 * FAIL-SAFE IS THE WHOLE POINT: telemetry that throws is worse than no telemetry, so
 * every path here swallows its own errors and never rethrows into the app. A render-
 * loop error storm is collapsed by decideReport() (duplicate-suppression + a per-window
 * rate cap) so we send a handful of rows, not thousands.
 */
/* global __BUILD_ID__ */
import { supabase } from "../../workspaces/site-planner/lib/supabase.js";

// Build identifier baked in at build time (vite `define`); "dev" under dev/test.
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

export const DUP_MS = 10_000;          // drop an identical signature seen again within 10s
export const RATE_WINDOW_MS = 60_000;  // per-minute window…
export const RATE_MAX = 20;            // …at most this many sends within it (burst/storm guard)
export const SESSION_MAX = 100;        // hard ceiling on TOTAL sends for the page's lifetime.
                                       // The per-minute window re-arms forever, so it only tames
                                       // bursts; this caps a slow sustained drip (a persistent
                                       // error loop, or a logged-out abuser trickling rows) at a
                                       // fixed total per page load. Standard error-tracker practice.
const MSG_MAX = 2000;
const STACK_MAX = 8000;
const RECENT_MAX = 20;                 // diagnostic ring-buffer size

const truncate = (v, n) => { const s = v == null ? "" : String(v); return s.length > n ? s.slice(0, n) : s; };
const safeHref = () => { try { return window.location.href; } catch { return ""; } };
const safeUA = () => { try { return navigator.userAgent; } catch { return ""; } };

/* Pull a human message out of whatever was thrown (Error, string, ErrorEvent-like,
 * a rejection reason, DOMException, or an arbitrary object). Never throws. */
export function extractMessage(error) {
  try {
    if (error == null) return "";
    if (typeof error === "string") return error;
    if (error.message) return String(error.message);
    if (error.reason) return extractMessage(error.reason);
    return String(error);
  } catch { return ""; }
}

/* Best-effort stack, with the React component stack appended when the boundary
 * supplies one (context.componentStack). Never throws. */
export function extractStack(error, context = {}) {
  let stack = "";
  try { if (error && error.stack) stack = String(error.stack); } catch { /* ignore */ }
  const cs = context && context.componentStack;
  if (cs) stack = (stack ? stack + "\n\n" : "") + "Component stack:" + String(cs);
  return stack;
}

export const errorSignature = (source, message) => `${source || "error"}|${message || ""}`.slice(0, 300);

/* A stable per-page-load id (B468/NEW-5). Stamped into every event so multi-tab contention is
 * reconstructable from telemetry — two tabs fighting over one project show up as two distinct
 * tab ids in the rows. Kept short; embedded in the message text so NO DB-schema change (and no
 * owner SQL step) is needed. */
export const TAB_ID = (() => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  } catch { /* ignore */ }
  try { return "t" + Date.now().toString(36).slice(-6); } catch { return "t000000"; }
})();

/* Pure shape of the row we write. Separated from the I/O so it's unit-testable. */
export function buildErrorRow(error, context = {}, meta = {}) {
  return {
    build: meta.build || BUILD_ID,
    module: (context && context.module) || meta.module || null,
    source: (context && context.source) || "error",
    message: truncate(extractMessage(error), MSG_MAX),
    stack: truncate(extractStack(error, context), STACK_MAX),
    url: meta.url || safeHref(),
    user_agent: meta.userAgent || safeUA(),
  };
}

/* Pure decision: should this error be sent, given recent history? Suppresses an exact
 * duplicate signature within dupMs, caps bursts to maxPerWindow per windowMs, AND enforces
 * a hard maxPerSession ceiling on the running total (which never resets) — so a tight loop
 * becomes a few rows and a slow drip can't trickle forever. Returns { report, state } with
 * the next state (no I/O). Unit-tested. */
export function decideReport(sig, now, state = {}, opts = {}) {
  const dupMs = opts.dupMs ?? DUP_MS;
  const windowMs = opts.windowMs ?? RATE_WINDOW_MS;
  const maxPerWindow = opts.maxPerWindow ?? RATE_MAX;
  const maxPerSession = opts.maxPerSession ?? SESSION_MAX;
  const seen = state.seen instanceof Map ? state.seen : new Map();
  let windowStart = state.windowStart || now;
  let sent = state.sent || 0;
  const total = state.total || 0;
  // Session ceiling first: once hit, nothing more goes out for this page's lifetime.
  if (total >= maxPerSession) return { report: false, state: { seen, windowStart, sent, total } };
  if (now - windowStart >= windowMs) { windowStart = now; sent = 0; }   // window rolled over
  const last = seen.get(sig);
  if (last != null && now - last < dupMs) return { report: false, state: { seen, windowStart, sent, total } };
  if (sent >= maxPerWindow) return { report: false, state: { seen, windowStart, sent, total } };
  seen.set(sig, now);
  if (seen.size > 200) for (const [k, t] of seen) if (now - t > dupMs) seen.delete(k); // bound memory
  return { report: true, state: { seen, windowStart, sent: sent + 1, total: total + 1 } };
}

// ——— impure layer (browser only) ————————————————————————————————————————————————

let _state = { seen: new Map(), windowStart: 0, sent: 0, total: 0 };
let _module = null;
let _installed = false;
const _recent = []; // diagnostic ring buffer (last N rows) for live/headless debugging

/* Tag subsequent reports with the active workspace (the Shell calls this on switch). */
export function setTelemetryModule(id) { _module = id || null; }

/* Record one error. Fire-and-forget; NEVER throws into the app. */
export function reportClientError(error, context = {}) {
  try {
    const row = buildErrorRow(error, { ...context, module: (context && context.module) || _module });
    if (!row.message) return;
    const decision = decideReport(errorSignature(row.source, row.message), Date.now(), _state);
    _state = decision.state;
    if (!decision.report) return;
    _recent.push(row);
    if (_recent.length > RECENT_MAX) _recent.shift();
    sink(row);
  } catch { /* telemetry must never throw into the app */ }
}

/* Record a structured NON-error telemetry EVENT (B468/NEW-5). The 8 South lockout incident
 * required live DevTools spelunking to discover because nothing about it was traceable after
 * the fact. These events fix that: a notable state transition we want diagnosable from the
 * client_errors table (or pfTelemetry.recent()) without a live session — a tab entering/leaving
 * read-only, an edit attempted while locked, a save suppressed because the lock isn't held, a
 * cloud write rejected (conflict/RLS), a delete that affected zero rows. Same sink + dedup +
 * ring buffer as reportClientError, tagged source="event:<kind>" and stamped with TAB_ID so
 * multi-tab contention is reconstructable. Fire-and-forget; NEVER throws into the app. */
export function reportClientEvent(kind, message, extra) {
  try {
    const k = String(kind || "event");
    let detail = "";
    if (extra && typeof extra === "object") { try { detail = " " + JSON.stringify(extra); } catch { /* unserializable */ } }
    const msg = `[tab ${TAB_ID}] ${message == null ? "" : String(message)}${detail}`;
    const row = buildErrorRow(null, { source: "event:" + k, module: _module });
    row.message = truncate(msg, MSG_MAX);
    if (!row.message) return;
    const decision = decideReport(errorSignature(row.source, row.message), Date.now(), _state);
    _state = decision.state;
    if (!decision.report) return;
    _recent.push(row);
    if (_recent.length > RECENT_MAX) _recent.shift();
    sink(row);
  } catch { /* telemetry must never throw into the app */ }
}

/* The one network write: insert into public.client_errors via the existing anon client.
 * No-op when cloud isn't configured. Fire-and-forget; swallows all errors (including a
 * missing-table / RLS rejection) so a telemetry failure is itself invisible. */
function sink(row) {
  try {
    if (!supabase) return;
    const p = supabase.from("client_errors").insert(row);
    if (p && typeof p.then === "function") p.then(() => {}, () => {});
  } catch { /* never throw */ }
}

/* Wire the three global error sources to reportClientError. Idempotent; no-ops where
 * there's no window (tests/SSR). NOT capture-phase, so failed resource loads (blocked
 * tiles, broken images) don't spam telemetry — only real script errors and rejections. */
export function installClientErrorTelemetry(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || typeof win.addEventListener !== "function" || _installed) return;
  _installed = true;
  win.addEventListener("error", (e) => reportClientError(e && (e.error || e.message), { source: "window.onerror" }));
  win.addEventListener("unhandledrejection", (e) => reportClientError(e && e.reason, { source: "unhandledrejection" }));
  win.addEventListener("vite:preloadError", (e) => reportClientError((e && e.payload) || e, { source: "vite:preloadError" }));
  // Diagnostic handle (mirrors window.pfSupabase): inspect recent captures live without
  // a DB round-trip. Safe to ship.
  try { win.pfTelemetry = { reportClientError, reportClientEvent, tab: TAB_ID, recent: () => _recent.slice(), state: () => ({ sent: _state.sent, total: _state.total }) }; } catch { /* ignore */ }
}
