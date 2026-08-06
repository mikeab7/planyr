#!/usr/bin/env node
/* boot-tail — THE 2.2-SECOND POST-DRAW TAIL, ATTRIBUTED (NEW-1, speed program phase 4).
 *
 * ⛔ THIS INSTRUMENT FIXES NOTHING. The deliverable is a BREAKDOWN. Protocol, definitions and
 * limits live in ui-audit/lib/bootTail.mjs; this file only drives the browser and prints.
 *
 * TWO MODES, and they are separate runs on purpose:
 *
 *   --attribute   ONE boot, profiled, with the window canvas-drawn → SETTLED attributed to named
 *                 phases in ms, plus a chronological ledger of what LANDED inside it and a
 *                 first-sighting verdict for every named candidate.
 *   --ladder      The SAME viewport-neutral pan gesture at t = 1, 2, 3, 5 and 10 s after load,
 *                 one FRESH PAGE LOAD PER RUNG. A ladder measured inside one page load would be
 *                 measuring the previous rung's gesture as much as the delay — the probe at t=1s
 *                 warms memos, settles layout and mutates the view that the t=2s probe would then
 *                 inherit. Rungs are INTERLEAVED across reps so this container's warm-up drift
 *                 cannot masquerade as a trend.
 *
 * THE REGIME IS THE OWNER'S, not the one that makes numbers look tidy: 1× CPU (his complaint is at
 * 1×), dpr 2 (retina), --fake-tiles so aerial decode and texture upload are real work.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/boot-tail.mjs --fake-tiles --dpr 2
 *   ... --ladder-reps 4 --mode ladder
 *   ... --layers 4          # seed the plan with N saved layers ON, the axis the FILE controls
 *   ... --json
 *
 * ⚠ BUILD WITH SOURCE MAPS FIRST — `npx vite build --sourcemap` — or the phases below can only be
 * chunk names. The run says so in its own output rather than printing a chunk where a phase belongs.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { attributeProfile, loadSourceMaps, makeFrameResolver, bootMarksScript } from "./lib/bootTimeline.mjs";
import {
  settlePoint, tailQuality, ledgerBuckets, firstSightings, TAIL_CANDIDATES,
  tailInstrumentScript, tailReadScript, workNoiseFloor, ladderVerdict, median,
} from "./lib/bootTail.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { perfScenarioSite, SCENARIO_ID, scenarioShape } from "./lib/perf-scenario.mjs";
import { buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { fixtureCensus, paintedRasters, heldButUnpaintedRasters } from "./lib/planFixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = Number(arg(f, NaN)); return Number.isFinite(v) ? v : d; };
const JSON_OUT = process.argv.includes("--json");
const FAKE_TILES = process.argv.includes("--fake-tiles");
const DPR = num("--dpr", 2);
const CPU = num("--cpu-throttle", 1);
const QUIET_MS = num("--quiet", 750);
const CEILING_MS = num("--ceiling", 25000);
const MODE = arg("--mode", "both");
const LADDER_REPS = num("--ladder-reps", 3);
const LADDER_RUNGS = String(arg("--rungs", "1,2,3,5,10")).split(",").map(Number).filter((n) => n > 0);
const SAVED_LAYERS = num("--layers", 0);
const DIST = join(HERE, "..", "dist");
/* ---- --fixture <name> (NEW-1) ------------------------------------------------------------------
 * ⛔ THE REASON THIS FLAG EXISTS IS THE WHOLE POINT OF THE DISPATCH IT SHIPPED IN. Every boot number
 * this instrument has produced came from Goose Creek, because Goose Creek was the only real plan the
 * harness could open. The owner reports that BAIN is slow, and Bain's distinguishing feature — two
 * large rasters, one of them 4.5 megapixels at 55% opacity — is a load the reference plan does not
 * contain at all. A boot measured on a plan with no rasters cannot see a raster's boot cost.
 *
 *   --fixture goose   the reference plan (default; every existing number was taken here)
 *   --fixture bain    ui-audit/fixtures/bain-concept-a.json, WITH both rasters in IndexedDB
 *
 * ⚠ THE RASTERS ARRIVE BY `storageState`, NOT BY A THROWAWAY NAVIGATION. IndexedDB cannot be seeded
 * before an origin exists, and the obvious fix — load, write, reload — leaves a warm HTTP and V8 code
 * cache, so the "cold boot" measured after it is a second boot wearing a first boot's name. See
 * lib/fixtureSeeding.mjs. */
