/* NEW-3: the acreage chip is click-and-drag and persists. Drag it, reload, confirm it kept
 * its new spot (persistence to the local store / would mirror to Supabase when signed in). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ID = "verify-new3";
const parcel = { id: "pc1", locked: false, points: [{ x: -200, y: -150 }, { x: 200, y: -150 }, { x: 200, y: 150 }, { x: -200, y: 150 }] };
const site = { id: ID, groupId: ID, site: "V3", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(ID)});
} catch (e) {} })();`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
await page.waitForTimeout(500);
const chipPos = async () => page.evaluate(() => { const t = [...document.querySelectorAll("svg text")].find((n) => /\bac\b/.test(n.textContent || "")); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
const before = await chipPos();
console.log("chip before:", JSON.stringify(before));
// Drag the chip up-left, well outside the parcel.
await page.mouse.move(before.x, before.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(before.x - i * 18, before.y - i * 14); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(400);
const after = await chipPos();
console.log("chip after:", JSON.stringify(after));
await page.screenshot({ path: OUT + "new3-after-drag.png" });
const moved = Math.hypot(after.x - before.x, after.y - before.y);
console.log(`chip moved ${moved.toFixed(0)}px`, moved > 60 ? "✅ draggable" : "❌ did not move");

// Persistence: the in-memory store mirrors to localStorage on edit; reload and re-check.
await page.waitForTimeout(800);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1600);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
await page.waitForTimeout(500);
const reloaded = await chipPos();
console.log("chip after reload:", JSON.stringify(reloaded));
if (reloaded && before) {
  const keptOffset = Math.hypot(reloaded.x - before.x, reloaded.y - before.y);
  console.log(`offset survived reload: ${keptOffset.toFixed(0)}px from default`, keptOffset > 40 ? "✅ persisted" : "❌ reverted");
}
await ctx.close();
await browser.close();
console.log("done");
