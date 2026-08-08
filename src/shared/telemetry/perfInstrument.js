/* Client PERFORMANCE telemetry (NEW-4) — so "the app feels slow" is never a guess again.
 *
 * ⛔ THE PROBLEM THIS EXISTS TO END. The speed program has spent five phases building harnesses
 * that measure a REFERENCE plan, logged out, in a sandbox with every external host blocked — and
 * every one of them has had to close on the same caveat: the reference is a FLOOR, not a match,
 * for the machine that actually has the symptom. Meanwhile the only signal from the machine that
 * does have it has been the owner pasting a console snippet on request. That is the work being
 * pushed back onto him, and it stops here.
 *
 * B1429 did exactly this for storage and it turned "my storage is full" from a guess into a
 * number (3.88 MB across 156 keys against a ~5 MB cap). This is the same move for speed.
 *
 * WHAT IT RECORDS, and why each one is here rather than merely available:
 *   • LONG TASKS (PerformanceObserver 'longtask') — every ≥50 ms block of the main thread. This
 *     is the closest thing the platform has to "the app froze", and it is the metric no CPU
 *     profile taken later can recover.
 *   • INP, via Event Timing ('event') — Interaction to Next Paint, the web vital that IS
 *     responsiveness. Computed the way the spec's own guidance says: the worst interaction, or
 *     the 98th percentile once a session has enough of them, so one unlucky click does not
 *     define an hour's work.
 *   • THE SCENE, sampled periodically — JS heap, canvas node count, elements drawn, layers
 *     enabled, panels open, edits since load, seconds since load. These are THE AXES of the
 *     amplification hypothesis (NEW-1/NEW-2): per-frame cost looks like a function of what the
 *     session has filled up with, and "time since reload" is only the proxy. Without them a
 *     slow sample says "it was slow" and nothing else; with them it says "it was slow with 140
 *     elements, 9 layers and 4 panels open, 38 minutes in".
 *
 * ⚠ THREE RULES THIS FILE MUST NOT BREAK, in priority order:
 *   1. IT MUST NEVER COST ANYTHING THE USER CAN FEEL. Observers are passive and buffered; the
 *      periodic sample is ONE querySelectorAll set on a timer measured in minutes, and it is
 *      skipped entirely while the tab is hidden. No work happens per frame, per pointer event,
 *      or per render.
 *   2. IT MUST NEVER CROWD OUT AN ERROR REPORT. `decideReport` in clientErrors.js enforces ONE
 *      shared per-page ceiling (SESSION_MAX) across every row this app sends, so an uncapped
 *      perf drip would silently consume the budget a real crash needs. So this file carries its
 *      OWN much smaller ceiling (PERF_MAX_ROWS) and its own enrolment sampling, and both are
 *      well under the shared one. A telemetry feature that blinds the error channel is a
 *      regression however good its data is.
 *   3. IT MUST NEVER THROW INTO THE APP. Same rule the error sink lives by: telemetry that
 *      throws is worse than no telemetry. Every path here swallows its own failures.
 *
 * The pure decision layer (everything above the "impure layer" line) is unit-tested in
 * test/perfInstrument.test.js; the browser wiring below is a thin shell over it.
 */
import { reportClientEvent } from "./clientErrors.js";
import { isEnrolled, PERF_SAMPLE_RATE, notePerfEdit, perfEditCount } from "./perfSampling.js";
import { readScene } from "./perfScene.js";

export { isEnrolled, PERF_SAMPLE_RATE, notePerfEdit };

/* ── Constants, all deliberately conservative ─────────────────────────────────────────────── */

/** Hard ceiling on perf rows per page load — see rule 2. Far under clientErrors' SESSION_MAX. */
export const PERF_MAX_ROWS = 6;
/** How often the scene is sampled. Minutes, not seconds: this is a trend, not a profiler. */
export const PERF_SAMPLE_MS = 120_000;
/** A long task worth reporting on its own. Below this it only rides the periodic summary. */
export const PERF_LONGTASK_MS = 200;
/** Report a spontaneous row at most this often, whatever fires. */
export const PERF_MIN_GAP_MS = 60_000;

/* ── Pure: INP ────────────────────────────────────────────────────────────────────────────── */