const FIXTURE = String(arg("--fixture", "goose")).toLowerCase();
const CACHE = join(HERE, ".raster-cache");

/* ---- The seed ---------------------------------------------------------------------------------
 * The reference plan, plus an optional SAVED LAYER SET.
 *
 * ⚠ WHICH FIXTURE, AND WHY IT IS NOT SYLVESTRI. The item names the owner's Sylvestri / Concept D
 * site. `ui-audit/fixtures/sylvestri-concept-d.json` exists but is an ELEMENTS-ONLY export — 22
 * elements, no parcels, no settings, no origin — so it cannot be opened as a plan at all, let
 * alone exercise the boot path this item is about (no settings means no layer overrides, no origin
 * means no map). The real record lives behind a signed-in session this sandbox cannot reach. The
 * closest fixture that DOES exercise the whole path is the one already of record for every other
 * perf instrument here: `goose-creek-plan1copy.json`, the owner's own plan pulled from production —
 * 62 elements, 6 parcels, 2 ponds, 6 centreline roads, its real 30-key settings. It is a FLOOR on
 * Sylvestri, not a match, and every number below carries that.
 *
 * ⚠ AND THE LAYER SET IS AN ARM, because the fixture saves NONE. `defaultOverlayState()`
 * (lib/layers.js) starts every layer OFF and a plan restores only what its own `layerOverrides`
 * map holds, so the reference plan opens with ZERO layers — which means the fixture as committed
 * cannot test the "the FILE turns layers on" hypothesis at all.
 *
 * ⛔ AND THE ARM IS BUILT FROM THE APP'S OWN LAYER IDS, NOT HAND-AUTHORED. `--layers N` opens the
 * app once, reads the live registry through the `__PLANYR_E2E`-gated `window.__plannerLayers()`
 * hook, and seeds the first N of those ids into the saved record's `layerOverrides`. Hand-writing
 * an id here would be dropped by `sanitizeLayerOverrides` (it keeps only ids in the live registry)
 * and the harness would then measure the ZERO-layer arm while reporting N. The arm is then PROVEN
 * on the measured page from the app's own state before any number is taken; if it did not take,
 * the run STOPS rather than reporting a plausible number (the rung-effect discipline of
 * lib/sessionAxes.mjs, applied to an arm).
 *
 * ⚠ AND WHAT THE ARM CAN AND CANNOT SEE HERE. Most registry layers need an external host this
 * sandbox blocks, so an enabled layer costs the app everything on ITS side — the mount-only
 * restore effect, the idle-staged overlay admission, the Leaflet layer objects, the React work —
 * and never receives a byte of data. That is a FLOOR on what a layer costs the owner, and it is
 * the honest half of the hypothesis rather than the whole of it.
 */
