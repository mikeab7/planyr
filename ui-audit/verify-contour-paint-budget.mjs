#!/usr/bin/env node
/* verify-contour-paint-budget — B802400 round 5. Michael's own in-app perf captures (real
 * production telemetry, plan smt7q6ar8egz "Concept A (copy)"/Richfield, contours on) show
 * windowMeanMs 227–332ms against a 16.7ms baseline (13.6–19.9x), with the four WORST long tasks
 * in every capture resolving to ltNames "FrameRequestCallback" and lasting 1.5–3.1 SECONDS each —
 * coincident with a BURST of lattice tiles landing close together (terrain-tile-timing: 12 band-12
 * tiles inside ~9s), not one slow tile. Rounds 1–4 (B800848 diffed painting, B800849 sort-key
 * caching, B802400 rounds 3–4 cache/status honesty) never touched this: they make the PAINT DECISION
 * cheaper, none change how the decided add/remove list is APPLIED to Leaflet's canvas renderer,
 * which is O(total layers held) on every redraw it schedules.
 *
 * WHAT THIS MEASURES. A real `PerformanceObserver({entryTypes:['longtask']})` — no browser-support
 * gap like the newer long-animation-frame API, and it reports the SAME thing this session's brief
 * cites: any task blocking the main thread past 50ms, with `.duration` in ms. This harness drives a
 * BURST of pan steps (several `centerOn()` calls fired close together, never waiting for one to
 * fully settle before the next — exactly the "burst of tiles, not one slow tile" shape the tile
 * timing data shows) against a real captured LERC tile served with STAGGERED artificial network
 * delay (drawn from the real band-12/15/18 fetch+worker totals in the brief), and reports the
 * WORST single long task observed. Optionally compares a pre-fix build (`--before-dir`) against the
 * current one, the same before/after method B800848/B800849 used for this exact layer.
 *
 * REAL DATA, NOT SYNTHETIC. Every `elevation.nationalmap.gov` request from Chromium in this sandbox
 * is `ERR_CONNECTION_RESET` (confirmed by every prior round), so exportImage requests are
 * intercepted and answered with the real captured `test/fixtures/dep-katy-528x528.lerc` tile — the
 * SAME fixture `diagnose-contour-pan-perf.mjs` uses, at the size a real lattice tile actually
 * requests (528x528 — a mismatched size makes `decodeGrid()` LOUDLY refuse and nothing ever paints,
 * the exact defect B800849 found and fixed in this harness's sibling).
 *
 * USAGE
 *   node ui-audit/verify-contour-paint-budget.mjs
 *   ... --before-dir dist-before   # also measure a pre-fix build for a RED/GREEN comparison
 *   ... --steps 8                  # burst pan steps (default 8)
 *   ... --budget-ms 50             # the stated no-single-task-over budget (default 50)
 *   ... --json
 *
 * Never exits non-zero on a measurement — it is an instrument, not a gate (same convention as
 * diagnose-contour-pan-perf.mjs). The RED/RESULT lines are for a human (or this session) to read.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { perfScenarioSite, ORIGIN } from "./lib/perf-scenario.mjs";
import { zoomToPpf } from "../src/workspaces/site-planner/lib/mapLock.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { TILE_CELLS, bandCellMeters, groundScale } from "../src/workspaces/site-planner/lib/demGrid.js";

const M_TO_FT = 3.280839895;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const numArg = (f, d) => { const v = Number(argOf(f, NaN)); return Number.isFinite(v) && v > 0 ? v : d; };

const STEPS = numArg("--steps", 8);
const ZOOM = numArg("--zoom", 18);
const BUDGET_MS = numArg("--budget-ms", 50);
const DPR = numArg("--dpr", 2);
const BEFORE_DIR = argOf("--before-dir", null);

const LERC_FIXTURE = readFileSync(fileURLToPath(new URL("../test/fixtures/dep-katy-528x528.lerc", import.meta.url)));

// Real fetch+worker totals from this session's terrain-tile-timing evidence (band 12/15/18), so
// the staggered delay this harness injects is drawn from measured production numbers, not guessed.
const TILE_DELAY_MS_POOL = [2510, 2110, 5540, 2510, 1762, 1416, 4404, 3302];

const TILE_SPAN_FT = TILE_CELLS * bandCellMeters(ZOOM) * groundScale(ORIGIN.lat) * M_TO_FT;
const STEP_FT = TILE_SPAN_FT * 0.9; // a large jump per step — genuinely new tiles almost every time

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

async function startPreview(outDir, port) {
  const child = spawn("npx", ["vite", "preview", "--outDir", outDir, "--port", String(port), "--strictPort"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://localhost:${port}/`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite preview (${outDir}) did not come up in 20s`)), 20000);
    const onData = (buf) => { if (/Local:|localhost/.test(String(buf))) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => { if (code) { clearTimeout(timer); reject(new Error(`vite preview (${outDir}) exited ${code}`)); } });
  });
  return { child, base };
}

async function centerOn(page, fx, fy, ppf) {
  return page.evaluate(({ fx, fy, ppf }) => { const v = window.__plannerView; if (v) v.centerOn(fx, fy, ppf); }, { fx, fy, ppf });
}

async function measure(base, label) {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--ignore-certificate-errors", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
  await context.addInitScript(() => { window.__PLANYR_E2E = true; });
  // A real PerformanceObserver, installed before any app code runs — the SAME API this session's
  // brief's telemetry uses (longtask), no LoAF-only browser-support gap. Reports every task over
  // 50ms on the main thread, so it sees the cost regardless of which callback shape produced it.
  await context.addInitScript(() => {
    window.__ltAll = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__ltAll.push(e.duration); })
        .observe({ type: "longtask", buffered: true });
    } catch (_) { /* browser has no longtask support — the harness reports that honestly below */ }
  });
  const seed = { ...perfScenarioSite(), layerOverrides: { contours: true } };
  await context.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
      localStorage.setItem("planarfit:currentSite:v1", s.id);
    } catch (_) { /* ignore */ }
  }, seed);

  let tileReqs = 0;
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    if (u.includes("exportImage") && u.includes("3DEPElevation")) {
      const delay = TILE_DELAY_MS_POOL[tileReqs % TILE_DELAY_MS_POOL.length];
      tileReqs++;
      // STAGGERED arrival — the real reported shape ("a burst of tiles is the trigger, not one
      // slow tile"): several fetches in flight, resolving close together but not simultaneously.
      return setTimeout(() => {
        route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: LERC_FIXTURE });
      }, delay);
    }
    return route.abort();
  });

  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await assertMeasurable(page, "verify-contour-paint-budget");

  const ppf = zoomToPpf(ZOOM, ORIGIN.lat);
  await centerOn(page, 0, 0, ppf);
  await page.waitForTimeout(2500); // let the first (cold) tile land before the burst starts

  // The BURST: several pan steps fired close together (300ms apart — a fast real pan/zoom
  // sequence), never waiting for the previous step's tiles to fully resolve first. Every step
  // moves far enough to require a mostly-new lattice cover, so each one queues its own fetches —
  // which then land staggered over the next several seconds, exactly like the real evidence.
  let fx = 0, fy = 0;
  for (let i = 0; i < STEPS; i++) {
    fx += STEP_FT;
    if (i % 2 === 1) fy += STEP_FT * 0.3;
    await centerOn(page, fx, fy, ppf);
    await page.waitForTimeout(300);
  }
  // Give every staggered tile fetch (up to the slowest injected delay) time to land and paint.
  await page.waitForTimeout(Math.max(...TILE_DELAY_MS_POOL) + 1500);

  const longTasks = await page.evaluate(() => window.__ltAll || []);
  const supported = await page.evaluate(() => {
    try { return "PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes.includes("longtask"); }
    catch (_) { return false; }
  });

  await context.close();
  await browser.close();
  const maxMs = longTasks.length ? Math.max(...longTasks) : 0;
  const overBudget = longTasks.filter((d) => d > BUDGET_MS);
  return { label, base, tileReqs, longTaskCount: longTasks.length, longTasks, maxMs, overBudgetCount: overBudget.length, supported };
}

