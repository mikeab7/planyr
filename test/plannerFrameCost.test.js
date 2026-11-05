import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { installPerfRecorder, __resetPerfRecorder, RENDER_WAIT_BLOCK_MS } from "../src/shared/telemetry/perfRecorder.js";
import { perfRecent, __resetPerfHandle } from "../src/shared/telemetry/perfRecorderHandle.js";
import { FREEZE_VIA_VOCAB, CAPTURE_NUMERIC_KEYS } from "../src/shared/telemetry/perfCapture.js";
import { addVectorLabels } from "../src/shared/basemaps/vectorLabelLayer.js";
import { throttleTilePruning } from "../src/workspaces/site-planner/lib/tileLifecycle.js";
import { loafRecord, longFrameVerdict, topScripts, busyTimers, installPlannerPerf, LONG_FRAME_MS } from "../src/workspaces/site-planner/lib/plannerPerf.js";

/* NEW-1 (2026-11-01) — "graded plans are slower than they should be on the owner's machine".
 *
 * Two findings, each with its guard here:
 *   (1) THE INSTRUMENT MISREAD THE OWNER'S RUN. Every one of the 127 "long tasks" in tab 30406f26's perfcap rows (build c32db39)
 *       was a long-animation-frame entry of ~1,000 ms with blockingDuration 0 and no script, and the recorder filed them as
 *       `freezeVia: "task"` — busy JavaScript. A long frame the main thread did not block is a wait on DRAWING; it is now
 *       `freezeVia: "render"`, and the capture carries the blocked share (`longTaskBlockMs`) beside the total.
 *   (2) THE LARGEST MAIN-THREAD COST OF A ZOOM STEP on a graded plan (measured on planyr.io, 4× CPU throttle, the
 *       diagnose-grading-frames-live harness) was Leaflet's per-tile retain/prune pass on the RASTER road-names fallback — the one
 *       tile layer in the planner built without the coalesced pruning (B854832) and the retained-tile cap every basemap layer has.
 *       `addVectorLabels` now takes `decorateFallback`, and both hosts pass the coalescing. */

function fakeWin() {
  let clock = 1000;
  const listeners = {}, docListeners = {};
  let raf = null, observer = null;
  const doc = { visibilityState: "visible", addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); }, hasFocus: () => true, querySelectorAll: () => [], elementFromPoint: () => null };
  class PO { constructor(cb) { this.cb = cb; } observe(o) { if (o.type === "long-animation-frame") observer = this; } }
  const win = {
    document: doc, location: { search: "" }, devicePixelRatio: 2.15, innerWidth: 1913, innerHeight: 1000,
    performance: { now: () => clock }, navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener() {},
    requestAnimationFrame: (cb) => { raf = cb; return 1; }, cancelAnimationFrame() { raf = null; },
    setInterval: () => 0, clearInterval() {},
    PerformanceObserver: PO,
  };
  return {
    win,
    advance: (ms) => { clock += ms; },
    loaf: (startTime, duration, blockingDuration) => observer && observer.cb({ getEntries: () => [{ startTime, duration, blockingDuration, scripts: [] }] }),
  };
}

describe("(1) the recorder tells a frame that waited on DRAWING from a frame the code blocked", () => {
  let w;
  beforeEach(() => { __resetPerfRecorder(); __resetPerfHandle(); w = fakeWin(); installPerfRecorder(w.win, { bootRunMs: 0 }); w.advance(60_000); });
  afterEach(() => { __resetPerfRecorder(); __resetPerfHandle(); });

  it("THE OWNER'S SHAPE: a 1,001 ms long frame with blockingDuration 0 is a 'render' freeze, never 'task'", () => {
    w.loaf(61_000, 1_001, 0);
    const caps = w.win.pfRec.captures();
    expect(caps).toHaveLength(1);
    expect(caps[0].freezeVia).toBe("render");
  });

  it("the known-busy arm: the same long frame with the main thread blocked for most of it stays 'task'", () => {
    w.loaf(61_000, 1_001, 900);
    expect(w.win.pfRec.captures()[0].freezeVia).toBe("task");
  });

  it("the bar is the LoAF bar itself, and 'render' is on the capture's fixed vocabulary", () => {
    expect(RENDER_WAIT_BLOCK_MS).toBe(50);
    expect(FREEZE_VIA_VOCAB).toContain("render");
    expect(CAPTURE_NUMERIC_KEYS).toContain("longTaskBlockMs");
  });

  it("the recent-window summary splits the blocked share out (what __plannerPerf reads)", () => {
    w.loaf(61_000, 1_000, 0); w.loaf(62_000, 1_000, 0); w.loaf(63_000, 300, 280);
    const r = perfRecent(60_000);
    expect(r.longFrames).toBe(3);
    expect(r.longFrameMs).toBe(2_300);
    expect(r.blockingMs).toBe(280);
  });
});

