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
let _win = null;                       // the window the telemetry was installed against (B270912)
const _recent = []; // diagnostic ring buffer (last N rows) for live/headless debugging

/* Tag subsequent reports with the active workspace (the Shell calls this on switch). */
export function setTelemetryModule(id) { _module = id || null; }

/* The outcome shape every reporter returns, for the callers that need to know whether the row
 * actually left the machine. `reason` says WHY nothing was sent when `ok` is false and there is no
 * `error`: "suppressed" (dedup / rate cap / session ceiling), "empty", "no-cloud", "threw",
 * "automated-run" (this page is a test harness — see networkReportSuppression). */
const notSent = (reason) => Promise.resolve({ ok: false, reason, error: null, at: Date.now() });

/* ── AUTOMATED RUNS DO NOT REPORT TO PRODUCTION (B270912) ──────────────────────────────────────
 *
 * ⛔ AN INSTRUMENT THAT BURIES THE SIGNAL IT WAS BUILT TO CATCH IS THE DEFECT, NOT THE TIDINESS
 * PROBLEM. Measured against the production table on 2026-08-08: 679 rows in twenty-four hours, of
 * which 87 of 98 `event:perf` rows came from automated runs and 11 from the owner — 89% noise. The
 * non-perf sources were worse (`assembly-orphan-pad-repaired` 154, `map-registration-out-of-range`
 * 119, `assembly-tear-persisted` 91, `assembly-tear-detected` 65, `county-healed` 47, every one
 * carrying an e2e fixture id). The recorder in #951 exists so that the owner pressing "that felt
 * slow just now" reaches somebody; that row was arriving as one in several hundred synthetic ones,
 * separable only by filtering his display signature from the READ side. That filter is a
 * workaround, not a design, and a genuine production incident would have arrived buried in test
 * traffic the same way.
 *
 * ⛔ THE DETECTOR IS `navigator.webdriver` FIRST, AND THE REASON IS MEASURED, NOT STYLISTIC.
 * The obvious gate was `window.__PLANYR_E2E`, which `docs/PERF-PLAN-SWITCH.md` §1 describes as set
 * by "every performance harness in this repo" — and for the ui-audit perf harnesses that is true.
 * It is NOT true of the e2e suite, which is where the measured noise actually comes from: **62 of
 * 81 specs in `e2e/` never set it**, `assembly-tear-detector.spec.js` — the top producer of three
 * of the five loudest sources — among them. A flag-only gate would have silenced 19 specs, left
 * every top row untouched, and reported success. `navigator.webdriver` is set by the browser
 * itself under ANY automation protocol (Playwright, Puppeteer, Selenium), is never true for a real
 * user, and needs no per-spec discipline — so it holds for harnesses nobody has written yet. The
 * flag stays as a second door, for an automated context driving a browser that is not webdriver-
 * controlled.
 *
 * ⛔ AND WHY THERE IS AN OPT-IN AT ALL — the whole difficulty of this change. `verify-capture-pipe`
 * proves the row reaches the network, and its `rejected`/`offline` arms are the anti-rot half that
 * proves a FAILED delivery is loud. Both run under automation. Suppress unconditionally and that
 * verification is disabled by its own fix — it would pass forever while observing nothing, which is
 * precisely the failure class this change exists to close. So the harness that verifies the pipe
 * sets `__PLANYR_TELEMETRY_NETWORK = true` deliberately, and BOTH directions are asserted: an
 * ordinary harness run must put nothing on the wire, and the opted-in run must still deliver AND
 * still go red when delivery breaks.
 *
 * ⛔ THE LOCAL CAPTURE IS UNTOUCHED IN BOTH CASES. Only the network write is suppressed — the
 * `_recent` ring, `window.pfTelemetry.recent()`, and the recorder's IndexedDB store all still work
 * under test, because several harnesses assert against exactly those.
 *
 * ⛔ IT FAILS OPEN. Every unreadable branch here returns "not suppressed": silencing a real user's
 * telemetry because a property read threw is a strictly worse outcome than one extra test row. */
export const SUPPRESSED_AUTOMATED = "automated-run";

