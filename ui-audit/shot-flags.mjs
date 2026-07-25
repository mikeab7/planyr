import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
const BASE = "http://localhost:4173/";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const LABEL = process.env.LABEL || "cur";
const FIXTURE = process.env.FIXTURE || "tsakiris-concept-a-live.json";
const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${FIXTURE}`, import.meta.url), "utf8"));
const SITE_ID = "tsakiris-concept-a";
const site = { id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
  parcels: [], els: fixture.els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  parcelDrawings: [], updatedAt: Date.now() };
const SPOTS = [
  { key: "OWNERZOOM", x: -100, y: 200, ppf: 0.2 },      // roughly the zoom his screenshot was at
  { key: "MIDZOOM", x: -216, y: 450, ppf: 0.7 },
  { key: "FLAG-fire-parking", x: -216, y: 450, ppf: 2.2 },
];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox","--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });
const flags = await page.evaluate(() => [...document.querySelectorAll("[data-road-radius-flag]")].map(n => ({ f: n.getAttribute("data-road-radius-flag"), t: (n.querySelector("title")||{}).textContent })));
console.log(`FLAGS (${LABEL}):`, JSON.stringify(flags, null, 1));
for (const s of SPOTS) {
  await page.evaluate(([x,y,p]) => window.__plannerView.centerOn(x,y,p), [s.x,s.y,s.ppf]);
  await page.waitForTimeout(400);
  await page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}${LABEL}-${s.key}.png` });
  console.log("shot", s.key);
}
if (errors.length) console.log("PAGE ERRORS:\n"+errors.slice(0,5).join("\n"));
await browser.close();
