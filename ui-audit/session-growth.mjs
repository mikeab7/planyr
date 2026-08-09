#!/usr/bin/env node
/* session-growth — WHAT GROWS ACROSS A LONG MIXED SESSION, AND IS ZEROED BY A RELOAD? (NEW-2, B1121)
 *
 * ⛔ THE QUESTION, AND WHY EVERY PRIOR INSTRUMENT ASKED A NARROWER ONE.
 *
 * The owner's symptom, verbatim and unchanged for weeks: *"if I reload, it's immediately pretty
 * quick and then, like, give it some panning or zooming or I don't even know, and then, you know, a
 * minute later or two, it's, like, lagging just to go side to side."*
 *
 * Three instruments have been aimed at that sentence and each held something fixed that the
 * sentence does not hold fixed:
 *   • B1432 (interaction-degradation.mjs) froze the CONTENT and varied gesture COUNT — 3,000
 *     gestures, three regimes, flat every time. That null stands and is not re-derived here.
 *   • B1357/NEW-2 (session-axes.mjs) varied ONE axis at a time with everything else held. Correct,
 *     and by construction it cannot see an interaction BETWEEN axes.
 *   • Neither ever reloaded the page. Not once. The second half of the owner's sentence — the half
 *     that ELIMINATES candidates rather than merely detecting them — has never been measured.
 *
 * This harness drives a long MIXED session the way he actually works (pan, zoom, open a panel,
 * toggle a layer, nudge something, switch plans, repeat), samples a PRE-REGISTERED candidate list
 * at every checkpoint, and then RELOADS and samples again. See lib/sessionGrowth.mjs for the
 * enumeration and for the two-axis rule; the short version is:
 *
 *      grows over the session  ×  zeroed by the reload   ⇒  can it explain the symptom?
 *      grows  ×  resets    →  ADMISSIBLE (a suspect, never a conviction)
 *      grows  ×  persists  →  EXCLUDED — a reload does not empty IndexedDB, and his reload works
 *      flat   ×  either    →  EXONERATED
 *
 * ⛔ AND THE MEASUREMENT RULE THE DISPATCH WAS EXPLICIT ABOUT: A CURVE, NOT A PAIR. *"A before/after
 * pair cannot distinguish a step from a slope, and the owner's report is explicitly a slope."* Every
 * number here is sampled at every checkpoint and fitted; `classifyCurve` reports FLAT / STEP / SLOPE
 * / SAWTOOTH with the residual of each model, and refuses to name a shape inside the noise floor.
 *
 * ── THE REGIME, and it is not the default for a reason ──────────────────────────────────────────
 * 1× CPU (his machine is not throttled), dpr 2.15 (his panel), and a REAL PLAN of his rather than
 * the synthetic Goose Creek scene every prior perf number in this repo came from. The session is
 * minutes of mixed work, not a synthetic burst — B1432 already showed gesture COUNT alone is flat
 * across 3,000 gestures, so re-running that is not the gap.
 *
 * ⚠ HEADED, ON A REAL X SERVER (B1086: a hidden tab starves rAF).
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/session-growth.mjs
 *   ... --fixture bain --fixture-b sylvestri   # which real plans (see lib/fixtureSeeding.mjs)
 *   ... --rounds 8                             # longer session
 *   ... --fake-tiles                           # tiles that actually decode
 *   ... --json
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perfScenarioSeedMulti, SCENARIO_ID, SCENARIO_ID_B, scenarioShape } from "./lib/perf-scenario.mjs";
import { readFixture, buildMultiFixtureState } from "./lib/fixtureSeeding.mjs";
import { fixtureCensus } from "./lib/planFixture.mjs";
import { frameSamplingFault, plausibilityFloor } from "./lib/frameSampling.mjs";
import { noiseFloor } from "./lib/longSession.mjs";
import { rungViewFault } from "./lib/sessionAxes.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { assertForeground } from "./lib/tabTiming.mjs";
import {
  GROWTH_CANDIDATES, observableCandidates, unobservableCandidates,
  classifyCurve, reloadReset, admissibility, attribute, growthHeadline,
} from "./lib/sessionGrowth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const numArg = (f, d) => { const v = Number(argOf(f, NaN)); return Number.isFinite(v) && v > 0 ? v : d; };

/* ⛔ THE DEFAULTS ARE HIS MACHINE, NOT THIS CONTAINER'S CONVENIENCE. dpr 2.15 is measured from his
 * own browser; 1× CPU because he is not on a throttled machine and a 4× arm answers a different
 * question. Every prior growth run in this program defaulted to dpr 1, which is a regime his
 * display never enters — `detectRetina` makes Leaflet fetch a zoom level deeper on HiDPI, four
 * times the tiles for the same ground. */
