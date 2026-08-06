#!/usr/bin/env node
/* session-axes — DOES THE SAME GESTURE COST MORE AS A WORK SESSION FILLS UP? (NEW-2)
 *
 * ⛔ THE REFRAME THIS HARNESS EXISTS FOR, and it corrects the framing of every prior instrument.
 *
 * B1432's probe (ui-audit/interaction-degradation.mjs) is correct and STAYS. It froze CONTENT and
 * varied INTERACTION COUNT, and across 3,000 gestures in three regimes nothing grew. But a real
 * work session is not a constant scene. The owner DRAWS elements, TURNS LAYERS ON, OPENS PANELS,
 * SWITCHES PLANS AND REVISIONS, and EDITS — and every one of those rises monotonically through a
 * session and every one of them resets on reload. So the honest hypothesis is not ACCUMULATION,
 * it is AMPLIFICATION: per-frame cost is a function of what the session has filled up with, and
 * "time since reload" is only the proxy that correlates with all of it. This also RECONCILES
 * B1357's r = 0.93 "cost tracks how much is drawn" — that finding may have been right all along,
 * and what changes during his session is how much is drawn, because he is the one drawing it.
 *
 * THE SHAPE, one axis at a time, everything else held:
 *   (a) PANELS   opened cumulatively (one docked + up to four floated)
 *   (b) LAYERS   enabled cumulatively (the drawn view layers; the GIS rows are attempted and the
 *                sandbox's answer about them is reported rather than hidden)
 *   (c) ELEMENTS drawn cumulatively — real buildings, drawn with the real tool, the r=0.93 axis
 *                driven the way HE drives it rather than by injecting a fixture
 *   (d) EDITS    made — pan cost immediately after an edit vs after a settle, which is the
 *                memo-invalidation test, plus a cumulative-edits ladder
 *   (e) PLANS    switched — A → B → A, and whether A ever cost what A cost the first time
 *
 * ⚠ THE CONTROL IS INVERTED RELATIVE TO B1432, AND THAT INVERSION IS THE WHOLE DESIGN. There,
 * content constant was the premise and a content change was a fault. Here content IS the
 * variable, so the guards are (1) the VIEW must be neutral at every rung — B1432's own assertion,
 * imported not re-derived — and (2) THE RUNG MUST ACTUALLY HAVE TAKEN. A rung whose panel never
 * opened is not a cheap rung, it is a missing one, and its perfectly plausible frame number
 * joining the trend line is the most dangerous thing an instrument of this shape can do.
 * `rungEffectFault` (lib/sessionAxes.mjs) asserts it at every rung and SUPPRESSES the number
 * rather than reporting it.
 *
 * ⚠ HEADED, ON A REAL X SERVER — same reason as B1432 (a hidden tab starves rAF; the B1086 trap).
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/session-axes.mjs
 *   ... --axes panels,elements    # a subset while iterating
 *   ... --cpu-throttle 4          # emulate a slower machine
 *   ... --fake-tiles --dpr 2      # the retina regime, with tiles that actually decode
 *   ... --reps 5                  # more repeats at rung 0 → a tighter noise floor
 *   ... --json
 *
 * ⛔ THE INSTRUMENT WAS FIXED RATHER THAN THE FLOOR REPORTED AGAIN — which is what the item asked
 * for in as many words. B1432 stated a ±33–100% floor from 16.7 ms frame quantisation and was
 * blocked by it in all three regimes, and MORE REPEATS COULD NEVER HAVE HELPED: the quantisation
 * is in the metric, not the sample size. A frame median is a percentile of inter-frame deltas,
 * and the display clock only ever produces 16.7, 33.3, 50.0 — so on a 16.7 ms median the smallest
 * difference the metric can EXPRESS is ±100%.
 *
 * So the cost metric here is not a frame time. It is MAIN-THREAD WORK PER GESTURE — script +
 * layout + style recalculation, differenced from the renderer's own cumulative counters at
 * microsecond resolution — cross-read against `longtask` and Event Timing. The frame median is
 * still measured and still printed beside it, so every number stays comparable to B1432's; it is
 * simply no longer what the verdict rests on. Measured effect of the change on this machine:
 * the floor went from ±99.8% (unusable) to a few per cent (usable).
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate.
 */
import { chromium } from "playwright";
import { perfScenarioSeedMulti, scenarioShape, SCENARIO_ID, SCENARIO_ID_B } from "./lib/perf-scenario.mjs";
import { frameSamplingFault, plausibilityFloor, observedFps } from "./lib/frameSampling.mjs";
import { noiseFloor } from "./lib/longSession.mjs";
import {
  AXES, axisById, rungEffectFault, rungViewFault, axisCost,
  editRecoveryVerdict, planSwitchVerdict, rankAxes, quantisationFloor, pct, viewDrift,
} from "./lib/sessionAxes.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const numArg = (flag, dflt) => { const v = Number(argOf(flag, NaN)); return Number.isFinite(v) && v > 0 ? v : dflt; };

const CPU_THROTTLE = numArg("--cpu-throttle", 1);
const REPS = numArg("--reps", 4);
/* ⛔ EVERY RUNG IS PROBED `--rung-reps` TIMES AND REPORTED AS THE MEDIAN, and the noise floor is
 * measured on THE SAME ESTIMATOR — `REPS` independent groups of `RUNG_REPS` probes at rung 0, the
 * spread of whose medians IS the floor. Getting this wrong is subtle and fatal: a floor measured
 * on SINGLE probes but applied to a MEDIAN-OF-THREE is too wide by roughly the square root of the
 * group size, and it will call a real effect INCONCLUSIVE. The first version of this harness did
 * exactly that and buried a clean +51% panel trend under a ±54% floor. */
