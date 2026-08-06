#!/usr/bin/env node
/* interaction-degradation — DOES THE SAME GESTURE COST MORE AFTER 1,000 GESTURES? (NEW-1)
 *
 * THE OWNER'S REPORT, verbatim: "if I reload, it's immediately pretty quick and then, like, give
 * it some panning or zooming or I don't even know, and then, you know, a minute later or two,
 * it's, like, lagging just to go side to side."
 *
 * WHY EVERY EXISTING INSTRUMENT IS BLIND TO THIS. The speed program has varied exactly two things:
 * HOW MUCH IS DRAWN (ui-audit/lib/longSession.mjs's `grow` arm — cost tracked document nodes at
 * r = 0.93) and NOTHING AT ALL (ui-audit/lib/bootTimeline.mjs, which attributes one boot window).
 * Panning and zooming change neither: same plan, same elements, same layers. So the r = 0.93
 * finding cannot explain "fast after reload, slow two minutes later", and wall clock cannot
 * either. The untested axis is INTERACTION COUNT ON CONSTANT CONTENT. This harness varies it.
 *
 * THE SHAPE:
 *   • ONE IDENTICAL PROBE — a fixed-distance pan out-and-back plus a fixed wheel zoom in-and-out —
 *     run at N = 0, 50, 150, 400, 1000 interactions. It is VIEWPORT-NEUTRAL by construction and
 *     that is ASSERTED every time (lib/interactionAxis.mjs `probeValidityFault`): if the probe
 *     drifts, checkpoint N is looking at a different amount of scene than checkpoint 0 and the
 *     whole control collapses back into the already-measured "how much is drawn" axis.
 *   • TWO ARMS, INTERLEAVED. `interact` drives real gestures between checkpoints. `idle` waits the
 *     SAME wall clock and takes the SAME probes, so it holds time-since-load, probe count and GC
 *     opportunity equal while holding interaction count at zero. Without it, "it got slower" is
 *     unattributable — plenty of things degrade sitting still. Arms alternate run-to-run so
 *     machine warm-up drift cancels rather than loading onto whichever arm ran first.
 *   • A STATED NOISE FLOOR and INCONCLUSIVE as a valid result. Checkpoint 0 is probed `--reps`
 *     times before any workload; that spread IS the floor.
 *   • A PER-INTERACTION GROWTH TABLE, which is the actual deliverable — retained heap after a
 *     FORCED GC, DOM nodes, canvas SVG nodes, Leaflet tile nodes, detached nodes, compositor
 *     layers, raster area, net listeners, live rAF callbacks, live timers, live observers — each
 *     with a SLOPE, not just a from/to pair. A step at load and a per-gesture cost have the same
 *     endpoint delta and completely different meanings.
 *
 * ⚠ HEADED, ON A REAL X SERVER. `lib/frameSampling.mjs` exists because a hidden tab starves
 * requestAnimationFrame and the resulting median is garbage (the B1086 trap). This launches
 * Chromium with a visible window under Xvfb and refuses to print any frame number the guard
 * would reject. Run it through `xvfb-run`:
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/interaction-degradation.mjs
 *   ... --cpu-throttle 4          # emulate a slower machine (the owner's, roughly)
 *   ... --checkpoints 0,50,150    # a shorter ladder while iterating
 *   ... --arms interact           # skip the control (NOT a reportable run — say so if you do)
 *   ... --json
 *
 * ⚠ WHAT THIS SANDBOX CANNOT EXERCISE, stated rather than routed around: every external tile host
 * is blocked, so Leaflet creates its tile <img> elements (which IS the node/retention half, and is
 * measured here) but NOTHING EVER DECODES — so decoded-bitmap and GPU texture memory, the largest
 * single suspect in the owner's ~278 MB tab, are NOT exercised. The run says so in its own output.
 * Never let a quiet reading here be read as "map memory is fine".
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate.
 */