const DPR = Number(argOf("--dpr", "2.15")) || 2.15;
const CPU_THROTTLE = numArg("--cpu-throttle", 1);
const ROUNDS = numArg("--rounds", 6);
const REPS = numArg("--reps", 4);            // repeats at checkpoint 0 → the noise floor
const CHECK_REPS = numArg("--check-reps", 3); // probes per checkpoint, reported as their median
const FIXTURE = String(argOf("--fixture", "bain")).toLowerCase();
const FIXTURE_B = String(argOf("--fixture-b", "sylvestri")).toLowerCase();
const FAKE_TILES = process.argv.includes("--fake-tiles");
const NO_RELOAD = process.argv.includes("--no-reload");
const CACHE = join(HERE, ".raster-cache");
const MIN_FPS = plausibilityFloor(CPU_THROTTLE);
const SITE_A = "growth-plan-a", SITE_B = "growth-plan-b";

/* ── In-page instrumentation, installed BEFORE any app code runs ─────────────────────────────────
 * A listener registered during module evaluation is invisible to a wrapper installed afterwards,
 * and "listeners accumulate" is one of the pre-registered candidates — so this cannot be a
 * post-load injection. Every wrapper is a COUNTER: nothing is buffered, nothing is delayed, every
 * original is called through unconditionally.
 *
 * ⛔ AND IT IS DELIBERATELY THE *LITE* SHAPE — bounded Sets of ids, never a per-listener identity
 * MAP. B1432 learned this the hard way twice over: its own identity map was the one structure in
 * the run that grew without bound, so it could masquerade as the app retaining memory, and its
 * per-burst MessageChannel put 128 MessagePorts into its own heap diff. An instrument that shows
 * up in its own results is not measuring the program. The authoritative listener count here comes
 * from the RENDERER (CDP JSEventListeners), which owes nothing to any wrapper.
 */
const INSTRUMENT = `(() => {
  const S = { rafReq: 0, toSet: 0, ivSet: 0, obsNew: 0, rafLive: new Set(), timerLive: new Set(), obsLive: new Set() };
  window.__pg = S;

  const RAF = window.requestAnimationFrame.bind(window), CAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => { S.rafReq++; const id = RAF((t) => { S.rafLive.delete(id); return fn(t); }); S.rafLive.add(id); return id; };
  window.cancelAnimationFrame = (id) => { S.rafLive.delete(id); return CAF(id); };
  const ST = window.setTimeout.bind(window), CT = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...r) => { S.toSet++; const id = ST(typeof fn === "function" ? (...x) => { S.timerLive.delete(id); return fn(...x); } : fn, ms, ...r); S.timerLive.add(id); return id; };
  window.clearTimeout = (id) => { S.timerLive.delete(id); return CT(id); };
  const SI = window.setInterval.bind(window), CI = window.clearInterval.bind(window);
  window.setInterval = (...a) => { S.ivSet++; const id = SI(...a); S.timerLive.add("i" + id); return id; };
  window.clearInterval = (id) => { S.timerLive.delete("i" + id); return CI(id); };
  for (const name of ["MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver"]) {
    const Orig = window[name];
    if (!Orig) continue;
    class Wrapped extends Orig {
      constructor(...a) { super(...a); S.obsNew++; S.obsLive.add(this); }
      disconnect(...a) { S.obsLive.delete(this); return super.disconnect(...a); }
    }
    Object.defineProperty(Wrapped, "name", { value: name });
    window[name] = Wrapped;
  }

  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; RAF(tick); };
  RAF(tick);

  window.__lt = { total: 0, count: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.total += e.duration; window.__lt.count++; } }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  window.__pgReset = () => { window.__frames.length = 0; window.__lt = { total: 0, count: 0 }; };
  window.__pgRead = () => ({ frames: window.__frames.slice(), longtaskMs: +window.__lt.total.toFixed(2), longtasks: window.__lt.count });
})();`;

/* One sample of every candidate the page itself can answer for. Keys are candidate ids, so a
 * counter cannot drift away from the candidate it is supposed to be evidence for. */
const COUNTERS = `(async () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const S = window.__pg || {};
  const w = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let liveNodesAll = 1; while (w.nextNode()) liveNodesAll++;
  let lsBytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsBytes += k.length + (localStorage.getItem(k) || "").length; } } catch (_) { lsBytes = null; }
  let idbUsageMB = null;
  try { const e = await navigator.storage.estimate(); idbUsageMB = e && Number.isFinite(e.usage) ? +(e.usage / 1048576).toFixed(2) : null; } catch (_) {}
  return {
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
    liveNodesAll,
    documentNodes: document.getElementsByTagName("*").length,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : 0,
    tiles: document.querySelectorAll("img.leaflet-tile").length,
    tilesLoaded: document.querySelectorAll(".leaflet-tile-loaded").length,
    tileLayers: document.querySelectorAll(".leaflet-layer").length,
    rafLive: S.rafLive ? S.rafLive.size : null,
    timersLive: S.timerLive ? S.timerLive.size : null,
    observersLive: S.obsLive ? S.obsLive.size : null,
    localStorageBytes: lsBytes == null ? null : +(lsBytes / 1024).toFixed(1),
    idbUsageMB,
    ppf: svg ? +Number(svg.getAttribute("data-view-ppf")).toFixed(5) : null,
  };
})()`;

