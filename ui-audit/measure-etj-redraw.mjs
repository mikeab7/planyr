/* measure-etj-redraw — how long does the map stall when the city-limits / ETJ layers redraw after a zoom? (NEW-2)
 *
 * Owner report (live, planyr.io, 5-mile scale): "the map froze for several seconds each time the layer redrew after
 * a zoom change." This MEASURES it instead of guessing — real overlay engine, LIVE services, three scenarios so the
 * cost can be attributed: CITY ONLY, ETJ ONLY, BOTH. Per zoom step it records
 *   • settleMs      — zoom call → both layers report loaded (fetch + paint),
 *   • longTaskMs    — the longest main-thread task (PerformanceObserver "longtask", > 50 ms) — i.e. a FREEZE,
 *   • frameGapMs    — the longest gap between animation frames,
 *   • paths / dChars / vertices — what was actually drawn (SVG <path> count, total path-data characters, ≈ vertices),
 *   • cold vs warm  — first draw of a view vs a repeat from the SWR cache.
 * Denton County's and Fort Worth's servers are unreachable from the build sandbox, so requests to them are answered
 * with REAL polygons of the same volume (the 2022 Denton table on ArcGIS Online, the 2025 Fort Worth copy) — labelled
 * in the output; volume is what is being measured, not those servers' speed.
 *
 * Headless Chromium draws in software, so absolute milliseconds are pessimistic against a real GPU browser; the
 * comparison BETWEEN scenarios is the finding. Run: npx vite --port 5199 --strictPort &
 *   NODE_USE_ENV_PROXY=1 node ui-audit/measure-etj-redraw.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:5199";
const RUNS = Number(process.env.RUNS || 3);
const STAND_IN = {
  "gis.dentoncounty.gov": "https://services.arcgis.com/oTsZYNubyv7xK5yP/arcgis/rest/services/_ETJ/FeatureServer/1/query",
  "mapit.fortworthtexas.gov": "https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/2022_Bond___Approved_Projects_WFL1/FeatureServer/14/query",
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const rows = [];
try {
  for (const layers of ["jur_city", "jur_etj", "jur_city,jur_etj"]) {
    for (const run of Array.from({ length: RUNS }, (_, i) => i)) {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });   // fresh cache = COLD
      const page = await ctx.newPage();
      await assertMeasurable(page, "measure-etj-redraw");
      // Blocked hosts → real polygons of the same volume, with the query's own params (so paging/where behave).
      for (const [host, real] of Object.entries(STAND_IN)) {
        await page.route(`**://${host}/**`, async (route) => {
          const u = new URL(route.request().url());
          const body = await (await fetch(real + "?" + u.searchParams.toString().replace(/where=[^&]*/, "where=1%3D1"))).text();
          route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body });
        });
      }
      await page.goto(`${BASE}/ui-audit/dfw-etj-map-harness.html?lat=33.03&lng=-97.0&z=11&layers=${layers}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__READY__ === true);
      // SETTLED = the layers stopped drawing. The overlay only re-reports "loaded" when its tile-cell key CHANGES, so a
      // status wait would hang on a zoom that lands in an already-fetched cell; watch the pane's own DOM instead.
      await page.evaluate(() => { window.__lastMut = performance.now(); new MutationObserver(() => { window.__lastMut = performance.now(); }).observe(document.querySelector("#map"), { subtree: true, childList: true, attributes: true }); });
      const settle = async () => {
        const t0 = Date.now();
        await page.waitForFunction((keys) => keys.every((k) => window.__status[k] && ["loaded", "empty", "failed"].includes(window.__status[k].state)) || performance.now() - window.__since > 2500, layers.split(","), { timeout: 120000 });
        await page.waitForFunction(() => performance.now() - window.__lastMut > 700, null, { timeout: 60000, polling: 100 });
        return Date.now() - t0;
      };
      await page.evaluate(() => { window.__since = performance.now(); });
      await settle();
      for (const [label, z] of [["z11→12 (5-mile scale) COLD", 12], ["z12→13 COLD", 13], ["z13→12 WARM (cache)", 12], ["z12→11 WARM (cache)", 11]]) {
        await page.evaluate((keys) => { for (const k of keys) window.__status[k] = { state: "loading" }; window.__since = performance.now(); window.__long.length = 0;
          window.__gaps = []; let last = performance.now(); window.__stop = false;
          (function tick(t) { window.__gaps.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick); })(performance.now()); }, layers.split(","));
        const stamp = await page.evaluate((z) => { const t = performance.now(); window.__map.setZoom(z, { animate: false }); return t; }, z);
        await settle();
        // settleMs = zoom call → the LAST drawing mutation (not the 700 ms quiet wait itself)
        const settleMs = Math.round(await page.evaluate((t) => Math.max(0, window.__lastMut - t), stamp));
        const m = await page.evaluate(() => { window.__stop = true;
          const paths = [...document.querySelectorAll("#map .leaflet-bnd-pane svg path")];
          return { long: window.__long.map((l) => l.ms), gap: Math.max(...window.__gaps.slice(1), 0), paths: paths.length, dChars: paths.reduce((s, p) => s + (p.getAttribute("d") || "").length, 0) }; });
        rows.push({ layers, run, label, settleMs, longTaskMs: Math.max(0, ...m.long), longTasks: m.long.length, frameGapMs: Math.round(m.gap), paths: m.paths, vertices: Math.round(m.dChars / 11) });
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
console.log(`\n(median of ${RUNS} runs; Denton + Fort Worth answered by real polygons of the same volume; software-rendered headless Chromium → absolute ms are pessimistic)\n`);
console.log("layers".padEnd(18) + "step".padEnd(30) + "settle ms".padStart(10) + "longest task".padStart(14) + "longest frame gap".padStart(19) + "paths".padStart(8) + "≈vertices".padStart(11));
for (const layers of ["jur_city", "jur_etj", "jur_city,jur_etj"]) for (const label of ["z11→12 (5-mile scale) COLD", "z12→13 COLD", "z13→12 WARM (cache)", "z12→11 WARM (cache)"]) {
  const r = rows.filter((x) => x.layers === layers && x.label === label);
  console.log(layers.padEnd(18) + label.padEnd(30) + String(med(r.map((x) => x.settleMs))).padStart(10) + String(med(r.map((x) => x.longTaskMs))).padStart(14) + String(med(r.map((x) => x.frameGapMs))).padStart(19) + String(med(r.map((x) => x.paths))).padStart(8) + String(med(r.map((x) => x.vertices))).padStart(11));
}
