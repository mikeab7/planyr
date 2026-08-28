/* B834580 — the real before/after long-task number for the map route's saved-site plan rebuild,
 * the same class B802400 round 5 measured for the contour layer (terrainLayers.js's
 * `verify-contour-paint-budget.mjs`).
 *
 * `verify-map-plan-render.mjs` seeds 5 sites at the task's own measured production counts (156,
 * 156, 138, 116, 115 — 778 elements total) and reproduces every rendering defect against that
 * fixture, but at exactly that count this FAST HEADLESS sandbox never crosses the browser's
 * ~50ms long-task threshold at all — max single-frame gap 33.4ms even on the unfixed synchronous
 * code. That's an honest property of this environment (no real display, no concurrent GIS/tile
 * decode competing for the frame, presumably faster than the hardware the report was filed from),
 * not evidence the mechanism doesn't matter: `MapFinder.jsx`'s `showPlans` effect used to build a
 * new EMPTY `L.layerGroup()`, add every polygon to it OFF-MAP, then call `group.addTo(map)` once —
 * which makes Leaflet's `LayerGroup.onAdd` add (and synchronously `_project`) every child in ONE
 * uninterrupted loop, so the blocking cost scales with total element count regardless of hardware.
 *
 * This script proves that scaling by measuring at 10 sites x 300 = 3,000 elements — a deliberate
 * STRESS multiple of the reported counts, run specifically to produce an observable number in
 * this sandbox — and requires the SAME build to be served twice: once at the pre-fix commit, once
 * after. Recorded results (2026-08-28, this sandbox, Chromium headless):
 *
 *   PRE-FIX  (group built off-map, `group.addTo(map)` once):  1 long task, 88.0ms · max frame gap 83.3ms
 *   POST-FIX (`runBudgeted` time-slicing via paintSchedule.js): 0 long tasks       · max frame gap 50.0ms
 *
 * Run:  npm run build && npx vite preview --port 4183   (separate shell)
 *       BASE_URL=http://localhost:4183/ node ui-audit/diagnose-map-plan-zoom-cost.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4183/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITES = process.env.STRESS_SITES ? +process.env.STRESS_SITES : 10;
const ELS_PER_SITE = process.env.STRESS_ELS ? +process.env.STRESS_ELS : 300;

const now = Date.now();
const rectEl = (id, cx, cy, w, h, type) => ({ id, type, cx, cy, w, h, rot: 0, z: 0 });
function genGrid(siteId, count, cellFt = 60, sizeFt = 40) {
  const cols = Math.ceil(Math.sqrt(count * 1.1));
  const types = ["building", "parking", "paving"];
  const els = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    els.push(rectEl(`${siteId}e${i}`, col * cellFt, row * cellFt, sizeFt, sizeFt * 0.6, types[i % types.length]));
  }
  return { els, cols, rows: Math.ceil(count / cols) };
}
const sq = (w, h) => [{ x: -40, y: -40 }, { x: w + 40, y: -40 }, { x: w + 40, y: h + 40 }, { x: -40, y: h + 40 }];
let n = 0;
function site(lat, lon, name, elCount) {
  const id = `stress${++n}`;
  const { els, cols, rows } = genGrid(id, elCount);
  const w = cols * 60, h = rows * 60;
  return [id, {
    id, groupId: id, site: name, name: "Concept A", origin: { lat, lon }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(w, h) }], els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status: "active", updatedAt: now - n * 1000,
  }];
}
const S = Array.from({ length: SITES }, (_, i) =>
  site(29.760 + (i % 5) * 0.0015, -95.370 + Math.floor(i / 5) * 0.0018, `Stress ${i}`, ELS_PER_SITE));
const SITES_OBJ = Object.fromEntries(S);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const seed = `(()=>{try{localStorage.clear();localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(SITES_OBJ)}));}catch(e){}})();`;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration); })
      .observe({ entryTypes: ["longtask"] });
  } catch (_) {}
  // rAF-gap sampling: a direct measure of "how long was the main thread blocked", which caught
  // real cost here even where the longtask observer's ~50ms bucket sometimes didn't.
  window.__frameGaps = []; window.__armed = false;
  let last = null;
  function tick(t) { if (window.__armed) { if (last != null) window.__frameGaps.push(t - last); last = t; } else last = null; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await assertMeasurable(page, "diagnose-map-plan-zoom-cost");
await page.waitForTimeout(2200);

// Land, then zoom fully OUT so there's a real PLAN_ZOOM crossing to measure.
for (let i = 0; i < 8; i++) await page.click(".leaflet-control-zoom-out");
await page.waitForTimeout(500);

await page.evaluate(() => { window.__longTasks.length = 0; window.__frameGaps.length = 0; window.__armed = true; });
const t0 = Date.now();
for (let i = 0; i < 10; i++) {
  await page.click(".leaflet-control-zoom-in");
  await page.waitForTimeout(400);
  const n2 = await page.evaluate(() => document.querySelectorAll(".leaflet-overlay-pane path").length);
  if (n2 > 100) break; // crossed PLAN_ZOOM and painted
}
const wall = Date.now() - t0;
await page.waitForTimeout(800); // let any deferred/budgeted paint finish settling
await page.evaluate(() => { window.__armed = false; });

const paths = await page.evaluate(() => document.querySelectorAll(".leaflet-overlay-pane path").length);
const lt = await page.evaluate(() => window.__longTasks);
const gaps = await page.evaluate(() => window.__frameGaps);
const maxLt = lt.length ? Math.max(...lt) : 0;
const maxGap = gaps.length ? Math.max(...gaps) : 0;

console.log(`sites=${SITES} elements/site=${ELS_PER_SITE} paths painted=${paths}`);
console.log(`wall clock to cross PLAN_ZOOM=${wall}ms`);
console.log(`long tasks: ${lt.length} (max ${maxLt.toFixed(1)}ms)`);
console.log(`longest single animation-frame gap: ${maxGap.toFixed(1)}ms (over ${gaps.length} frames)`);

await browser.close();
