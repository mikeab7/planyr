/* THE ALWAYS-ON PERFORMANCE RECORDER (NEW-1) — stop trying to reproduce it, instrument it.
 *
 * ⛔ WHY THIS EXISTS, stated as bluntly as the dispatch that ordered it. The owner has reported
 * the same thing for weeks: *"if I reload, it's immediately pretty quick and then a minute later
 * or two, it's lagging just to go side to side."* The symptom has now failed to reproduce TWICE
 * under purpose-built instruments — the sandbox battery returned an honest null (B1121 §1:
 * 1,323 ms → 1,486 ms against a ±6.3% floor, non-monotone), and a live signed-in drive on his own
 * machine found zero dropped frames in 1,120, one long task and that one a garbage collection.
 *
 * WHEN THE USER HITS IT AND THE INSTRUMENT DOES NOT, THE INSTRUMENT IS THE PROBLEM. Every
 * measurement this programme has taken has been of a scene WE chose, at a moment WE chose. This
 * inverts that: the app records ITSELF, continuously, and keeps the last stretch of its own
 * behaviour in a ring buffer so that when the moment arrives — automatically, or because he says
 * so — the thirty seconds BEFORE it are already in hand. By the time anyone reaches for a
 * profiler the episode is over; that is the whole reason for a ring rather than a start button.
 *
 * ⛔ THE RECORDER MUST NOT BECOME THE DEFECT IT IS LOOKING FOR. Four structural decisions, each
 * of which is measured rather than asserted (`ui-audit/verify-perf-recorder.mjs`, and
 * `test/perfRecorder.test.js` for the CI-runnable half):
 *
 *   1. NO PER-FRAME ALLOCATION. Every buffer is preallocated at install and written by index
 *      (perfRing.js). Sixty short-lived objects a second for an hour is a garbage-collection
 *      schedule, and a GC pause is indistinguishable from the jank being hunted.
 *   2. THE FRAME LOOP IS GATED ON INTERACTION. An idle tab runs NO animation frames at all: the
 *      loop starts on a pointer/wheel/key event and stops ~1.2 s after the last one. This is not
 *      only cheaper, it is better data — an idle tab's frame deltas describe the browser's
 *      throttling policy, and averaging those into a baseline calibrates the trigger against
 *      nothing.
 *   3. THE SCENE READ IS ON A SLOW TIMER, NOT A FRAME HOOK, and is skipped entirely while the tab
 *      is hidden.
 *   4. THE OBSERVERS ARE PASSIVE AND BUFFERED. Long animation frames fire at most a handful of
 *      times a second by definition.
 *
 * ⛔ AND IT MUST NEVER THROW INTO THE APP — the rule the error sink already lives by. Every path
 * here swallows its own failures.
 *
 * WHAT LEAVES THE MACHINE: counters, timings and view state only, built from a fixed allowlist
 * and PROVED against it before every send (perfCapture.js). No drawing geometry, no parcel or
 * appraisal records, no owner names or addresses, no callout text, no raster bytes.
 */
/* global __BUILD_ID__ */
import { reportClientEvent } from "./clientErrors.js";
import { readScene } from "./perfScene.js";
import { perfEditCount } from "./perfSampling.js";
import { bindPerfRecorder, bindPerfDelivery, perfContext } from "./perfRecorderHandle.js";
import {
  createFrameRing, pushFrame, createTaskRing, pushTask, createCounterRing, pushCounters,
  createStringTable, internString, ringOrder, ringOrderSince, COUNTER_COLUMNS,
} from "./perfRing.js";
import { createTrigger, feedFrame, sealBaselineLate, triggerState } from "./perfTrigger.js";
import { buildCapture, encodeCapture, assertCaptureClean, frameStats, CAPTURE_MAX_CHARS } from "./perfCapture.js";
import { savePerfCapture } from "./perfCaptureStore.js";

const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