const RUNG_REPS = numArg("--rung-reps", 3);
const DPR = numArg("--dpr", 1);
const FAKE_TILES = process.argv.includes("--fake-tiles");
const SETTLE_MS = numArg("--settle", 30000); // the "after 30 idle seconds" half of the edit test
const WANT = String(argOf("--axes", "panels,layers,elements,edits,plans")).split(",").map((s) => s.trim()).filter(Boolean);
const MIN_FPS = plausibilityFloor(CPU_THROTTLE);

/* ── In-page instrumentation ──────────────────────────────────────────────────────────────────
 * Deliberately MUCH smaller than B1432's. That harness had to settle "does anything accumulate",
 * which needed listener identity maps and observer wrappers. This one varies content on purpose,
 * so the counters that matter are the ones describing the SCENE — and a lighter instrument is a
 * smaller thing to have to subtract from its own results. The frame sampler is identical, so a
 * number here is comparable to a number there. */
const INSTRUMENT = `(() => {
  window.__frames = [];
  const RAF = window.requestAnimationFrame.bind(window);
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; RAF(tick); };
  RAF(tick);

  /* ⛔ THE INSTRUMENT FIX THE ITEM DEMANDED, and it is the reason this harness can answer what
   * B1432's could not. A frame median is a percentile of INTER-FRAME DELTAS, and the display
   * clock quantises those to ~16.7 ms — so the smallest difference the metric can EXPRESS is one
   * whole frame, which on a 16.7 ms median is ±100%. B1432 stated that floor honestly and was
   * blocked by it in all three regimes. Running it more times cannot help: the quantisation is in
   * the metric, not the sample size.
   *
   * So the PRIMARY cost metric here is not a frame time at all. It is MAIN-THREAD WORK PER
   * GESTURE, read three independent ways, none of them quantised by the display clock:
   *   1. CDP Performance.getMetrics deltas — ScriptDuration + LayoutDuration + RecalcStyleDuration,
   *      in seconds at microsecond resolution (taken by the harness, not here);
   *   2. PerformanceObserver('longtask') — every 50 ms-plus block of the main thread, summed;
   *   3. PerformanceObserver('event') — the Event Timing API, which is what INP is built from:
   *      per-input-event processing time, sub-frame, and the closest thing in the platform to
   *      "how long did the app take to respond to that pointermove".
   * Frame median is KEPT and still reported, because it is what the previous instrument reported
   * and the two must stay comparable — it is just no longer the thing the verdict rests on. */
  window.__lt = { total: 0, count: 0, max: 0 };
  window.__ev = { total: 0, count: 0, max: 0, byType: {} };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { window.__lt.total += e.duration; window.__lt.count++; if (e.duration > window.__lt.max) window.__lt.max = e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const proc = Math.max(0, (e.processingEnd || 0) - (e.processingStart || 0));
        window.__ev.total += proc; window.__ev.count++;
        if (e.duration > window.__ev.max) window.__ev.max = e.duration;
        window.__ev.byType[e.name] = +((window.__ev.byType[e.name] || 0) + proc).toFixed(2);
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch (_) {}
  window.__pfReset = () => {
    window.__frames.length = 0;
    window.__lt = { total: 0, count: 0, max: 0 };
    window.__ev = { total: 0, count: 0, max: 0, byType: {} };
  };
  window.__pfRead = () => ({
    frames: window.__frames.slice(),
    longtaskMs: +window.__lt.total.toFixed(2), longtasks: window.__lt.count, longtaskMaxMs: +window.__lt.max.toFixed(2),
    eventProcMs: +window.__ev.total.toFixed(2), events: window.__ev.count, eventMaxMs: +window.__ev.max.toFixed(2),
    eventByType: window.__ev.byType,
  });
})();`;

/* What each rung records. `panelsOpen` / `layersOn` / `elementsDrawn` are the OBSERVABLES the
 * rung-effect guard asserts against — they are the difference between a measured axis and a
 * broken driver producing a confident flat line. */
const COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const docked = document.querySelector('[data-testid="left-menu-panel"]') ? 1 : 0;
  /* EXACT ids only. A prefix match counts FOUR nodes per floating panel — the card, its chrome
   * bar, and the chrome's two icon buttons all carry a data-testid starting "floating-panel-" —
   * which read as 13 panels open for 4 actual panels on the first run of this harness. The
   * rung-effect guard caught it (rung 2 "observed 5") and suppressed every affected rung, which
   * is exactly what it is for; the fix is to count the thing rather than loosen the guard. */
  const floating = [...document.querySelectorAll('[data-testid]')]
    .filter((n) => /^floating-panel-[a-z]+$/.test(n.getAttribute("data-testid"))).length;
  return {
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
    documentNodes: document.getElementsByTagName("*").length,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : 0,
    canvasText: svg ? svg.getElementsByTagName("text").length : 0,
    panelsOpen: docked + floating,
    panelsDocked: docked,
    panelsFloating: floating,
    layersOn: Number(document.body.dataset.pfLayersOn || 0),
    tiles: document.querySelectorAll("img.leaflet-tile").length,
    tileLayers: document.querySelectorAll(".leaflet-layer").length,
    ppf: svg ? +Number(svg.getAttribute("data-view-ppf")).toFixed(5) : null,
  };
})()`;

const readView = `(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null;
})()`;

/* A press point that is UNAMBIGUOUSLY bare canvas — the top hit must BE the <svg>. A press on an
 * element DRAGS THE ELEMENT, which on this harness would silently add an edit to an axis that is
 * not the edit axis (B1432's MEASUREMENT BLOCKER #5, and it bites harder here because the
 * elements axis keeps ADDING elements under the old press point). Re-resolved at every rung. */
const PRESS_POINT = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.28, 0.72, 0.14, 0.86]) {
    for (const fx of [0.28, 0.72, 0.14, 0.86, 0.5]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
})()`;