import { chromium } from "playwright";
import { perfScenarioSeed, scenarioShape, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { frameSamplingFault, plausibilityFloor, observedFps } from "./lib/frameSampling.mjs";
import { noiseFloor } from "./lib/longSession.mjs";
import { buildGrowthTable, probeValidityFault, axisVerdict, suspects, viewDrift } from "./lib/interactionAxis.mjs";
import { aggregateSnapshot, diffAggregates, perInteraction } from "./lib/heapSnapshot.mjs";
import { fakeTilePng, parseTileUrl, decodedMB } from "./lib/fakeTile.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const numArg = (flag, dflt) => { const v = Number(argOf(flag, NaN)); return Number.isFinite(v) && v > 0 ? v : dflt; };

const CPU_THROTTLE = numArg("--cpu-throttle", 1);
const REPS = numArg("--reps", 3);
const RUNS = numArg("--runs", 2);
const CHECKPOINTS = String(argOf("--checkpoints", "0,50,150,400,1000")).split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const ARMS = String(argOf("--arms", "interact,idle")).split(",").map((s) => s.trim()).filter(Boolean);
const MIN_FPS = plausibilityFloor(CPU_THROTTLE);
/* --snapshot: take a full V8 heap snapshot at the first and last checkpoint and diff them by
 * class, so a retained-heap SLOPE gets a NAME. Expensive (seconds, and tens of MB of JSON), so it
 * is opt-in rather than always-on. */
const SNAPSHOT = process.argv.includes("--snapshot");
/* --lite: instrument ONLY the small bounded counters (rAF / timers / observers), NOT the listener
 * identity map. That map is the one structure this harness itself grows without bound, so it is
 * also the one thing that could masquerade as the app retaining memory per gesture. Running the
 * ladder both ways is how the retained-heap slope gets attributed to the app rather than to the
 * instrument — a measurement that cannot rule itself out is not a measurement. */
const LITE = process.argv.includes("--lite");
/* --fake-tiles: fulfil every basemap tile request with a REAL, decodable, per-tile-unique PNG
 * generated in this process. Without it no tile ever decodes here and the largest suspect for the
 * owner's tab memory — decoded bitmaps and their GPU textures — is not exercised at all, which is
 * the caveat every memory run in this repo has had to end on. See lib/fakeTile.mjs. */
const FAKE_TILES = process.argv.includes("--fake-tiles");

/* ── The in-page instrumentation ───────────────────────────────────────────────────────────────
 * Installed BEFORE any app code runs, because a listener added during module evaluation is
 * invisible to a wrapper installed after it — and "listeners leak" is one of the hypotheses this
 * table is meant to settle. Every wrapper is a counter only: it must not change what the app does,
 * so nothing is buffered, nothing is delayed, and every original is called through unconditionally.
 *
 * The one deliberate retention here is `__pf.rafLive` / `timerLive` / `obsLive`, which are Sets of
 * ids and small objects. They are the measurement's own cost and are reported, so the reader can
 * subtract them rather than wonder about them. */
const INSTRUMENT = `(() => {
  const S = { addL: 0, remL: 0, rafReq: 0, rafCancel: 0, toSet: 0, toClear: 0, ivSet: 0, ivClear: 0,
              obsNew: 0, obsDisc: 0, rafLive: new Set(), timerLive: new Set(), obsLive: new Set() };
  window.__pf = S;

  /* LISTENERS, COUNTED HONESTLY. A naive add-minus-remove reads +22 per gesture on this app and
   * is WRONG BY A FACTOR OF TWENTY: a { once: true } listener and an AbortSignal-scoped one both
   * detach without anyone ever calling removeEventListener, so they inflate the difference
   * forever. That naive number is exactly the kind of figure that gets reported as a leak. So
   * this tracks LIVE registrations: keyed per (target, type, fn, capture), decremented on remove,
   * on the once-fire, and on the signal's abort. Cross-checked at every checkpoint against the
   * renderer's own JSEventListeners metric, which is the independent authority. */
  S.live = new Map(); S.once = 0; S.signal = 0; S.lite = __PF_LITE__;
  const AL = EventTarget.prototype.addEventListener, RL = EventTarget.prototype.removeEventListener;
  const keyOf = (t, type, fn, opts) => {
    const cap = typeof opts === "boolean" ? opts : !!(opts && opts.capture);
    if (!fn) return null;
    if (!fn.__pfId) { try { Object.defineProperty(fn, "__pfId", { value: ++S.fnSeq, enumerable: false }); } catch (_) { return null; } }
    if (!t.__pfId) { try { Object.defineProperty(t, "__pfId", { value: ++S.tSeq, enumerable: false }); } catch (_) { return null; } }
    return t.__pfId + "|" + type + "|" + fn.__pfId + "|" + (cap ? 1 : 0);
  };
  S.fnSeq = 0; S.tSeq = 0;
  const drop = (k, type) => { if (k && S.live.delete(k)) { S.byType[type] = (S.byType[type] || 1) - 1; } };
  S.byType = {};
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    S.addL++;
    if (S.lite) return AL.call(this, type, fn, opts);
    const k = keyOf(this, type, fn, opts);
    if (k && !S.live.has(k)) { S.live.set(k, type); S.byType[type] = (S.byType[type] || 0) + 1; }
    if (opts && opts.once) { S.once++; AL.call(this, type, () => drop(k, type), { once: true, capture: !!opts.capture }); }
    if (opts && opts.signal) { S.signal++; try { opts.signal.addEventListener("abort", () => drop(k, type)); } catch (_) {} }
    return AL.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    S.remL++;
    if (!S.lite) drop(keyOf(this, type, fn, opts), type);
    return RL.call(this, type, fn, opts);
  };

  const RAF = window.requestAnimationFrame.bind(window), CAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    S.rafReq++;
    const id = RAF((t) => { S.rafLive.delete(id); return fn(t); });
    S.rafLive.add(id); return id;
  };
  window.cancelAnimationFrame = (id) => { S.rafCancel++; S.rafLive.delete(id); return CAF(id); };

  const ST = window.setTimeout.bind(window), CT = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...r) => {
    S.toSet++;
    const id = ST(typeof fn === "function" ? (...x) => { S.timerLive.delete(id); return fn(...x); } : fn, ms, ...r);
    S.timerLive.add(id); return id;
  };
  window.clearTimeout = (id) => { S.toClear++; S.timerLive.delete(id); return CT(id); };
  const SI = window.setInterval.bind(window), CI = window.clearInterval.bind(window);
  window.setInterval = (...a) => { S.ivSet++; const id = SI(...a); S.timerLive.add("i" + id); return id; };
  window.clearInterval = (id) => { S.ivClear++; S.timerLive.delete("i" + id); return CI(id); };

  for (const name of ["MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver"]) {
    const Orig = window[name];
    if (!Orig) continue;
    class Wrapped extends Orig {
      constructor(...a) { super(...a); S.obsNew++; S.obsLive.add(this); }
      disconnect(...a) { S.obsDisc++; S.obsLive.delete(this); return super.disconnect(...a); }
    }
    Object.defineProperty(Wrapped, "name", { value: name });
    window[name] = Wrapped;
  }

  // The continuous frame sampler. One rAF chain for the whole session, drained per gesture — the
  // same shape ui-audit/perf-harness.mjs uses, so a number here and a number there are comparable.
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; RAF(tick); };
  RAF(tick);
})();`;

/* Everything a checkpoint records besides the frame median. Each entry is a candidate explanation
 * for a move in the median; a counter that never moves EXONERATES its suspect, which is as useful
 * a result as naming one. `liveNodesAll` counts every node type via a TreeWalker so the CDP
 * renderer-wide node total can be differenced against it — that difference is the only handle on
 * DETACHED trees available without a heap snapshot, and it is labelled as an approximation. */
const COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const S = window.__pf || {};
  const w = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let liveNodesAll = 1; while (w.nextNode()) liveNodesAll++;
  const tilesByLayer = {};
  for (const t of document.querySelectorAll("img.leaflet-tile")) {
    const k = t.parentElement?.className?.baseVal || t.parentElement?.className || "unknown";
    tilesByLayer[k] = (tilesByLayer[k] || 0) + 1;
  }
  return {
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
    documentNodes: document.getElementsByTagName("*").length,
    liveNodesAll,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : 0,
    tiles: document.querySelectorAll("img.leaflet-tile").length,
    tilesLoaded: document.querySelectorAll(".leaflet-tile-loaded").length,
    tileLayers: document.querySelectorAll(".leaflet-layer").length,
    tilesByLayer,
    listenersLive: S.live && !S.lite ? S.live.size : null,
    // The harness's OWN unbounded structure, reported so a reader can subtract it rather than
    // wonder about it. In --lite it is zero by construction, which is the control run.
    instrumentEntries: S.live ? S.live.size : 0,
    listenersNaiveNet: (S.addL || 0) - (S.remL || 0),
    listenersAdded: S.addL || 0,
    listenersOnce: S.once || 0,
    listenersTop: S.byType
      ? Object.entries(S.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ":" + v).join(" ")
      : null,
    rafLive: S.rafLive ? S.rafLive.size : null,
    rafRequested: S.rafReq || 0,
    timersLive: S.timerLive ? S.timerLive.size : null,
    timeoutsSet: S.toSet || 0,
    observersLive: S.obsLive ? S.obsLive.size : null,
    observersMade: S.obsNew || 0,
    ppf: svg ? +Number(svg.getAttribute("data-view-ppf")).toFixed(5) : null,
  };
})()`;

const readView = `(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null;
})()`;

/* A press point that is UNAMBIGUOUSLY bare canvas — the top hit must BE the <svg>. On this
 * scenario the canvas centre holds a building, and a press there DRAGS THE BUILDING instead of
 * panning (MEASUREMENT BLOCKER #5, hit by every harness here that did not do this). */
const PRESS_POINT = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    for (const fx of [0.25, 0.75, 0.12, 0.88, 0.5]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
})()`;

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