async function main() {
  const afterPort = await findFreePort();
  process.stderr.write(`  · tile span ${TILE_SPAN_FT.toFixed(0)} ft at zoom ${ZOOM} · ${STEPS} burst steps, 300ms apart · budget ${BUDGET_MS}ms\n`);
  const after = await startPreview("dist", afterPort);
  let before = null;
  try {
    process.stderr.write("  · measuring the CURRENT build (with the round-5 time-sliced paint fix) …\n");
    const afterResult = await measure(after.base, "current");
    if (!afterResult.supported) {
      process.stderr.write("  ⚠ this Chromium build has no PerformanceObserver longtask support — refusing to score.\n");
    }

    let beforeResult = null;
    if (BEFORE_DIR && existsSync(BEFORE_DIR)) {
      const beforePort = await findFreePort();
      before = await startPreview(BEFORE_DIR, beforePort);
      process.stderr.write(`  · measuring BEFORE (${BEFORE_DIR}, pre-round-5) …\n`);
      beforeResult = await measure(before.base, "before (pre-round-5)");
    }

    const report = { regime: { steps: STEPS, zoom: ZOOM, budgetMs: BUDGET_MS, tileDelayPoolMs: TILE_DELAY_MS_POOL }, after: afterResult, before: beforeResult };
    if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }

    const L = (s = "") => console.log(s);
    L("");
    L("CONTOUR PAINT — WORST SINGLE MAIN-THREAD LONG TASK DURING A TILE-ARRIVAL BURST");
    L(`  ${STEPS} pan steps fired 300ms apart · tiles served with staggered ${Math.min(...TILE_DELAY_MS_POOL)}–${Math.max(...TILE_DELAY_MS_POOL)}ms delay (real terrain-tile-timing values)`);
    L(`  budget: no single long task over ${BUDGET_MS}ms`);
    L("");
    if (!afterResult.tileReqs) {
      L("  ⚠ NO exportImage requests were served — contours never rendered, this run proves nothing.");
    } else {
      L(`  CURRENT   tiles served ${afterResult.tileReqs} · long tasks ${afterResult.longTaskCount} · worst ${afterResult.maxMs.toFixed(1)}ms · over budget ${afterResult.overBudgetCount}`);
      if (beforeResult) L(`  BEFORE    tiles served ${beforeResult.tileReqs} · long tasks ${beforeResult.longTaskCount} · worst ${beforeResult.maxMs.toFixed(1)}ms · over budget ${beforeResult.overBudgetCount}`);
      L("");
      L(afterResult.maxMs <= BUDGET_MS ? `  ✅ PASS — worst observed task (${afterResult.maxMs.toFixed(1)}ms) is within the ${BUDGET_MS}ms budget.`
        : `  ❌ still over budget — worst observed task ${afterResult.maxMs.toFixed(1)}ms.`);
      if (beforeResult) {
        L(beforeResult.maxMs > BUDGET_MS
          ? `  RED confirmed on the pre-fix build — worst task ${beforeResult.maxMs.toFixed(1)}ms, ${(beforeResult.maxMs / BUDGET_MS).toFixed(1)}x the budget.`
          : `  (the pre-fix build did not exceed budget in this run — burst pattern may need tuning to reproduce it here)`);
      }
    }
    L("");
    L("  ⚠ Every exportImage request in this run is answered with the SAME real captured tile"
      + " (test/fixtures/dep-katy-528x528.lerc) at a staggered artificial delay — a timing measurement, not a geographic one.");
  } finally {
    after.child.kill();
    if (before) before.child.kill();
  }
}

await main();