const seedFor = (rec) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SCENARIO_ID]: rec }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SCENARIO_ID)});
} catch (e) {} })();`;

const BASE_SEED = seedFor(perfScenarioSite());

/** The seed actually used. Replaced by `learnLayerSeed` when `--layers N` is asked for. */
let SEED = BASE_SEED;
/** Non-null when a fixture with rasters is in play: every measured context is built FROM this
 *  instead of seeding localStorage itself, so IndexedDB is populated before the first navigation. */
let FIXTURE_STATE = null;
let FIXTURE_FACTS = null;

async function learnLayerSeed(browser, n) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.addInitScript(BASE_SEED);
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__plannerLayers === "function", { timeout: 20000 });
  const ids = await page.evaluate(() => window.__plannerLayers().ids);
  await ctx.close();
  if (ids.length < n) throw new Error(`the --layers ${n} arm cannot be built: the app offers ${ids.length} layer(s).`);
  /* ⚠ THE OVERRIDE MAP IS `{id: boolean}` — `sanitizeLayerOverrides` (lib/layerPrefs.js) keeps a
   * key only when `typeof v === "boolean"` AND the id is in the live registry, so any other shape
   * is silently dropped and the arm quietly becomes the zero-layer one. */
  const rec = { ...perfScenarioSite(), layerOverrides: Object.fromEntries(ids.slice(0, n).map((id) => [id, true])) };
  return { seed: seedFor(rec), on: n, ids: ids.slice(0, n) };
}

/* The arm is PROVEN on the measured page, from the app's own state — never from the harness's
 * belief about what it seeded (the rung-effect discipline of lib/sessionAxes.mjs). */
async function assertLayerArm(page, n) {
  if (n <= 0) return { ok: true, on: 0 };
  const on = await page.evaluate(() => (typeof window.__plannerLayers === "function" ? window.__plannerLayers().on.length : -1)).catch(() => -1);
  if (on < n) throw new Error(`the --layers ${n} arm DID NOT TAKE: the running app reports ${on} layer(s) on. Refusing to measure an arm that did not happen.`);
  return { ok: true, on };
}

async function newCtx(browser, nLayers) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true,
    ...(FIXTURE_STATE ? { storageState: FIXTURE_STATE } : {}),
  });
  await ctx.addInitScript(() => performance.setResourceTimingBufferSize(6000));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  /* With a fixture state the plan record is already in localStorage — re-seeding it would be
   * harmless but would also hide a broken state, so it is deliberately not done. */
  if (!FIXTURE_STATE) await ctx.addInitScript(SEED);
  await ctx.addInitScript(bootMarksScript());
  await ctx.addInitScript(tailInstrumentScript());
  let tiles = 0;
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    if (FAKE_TILES) {
      const t = parseTileUrl(u);
      if (t) { tiles++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
    }
    return route.abort();
  });
  return { ctx, tilesServed: () => tiles };
}

/* Layer visibility, sampled per frame in the page and pushed into the SAME event stream as
 * everything else — so "the layers arrived at 1.4 s" is one row of the ledger, not a side table. */
const WATCH_LAYERS = () => {
  const T = window.__tail;
  const seen = new Set();
  const tick = () => {
    for (const n of document.querySelectorAll(".leaflet-pane > .leaflet-layer, .leaflet-pane > svg, .leaflet-pane > canvas")) {
      const key = (n.className?.baseVal ?? n.className ?? "") + "|" + (n.dataset?.layerId || n.tagName);
      if (!seen.has(key)) { seen.add(key); T.events.push({ tMs: +performance.now().toFixed(1), kind: "layer", name: key.slice(0, 48), count: 1 }); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/* ---- MODE 1: attribute the tail --------------------------------------------------------------- */
async function attributeRun(browser, nLayers) {
  const { ctx, tilesServed } = await newCtx(browser, nLayers);
  await ctx.addInitScript(WATCH_LAYERS);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await cdp.send("Profiler.start");

  await page.goto(BASE, { waitUntil: "commit" });
  await page.waitForSelector("svg[role=application]", { timeout: 60000 });
  await assertLayerArm(page, nLayers);
  const inkAt = await page.waitForFunction(() => window.__tail?.marks?.canvasInk ?? null, { timeout: CEILING_MS })
    .then((h) => h.jsonValue()).catch(() => null);
  const drawnAt = await page.waitForFunction(() => window.__tail?.marks?.canvasSettled ?? null, { timeout: CEILING_MS })
    .then((h) => h.jsonValue()).catch(() => null);

  /* ⛔ NO GESTURE IN THIS MODE. B1431's window ended at a press the HARNESS delivered; this window
   * is the app's own, and pressing inside it would put the harness's work in the tail it is
   * measuring. We watch and do nothing. */
  /* Watch until the page has been QUIET for the full quiet run, or the ceiling — whichever comes
   * first. Waiting out the whole ceiling every run would be honest but wasteful; stopping early on
   * a settle is not a shortcut, because `settlePoint` re-derives the settle from the event stream
   * and would still report NOT SETTLED if the quiet run were short. */
  await page.waitForFunction(([quiet, until]) => {
    const T = window.__tail; const now = performance.now();
    if (now >= until) return true;
    const last = T.events.length ? T.events[T.events.length - 1].tMs : 0;
    return now - last >= quiet;
  }, [QUIET_MS, (inkAt ?? 0) + CEILING_MS], { timeout: CEILING_MS + 15000, polling: 100 }).catch(() => null);
  const observedTo = await page.evaluate(() => performance.now());

  /* Clock alignment by an in-profile burn marker (B1431's method — the naive CDP pairing measured
   * ±390 ms and correctly suppressed itself; this is good to about one sampling interval). Runs
   * AFTER the window it aligns, so it cannot inflate it. */
  const burn = await page.evaluate((ms) => {
    const t0 = performance.now();
    function __bootTailClockMark() { let n = 0; const end = performance.now() + ms; while (performance.now() < end) n++; return n; }
    __bootTailClockMark();
    return { t0, t1: performance.now() };
  }, 80);
  const { profile } = await cdp.send("Profiler.stop");
  const markIds = new Set((profile.nodes || []).filter((n) => n.callFrame?.functionName === "__bootTailClockMark").map((n) => n.id));
  let markFromUs = Infinity, markToUs = -Infinity, t = profile.startTime || 0;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    t += (profile.timeDeltas || [])[i] || 0;
    if (!markIds.has(profile.samples[i])) continue;
    if (t < markFromUs) markFromUs = t;
    if (t > markToUs) markToUs = t;
  }
  const aligned = Number.isFinite(markFromUs) && markToUs > markFromUs;
  const monoZeroUs = aligned ? markFromUs - burn.t0 * 1000 : NaN;
  const uncertaintyMs = aligned ? +(Math.abs((markToUs - markFromUs) / 1000 - (burn.t1 - burn.t0)) + 0.25).toFixed(2) : Infinity;

  const read = await page.evaluate(tailReadScript());
  const marks = await page.evaluate(() => ({ ...window.__boot.marks }));
  /* THE WINDOW STARTS AT FIRST INK, not at the settled node count. B1431's `canvasDrawn` requires
   * 250 ms of a still node count, so a window starting there has already thrown away the quarter
   * second before it — and worse, it can only start once the app has ALREADY gone quiet once,
   * which is close to begging the question. Both are reported; the tail is measured from ink. */
  const from = inkAt ?? drawnAt ?? 0;
  const settle = settlePoint(read.events, { from, observedTo, quietMs: QUIET_MS });
  const winTo = settle.settled ? settle.settledAtMs : observedTo;

  const { lookups, count: mapCount, broken } = await loadSourceMaps(DIST);
  const resolve = makeFrameResolver(lookups);
  const attribution = aligned
    ? attributeProfile(profile, resolve, { window: { fromUs: monoZeroUs + from * 1000, toUs: monoZeroUs + winTo * 1000 } })
    : null;
  const whole = attributeProfile(profile, resolve);

  const evInWindow = read.events.filter((e) => e.tMs >= from && e.tMs <= winTo);
  const commitsInWindow = evInWindow.filter((e) => e.kind === "react-commit").length;
  const mutationsInWindow = evInWindow.filter((e) => e.kind === "mutation").reduce((a, e) => a + e.count, 0);

  await ctx.close();
  return {
    mode: "attribute", nLayers, dpr: DPR, cpu: CPU, fakeTiles: FAKE_TILES, tilesServed: tilesServed(),
    marks, inkAtMs: inkAt, drawnAtMs: drawnAt, windowFromMs: from, observedToMs: +observedTo.toFixed(1), settle,
    installed: read.installed, failedObservers: read.failed,
    sourceMaps: { chunks: mapCount, mapped: mapCount > 0, broken },
    alignment: { aligned, uncertaintyMs },
    attribution, quality: attribution ? tailQuality(attribution) : null,
    wholeBootMs: whole.totalMs,
    ledger: ledgerBuckets(read.events, { from, to: winTo, bucketMs: 250 }),
    sightings: firstSightings(read.events, TAIL_CANDIDATES),
    reactCommitsTotal: read.commits, reactCommitsWhy: read.commitsWhy, commitsInWindow,
    mutationRecordsTotal: read.mutationRecords, mutationBatches: read.mutationBatches, mutationsInWindow,
    idbReads: read.idbReads,
    longTasksInWindow: read.longTasks.filter((l) => l.start >= from && l.start <= winTo),
    canvasNodes: read.canvasNodes, documentNodes: read.documentNodes,
    leafletLayers: read.leafletLayers, leafletTiles: read.leafletTiles,
    events: read.events.length,
  };
}

/* ---- MODE 2: the pan ladder --------------------------------------------------------------------
 * One fresh load per rung. The gesture is session-axes.mjs's pan half, unchanged in shape, and the
 * cost metric is that harness's un-quantised one: the renderer's own cumulative Script + Layout +
 * RecalcStyle durations, differenced across the gesture. The view is asserted NEUTRAL — the pan
 * goes out and straight back, so a rung that ended somewhere else measured a different scene and
 * is suppressed rather than reported.
 */
const PAN_PX = 260, PAN_STEPS = 20;
const READ_VIEW = `(() => { const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null; })()`;
const PRESS_POINT = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]'); if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.28, 0.72, 0.14, 0.86]) for (const fx of [0.28, 0.72, 0.14, 0.86, 0.5]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
  } return null; })()`;