export function networkReportSuppression(win) {
  const none = { suppress: false, automated: false, optIn: false, via: "" };
  try {
    if (!win) return none;
    let flagged = false, webdriver = false, optIn = false;
    try { flagged = win.__PLANYR_E2E === true; } catch (_) { /* ignore */ }
    try { webdriver = !!(win.navigator && win.navigator.webdriver === true); } catch (_) { /* ignore */ }
    try { optIn = win.__PLANYR_TELEMETRY_NETWORK === true; } catch (_) { /* ignore */ }
    const automated = flagged || webdriver;
    const via = webdriver ? (flagged ? "webdriver+flag" : "webdriver") : (flagged ? "flag" : "");
    return { suppress: automated && !optIn, automated, optIn, via };
  } catch (_) { return none; }
}

/* Record one error. Fire-and-forget; NEVER throws into the app. Returns a promise of the delivery
 * outcome — callers are free to ignore it (almost all do), but B265536 made it available so the
 * one caller that must not fail silently, the performance recorder, can tell. */
export function reportClientError(error, context = {}) {
  try {
    const row = buildErrorRow(error, { ...context, module: (context && context.module) || _module });
    if (!row.message) return notSent("empty");
    const decision = decideReport(errorSignature(row.source, row.message), Date.now(), _state);
    _state = decision.state;
    if (!decision.report) return notSent("suppressed");
    _recent.push(row);
    if (_recent.length > RECENT_MAX) _recent.shift();
    return sink(row);
  } catch { return notSent("threw"); /* telemetry must never throw into the app */ }
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
    if (!row.message) return notSent("empty");
    const decision = decideReport(errorSignature(row.source, row.message), Date.now(), _state);
    _state = decision.state;
    if (!decision.report) return notSent("suppressed");
    _recent.push(row);
    if (_recent.length > RECENT_MAX) _recent.shift();
    return sink(row);
  } catch { return notSent("threw"); /* telemetry must never throw into the app */ }
}

/* ── The one network write ────────────────────────────────────────────────────────────────────
 *
 * ⛔ B265536 — THIS USED TO SWALLOW ITS OWN FAILURE, AND THAT IS A LOUD-FAILURE VIOLATION AT THE
 * WORST POSSIBLE PLACE. The old body handed the insert promise two empty handlers — one for
 * success, one for failure — under a comment that said so out loud: *"swallows all errors
 * (including a missing-table / RLS rejection) so a telemetry failure is itself invisible."*
 * For an error report that is merely unfortunate. For the
 * PERFORMANCE RECORDER it is fatal to the whole programme: B1121's stopping rule is *"instrument
 * it so it captures itself"*, and an instrument whose delivery can fail silently would have let a
 * week of the owner's normal use produce nothing while everyone waited for data that was never
 * arriving — the exact rot NEVER-PARK exists to prevent. Worse, the manual "that felt slow just
 * now" button reported ✓ off the LOCAL capture succeeding, so his highest-value signal was the one
 * most able to disappear without a trace.
 *
 * So the outcome is now RECORDED and READABLE:
 *   • `_lastSend` / `_delivery` hold what happened, exposed as `window.pfTelemetry.lastSend()` and
 *     `.delivery()` — a live check needs no database round trip and no dashboard;
 *   • `sink` returns a promise of `{ ok, status, error }` so a caller that CARES (the recorder)
 *     can tell "the server took it" from "nothing left the machine";
 *   • one bounded retry, because the common failure is a momentary network blip and the row is
 *     already built. One, not a queue: a telemetry channel that retries forever becomes the load.
 *
 * ⛔ IT STILL NEVER THROWS INTO THE APP, AND IT NEVER REPORTS ITS OWN FAILURE THROUGH ITSELF.
 * A failed write reporting a failed write is an infinite loop through the same broken pipe. The
 * failure is recorded locally and surfaced through the handle and the recorder's UI — never sunk. */
let _lastSend = null;      // { ok, at, source, status, error, attempts }
/* `suppressed` is deliberately NOT folded into `failed`. "the server refused the row" and "we
 * chose not to send it" support opposite conclusions, and a reader who cannot tell them apart is
 * back to the ambiguity this whole change is about. */
const _delivery = { attempted: 0, ok: 0, failed: 0, suppressed: 0, lastOkAt: 0, lastFailAt: 0 };

const SINK_RETRY_MS = 2500;

/** Read a PostgREST/supabase-js error into something a human can act on, without ever throwing. */
function sinkError(e) {
  try {
    if (!e) return null;
    const code = e.code ? String(e.code) : "";
    const msg = e.message ? String(e.message) : String(e);
    return { code, message: msg.slice(0, 300), status: Number.isFinite(e.status) ? e.status : null };
  } catch { return { code: "", message: "unreadable error", status: null }; }
}

