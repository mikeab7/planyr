/* plannerPerf.js — NEW-1 (2026-11-01): `window.__plannerPerf()`, the ONE call that says what filled the planner's frames.
 *
 * ⛔ WHY IT EXISTS. The owner's graded plan felt slow; his perfcap rows read `freezeVia: "task"`, 127 "long tasks", 122 s of them —
 * and every one, read back from the stored rows, was a long-animation-frame entry of ~1,000 ms with blockingDuration 0 and NO script
 * attributed, back to back, while the recorder's 2 s timer fired on time. That is a page whose code was IDLE while each frame took a
 * second to be drawn — and the capture called it busy JavaScript. A session spent a round hunting JS that was not there. This hook
 * answers the question in one call instead: for the last minute, every long frame (≥ LONG_FRAME_MS) with its top three scripts
 * (`sourceURL`, `sourceFunctionName`, `invoker`, `invokerType`, `forcedStyleAndLayoutDuration`), how much of it the main thread was
 * actually BLOCKED vs waiting on drawing (the `renderStart` / `styleAndLayoutStart` split), which grading layers were on screen when
 * it happened, the timers firing more than once a second, and the recorder's own frame count. The verdict line says which it was.
 *
 * Gate and arming are `__plannerGradeReadout`'s (FOREGROUND-OR-VOID §5): installed only while the owner-only grading gate is on,
 * READ-ONLY, and armed at CALL time — `?planyrDiag=1` (latched for the tab) or the E2E flag; otherwise the call returns null.
 *
 * COST WHEN NOT ARMED: one PerformanceObserver on `long-animation-frame` that the browser calls only for frames ≥ 50 ms, storing
 * only those ≥ LONG_FRAME_MS into a bounded ring (a cheap DOM read of the grading layers per stored entry). No rAF loop — a frame
 * counter of its own would keep the page drawing and change the very thing it measures; frame counts come from the always-on
 * recorder's input-gated loop. The timer census wraps setInterval/setTimeout ONLY once the tab is armed. */
import { isDiagArmed } from "./diagArm.js";
import { perfRecent } from "../../../shared/telemetry/perfRecorderHandle.js";

export const PERF_WINDOW_MS = 60_000;
export const LONG_FRAME_MS = 200;
export const LONG_FRAME_CAP = 120;
/* A long frame whose main thread was blocked less than this is a wait on DRAWING, not on code (matches the recorder's own bar). */
export const RENDER_WAIT_BLOCK_MS = 50;

const round = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const shortUrl = (u) => String(u || "").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "").slice(-80);

/* Pure: one LoAF entry → the stored record. `layers` is the grading-layer snapshot taken when it arrived. */
export function loafRecord(e, layers) {
  const start = e.startTime, end = e.startTime + e.duration;
  const scripts = Array.from(e.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => ({
    sourceURL: shortUrl(s.sourceURL), sourceFunctionName: String(s.sourceFunctionName || "").slice(0, 80),
    invoker: String(s.invoker || "").slice(0, 120), invokerType: String(s.invokerType || ""),
    durationMs: round(s.duration), forcedStyleAndLayoutMs: round(s.forcedStyleAndLayoutDuration || 0),
  }));
  const scriptMs = scripts.reduce((a, s) => a + (s.durationMs || 0), 0);
  return {
    t: round(start), durationMs: round(e.duration), blockingMs: round(e.blockingDuration || 0),
    renderMs: e.renderStart ? round(end - e.renderStart) : 0,
    styleAndLayoutMs: e.styleAndLayoutStart ? round(end - e.styleAndLayoutStart) : 0,
    /* what is left once the scripts and the render are accounted for: the frame waiting to be produced/drawn */
    waitMs: Math.max(0, round(e.duration - scriptMs - (e.renderStart ? end - e.renderStart : 0))),
    scripts, gradingLayers: layers || [],
  };
}

/* Pure: the verdict over a window of stored long frames. "drawing" = the frames were long while the code was idle (a GPU /
 * compositor / slow-drawing machine shape); "code" = the main thread was blocked; "mixed"; "quiet" = no long frames at all. */
export function longFrameVerdict(frames) {
  if (!frames.length) return "quiet";
  let dur = 0, blk = 0;
  for (const f of frames) { dur += f.durationMs || 0; blk += f.blockingMs || 0; }
  const share = dur > 0 ? blk / dur : 0;
  return share < 0.25 ? "drawing" : share > 0.6 ? "code" : "mixed";
}

/* Pure: aggregate the scripts of a window's long frames into a top list by summed duration. */
export function topScripts(frames, n = 8) {
  const m = new Map();
  for (const f of frames) for (const s of f.scripts) {
    const k = `${s.invokerType}|${s.invoker}|${s.sourceFunctionName}|${s.sourceURL}`;
    const r = m.get(k) || { invokerType: s.invokerType, invoker: s.invoker, sourceFunctionName: s.sourceFunctionName, sourceURL: s.sourceURL, totalMs: 0, count: 0, forcedStyleAndLayoutMs: 0 };
    r.totalMs += s.durationMs || 0; r.count++; r.forcedStyleAndLayoutMs += s.forcedStyleAndLayoutMs || 0;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, n);
}