async function work(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {}; for (const { name, value } of m.metrics || []) g[name] = value;
    return { script: (g.ScriptDuration || 0) * 1000, layout: (g.LayoutDuration || 0) * 1000, recalc: (g.RecalcStyleDuration || 0) * 1000 };
  } catch (_) { return null; }
}

async function ladderRung(browser, tSec, nLayers) {
  const { ctx } = await newCtx(browser, nLayers);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "commit" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  /* The delay is measured from NAVIGATION, which is what "three seconds after it loads" means to
   * the owner — not from some internal mark he cannot see. */
  const wait = tSec * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);

  const press = await page.evaluate(PRESS_POINT);
  if (!press) { await ctx.close(); return { tSec, workMs: null, why: "no bare-canvas press point could be resolved" }; }
  const before = await page.evaluate(READ_VIEW);
  await page.mouse.move(press.x, press.y);
  const w0 = await work(cdp);
  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const w1 = await work(cdp);
  const after = await page.evaluate(READ_VIEW);
  const counters = await page.evaluate(tailReadScript());
  await ctx.close();
  const neutral = before && after && before.ppf === after.ppf
    && Math.abs(Number(before.offX) - Number(after.offX)) <= 1 && Math.abs(Number(before.offY) - Number(after.offY)) <= 1;
  if (!neutral) return { tSec, workMs: null, why: `the view was not neutral across the gesture (${JSON.stringify(before)} → ${JSON.stringify(after)}) — this rung looked at a different scene and is SUPPRESSED, not reported` };
  if (!w0 || !w1) return { tSec, workMs: null, why: "the renderer's work counters were unreadable" };
  return {
    tSec,
    workMs: +((w1.script - w0.script) + (w1.layout - w0.layout) + (w1.recalc - w0.recalc)).toFixed(2),
    scriptMs: +(w1.script - w0.script).toFixed(2), layoutMs: +(w1.layout - w0.layout).toFixed(2), recalcMs: +(w1.recalc - w0.recalc).toFixed(2),
    canvasNodes: counters.canvasNodes, leafletLayers: counters.leafletLayers, leafletTiles: counters.leafletTiles,
    commits: counters.commits, why: null,
  };
}

