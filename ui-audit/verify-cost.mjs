/* Verify the road cost takeoff UI (B180/B181) in a real browser.
 * Boots the planner with a seeded site that has a road element, opens the Yield
 * panel, expands "Road cost (screening)", and asserts the paving (SY) + curb (LF)
 * quantities render. Also clicks the road element and checks the inspector shows
 * the curb-type control. Logged-out (sandbox) — no auth needed; els are local. */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "uiaudit-demo";
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e4", type: "road", cx: 0, cy: 252, w: 580, h: 26, rot: 0 },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Cost Verify", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
const errors = [];
ctx.on("weberror", (e) => errors.push(String(e.error())));
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

// Open the Yield panel and expand the cost section.
await page.locator('button[title="Yield"]').click({ timeout: 5000 });
await page.waitForTimeout(400);
const costHeader = page.locator('text=Road cost (screening)');
const costVisible = await costHeader.count();
if (costVisible) { try { await costHeader.first().click(); await page.waitForTimeout(300); } catch (_) {} }
const yieldText = await page.locator('aside, [class], body').first().innerText().catch(() => "");
const panelText = await page.evaluate(() => document.body.innerText);

const has = (s) => panelText.includes(s);
console.log("Road cost header present:", !!costVisible);
console.log("Has 'Paving':", has("Paving"));
console.log("Has ' SY':", has(" SY"));
console.log("Has 'Curb · barrier':", has("Curb · barrier"));
console.log("Has ' LF':", has(" LF"));
console.log("Has 'face-of-curb':", has("face-of-curb"));

await page.screenshot({ path: new URL("./screens/cost-yield.png", import.meta.url).pathname });

// Now click the road element to open its inspector and check the curb-type control.
await page.locator('button[title="Yield"]').click({ timeout: 5000 }).catch(() => {});
// Switch to props panel via clicking the road on canvas: road is at cy 252, below center.
await page.mouse.click(720, 620);
await page.waitForTimeout(500);
const bodyAfter = await page.evaluate(() => document.body.innerText);
console.log("Inspector 'Curb & paving (cost)':", bodyAfter.includes("Curb & paving (cost)"));
console.log("Inspector 'Curb type':", bodyAfter.includes("Curb type"));
await page.screenshot({ path: new URL("./screens/cost-inspector.png", import.meta.url).pathname });

console.log("Page errors:", errors.length ? errors : "none");
await browser.close();