/* ── The probe ─────────────────────────────────────────────────────────────────────────────────
 * PAN OUT AND BACK, then ZOOM IN AND BACK OUT, at fixed distances from a fixed anchor. Both
 * halves are symmetric by construction, so the view ends where it began and the scene drawn at
 * checkpoint 1000 is the scene drawn at checkpoint 0 — which is the entire premise. Symmetry is
 * asserted afterwards, never assumed.
 *
 * Real Playwright mouse/wheel input throughout, not synthesised DOM events: the planner calls
 * setPointerCapture on pointerdown, which THROWS for a synthetic pointerId and would silently
 * measure a different code path from the one the owner drives. */
const PAN_PX = 240, PAN_STEPS = 12, WHEEL_BURSTS = 4, WHEEL_BURST = 5, WHEEL_DELTA = 120;

/* The wheel half is dispatched IN PAGE through a MessageChannel pump — one wheel per task, five
 * per burst — rather than through `page.mouse.wheel`. Not a shortcut: it is the identical pump
 * ui-audit/lib/longSession.mjs and diagnose-zoom-cost.mjs drive, so a number here is comparable to
 * a number there. It also matters for the MEASUREMENT: a CDP round-trip per notch leaves the
 * renderer idle between notches, and the first version of this probe reported a serene 16.7 ms
 * median at 4x throttle for exactly that reason — the frames it sampled were the gaps. Wheel
 * events need no pointer capture, so synthesising them changes no code path; the PAN half stays
 * on real Playwright input precisely because it does (setPointerCapture throws on a synthetic id). */
const wheelBurst = ([n, dy, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  /* ONE channel for the whole session, not one per burst. A fresh MessageChannel per burst is the
   * obvious way to write this and it CONTAMINATES THE MEASUREMENT: at two ports per burst the
   * harness put 128 MessagePort objects into the heap-snapshot diff over sixty interactions, where
   * they read as the app retaining something. An instrument that shows up in its own results is
   * not measuring the program. */
  const ch = (window.__pfWheelCh = window.__pfWheelCh || new MessageChannel());
  let i = 0;
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < n) ch.port2.postMessage(0); else done();
  };
  ch.port1.start();
  ch.port2.postMessage(0);
});