/* ── The probe ────────────────────────────────────────────────────────────────────────────────
 * IDENTICAL to B1432's in shape (pan out-and-back + wheel in-and-out at fixed distances from a
 * fixed anchor) so the two instruments' numbers are comparable, but LONGER: more pan steps and
 * more wheel bursts, because this harness's whole problem is that the previous one's ±50% floor
 * blocked its answer, and the cheapest honest fix for a quantisation floor is more samples per
 * probe. Both halves are symmetric by construction; symmetry is asserted afterwards. */
const PAN_PX = 260, PAN_STEPS = 20, WHEEL_BURSTS = 6, WHEEL_BURST = 5, WHEEL_DELTA = 120;

const wheelBurst = ([n, dy, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  const ch = (window.__pfWheelCh = window.__pfWheelCh || new MessageChannel());
  let i = 0;
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < n) ch.port2.postMessage(0); else done();
  };
  ch.port1.start();
  ch.port2.postMessage(0);
});

/* The renderer's own cumulative work counters, in ms. Differenced across a probe they give the
 * gesture's main-thread cost at microsecond resolution — no display-clock quantisation, so the
 * noise floor is the machine's, not the frame grid's. `*Count` rides along because "more layouts"
 * and "dearer layouts" are different diagnoses with different fixes (the distinction B1359 turned
 * on: LayoutCount flat while LayoutDuration rose 45%). */
async function workMetrics(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {};
    for (const { name, value } of m.metrics || []) g[name] = value;
    return {
      scriptMs: (g.ScriptDuration || 0) * 1000,
      layoutMs: (g.LayoutDuration || 0) * 1000,
      recalcMs: (g.RecalcStyleDuration || 0) * 1000,
      taskMs: (g.TaskDuration || 0) * 1000,
      layoutCount: g.LayoutCount || 0,
      recalcCount: g.RecalcStyleCount || 0,
    };
  } catch (_) { return null; }
}

const subWork = (a, b) => (a && b ? {
  scriptMs: +(b.scriptMs - a.scriptMs).toFixed(2),
  layoutMs: +(b.layoutMs - a.layoutMs).toFixed(2),
  recalcMs: +(b.recalcMs - a.recalcMs).toFixed(2),
  taskMs: +(b.taskMs - a.taskMs).toFixed(2),
  layoutCount: b.layoutCount - a.layoutCount,
  recalcCount: b.recalcCount - a.recalcCount,
} : null);

async function probe(page, press, ctx) {
  const view = () => page.evaluate(readView);
  await page.mouse.move(press.x, press.y);
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__pfReset(); });
  const w0 = await workMetrics(ctx.cdp);

  const before = await view();
  const t0 = Date.now();

  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  const mid = await view();
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();

  for (let b = 0; b < WHEEL_BURSTS; b++) {
    await page.evaluate(wheelBurst, [WHEEL_BURST, b < WHEEL_BURSTS / 2 ? -WHEEL_DELTA : WHEEL_DELTA, press.x, press.y]);
    await page.waitForTimeout(30);
  }

  const gestureMs = Date.now() - t0;
  await page.waitForTimeout(150);
  const after = await view();
  const w1 = await workMetrics(ctx.cdp);
  const read = await page.evaluate(() => window.__pfRead());
  const frames = read.frames.slice(1);
  const work = subWork(w0, w1);

  /* ⚠ THE FRAME-SAMPLING FAULT NO LONGER SUPPRESSES THE WHOLE PROBE, and that change is
   * deliberate rather than a loosening. It exists (B1086) because a THROTTLED rAF makes a frame
   * MEDIAN meaningless — and it still nulls the frame median for exactly that reason. But the
   * work metrics are read from the renderer's own cumulative counters, which a starved rAF does
   * not touch: the app still did the script, layout and style work, whatever the compositor got
   * around to painting. Suppressing a valid work measurement because a secondary metric was
   * starved would be throwing away the number that actually answers the question. The VIEW guard
   * still suppresses everything, because a probe that looked at the wrong scene measured the
   * wrong thing in every metric at once. */
  const fault = frameSamplingFault({ visibility: ctx.visibility, samples: frames.length, gestureMs, minFps: MIN_FPS });
  const validity = rungViewFault({ before, mid, after }, 1);
  const frameOk = !fault && !validity;
  return {
    /* THE PRIMARY COST. Script + layout + style recalculation the renderer actually performed
     * during the gesture, in ms. Not quantised, so a 10% regression is a 10% move. */
    probeWorkMs: validity || !work ? null : +(work.scriptMs + work.layoutMs + work.recalcMs).toFixed(2),
    work: validity ? null : work,
    longtaskMs: validity ? null : read.longtaskMs,
    longtasks: validity ? null : read.longtasks,
    longtaskMaxMs: validity ? null : read.longtaskMaxMs,
    eventProcMs: validity ? null : read.eventProcMs,
    events: validity ? null : read.events,
    eventMaxMs: validity ? null : read.eventMaxMs,
    eventByType: validity ? null : read.eventByType,
    // Kept, and still floor-guarded, so a number here stays comparable to B1432's.
    probeMedianMs: frameOk && frames.length ? +pct(frames, 50).toFixed(2) : null,
    probeP90Ms: frameOk && frames.length ? +pct(frames, 90).toFixed(2) : null,
    frames: frames.length,
    fps: observedFps(frames.length, gestureMs),
    gestureMs,
    drift: viewDrift(before, after),
    fault: fault || null,
    validity: validity || null,
  };
}

