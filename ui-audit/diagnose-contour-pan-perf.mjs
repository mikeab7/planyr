#!/usr/bin/env node
/* diagnose-contour-pan-perf — the owner's report: "the contours thing seems to make my computer
 * lag" (NEW-1, this session's brief).
 *
 * WHAT THIS MEASURES. The Contour lines layer paints from a Web Worker (LERC decode + marching
 * squares + tracing all happen off the main thread), so the suspect is the PAINT half: every
 * `moveend` that shifts the visible lattice-tile set used to `clearLayers()` and rebuild EVERY
 * contour polyline and label currently on screen — not just the ones the moved-into tile added —
 * projecting thousands of vertices and tearing down/recreating dozens of DOM-backed label markers
 * on nearly every pan step at working (1-ft) zoom. This harness drives a real continuous pan
 * (never revisiting ground) against TWO real builds — a `dist-before` built from the pre-fix
 * source and the fixed `dist` — and reports CDP `Performance.getMetrics` deltas (script + layout +
 * style-recalc ms, the same metric `diagnose-pond-pan.mjs` uses) per pan step, median across
 * several steps, discarding warm-up.
 *
 * ⛔ THE PAN STEP SIZE IS COMPUTED FROM THE LATTICE, NOT GUESSED IN SCREEN PIXELS. A lattice tile's
 * interior always spans `TILE_CELLS * CELL_PX` = 1024 CSS px on screen at ITS OWN band, whatever
 * the band — but a raw mouse-drag distance in CSS px turned out to move MUCH more ground than that
 * per step (measured: a 300px drag replaced essentially the WHOLE visible tile set every time,
 * `tilesServed` scaling with total steps rather than with genuinely new fringe territory), so the
 * before/after comparison was measuring "every tile is new" on both sides — the one case where
 * incremental reuse and full rebuild cost the SAME, because there is nothing to reuse. The fix:
 * drive the pan PROGRAMMATICALLY through `window.__plannerView.centerOn(fx, fy, ppf)` (the same
 * E2E hook `diagnose-pond-pan.mjs` uses to reposition between probes) by a FEET delta computed as a
 * fraction of the tile's real ground span (`TILE_CELLS * bandCellMeters(zoom) * groundScale(lat)`,
 * converted to feet) — so "how much of the view is genuinely new" is a stated, checked fraction
 * rather than an assumption, and `--overlap-frac` controls it directly. This still drives the
 * exact `moveend` → `refresh()` → `paint()` path a real drag would (`centerOn` sets `view.offX/
 * offY/ppf`, the same state a mouse drag changes, which is what the backdrop map's commit and
 * `moveend` key off) — it is the SIGNAL under test that is driven precisely, not the input device.
 *
 * REAL DATA, NOT SYNTHETIC. Every `elevation.nationalmap.gov` request from Chromium in this
 * sandbox is `ERR_CONNECTION_RESET` (confirmed again this session — Node `fetch` reaches the host,
 * Playwright's Chromium does not), so the exportImage requests are intercepted and answered with
 * a REAL captured LERC tile — never a fabricated grid.
 *
 * ⛔ B800849 (perf) — THE FIXTURE MUST BE THE REQUEST'S OWN SIZE, NOT MERELY "REAL BYTES", OR
 * NOTHING EVER PAINTS. This harness originally served `test/fixtures/dep-katy-463x400.lerc`
 * (463×400) for every request, but a lattice tile ALWAYS asks for `TILE_CELLS + 2*MARGIN_CELLS`
 * = 528×528 px (`demGrid.js`'s `latticeTile`) — and `decodeGrid()` in `lercGrid.js` LOUDLY refuses
 * a decoded grid whose dimensions don't match what was asked (`grid size mismatch: got 463x400,
 * asked 528x528` — the correct LOUD-FAILURE behavior; a silently-resized export would georeference
 * wrong everywhere). So the ORIGINAL fixture made EVERY tile fetch in this harness reject at
 * decode time, on both the "before" and "after" build: `parts` stayed empty, `composeContourPaint`
 * was never called with real geometry, and nothing was ever written to `gisCache` — the harness
 * was silently measuring the cost of a layer that fails to paint, not the paint it exists to time.
 * (This is also what the B800850 investigation chased as a suspected re-fetch bug — with every
 * fetch rejecting, of course the next moveend "re-fetches"; there was never anything to cache.
 * See BACKLOG.md B800850 for the full reproduction once this was found and fixed.)
 * `test/fixtures/dep-katy-528x528.lerc` is the fix: the SAME real captured USGS 3DEP elevation
 * values from `dep-katy-463x400.lerc`, edge-padded out to the true 528×528 tile size (`np.pad`,
 * `mode="edge"` — the margin is real data extended flat, never fabricated noise) and re-encoded
 * with Esri's `lerc` codec at `lerc_encodeForVersion(..., codecVersion=2)` (the oldest codec
 * sub-version the C library supports encoding, chosen because the app's `lerc` npm dependency
 * — an older LERC2 reader — throws "invalid mask" on the newer sub-versions the default encoder
 * path produces; version 2 round-trips cleanly through the app's own `decodeGrid()`). Regenerate
 * with `python3 scripts/gen-terrain-pan-fixture.py` (needs `pip3 install lerc numpy`) if the
 * tile geometry constants ever change; that script verifies the round-trip itself before writing.
 * Decoded values match the original fixture to within its own `maxZErrorUsed` (~1e-4 ft)
 * everywhere the two overlap.
 *
 * The same bytes answer every tile request — real elevation values, but the same ground repeated
 * under every ground tile's coordinates; that is fine for a TIMING measurement (the decode + trace
 * + paint cost is what's under test, not geographic correctness), and it is loudly stated so
 * nobody mistakes this for a correctness check.
 *
 * USAGE
 *   1. Build both trees first (see the PR / commit this ships with for the exact commands):
 *        git stash && npx vite build --outDir dist-before && git stash pop && npm run build
 *   2. node ui-audit/diagnose-contour-pan-perf.mjs
 *   3. ... --steps 14              # pan steps per run (default 14)
 *   4. ... --zoom 18               # Leaflet zoom to probe at (default 18, past TERRAIN_MIN_ZOOM=16)
 *   5. ... --overlap-frac 0.22     # ground shift per step, as a fraction of one tile's span
 *   6. ... --json
 *
 * Never exits non-zero on a measurement — it is an instrument, not a gate.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { perfScenarioSite, ORIGIN } from "./lib/perf-scenario.mjs";
import { zoomToPpf } from "../src/workspaces/site-planner/lib/mapLock.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { TILE_CELLS, bandCellMeters, groundScale } from "../src/workspaces/site-planner/lib/demGrid.js";

const M_TO_FT = 3.280839895; // US survey-adjacent enough for a step-size calibration, not a placed measurement

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const numArg = (f, d) => { const v = Number(argOf(f, NaN)); return Number.isFinite(v) && v > 0 ? v : d; };

const STEPS = numArg("--steps", 14);
const WARMUP = numArg("--warmup", 3);
const ZOOM = numArg("--zoom", 18);
const OVERLAP_FRAC = numArg("--overlap-frac", 0.22); // ground shift per step, as a fraction of one tile span
const DPR = numArg("--dpr", 2);

const LERC_FIXTURE = readFileSync(fileURLToPath(new URL("../test/fixtures/dep-katy-528x528.lerc", import.meta.url)));

// The real ground span of ONE lattice tile at ZOOM, at the reference plan's own latitude —
// the same derivation `coarseNote()` in terrainLayers.js uses for its honesty line.
const TILE_SPAN_FT = TILE_CELLS * bandCellMeters(ZOOM) * groundScale(ORIGIN.lat) * M_TO_FT;
const STEP_FT = TILE_SPAN_FT * OVERLAP_FRAC;

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

const readView = `(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: +s.getAttribute("data-view-offx"), offY: +s.getAttribute("data-view-offy"), ppf: +s.getAttribute("data-view-ppf") } : null;
})()`;

/* Read the view, then park the camera at plan-feet (fx, fy) at the given ppf — the same
 * `centerOn` hook `diagnose-pond-pan.mjs` uses. */
