/* traceCost — turn a Chrome trace (CDP Tracing, devtools.timeline categories) into the main thread's cost split.
 * Pure: an array of trace events in, numbers out (unit-tested by test/traceCost.test.js).
 *
 *   mainMs       sum of the renderer main thread's TOP-LEVEL tasks (what a weak machine has to get through)
 *   longestTask  the longest of them
 *   scripting / styleLayout / paint / composite / gc / other   SELF time per class (a nested Layout inside a
 *                FunctionCall counts as layout, not twice)
 *   workerMs     busy time on dedicated-worker threads (off the main thread — reported, never judged)
 *   top          the heaviest JS functions by self time ([name, ms]) */
const CLASS = new Map([
  ...["FunctionCall", "EvaluateScript", "v8.compile", "v8.compileModule", "v8.evaluateModule", "TimerFire", "EventDispatch", "FireAnimationFrame",
    "RunMicrotasks", "v8.run", "V8.Execute", "FireIdleCallback", "XHRReadyStateChange", "ParseHTML", "v8.callFunction", "V8.ParseLazy", "v8.parseOnBackground",
    "ProfileCall", "HandlePostMessage", "RequestAnimationFrame"].map((k) => [k, "scripting"]),
  ...["UpdateLayoutTree", "RecalculateStyles", "Layout", "InvalidateLayout", "ScheduleStyleRecalculation", "HitTest", "PrePaint", "IntersectionObserverController::computeIntersections", "LayoutShift"].map((k) => [k, "styleLayout"]),
  ...["Paint", "PaintImage", "Decode Image", "Decode LazyPixelRef", "ImageDecodeTask", "PaintSetup", "Rasterize", "RasterTask", "UpdateLayer", "Draw LazyPixelRef"].map((k) => [k, "paint"]),
  ...["CompositeLayers", "Commit", "Layerize", "UpdateLayerTree", "BeginMainThreadFrame", "Animation", "Screenshot"].map((k) => [k, "composite"]),
  ...["MajorGC", "MinorGC", "V8.GCScavenger", "V8.GCCompactor", "V8.GCIncrementalMarking", "V8.GCFinalizeMC", "BlinkGC.AtomicPhase", "GCEvent", "CppGC.AtomicMark"].map((k) => [k, "gc"]),
]);
const TASK = new Set(["RunTask", "ThreadControllerImpl::RunTask", "ThreadControllerImpl::DoWork", "TaskQueueManager::ProcessTaskFromWorkQueue"]);

export function classOf(name) { return CLASS.get(name) || (/^V8\.GC|GC$/.test(name) ? "gc" : "other"); }

export function summariseTrace(events) {
  const names = new Map();   // `${pid}:${tid}` → thread name
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args && e.args.name);
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !(e.dur >= 0)) continue;
    const k = `${e.pid}:${e.tid}`; let a = byThread.get(k); if (!a) byThread.set(k, a = []); a.push(e);
  }
  // the renderer main thread with the most work (a fresh context may carry a second, idle renderer)
  let mainKey = null, mainN = -1;
  for (const [k, a] of byThread) if (names.get(k) === "CrRendererMain" && a.length > mainN) { mainKey = k; mainN = a.length; }
  const out = { mainMs: 0, longestTask: 0, tasks: 0, scripting: 0, styleLayout: 0, paint: 0, composite: 0, gc: 0, other: 0, workerMs: 0, top: [] };
  for (const [k, a] of byThread) if (/DedicatedWorker/.test(names.get(k) || "")) out.workerMs += topLevel(a).reduce((s, e) => s + e.dur, 0) / 1000;
  if (!mainKey) return round(out);
  const evs = byThread.get(mainKey).sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  let longest = null;
  for (const e of topLevel(evs)) { out.mainMs += e.dur / 1000; out.tasks++; if (e.dur / 1000 > out.longestTask) { out.longestTask = e.dur / 1000; longest = e; } }
  // what the longest task WAS: its heaviest direct children (name + function/url where the trace carries one)
  if (longest) {
    const end = longest.ts + longest.dur, kids = new Map();
    for (const e of evs) {
      if (e === longest || e.ts < longest.ts || e.ts + e.dur > end || e.dur < longest.dur * 0.05) continue;
      const d = (e.args && e.args.data) || {};
      const k = `${e.name}${d.functionName ? " " + d.functionName : ""}${d.url ? " " + String(d.url).split("/").pop().split("?")[0] : ""}`;
      kids.set(k, Math.max(kids.get(k) || 0, e.dur / 1000));
    }
    out.longestWhat = [...kids].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`);
  }
  // self time: walk with a stack, subtract each child's duration from its parent
  const fn = new Map();
  const stack = [];
  const close = (until) => {
    while (stack.length && (until == null || stack[stack.length - 1].end <= until)) {
      const f = stack.pop();
      const cls = TASK.has(f.e.name) ? "other" : classOf(f.e.name);
      out[cls] += f.self / 1000;
      if (f.e.name === "FunctionCall" || f.e.name === "TimerFire" || f.e.name === "FireAnimationFrame" || f.e.name === "EventDispatch") {
        const d = (f.e.args && f.e.args.data) || {};
        const key = `${d.functionName || d.type || f.e.name}${d.url ? " " + String(d.url).split("/").pop().split("?")[0] + ":" + (d.lineNumber ?? "") : ""}`;
        fn.set(key, (fn.get(key) || 0) + f.self / 1000);
      }
    }
  };
  for (const e of evs) {
    close(e.ts);
    const end = e.ts + e.dur;
    if (stack.length) stack[stack.length - 1].self -= Math.min(e.dur, Math.max(0, stack[stack.length - 1].end - e.ts));
    stack.push({ e, end, self: e.dur });
  }
  close(null);
  out.top = [...fn].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v)]);
  return round(out);
}

function topLevel(evs) {
  const s = [...evs].sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const top = []; let end = -Infinity;
  for (const e of s) { if (e.ts >= end) { top.push(e); end = e.ts + e.dur; } }
  return top;
}
function round(o) { for (const k of ["mainMs", "longestTask", "scripting", "styleLayout", "paint", "composite", "gc", "other", "workerMs"]) o[k] = Math.round(o[k]); return o; }
