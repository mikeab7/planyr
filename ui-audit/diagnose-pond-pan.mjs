#!/usr/bin/env node
/* diagnose-pond-pan — "I just added a detention pond, and now it's running super slow again" (NEW-1)
 *
 * ⛔ THE ONE THING THAT MAKES THIS REPORT WORTH READING: THE TRIGGER IS NAMED, SO THE PROBE IS PAIRED.
 *
 * Every prior instrument in this speed program had to HUNT for the variable — vary the session
 * length, vary the panel count, vary the element count, and see which one moves. The owner has now
 * handed us a single reproducible action: *"I definitely noticed a massive improvement in speed on
 * the Bain site. I just added a detention pond, and now it's running super slow again."* So the
 * measurement is the same gesture with the pond ABSENT and with the pond PRESENT, alternating on one
 * page — and every drift this sandbox has (V8 tiering, tile decode settling, GC phase, thermals)
 * moves both members of a pair the same way and cancels out of their difference.
 *
 * REGIME — stated first because it bounds every number below:
 *   • 1× CPU, NOT throttled. His complaint is at 1× on a 28-core machine; every number in this
 *     program before B1448 was at 4×.
 *   • dpr 2 (retina), --fake-tiles (a real decodable PNG per tile, so decode and texture upload are
 *     real work rather than absent).
 *   • headed, on a real X server — a hidden tab starves rAF (the B1086 trap).
 *   • logged out, every external GIS host blocked. A FLOOR, never a match.
 *
 * COST METRIC — main-thread work per gesture: ScriptDuration + LayoutDuration + RecalcStyleDuration,
 * differenced from the renderer's own cumulative counters at microsecond resolution. NOT a frame
 * median: B1432's ±99.8% floor was 16.7 ms display-clock quantisation *in the metric*, which no
 * number of repeats could ever clear. Frame median is still read and still reported beside it.
 *
 * THE PROBE IS PAN ONLY, deliberately. B1440's pan anchor is the thing the owner FELT, and a wheel
 * burst re-bakes the anchor by construction (`panAnchor.ppf === view.ppf` fails), so folding zoom
 * into the probe would blend the fixed gesture with the one that defeats the fix being tested.
 *
 * ARMS (each `--pairs` times, interleaved, undone between pairs so the scene returns exactly):
 *   null        probe, do NOTHING, probe again        → the noise floor, on the same estimator
 *   pond        probe, draw ONE pond, probe, undo     → the owner's action
 *   pond×2/×3   the same with two and three ponds     → fixed-per-scene vs per-pond vs superlinear
 *   pond-big    one pond of ~4× the area              → does cost scale with AREA
 *   pond-fine   one pond with a finer contour interval→ does cost scale with CONTOUR DENSITY
 *   building    probe, draw ONE building, probe, undo → the CONTROL: is it a pond, or any element?
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/diagnose-pond-pan.mjs
 *   ... --ppf 0.35            # the zoom to probe at (the contour gate is zoom-dependent — see below)
 *   ... --pairs 5             # more pairs → a tighter floor
 *   ... --arms null,pond      # a subset while iterating
 *   ... --profile             # additionally CPU-profile one probe per arm and attribute it
 *   ... --json
 *
 * ⚠ ZOOM IS A REAL INDEPENDENT VARIABLE HERE AND THE HARNESS REFUSES TO HIDE IT. A pond's stage
 * contours are zoom-gated (`detailLabelVisible` → `dimCalloutVisible`, ppf ≥ 0.18) so at the plan's
 * own landing zoom a pond draws NO contour rings at all and the Clipper pass never runs. Probing
 * only there would "prove" a pond is free. Every run states the ppf it probed at and the contour
 * ring count it observed, and `--ppf-sweep` runs the pond arm at several zooms.
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate.
 */