export const RECORDER_DEFAULTS = {
  /** ~4,096 interacting frames. At 50–60 Hz that is well over a minute of gesture time, and
   *  because the loop only runs while he is interacting it spans far more wall time than that. */
  frameCap: 4096,
  taskCap: 192,
  counterCap: 96,            // 96 × 2 s ≈ 3 minutes of scene history
  /** How much of the ring a capture keeps. The dispatch asked for "roughly the last 30–60
   *  seconds"; 45 s of INTERACTING time is the middle of that and is what the trigger's own
   *  window sits inside. */
  captureWindowMs: 45_000,
  /** The frame loop keeps running this long after the last input, so the tail of a gesture — the
   *  part where a slow app is still catching up — is recorded rather than cut off. */
  idleStopMs: 1_200,
  counterMs: 2_000,
  /** The DOM scene read (querySelectorAll over the document) is the only non-trivial cost in the
   *  counter tick, so it runs every Nth tick rather than every tick. */
  sceneEveryNTicks: 3,
  maxManual: 6,
  /** Total rows this page may send. `clientErrors` enforces one shared per-page ceiling across
   *  every row the app sends (SESSION_MAX 100); a recorder that could spend it would blind the
   *  error channel, which is a worse regression than any data it collects is worth. */
  maxSent: 9,
};

/* ── module state (one recorder per page) ───────────────────────────────────────────────────── */
let _win = null;
let _installed = false;
let _cfg = RECORDER_DEFAULTS;
let _frames = null, _tasks = null, _counters = null, _strings = null, _trig = null;
let _scratch = null;                 // reused counter row — see pushCounters
let _activeUntil = 0;                // ms (recorder clock) the interaction window closes at
let _running = false;                // is the rAF loop scheduled?
let _prevFrameT = 0;                 // 0 = next frame starts a new run, so its delta is dropped
let _rafId = 0, _timer = 0, _tick = 0;
let _activeMs = 0;                   // cumulative interacting time
let _lastScene = {};
let _taskTotal = 0, _taskCount = 0, _taskMax = 0;
let _sent = 0, _manual = 0;
let _lastDelivery = null;            // promise of the last capture's delivery outcome (B265536)
let _undelivered = 0;                // captures the server never acknowledged
let _captures = [];                  // recent capture summaries, for a live console read
let _gapMarks = [];                  // [tAtRestart, gapMs] — where the frame loop stopped and resumed
let _lastFrameT = 0;                 // wall position of the last recorded frame, for gap sizing
let _selfUs = 0;                     // measured per-frame cost of THIS recorder, µs (bench only)

const now = () => { try { return _win.performance.now(); } catch (_) { return 0; } };

/* ── the hot path ───────────────────────────────────────────────────────────────────────────
 * Called once per animation frame while interacting. Everything in here is arithmetic over
 * preallocated typed arrays — no object is created, no closure is allocated, nothing is pushed to
 * a JS array. `ui-audit/verify-perf-recorder.mjs` measures its cost directly and asserts a bound;
 * `test/perfRecorder.test.js` asserts the allocation property structurally. */
function onFrame(t) {
  const prev = _prevFrameT;
  _prevFrameT = t;
  if (prev === 0) return false;              // first frame of a run: its delta measures the gap
  const dt = t - prev;
  _activeMs += dt;
  _lastFrameT = t;
  pushFrame(_frames, t, dt);
  return feedFrame(_trig, t, dt);
}

function loop() {
  _rafId = 0;
  let t = 0;
  try { t = _win.performance.now(); } catch (_) { /* ignore */ }
  let fire = false;
  try { fire = onFrame(t); } catch (_) { /* a recorder fault must never break the frame */ }
  if (fire) { try { capture("auto"); } catch (_) { /* ignore */ } }
  if (t < _activeUntil) schedule();
  else { _running = false; _prevFrameT = 0; }
}

function schedule() {
  if (_rafId) return;
  try { _rafId = _win.requestAnimationFrame(loop); } catch (_) { _running = false; }
}

/* One store, then (only when the loop is not already running) one rAF schedule. This is the whole
 * cost an interacting page pays per input event. */
