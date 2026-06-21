/* B65 alignment check — confirm the aerial stays locked to the drawn geometry
 * through the transform-based zoom (the one regression risk of the fix).
 * Captures: baseline, mid zoom-in (transform applied), settled (after commit). */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

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
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2800);

await page.screenshot({ path: OUT + "zoom-align-0-baseline.png" });
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

// zoom in 4 quick steps, screenshot WHILE the transform is live (before the 180ms commit)
for (let i = 0; i < 4; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -240); await page.waitForTimeout(40); }
await page.waitForTimeout(60);            // still inside the 180ms debounce → transform applied
await page.screenshot({ path: OUT + "zoom-align-1-mid-transform.png" });
await page.waitForTimeout(500);           // let it commit → crisp
await page.screenshot({ path: OUT + "zoom-align-2-settled.png" });

await browser.close();
console.log("saved baseline / mid-transform / settled");