import { chromium } from "playwright";
import { perfScenarioSeed, perfScenarioSite, scenarioArm, scenarioShape, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { frameSamplingFault, plausibilityFloor, observedFps } from "./lib/frameSampling.mjs";
import { rungViewFault, viewDrift, pct } from "./lib/sessionAxes.mjs";
import { pairedDelta, nullFloor, armVerdict, scalingShape, attributionQuality, phaseDelta, topFunctions, median } from "./lib/pondPan.mjs";
import { attributeProfile, loadSourceMaps, makeFrameResolver } from "./lib/bootTimeline.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { FEATURE_COUNT_FIELD } from "./lib/featureCensus.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const PROFILE = process.argv.includes("--profile");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const numArg = (f, d) => { const v = Number(argOf(f, NaN)); return Number.isFinite(v) && v > 0 ? v : d; };

const CPU = numArg("--cpu-throttle", 1);
const DPR = numArg("--dpr", 2);
const PPF = numArg("--ppf", 0.35);
const PAIRS = numArg("--pairs", 4);
const PROBE_REPS = numArg("--probe-reps", 3);
const FAKE_TILES = !process.argv.includes("--no-fake-tiles");
const PPF_SWEEP = String(argOf("--ppf-sweep", "")).split(",").map(Number).filter((n) => n > 0);
const PANEL = argOf("--panel", "");
/* ⛔ --no-ponds IS THE ARM THAT ANSWERS THE OWNER'S QUESTION, and the default is deliberately the
 * other one so the confound stays visible rather than buried. The reference plan already has TWO
 * ponds, so drawing one on it measures the THIRD — a marginal pond, on a plan whose stormwater
 * ledger, pond verdict rows and drainage facts pass are already running. His report is about his
 * FIRST. Both are worth measuring and they are DIFFERENT MEASUREMENTS; every run says which it is. */
const NO_PONDS = process.argv.includes("--no-ponds");
/* --seed-ponds N seeds the plan with N copies of the fixture's own real pond. It is the LEVERAGE
 * arm: a per-pond per-frame cost at ONE pond is a fraction of a per-cent and cannot clear any
 * honest floor, so "is there a per-pond cost at all" is only answerable by putting enough ponds on
 * the plan for the answer to be bigger than the measurement. Reported as a LADDER (0, 2, 4, 8), not
 * a pair, because a per-pond cost is a slope. */
const SEED_LADDER = String(argOf("--seed-ponds", "")).split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
const ARMS = String(argOf("--arms", "null,pond,pond2,pond3,pond-big,pond-fine,building")).split(",").map((s) => s.trim()).filter(Boolean);
const MIN_FPS = plausibilityFloor(CPU);

/* ── In-page instrumentation ─────────────────────────────────────────────────────────────────
 * The frame sampler is byte-for-byte session-axes.mjs's, so a number here is comparable to a
 * number there. The one addition is the REACT COMMIT COUNTER, installed before React loads via the
 * DevTools global hook — the item asks for commits per pointermove COUNTED, not estimated, and
 * React's own `onCommitFiberRoot` is the only honest source for that. */
const INSTRUMENT = `(() => {
  window.__frames = [];
  const RAF = window.requestAnimationFrame.bind(window);
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; RAF(tick); };
  RAF(tick);

  window.__lt = { total: 0, count: 0, max: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { window.__lt.total += e.duration; window.__lt.count++; if (e.duration > window.__lt.max) window.__lt.max = e.duration; }
    }).observe({ type: "longtask", buffered: true });
    window.__ltOk = true;
  } catch (_) { window.__ltOk = false; }

  /* React commits, from React's own hook. LOUD-FAILURE: if a real DevTools hook already exists we
   * do NOT clobber it, and we report that we could not install rather than reporting zero commits —
   * a broken counter reads exactly like a quiet app (the B1448 observer trap). */
  window.__commits = 0;
  window.__commitHookOk = false;
  try {
    if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(), supportsFiber: true,
        inject() { return 1; }, onCommitFiberRoot() { window.__commits++; },
        onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
      };
      window.__commitHookOk = true;
    }
  } catch (_) {}

  /* ⛔ THE AFTER-THE-ACTION WATCH, and it is a different question from the pan probe.
   *
   * The owner did not say "panning is slow". He said *"I just added a detention pond, and NOW it's
   * running super slow"* — a claim about what the app does in the seconds FOLLOWING the action. A
   * probe that pans for a second and a half, three times, starting several seconds later, averages
   * straight over exactly that window. So this watch runs the app's own activity counters
   * continuously with NO input at all: if adding a pond starts something that keeps working, an
   * idle app is where it shows, and a quiet one is a real result too.
   *
   * DOM mutations are counted from a MutationObserver that REPORTS WHETHER IT INSTALLED. B1448's
   * recorded instrument bug is exactly this: an observer on document.documentElement at
   * document-start attaches to null inside a silent catch, and a broken observer reads precisely
   * like a quiet app. */
  window.__watch = { mutations: 0, observerOk: false };
  const install = () => {
    try {
      const target = document.documentElement || document;
      if (!target) return false;
      new MutationObserver((recs) => { window.__watch.mutations += recs.length; })
        .observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
      window.__watch.observerOk = true;
      return true;
    } catch (_) { return false; }
  };
  if (!install()) document.addEventListener("DOMContentLoaded", install, { once: true });

  window.__watchStart = () => { window.__watch.mutations = 0; window.__lt = { total: 0, count: 0, max: 0 }; window.__commits = 0; window.__frames.length = 0; };
  window.__watchRead = () => ({
    mutations: window.__watch.mutations, observerOk: window.__watch.observerOk,
    longtaskMs: +window.__lt.total.toFixed(2), longtasks: window.__lt.count, longtaskMaxMs: +window.__lt.max.toFixed(2),
    commits: window.__commits, frames: window.__frames.length,
  });

  window.__pfReset = () => {
    window.__frames.length = 0;
    window.__lt = { total: 0, count: 0, max: 0 };
    window.__commits = 0;
  };
  window.__pfRead = () => ({
    frames: window.__frames.slice(),
    longtaskMs: +window.__lt.total.toFixed(2), longtasks: window.__lt.count, longtaskMaxMs: +window.__lt.max.toFixed(2),
    commits: window.__commits, commitHookOk: window.__commitHookOk, longtaskOk: window.__ltOk,
  });
})();`;

const readView = `(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null;
})()`;

/* What the SCENE holds. `contourRings` / `contourLabels` are the observables that prove whether the
 * pond's Clipper-derived stage contours are actually being drawn at this zoom — the difference
 * between "a pond is free" and "we probed below its gate". */
const COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  return {
    canvasNodes: svg.getElementsByTagName("*").length,
    ${FEATURE_COUNT_FIELD},
    /* el-tier: the rung assertion counts PONDS, which are elements — the element tier is the subject. */
    elementsDrawn: svg.querySelectorAll("[data-el-id]").length,
    canvasText: svg.getElementsByTagName("text").length,
    canvasPaths: svg.getElementsByTagName("path").length,
    contourRings: svg.querySelectorAll("[data-contour]").length,
    contourLabels: svg.querySelectorAll("[data-contour-label]").length,
    documentNodes: document.getElementsByTagName("*").length,
    ppf: +Number(svg.getAttribute("data-view-ppf")).toFixed(5),
  };
})()`;

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

const PAN_PX = 260, PAN_STEPS = 20;

async function workMetrics(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {};
    for (const { name, value } of m.metrics || []) g[name] = value;
    return {
      scriptMs: (g.ScriptDuration || 0) * 1000, layoutMs: (g.LayoutDuration || 0) * 1000,
      recalcMs: (g.RecalcStyleDuration || 0) * 1000, taskMs: (g.TaskDuration || 0) * 1000,
      layoutCount: g.LayoutCount || 0, recalcCount: g.RecalcStyleCount || 0,
    };
  } catch (_) { return null; }
}
const subWork = (a, b) => (a && b ? {
  scriptMs: +(b.scriptMs - a.scriptMs).toFixed(2), layoutMs: +(b.layoutMs - a.layoutMs).toFixed(2),
  recalcMs: +(b.recalcMs - a.recalcMs).toFixed(2), taskMs: +(b.taskMs - a.taskMs).toFixed(2),
  layoutCount: b.layoutCount - a.layoutCount, recalcCount: b.recalcCount - a.recalcCount,
} : null);

/* ONE pan gesture: out and back at a fixed distance from a re-resolved bare-canvas press point.
 * Out-and-back is what makes it viewport-neutral by construction; `rungViewFault` then asserts it. */
async function panProbe(page, press, ctx) {
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

  const gestureMs = Date.now() - t0;
  await page.waitForTimeout(150);
  const after = await view();
  const w1 = await workMetrics(ctx.cdp);
  const read = await page.evaluate(() => window.__pfRead());
  const frames = read.frames.slice(1);
  const work = subWork(w0, w1);
  const fault = frameSamplingFault({ visibility: ctx.visibility, samples: frames.length, gestureMs, minFps: MIN_FPS });
  const validity = rungViewFault({ before, mid, after }, 1);
  const frameOk = !fault && !validity;
  return {
    probeWorkMs: validity || !work ? null : +(work.scriptMs + work.layoutMs + work.recalcMs).toFixed(2),
    work: validity ? null : work,
    longtaskMs: validity ? null : read.longtaskMs,
    commits: validity ? null : read.commits,
    commitHookOk: read.commitHookOk,
    probeMedianMs: frameOk && frames.length ? +pct(frames, 50).toFixed(2) : null,
    frames: frames.length, fps: observedFps(frames.length, gestureMs), gestureMs,
    drift: viewDrift(before, after), fault: fault || null, validity: validity || null,
  };
}

/* One measured cost: PROBE_REPS identical pan probes, reported as the median. A single probe is not
 * a measurement — one probe catching a GC is worth more than the whole effect being hunted. */
async function cost(page, ctx, home) {
  const samples = [];
  for (let i = 0; i < PROBE_REPS; i++) {
    await restoreView(page, home);
    const press = (await page.evaluate(PRESS_POINT)) || { x: 600, y: 450 };
    samples.push(await panProbe(page, press, ctx));
  }
  const ok = samples.map((s) => s.probeWorkMs).filter(Number.isFinite);
  const m = median(ok);
  const best = samples.find((s) => s.probeWorkMs === m) || samples[samples.length - 1];
  return {
    workMs: m != null ? +m.toFixed(2) : null,
    samples: ok,
    commits: median(samples.map((s) => s.commits).filter(Number.isFinite)),
    longtaskMs: median(samples.map((s) => s.longtaskMs).filter(Number.isFinite)),
    frameMedianMs: median(samples.map((s) => s.probeMedianMs).filter(Number.isFinite)),
    work: best?.work ?? null,
    faults: samples.map((s) => s.fault || s.validity).filter(Boolean),
    commitHookOk: samples[0]?.commitHookOk ?? null,
  };
}

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

async function setZoom(page, ppf) {
  await page.evaluate((z) => {
    const v = window.__plannerView;
    if (!v) return;
    const s = v.get();
    // Hold the CENTRE of the current view and change only the scale, so a zoom change never also
    // pans onto a different part of the plan (which would confound zoom with what is on screen).
    const fx = (s.w / 2 - s.offX) / s.ppf, fy = (s.h / 2 - s.offY) / s.ppf;
    v.centerOn(fx, fy, z);
  }, ppf);
  await page.waitForTimeout(600);
}

const counters = (page) => page.evaluate(COUNTERS);
const elCount = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  /* el-tier: the pond ladder adds ELEMENTS and verifies each one landed. */
  return svg ? svg.querySelectorAll("[data-el-id]").length : 0;
});

/* ── The drivers ─────────────────────────────────────────────────────────────────────────────
 * Every draw is VERIFIED and a failed one is retried elsewhere: a drag that begins on an existing
 * element MOVES it instead of drawing, which silently turns "add a pond" into "make an edit". The
 * elements/undo bookkeeping is the whole basis of the pairing, so an unverified draw would corrupt
 * not one number but every pair after it. */
async function drawRect(page, toolName, frac) {
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  if (!box) return false;
  const X = (f) => Math.round(box.x + box.width * f), Y = (f) => Math.round(box.y + box.height * f);
  const btn = page.getByRole("button", { name: toolName, exact: true });
  if (!(await btn.count())) return false;
  const before = await elCount(page);
  await btn.first().click({ timeout: 5000 }).catch(() => {});
  await page.mouse.move(X(frac.x0), Y(frac.y0));
  await page.mouse.down();
  await page.mouse.move(X((frac.x0 + frac.x1) / 2), Y((frac.y0 + frac.y1) / 2), { steps: 5 });
  await page.mouse.move(X(frac.x1), Y(frac.y1), { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  const sel = page.locator("button.rbtn", { hasText: /^\s*Select\s*$/ });
  if (await sel.count()) await sel.first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(350);
  return (await elCount(page)) > before;
}

/* Pond footprints, walked across the canvas so N ponds never overlap (an overlapping drag would
 * start on the previous pond and move it). Fractions of the canvas box. */
const POND_SPOTS = [
  { x0: 0.40, y0: 0.24, x1: 0.55, y1: 0.44 },
  { x0: 0.60, y0: 0.24, x1: 0.75, y1: 0.44 },
  { x0: 0.40, y0: 0.56, x1: 0.55, y1: 0.76 },
];
const BIG_POND = { x0: 0.34, y0: 0.20, x1: 0.78, y1: 0.72 }; // ~4× the area of one standard spot
const BUILDING_SPOT = { x0: 0.40, y0: 0.24, x1: 0.55, y1: 0.44 }; // the SAME footprint as pond #1

async function undoTimes(page, n, want) {
  for (let i = 0; i < n + 3; i++) {
    if ((await elCount(page)) <= want) break;
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(250);
  return (await elCount(page)) === want;
}

/* The contour INTERVAL arm. The pond's stage contours are drawn per elevation interval, so halving
 * the interval doubles the ring count without changing the pond's geometry — which separates "a
 * pond costs" from "a pond's CONTOUR DENSITY costs". Driven through the app's own model rather than
 * a UI field on purpose: the interval lives on `el.det` and there is no canvas affordance for it, so
 * a UI driver would be inventing one. Applied to the pond that was just drawn (the last element). */
async function setLastPondInterval(page, ft) {
  return page.evaluate((v) => {
    // The planner persists to localStorage on a debounce; the live model is what we need to move,
    // and the only sanctioned handle on it is the plan store + a reload. So this arm RELOADS.
    try {
      const key = "planarfit:sites:v1";
      const all = JSON.parse(localStorage.getItem(key) || "{}");
      const id = localStorage.getItem("planarfit:currentSite:v1")?.replace(/^"|"$/g, "");
      const site = all[id];
      if (!site) return { ok: false, why: "no current site in the store" };
      const ponds = (site.els || []).filter((e) => e.type === "pond");
      if (!ponds.length) return { ok: false, why: "no pond in the stored plan" };
      const p = ponds[ponds.length - 1];
      p.det = { ...(p.det || {}), interval: v };
      localStorage.setItem(key, JSON.stringify(all));
      return { ok: true, pondId: p.id, ponds: ponds.length };
    } catch (e) { return { ok: false, why: String(e && e.message) }; }
  }, ft);
}

/* ── Profiling one probe ─────────────────────────────────────────────────────────────────────
 * The item asks for the delta attributed to NAMED PHASES with an explicit UNATTRIBUTED line, held
 * at B1448's 0.0%. Same machinery boot-tail.mjs uses, pointed at a pan gesture instead of a boot. */
async function profiledProbe(page, ctx, home) {
  await restoreView(page, home);
  const press = (await page.evaluate(PRESS_POINT)) || { x: 600, y: 450 };
  await page.mouse.move(press.x, press.y);
  await page.waitForTimeout(150);
  await ctx.cdp.send("Profiler.enable").catch(() => {});
  await ctx.cdp.send("Profiler.setSamplingInterval", { interval: 100 }).catch(() => {});
  await ctx.cdp.send("Profiler.start").catch(() => {});
  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();
  await page.waitForTimeout(150);
  let profile = null;
  try { ({ profile } = await ctx.cdp.send("Profiler.stop")); } catch (_) {}
  await ctx.cdp.send("Profiler.disable").catch(() => {});
  if (!profile) return null;
  return { ...attributeProfile(profile, ctx.resolve), top: topFunctions(profile, ctx.resolve, 18) };
}

/* The Yield panel is the owner's working surface and it is where the pond LEDGER is rendered, so a
 * pond measured with every panel closed is a pond measured somewhere he never works. `--panel` docks
 * one before any probe runs; the rung is PROVEN by the panel's own testid, never by the click. */
async function openPanel(page, id) {
  const tab = page.locator(`[data-rail-tab="${id}"]`);
  if (!(await tab.count())) return { ok: false, why: `no rail tab "${id}"` };
  if ((await tab.first().getAttribute("aria-pressed")) !== "true") {
    await tab.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  const open = await page.locator('[data-testid="left-menu-panel"]').count();
  return { ok: open > 0, why: open > 0 ? null : `the "${id}" tab was clicked but no docked panel appeared` };
}

/* ── Main ────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false, // ⚠ REQUIRED — a hidden tab starves rAF (B1086)
  args: ["--ignore-certificate-errors", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
await context.addInitScript(INSTRUMENT);
const SEED_OPTS = NO_PONDS ? scenarioArm("no-ponds") : {};
/* ⛔ THE SEED IS GUARDED, and the reason is a fault this harness's own counters caught.
 * `addInitScript` re-runs before EVERY navigation, so the ladder's per-rung seed — written into
 * localStorage and then reloaded — was overwritten by the context seed on the way back in. Every
 * rung reported the same 1,203 canvas nodes and the same 8 contour rings while claiming 0, 2, 4 and
 * 8 ponds, and its perfectly plausible work numbers would have joined a trend line describing one
 * scene four times. The guard makes the context seed a DEFAULT rather than an override; the rung
 * assertion below is the second, independent half. */
await context.addInitScript(`(() => { try { if (!localStorage.getItem('planarfit:sites:v1')) { ${perfScenarioSeed(SEED_OPTS)} } } catch (e) {} })();`);
await context.addInitScript(() => { window.__PLANYR_E2E = true; });

let tilesServed = 0;
await context.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
  if (FAKE_TILES) {
    const t = parseTileUrl(u);
    if (t) { tilesServed++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
  }
  return route.abort();
});

const page = await context.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-pond-pan");
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable").catch(() => {});
await cdp.send("HeapProfiler.enable").catch(() => {});
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }).catch(() => {});

const { lookups, count: mapCount, broken = [] } = PROFILE ? await loadSourceMaps(new URL("../dist", import.meta.url).pathname) : { lookups: new Map(), count: 0 };
const resolve = makeFrameResolver(lookups);

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(3000);

const visibility = await page.evaluate(() => document.visibilityState);
const ctx = { visibility, cdp, resolve };

let panelState = null;
if (PANEL) {
  panelState = await openPanel(page, PANEL);
  process.stderr.write(`  · panel "${PANEL}": ${panelState.ok ? "docked" : `⚠ NOT OPEN — ${panelState.why}`}\n`);
  await page.waitForTimeout(800);
}

await setZoom(page, PPF);
const home = await page.evaluate(readView);
const baseEls = await elCount(page);
const baseCounters = await counters(page);

/* Two discarded warm-up probes — the first gesture after a load pays for JIT that no later gesture
 * pays again (B1433: what grows in a long run is V8 compiling hot functions). That cost belongs to
 * boot and is pure contamination in a paired comparison. */
for (let i = 0; i < 3; i++) await cost(page, ctx, home);

/* ── THE POND-COUNT LADDER ───────────────────────────────────────────────────────────────────
 * Seeded rather than drawn, and RELOADED per rung, because the question is what a plan WITH N
 * ponds costs per gesture — not what drawing N ponds costs. Interleaved across `--pairs` sweeps so
 * drift lands on every rung equally (the same correction the paired arms needed), and the floor is
 * the spread of the rung-0 estimates by the same estimator.
 *
 * ⛔ A FRESH BROWSER CONTEXT PER RUNG, and this is not belt-and-braces. Writing the rung's plan
 * into localStorage and reloading DOES NOT WORK and fails SILENTLY: the write lands (verified — the
 * store held 8 ponds), and after the reload the plan is back to 2, because the planner flushes its
 * live in-memory model on unload and that flush wins the race. Clearing IndexedDB and localStorage
 * first does not help for the same reason. The rung assertion above is what turned that into a
 * visible fault instead of a plausible flat line, and a new context — no prior model to flush — is
 * the fix. */
async function openRungSession(n) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
  await c.addInitScript(INSTRUMENT);
  await c.addInitScript(perfScenarioSeed({ ponds: n }));
  await c.addInitScript(() => { window.__PLANYR_E2E = true; });
  await c.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    if (FAKE_TILES) {
      const t = parseTileUrl(u);
      if (t) { tilesServed++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
    }
    return route.abort();
  });
  const pg = await c.newPage();
  const cd = await c.newCDPSession(pg);
  await cd.send("Performance.enable").catch(() => {});
  if (CPU > 1) await cd.send("Emulation.setCPUThrottlingRate", { rate: CPU }).catch(() => {});
  await pg.goto(BASE, { waitUntil: "load" });
  await pg.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await pg.waitForTimeout(2800);
  if (PANEL) await openPanel(pg, PANEL);
  await setZoom(pg, PPF);
  await pg.waitForTimeout(400);
  const h = await pg.evaluate(readView);
  return { context: c, page: pg, ctx: { visibility: await pg.evaluate(() => document.visibilityState), cdp: cd, resolve }, home: h };
}
let ladder = null;
/* How many drawn elements the plan has WITHOUT any pond — the denominator the rung assertion needs
 * to turn "elements on the canvas" into "ponds on the canvas". Read from the fixture, not counted
 * on a page, so it cannot itself be wrong because a seed failed. */
const baseNonPondEls = perfScenarioSite(scenarioArm("no-ponds")).els.length;
if (SEED_LADDER.length) {
  const rows = new Map(SEED_LADDER.map((n) => [n, []]));
  for (let sweepI = 0; sweepI < PAIRS; sweepI++) {
    for (const n of SEED_LADDER) {
      const s = await openRungSession(n);
      await cost(s.page, s.ctx, s.home); // one discarded warm-up per boot — JIT belongs to boot, not the rung
      const k = await cost(s.page, s.ctx, s.home);
      const c = await counters(s.page);
      rows.get(n).push({ workMs: k.workMs, commits: k.commits, counters: c });
      process.stderr.write(`  · sweep ${sweepI + 1} · ${String(n).padStart(2)} ponds → ${k.workMs ?? "—"} ms · ${c.canvasNodes} nodes · ${c.contourRings} contour rings · ${c.elementsDrawn} els · ${k.commits} commits/gesture\n`);
      await s.context.close();
    }
  }
  /* ⛔ THE RUNG ASSERTION. A rung that claims N ponds must SHOW N ponds — `elementsDrawn` and the
   * contour-ring count are the page's own answer, and a rung whose scene did not change is not a
   * cheap rung, it is a MISSING one. Its cost is suppressed rather than placed on the trend, which
   * is `rungEffectFault`'s rule from session-axes.mjs applied to a seed instead of a click. */
  const rungs = SEED_LADDER.map((n) => {
    const s = rows.get(n).map((r) => r.workMs).filter(Number.isFinite);
    const c = rows.get(n)[0]?.counters ?? null;
    const seenPonds = c ? c.elementsDrawn - (baseNonPondEls ?? 0) : null;
    const fault = seenPonds != null && seenPonds !== n
      ? `rung ${n} rendered ${seenPonds} ponds — the seed did not take, so this cost describes a DIFFERENT scene and may not join the trend`
      : null;
    return {
      n, workMs: fault ? null : median(s), samples: s,
      spreadPct: s.length >= 2 && median(s) ? +(((Math.max(...s) - Math.min(...s)) / median(s)) * 100).toFixed(2) : null,
      counters: c, seenPonds, effectFault: fault,
      commits: median(rows.get(n).map((r) => r.commits).filter(Number.isFinite)),
    };
  });
  const base = rungs[0];
  ladder = {
    rungs: rungs.map((r) => ({ ...r, deltaPct: base?.workMs ? +(((r.workMs - base.workMs) / base.workMs) * 100).toFixed(2) : null })),
    floorPct: base?.spreadPct ?? null,
  };
  /* Profile the TOP rung, because that is where the per-pond cost has enough leverage to name
   * itself. A profile at one pond would be a profile of the noise the single-pond arms measured. */
  if (PROFILE) {
    const top = SEED_LADDER[SEED_LADDER.length - 1], bottom = SEED_LADDER[0];
    for (const [key, n] of [["bottom", bottom], ["top", top]]) {
      const s = await openRungSession(n);
      await cost(s.page, s.ctx, s.home);
      const a = await profiledProbe(s.page, s.ctx, s.home);
      ladder[`profile_${key}`] = a ? { ponds: n, totalMs: a.totalMs, samples: a.samples, phases: a.phases, top: a.top, quality: attributionQuality(a) } : null;
      await s.context.close();
    }
    ladder.profileMovers = ladder.profile_bottom && ladder.profile_top ? phaseDelta(ladder.profile_bottom, ladder.profile_top) : null;
  }
  ladder.perPondMs = (() => {
    const a = ladder.rungs[0], b = ladder.rungs[ladder.rungs.length - 1];
    return a && b && b.n > a.n && Number.isFinite(a.workMs) && Number.isFinite(b.workMs) ? +((b.workMs - a.workMs) / (b.n - a.n)).toFixed(2) : null;
  })();
}

const ARM_DEFS = {
  null: { label: "nothing added (the floor)", drive: async () => ({ added: 0, ok: true }) },
  pond: { label: "one detention pond", drive: async () => ({ added: 1, ok: await drawRect(page, "Detention Pond", POND_SPOTS[0]) }) },
  pond2: { label: "two detention ponds", drive: async () => { let n = 0; for (let i = 0; i < 2; i++) if (await drawRect(page, "Detention Pond", POND_SPOTS[i])) n++; return { added: n, ok: n === 2 }; } },
  pond3: { label: "three detention ponds", drive: async () => { let n = 0; for (let i = 0; i < 3; i++) if (await drawRect(page, "Detention Pond", POND_SPOTS[i])) n++; return { added: n, ok: n === 3 }; } },
  "pond-big": { label: "one pond of ~4× the area", drive: async () => ({ added: 1, ok: await drawRect(page, "Detention Pond", BIG_POND) }) },
  building: { label: "one BUILDING of the same footprint (the control)", drive: async () => ({ added: 1, ok: await drawRect(page, "Building", BUILDING_SPOT) }) },
};

/* ⛔ ONE PAIR OF ONE ARM, AND THE ARMS ARE ROUND-ROBINED RATHER THAN RUN AS BLOCKS.
 *
 * The first version of this harness ran each arm's pairs as a contiguous block, null arm first. Its
 * null pairs came back [+3.0, −29.3, −1.9, −5.5] % while the pond arm's — measured minutes later,
 * after the machine had settled — came back [−0.1, +1.6, +2.3, −2.0] %. That is not two different
 * effects, it is ONE effect (early-run drift) landing entirely on whichever arm ran first, and it
 * pushed the stated floor to ±29.3% — wide enough to swallow any answer this instrument could give.
 * Reporting that floor would have been honest and useless. Round-robining spreads every arm's pairs
 * across the whole session, so drift moves every arm the same way and the floor describes the
 * measurement rather than the schedule. */
async function runPair(id, index) {
  const def = ARM_DEFS[id];
  const before = await cost(page, ctx, home);
  const c0 = await counters(page);
  const drive = await def.drive();
  if (!drive.ok) return { fault: `pair ${index + 1}: the driver did not add what this arm says it adds (${drive.added} of the expected)` };
  const c1 = await counters(page);
  const after = await cost(page, ctx, home);
  let fault = null;
  if (drive.added > 0 && !(await undoTimes(page, drive.added, baseEls))) {
    fault = `pair ${index + 1}: undo did not return the scene (${await elCount(page)} elements, expected ${baseEls}) — later pairs would not be paired`;
  }
  return {
    pair: { before: before.workMs, after: after.workMs },
    scene: {
      addedEls: c1.elementsDrawn - c0.elementsDrawn,
      nodesBefore: c0.canvasNodes, nodesAfter: c1.canvasNodes, nodeDelta: c1.canvasNodes - c0.canvasNodes,
      contourBefore: c0.contourRings, contourAfter: c1.contourRings,
      commitsBefore: before.commits, commitsAfter: after.commits,
      longtaskBefore: before.longtaskMs, longtaskAfter: after.longtaskMs,
      frameBefore: before.frameMedianMs, frameAfter: after.frameMedianMs,
      workBefore: before.work, workAfter: after.work,
    },
    fault,
  };
}

const plan = ARMS.filter((id) => id !== "pond-fine").filter((id) => {
  if (ARM_DEFS[id]) return true;
  process.stderr.write(`  ⚠ unknown arm "${id}" — skipped\n`);
  return false;
});
const acc = Object.fromEntries(plan.map((id) => [id, { pairs: [], scenes: [], driverFault: null }]));
for (let i = 0; i < PAIRS; i++) {
  for (const id of plan) {
    const a = acc[id];
    if (a.driverFault) continue;
    const r = await runPair(id, i);
    if (r.fault) { a.driverFault = r.fault; process.stderr.write(`  ⚠ ${id}: ${r.fault}\n`); continue; }
    a.pairs.push(r.pair); a.scenes.push(r.scene);
    process.stderr.write(`  · round ${i + 1} · ${String(id).padEnd(10)} ${String(r.pair.before ?? "—").padStart(8)} → ${String(r.pair.after ?? "—").padStart(8)} ms\n`);
  }
}
const results = {};
for (const id of plan) results[id] = { arm: id, label: ARM_DEFS[id].label, ...pairedDelta(acc[id].pairs), scenes: acc[id].scenes, driverFault: acc[id].driverFault };

const floor = nullFloor((results.null?.rows || []).map((r) => r.deltaPct));

/* ── The contour-INTERVAL arm ────────────────────────────────────────────────────────────────
 * A pond's interval is a stored design parameter with no canvas affordance, so this arm draws a
 * pond, writes a finer interval into the stored plan, RELOADS, and probes — against a control that
 * draws the identical pond and reloads WITHOUT touching the interval. Both members reload, so the
 * reload itself is inside the pair and cancels. */
let intervalArm = null;
if (ARMS.includes("pond-fine")) {
  process.stderr.write("  · arm pond-fine (needs a reload per member) …\n");
  const member = async (intervalFt) => {
    await page.evaluate(() => { try { localStorage.removeItem("planarfit:sites:v1"); } catch (_) {} });
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await setZoom(page, PPF);
    const h = await page.evaluate(readView);
    const ok = await drawRect(page, "Detention Pond", BIG_POND);
    if (!ok) return { ok: false, why: "the pond was not drawn" };
    let applied = null;
    if (intervalFt != null) {
      applied = await setLastPondInterval(page, intervalFt);
      if (!applied.ok) return { ok: false, why: `the interval could not be written: ${applied.why}` };
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
      await page.waitForTimeout(2500);
      await setZoom(page, PPF);
    } else {
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
      await page.waitForTimeout(2500);
      await setZoom(page, PPF);
    }
    const h2 = await page.evaluate(readView);
    for (let i = 0; i < 2; i++) await cost(page, ctx, h2);
    const c = await counters(page);
    const k = await cost(page, ctx, h2);
    return { ok: true, workMs: k.workMs, counters: c, home: h2, h };
  };
  const coarse = await member(null);
  const fine = await member(2);
  intervalArm = {
    coarse, fine,
    deltaPct: coarse.ok && fine.ok ? +(((fine.workMs - coarse.workMs) / coarse.workMs) * 100).toFixed(2) : null,
    ringDelta: coarse.ok && fine.ok ? fine.counters.contourRings - coarse.counters.contourRings : null,
  };
  process.stderr.write(`    coarse ${coarse.workMs ?? "—"} ms (${coarse.counters?.contourRings ?? "—"} rings) → fine ${fine.workMs ?? "—"} ms (${fine.counters?.contourRings ?? "—"} rings)\n`);
  // Restore the ordinary scenario for anything that follows.
  await page.evaluate(() => { try { localStorage.removeItem("planarfit:sites:v1"); } catch (_) {} });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await setZoom(page, PPF);
}

/* ── The zoom sweep ─────────────────────────────────────────────────────────────────────────── */
const sweep = [];
for (const z of PPF_SWEEP) {
  await setZoom(page, z);
  const h = await page.evaluate(readView);
  for (let i = 0; i < 1; i++) await cost(page, ctx, h);
  const before = await cost(page, ctx, h);
  const c0 = await counters(page);
  const ok = await drawRect(page, "Detention Pond", POND_SPOTS[0]);
  const c1 = await counters(page);
  const after = await cost(page, ctx, h);
  await undoTimes(page, 1, baseEls);
  sweep.push({
    ppf: z, ok, beforeMs: before.workMs, afterMs: after.workMs,
    deltaPct: before.workMs && after.workMs ? +(((after.workMs - before.workMs) / before.workMs) * 100).toFixed(2) : null,
    contourRings: c1.contourRings, nodeDelta: c1.canvasNodes - c0.canvasNodes,
  });
  process.stderr.write(`  · ppf ${z} → ${before.workMs ?? "—"} → ${after.workMs ?? "—"} ms · ${c1.contourRings} contour rings · +${c1.canvasNodes - c0.canvasNodes} nodes\n`);
}
if (PPF_SWEEP.length) await setZoom(page, PPF);

/* ── THE AFTER-THE-ACTION WATCH ──────────────────────────────────────────────────────────────
 * Nothing is touched for `--watch-ms` after each add; the app's OWN activity counters say whether
 * it went quiet or kept working. Also reports the DRAINAGE REFRESH state, because adding a pond
 * changes `drainElsSig` — which is what arms the B860 auto-revalidation — and a refresh that never
 * lands is B874's stuck-spinner class. Run for a pond, a building and nothing, so "the app is busy
 * after an edit" and "the app is busy after a POND" are separable. */
const WATCH_MS = numArg("--watch-ms", 12000);
async function watchAfter(id) {
  const def = ARM_DEFS[id];
  await page.evaluate(() => window.__watchStart());
  const w0 = await workMetrics(cdp);
  const drive = await def.drive();
  await page.evaluate(() => window.__watchStart()); // start the clock AFTER the driver's own work
  const w1 = await workMetrics(cdp);
  await page.waitForTimeout(WATCH_MS);
  const read = await page.evaluate(() => window.__watchRead());
  const w2 = await workMetrics(cdp);
  const drain = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      refreshing: /Refreshing flood data|Checking flood/i.test(t),
      recheck: /Re-check/i.test(t),
      stale: /reflect the old|re-check/i.test(t),
    };
  });
  if (drive.added > 0) await undoTimes(page, drive.added, baseEls);
  return {
    arm: id, label: def.label, ok: drive.ok, watchMs: WATCH_MS,
    driverWork: subWork(w0, w1), idleWork: subWork(w1, w2),
    ...read, drain,
  };
}
const watch = [];
if (!process.argv.includes("--no-watch")) {
  for (const id of ["null", "building", "pond"]) {
    if (!ARM_DEFS[id]) continue;
    const r = await watchAfter(id);
    watch.push(r);
    process.stderr.write(`  · watch ${String(id).padEnd(9)} · idle script ${r.idleWork?.scriptMs ?? "—"} ms over ${WATCH_MS / 1000}s · ${r.commits} commits · ${r.mutations} mutations · ${r.longtasks} long tasks\n`);
  }
}

/* ── Attribution ───────────────────────────────────────────────────────────────────────────── */
let attribution = null;
if (PROFILE) {
  process.stderr.write("  · profiling …\n");
  await restoreView(page, home);
  const withoutPond = await profiledProbe(page, ctx, home);
  const drawn = await drawRect(page, "Detention Pond", POND_SPOTS[0]);
  const withPond = drawn ? await profiledProbe(page, ctx, home) : null;
  await undoTimes(page, 1, baseEls);
  attribution = {
    sourceMaps: { chunks: mapCount, mapped: mapCount > 0, broken },
    withoutPond: withoutPond ? { totalMs: withoutPond.totalMs, samples: withoutPond.samples, phases: withoutPond.phases, top: withoutPond.top, quality: attributionQuality(withoutPond) } : null,
    withPond: withPond ? { totalMs: withPond.totalMs, samples: withPond.samples, phases: withPond.phases, top: withPond.top, quality: attributionQuality(withPond) } : null,
    movers: withoutPond && withPond ? phaseDelta(withoutPond, withPond) : null,
  };
}

const scaling = scalingShape([
  { n: 1, deltaPct: results.pond?.deltaPct },
  { n: 2, deltaPct: results.pond2?.deltaPct },
  { n: 3, deltaPct: results.pond3?.deltaPct },
].filter((r) => Number.isFinite(r.deltaPct)), floor.floorPct);

const verdicts = {};
for (const [id, r] of Object.entries(results)) {
  if (id === "null") continue;
  verdicts[id] = armVerdict({ deltaPct: r.deltaPct, floorPct: floor.floorPct, label: r.label });
}

const report = {
  scenario: SCENARIO_ID, shape: scenarioShape(), base: BASE,
  seededPonds: perfScenarioSite(SEED_OPTS).els.filter((e) => e.type === "pond").length,
  transition: NO_PONDS ? "0 → N ponds (the owner's FIRST pond)" : "2 → 2+N ponds (a MARGINAL pond on a plan that already has detention)",
  regime: { dpr: DPR, cpuThrottle: CPU, ppf: PPF, fakeTiles: FAKE_TILES, tilesServed, visibility, pairs: PAIRS, probeReps: PROBE_REPS, panel: PANEL || null, panelState },
  costMetric: "script + layout + style-recalculation ms per identical PAN gesture (CDP Performance.getMetrics deltas) — not a frame median, not quantised by the display clock",
  baseCounters, baseElements: baseEls,
  floor, arms: results, verdicts, scaling, ladder, intervalArm, sweep, watch, attribution,
};

await context.close();
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const L = (s = "") => console.log(s);
L("");
L("ADD ONE DETENTION POND — DOES THE PAN GET DEARER? (NEW-1)");
L(`  scenario ${SCENARIO_ID} · ${report.shape.elements} elements · seeded with ${report.seededPonds} ponds · dpr ${DPR} · cpu ×${CPU} · probed at ppf ${PPF}`);
L(`  TRANSITION MEASURED — ${report.transition}`);
L(`  COST METRIC — ${report.costMetric}`);
L(`  scene at rest: ${baseCounters?.canvasNodes} canvas nodes · ${baseCounters?.contourRings} pond contour rings · ${baseEls} drawn elements`);
L(`  panel: ${PANEL ? (panelState?.ok ? `${PANEL} DOCKED` : `⚠ ${PANEL} REQUESTED BUT NOT OPEN — ${panelState?.why}`) : "none open"}`);
L("");
L(`  NULL-PAIR FLOOR — ±${floor.floorPct ?? "—"}%`);
L(`    ${floor.why}`);
L("");
L("  arm                                        pairs   before      after     delta    verdict");
for (const [id, r] of Object.entries(results)) {
  if (id === "null") continue;
  const v = verdicts[id];
  L(`  ${String(r.label).padEnd(42)} ${String(r.n).padStart(5)} ${String(r.beforeMs ?? "—").padStart(8)} ${String(r.afterMs ?? "—").padStart(10)} ${(r.deltaPct != null ? `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%` : "—").padStart(9)}   ${v.verdict}`);
  if (r.driverFault) L(`      ⚠ ${r.driverFault}`);
}
L("");
for (const [id, v] of Object.entries(verdicts)) L(`  ${id}: ${v.why}`);
L("");
L("  WHAT THE POND PUT ON THE CANVAS (per pair, median):");
for (const [id, r] of Object.entries(results)) {
  const s = r.scenes?.[0];
  if (!s) continue;
  L(`  ${String(id).padEnd(12)} +${String(s.addedEls).padStart(2)} elements · +${String(s.nodeDelta).padStart(4)} canvas nodes · contour rings ${s.contourBefore} → ${s.contourAfter} · commits/gesture ${s.commitsBefore} → ${s.commitsAfter}`);
}
L("");
L(`  SCALING WITH POND COUNT — ${scaling.shape}`);
L(`    ${scaling.why}`);
if (intervalArm) {
  L("");
  L("  CONTOUR INTERVAL (the same pond, a finer interval):");
  if (intervalArm.coarse?.ok && intervalArm.fine?.ok) {
    L(`    coarse: ${intervalArm.coarse.workMs} ms · ${intervalArm.coarse.counters.contourRings} rings`);
    L(`    fine:   ${intervalArm.fine.workMs} ms · ${intervalArm.fine.counters.contourRings} rings  (${intervalArm.deltaPct > 0 ? "+" : ""}${intervalArm.deltaPct}%, ${intervalArm.ringDelta > 0 ? "+" : ""}${intervalArm.ringDelta} rings)`);
  } else {
    L(`    ⚠ unmeasured — ${intervalArm.coarse?.why || intervalArm.fine?.why}`);
  }
}
if (ladder) {
  L("");
  L(`  THE POND-COUNT LADDER — a plan SEEDED with N real ponds, reloaded per rung, ${PAIRS} interleaved sweeps:`);
  L(`    ponds     work/gesture   vs 0 ponds   canvas nodes   contour rings   commits   spread`);
  for (const r of ladder.rungs) {
    L(`    ${String(r.n).padStart(5)} ${String(r.workMs ?? "suppressed").padStart(15)} ${(r.deltaPct != null ? `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%` : "—").padStart(12)} ${String(r.counters?.canvasNodes ?? "—").padStart(14)} ${String(r.counters?.contourRings ?? "—").padStart(15)} ${String(r.commits ?? "—").padStart(9)}   ±${r.spreadPct ?? "—"}%`);
    if (r.effectFault) L(`          ⚠ ${r.effectFault}`);
  }
  L(`    per pond: ${ladder.perPondMs != null ? `${ladder.perPondMs} ms of main-thread work per gesture` : "—"} (rung-0 spread ±${ladder.floorPct ?? "—"}%)`);
  for (const key of ["profile_bottom", "profile_top"]) {
    const a = ladder[key];
    if (!a) continue;
    L("");
    L(`    PROFILE at ${a.ponds} ponds — ${a.totalMs} ms over ${a.samples} samples · UNATTRIBUTED ${a.quality.unattributedPct}%`);
    for (const p of a.phases) L(`       ${String(p.ms).padStart(8)} ms  ${String(p.pct).padStart(5)}%  ${p.phase}`);
    L("       hottest functions (self time):");
    for (const t of a.top) L(`          ${String(t.ms).padStart(8)} ms  ${String(t.pct).padStart(5)}%  ${t.fn}`);
  }
  if (ladder.profileMovers) {
    L("");
    L("    WHAT MOVED between the two rungs (absolute ms per phase, biggest riser first):");
    for (const m of ladder.profileMovers.slice(0, 10)) L(`       ${String(m.deltaMs).padStart(9)} ms   ${String(m.beforeMs).padStart(8)} → ${String(m.afterMs).padStart(8)}   ${m.phase}`);
  }
}
if (watch.length) {
  L("");
  L(`  THE AFTER-THE-ACTION WATCH — ${WATCH_MS / 1000}s of NOTHING TOUCHED, straight after the add:`);
  L("    added                script   layout    style   commits  mutations  long tasks   observer");
  for (const w of watch) {
    L(`    ${String(w.arm).padEnd(12)} ${String(w.idleWork?.scriptMs ?? "—").padStart(12)} ${String(w.idleWork?.layoutMs ?? "—").padStart(8)} ${String(w.idleWork?.recalcMs ?? "—").padStart(8)} ${String(w.commits).padStart(9)} ${String(w.mutations).padStart(10)} ${String(w.longtasks).padStart(11)}   ${w.observerOk ? "ok" : "⚠ NOT INSTALLED — a broken observer reads exactly like a quiet app"}`);
  }
  const p = watch.find((w) => w.arm === "pond");
  if (p) L(`    drainage after the pond: ${p.drain.refreshing ? "REFRESHING" : "not refreshing"} · re-check offered: ${p.drain.recheck ? "yes" : "no"}`);
}
if (sweep.length) {
  L("");
  L("  THE ZOOM SWEEP — the contour gate is a zoom gate, so a pond costs differently at different zooms:");
  L("    ppf      before      after     delta   contour rings   nodes added");
  for (const s of sweep) L(`    ${String(s.ppf).padEnd(7)} ${String(s.beforeMs ?? "—").padStart(8)} ${String(s.afterMs ?? "—").padStart(10)} ${(s.deltaPct != null ? `${s.deltaPct > 0 ? "+" : ""}${s.deltaPct}%` : "—").padStart(8)} ${String(s.contourRings).padStart(15)} ${String(s.nodeDelta).padStart(13)}`);
}
if (attribution) {
  L("");
  if (!attribution.sourceMaps.mapped) L("  ⚠ NO SOURCE MAPS in dist/assets — phases are CHUNK-level only. Rebuild with `npx vite build --sourcemap`.");
  for (const key of ["withoutPond", "withPond"]) {
    const a = attribution[key];
    if (!a) continue;
    L(`  PROFILE — ${key === "withPond" ? "WITH the pond" : "WITHOUT the pond"}: ${a.totalMs?.toFixed?.(1) ?? a.totalMs} ms over ${a.samples} samples`);
    for (const p of a.phases) L(`     ${String(p.ms).padStart(8)} ms  ${String(p.pct).padStart(5)}%  ${p.phase}`);
    L(`     UNATTRIBUTED: ${a.quality.unattributedPct}% ${a.quality.meetsStandard ? `— inside the ${a.quality.standardPct}% standard` : "— ⚠ ABOVE the standard"}`);
    if (a.top) {
      L("     hottest functions (self time):");
      for (const t of a.top) L(`        ${String(t.ms).padStart(8)} ms  ${String(t.pct).padStart(5)}%  ${t.fn}`);
    }
    L("");
  }
  if (attribution.movers) {
    L("  WHAT MOVED (absolute ms per phase, biggest riser first):");
    for (const m of attribution.movers.slice(0, 12)) L(`     ${String(m.deltaMs > 0 ? "+" : "").padStart(1)}${String(m.deltaMs).padStart(8)} ms   ${String(m.beforeMs).padStart(8)} → ${String(m.afterMs).padStart(8)}   ${m.phase}`);
  }
}
L("");
L("  ⚠ WHAT THIS RUN CANNOT SETTLE: the sandbox is logged out, every external GIS host is blocked, and");
L("    the reference plan is a FLOOR for the owner's heaviest. Every number is a lower bound.");
L("");
