/* B65 diagnostic — does the aerial basemap tile layer go blank during a zoom?
 *
 * Boots a LOCATED site into the planner (origin set → geoMap + aerial on by
 * default), then drives a wheel-zoom over the canvas and samples the Leaflet
 * tile DOM every animation frame: how many tiles exist, and how many are
 * actually loaded (.leaflet-tile-loaded). If the loaded count collapses toward
 * 0 mid-zoom, the basemap is the layer that flashes (gap → backdrop shows).
 *
 * Run: node ui-audit/diagnose-flash.mjs   (vite preview must be on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const site = {
  id: "flash-demo", groupId: "flash-demo", site: "Flash Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500); // let tiles load

const tileInfo = () => page.evaluate(() => {
  const all = document.querySelectorAll(".leaflet-tile");
  const loaded = document.querySelectorAll(".leaflet-tile-loaded");
  const containers = document.querySelectorAll(".leaflet-tile-container").length;
  return { tiles: all.length, loaded: loaded.length, containers };
});

console.log("before zoom:", await tileInfo());

// sample during a wheel zoom centred on the canvas
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

const samples = [];
const sampler = setInterval(async () => { try { samples.push(await tileInfo()); } catch (_) {} }, 25);

// zoom IN several wheel steps (negative deltaY) crossing tile-zoom boundaries
for (let i = 0; i < 8; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -260); await page.waitForTimeout(70); }
await page.waitForTimeout(400);
// zoom back OUT
for (let i = 0; i < 8; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, 260); await page.waitForTimeout(70); }
await page.waitForTimeout(600);

clearInterval(sampler);
console.log("after zoom:", await tileInfo());

const loadedSeq = samples.map((s) => s.loaded);
const tileSeq = samples.map((s) => s.tiles);
const minLoaded = Math.min(...loadedSeq);
const maxLoaded = Math.max(...loadedSeq);
// count frames where loaded tiles dropped to a small fraction of the max (a gap)
const gapFrames = loadedSeq.filter((l) => l <= Math.max(1, Math.floor(maxLoaded * 0.34))).length;
console.log(`samples=${samples.length} loaded[min=${minLoaded} max=${maxLoaded}] tiles[min=${Math.min(...tileSeq)} max=${Math.max(...tileSeq)}]`);
console.log(`gap frames (loaded <= 34% of max): ${gapFrames}`);
console.log("loaded seq:", loadedSeq.join(","));

await browser.close();