async function ladderRun(browser, nLayers) {
  const byRung = new Map(LADDER_RUNGS.map((t) => [t, []]));
  const suppressed = [];
  for (let rep = 0; rep < LADDER_REPS; rep++) {
    /* INTERLEAVED: every rep walks the whole ladder, so container warm-up drift lands on every
     * rung equally instead of on the rung that happened to run first. */
    for (const t of LADDER_RUNGS) {
      const r = await ladderRung(browser, t, nLayers);
      if (r.why) suppressed.push({ rep, ...r });
      else byRung.get(t).push(r);
    }
  }
  const rungs = LADDER_RUNGS.map((t) => ({ tSec: t, workMs: byRung.get(t).map((r) => r.workMs), runs: byRung.get(t) }));
  const baseRung = rungs.find((r) => r.tSec === LADDER_RUNGS[0]);
  const floor = workNoiseFloor(baseRung?.workMs || []);
  return {
    mode: "ladder", nLayers, dpr: DPR, cpu: CPU, fakeTiles: FAKE_TILES, reps: LADDER_REPS,
    floor, suppressed,
    verdict: ladderVerdict(rungs, { floorPct: floor.floorPct, fromSec: LADDER_RUNGS[0], toSec: LADDER_RUNGS.includes(3) ? 3 : LADDER_RUNGS[LADDER_RUNGS.length - 1] }),
    detail: rungs.map((r) => ({
      tSec: r.tSec, n: r.runs.length,
      scriptMs: median(r.runs.map((x) => x.scriptMs)), layoutMs: median(r.runs.map((x) => x.layoutMs)), recalcMs: median(r.runs.map((x) => x.recalcMs)),
      canvasNodes: median(r.runs.map((x) => x.canvasNodes)), leafletTiles: median(r.runs.map((x) => x.leafletTiles)),
      commits: median(r.runs.map((x) => x.commits)),
    })),
  };
}