function noteActivity() {
  let t = 0;
  try { t = _win.performance.now(); } catch (_) { return; }
  _activeUntil = t + _cfg.idleStopMs;
  if (!_running) {
    _running = true;
    _prevFrameT = 0;
    /* Record where the loop restarted so a capture can tell a four-second GAP between gestures
     * from a four-second FRAME. Without this the frame track reads as one continuous stream and
     * a coffee break looks like a stall. Bounded: only the last few restarts are kept, and this
     * runs once per gesture, not once per event. */
    if (_lastFrameT) {
      _gapMarks.push([t, Math.round(t - _lastFrameT)]);
      if (_gapMarks.length > 64) _gapMarks.shift();
    }
    schedule();
  }
}

/* ── periodic counters ──────────────────────────────────────────────────────────────────────── */
function counterTick() {
  try {
    if (_win.document && _win.document.visibilityState !== "visible") return;
    const t = now();
    _tick++;
    if (_tick % _cfg.sceneEveryNTicks === 1 || !_lastScene.documentNodes) {
      _lastScene = readScene(_win.document);
    }
    const ctx = perfContext();
    const s = _scratch;
    s[0] = heapMB();
    s[1] = num(_lastScene.documentNodes);
    s[2] = num(_lastScene.canvasNodes);
    s[3] = num(_lastScene.elementsDrawn);
    s[4] = num(_lastScene.layersOn);
    s[5] = num(_lastScene.panelsOpen);
    s[6] = num(_lastScene.tiles);
    s[7] = Number.isFinite(ctx.ppf) ? ctx.ppf : NaN;
    s[8] = perfEditCount();
    s[9] = ctx.planSwitches;
    s[10] = _activeMs / 1000;
    pushCounters(_counters, t, s);
    /* If he simply has not interacted enough for the baseline to seal, seal it late rather than
     * leave the trigger permanently unarmed — a recorder that can never fire is exactly the
     * failure mode the anti-rot guard exists to catch. */
    sealBaselineLate(_trig, t);
  } catch (_) { /* a counter tick must never throw into the app */ }
}

const num = (v) => (Number.isFinite(v) ? v : NaN);
function heapMB() {
  try { return _win.performance.memory ? _win.performance.memory.usedJSHeapSize / 1048576 : NaN; }
  catch (_) { return NaN; }
}

/* ── long animation frames ──────────────────────────────────────────────────────────────────
 * `long-animation-frame` where the platform has it (Chromium 123+), which is the only source that
 * NAMES the script responsible; `longtask` as the fallback, which can only say "something blocked
 * the main thread for N ms". The owner's browser is Chrome, so the good one is the one that will
 * actually run — but a recorder that reports nothing on Safari would be a silent hole. */
function observeTasks() {
  const record = (t, dur, blk, name) => {
    _taskTotal += dur; _taskCount++;
    if (dur > _taskMax) _taskMax = dur;
    pushTask(_tasks, t, dur, blk, internString(_strings, name));
  };
  let loaf = false;
  try {
    new _win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        let name = "";
        try {
          const top = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
          if (top) name = top.sourceFunctionName || top.invoker || top.sourceURL || "";
        } catch (_) { /* attribution is optional; the timing is not */ }
        record(e.startTime, e.duration, e.blockingDuration || 0, name);
      }
    }).observe({ type: "long-animation-frame", buffered: true });
    loaf = true;
  } catch (_) { /* not this browser */ }
  if (loaf) return;
  try {
    new _win.PerformanceObserver((list) => {
      for (const e of list.getEntries()) record(e.startTime, e.duration, 0, (e.attribution && e.attribution[0] && e.attribution[0].name) || "");
    }).observe({ type: "longtask", buffered: true });
  } catch (_) { /* Safari has neither; the rest of the recorder still works */ }
}

/* ── taking a capture ───────────────────────────────────────────────────────────────────────── */

/** Take a capture. `reason` is "auto" (the trigger fired) or "manual" (he pressed the control).
 *  Returns true if one was taken. Never throws. */