/* Interaction to Next Paint, from a list of interaction durations (ms).
 *
 * The web-vitals guidance: report the WORST interaction, except on long sessions, where the 98th
 * percentile is used so a single outlier does not define the score. Implemented here rather than
 * pulled in as a dependency — this is ten lines, and the runtime dependency list in this repo is
 * kept few and deliberate.
 *
 * Returns null for an empty list rather than 0. A zero INP would read as "perfectly responsive"
 * when it means "nobody interacted", and those must never look the same in a chart. */
export function inpFrom(durations, { longSessionAt = 50 } = {}) {
  const v = (durations || []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => b - a);
  if (!v.length) return null;
  if (v.length < longSessionAt) return +v[0].toFixed(1);
  const idx = Math.floor(v.length / 50); // 98th percentile from the top
  return +v[Math.min(idx, v.length - 1)].toFixed(1);
}

/* ── Pure: the send decision ──────────────────────────────────────────────────────────────── */

/* Should this perf row go out, given what has already gone out?
 *
 * Three gates, and the order matters: the per-page ROW CEILING first (rule 2 — it must be
 * impossible to spend the error budget), then the minimum GAP (so a burst of long tasks becomes
 * one row, not forty), then the "is there anything to say" test. A periodic tick with nothing
 * notable in it is still sent — a quiet row is the baseline every noisy row is read against, and
 * an instrument that only reports trouble cannot tell you trouble is unusual.
 */
export function decidePerfSend({ now, state = {}, kind = "tick", maxRows = PERF_MAX_ROWS, minGapMs = PERF_MIN_GAP_MS } = {}) {
  const sent = state.sent || 0;
  const lastAt = state.lastAt || 0;
  if (sent >= maxRows) return { send: false, why: "per-page perf row ceiling reached", state };
  /* The FINAL row (a pagehide flush) ignores the gap: it is the only chance to report what the
   * session ended up looking like, and it is bounded by the ceiling like everything else. */
  if (kind !== "final" && lastAt && now - lastAt < minGapMs) return { send: false, why: "inside the minimum gap", state };
  return { send: true, state: { sent: sent + 1, lastAt: now } };
}

/* ── Pure: the row ────────────────────────────────────────────────────────────────────────── */

/* The compact payload. Deliberately SHORT KEYS and rounded numbers: this rides in the existing
 * `client_errors.message` column as JSON (the B468 pattern — no schema change, no owner SQL step),
 * and that column is truncated at 2000 characters. A payload that gets truncated is a payload
 * that cannot be parsed, so brevity here is correctness, not tidiness.
 *
 * Every field is optional and every missing one stays ABSENT rather than becoming null/0: a
 * counter that could not be read must not be indistinguishable from a counter that read zero.
 * (`heapMB` is Chromium-only; `inp` is null until someone interacts.) */
export function buildPerfRow(sample = {}) {
  const num = (v, d = 0) => (Number.isFinite(v) ? +v.toFixed(d) : undefined);
  const row = {
    k: sample.kind || "tick",
    t: num(sample.secondsSinceLoad),          // seconds since load — the owner's "a minute or two later"
    inp: num(sample.inp, 1),                  // ms
    lt: num(sample.longtaskMs),               // total long-task ms since load
    ltn: num(sample.longtasks),               // how many
    ltx: num(sample.longtaskMaxMs),           // the worst single block
    heap: num(sample.heapMB, 1),
    dom: num(sample.documentNodes),
    cv: num(sample.canvasNodes),              // SVG nodes in the planner canvas — the draw cost proxy
    el: num(sample.elementsDrawn),            // ← the amplification axes
    ly: num(sample.layersOn),
    pn: num(sample.panelsOpen),
    ed: num(sample.editsSinceLoad),
    tl: num(sample.tiles),
    dpr: num(sample.dpr, 2),
    vw: num(sample.viewportW),
  };
  for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
  return row;
}

/* ── Pure: reading the scene from the DOM ─────────────────────────────────────────────────────
 * Moved to `./perfScene.js` (NEW-1) so the always-on recorder can share it without pulling this
 * sampled instrument — and its 25% enrolment gate — into every tab. Re-exported here because it
 * has been part of this module's surface since NEW-4, and its tests address it that way. */
export { readScene };

// ——— impure layer (browser only) ————————————————————————————————————————————————

let _state = { sent: 0, lastAt: 0 };
let _installed = false;
let _t0 = 0;
let _lt = { total: 0, count: 0, max: 0 };
let _interactions = [];
let _timer = 0;
let _recent = [];

