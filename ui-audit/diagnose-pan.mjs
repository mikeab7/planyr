/* B65 pan check — confirm panning (drag) doesn't blank the aerial either. */
import { chromium } from "playwright";
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
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2800);

const info = () => page.evaluate(() => ({ loaded: document.querySelectorAll(".leaflet-tile-loaded").length, tiles: document.querySelectorAll(".leaflet-tile").length }));
await page.keyboard.press("h"); // hand/pan tool
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

const samples = [];
const sampler = setInterval(async () => { try { samples.push((await info()).loaded); } catch (_) {} }, 25);
await page.mouse.move(cx, cy); await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(cx - i * 22, cy - i * 14); await page.waitForTimeout(35); }
await page.mouse.up();
await page.waitForTimeout(500);
clearInterval(sampler);
const max = Math.max(...samples), min = Math.min(...samples);
const gap = samples.filter((l) => l <= Math.max(1, Math.floor(max * 0.34))).length;
console.log(`PAN: samples=${samples.length} loaded[min=${min} max=${max}] gap frames=${gap}`);
console.log("seq:", samples.join(","));
await browser.close();