export function capture(reason) {
  try {
    if (!_installed) return false;
    const kind = reason === "manual" ? "manual" : "auto";
    if (kind === "manual" && _manual >= _cfg.maxManual) return false;
    if (_sent >= _cfg.maxSent) return false;
    if (kind === "manual") _manual++;

    const t = now();
    const since = t - _cfg.captureWindowMs;
    const order = ringOrderSince(_frames, since);
    const deltas = order.map((i) => _frames.dt[i]);
    const slowBar = _trig.baseline == null ? 0 : _trig.baseline * _trig.cfg.multiplier;

    /* Where the frame track is DISCONTINUOUS — [index into the kept frames, gap ms] — so a
     * reader never mistakes the pause between two gestures for one enormous frame. */
    const gaps = [];
    for (const [gt, gms] of _gapMarks) {
      if (gt < since || gms < 250) continue;
      let idx = 0;
      while (idx < order.length && _frames.t[order[idx]] < gt) idx++;
      gaps.push([idx, Math.min(600000, gms)]);
    }

    /* Long tasks inside the same window, worst-first and capped — the biggest blocks are the ones
     * worth the characters. */
    const taskOrder = ringOrderSince(_tasks, since)
      .sort((a, b) => _tasks.dur[b] - _tasks.dur[a]).slice(0, 24);
    const tasks = taskOrder.map((i) => [Math.round(_tasks.t[i] - since), _tasks.dur[i], _tasks.blk[i], _tasks.attr[i]]);

    const cOrder = ringOrder(_counters).filter((i) => _counters.t[i] >= since);
    const counters = cOrder.map((i) => [Math.round(_counters.t[i] - since), ..._counters.cols.map((c) => c[i])]);
    const last = cOrder.length ? cOrder[cOrder.length - 1] : null;
    const colAt = (n) => (last == null ? NaN : _counters.cols[COUNTER_COLUMNS.indexOf(n)][last]);

    const ts = triggerState(_trig);
    const ctx = perfContext();
    const scene = readScene(_win.document);
    const v = _trig.lastVerdict || {};

    const cap = buildCapture({
      kind,
      atMs: t,
      atWall: Date.now(),
      activeMs: _activeMs,
      route: routeId(),
      build: BUILD_ID,
      visibility: safeVisibility(),
      planId: ctx.planId,
      baselineMs: ts.baselineMs,
      baselineFrames: ts.baselineFrames,
      baselineSealedAtMs: ts.baselineSealedAtMs,
      baselineLate: ts.baselineLate,
      windowMeanMs: kind === "auto" ? v.windowMeanMs : ts.windowMeanMs,
      slowFraction: kind === "auto" ? v.slowFraction : ts.slowFraction,
      ratio: kind === "auto" ? v.ratio : (ts.baselineMs && ts.windowMeanMs ? ts.windowMeanMs / ts.baselineMs : null),
      multiplier: ts.multiplier,
      sustainMs: ts.sustainMs,
      floorMs: ts.floorMs,
      fires: ts.fires,
      frameStats: frameStats(deltas, slowBar),
      longTasks: _taskCount,
      longTaskMs: _taskTotal,
      longTaskMaxMs: _taskMax,
      heapMB: heapMB(),
      domNodes: scene.documentNodes,
      canvasNodes: scene.canvasNodes,
      elementsDrawn: scene.elementsDrawn,
      layersOn: scene.layersOn,
      layers: ctx.layers,          // B265539 — WHICH ones, so a fixture arm can be his rather than a guess
      panelsOpen: scene.panelsOpen,
      tiles: scene.tiles,
      ppf: Number.isFinite(ctx.ppf) ? ctx.ppf : colAt("ppf"),
      editsSinceLoad: perfEditCount(),
      planSwitches: ctx.planSwitches,
      dpr: safeNum(() => _win.devicePixelRatio),
      viewportW: safeNum(() => _win.innerWidth),
      viewportH: safeNum(() => _win.innerHeight),
      hardwareThreads: safeNum(() => _win.navigator.hardwareConcurrency),
      deviceMemoryGB: safeNum(() => _win.navigator.deviceMemory),
      recorderSelfUs: _selfUs || undefined,
      counterSamples: counters.length,
      frameDeltas: deltas,
      gaps,
      tasks,
      taskNames: _strings.list,
      counters,
      counterColumns: ["t", ...COUNTER_COLUMNS],
      /* B265540 — the payload's own state comes FIRST. An empty frame track is the one thing a
       * reader cannot infer from the other fields, and a manual capture in a still moment produces
       * one legitimately (the frame loop is gated on interaction). Saying so is what stops it being
       * read as a lost track. */
      note: deltas.length === 0 ? "no-frames" : (ts.baselineMs == null ? "no-baseline" : (ts.baselineLate ? "baseline-late" : "")),
    });

    /* ⛔ THE PRIVACY BOUNDARY IS CHECKED, NOT TRUSTED. A capture that fails the allowlist is
     * dropped and the failure itself reported — a telemetry payload nobody verifies is not a
     * boundary, it is a hope. */
    const violations = assertCaptureClean(cap);
    if (violations.length) {
      reportClientEvent("perfcap-blocked", `capture withheld: ${violations.slice(0, 3).join("; ")}`);
      return false;
    }

    /* The device keeps the FULL capture; the row that travels is compressed to fit one telemetry
     * column. Both are attempted, and neither depends on the other. */
    savePerfCapture(cap, { seq: _sent }).then((r) => {
      if (!r.ok) reportClientEvent("perfcap-store", "local capture store unavailable");
    }, () => {});

    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    _sent++;

    /* ⛔ B265536 — THE DELIVERY IS TRACKED, NOT ASSUMED. Until this, `capture()` returned true the
     * moment the row was handed to the sink, and the sink swallowed every failure — so the manual
     * button said "Recorded — thanks" whether the row reached Supabase or fell on the floor. That
     * made the single highest-value signal in this programme (the owner pressing "that felt slow
     * just now") the one most able to vanish without trace, and it would have taken a week of his
     * normal use producing nothing before anyone noticed. The record now carries what actually
     * happened, and `perfCaptureDelivery()` hands the promise to the UI so the ✓ means DELIVERED. */
    const rec = { kind, atMs: Math.round(t), ratio: cap.ratio, p95Ms: cap.p95Ms, frames: cap.frames, chars: enc.chars, delivered: null, reason: null };
    _captures.push(rec);
    if (_captures.length > 10) _captures.shift();

    _lastDelivery = Promise.resolve(reportClientEvent("perfcap", enc.text)).then((out) => {
      const r = out || { ok: false, reason: "unknown" };
      rec.delivered = !!r.ok;
      rec.reason = r.ok ? null : (r.reason || (r.error && (r.error.code || r.error.message)) || "rejected");
      if (!r.ok) _undelivered++;
      return { ...r, kind, chars: enc.chars };
    }, () => { rec.delivered = false; rec.reason = "threw"; _undelivered++; return { ok: false, reason: "threw", kind }; });
    bindPerfDelivery(() => _lastDelivery);
    return true;
  } catch (_) { return false; }
}