/* ---- Print --------------------------------------------------------------------------------------- */
function printAttribute(o) {
  const shape = scenarioShape();
  console.log(`THE POST-DRAW TAIL — canvas drawn → settled   [cpu ${o.cpu}×, dpr ${o.dpr}, tiles ${o.fakeTiles ? `FAKE-SERVED (${o.tilesServed} decoded)` : "BLOCKED"}, quiet run ${QUIET_MS} ms]`);
  console.log(`  plan: goose-creek-plan1copy (${shape.elements} els · ${shape.parcels} parcels · ${shape.ponds} ponds · ${shape.centerlineRoads} centreline roads)  ·  saved layers ON: ${o.nLayers}`);
  if (!o.sourceMaps.mapped) console.log(`  ⚠ NO SOURCE MAPS in dist/assets — phases are CHUNK-level only. Rebuild with \`npx vite build --sourcemap\`.`);
  if (o.sourceMaps.broken?.length) console.log(`  ⚠ ${o.sourceMaps.broken.length} source map(s) unreadable: ${o.sourceMaps.broken.map((b) => b.name).join(", ")}`);
  const fails = Object.entries(o.failedObservers || {});
  if (fails.length) {
    console.log(`\n  ⛔ ${fails.length} OBSERVER(S) DID NOT INSTALL — every number below that depends on one is INCOMPLETE, not quiet:`);
    for (const [k, why] of fails) console.log(`       ${k}: ${why}`);
  }
  console.log(`\n  first ink on the canvas at ${Math.round(o.inkAtMs)} ms; its node count then held still from ${Math.round(o.drawnAtMs)} ms (B1431's "canvas drawn", which has a 250 ms quiet period built into it).`);
  console.log(`  The harness watched from FIRST INK, and did NOTHING, until ${Math.round(o.observedToMs)} ms.`);
  if (o.settle.settled) {
    console.log(`  SETTLED at ${Math.round(o.settle.settledAtMs)} ms — last activity "${o.settle.lastEvent?.kind}${o.settle.lastEvent?.name ? ` (${o.settle.lastEvent.name})` : ""}", then ${QUIET_MS} ms of nothing.`);
    console.log(`  ⇒ THE TAIL, first ink → settled, IS ${Math.round(o.settle.tailMs)} ms.  (From B1431's "canvas drawn" instead: ${Math.round(o.settle.settledAtMs - o.drawnAtMs)} ms.)`);
  } else {
    console.log(`  ⚠ NOT SETTLED — ${o.settle.why}`);
  }
  if (!o.attribution) { console.log(`\n  ⚠ attribution SUPPRESSED — the profile clock could not be aligned to the page clock (±${o.alignment.uncertaintyMs} ms).`); return; }
  const q = o.quality;
  console.log(`\n  INSIDE THE TAIL (clock alignment ±${o.alignment.uncertaintyMs} ms via an in-profile burn marker):`);
  console.log(`     ${q.totalMs} ms of samples — BUSY ${q.busyPct}% · idle ${(100 - q.busyPct).toFixed(1)}%`);
  for (const p of o.attribution.phases) console.log(`     ${String(p.ms).padStart(8)} ms  ${String(p.pct).padStart(5)}%  ${p.phase}`);
  console.log(`     UNATTRIBUTED: ${q.unattributedMs} ms = ${q.unattributedPct}% ${q.meetsStandard ? `— inside B1431's ${q.standardPct}% standard` : `— ⚠ ABOVE B1431's ${q.standardPct}% standard, so this table is less complete than that one`}`);
  for (const u of o.attribution.unattributed) console.log(`        ${String(u.ms).padStart(8)} ms  ${u.fn}`);

  console.log(`\n  WHAT LANDED, AND WHEN (each candidate is a hypothesis; "never happened" is a refutation):`);
  for (const s of o.sightings) console.log(`     ${s.atMs == null ? "     — " : `${String(s.atMs).padStart(6)} ms`}  ${s.candidate.padEnd(58)} ${s.verdict}`);

  console.log(`\n  REACT COMMITS in the tail: ${o.commitsInWindow}${o.reactCommitsWhy ? `  (⚠ ${o.reactCommitsWhy})` : `  — counted from React's own onCommitFiberRoot, not estimated (${o.reactCommitsTotal} across the whole boot)`}`);
  console.log(`  DOM MUTATION RECORDS in the tail: ${o.mutationsInWindow} (${o.mutationBatches} batches across the boot) · IndexedDB reads: ${o.idbReads}`);
  const lt = o.longTasksInWindow.filter((l) => l.dur >= 50);
  console.log(`  LONG TASKS in the tail (≥50 ms): ${lt.length}, totalling ${Math.round(lt.reduce((a, b) => a + b.dur, 0))} ms${lt.length ? ` — worst ${Math.max(...lt.map((l) => l.dur))} ms` : ""}`);
  console.log(`  canvas ${o.canvasNodes} nodes · document ${o.documentNodes} nodes · leaflet layers ${o.leafletLayers} · tiles ${o.leafletTiles}`);

  console.log(`\n  THE TAIL, 250 ms AT A TIME (activity events per bucket):`);
  for (const b of o.ledger) {
    if (!b.total) { console.log(`     ${String(b.fromMs).padStart(6)}–${String(b.toMs).padStart(6)} ms   —`); continue; }
    const kinds = Object.entries(b.byKind).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
    console.log(`     ${String(b.fromMs).padStart(6)}–${String(b.toMs).padStart(6)} ms   ${kinds}${b.names.length ? `   [${b.names.slice(0, 3).join(", ")}]` : ""}`);
  }
  console.log(`\n  ⚠ This sandbox blocks GIS and Supabase (aerial tiles are served locally so decode is real), and has 4 cores against the owner's 28. Every number is a LOWER BOUND on his.`);
}

function printLadder(o) {
  console.log(`\n\nTHE SAME PAN, AT FIVE DELAYS AFTER LOAD   [cpu ${o.cpu}×, dpr ${o.dpr}, ${o.reps} reps, rungs INTERLEAVED, one fresh load per rung]`);
  console.log(`  cost = main-thread work per gesture (script + layout + style), differenced from the renderer's own counters. NOT a frame median — B1432's ±99.8% floor was 16.7 ms quantisation in that metric.`);
  console.log(`  noise floor, measured at the t=${LADDER_RUNGS[0]}s rung: ${o.floor.floorPct == null ? o.floor.why : `±${o.floor.floorPct}% (${o.floor.n} reps, ${o.floor.min}–${o.floor.max} ms)`}\n`);
  console.log(`     delay      n   work/gesture       range        vs t=${LADDER_RUNGS[0]}s     script   layout   style   canvas   tiles   commits`);
  for (const r of o.verdict.rows) {
    const d = o.detail.find((x) => x.tSec === r.tSec) || {};
    const range = r.minMs == null ? "        —" : `${r.minMs.toFixed(0)}–${r.maxMs.toFixed(0)} ms`;
    console.log(`     t=${String(r.tSec).padStart(2)}s   ${String(r.n).padStart(4)}   ${r.medianMs == null ? "        —" : `${String(r.medianMs.toFixed(1)).padStart(8)} ms`}   ${range.padStart(13)}   ${r.deltaPct == null ? "     —" : `${(r.deltaPct > 0 ? "+" : "") + r.deltaPct}%`.padStart(8)}   ${String(d.scriptMs ?? "—").padStart(6)}   ${String(d.layoutMs ?? "—").padStart(6)}   ${String(d.recalcMs ?? "—").padStart(5)}   ${String(d.canvasNodes ?? "—").padStart(6)}   ${String(d.leafletTiles ?? "—").padStart(5)}   ${String(d.commits ?? "—").padStart(7)}`);
  }
  console.log(`\n  ⇒ ${o.verdict.answer}`);
  if (o.suppressed.length) {
    console.log(`\n  ⚠ ${o.suppressed.length} rung run(s) SUPPRESSED rather than reported:`);
    for (const s of o.suppressed.slice(0, 6)) console.log(`     rep ${s.rep} t=${s.tSec}s — ${s.why}`);
  }
}

/* ---- Run ------------------------------------------------------------------------------------------ */
const browser = await chromium.launch({
  executablePath: EXEC,
  headless: false, // ⚠ REQUIRED — a hidden tab starves rAF and the frame/idle picture is garbage (B1086)
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
});
const out = {};
try {
  if (FIXTURE !== "goose") {
    const file = FIXTURE === "bain" ? "bain-concept-a.json" : `${FIXTURE}.json`;
    const fx = JSON.parse(readFileSync(join(HERE, "fixtures", file), "utf8"));
    const built = await buildFixtureState(browser, { base: BASE, fixture: fx, siteId: "boot-tail-fixture", cacheDir: CACHE });
    FIXTURE_STATE = built.state; FIXTURE_FACTS = built.facts;
    out.fixture = {
      name: FIXTURE, census: fixtureCensus(fx), rasters: built.facts,
      painted: paintedRasters(fx).map((r) => `${r.role} ${r.imgW}×${r.imgH} @${r.opacity}`),
      /* ⚠ With an origin present the live basemap replaces the aerial underlay, so its bytes are
       * loaded and held but NEVER composited. Reporting that separately is the difference between
       * "26 MB of texture" and the truth. */
      heldButNeverPainted: heldButUnpaintedRasters(fx).map((r) => `${r.role} ${r.imgW}×${r.imgH}`),
    };
    if (!JSON_OUT) {
      const c = out.fixture.census;
      console.log(`  fixture "${FIXTURE}": ${c.elements} elements · ${c.parcels} parcels · ${c.ponds} pond(s) · ${c.rasters.length} raster(s)`);
      console.log(`    painted: ${out.fixture.painted.join(" · ") || "none"}`);
      if (out.fixture.heldButNeverPainted.length) console.log(`    held but NEVER painted (the live basemap replaces it): ${out.fixture.heldButNeverPainted.join(" · ")}\n`);
    }
  }
  if (SAVED_LAYERS > 0) {
    const learned = await learnLayerSeed(browser, SAVED_LAYERS);
    SEED = learned.seed;
    if (!JSON_OUT) console.log(`  layer arm built from the APP'S OWN registry ids (read through the __PLANYR_E2E hook): ${learned.ids.join(", ")}\n`);
    out.layerArm = { on: learned.on, ids: learned.ids };
  }
  if (MODE === "both" || MODE === "attribute") { out.attribute = await attributeRun(browser, SAVED_LAYERS); if (!JSON_OUT) printAttribute(out.attribute); }
  if (MODE === "both" || MODE === "ladder") { out.ladder = await ladderRun(browser, SAVED_LAYERS); if (!JSON_OUT) printLadder(out.ladder); }
} finally {
  await browser.close();
}
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