async function centerOn(page, fx, fy, ppf) {
  return page.evaluate(({ fx, fy, ppf }) => {
    const v = window.__plannerView;
    if (!v) return null;
    const { w, h } = v.get();
    v.centerOn(fx, fy, ppf);
    return { w, h };
  }, { fx, fy, ppf });
}

async function workMetrics(cdp) {
  const m = await cdp.send("Performance.getMetrics");
  const g = {};
  for (const { name, value } of m.metrics || []) g[name] = value;
  return { scriptMs: (g.ScriptDuration || 0) * 1000, layoutMs: (g.LayoutDuration || 0) * 1000, recalcMs: (g.RecalcStyleDuration || 0) * 1000 };
}
const subWork = (a, b) => +((b.scriptMs - a.scriptMs) + (b.layoutMs - a.layoutMs) + (b.recalcMs - a.recalcMs)).toFixed(2);

const COUNTERS = `(() => ({
  documentNodes: document.getElementsByTagName("*").length,
  contourLabels: document.querySelectorAll(".leaflet-marker-icon").length,
}))()`;

const GEO_MAP_STATE = `(() => {
  const m = window.__geoMap;
  if (!m) return null;
  const c = m.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
})()`;

function median(arr) {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/* ONE continuous pan step: move the camera STEP_FT further along a fixed heading (never
 * revisiting ground). Programmatic, not a mouse drag — see the module header for why: it drives
 * the exact `moveend` → `refresh()` → `paint()` path a drag would, with the ground shift stated
 * and checked rather than assumed from a screen-pixel distance. */
async function panStep(page, cdp, fx, fy, ppf) {
  const w0 = await workMetrics(cdp);
  const c0 = await page.evaluate(COUNTERS);
  const v0 = await page.evaluate(readView);
  await centerOn(page, fx, fy, ppf);
  // 160ms is the app's own geo-commit debounce (SitePlanner.jsx) before the slaved Leaflet
  // backdrop's view — and therefore its moveend — actually updates; give it real headroom.
  await page.waitForTimeout(450);
  const w1 = await workMetrics(cdp);
  const c1 = await page.evaluate(COUNTERS);
  const v1 = await page.evaluate(readView);
  const moved = !!(v0 && v1 && (v0.offX !== v1.offX || v0.offY !== v1.offY));
  return { workMs: subWork(w0, w1), moved, documentNodeDelta: c1.documentNodes - c0.documentNodes };
}

async function measure(base, label) {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--ignore-certificate-errors", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
  await context.addInitScript(() => { window.__PLANYR_E2E = true; });
  const seed = { ...perfScenarioSite(), layerOverrides: { contours: true } };
  await context.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
      localStorage.setItem("planarfit:currentSite:v1", s.id);
    } catch (_) { /* ignore */ }
  }, seed);

  let tilesServed = 0;
  let currentStep = -1;
  const bboxSeen = new Map(); // bbox string -> times requested — a real cache hit never re-requests
  const bboxLog = [];
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    // The real captured 3DEP tile — never a fabricated grid — for every exportImage request,
    // proxied or direct (matches both `proxyServiceUrl(DEP_URL)` and the bare DEP_URL fallback).
    if (u.includes("exportImage") && u.includes("3DEPElevation")) {
      const bbox = (u.match(/bbox=([^&]+)/) || [])[1] || u;
      bboxSeen.set(bbox, (bboxSeen.get(bbox) || 0) + 1);
      bboxLog.push({ step: currentStep, bbox });
      tilesServed++;
      return route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: LERC_FIXTURE });
    }
    return route.abort();
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  await page.goto(base, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await assertMeasurable(page, "diagnose-contour-pan-perf");

  const ppf = zoomToPpf(ZOOM, ORIGIN.lat);
  await centerOn(page, 0, 0, ppf); // the plan's own origin — plan feet (0,0)
  await page.waitForTimeout(600);
  // Let the first (cold) fetch/decode/trace/paint land before any pan step is measured — that
  // one-time cost is boot/zoom-in cost, not pan cost, and must not contaminate the per-step median.
  await page.waitForTimeout(2500);
  const settled = await page.evaluate(COUNTERS);

  const steps = [];
  let fx = 0, fy = 0;
  for (let i = 0; i < WARMUP + STEPS; i++) {
    fx += STEP_FT;
    if (i % 3 === 2) fy += STEP_FT * 0.4; // a gentle diagonal wobble — still monotonic, never revisits
    const before = tilesServed;
    currentStep = i;
    const r = await panStep(page, cdp, fx, fy, ppf);
    if (process.env.CONTOUR_DEBUG) {
      const geo = await page.evaluate(GEO_MAP_STATE);
      process.stderr.write(`      [debug] step ${i} (${i < WARMUP ? "warmup" : "measured"}): fx=${fx.toFixed(0)} fy=${fy.toFixed(0)} +${tilesServed - before} tile fetches, workMs=${r.workMs}, geoMap=${geo ? `${geo.lat.toFixed(6)},${geo.lng.toFixed(6)} z${geo.zoom.toFixed(3)}` : "none"}\n`);
    }
    if (i >= WARMUP) steps.push(r);
  }

  await context.close();
  await browser.close();
  if (process.env.CONTOUR_DEBUG) {
    // Short IDs so the sequence reads at a glance; the SAME short id across steps is the SAME bbox.
    const ids = new Map();
    const shortId = (b) => { if (!ids.has(b)) ids.set(b, String.fromCharCode(65 + ids.size)); return ids.get(b); };
    const byStep = new Map();
    for (const { step, bbox } of bboxLog) { if (!byStep.has(step)) byStep.set(step, []); byStep.get(step).push(shortId(bbox)); }
    process.stderr.write(`      [debug] bbox sequence per step (same letter = same ground tile):\n`);
    for (const [step, arr] of [...byStep.entries()].sort((a, b) => a[0] - b[0])) {
      process.stderr.write(`        step ${step}: ${arr.join(",")}\n`);
    }
  }
  const movedCount = steps.filter((s) => s.moved).length;
  return {
    label, base, tilesServed, uniqueTiles: bboxSeen.size, repeatFetches: [...bboxSeen.values()].filter((n) => n > 1).length,
    contourLabelsAtRest: settled.contourLabels,
    steps, movedCount, totalSteps: steps.length,
    workMsMedian: median(steps.map((s) => s.workMs)),
    workMsAll: steps.map((s) => s.workMs),
    documentNodeDeltaMedian: median(steps.map((s) => s.documentNodeDelta)),
  };
}