async function probe(page, press, ctx) {
  const view = () => page.evaluate(readView);
  await page.mouse.move(press.x, press.y);
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__frames.length = 0; });

  const before = await view();
  const t0 = Date.now();

  /* Pan: out, then back along the same path. `steps` sends the whole leg in ONE CDP call, so the
   * moves arrive back-to-back the way a real drag does — a move-per-round-trip drag samples the
   * idle gaps between moves and reports them as the frame cost. */
  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  const mid = await view();
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();

  // Zoom: in, then out, the same notches at the same anchor, so the net is exactly zero.
  for (let b = 0; b < WHEEL_BURSTS; b++) {
    await page.evaluate(wheelBurst, [WHEEL_BURST, b < WHEEL_BURSTS / 2 ? -WHEEL_DELTA : WHEEL_DELTA, press.x, press.y]);
    await page.waitForTimeout(30);
  }

  const gestureMs = Date.now() - t0;
  await page.waitForTimeout(150);
  const after = await view();
  const frames = (await page.evaluate(() => window.__frames.slice())).slice(1);

  const fault = frameSamplingFault({ visibility: ctx.visibility, samples: frames.length, gestureMs, minFps: MIN_FPS });
  /* The zoom half is symmetric in NOTCHES, and the planner clamps ppf, so an anchored zoom can
   * land a hair off its start. A tolerance of one canvas pixel of equivalent error is the floor
   * below which the scene drawn is identical for every purpose this probe cares about. */
  const validity = probeValidityFault({ before, mid, after, tolerance: 1 });

  return {
    probeMedianMs: fault || validity ? null : (frames.length ? +pct(frames, 50).toFixed(2) : null),
    probeP90Ms: fault || validity ? null : (frames.length ? +pct(frames, 90).toFixed(2) : null),
    frames: frames.length,
    fps: observedFps(frames.length, gestureMs),
    gestureMs,
    drift: viewDrift(before, after),
    fault: fault || null,
    validity: validity || null,
  };
}

/* ── Counters, including the two that need the browser rather than the page ───────────────────── */
async function counters(page, cdp, layerState) {
  /* FORCED GC FIRST. The owner-side reading that motivated this item saw the JS heap climb
   * 35 → 114 MB across 600 gestures with zero DOM growth and zero listener growth, and could not
   * say whether that was garbage or retention because GC was never forced. That distinction is
   * the single most valuable number in this table, so it is taken properly: collectGarbage twice
   * (the first pass can leave objects reachable only from the sweep itself), then read. */
  try { await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {}
  await page.waitForTimeout(120);

  const page_ = await page.evaluate(COUNTERS);
  let metrics = {};
  try {
    const m = await cdp.send("Performance.getMetrics");
    for (const { name, value } of m.metrics || []) metrics[name] = value;
  } catch (_) {}
  let dom = {};
  try { dom = await cdp.send("Memory.getDOMCounters"); } catch (_) {}

  const rendererNodes = metrics.Nodes ?? dom.nodes ?? null;
  return {
    ...page_,
    /* RETAINED, not allocated: this is read immediately after a forced GC, so what remains is what
     * something still points at. Compare it against `heapMB`, which is not GC'd. */
    retainedHeapMB: metrics.JSHeapUsedSize != null ? +(metrics.JSHeapUsedSize / 1048576).toFixed(2) : null,
    heapTotalMB: metrics.JSHeapTotalSize != null ? +(metrics.JSHeapTotalSize / 1048576).toFixed(2) : null,
    rendererNodes,
    /* DETACHED, APPROXIMATED — and the approximation is stated because it matters. The renderer's
     * own node total counts every node it is keeping alive, including trees no longer in the
     * document; the TreeWalker counts only what is still attached. The difference is detached
     * nodes plus shadow/adopted trees the walker cannot reach, so it is an UPPER BOUND on
     * detachment, never a proof of it. A flat difference does clear the suspect. */
    detachedApprox: rendererNodes != null && page_.liveNodesAll != null ? rendererNodes - page_.liveNodesAll : null,
    jsEventListenersCdp: metrics.JSEventListeners ?? dom.jsEventListeners ?? null,
    layoutObjects: metrics.LayoutObjects ?? null,
    layoutCount: metrics.LayoutCount ?? null,
    recalcStyleCount: metrics.RecalcStyleCount ?? null,
    documents: metrics.Documents ?? dom.documents ?? null,
    /* COMPOSITOR LAYERS and the raster area they imply. NEW-2's hypothesis is that the symptom is
     * a compositor problem a JS CPU profile could never see, so the layer tree is read directly.
     * `rasterMB` is layer area × 4 bytes — a PROXY for the texture memory those layers imply, not
     * a reading of GPU memory (no CDP domain exposes that to a page-level client). Labelled as a
     * proxy everywhere it is printed. */
    compositorLayers: layerState.count,
    rasterMB: layerState.areaPx != null ? +((layerState.areaPx * 4) / 1048576).toFixed(2) : null,
  };
}

/* Take a full V8 heap snapshot and aggregate it. The snapshot arrives as a stream of JSON string
 * chunks over CDP events, which is why this looks the way it does — there is no single call that
 * returns one. Forced GC first, so what the snapshot shows is RETENTION and not a pile of garbage
 * that had not been collected yet. */
async function heapSnapshot(cdp) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    return aggregateSnapshot(JSON.parse(chunks.join("")));
  } catch (e) {
    return { ok: false, why: `heap snapshot failed: ${e?.message || e}` };
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }
}

/* ── The between-checkpoint workload ──────────────────────────────────────────────────────────
 * REAL gestures that move the view around the plan and back — the thing the owner does. Each
 * "interaction" is one pan gesture or one wheel notch, counted the same way in both arms so the
 * ladder means the same thing on each. The walk is DETERMINISTIC (a fixed lattice, no RNG) so two
 * runs drive the identical path, and it RETURNS HOME at the end of every batch so the following
 * probe starts from the same viewport it started from at N = 0. */
