#!/usr/bin/env node
/* diagnose-aerial-reanchor-block — confirm or kill the SURVIVING CANDIDATE from the owner's real
 * perf capture (build 396be34, plan smt7q6ar8egz "Concept A"/Richfield, 2026-08-29): switching to
 * (or opening) a plan whose aerial is NOT already anchored blocks the main thread ~6.5s across five
 * long-animation-frame blocks (428/512/550/591/606 ms) while tile layers come up (2 -> 4) and
 * retained tiles jump 90 -> 257, all five attributed to invoker "FrameRequestCallback" with an
 * empty sourceFunctionName — an ANONYMOUS function Leaflet itself scheduled via
 * `Util.requestAnimFrame`, never React's MessageChannel-driven scheduler.
 *
 * ⛔ ALREADY RULED OUT (do not re-test): element mount alone, a warm plan switch (both plans'
 * aerials already anchored), contours/terrain (no terrain-tile-timing event in the episode), and a
 * leaking tile cache (257 is under the retained cap). See BACKLOG.md B854832 for the full brief.
 *
 * WHAT THIS MEASURES, and why it is a SWITCH rather than a cold navigation: opening plan A first,
 * letting it fully settle (so app boot + first-mount long tasks are absorbed BEFORE the LoAF buffer
 * is reset), THEN switching to plan B (a different origin — Richfield, B802400's own reference, 106
 * real features — so its tile grid has never been fetched in this session, i.e. genuinely
 * unanchored) isolates the SWITCH's own cost from ordinary page-boot cost, matching the same
 * methodology the "already ruled out" arms used (comparing a warm A<->B switch). Tile requests are
 * fulfilled by `fakeTile.mjs` (a real decodable PNG per tile — this sandbox cannot reach the real
 * Esri/USGS hosts) with STAGGERED latency, because an instant-responding fake tile server collapses
 * what should be a multi-second burst of `_tileReady` firings into a handful of milliseconds and
 * cannot exercise the "many tiles resolving close together" mechanism at all.
 *
 *   node ui-audit/diagnose-aerial-reanchor-block.mjs [--dpr 2.15] [--latency 60-260] [--json]
 */