describe("(2) the raster road-names fallback gets coalesced tile pruning", () => {
  it("addVectorLabels hands the fallback to decorateFallback BEFORE it is added to the map", async () => {
    const order = [];
    const stub = { addTo: () => { order.push("addTo"); return stub; } };
    const L = { tileLayer: () => { order.push("tileLayer"); return stub; } };
    const map = { getPane: () => ({ style: {} }), createPane: () => ({ style: {} }), attributionControl: null, removeLayer() {} };
    const origErr = console.error; console.error = () => {};
    try {
      const h = addVectorLabels(L, map, { mode: "site", includePois: false, decorateFallback: (layer) => { order.push(layer === stub ? "decorate" : "wrong-layer"); } });
      for (let i = 0; i < 50 && !order.includes("addTo"); i++) await new Promise((r) => setTimeout(r, 20));
      h.remove();
    } finally { console.error = origErr; }
    expect(order).toEqual(["tileLayer", "decorate", "addTo"]);
  });

  it("a burst of tile loads runs Leaflet's prune ONCE through the coalescing (it ran once per tile before)", () => {
    let pruned = 0; const queued = [];
    const layer = { _pruneTiles: () => { pruned++; } };
    throttleTilePruning(layer, (fn) => queued.push(fn));
    for (let i = 0; i < 40; i++) layer._pruneTiles();            // Leaflet's _tileReady on 40 tiles, fade off
    queued.splice(0).forEach((f) => f());
    expect(pruned).toBe(1);
  });

  it("RED ON MAIN: both planner hosts pass decorateFallback with the coalescing; the planner also caps the layer", () => {
    const planner = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const finder = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    const call = (src) => { const i = src.indexOf("addVectorLabels(L, map"); return i < 0 ? "" : src.slice(i, i + 1200); };
    expect(call(planner)).toMatch(/decorateFallback:[\s\S]*throttleTilePruning\(layer\)[\s\S]*boundTileCache\(layer/);
    expect(call(finder)).toMatch(/decorateFallback:[\s\S]*throttleTilePruning\(layer\)/);
  });
});

describe("__plannerPerf — the pure half", () => {
  const entry = (startTime, duration, blockingDuration, scripts = [], renderStart = 0) => ({ startTime, duration, blockingDuration, renderStart, styleAndLayoutStart: renderStart, scripts });

  it("a record carries the top three scripts with their attribution, and the time left over is the wait", () => {
    const r = loafRecord(entry(10, 1000, 0, [
      { sourceURL: "https://planyr.io/assets/a.js", sourceFunctionName: "f", invoker: "TimerHandler:setTimeout", invokerType: "user-callback", duration: 30, forcedStyleAndLayoutDuration: 4 },
      { sourceURL: "https://planyr.io/assets/b.js", sourceFunctionName: "", invoker: "IMG.onload", invokerType: "event-listener", duration: 10 },
      { sourceURL: "x", duration: 1 }, { sourceURL: "y", duration: 0.5 },
    ], 1000), ["cutfill"]);
    expect(r.scripts).toHaveLength(3);
    expect(r.scripts[0]).toMatchObject({ sourceURL: "assets/a.js", sourceFunctionName: "f", invoker: "TimerHandler:setTimeout", invokerType: "user-callback", durationMs: 30, forcedStyleAndLayoutMs: 4 });
    expect(r.waitMs).toBe(1000 - 41 - 10);   // minus the scripts and the 10 ms render
    expect(r.gradingLayers).toEqual(["cutfill"]);
  });

  it("the verdict: frames long while the code idled read 'drawing'; blocked frames read 'code'; none read 'quiet'", () => {
    expect(longFrameVerdict([])).toBe("quiet");
    expect(longFrameVerdict([loafRecord(entry(0, 1000, 0)), loafRecord(entry(1000, 1000, 10))])).toBe("drawing");
    expect(longFrameVerdict([loafRecord(entry(0, 400, 350))])).toBe("code");
  });

  it("topScripts sums by script; busyTimers lists only timers over 1/s or with real cost", () => {
    const s = { sourceURL: "a.js", sourceFunctionName: "f", invoker: "i", invokerType: "t", duration: 20 };
    const top = topScripts([loafRecord(entry(0, 300, 200, [s])), loafRecord(entry(400, 300, 200, [s]))]);
    expect(top[0]).toMatchObject({ totalMs: 40, count: 2 });
    const census = new Map([
      ["interval 500ms @ a", { kind: "interval", delay: 500, t: Array.from({ length: 120 }, (_, i) => i * 500), ms: Array(120).fill(1) }],
      ["interval 2000ms @ b", { kind: "interval", delay: 2000, t: Array.from({ length: 30 }, (_, i) => i * 2000), ms: Array(30).fill(0.1) }],
    ]);
    const busy = busyTimers(census, 60_000);
    expect(busy.map((b) => b.site)).toEqual(["interval 500ms @ a"]);
  });

  it("the hook is null until the tab is armed, then answers; long frames under the bar are not stored", () => {
    const w = fakeWin();
    w.win.sessionStorage = { getItem: () => null, setItem() {} };
    const hook = installPlannerPerf(w.win, { extra: () => ({ ppf: 0.08 }) });
    expect(hook()).toBeNull();
    w.win.sessionStorage = { getItem: (k) => (k === "planyr:diag" ? "1" : null), setItem() {} };
    const r = hook();
    expect(r).not.toBeNull();
    expect(r.verdict).toBe("quiet");
    expect(r.planner).toEqual({ ppf: 0.08 });
    expect(LONG_FRAME_MS).toBe(200);
  });
});

/* (3) THE DIAGNOSTIC MADE THE READING. viewChangeRecorder's frame-gap watch was a perpetual requestAnimationFrame loop: on a tab
 * armed with ?planyrDiag=1 (the owner's 2026-10-31 tab was, for __plannerGradeReadout) the page asked for a frame EVERY frame
 * forever, so an idle graded plan never stopped rendering — on a slow-drawing machine, ~1 s frames back to back with the code idle.
 * Measured on the preview before this fix: 333 rAF calls in 5 idle seconds from that one loop. Red on main: the first test. */
import { attachTimeline, createViewChangeRecorder, watchFrames, FRAME_WATCH_MS } from "../src/workspaces/site-planner/lib/viewChangeRecorder.js";

function rafWin() {
  let clock = 0, cb = null, requests = 0;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame: (f) => { requests++; cb = f; return requests; },
    cancelAnimationFrame: () => { cb = null; },
    addEventListener() {}, removeEventListener() {},
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    PerformanceObserver: class { observe() {} disconnect() {} },
  };
  const runFrames = (ms, step = 16) => { const end = clock + ms; while (clock < end) { clock += step; const f = cb; cb = null; if (f) f(clock); } };
  return { win, runFrames, requests: () => requests, pending: () => !!cb };
}