async function driveInteractions(page, press, count, home) {
  let done = 0, batch = 0;
  let at = press;
  while (done < count) {
    const k = done;
    /* A pan, out along one of four directions and straight back. Each gesture is individually
     * neutral, so no amount of them can walk the view off the plan. */
    const dx = [1, -1, -1, 1][k % 4] * (90 + (k % 5) * 30);
    const dy = [1, 1, -1, -1][k % 4] * (60 + (k % 3) * 30);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 });
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.up();
    done++;
    if (done >= count) break;
    /* A wheel notch IN and straight back OUT. ⛔ THIS PAIRING IS THE FIX FOR THE BUG THAT
     * INVALIDATED THE FIRST FULL RUN, and it is worth stating exactly. The direction used to
     * alternate on `done % 2` — but `done` advances by TWO per iteration (a pan and a wheel), so
     * the parity never changed and every single notch zoomed the same way. Five hundred of them
     * drove the view into the ppf clamp, the end-of-batch "undo the net" then drove it into the
     * opposite clamp, and by N=150 the plan was off screen: `elementsDrawn` fell 66 → 0 and
     * `canvasNodes` 976 → 227. The probe's own neutrality guard caught it and SUPPRESSED every
     * affected checkpoint rather than reporting the resulting numbers as a trend — which is the
     * only reason the run produced a harness bug instead of a finding about a plan that wasn't
     * being drawn. Pairing removes the accumulation at the source; the restore below is a belt
     * on top of it. */
    await page.evaluate(wheelBurst, [1, -WHEEL_DELTA, at.x, at.y]);
    await page.evaluate(wheelBurst, [1, WHEEL_DELTA, at.x, at.y]);
    done++;

    /* Every so often: re-resolve the press point and restore the exact starting view. The press
     * point matters because a press that lands on an ELEMENT drags the element instead of panning
     * — which would change the plan, not just the view, and is the one thing this probe may never
     * do (MEASUREMENT BLOCKER #5). */
    if (++batch % 25 === 0) {
      await restoreView(page, home);
      at = (await page.evaluate(PRESS_POINT)) || press;
    }
  }
  await restoreView(page, home);
  await page.waitForTimeout(250);
  return done;
}

/* Put the view back EXACTLY, through the planner's own E2E hook rather than by hoping a sequence
 * of gestures cancels out. Floating-point zoom in/out at an anchor is very nearly reversible and
 * not exactly reversible, so over hundreds of gestures "nearly" is a drift; this makes the scene
 * at checkpoint 1000 bit-identical to the scene at checkpoint 0, which is the premise the whole
 * item rests on. `centerOn` only sets the view — it draws nothing extra and changes no model. */
async function restoreView(page, home) {
  if (!home) return;
  await page.evaluate((h) => {
    const v = window.__plannerView;
    if (!v || typeof v.centerOn !== "function") return;
    const { w, h: hh } = v.get();
    const ppf = Number(h.ppf);
    v.centerOn((w / 2 - Number(h.offX)) / ppf, (hh / 2 - Number(h.offY)) / ppf, ppf);
  }, home);
  await page.waitForTimeout(120);
}

