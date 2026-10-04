#!/usr/bin/env node
/* shoot-food-basemaps — NEW-1 (B2018608). Before/after Houston screenshots of /food at devicePixelRatio 2,
 * metro (zoom 11) and neighbourhood (zoom 16), per basemap. The same script runs against the old build
 * (`--before`, whose buttons are "Site Plan"/"Hybrid") and the new one (Satellite/Hybrid, B2070433).
 *   node ui-audit/shoot-food-basemaps.mjs http://localhost:4174 --shots dir --tag before --before
 *   node ui-audit/shoot-food-basemaps.mjs http://localhost:4173 --shots dir --tag after
 * Vector tiles: synthetic source unless `--live` (see lib/fakeVectorTiles.mjs). Imagery is real Esri. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource, HOUSTON } from "./lib/fakeVectorTiles.mjs";
const a = process.argv.slice(2);
const val = (n, d) => (a.indexOf(n) >= 0 ? a[a.indexOf(n) + 1] : d);
const BASE = a.find((x) => /^https?:/.test(x)) || "http://localhost:4173";
const DIR = val("--shots", "/tmp/shots"), TAG = val("--tag", "after"), BEFORE = a.includes("--before"), LIVE = a.includes("--live");
mkdirSync(DIR, { recursive: true });
const SETS = BEFORE ? [["hybrid", "hybrid"], ["satellite", "siteplan"]] : [["hybrid", "hybrid"], ["satellite", "satellite"]];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
if (!LIVE) await installFakeVectorSource(ctx);
const p = await ctx.newPage(); await p.addInitScript("window.__PLANYR_E2E = true");
await p.goto(BASE + "/#/food"); await p.waitForSelector('[data-testid="food-map"]');
await assertMeasurable(p, "shoot-food-basemaps");
await p.waitForFunction(() => window.__foodMap, null, { timeout: 15000 });
for (const [name, btn] of SETS) {
  await p.click(`[data-testid="food-basemap-${btn}"]`, { force: true });
  for (const [zn, z] of [["metro", 11], ["hood", 16]]) {
    await p.evaluate(({ lat, lng, z }) => window.__foodMap.setView([lat, lng], z, { animate: false }), { ...HOUSTON, z });
    await p.waitForTimeout(6500);
    await p.screenshot({ path: `${DIR}/food-${name}-${zn}-${TAG}.jpg`, type: "jpeg", quality: 82 });
    console.log("shot", name, zn);
  }
}
await b.close();
