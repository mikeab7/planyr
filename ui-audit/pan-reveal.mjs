/* Capture a screenshot mid-pan to see the blank backdrop reveal (B65 follow-up). */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
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
await page.keyboard.press("h");
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down();
for (let i = 0; i < 10; i++) { await page.mouse.move(cx + i * 40, cy + i * 30); await page.waitForTimeout(16); } // big fast drag down-right
await page.screenshot({ path: OUT + "pan-reveal-MID.png" }); // captured while button still down (transform live)
await page.mouse.up();
await browser.close();
console.log("saved pan-reveal-MID.png");
