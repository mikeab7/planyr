/* Diagnose B176: what tile zoom levels does the basemap request when zooming in
 * deep? Esri World Imagery is native to z19; requests above that return the gray
 * "Map data not yet available" placeholder. */
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DSF || 2) });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const zoomsRequested = {};
let placeholderHits = 0;
page.on("response", async (resp) => {
  const u = resp.url();
  const m = u.match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
  if (m) {
    const z = Number(m[1]);
    zoomsRequested[z] = (zoomsRequested[z] || 0) + 1;
    try { const len = Number(resp.headers()["content-length"] || 0); if (z > 19 || len > 0 && len < 1200) placeholderHits++; } catch (_) {}
  }
});
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500);
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
console.log("deviceScaleFactor:", Number(process.env.DSF || 2));
for (let i = 0; i < 22; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(120); }
await page.waitForTimeout(1500);
const zs = Object.keys(zoomsRequested).map(Number).sort((a, b) => a - b);
console.log("tile zooms requested (z: count):");
for (const z of zs) console.log(`  z${z}: ${zoomsRequested[z]}${z > 19 ? "   <-- BEYOND native 19 (placeholder!)" : ""}`);
console.log("max z requested:", Math.max(...zs), "| suspected placeholder/empty responses:", placeholderHits);
await browser.close();