function routeId() {
  try {
    const h = String(_win.location.hash || "").replace(/^#\/?/, "");
    const seg = h.split(/[/?]/)[0];
    return /^[a-z-]{1,24}$/.test(seg) ? seg : "site";
  } catch (_) { return ""; }
}
const safeVisibility = () => { try { return _win.document.visibilityState === "visible" ? "visible" : "hidden"; } catch (_) { return ""; } };
const safeNum = (fn) => { try { const v = fn(); return Number.isFinite(v) ? v : NaN; } catch (_) { return NaN; } };

/* ── install ────────────────────────────────────────────────────────────────────────────────── */

/* Wire it up. Idempotent; a no-op where there is no window.
 *
 * `?perfrec=off` disables it entirely — a field kill switch, and the OFF arm of the overhead
 * measurement. `window.__PLANYR_PERFREC` accepts config overrides; it is how
 * `ui-audit/verify-perf-recorder.mjs` compresses a 50-second calibration into a few seconds so it
 * can drive the REAL trigger rather than a test double. Neither is reachable by accident. */
export function installPerfRecorder(win = typeof window !== "undefined" ? window : undefined, overrides) {
  if (!win || typeof win.addEventListener !== "function" || _installed) return false;
  try { if (String(win.location.search || "").indexOf("perfrec=off") > -1) return false; } catch (_) { /* ignore */ }

  let over = overrides || null;
  try { if (!over && win.__PLANYR_PERFREC) over = win.__PLANYR_PERFREC; } catch (_) { /* ignore */ }
  const triggerOver = (over && over.trigger) || null;

  _win = win;
  _cfg = { ...RECORDER_DEFAULTS, ...(over || {}) };
  _installed = true;

  _frames = createFrameRing(_cfg.frameCap);
  _tasks = createTaskRing(_cfg.taskCap);
  _counters = createCounterRing(_cfg.counterCap);
  _strings = createStringTable();
  _scratch = new Float64Array(COUNTER_COLUMNS.length);
  _trig = createTrigger(triggerOver);

  /* Passive + capture-phase, so the app's own handlers can neither delay nor cancel the note.
   * `pointermove` is included because a pan is one long move stream with a single down at the
   * start, and the loop must stay alive for its whole length. */
  const opts = { passive: true, capture: true };
  for (const ev of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "touchstart", "touchmove"]) {
    try { win.addEventListener(ev, noteActivity, opts); } catch (_) { /* ignore */ }
  }

  observeTasks();

  try { _timer = win.setInterval(counterTick, _cfg.counterMs); } catch (_) { /* ignore */ }

  /* A visibility change is a frame-time discontinuity, not a slow app: end the run so the first
   * frame back is treated as the start of a new one and its enormous delta is dropped. */
  try {
    win.document.addEventListener("visibilitychange", () => {
      if (win.document.visibilityState !== "visible") { _activeUntil = 0; _prevFrameT = 0; }
    }, { passive: true });
  } catch (_) { /* ignore */ }

  bindPerfRecorder((reason) => capture(reason));

  /* Live handles for a console read and for the harness. `__benchFrame` runs the REAL hot path
   * over synthetic timestamps so its cost can be measured directly rather than inferred from a
   * noisy A/B — see ui-audit/verify-perf-recorder.mjs. */
  try {
    win.pfRec = {
      state: () => ({ ...triggerState(_trig), frames: _frames.count, tasks: _tasks.count, counters: _counters.count, activeMs: Math.round(_activeMs), sent: _sent, undelivered: _undelivered, running: _running }),
      delivery: () => _lastDelivery,
      captures: () => _captures.slice(),
      capture: (reason) => capture(reason),
      config: () => ({ ..._cfg, trigger: { ..._trig.cfg } }),
      __benchFrame: (n) => benchFrame(n),
    };
  } catch (_) { /* ignore */ }
  return true;
}