/* ── One run: one page load, one arm, the whole ladder ─────────────────────────────────────── */
async function runArm(browser, { arm, idleBudgetMs }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INSTRUMENT.replace("__PF_LITE__", LITE ? "true" : "false"));
  await context.addInitScript(perfScenarioSeed());
  /* Arms the planner's own read/debug hook (`window.__plannerView`), which `restoreView` needs to
   * put the view back exactly. It is the same gate every e2e spec here arms, it publishes getters
   * and one setter and changes no product behaviour — and the alternative, trusting hundreds of
   * gestures to cancel out, is what invalidated the first full run of this harness. */
  await context.addInitScript(() => { window.__PLANYR_E2E = true; });
  /* Block cross-origin traffic exactly as ui-audit/perf-harness.mjs does: the tile and GIS hosts
   * are unreachable here anyway, and letting the requests hang adds seconds of unrelated variance
   * to every checkpoint. This is why `tilesLoaded` reads zero — see the caveat in the report. */
  let tilesServed = 0;
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    if (FAKE_TILES) {
      const t = parseTileUrl(u);
      if (t) {
        tilesServed++;
        return route.fulfill({
          status: 200,
          headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" },
          body: fakeTilePng(t.z, t.x, t.y),
        });
      }
    }
    return route.abort();
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  await cdp.send("HeapProfiler.enable").catch(() => {});
  if (CPU_THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE }).catch(() => {});

  /* The layer tree arrives by EVENT, not by request — LayerTree.enable pushes `layerTreeDidChange`
   * whenever compositing changes, so the latest snapshot is held here and read at each checkpoint. */
  const layerState = { count: null, areaPx: null };
  cdp.on("LayerTree.layerTreeDidChange", ({ layers }) => {
    if (!layers) { layerState.count = 0; layerState.areaPx = 0; return; }
    layerState.count = layers.length;
    layerState.areaPx = layers.reduce((s, l) => s + (l.width || 0) * (l.height || 0), 0);
  });
  await cdp.send("LayerTree.enable").catch(() => {});

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500); // let the boot's own deferred work land, so it isn't charged to N

  const visibility = await page.evaluate(() => document.visibilityState);
  const ctx = { visibility };
  let press = (await page.evaluate(PRESS_POINT)) || { x: 400, y: 400 };

  // The view every checkpoint must be probed from — captured once, restored before every probe.
  const home = await page.evaluate(readView);

  // Checkpoint 0, probed `REPS` times: its own spread is this machine's noise floor.
  const zero = [];
  for (let i = 0; i < REPS; i++) zero.push(await probe(page, press, ctx));
  const floor = noiseFloor(zero.map((p) => p.probeMedianMs));
  const baseline = await counters(page, cdp, layerState);
  const snapFirst = SNAPSHOT ? await heapSnapshot(cdp) : null;

  const checkpoints = [];
  let n = 0;
  for (let ci = 0; ci < CHECKPOINTS.length; ci++) {
    const target = CHECKPOINTS[ci];
    let workMs = 0;
    if (target > n) {
      const t0 = Date.now();
      if (arm === "interact") n += await driveInteractions(page, press, target - n, home);
      else { await page.waitForTimeout(idleBudgetMs?.[ci] ?? 1000); n = target; }
      workMs = Date.now() - t0;
    }
    // Never probe from a point that now holds an element: that drags the ELEMENT, changing the
    // plan rather than the view (MEASUREMENT BLOCKER #5).
    if (ci > 0) press = (await page.evaluate(PRESS_POINT)) || press;
    const p = ci === 0 ? zero[zero.length - 1] : await probe(page, press, ctx);
    const c = await counters(page, cdp, layerState);
    /* THE CONTROL, ASSERTED RATHER THAN ASSUMED. The whole claim is that CONTENT is constant and
     * only interaction count varies. `elementsDrawn` and `canvasNodes` ARE "how much is drawn"
     * here, and the first full run proved they can silently collapse (66 → 0, 976 → 227) while
     * every frame number still looks plausible. If they move, this checkpoint is measuring the
     * OLD axis, and it says so instead of quietly joining the trend line. */
    const controlFault = c.elementsDrawn !== baseline.elementsDrawn || c.canvasNodes !== baseline.canvasNodes
      ? `CONTENT DID NOT STAY CONSTANT: elementsDrawn ${baseline.elementsDrawn} → ${c.elementsDrawn}, canvasNodes ${baseline.canvasNodes} → ${c.canvasNodes}. This checkpoint measures the "how much is drawn" axis, not the interaction-count axis.`
      : null;
    if (controlFault) { p.probeMedianMs = null; p.probeP90Ms = null; }
    // Progress to stderr, because the report only prints at the end and the full ladder is a
    // twenty-minute run — a silent terminal is indistinguishable from a hung one.
    process.stderr.write(`  · ${arm} N=${target} probe ${p.probeMedianMs ?? "—"}/${p.probeP90Ms ?? "—"} ms · heap ${c.retainedHeapMB} MB · nodes ${c.rendererNodes} · tiles ${c.tiles} · listeners ${c.jsEventListenersCdp} · drawn ${c.elementsDrawn} · ${Math.round(workMs / 1000)}s work\n`);
    checkpoints.push({ n: target, driven: arm === "interact" ? n : 0, workMs, ...p, controlFault, counters: c });
  }

  const snapLast = SNAPSHOT ? await heapSnapshot(cdp) : null;
  const snapDiff = SNAPSHOT ? diffAggregates(snapFirst, snapLast) : null;

  await context.close();
  return {
    arm, visibility, press, snapFirst, snapLast, snapDiff, interactionsDriven: n, tilesServed,
    noiseFloor: floor,
    zeroRepeats: zero.map((p) => ({ probeMedianMs: p.probeMedianMs, fps: p.fps, drift: p.drift, fault: p.fault, validity: p.validity })),
    checkpoints,
  };
}

/* ── Main ──────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false, // ⚠ REQUIRED — see the frameSampling note at the top of this file
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1000"],
});

const runs = [];
/* INTERLEAVED: interact, idle, interact, idle … A machine that warms up (or a container whose
 * co-tenants wake up) drifts monotonically, and running one arm to completion and then the other
 * loads that drift entirely onto the second arm. Alternating cancels it to first order. */
const idleBudgets = [];
for (let r = 0; r < RUNS; r++) {
  for (const arm of ARMS) {
    if (arm === "idle" && !idleBudgets.length) continue; // nothing to match yet
    const out = await runArm(browser, { arm, idleBudgetMs: idleBudgets });
    if (arm === "interact") { idleBudgets.length = 0; out.checkpoints.forEach((c) => idleBudgets.push(c.workMs)); }
    runs.push({ rep: r + 1, ...out });
  }
}
await browser.close();

/* Pool the arms across reps by taking the MEDIAN probe at each checkpoint — one run of a five-rung
 * ladder is one sample per rung, and a single rung's fluke would otherwise set the slope. */
const pooled = (arm) => {
  const arms = runs.filter((r) => r.arm === arm);
  if (!arms.length) return null;
  return CHECKPOINTS.map((n, i) => {
    const cps = arms.map((r) => r.checkpoints[i]).filter(Boolean);
    const med = (key) => { const v = cps.map((c) => c[key]).filter((x) => typeof x === "number"); return v.length ? +pct(v, 50).toFixed(2) : null; };
    const medCounter = (key) => { const v = cps.map((c) => c.counters?.[key]).filter((x) => typeof x === "number"); return v.length ? +pct(v, 50).toFixed(2) : null; };
    const keys = [...new Set(cps.flatMap((c) => Object.keys(c.counters || {})))].filter((k) => typeof cps[0].counters?.[k] === "number");
    return {
      n, probeMedianMs: med("probeMedianMs"), probeP90Ms: med("probeP90Ms"), fps: med("fps"), drift: med("drift"),
      faults: cps.map((c) => c.fault || c.validity || c.controlFault).filter(Boolean),
      counters: Object.fromEntries(keys.map((k) => [k, medCounter(k)])),
    };
  });
};