async function insertOnce(row) {
  const { error } = await supabase.from("client_errors").insert(row);
  if (error) return { ok: false, error: sinkError(error) };
  return { ok: true, error: null };
}

/* Insert into public.client_errors via the existing anon client. Returns a promise of the outcome;
 * resolves (never rejects) so no caller needs a catch. `{ ok:false, reason:"no-cloud" }` when the
 * app has no Supabase configuration at all — a different thing from a rejected write, and a reader
 * must be able to tell them apart. */
function sink(row) {
  const stamp = (out) => {
    _lastSend = { ...out, at: Date.now(), source: row && row.source };
    _delivery.attempted++;
    if (out.ok) { _delivery.ok++; _delivery.lastOkAt = _lastSend.at; }
    else { _delivery.failed++; _delivery.lastFailAt = _lastSend.at; }
    return _lastSend;
  };
  try {
    /* B270912 — the automated-run gate, checked at SEND time rather than at install. A harness
     * sets its flags in an init script before the bundle runs, but reading them live is what makes
     * the opt-in an ordinary property rather than a load-order puzzle. Stamped and counted so a
     * suppressed send is READABLE (`pfTelemetry.lastSend()` / `.delivery()`) rather than a silent
     * no-op — this file's own rule is that nothing about a send may be invisible. */
    const sup = networkReportSuppression(_win || (typeof window !== "undefined" ? window : undefined));
    if (sup.suppress) {
      _lastSend = { ok: false, reason: SUPPRESSED_AUTOMATED, via: sup.via, error: null, attempts: 0, at: Date.now(), source: row && row.source };
      _delivery.suppressed++;
      return Promise.resolve(_lastSend);
    }
    if (!supabase) return Promise.resolve(stamp({ ok: false, reason: "no-cloud", error: null, attempts: 0 }));
    return insertOnce(row)
      .then((r) => {
        if (r.ok) return stamp({ ok: true, error: null, attempts: 1 });
        // One retry. A momentary blip is the common case and the row is already built; a
        // rejection (RLS, a missing column) will fail again and be recorded as such.
        return new Promise((res) => setTimeout(res, SINK_RETRY_MS))
          .then(() => insertOnce(row))
          .then((r2) => stamp({ ok: r2.ok, error: r2.ok ? null : r2.error, attempts: 2 }),
            (e) => stamp({ ok: false, error: sinkError(e), attempts: 2 }));
      }, (e) => stamp({ ok: false, error: sinkError(e), attempts: 1 }));
  } catch (e) { return Promise.resolve(stamp({ ok: false, error: sinkError(e), attempts: 0 })); }
}

/** What happened to the last row this page tried to send, and the running tally. Safe to ship —
 *  it reads module state and touches no network. */
export function lastTelemetrySend() { return _lastSend ? { ..._lastSend } : null; }
export function telemetryDelivery() { return { ..._delivery }; }

/* Wire the three global error sources to reportClientError. Idempotent; no-ops where
 * there's no window (tests/SSR). NOT capture-phase, so failed resource loads (blocked
 * tiles, broken images) don't spam telemetry — only real script errors and rejections. */
export function installClientErrorTelemetry(win = typeof window !== "undefined" ? window : undefined) {
  if (!win || typeof win.addEventListener !== "function" || _installed) return;
  _installed = true;
  _win = win;
  win.addEventListener("error", (e) => reportClientError(e && (e.error || e.message), { source: "window.onerror" }));
  win.addEventListener("unhandledrejection", (e) => reportClientError(e && e.reason, { source: "unhandledrejection" }));
  win.addEventListener("vite:preloadError", (e) => reportClientError((e && e.payload) || e, { source: "vite:preloadError" }));
  // Diagnostic handle (mirrors window.pfSupabase): inspect recent captures live without
  // a DB round-trip. Safe to ship.
  try {
    win.pfTelemetry = {
      reportClientError, reportClientEvent, tab: TAB_ID,
      recent: () => _recent.slice(),
      state: () => ({ sent: _state.sent, total: _state.total }),
      // B265536 — DID IT ACTUALLY LAND? Readable live, with no database round trip and no
      // dashboard, which is the whole point: a silent sink is what made this checkable at all.
      lastSend: lastTelemetrySend,
      delivery: telemetryDelivery,
      configured: () => !!supabase,
      // B270912 — is this page reporting to production, and if not, why not? Readable live so a
      // harness (and a human at a console) can tell "suppressed on purpose" from "broken".
      suppression: () => networkReportSuppression(win),
    };
  } catch { /* ignore */ }
}