/* Measure the per-frame cost of the recorder's own hot path, in microseconds. Drives `onFrame`
 * with synthetic monotonically-increasing timestamps on a THROWAWAY trigger + ring, so the
 * benchmark cannot pollute the real capture. Returns µs per frame. */
function benchFrame(n = 20000) {
  const saveF = _frames, saveT = _trig, savePrev = _prevFrameT, saveActive = _activeMs;
  try {
    _frames = createFrameRing(_cfg.frameCap);
    _trig = createTrigger({ ..._trig.cfg, maxAuto: 0 });
    _prevFrameT = 0;
    const t0 = now();
    for (let i = 0; i < n; i++) onFrame(1000 + i * 16.7);
    const ms = now() - t0;
    _selfUs = Math.round((ms / n) * 1000 * 100) / 100;
    return _selfUs;
  } catch (_) { return -1; }
  finally { _frames = saveF; _trig = saveT; _prevFrameT = savePrev; _activeMs = saveActive; }
}

/** Test-only teardown. */
export function __resetPerfRecorder(win) {
  try { if (_timer && win) win.clearInterval(_timer); } catch (_) { /* ignore */ }
  try { if (_rafId && win) win.cancelAnimationFrame(_rafId); } catch (_) { /* ignore */ }
  _installed = false; _win = null; _timer = 0; _rafId = 0; _tick = 0;
  _frames = _tasks = _counters = _strings = _trig = _scratch = null;
  _activeUntil = 0; _running = false; _prevFrameT = 0; _activeMs = 0; _lastFrameT = 0;
  _lastScene = {}; _taskTotal = 0; _taskCount = 0; _taskMax = 0;
  _sent = 0; _manual = 0; _captures = []; _gapMarks = []; _selfUs = 0;
  _lastDelivery = null; _undelivered = 0;
  bindPerfRecorder(null);
  bindPerfDelivery(null);
}