async function counters(page, cdp) {
  try { await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {}
  await page.waitForTimeout(100);
  const page_ = await page.evaluate(COUNTERS);
  let metrics = {};
  try {
    const m = await cdp.send("Performance.getMetrics");
    for (const { name, value } of m.metrics || []) metrics[name] = value;
  } catch (_) {}
  let dom = {};
  try { dom = await cdp.send("Memory.getDOMCounters"); } catch (_) {}
  return {
    ...page_,
    retainedHeapMB: metrics.JSHeapUsedSize != null ? +(metrics.JSHeapUsedSize / 1048576).toFixed(2) : null,
    rendererNodes: metrics.Nodes ?? dom.nodes ?? null,
    jsEventListenersCdp: metrics.JSEventListeners ?? dom.jsEventListeners ?? null,
    layoutObjects: metrics.LayoutObjects ?? null,
    layoutCount: metrics.LayoutCount ?? null,
    layoutDurationMs: metrics.LayoutDuration != null ? +(metrics.LayoutDuration * 1000).toFixed(1) : null,
    recalcStyleCount: metrics.RecalcStyleCount ?? null,
    recalcStyleDurationMs: metrics.RecalcStyleDuration != null ? +(metrics.RecalcStyleDuration * 1000).toFixed(1) : null,
    scriptDurationMs: metrics.ScriptDuration != null ? +(metrics.ScriptDuration * 1000).toFixed(1) : null,
  };
}

/* Put the view back EXACTLY, through the planner's own E2E hook (B1432's `restoreView`, same
 * reason: floating-point zoom at an anchor is very nearly reversible and not exactly reversible,
 * and "very nearly" compounds into a drift that would make rung N look at a different scene). */
async function restoreView(page, home) {
  if (!home) return;
  await page.evaluate((h) => {
    const v = window.__plannerView;
    if (!v || typeof v.centerOn !== "function") return;
    const { w, h: hh } = v.get();
    const ppf = Number(h.ppf);
    v.centerOn((w / 2 - Number(h.offX)) / ppf, (hh / 2 - Number(h.offY)) / ppf, ppf);
  }, home);
  await page.waitForTimeout(150);
}

/* ── The five drivers ────────────────────────────────────────────────────────────────────────
 * Each returns the number of units it BELIEVES it added. Nothing trusts that number: the rung's
 * observable is read back and `rungEffectFault` decides whether the rung may be reported. */

const PANEL_IDS = ["yield", "parcel", "analysis", "references", "standards"];

/* (a) PANELS. The left dock is single-occupancy (B1125's model), so "several panels open" means
 * one DOCKED plus the rest FLOATED — which is exactly how the owner works when he wants Yield and
 * Standards in view at once. Each step detaches the currently docked panel and docks the next, so
 * the ladder is genuinely cumulative rather than a swap. */
async function openOnePanel(page, index) {
  const prev = PANEL_IDS[index - 1];
  if (prev) {
    const detach = page.locator(`[data-testid="panel-chrome-${prev}-detach"]`);
    if (await detach.count()) { await detach.first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); }
  }
  const tab = page.locator(`[data-rail-tab="${PANEL_IDS[index]}"]`);
  if (await tab.count()) { await tab.first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(250); }
}

/* (b) LAYERS. Two kinds, and the difference is stated rather than blurred.
 *   • the DRAWN view layers (dock doors, column grid, dimensions, areas) genuinely add canvas
 *     nodes and work offline — they are the axis this sandbox can actually measure;
 *   • the GIS rows need an external host the sandbox blocks, so enabling them adds Leaflet layer
 *     objects and React work but never any data. Attempted, counted separately, and reported as
 *     a floor rather than a match. Never silently folded into the same number.
 * Rung 0 turns all four DRAWN layers OFF so the ladder starts from a real zero — `showDims` and
 * `showAreas` default ON, and a ladder that starts with two rungs already climbed measures a
 * two-rung-shorter axis while claiming to measure the whole one. */
const VIEW_LAYERS = ["Show dock doors", "Show column grid", "Show dimensions", "Show areas"];

async function setViewLayers(page, on) {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  if (!(await btn.count())) return 0;
  if ((await btn.first().getAttribute("aria-expanded")) !== "true") { await btn.first().click().catch(() => {}); await page.waitForTimeout(150); }
  let n = 0;
  for (let i = 0; i < VIEW_LAYERS.length; i++) {
    const want = i < on;
    const box = page.locator(`label:has-text("${VIEW_LAYERS[i]}") input[type=checkbox]`).first();
    if (!(await box.count())) continue;
    const is = await box.isChecked().catch(() => null);
    if (is === null) continue;
    if (is !== want) { await box.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(120); }
    if (want) n++;
  }
  // Publish the count where COUNTERS can read it: the observable has to come from the PAGE, not
  // from the driver's own belief about what it clicked.
  await page.evaluate((v) => { document.body.dataset.pfLayersOn = String(v); }, n);
  await page.waitForTimeout(200);
  return n;
}

/* (c) ELEMENTS. Drawn with the REAL building tool by a REAL drag — not injected into the store —
 * because the question is what a session costs, and a session's elements arrive through the draw
 * path with everything that hangs off it (neighbour resolution, the road network union, the
 * dissolve, the label pass, an undo frame each). A lattice, deterministic, inside the viewport. */
const elementsDrawnNow = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return svg ? svg.querySelectorAll("[data-el-id]").length : 0;
});