const readView = `(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null;
})()`;

/* A press point that is UNAMBIGUOUSLY bare canvas — the top hit must BE the <svg>. A press that
 * lands on an element DRAGS it, which silently turns a pan probe into an edit and samples a
 * different code path from the one the owner is complaining about. Re-resolved every checkpoint,
 * because this session MOVES things. */
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

const PAN_PX = 260, PAN_STEPS = 20, WHEEL_BURSTS = 6, WHEEL_BURST = 5, WHEEL_DELTA = 120;

/* One MessageChannel for the whole session, not one per burst — see the instrument note above. */
const wheelBurst = ([n, dy, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  if (!el) return done();
  const ch = (window.__pgWheelCh = window.__pgWheelCh || new MessageChannel());
  let i = 0;
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < n) ch.port2.postMessage(0); else done();
  };
  ch.port1.start();
  ch.port2.postMessage(0);
});

/* ── The cost metric ─────────────────────────────────────────────────────────────────────────────
 * MAIN-THREAD WORK PER GESTURE, differenced from the renderer's own cumulative counters at
 * microsecond resolution. NOT a frame median: a frame median is a percentile of inter-frame deltas
 * and the display clock quantises those to ~16.7 ms, so on a 16.7 ms median the smallest difference
 * the metric can EXPRESS is ±100% — which is the floor that blocked B1432 in all three of its
 * regimes, and which more repeats can never fix because the quantisation is in the metric. The
 * frame median is still recorded and printed beside it so numbers stay comparable to that run's.
 */
async function workMetrics(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {};
    for (const { name, value } of m.metrics || []) g[name] = value;
    return {
      scriptMs: (g.ScriptDuration || 0) * 1000,
      layoutMs: (g.LayoutDuration || 0) * 1000,
      recalcMs: (g.RecalcStyleDuration || 0) * 1000,
      layoutCount: g.LayoutCount || 0,
      nodes: g.Nodes ?? null,
      listeners: g.JSEventListeners ?? null,
      layoutObjects: g.LayoutObjects ?? null,
      heapUsed: g.JSHeapUsedSize ?? null,
    };
  } catch (_) { return null; }
}

async function probe(page, press, ctx) {
  const view = () => page.evaluate(readView);
  await page.mouse.move(press.x, press.y);
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__pgReset());
  const w0 = await workMetrics(ctx.cdp);
  const before = await view();
  const t0 = Date.now();

  /* Real Playwright pointer input for the PAN half — the planner calls setPointerCapture on
   * pointerdown, which THROWS for a synthetic pointerId, so a synthesised drag measures a
   * different code path from the one he drives. `steps` sends the whole leg in one CDP call so the
   * moves arrive back-to-back the way a real drag does. */
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
  const read = await page.evaluate(() => window.__pgRead());
  const frames = read.frames.slice(1);

  const work = w0 && w1 ? {
    scriptMs: +(w1.scriptMs - w0.scriptMs).toFixed(2),
    layoutMs: +(w1.layoutMs - w0.layoutMs).toFixed(2),
    recalcMs: +(w1.recalcMs - w0.recalcMs).toFixed(2),
    layoutCount: w1.layoutCount - w0.layoutCount,
  } : null;

  /* The VIEW guard suppresses everything: a probe that looked at a different scene measured the
   * wrong thing in every metric at once. The FRAME-SAMPLING guard nulls only the frame median —
   * a starved rAF does not stop the renderer doing script, layout and style work, so suppressing
   * the work number for it would throw away the metric that answers the question. */
  const validity = rungViewFault({ before, mid, after }, 1);
  const fault = frameSamplingFault({ visibility: ctx.visibility, samples: frames.length, gestureMs, minFps: MIN_FPS });
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    workMs: validity || !work ? null : +(work.scriptMs + work.layoutMs + work.recalcMs).toFixed(2),
    work: validity ? null : work,
    longtaskMs: validity ? null : read.longtaskMs,
    frameMedianMs: validity || fault || !sorted.length ? null : +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    frames: frames.length,
    gestureMs,
    fault: fault || null,
    validity: validity || null,
  };
}