/* Pure: timer census rows → those firing more than once a second over the window, plus the costliest, newest first by cost. */
export function busyTimers(census, now, windowMs = PERF_WINDOW_MS) {
  const out = [];
  for (const [site, r] of census) {
    let n = 0, ms = 0;
    for (let i = 0; i < r.t.length; i++) if (now - r.t[i] <= windowMs) { n++; ms += r.ms[i]; }
    if (!n) continue;
    const perSec = n / (windowMs / 1000);
    if (perSec > 1 || ms >= 16) out.push({ site, kind: r.kind, delayMs: r.delay, fires: n, perSecond: Math.round(perSec * 10) / 10, totalMs: round(ms), maxMs: round(Math.max(...r.ms)) });
  }
  return out.sort((a, b) => b.totalMs - a.totalMs || b.fires - a.fires).slice(0, 15);
}

/* The grading layers on screen right now, read off the planner canvas's own `data-layer` marks (GradingPanels / GradingCanvas
 * stamp them). Cheap: one scoped querySelectorAll. Never throws. */
export function drawnGradingLayers(doc) {
  try {
    const root = doc && (doc.querySelector('[data-testid="planner-canvas"]') || doc);
    const set = new Set();
    for (const el of root.querySelectorAll("[data-layer]")) { const k = el.getAttribute("data-layer"); if (k) set.add(k); }
    return [...set].sort();
  } catch (_) { return []; }
}

/* ── the probe (one per window) ─────────────────────────────────────────────────────────────── */
function wrapTimers(win, census) {
  if (win.__plannerPerfTimersWrapped) return;
  win.__plannerPerfTimersWrapped = true;
  const site = () => {
    const lines = String(new Error().stack || "").split("\n").slice(3, 5);
    return lines.map((l) => l.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\//, "")).join(" < ").slice(0, 200);
  };
  const wrap = (orig, kind) => function (cb, delay, ...rest) {
    if (typeof cb !== "function") return orig.call(win, cb, delay, ...rest);
    const k = `${kind} ${delay | 0}ms @ ${site()}`;
    const fn = function (...a) {
      const t0 = win.performance.now();
      try { return cb.apply(this, a); } finally {
        let r = census.get(k);
        if (!r) { if (census.size >= 200) return; r = { kind, delay: delay | 0, t: [], ms: [] }; census.set(k, r); }
        r.t.push(t0); r.ms.push(win.performance.now() - t0);
        if (r.t.length > 400) { r.t.splice(0, 200); r.ms.splice(0, 200); }
      }
    };
    return orig.call(win, fn, delay, ...rest);
  };
  win.setInterval = wrap(win.setInterval, "interval");
  win.setTimeout = wrap(win.setTimeout, "timeout");
}

/* Install the probe on `win` (idempotent) and return the hook. `extra()` may add planner facts (view scale, grading state). */
export function installPlannerPerf(win, { extra } = {}) {
  if (!win) return null;
  let p = win.__plannerPerfProbe;
  if (!p) {
    p = { frames: [], census: new Map(), observing: false, since: win.performance.now() };
    try {
      new win.PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < LONG_FRAME_MS) continue;
          try { p.frames.push(loafRecord(e, drawnGradingLayers(win.document))); } catch (_) { /* never into the app */ }
          if (p.frames.length > LONG_FRAME_CAP) p.frames.shift();
        }
      }).observe({ type: "long-animation-frame", buffered: true });
      p.observing = true;
    } catch (_) { /* not Chromium 123+: the hook says so */ }
    win.__plannerPerfProbe = p;
  }
  if (isDiagArmed(win)) wrapTimers(win, p.census);
  const hook = () => {
    if (!isDiagArmed(win)) return null;
    wrapTimers(win, p.census);   // arming after install starts the census from the first call
    const now = win.performance.now();
    const frames = p.frames.filter((f) => now - f.t <= PERF_WINDOW_MS);
    const blocking = frames.reduce((a, f) => a + (f.blockingMs || 0), 0), total = frames.reduce((a, f) => a + (f.durationMs || 0), 0);
    let more = null; try { more = extra ? extra() : null; } catch (_) { more = null; }
    return {
      windowMs: PERF_WINDOW_MS, observing: p.observing, visibility: win.document ? win.document.visibilityState : null,
      verdict: longFrameVerdict(frames),
      summary: { longFrames: frames.length, longFrameMs: total, blockingMs: blocking, maxFrameMs: frames.reduce((a, f) => Math.max(a, f.durationMs || 0), 0),
        waitMs: frames.reduce((a, f) => a + (f.waitMs || 0), 0), renderMs: frames.reduce((a, f) => a + (f.renderMs || 0), 0) },
      recorder: perfRecent(PERF_WINDOW_MS),
      topScripts: topScripts(frames),
      busyTimers: busyTimers(p.census, now),
      timerCensusSinceMs: win.__plannerPerfTimersWrapped ? null : 0,
      gradingLayersNow: drawnGradingLayers(win.document),
      longFrames: frames.slice(-40),
      planner: more,
    };
  };
  win.__plannerPerf = hook;
  return hook;
}