async function main() {
  const beforePort = await findFreePort();
  const afterPort = await findFreePort();
  process.stderr.write(`  · tile span ${TILE_SPAN_FT.toFixed(0)} ft at zoom ${ZOOM} · step ${STEP_FT.toFixed(0)} ft (${(OVERLAP_FRAC * 100).toFixed(0)}% of one tile)\n`);
  process.stderr.write(`  · starting preview servers (before :${beforePort}, after :${afterPort}) …\n`);
  const before = await startPreview("dist-before", beforePort);
  const after = await startPreview("dist", afterPort);
  try {
    process.stderr.write("  · measuring BEFORE (pre-fix: clearLayers()+rebuild every moveend) …\n");
    const beforeResult = await measure(before.base, "before (pre-fix)");
    process.stderr.write(`      tiles served: ${beforeResult.tilesServed} (${beforeResult.uniqueTiles} unique bbox, ${beforeResult.repeatFetches} re-fetched) · labels at rest: ${beforeResult.contourLabelsAtRest} · moved ${beforeResult.movedCount}/${beforeResult.totalSteps} · median work/step: ${beforeResult.workMsMedian ?? "—"} ms\n`);
    process.stderr.write("  · measuring AFTER (incremental per-key repaint) …\n");
    const afterResult = await measure(after.base, "after (this fix)");
    process.stderr.write(`      tiles served: ${afterResult.tilesServed} (${afterResult.uniqueTiles} unique bbox, ${afterResult.repeatFetches} re-fetched) · labels at rest: ${afterResult.contourLabelsAtRest} · moved ${afterResult.movedCount}/${afterResult.totalSteps} · median work/step: ${afterResult.workMsMedian ?? "—"} ms\n`);

    const report = {
      regime: { steps: STEPS, warmup: WARMUP, zoom: ZOOM, overlapFrac: OVERLAP_FRAC, tileSpanFt: TILE_SPAN_FT, stepFt: STEP_FT, dpr: DPR },
      before: beforeResult, after: afterResult,
    };
    if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }

    const L = (s = "") => console.log(s);
    L("");
    L("CONTOUR LINES — PAN COST, BEFORE vs AFTER (real captured 3DEP tile, real builds)");
    L(`  zoom ${ZOOM} (ppf ${zoomToPpf(ZOOM, ORIGIN.lat).toFixed(4)}) · ${STEPS} measured pan steps (+${WARMUP} discarded warm-up)`);
    L(`  step size: ${STEP_FT.toFixed(0)} ft = ${(OVERLAP_FRAC * 100).toFixed(0)}% of one lattice tile's ${TILE_SPAN_FT.toFixed(0)}ft span, never revisiting ground`);
    L(`  cost metric: script + layout + style-recalc ms per pan step (CDP Performance.getMetrics deltas)`);
    L(`  view actually moved: BEFORE ${beforeResult.movedCount}/${beforeResult.totalSteps} steps · AFTER ${afterResult.movedCount}/${afterResult.totalSteps} steps`);
    L(`  exportImage requests served (whole session): BEFORE ${beforeResult.tilesServed} · AFTER ${afterResult.tilesServed}`);
    L("");
    if (!beforeResult.tilesServed || !afterResult.tilesServed) {
      L("  ⚠ NO exportImage requests were served on one side — contours never rendered, and this run proves nothing. Refusing to score it.");
    } else if (!beforeResult.contourLabelsAtRest || !afterResult.contourLabelsAtRest) {
      L("  ⚠ contours mounted but painted no labels on one side — refusing to score a run that never actually drew contours.");
    } else if (!beforeResult.movedCount || !afterResult.movedCount) {
      L("  ⚠ the view never actually moved on one side — refusing to score a run that measured something other than a pan.");
    } else {
      L(`  BEFORE   median ${beforeResult.workMsMedian} ms/step   (${beforeResult.workMsAll.join(", ")})`);
      L(`  AFTER    median ${afterResult.workMsMedian} ms/step   (${afterResult.workMsAll.join(", ")})`);
      const pct = beforeResult.workMsMedian ? (((afterResult.workMsMedian - beforeResult.workMsMedian) / beforeResult.workMsMedian) * 100).toFixed(1) : null;
      L(`  DELTA    ${pct != null ? `${pct}%` : "—"}`);
      L("");
      L(`  document-node churn per step (median) — BEFORE ${beforeResult.documentNodeDeltaMedian} · AFTER ${afterResult.documentNodeDeltaMedian}`);
    }
    L("");
    L("  ⚠ Both builds intercept every exportImage request with the SAME real captured tile"
      + " (test/fixtures/dep-katy-528x528.lerc) — a timing measurement, not a geographic one.");
  } finally {
    before.child.kill();
    after.child.kill();
  }
}

await main();