describe("(3) the armed view recorder never keeps the page rendering on its own", () => {
  it("RED ON MAIN: attached and then left idle, it stops asking for frames once the watch window has passed", () => {
    const w = rafWin();
    const detach = attachTimeline(w.win, createViewChangeRecorder({ now: () => 0 }));
    w.runFrames(60_000);
    const atOneMinute = w.requests();
    w.runFrames(60_000);
    expect(w.requests()).toBe(atOneMinute);             // nothing more in the second idle minute
    expect(atOneMinute).toBeLessThan(FRAME_WATCH_MS / 16 + 5);
    expect(w.pending()).toBe(false);
    detach();
  });

  it("a kick runs the watch again, and a gap INSIDE a run is still reported", () => {
    const w = rafWin(); const gaps = [];
    const f = watchFrames(w.win, (ms) => gaps.push(ms));
    f.kick(); w.runFrames(100);
    w.runFrames(900, 900);                               // one 900 ms frame inside the run (a stall)
    expect(gaps.some((g) => g >= 900)).toBe(true);
    w.runFrames(10_000); const n = w.requests();
    w.runFrames(10_000); expect(w.requests()).toBe(n);   // stopped again
    f.kick(); expect(w.pending()).toBe(true);
    f.stop(); expect(w.pending()).toBe(false);
  });
});
