/* Measure how long the planner basemap stays mostly-gray (dark backdrop) after a
 * fresh load — i.e. time-to-imagery-coverage. B65 load-regression check. */
import { chromium } from "playwright";
import { PNG } from "pngjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const site = {
  id: "flash-demo", groupId: "flash-demo", site: "Flash Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;
function darkFraction(buf) {
  const png = PNG.sync.read(buf);
  let dark = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 37) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (Math.abs(r - 63) < 12 && Math.abs(g - 63) < 12 && Math.abs(b - 63) < 12) dark++;
    n++;
  }
  return dark / n;
}
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
if (process.env.THROTTLE) {
  const client = await ctx.newCDPSession(page);
  await client.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: (1.2 * 1024 * 1024) / 8, uploadThroughput: (512 * 1024) / 8 });
  console.log("(network throttled to ~1.2 Mbps)");
}
await page.goto(BASE, { waitUntil: "load" });
// wait until the planner canvas + basemap container are actually mounted
await page.waitForSelector("svg[role=application]", { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll(".leaflet-tile").length > 0, { timeout: 10000 });
const t0 = Date.now(); // start the clock once the basemap layer exists (tiles requested)
let coveredAt = null, tileCount = 0;
for (let i = 0; i < 70; i++) { // up to ~17s
  const f = darkFraction(await page.screenshot());
  tileCount = await page.evaluate(() => document.querySelectorAll(".leaflet-tile-loaded").length);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`t=${dt}s dark=${(f * 100).toFixed(0)}% loadedTiles=${tileCount}`);
  if (f < 0.10 && tileCount > 0 && coveredAt === null) { coveredAt = dt; if (!process.env.FULL) break; }
  await page.waitForTimeout(250);
}
console.log(`>>> time from basemap-layer-mounted to coverage (<10% gray): ${coveredAt ?? "NOT within 17s"}  | tiles at coverage: ${tileCount}`);
await browser.close();
