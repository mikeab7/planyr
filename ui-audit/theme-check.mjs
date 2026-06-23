/* Theme verification harness (dev tool) — screenshots the app in BOTH themes so a
 * session can eyeball the light/dark/system work (B316–B320). Seeds a demo site +
 * sets localStorage['planyr.theme'] before load (the pre-paint script picks it up).
 * Run: node ui-audit/theme-check.mjs   (vite preview must be running on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e3", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
  { id: "e4", type: "road", cx: 0, cy: 252, w: 580, h: 26, rot: 0 },
  { id: "e5", type: "parking", cx: -330, cy: -40, w: 150, h: 180, rot: 0 },
  { id: "e8", type: "pond", cx: 330, cy: 165, w: 190, h: 120, rot: 0 },
];
const demoSite = { id: "d", groupId: "d", site: "Theme Demo", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const located = {
  a1: { id: "a1", groupId: "a1", site: "Katy Logistics Park", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris", parcels: [parcel], els: [els[0]], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" } },
  a2: { id: "a2", groupId: "a2", site: "Brookshire Tract", name: "Plan 1", origin: { lat: 29.78, lon: -95.95 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "pursuit" } },
};

const seed = (theme, mode) => `(() => { try {
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  if (${mode === "plan" ? "true" : "false"}) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  } else if (${mode === "map" ? "true" : "false"}) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(located)}));
    localStorage.removeItem('planarfit:currentSite:v1');
  } else {
    localStorage.removeItem('planarfit:currentSite:v1');
  }
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function snap(name, theme, mode, prep) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
  await ctx.addInitScript(seed(theme, mode));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (prep) { try { await prep(page); } catch (e) { console.warn("  prep warn", name, e.message); } }
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + name });
  console.log("  saved", name);
  await ctx.close();
}

const fit = async (p) => { await p.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); };
const toMarkup = async (p) => { await p.locator('button:has-text("Library")').first().click({ timeout: 4000 }); await p.waitForTimeout(1400); };

for (const t of ["light", "dark"]) {
  await snap(`theme-planner-${t}.png`, t, "plan", fit);
  await snap(`theme-map-${t}.png`, t, "map", null);
  await snap(`theme-markup-${t}.png`, t, "plain", toMarkup);
}
await browser.close();
console.log("done.");