/** Everything the instrument currently knows, for a live check without a DB round-trip
 *  (mirrors `window.pfTelemetry.recent()`). Exposed on `window.pfPerf`. */
export function perfSnapshot(win = typeof window !== "undefined" ? window : undefined) {
  const doc = win && win.document;
  const now = win && win.performance ? win.performance.now() : 0;
  return {
    kind: "snapshot",
    secondsSinceLoad: (now - _t0) / 1000,
    inp: inpFrom(_interactions),
    longtaskMs: _lt.total, longtasks: _lt.count, longtaskMaxMs: _lt.max,
    heapMB: win?.performance?.memory ? win.performance.memory.usedJSHeapSize / 1048576 : undefined,
    editsSinceLoad: perfEditCount(),
    dpr: win?.devicePixelRatio,
    viewportW: win?.innerWidth,
    ...readScene(doc),
  };
}

function send(win, kind) {
  try {
    const now = Date.now();
    const d = decidePerfSend({ now, state: _state, kind });
    if (!d.send) return;
    _state = d.state;
    const row = buildPerfRow({ ...perfSnapshot(win), kind });
    _recent.push(row);
    if (_recent.length > 10) _recent.shift();
    reportClientEvent("perf", JSON.stringify(row));
  } catch (_) { /* telemetry must never throw into the app */ }
}

/* Wire it up. Idempotent; a no-op where there is no window, and a no-op for the ~75% of page
 * loads not enrolled — in which case NOTHING is installed at all, so an unenrolled tab pays
 * literally zero, not "a cheap observer whose callbacks we throw away". */
export function installPerfInstrument(win = typeof window !== "undefined" ? window : undefined, { tabId, rate = PERF_SAMPLE_RATE, sampleMs = PERF_SAMPLE_MS } = {}) {
  if (!win || typeof win.addEventListener !== "function" || _installed) return false;
  if (!isEnrolled(tabId, rate)) return false;
  _installed = true;
  try { _t0 = win.performance ? win.performance.now() : 0; } catch (_) { _t0 = 0; }

  try {
    new win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        _lt.total += e.duration; _lt.count++;
        if (e.duration > _lt.max) _lt.max = e.duration;
        /* A single block this long is worth its own row — it is the freeze the user felt, and the
         * periodic tick two minutes later cannot tell you WHEN it happened or what the scene was
         * at the time. Still gated by the ceiling and the minimum gap. */
        if (e.duration >= PERF_LONGTASK_MS) send(win, "longtask");
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (_) { /* Safari has no longtask; the rest still works */ }

  try {
    new win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.interactionId) _interactions.push(e.duration);
      if (_interactions.length > 400) _interactions = _interactions.sort((a, b) => b - a).slice(0, 200);
    }).observe({ type: "event", durationThreshold: 40, buffered: true });
  } catch (_) { /* Event Timing is not everywhere; INP simply stays null */ }

  /* The periodic scene sample. `setInterval`, not rAF and not a per-frame hook — and it SKIPS a
   * tick while the tab is hidden, both because a hidden tab's numbers describe nothing and
   * because a background tab is exactly where a timer earns its reputation for waste. */
  try {
    _timer = win.setInterval(() => {
      try { if (win.document && win.document.visibilityState !== "visible") return; } catch (_) { /* ignore */ }
      send(win, "tick");
    }, sampleMs);
  } catch (_) { /* ignore */ }

  /* One last row as the page goes away — `pagehide`, not `unload`, which is unreliable on mobile
   * and blocks the back/forward cache. This is the row that says what the session ENDED as, which
   * is the shape of the owner's complaint ("give it a minute or two and it's lagging"). */
  try { win.addEventListener("pagehide", () => send(win, "final"), { once: true }); } catch (_) { /* ignore */ }

  try { win.pfPerf = { snapshot: () => perfSnapshot(win), recent: () => _recent.slice(), sent: () => _state.sent }; } catch (_) { /* ignore */ }
  return true;
}

/** Test-only teardown, so a suite can install more than once without leaking a timer. */
export function __resetPerfInstrument(win) {
  try { if (_timer && win) win.clearInterval(_timer); } catch (_) { /* ignore */ }
  _installed = false; _timer = 0; _t0 = 0;
  _lt = { total: 0, count: 0, max: 0 };
  _interactions = []; _recent = []; _state = { sent: 0, lastAt: 0 };
}