/** Restore the view EXACTLY through the planner's own E2E hook. Floating-point zoom at an anchor is
 *  very nearly reversible and not exactly reversible, and "very nearly" compounds over a long
 *  session into a drift that would have checkpoint 6 looking at a different amount of scene from
 *  checkpoint 0 — which is the whole premise of an identical-gesture probe. */
async function restoreView(page, home) {
  if (!home) return;
  await page.evaluate((h) => {
    const v = window.__plannerView;
    if (!v || typeof v.centerOn !== "function") return;
    const { w, h: hh } = v.get();
    const ppf = Number(h.ppf);
    v.centerOn((w / 2 - Number(h.offX)) / ppf, (hh / 2 - Number(h.offY)) / ppf, ppf);
  }, home);
  await page.waitForTimeout(200);
}

async function counters(page, cdp, extra = {}) {
  /* ⛔ COLLECT FIRST, THEN READ EVERYTHING — and this ordering is the whole difference between
   * measuring what is RETAINED and measuring what has merely not been collected yet.
   *
   * `Nodes`, `JSEventListeners` and `usedJSHeapSize` all count objects that are already garbage but
   * whose collection has not run. A detached tree is the canonical case: it is unreachable the
   * instant it is removed, and it stays in the renderer's node total until a GC gets to it. So a
   * counter read WITHOUT a preceding collection reports GC scheduling, not retention — and this
   * program has already published one number that turned out to be an artefact of the instrument
   * (B1439). The first version of this function collected only for the heap figure and read the
   * node and listener counts before it; on the smoke run that made checkpoint 0 the HIGHEST reading
   * in the whole session (7,392 nodes falling to 5,497 by checkpoint 1) purely because the boot's
   * garbage had not been swept. Collecting first costs ~100 ms per checkpoint and is worth every
   * one of them. */
  try { await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {}
  await page.waitForTimeout(120);
  const page_ = await page.evaluate(COUNTERS);
  const m = await workMetrics(cdp);
  /* LayerTree has to be enabled and then read from an event; a one-shot request is not part of the
   * protocol. The subscription is installed once in main and the latest count is cached. */
  const compositorLayers = cdp.__layerCount ?? null;
  const rendererNodes = m?.nodes ?? null;
  return {
    ...page_,
    ...extra,
    rendererNodes,
    /* ⚠ AN APPROXIMATION WITH A LARGE SYSTEMATIC OFFSET — read its SLOPE, never its level. The
     * renderer's `Nodes` counts everything in the renderer (shadow trees, the browser's own UA
     * shadow content inside form controls, nodes in other documents); a TreeWalker from `document`
     * reaches only the composed light tree. So the difference is ~3,000 on a freshly reloaded page
     * with nothing detached at all. What means something is whether the difference GROWS across the
     * session — the offset is constant, so it cancels in the trend and not in the value. */
    detachedApprox: rendererNodes != null && Number.isFinite(page_.liveNodesAll) ? rendererNodes - page_.liveNodesAll : null,
    jsEventListenersCdp: m?.listeners ?? null,
    layoutObjects: m?.layoutObjects ?? null,
    retainedHeapMB: m?.heapUsed != null ? +(m.heapUsed / 1048576).toFixed(2) : null,
    compositorLayers,
  };
}

/* ── The mixed session ───────────────────────────────────────────────────────────────────────────
 *
 * ⛔ MIXED IS THE POINT AND IT IS THE ONE THING NOTHING HERE HAS EVER RUN. B1432 varied gesture
 * count with content frozen; session-axes varied one axis with everything else frozen. A real
 * session does all of it at once, and an interaction between two axes is invisible to both of those
 * designs by construction.
 *
 * One round ≈ what he does in a minute or two: move around the map (to FRESH area, so the tile
 * caches are actually exercised rather than re-serving the same tiles), zoom in and out, open and
 * close a panel, toggle a drawn layer, nudge an element, and — on alternate rounds — switch to the
 * other plan and back.
 *
 * Every round ends where it began in VIEW terms; the checkpoint probe restores the home view first
 * regardless, because "it ended where it began" is a hope and `restoreView` is a fact.
 */
const PANEL_TABS = ["yield", "parcel", "analysis", "references", "standards"];
const VIEW_LAYERS = ["Show dock doors", "Show column grid", "Show dimensions", "Show areas"];

async function wander(page, round) {
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  if (!box) return 0;
  let moves = 0;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (let i = 0; i < 8; i++) {
    const press = (await page.evaluate(PRESS_POINT)) || { x: Math.round(cx), y: Math.round(cy) };
    /* A deterministic walk that genuinely visits new ground rather than oscillating over the same
     * tiles — an oscillating pan re-serves the tiles already held and would report a tile cache as
     * bounded when nothing had ever asked it to grow. */
    const ang = ((round * 8 + i) * 137.5 * Math.PI) / 180;
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x + Math.round(Math.cos(ang) * 300), press.y + Math.round(Math.sin(ang) * 220), { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(90);
    moves++;
  }
  for (let b = 0; b < 4; b++) {
    await page.evaluate(wheelBurst, [5, b % 2 ? WHEEL_DELTA : -WHEEL_DELTA, Math.round(cx), Math.round(cy)]);
    await page.waitForTimeout(120);
  }
  return moves;
}

async function togglePanel(page, round) {
  const tab = page.locator(`[data-rail-tab="${PANEL_TABS[round % PANEL_TABS.length]}"]`);
  if (!(await tab.count())) return false;
  await tab.first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await tab.first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

/**
 * Turn one more drawn layer ON, cumulatively.
 *
 * ⛔ ON, NEVER "TOGGLE" — and the first version of this function got it wrong in a way that would
 * have quietly cancelled the effect it was there to produce. A blind click FLIPS, and `showDims`
 * and `showAreas` default ON, so rounds 3 and 4 turned drawn content OFF: the canvas node count
 * fell from ~600 to ~360 mid-session and the "session fills up" axis was running BACKWARDS for half
 * the run, subtracting cost from the very curve it was supposed to add to. A session accumulates;
 * so does this driver. Already-on layers are left alone rather than re-clicked.
 */
async function enableLayer(page, round) {
  const btn = page.locator('[data-testid="view-menu-btn"]');
  if (!(await btn.count())) return false;
  if ((await btn.first().getAttribute("aria-expanded")) !== "true") { await btn.first().click().catch(() => {}); await page.waitForTimeout(200); }
  const box = page.locator(`label:has-text("${VIEW_LAYERS[(round - 1) % VIEW_LAYERS.length]}") input[type=checkbox]`).first();
  let ok = false;
  if (await box.count()) {
    const is = await box.isChecked().catch(() => null);
    if (is === false) { await box.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(250); }
    ok = (await box.isChecked().catch(() => null)) === true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  return ok;
}

/** An arrow-key nudge out and straight back: the cheapest REAL edit in the product (it pushes an
 *  undo generation and re-identifies the model array), and it leaves the geometry where it was, so
 *  the edit axis does not quietly move the element axis underneath it. */
async function nudge(page) {
  const el = page.locator("[data-el-id]").first();
  if (!(await el.count())) return 0;
  const b = await el.boundingBox();
  if (!b) return 0;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(200);
  for (let i = 0; i < 6; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(30); }
  for (let i = 0; i < 6; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(30); }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  return 12;
}

/** Switch by ROUTE — the app's own project switch, and the path a shared link takes.
 *  ⛔ `waitForSelectorReleased`, never a bare `waitForSelector`: the returned ElementHandle is a
 *  strong V8 global handle and a Blink Node holds its PARENT strongly, so one undisposed handle per
 *  switch retains the whole previous app shell. THAT was the entirety of B1439, and this harness
 *  measures exactly the quantity that defect fabricated. See lib/waitRelease.mjs. */
async function switchPlan(page, groupId) {
  await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, groupId);
  await page.waitForTimeout(2500);
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function checkpoint(page, ctx, home, reps) {
  const samples = [];
  for (let i = 0; i < reps; i++) {
    await restoreView(page, home);
    const press = (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 };
    samples.push(await probe(page, press, ctx));
  }
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const works = samples.map((s) => s.workMs).filter(Number.isFinite);
  return {
    workMs: med(works),
    frameMedianMs: med(samples.map((s) => s.frameMedianMs).filter(Number.isFinite)),
    longtaskMs: med(samples.map((s) => s.longtaskMs).filter(Number.isFinite)),
    samples: samples.map((s) => ({ workMs: s.workMs, work: s.work, frameMedianMs: s.frameMedianMs, fault: s.fault, validity: s.validity })),
    suppressed: samples.filter((s) => s.validity).length,
  };
}

/* ── Main ───────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false, // ⚠ REQUIRED — a hidden tab starves rAF and every frame number is garbage (B1086)
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
});

const out = { base: BASE, dpr: DPR, cpuThrottle: CPU_THROTTLE, rounds: ROUNDS, fakeTiles: FAKE_TILES };
let context;
try {
  /* THE SCENE. Two REAL plans of his, both with their rasters, seeded through a storageState so the
   * measured context never visits the origin twice. `goose` falls back to the synthetic scenario
   * pair, kept only so a run can be compared against every historical number in this repo. */
  if (FIXTURE === "goose") {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
    await context.addInitScript(perfScenarioSeedMulti());
    out.scene = { fixture: "goose (synthetic)", planA: SCENARIO_ID, planB: SCENARIO_ID_B, shape: scenarioShape() };
    out.planA = SCENARIO_ID; out.planB = SCENARIO_ID_B;
  } else {
    const fa = readFixture(FIXTURE), fb = readFixture(FIXTURE_B);
    const built = await buildMultiFixtureState(browser, {
      base: BASE, cacheDir: CACHE,
      plans: [{ name: FIXTURE, fixture: fa, siteId: SITE_A }, { name: FIXTURE_B, fixture: fb, siteId: SITE_B }],
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true, storageState: built.state });
    out.scene = { fixture: FIXTURE, fixtureB: FIXTURE_B, census: built.census, rasters: built.facts.length, censusA: fixtureCensus(fa), censusB: fixtureCensus(fb) };
    out.planA = SITE_A; out.planB = SITE_B;
  }
  await context.addInitScript(INSTRUMENT);
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
  /* ⛔ A wall-clock reading from a BACKGROUND tab is void — a hidden tab clamps setTimeout, and a
     setTimeout-paced probe then times the clamp (measured: 3,156 ms for a 138-182 ms gesture).
     See ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting a throttled number. */
  await assertForeground(page, "session-growth");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  await cdp.send("HeapProfiler.enable").catch(() => {});
  await cdp.send("LayerTree.enable").catch(() => {});
  cdp.on("LayerTree.layerTreeDidChange", (e) => { cdp.__layerCount = (e.layers || []).length; });
  if (CPU_THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE }).catch(() => {});

  await page.goto(BASE, { waitUntil: "load" });
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(3000);

  const visibility = await page.evaluate(() => document.visibilityState);
  const ctx = { visibility, cdp };
  const home = await page.evaluate(readView);
  out.visibility = visibility;

  /* TWO DISCARDED WARM-UP PROBES. B1433 measured what grows in the heap over a long run and found
   * it was V8 COMPILING HOT FUNCTIONS — instruction streams, nothing of the app's. The first
   * gesture after a load therefore pays for JIT no later gesture pays again; that cost belongs to
   * BOOT (B1431's territory) and is pure contamination in a checkpoint-to-checkpoint comparison.
   * Two, not one, because the pan half and the wheel half warm separate paths. */
  for (let i = 0; i < 2; i++) {
    await restoreView(page, home);
    await probe(page, (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 }, ctx);
  }

  /* THE NOISE FLOOR, measured on the SAME ESTIMATOR every checkpoint uses — `REPS` independent
   * groups of `CHECK_REPS` probes, the spread of whose MEDIANS is the floor. Getting this wrong is
   * subtle and fatal: a floor measured on single probes but applied to a median-of-three is too
   * wide by roughly the square root of the group size, and it will call a real effect
   * inconclusive. */
  process.stderr.write(`· floor: ${REPS} groups of ${CHECK_REPS} probes at checkpoint 0…\n`);
  const zero = [];
  for (let i = 0; i < REPS; i++) zero.push(await checkpoint(page, ctx, home, CHECK_REPS));
  const floor = noiseFloor(zero.map((z) => z.workMs));
  const floorPct = floor.floorPct;
  out.noiseFloor = floor;

  const series = [];
  const first = { round: 0, elapsedS: 0, ...(await checkpoint(page, ctx, home, CHECK_REPS)), counters: await counters(page, cdp, { planSwitches: 0 }), work: null };
  series.push(first);
  process.stderr.write(`  · checkpoint 0 → work ${first.workMs ?? "—"} ms · heap ${first.counters.heapMB} MB · retained ${first.counters.retainedHeapMB} MB · nodes ${first.counters.rendererNodes} · canvas ${first.counters.canvasNodes}\n`);

  const t0 = Date.now();
  let planSwitches = 0;
  const drove = [];
  for (let r = 1; r <= ROUNDS; r++) {
    const did = { round: r, pans: await wander(page, r) };
    did.panel = await togglePanel(page, r);
    did.layer = await enableLayer(page, r);
    did.nudges = await nudge(page);
    /* ⛔ ALTERNATE ROUNDS ONLY, and A→B→A rather than A→B. A one-way switch leaves the run
     * measuring plan B for the rest of the session, and the checkpoint probe would then be
     * comparing two different plans' gestures and calling the difference growth. */
    if (r % 2 === 0) { await switchPlan(page, out.planB); await switchPlan(page, out.planA); planSwitches += 2; }
    did.planSwitches = planSwitches;
    drove.push(did);
    const cp = { round: r, elapsedS: +((Date.now() - t0) / 1000).toFixed(1), ...(await checkpoint(page, ctx, home, CHECK_REPS)), counters: await counters(page, cdp, { planSwitches }), planSwitches };
    series.push(cp);
    process.stderr.write(`  · checkpoint ${r} (${cp.elapsedS}s) → work ${cp.workMs ?? "—"} ms · heap ${cp.counters.heapMB} MB · retained ${cp.counters.retainedHeapMB} MB · nodes ${cp.counters.rendererNodes} · canvas ${cp.counters.canvasNodes} · detached≈ ${cp.counters.detachedApprox} · listeners ${cp.counters.jsEventListenersCdp}\n`);
  }
  out.drove = drove;
  out.sessionSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  out.tilesServed = tilesServed;

  /* ── THE RELOAD ARM — the half nothing in this program has ever measured ─────────────────────
   * This is not a tidy-up step. The owner's sentence contains an ELIMINATOR ("if I reload, it's
   * immediately pretty quick") and it is worth more than the detector half, because it takes whole
   * families of candidate off the table rather than adding one to it. */
  if (!NO_RELOAD) {
    process.stderr.write(`· reload arm…\n`);
    await page.reload({ waitUntil: "load" });
    await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
    await page.waitForTimeout(3000);
    const rHome = await page.evaluate(readView);
    for (let i = 0; i < 2; i++) { await restoreView(page, rHome); await probe(page, (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 }, ctx); }
    out.afterReload = { ...(await checkpoint(page, ctx, rHome, CHECK_REPS)), counters: await counters(page, cdp, { planSwitches: 0 }) };
    process.stderr.write(`  · after reload → work ${out.afterReload.workMs ?? "—"} ms · heap ${out.afterReload.counters.heapMB} MB · retained ${out.afterReload.counters.retainedHeapMB} MB · nodes ${out.afterReload.counters.rendererNodes}\n`);
  }

  /* ── The fits ───────────────────────────────────────────────────────────────────────────────── */
  const costPoints = series.map((s) => ({ x: s.round, y: s.workMs })).filter((p) => Number.isFinite(p.y));
  out.costCurve = { points: costPoints, shape: classifyCurve(costPoints, { floorPct }) };
  out.costSeries = series.map((s) => s.workMs);

  /* ⛔ THE OWNER'S OWN CLAIM, TESTED DIRECTLY. Everything else here is an attribution; this row is
   * the symptom itself. If cost rose over the session and the reload put it back, the symptom
   * reproduced. If cost never rose, it did not — and no amount of candidate analysis can rescue
   * a run whose primary effect was absent. */
  const c0 = series[0]?.workMs, cN = series[series.length - 1]?.workMs, cR = out.afterReload?.workMs;
  out.symptom = {
    startMs: c0 ?? null, endMs: cN ?? null, afterReloadMs: cR ?? null,
    risePct: Number.isFinite(c0) && Number.isFinite(cN) && c0 > 0 ? +(((cN - c0) / c0) * 100).toFixed(1) : null,
    reload: reloadReset({ start: c0, end: cN, afterReload: cR }),
    floorPct,
  };

  const rows = [];
  for (const cand of observableCandidates()) {
    const pts = series.map((s) => ({ x: s.round, y: s.counters?.[cand.id] })).filter((p) => Number.isFinite(p.y));
    const shape = classifyCurve(pts, { floorPct: cand.family === "memory" ? Math.max(floorPct ?? 0, 10) : floorPct ?? 5 });
    const reset = reloadReset({ start: pts[0]?.y, end: pts[pts.length - 1]?.y, afterReload: out.afterReload?.counters?.[cand.id] });
    rows.push({
      id: cand.id, title: cand.title, family: cand.family, unit: cand.unit,
      predictedReset: cand.resets,
      series: series.map((s) => s.counters?.[cand.id] ?? null),
      start: pts[0]?.y ?? null, end: pts[pts.length - 1]?.y ?? null, afterReload: out.afterReload?.counters?.[cand.id] ?? null,
      shape: shape.shape, shapeWhy: shape.why, fits: shape.fits ?? null,
      reset, admissibility: admissibility({ shape: shape.shape, reset }),
      /* ⛔ THE PREDICTION IS SCORED. A candidate whose measured reset behaviour contradicts what
       * the registry predicted in advance is the most interesting row in the table, and it would
       * be invisible if only the measurement were reported. */
      predictionHeld: cand.resets === "measure" ? null
        : (cand.resets === "yes") === (reset.verdict === "RESETS") || reset.verdict === "no-growth" || reset.verdict === "unmeasured",
    });
  }
  out.candidates = rows;
  out.attribution = attribute({
    costSeries: out.costSeries,
    candidates: rows.map((r) => ({ id: r.id, title: r.title, shape: r.shape, series: r.series, admissibility: r.admissibility })),
    costShape: out.costCurve.shape,
  });
  out.openQuestions = unobservableCandidates().map((c) => ({ id: c.id, title: c.title, why: c.why }));
  out.headline = growthHeadline({
    costShape: out.costCurve.shape, attribution: out.attribution, floorPct,
    unobservable: out.openQuestions.map((q) => q.id),
  });
  out.registry = GROWTH_CANDIDATES.map((c) => c.id);
  out.series = series;
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const f2 = (v, u = "") => (v == null ? "—" : `${v}${u}`);
console.log(`\nSESSION GROWTH — what accumulates across a session, and what a reload undoes`);
console.log(`  ${out.scene?.fixture ?? "?"} + ${out.scene?.fixtureB ?? "—"} · dpr ${out.dpr} · ${out.cpuThrottle}× CPU · ${out.rounds} rounds · ${f2(out.sessionSeconds, "s")} of driving · tiles ${out.fakeTiles ? out.tilesServed : "BLOCKED (no --fake-tiles)"}`);
if (out.scene?.censusA) console.log(`  plan A: ${out.scene.censusA.elements} elements · ${out.scene.censusA.parcels} parcels · ${out.scene.censusA.rasters?.length ?? 0} raster(s)   plan B: ${out.scene.censusB.elements} elements`);
console.log(`  noise floor ±${f2(out.noiseFloor?.floorPct, "%")} — ${out.noiseFloor?.why ?? ""}`);

console.log(`\n  THE SYMPTOM ITSELF (the identical gesture, every checkpoint)`);
console.log(`    round  work ms   heap MB  retained  rendererNodes  canvasNodes  detached≈  listeners  tiles`);
for (const s of out.series) {
  console.log(`    ${String(s.round).padStart(5)}  ${String(f2(s.workMs)).padStart(7)}  ${String(f2(s.counters.heapMB)).padStart(7)}  ${String(f2(s.counters.retainedHeapMB)).padStart(8)}  ${String(f2(s.counters.rendererNodes)).padStart(13)}  ${String(f2(s.counters.canvasNodes)).padStart(11)}  ${String(f2(s.counters.detachedApprox)).padStart(9)}  ${String(f2(s.counters.jsEventListenersCdp)).padStart(9)}  ${String(f2(s.counters.tiles)).padStart(5)}`);
}
if (out.afterReload) {
  const a = out.afterReload;
  console.log(`    RELOAD ${String(f2(a.workMs)).padStart(6)}  ${String(f2(a.counters.heapMB)).padStart(7)}  ${String(f2(a.counters.retainedHeapMB)).padStart(8)}  ${String(f2(a.counters.rendererNodes)).padStart(13)}  ${String(f2(a.counters.canvasNodes)).padStart(11)}  ${String(f2(a.counters.detachedApprox)).padStart(9)}  ${String(f2(a.counters.jsEventListenersCdp)).padStart(9)}  ${String(f2(a.counters.tiles)).padStart(5)}`);
}
/* ⚠ WHICH CHECKPOINT THE SESSION HAPPENED TO END ON IS PART OF THE READING, and saying so beats
 * quietly smoothing it away. `reloadReset` compares the LAST checkpoint against the reload, and the
 * last round of an even-numbered session is a plan-switch round — which is exactly where the
 * transient spike lives (§6b). A counter sampled at a peak overstates how much the reload gave
 * back. The SHAPE column already distinguishes that case (`SAWTOOTH`), so the honest fix is to name
 * the end state rather than to substitute a smoothed value for a measured one. */
const endedOnSwitch = out.rounds % 2 === 0;
console.log(`\n  ⚠ the session ended on a ${endedOnSwitch ? "PLAN-SWITCH round — a counter whose shape is SAWTOOTH was sampled near its PEAK, so its reload recovery reads high" : "non-switch round, so the end sample is a resting value"}.`);
console.log(`\n  COST CURVE: ${out.costCurve.shape.shape} — ${out.costCurve.shape.why}`);
console.log(`  reload: ${out.symptom.reload.verdict} — ${out.symptom.reload.why}`);

console.log(`\n  CANDIDATES (pre-registered in lib/sessionGrowth.mjs before this ran)`);
console.log(`    candidate                 start →      end → reload    shape      reset      verdict`);
for (const r of out.candidates) {
  const flag = r.predictionHeld === false ? "  ⚠ prediction missed" : "";
  console.log(`    ${r.id.padEnd(22)} ${String(f2(r.start)).padStart(8)} → ${String(f2(r.end)).padStart(8)} → ${String(f2(r.afterReload)).padStart(7)}  ${r.shape.padEnd(10)} ${r.reset.verdict.padEnd(10)} ${r.admissibility.verdict}${flag}`);
}
console.log(`\n  STANDING`);
for (const row of out.attribution.rows) console.log(`    ${String(row.standing).padEnd(24)} ${row.id.padEnd(22)} r=${f2(row.r)}`);
console.log(`\n  OPEN — pre-registered and NOT sampleable from outside the app:`);
for (const q of out.openQuestions) console.log(`    · ${q.id} — ${q.title}`);
console.log(`\n  ${out.headline.verdict}: ${out.headline.headline}\n`);