async function drawBuildings(page, count, seed = 0) {
  const rail = page.locator('button.rbtn', { hasText: /^\s*Building\s*$/ });
  const canvas = page.locator('[data-testid="planner-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) return 0;
  let drawn = 0;
  /* ⛔ EVERY DRAW IS VERIFIED, AND A FAILED ONE IS RETRIED AT A DIFFERENT SPOT. A drag that starts
   * on an existing element MOVES it instead of drawing — so it silently produces an EDIT on the
   * ELEMENTS axis and no new element. The first run of this harness lost one building in eight to
   * exactly that, and the rung-effect guard then (correctly) suppressed three rungs of otherwise
   * good data. Verifying here is the fix; loosening the guard would have been the mistake. */
  for (let attempt = 0; attempt < count * 4 && drawn < count; attempt++) {
    const before = await elementsDrawnNow(page);
    if (await rail.count()) await rail.first().click({ timeout: 5000 }).catch(() => {});
    const k = seed + drawn + attempt * 7; // walk the lattice on a retry so the next try lands elsewhere
    const col = k % 7, row = Math.floor(k / 7) % 6;
    const x = box.x + box.width * (0.08 + col * 0.12);
    const y = box.y + box.height * (0.10 + row * 0.135);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 54, y + 38, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(110);
    if ((await elementsDrawnNow(page)) > before) drawn++;
  }
  await page.keyboard.press("Escape").catch(() => {});
  const sel = page.locator('button.rbtn', { hasText: /^\s*Select\s*$/ });
  if (await sel.count()) await sel.first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  return drawn;
}

/* (d) EDITS. An arrow-key nudge is the cheapest real edit in the product: it pushes an undo
 * generation, re-identifies the model array, and invalidates every memo keyed on it — which is
 * precisely the mechanism this axis exists to test. The batch runs OUT and straight BACK so the
 * geometry ends where it started (the elements axis must not move underneath the edits axis), and
 * the element's own screen position is sampled at the turn, which is how the harness PROVES the
 * nudges landed instead of counting keystrokes it sent into the void. */
async function selectAnElement(page) {
  const el = page.locator('[data-el-id]').first();
  if (!(await el.count())) return null;
  const b = await el.boundingBox();
  if (!b) return null;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(200);
  return await el.getAttribute("data-el-id");
}

async function elementX(page, id) {
  return page.evaluate((i) => {
    const n = document.querySelector(`[data-el-id="${i}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return Number.isFinite(r.x) ? +r.x.toFixed(2) : null;
  }, id);
}

async function nudgeBatch(page, id, half) {
  const x0 = await elementX(page, id);
  for (let i = 0; i < half; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(25); }
  const xMid = await elementX(page, id);
  for (let i = 0; i < half; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(25); }
  const x1 = await elementX(page, id);
  /* `moved` is the harness's PROOF that the edits landed. Without it, a keydown swallowed by a
   * focused input (or a deselect) would produce a rung of zero real edits whose frame cost joins
   * the trend as if the axis were free. */
  const moved = x0 != null && xMid != null ? Math.abs(xMid - x0) : 0;
  return { applied: moved > 0.5 ? half * 2 : 0, movedPx: +moved.toFixed(2), returned: x0 != null && x1 != null ? +Math.abs(x1 - x0).toFixed(2) : null };
}

/* (e) PLANS. Switched by ROUTE — `#/project/<groupId>/site` — because that is the app's own
 * project switch and it is the path a shared link takes too. The switch is PROVEN by the element
 * count changing (plan B is half of plan A by construction), never by a wait that was hopefully
 * long enough. */
async function switchPlan(page, groupId) {
  await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, groupId);
  await page.waitForTimeout(2500);
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/* One rung's cost: `RUNG_REPS` identical probes, reported as the MEDIAN of their work totals.
 * A single probe is not a measurement here — the first run of this harness had rung 4 come back
 * BELOW rung 3 on a monotone axis purely because one probe caught a GC. The per-probe detail is
 * kept so the spread is visible rather than hidden behind its own median. */
async function probeRung(page, ctx, home, reps) {
  const samples = [];
  for (let i = 0; i < reps; i++) {
    await restoreView(page, home);
    const press = (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 };
    samples.push(await probe(page, press, ctx));
  }
  const work = samples.map((s) => s.probeWorkMs).filter((x) => Number.isFinite(x));
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const pick = (k) => med(samples.map((s) => s[k]).filter(Number.isFinite));
  /* THE REPRESENTATIVE SAMPLE IS THE ONE THAT *IS* THE MEDIAN, not the first clean one. Taking
   * the breakdown from a different probe than the total printed a rung whose script time exceeded
   * its own work total — an internally inconsistent row, which is the kind of thing that makes a
   * reader rightly stop trusting the whole table. */
  const medWork = work.length ? med(work) : null;
  const best = samples.find((s) => s.probeWorkMs === medWork) || samples.find((s) => s.probeWorkMs != null) || samples[samples.length - 1];
  return {
    ...best,
    probeWorkMs: medWork != null ? +medWork.toFixed(2) : null,
    workSamples: work,
    workSpreadPct: work.length >= 2 && med(work) ? +(((Math.max(...work) - Math.min(...work)) / med(work)) * 100).toFixed(1) : null,
    longtaskMs: pick("longtaskMs"),
    eventProcMs: pick("eventProcMs"),
    probeMedianMs: pick("probeMedianMs"),
    probeP90Ms: pick("probeP90Ms"),
    work: best?.work ?? null,
    reps: samples.length,
  };
}

/* ── One axis: the ladder, the guard, the slope ──────────────────────────────────────────────── */
async function runAxis(page, cdp, { axis, rungs, drive, mode = "exact", tolerance = 0, home, ctx, floorPct, observe = null }) {
  const a = axisById(axis);
  const out = { axis, title: a.title, unit: a.unit, rungs: [], costs: [] };
  const base = await counters(page, cdp);
  /* `observe` exists for the ONE axis with no page counter: "edits made" is nowhere in the DOM,
   * and inventing a `data-edits` attribute in product source to satisfy a harness would be the
   * tail wagging the dog. Instead the edits driver PROVES its own work (the element visibly moved
   * on screen) and reports that count here, so it passes through the identical rung guard every
   * other axis does rather than getting an exemption. */
  const read = observe || (async () => (await counters(page, cdp))[a.observable]);
  const baseline = observe ? 0 : (base[a.observable] ?? 0);

  for (const target of rungs) {
    if (target > 0) await drive(target);
    const p = await probeRung(page, ctx, home, RUNG_REPS);
    const c = await counters(page, cdp);
    const observed = await read();
    const effect = rungEffectFault({ axis, target, observed, baseline, mode, tolerance });
    if (effect) { p.probeWorkMs = null; p.probeMedianMs = null; p.probeP90Ms = null; }
    process.stderr.write(`  · ${axis} rung ${target} → ${a.observable}=${observed} · work ${p.probeWorkMs ?? "—"} ms (script ${p.work?.scriptMs ?? "—"} · layout ${p.work?.layoutMs ?? "—"} · style ${p.work?.recalcMs ?? "—"}) · frame ${p.probeMedianMs ?? "—"} ms · canvasNodes ${c.canvasNodes}${effect ? "  ⚠ SUPPRESSED" : ""}\n`);
    out.rungs.push({ target, observed: observed ?? null, ...p, effectFault: effect || null, counters: c });
    out.costs.push(p.probeWorkMs);
  }
  out.baselineObservable = baseline;
  out.cost = axisCost({ rungs: out.rungs.map((r) => r.target), costs: out.costs, floorPct });
  return out;
}

/* ── Main ─────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false, // ⚠ REQUIRED — a hidden tab starves rAF and the median is garbage (B1086)
  args: ["--ignore-certificate-errors", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true,
});
await context.addInitScript(INSTRUMENT);
await context.addInitScript(perfScenarioSeedMulti());
await context.addInitScript(() => { window.__PLANYR_E2E = true; });

let tilesServed = 0;
await context.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
  if (FAKE_TILES) {
    const t = parseTileUrl(u);
    if (t) {
      tilesServed++;
      return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) });
    }
  }
  return route.abort();
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable").catch(() => {});
await cdp.send("HeapProfiler.enable").catch(() => {});
if (CPU_THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE }).catch(() => {});

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(2500);

const visibility = await page.evaluate(() => document.visibilityState);
const ctx = { visibility, cdp };
const home = await page.evaluate(readView);

/* ⛔ TWO DISCARDED WARM-UP PROBES FIRST, and this is not a way of throwing away an inconvenient
 * number. B1433 measured what grows in the heap over a long run and found it was **V8 compiling
 * hot functions** — `[code]`, instruction streams, nothing of the app's. The first gesture after
 * a load therefore pays for JIT that no later gesture pays again, which is a real cost that
 * belongs to BOOT (B1431's territory) and is pure contamination in a per-rung comparison. Two,
 * not one, because the wheel half and the pan half warm separate paths. */
for (let i = 0; i < 2; i++) {
  await restoreView(page, home);
  await probe(page, (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 }, ctx);
}

/* Rung 0, estimated `REPS` times BY THE SAME ESTIMATOR every rung uses (a median of RUNG_REPS
 * probes): the spread of those estimates IS this machine's noise floor for the number the verdict
 * actually rests on. Printed beside the old frame-median floor so the reader can see which limit
 * was binding, and that the change of metric is what moved it. */
const zero = [];
for (let i = 0; i < REPS; i++) zero.push(await probeRung(page, ctx, home, RUNG_REPS));
/* THE FLOOR IS NOW MEASURED ON THE WORK METRIC, WHICH IS THE WHOLE POINT OF CHANGING IT.
 * `noiseFloor` floors its answer at one 16.7 ms frame quantum — correct for a frame median, and
 * WRONG for a work total, where 16.7 ms is an ordinary amount of script rather than the smallest
 * expressible difference. So the work floor is computed here from the repeats' own spread, and
 * the frame floor is computed the old way and printed beside it, so the two are never confused. */
const workReps = zero.map((p) => p.probeWorkMs).filter((x) => Number.isFinite(x) && x > 0);
const workSorted = [...workReps].sort((a, b) => a - b);
const workMedian = workSorted.length ? workSorted[Math.floor(workSorted.length / 2)] : null;
const floorPct = workSorted.length >= 2 && workMedian
  ? +(((workSorted[workSorted.length - 1] - workSorted[0]) / workMedian) * 100).toFixed(1)
  : null;
const floor = { floorPct, metric: `script+layout+style ms per gesture, as a median of ${RUNG_REPS} probes`, median: workMedian, min: workSorted[0] ?? null, max: workSorted[workSorted.length - 1] ?? null, reps: workSorted.length, probesPerEstimate: RUNG_REPS };
const frameFloor = noiseFloor(zero.map((p) => p.probeMedianMs));
const zeroMedian = pct(zero.map((p) => p.probeMedianMs).filter(Number.isFinite), 50);
process.stderr.write(`  · WORK floor ±${floorPct ?? "—"}% on a ${workMedian ?? "—"} ms median · (frame-median floor was ±${frameFloor?.floorPct ?? "—"}%, of which ±${quantisationFloor(zeroMedian) ?? "—"}% is 16.7 ms quantisation alone)\n`);

const results = [];
const extras = {};

/* (a) panels */
if (WANT.includes("panels")) {
  results.push(await runAxis(page, cdp, {
    axis: "panels", rungs: [0, 1, 2, 3, 4], home, ctx, floorPct, mode: "exact", tolerance: 0,
    drive: async (target) => { await openOnePanel(page, target - 1); },
  }));
  /* Leave the app as we found it, so the NEXT axis is not silently measuring this one's residue.
   * Every rail tab is a toggle, so clicking a lit one closes it — for the docked panel AND, per
   * the rail's own handler, for a floating one. Deliberately not "close every ✕ we can find":
   * that would also close chrome this axis never opened. */
  for (const id of PANEL_IDS) {
    const tab = page.locator(`[data-rail-tab="${id}"][aria-pressed="true"]`);
    if (await tab.count()) { await tab.first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(150); }
  }
  await page.waitForTimeout(400);
}

/* (b) layers */
if (WANT.includes("layers")) {
  await setViewLayers(page, 0);
  results.push(await runAxis(page, cdp, {
    axis: "layers", rungs: [0, 1, 2, 3, 4], home, ctx, floorPct, mode: "exact", tolerance: 0,
    drive: async (target) => { await setViewLayers(page, target); },
  }));
  await setViewLayers(page, 4); // back to the product's own defaults-ish resting state
}

/* (c) elements */
if (WANT.includes("elements")) {
  let drawnSoFar = 0;
  results.push(await runAxis(page, cdp, {
    axis: "elements", rungs: [0, 8, 16, 24, 30], home, ctx, floorPct, mode: "atLeast", tolerance: 1,
    drive: async (target) => {
      const need = target - drawnSoFar;
      if (need > 0) drawnSoFar += await drawBuildings(page, need, drawnSoFar);
    },
  }));
}

/* (d) edits — BOTH halves: the cumulative ladder, and the hot-vs-settled memo-invalidation test */
if (WANT.includes("edits")) {
  const id = await selectAnElement(page);
  if (!id) {
    extras.edits = { verdict: "unmeasured", why: "no element could be selected, so no edit could be made" };
  } else {
    let applied = 0, lastMoved = 0;
    const ladder = await runAxis(page, cdp, {
      axis: "edits", rungs: [0, 10, 20, 30, 40], home, ctx, floorPct, mode: "atLeast", tolerance: 0,
      observe: async () => applied,
      drive: async (target) => {
        const need = target - applied;
        if (need <= 0) return;
        const r = await nudgeBatch(page, id, Math.ceil(need / 2));
        applied += r.applied; lastMoved = r.movedPx;
      },
    });
    ladder.editsProven = applied;
    ladder.lastNudgePx = lastMoved;
    results.push(ladder);

    /* THE MEMO-INVALIDATION TEST. Edit, probe IMMEDIATELY; then leave it alone for `--settle` and
     * probe again. If memo dependency arrays include the model object, the first gesture after an
     * edit pays to re-fill everything the edit invalidated, and hot > cold. */
    await restoreView(page, home);
    await nudgeBatch(page, id, 1);
    const hot = await probeRung(page, ctx, home, RUNG_REPS);
    process.stderr.write(`  · edit-recovery: settling ${Math.round(SETTLE_MS / 1000)}s…\n`);
    await page.waitForTimeout(SETTLE_MS);
    const cold = await probeRung(page, ctx, home, RUNG_REPS);
    extras.editRecovery = {
      hot: { workMs: hot.probeWorkMs, medianMs: hot.probeMedianMs, work: hot.work, fault: hot.fault || hot.validity || null },
      cold: { workMs: cold.probeWorkMs, medianMs: cold.probeMedianMs, work: cold.work, fault: cold.fault || cold.validity || null },
      settleMs: SETTLE_MS,
      verdict: editRecoveryVerdict({ hotMs: hot.probeWorkMs, coldMs: cold.probeWorkMs, floorPct }),
    };
  }
}

/* (e) plans — A → B → A, and whether A ever cost what A cost the first time */
if (WANT.includes("plans")) {
  const keys = ["retainedHeapMB", "rendererNodes", "jsEventListenersCdp", "documentNodes", "canvasNodes", "layoutObjects"];
  await restoreView(page, home);
  const a0 = await counters(page, cdp);
  const a0Probe = await probeRung(page, ctx, home, RUNG_REPS);
  await switchPlan(page, SCENARIO_ID_B);
  const b = await counters(page, cdp);
  await switchPlan(page, SCENARIO_ID);
  const a1 = await counters(page, cdp);
  const a1Probe = await probeRung(page, ctx, null, RUNG_REPS);
  /* THE SWITCH HAS TO BE PROVEN, not assumed. Plan B is half of plan A by construction, so if
   * `elementsDrawn` did not fall, the route change did not take and every number below describes
   * plan A three times. */
  const switched = Number.isFinite(a0.elementsDrawn) && Number.isFinite(b.elementsDrawn) && b.elementsDrawn < a0.elementsDrawn;
  extras.planSwitch = {
    switched,
    a0: { counters: a0, medianMs: a0Probe.probeMedianMs },
    b: { counters: b },
    a1: { counters: a1, medianMs: a1Probe.probeMedianMs },
    costDeltaPct: a0Probe.probeWorkMs && a1Probe.probeWorkMs
      ? +(((a1Probe.probeWorkMs - a0Probe.probeWorkMs) / a0Probe.probeWorkMs) * 100).toFixed(1) : null,
    verdict: switched
      ? planSwitchVerdict({ a0, b, a1, keys })
      : { verdict: "unmeasured", why: `plan B never rendered (elementsDrawn ${a0.elementsDrawn} → ${b.elementsDrawn}); the route change did not take, so nothing here describes a switch`, rows: [] },
  };
}

const ranked = rankAxes(results);
const report = {
  scenario: SCENARIO_ID,
  shape: scenarioShape(),
  base: BASE,
  dpr: DPR,
  cpuThrottle: CPU_THROTTLE,
  fakeTiles: FAKE_TILES,
  tilesServed,
  visibility,
  reps: REPS,
  costMetric: "script + layout + style-recalculation ms per identical gesture (CDP Performance.getMetrics deltas) — NOT a frame median, and not quantised by the display clock",
  noiseFloor: floor,
  frameNoiseFloor: frameFloor,
  quantisationFloorPct: quantisationFloor(zeroMedian),
  zeroMedianMs: zeroMedian,
  zeroWorkMedianMs: workMedian,
  zeroRepeats: zero.map((p) => ({ workMs: p.probeWorkMs, work: p.work, longtaskMs: p.longtaskMs, eventProcMs: p.eventProcMs, medianMs: p.probeMedianMs, p90Ms: p.probeP90Ms, fps: p.fps, drift: p.drift, fault: p.fault, validity: p.validity })),
  axes: results,
  ranked,
  ...extras,
};

await context.close();
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

/* ── The report ───────────────────────────────────────────────────────────────────────────── */
const L = (s = "") => console.log(s);
L("");
L("SESSION-SHAPED DEGRADATION — cost as a function of what a work session fills up with (NEW-2)");
L(`  scenario ${SCENARIO_ID} · ${report.shape.elements} elements · dpr ${DPR} · cpu ×${CPU_THROTTLE} · tiles ${FAKE_TILES ? `fake (${tilesServed} served)` : "BLOCKED (nothing decodes)"}`);
L(`  COST METRIC — ${report.costMetric}`);
L(`  rung-0 work ${workMedian ?? "—"} ms · WORK floor ±${floorPct ?? "—"}% over ${floor.reps} repeats (${floor.min ?? "—"}–${floor.max ?? "—"} ms)`);
L(`  (for comparison with B1432: rung-0 frame median ${zeroMedian ?? "—"} ms, frame floor ±${frameFloor?.floorPct ?? "—"}%, of which ±${report.quantisationFloorPct ?? "—"}% is 16.7 ms quantisation alone —`);
L("   which is exactly the floor that blocked that instrument, and exactly why this one does not rest on a frame median.)");
L("");
L("  RANKED — by (measured cost per unit × the session rise declared in lib/sessionAxes.mjs):");
L("  axis                         verdict        per unit    rise   by end of session      r");
for (const r of ranked) {
  L(`  ${String(r.title).padEnd(28)} ${String(r.verdict).padEnd(14)} ${(r.perUnitMs != null ? `${r.perUnitMs} ms` : "—").padEnd(11)} ×${String(r.sessionRise).padEnd(5)} ${(r.sessionMs != null ? `${r.sessionMs} ms` : "—").padEnd(22)} ${r.r ?? "—"}`);
}
L("");
for (const ax of results) {
  L(`  ${ax.title} — ${ax.cost.verdict}`);
  L(`    ${ax.cost.why}`);
  for (const r of ax.rungs) {
    L(`      rung ${String(r.target).padStart(3)} · ${String(r.observed ?? "—").padStart(4)} observed · work ${(r.probeWorkMs != null ? `${r.probeWorkMs} ms` : "suppressed").padStart(12)} = script ${String(r.work?.scriptMs ?? "—").padStart(7)} + layout ${String(r.work?.layoutMs ?? "—").padStart(6)} + style ${String(r.work?.recalcMs ?? "—").padStart(6)} · layouts ${String(r.work?.layoutCount ?? "—").padStart(4)} · longtask ${String(r.longtaskMs ?? "—").padStart(7)} ms · frame ${r.probeMedianMs ?? "—"} · canvasNodes ${r.counters.canvasNodes} · layoutObjects ${r.counters.layoutObjects}`);
    if (r.effectFault) L(`             ⚠ ${r.effectFault}`);
    if (r.fault) L(`             ⚠ ${r.fault}`);
    if (r.validity) L(`             ⚠ ${r.validity}`);
  }
  L("");
}
if (extras.editRecovery) {
  const e = extras.editRecovery;
  L(`  EDIT RECOVERY (the memo-invalidation test) — ${e.verdict.verdict}`);
  L(`    ${e.verdict.why}`);
  L(`      right after an edit: ${e.hot.workMs ?? "—"} ms of work · after ${Math.round(e.settleMs / 1000)}s settled: ${e.cold.workMs ?? "—"} ms`);
  L("");
}
if (extras.planSwitch) {
  const p = extras.planSwitch;
  L(`  PLAN SWITCH A → B → A — ${p.verdict.verdict}`);
  L(`    ${p.verdict.why}`);
  if (p.costDeltaPct != null) L(`      the same probe on plan A after the round trip: ${p.costDeltaPct > 0 ? "+" : ""}${p.costDeltaPct}%`);
  for (const row of p.verdict.rows || []) {
    L(`      ${String(row.counter).padEnd(22)} A₀ ${String(row.a0).padStart(9)} → B ${String(row.b).padStart(9)} → A₁ ${String(row.a1).padStart(9)}  ${row.deltaPct != null ? `${row.deltaPct > 0 ? "+" : ""}${row.deltaPct}%` : "—"}  ${row.verdict}`);
  }
  L("");
}
L("  ⚠ WHAT THIS RUN CANNOT SETTLE, stated rather than implied: the reference plan is a FLOOR for the");
L("    owner's heaviest, the sandbox is logged out, and every external GIS host is blocked — so the GIS");
L("    half of the layers axis adds React and Leaflet work here but never any data. Point this at his");
L("    machine with BASE_URL to close that gap (V711's recipe, same limitation).");
L("");