const interact = pooled("interact");
const idle = pooled("idle");
const floors = runs.filter((r) => r.arm === "interact").map((r) => r.noiseFloor?.floorPct).filter((x) => typeof x === "number");
const floorPct = floors.length ? +Math.max(...floors).toFixed(1) : null;

const TABLE_KEYS = [
  { counter: "retainedHeapMB", unit: "MB (after forced GC)", decimals: 2 },
  { counter: "heapMB", unit: "MB (not GC'd)", decimals: 2 },
  { counter: "rendererNodes", unit: "nodes (renderer-wide)", decimals: 0 },
  { counter: "documentNodes", unit: "elements (attached)", decimals: 0 },
  { counter: "liveNodesAll", unit: "nodes (attached, all types)", decimals: 0 },
  { counter: "detachedApprox", unit: "nodes (upper bound)", decimals: 0 },
  { counter: "canvasNodes", unit: "SVG nodes in the canvas", decimals: 0 },
  { counter: "elementsDrawn", unit: "drawn elements (the CONTROL — must be flat)", decimals: 0 },
  { counter: "tiles", unit: "img.leaflet-tile", decimals: 0 },
  { counter: "tilesLoaded", unit: "decoded tiles", decimals: 0 },
  { counter: "tileLayers", unit: ".leaflet-layer", decimals: 0 },
  { counter: "compositorLayers", unit: "compositor layers", decimals: 0 },
  { counter: "rasterMB", unit: "MB (layer area x 4B — a PROXY, not GPU memory)", decimals: 2 },
  { counter: "listenersLive", unit: "live registrations (once/abort accounted)", decimals: 0 },
  { counter: "listenersNaiveNet", unit: "add - remove (NAIVE — inflated by once/abort)", decimals: 0 },
  { counter: "jsEventListenersCdp", unit: "listeners (renderer's own count)", decimals: 0 },
  { counter: "rafLive", unit: "outstanding rAF callbacks", decimals: 0 },
  { counter: "timersLive", unit: "live timers", decimals: 0 },
  { counter: "observersLive", unit: "live observers", decimals: 0 },
  { counter: "layoutObjects", unit: "layout objects", decimals: 0 },
  { counter: "documents", unit: "documents", decimals: 0 },
];

const table = interact ? buildGrowthTable(interact, TABLE_KEYS) : [];
const verdict = axisVerdict({
  interactCosts: (interact || []).map((c) => c.probeMedianMs),
  idleCosts: (idle || []).map((c) => c.probeMedianMs),
  floorPct, checkpointNs: CHECKPOINTS,
});
const named = suspects(table, interact || []);
const tilesDecoded = interact?.[interact.length - 1]?.counters?.tilesLoaded || 0;

const out = {
  base: BASE, scenario: SCENARIO_ID, shape: scenarioShape(),
  cpuThrottle: CPU_THROTTLE, reps: REPS, runs: RUNS, arms: ARMS, checkpoints: CHECKPOINTS,
  headed: true, visibility: runs[0]?.visibility, minFps: MIN_FPS,
  noiseFloorPct: floorPct, verdict, growthTable: table, suspects: named,
  interact, idle, rawRuns: runs,
  fakeTiles: FAKE_TILES,
  tilesServed: runs.reduce((a, r) => a + (r.tilesServed || 0), 0),
  decodedMB: tilesDecoded ? decodedMB(tilesDecoded) : 0,
  tileCaveat: tilesDecoded ? null : "NO BASEMAP TILE EVER DECODED IN THIS RUN — every external tile host is blocked here, so Leaflet's tile <img> elements are created and counted (the retention half) but no bitmap is decoded and no texture is uploaded. Decoded-image and GPU memory, the largest single suspect for the owner's ~278 MB tab, WERE NOT EXERCISED. Nothing here can clear or convict them.",
};

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

/* ── The report ───────────────────────────────────────────────────────────────────────────── */
const pad = (s, n) => String(s ?? "—").padEnd(n);
const rpad = (s, n) => String(s ?? "—").padStart(n);
console.log(`\nINTERACTION-COUNT DEGRADATION — the same probe, on unchanged content, after N gestures`);
console.log(`  target ${BASE} · scenario ${SCENARIO_ID} (${out.shape.elements} elements · ${out.shape.parcels} parcels · ${out.shape.ponds} ponds)`);
console.log(`  headed browser, tab "${out.visibility}" · cpu ${CPU_THROTTLE}x · frame floor ${MIN_FPS} fps · arms ${ARMS.join(" + ")} x ${RUNS} run(s), INTERLEAVED\n`);

if (floorPct != null) console.log(`  NOISE FLOOR, measured on this machine in this run: ±${floorPct}%. Nothing inside it is a finding.\n`);

console.log(`  ${pad("N interactions", 16)}${rpad("probe median", 14)}${rpad("p90", 9)}${rpad("fps", 7)}${rpad("drift", 8)}   arm`);
for (const arm of [["interact", interact], ["idle", idle]]) {
  if (!arm[1]) continue;
  for (const c of arm[1]) {
    console.log(`  ${pad(c.n, 16)}${rpad(c.probeMedianMs == null ? "SUPPRESSED" : `${c.probeMedianMs} ms`, 14)}${rpad(c.probeP90Ms ?? "—", 9)}${rpad(c.fps ?? "—", 7)}${rpad(c.drift ?? "—", 8)}   ${arm[0]}`);
    for (const f of c.faults) console.log(`      ⚠ ${f}`);
  }
  console.log("");
}

