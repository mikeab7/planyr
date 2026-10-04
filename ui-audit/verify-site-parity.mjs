#!/usr/bin/env node
/* verify-site-parity — NEW-1 amendment (B2018608). The Site tab's browse map and /food's DEFAULT option must
 * show the same layers at the same zoom. Drives BOTH real maps over Houston at the same view and compares a
 * layer fingerprint — {imagery, Planyr city names, vector road lines, tone grade} — at metro and
 * neighbourhood zoom (and the zoom steps around the gate). Also writes the side-by-side screenshots:
 * Site browse map | /food Site Plan | /food Hybrid, same metro zoom, desktop and phone.
 * Usage: node ui-audit/verify-site-parity.mjs [baseUrl] [--shots dir] [--tag name] [--live] */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource, HOUSTON } from "./lib/fakeVectorTiles.mjs";

const a = process.argv.slice(2);
const val = (n, d) => (a.indexOf(n) >= 0 ? a[a.indexOf(n) + 1] : d);
const BASE = a.find((x) => /^https?:/.test(x)) || "http://localhost:4173";
const DIR = val("--shots", null), TAG = val("--tag", "after"), LIVE = a.includes("--live");
if (DIR) mkdirSync(DIR, { recursive: true });
const failures = [];
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures.push(label); };

const fingerprint = (page, mapVar) => page.evaluate((mapVar) => {
  const map = window[mapVar];
  const city = document.querySelector(".leaflet-placenames-pane");
  const gl = document.querySelectorAll(".leaflet-gl-layer").length;
  const g = map.__vectorLabelsGL;
  const roads = g && g.isStyleLoaded() ? g.queryRenderedFeatures({ layers: ["road-freeway", "road-major", "road-arterial", "road-collector", "road-local"] }).length : 0;
  const tile = document.querySelector(".leaflet-tile-pane img.leaflet-tile");
  return {
    imagery: !!tile && /World_Imagery/.test(tile.src),
    cityNames: !!city && Number(city.dataset.count || 0) > 0,
    roadLines: gl > 0 && roads > 0,
    graded: !!document.querySelector(".planyr-imagery-graded"),
  };
}, mapVar);

async function openSite(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  if (!LIVE) await installFakeVectorSource(ctx);
  const page = await ctx.newPage(); await page.addInitScript("window.__PLANYR_E2E = true");
  await page.goto(BASE + "/#/site"); await page.waitForFunction(() => window.__mapFinderMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-site-parity");
  return { ctx, page };
}
async function openFood(browser, viewport, choice) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  if (!LIVE) await installFakeVectorSource(ctx);
  const page = await ctx.newPage(); await page.addInitScript("window.__PLANYR_E2E = true");
  await page.goto(BASE + "/#/food"); await page.waitForFunction(() => window.__foodMap, null, { timeout: 30000 });
  await assertMeasurable(page, "verify-site-parity");
  if (choice) await page.click(`[data-testid="food-basemap-${choice}"]`, { force: true });
  return { ctx, page };
}
// At wide zoom the two maps are different heights (/food has a toolbar strip), so a label sitting on the
// bottom edge of one can fall just outside the other — centre a little south so every compared label is
// well inside BOTH. Neighbourhood zoom keeps the fixture's own centre (its street grid lives there).
const view = (page, mapVar, z) => page.evaluate(({ mapVar, lat, lng, z }) => window[mapVar].setView([z <= 13 ? 29.76 : lat, lng], z, { animate: false }), { mapVar, ...HOUSTON, z });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 780 }]]) {
  const site = await openSite(browser, viewport), food = await openFood(browser, viewport, null), hyb = await openFood(browser, viewport, "hybrid");
  for (const z of [10, 11, 12, 13, 14, 15, 16, 17]) {
    await view(site.page, "__mapFinderMap", z); await view(food.page, "__foodMap", z);
    await site.page.waitForTimeout(5500); await food.page.waitForTimeout(500);
    let fs = await fingerprint(site.page, "__mapFinderMap"), ff = await fingerprint(food.page, "__foodMap");
    // City names fade/lay out over a few frames and the data loads lazily: allow up to ~8 s to settle before judging.
    for (let t = 0; t < 8 && JSON.stringify(fs) !== JSON.stringify(ff); t++) { await food.page.waitForTimeout(1000); fs = await fingerprint(site.page, "__mapFinderMap"); ff = await fingerprint(food.page, "__foodMap"); }
    check(`${label} z${z}: /food default shows the same layers as the Site browse map`, JSON.stringify(fs) === JSON.stringify(ff), `site=${JSON.stringify(fs)} food=${JSON.stringify(ff)}`);
    if (z === 11) {
      check(`${label} z11 (metro): NO road lines on either, city names on both`, !fs.roadLines && !ff.roadLines && fs.cityNames && ff.cityNames);
      await view(hyb.page, "__foodMap", 11); await hyb.page.waitForTimeout(5500);
      const fh = await fingerprint(hyb.page, "__foodMap");
      check(`${label} z11 (metro): Hybrid is the DIFFERENT option — vector roads, toned, no Planyr city layer`, fh.roadLines && fh.graded && !fh.cityNames, JSON.stringify(fh));
      if (DIR) {
        await site.page.screenshot({ path: `${DIR}/metro-1-site-browse-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
        await food.page.screenshot({ path: `${DIR}/metro-2-food-siteplan-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
        await hyb.page.screenshot({ path: `${DIR}/metro-3-food-hybrid-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
      }
    }
    if (z === 16) {
      check(`${label} z16 (neighbourhood): road lines on both, no city names on either`, fs.roadLines && ff.roadLines && !fs.cityNames && !ff.cityNames);
      if (DIR) {
        await site.page.screenshot({ path: `${DIR}/hood-1-site-browse-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
        await food.page.screenshot({ path: `${DIR}/hood-2-food-siteplan-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
      }
    }
  }
  for (const x of [site, food, hyb]) await x.ctx.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