import { chromium } from "playwright";
import { fixtureSite } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { perfScenarioSite, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TARGET_ID = "diag-richfield-unanchored";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const DPR = Number(arg("dpr", "2.15"));
const JSON_OUT = process.argv.includes("--json");
const WATCH_MS = Number(arg("watch", "12000"));
const [LAT_MIN, LAT_MAX] = String(arg("latency", "60-260")).split("-").map(Number);

// Richfield, WITHOUT its PDF sheet-overlay raster — that raster's re-raster cost is a separate,
// already-diagnosed mechanism (B251136/B251137). Keeping it would conflate two different sources of
// main-thread cost; this run isolates the AERIAL TILE LAYER mechanism only.
const richfieldFixture = readFixture("richfield");
const richfieldNoOverlay = { ...richfieldFixture, rasters: (richfieldFixture.rasters || []).filter((r) => r.role !== "sheetOverlay") };

const siteA = perfScenarioSite(); // Goose Creek — real origin, real elements, opened first so it settles
const siteB = fixtureSite(richfieldNoOverlay, { id: TARGET_ID }); // switched TO — its tile grid has never been fetched this session

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [siteA.id]: siteA, [siteB.id]: siteB }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(siteA.id)});
} catch (e) {} })();`;

let seq = 0;
const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--no-sandbox"] });
// The owner's own capture: viewport 1600x521, dpr 2.15.
const ctx = await browser.newContext({ viewport: { width: 1600, height: 521 }, deviceScaleFactor: DPR });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
// Install the SAME observer production uses (perfRecorder.js `observeTasks`), before any app script
// runs, so nothing the app does can race the observer's own installation.
await ctx.addInitScript(() => {
  window.__loaf = [];
  window.__loafOk = false;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration);
        const top = scripts[0];
        window.__loaf.push({
          start: +e.startTime.toFixed(1),
          dur: +e.duration.toFixed(1),
          blocking: +(e.blockingDuration || 0).toFixed(1),
          topName: top ? (top.sourceFunctionName || top.invoker || top.sourceURL || "") : "",
          topInvoker: top ? (top.invoker || "") : "",
          topInvokerType: top ? (top.invokerType || "") : "",
          scriptCount: scripts.length,
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
    window.__loafOk = true;
  } catch (_) { /* reported honestly below */ }
});
await ctx.route(/^https?:\/\//, async (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  const t = parseTileUrl(u);
  if (t) {
    // Staggered latency — real tiles resolve over a spread, not all at once, which is what makes
    // many `_tileReady` firings land close together rather than as one instant batch.
    const delay = LAT_MIN + Math.floor((++seq * 2654435761) % 1000) / 1000 * (LAT_MAX - LAT_MIN);
    await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: fakeTilePng(t.z, t.x, t.y) });
  }
  return route.abort();
});

const page = await ctx.newPage();
await assertMeasurable(page, "diagnose-aerial-reanchor-block");

const loafSupported = await page.evaluate(() => {
  try { return "PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes.includes("long-animation-frame"); }
  catch (_) { return false; }
});
if (!loafSupported) {
  console.error("⚠ this Chromium build has no long-animation-frame support — refusing to score.");
  await browser.close();
  process.exit(2);
}

/* el-tier: this diagnostic is about the ELEMENT-MOUNT axis specifically (isolating it from the
 * tile-layer axis is the whole point — see the file header), not a census of plan contents. */
const countersScript = () => ({
  els: document.querySelectorAll("[data-el-id]").length,
  tiles: document.querySelectorAll("img.leaflet-tile").length,
  domNodes: document.getElementsByTagName("*").length,
});

// Boot on plan A and let it FULLY settle — this absorbs page-boot and first-mount long tasks
// before anything is measured, exactly the arm the "already ruled out" comparison needs.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
await pacedWait(page, 4000);
const beforeSwitch = await page.evaluate(countersScript);

// ⛔ THE COUNT, not just the clock. LoAF timing is noisy across runs in this sandbox (real
// network jitter isn't reproducible, and this VM's CPU is not the owner's), so alongside wall
// time this also counts how many times Leaflet's own O(retained-tiles) `_pruneTiles` algorithm
// actually RUNS during the switch — the repo's own established idiom for this class of question
// (B236592/B221763: "count invocations, not milliseconds"). Patched on the SHARED PROTOTYPE via
// plan A's already-existing tile layer, before plan B's layers are constructed, so it counts the
// real underlying algorithm regardless of whether `throttleTilePruning` is wrapping it on top.
const pruneProbeOk = await page.evaluate(() => {
  try {
    const map = window.__geoMap;
    const tileLayer = Object.values(map._layers || {}).find((l) => l && l._tiles && typeof l._pruneTiles === "function");
    if (!tileLayer) return false;
    const proto = Object.getPrototypeOf(tileLayer);
    const trueOrig = proto._pruneTiles;
    window.__pruneCalls = 0;
    proto._pruneTiles = function (...a) { window.__pruneCalls++; return trueOrig.apply(this, a); };
    return true;
  } catch (_) { return false; }
});

// Reset the LoAF buffer so only the SWITCH's own cost is measured.
await page.evaluate(() => { window.__loaf.length = 0; });

const t0 = Date.now();
await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, siteB.groupId);
await pacedWait(page, WATCH_MS);
const wallMs = Date.now() - t0;
const afterSwitch = await page.evaluate(countersScript);

const loaf = await page.evaluate(() => window.__loaf.slice());
const pruneCalls = await page.evaluate(() => window.__pruneCalls ?? null);
const totalMs = loaf.reduce((s, e) => s + e.dur, 0);
const totalBlockingMs = loaf.reduce((s, e) => s + e.blocking, 0);
const worst = loaf.slice().sort((a, b) => b.dur - a.dur).slice(0, 8);
const byInvoker = {};
for (const e of loaf) { const k = e.topInvoker || "(none)"; byInvoker[k] = (byInvoker[k] || 0) + 1; }

const result = {
  dpr: DPR, latency: [LAT_MIN, LAT_MAX], wallMs,
  beforeSwitch, afterSwitch,
  tileGrowth: afterSwitch.tiles - beforeSwitch.tiles,
  pruneProbeOk, pruneCalls,
  entryCount: loaf.length,
  totalMs: +totalMs.toFixed(1),
  totalBlockingMs: +totalBlockingMs.toFixed(1),
  worst,
  byInvoker,
};

console.log(JSON.stringify(result, null, 2));
if (!JSON_OUT) {
  process.stderr.write(`\n  before switch (plan A settled): els=${beforeSwitch.els} tiles=${beforeSwitch.tiles} dom=${beforeSwitch.domNodes}\n`);
  process.stderr.write(`  after switch + ${WATCH_MS}ms watch (plan B): els=${afterSwitch.els} tiles=${afterSwitch.tiles} dom=${afterSwitch.domNodes}\n`);
  process.stderr.write(`  _pruneTiles REAL invocations during the switch: ${pruneProbeOk ? pruneCalls : "PROBE FAILED — no tile layer found on plan A"} (tiles grew by ${afterSwitch.tiles - beforeSwitch.tiles})\n`);
  process.stderr.write(`  ${loaf.length} long-animation-frame entries during the SWITCH, total ${totalMs.toFixed(0)}ms (blocking ${totalBlockingMs.toFixed(0)}ms)\n`);
  process.stderr.write(`  worst blocks:\n`);
  for (const e of worst) process.stderr.write(`    t=${e.start}ms  dur=${e.dur}ms  blocking=${e.blocking}ms  invoker="${e.topInvoker}"  name="${e.topName}"  scripts=${e.scriptCount}\n`);
  process.stderr.write(`  by invoker: ${JSON.stringify(byInvoker)}\n`);
}
await browser.close();