console.log(`  VERDICT: ${verdict.verdict}`);
console.log(`  ${verdict.why}\n`);

console.log(`  PER-INTERACTION GROWTH TABLE (interact arm; slope is per single gesture)`);
console.log(`  ${pad("counter", 22)}${rpad("at N=0", 12)}${rpad(`at N=${CHECKPOINTS[CHECKPOINTS.length - 1]}`, 12)}${rpad("total", 11)}${rpad("per interaction", 17)}${rpad("r", 7)}  unit`);
for (const row of table) {
  console.log(`  ${pad(row.counter, 22)}${rpad(row.from, 12)}${rpad(row.to, 12)}${rpad(row.total, 11)}${rpad(row.perInteraction ?? (row.verdict === "FLAT" ? "FLAT" : "—"), 17)}${rpad(row.r ?? "—", 7)}  ${row.unit}`);
}

if (named.length) {
  console.log(`\n  NAMED SUSPECTS — counters that grew AND tracked the probe cost (weak evidence over ${CHECKPOINTS.length} points; names, never convicts):`);
  for (const s of named.slice(0, 6)) console.log(`    ${pad(s.counter, 22)} +${s.total} total, ${s.perInteraction}/interaction, r vs cost ${s.rVsCost ?? "—"}`);
} else {
  console.log(`\n  NO COUNTER GREW with interaction count — every suspect in the table is EXONERATED on this axis, in this environment.`);
}

/* The two non-numeric breakdowns, printed rather than tabled: a growth row says THAT something
 * grew, and these say WHAT — which listener types are alive, and which layer is holding tiles. */
const lastRaw = runs.filter((r) => r.arm === "interact").at(-1)?.checkpoints ?? [];
if (lastRaw.length) {
  const a = lastRaw[0].counters, z = lastRaw[lastRaw.length - 1].counters;
  console.log(`\n  LIVE LISTENERS BY TYPE   N=0:  ${a.listenersTop || "—"}`);
  console.log(`                           N=${CHECKPOINTS.at(-1)}: ${z.listenersTop || "—"}`);
  const byLayer = (o) => Object.entries(o || {}).map(([k, v]) => `${String(k).split(" ").pop()}:${v}`).join(" ");
  console.log(`  LEAFLET TILES BY LAYER   N=0:  ${byLayer(a.tilesByLayer) || "—"}`);
  console.log(`                           N=${CHECKPOINTS.at(-1)}: ${byLayer(z.tilesByLayer) || "—"}`);
}

/* THE SNAPSHOT DIFF — what the retained-heap slope actually IS. A growth rate with no named class
 * is a symptom; this is the line that turns it into a finding. Detached bytes come from V8's own
 * per-node `detachedness` flag, not from the renderer-nodes-minus-attached-nodes proxy above. */
const snapRun = runs.find((r) => r.arm === "interact" && r.snapDiff?.ok);
if (snapRun) {
  const d = snapRun.snapDiff, N = snapRun.interactionsDriven;
  console.log(`\n  HEAP SNAPSHOT DIFF — checkpoint 0 → checkpoint ${CHECKPOINTS.at(-1)} (${N} interactions), forced GC both ends`);
  console.log(`    total retained  ${(d.totalBytesDelta / 1048576).toFixed(2)} MB over ${d.totalNodesDelta} objects  ·  ${perInteraction(d.totalBytesDelta, N)} bytes per interaction`);
  console.log(`    DETACHED DOM    ${d.detachedKnown ? `${(d.detachedBytesDelta / 1024).toFixed(1)} KB over ${d.detachedNodesDelta} nodes (V8's own detachedness flag)` : "NOT MEASURED — this Chrome's snapshot has no detachedness column, so no detached figure may be quoted"}`);
  console.log(`    ${pad("class", 44)}${rpad("Δ bytes", 12)}${rpad("Δ objects", 11)}${rpad("per interaction", 17)}`);
  for (const r of d.rows.slice(0, 12)) {
    console.log(`    ${pad(r.klass.slice(0, 43), 44)}${rpad(`${(r.bytes.delta / 1024).toFixed(1)} KB`, 12)}${rpad(r.nodes.delta, 11)}${rpad(`${perInteraction(r.bytes.delta, N)} B`, 17)}`);
  }
} else if (SNAPSHOT) {
  console.log(`\n  ⚠ HEAP SNAPSHOT UNAVAILABLE: ${runs.find((r) => r.arm === "interact")?.snapDiff?.why || "no interact arm ran"}`);
}

if (LITE) console.log(`\n  --lite: the harness's own listener identity map was DISABLED for this run, so the retained-heap slope above carries none of the instrument's own growth. Compare it against a full run to attribute the number.`);
else if (lastRaw.length) console.log(`\n  ⚠ THE HARNESS'S OWN FOOTPRINT: its listener identity map held ${lastRaw.at(-1).counters.instrumentEntries} entries by the end of this run. Re-run with --lite (map off) before attributing any retained-heap slope to the app.`);

if (out.tileCaveat) console.log(`\n  ⚠ ${out.tileCaveat}`);
else console.log(`\n  TILES ACTUALLY DECODED (--fake-tiles): ${out.tilesServed} served, ${lastRaw.at(-1)?.counters.tilesLoaded ?? "?"} retained-and-decoded at the end \u2248 ${out.decodedMB} MB of decoded bitmap, which the JS heap CANNOT see. The tile bytes are synthetic; the decode, the bitmap and the texture upload are real.`);
console.log("");
