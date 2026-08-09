/* Three clicks on the OWNER'S REAL PLAN: start in open ground, a turn, and a final point landing
 * ON an existing road (the connect case he actually draws). Reports what the app stored. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = "http://localhost:4173/";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "tsakiris-concept-a";
const site = { id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
  parcels: [], els: fixture.els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  parcelDrawings: [], updatedAt: Date.now() };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox","--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-three-click-real");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });

// Park so the target stretch of the 40' truck loop (y≈450, x 700..1200) is on screen.
const CX = 900, CY = 300, PPF = 0.55;
await page.evaluate(([x,y,p]) => window.__plannerView.centerOn(x,y,p), [CX, CY, PPF]);
await page.waitForTimeout(400);
const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();
const v = await page.evaluate(() => window.__plannerView.get());
const f2s = (fx, fy) => ({ x: box.x + v.w/2 + (fx - CX)*PPF, y: box.y + v.h/2 + (fy - CY)*PPF });

const before = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1")||"{}"); const s = Object.values(m)[0]||{};
  return (s.els||[]).filter(e=>e.type==="road").map(e=>({id:e.id,n:(e.pts||[]).length}));
});

await page.getByRole("button", { name: "Road", exact: true }).click();
await page.getByRole("button", { name: "Road presets" }).click();
await page.getByRole("button", { name: /^\d+′$/ }).first().click();

// 1. start in open ground north of the loop  2. the turn  3. final point ON the truck loop centerline (y=461 near x=1200)
const P = [ f2s(760, 60), f2s(1200, 60), f2s(1200, 461) ];
for (const p of P) { await page.mouse.move(p.x, p.y); await page.waitForTimeout(120); await page.mouse.click(p.x, p.y); await page.waitForTimeout(180); }
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

const after = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1")||"{}"); const s = Object.values(m)[0]||{};
  return (s.els||[]).filter(e=>e.type==="road").map(e=>({id:e.id,cls:e.roadClass,w:e.travelW,n:(e.pts||[]).length,
    pts:(e.pts||[]).map(p=>[Math.round(p.x),Math.round(p.y)]), vtx:(e.vtx||[]).map(x=>x&&x.radius?`${x.treatment}:${Math.round(x.radius)}`:"-")}));
});
console.log("BEFORE:", JSON.stringify(before));
console.log("\nAFTER  (3 clicks: start / turn / end-on-the-truck-loop):");
for (const r of after) console.log(" ", r.id, r.cls, "w"+r.w, "n="+r.n, JSON.stringify(r.pts).slice(0,300), r.vtx.join(","));
const flags = await page.evaluate(() => [...document.querySelectorAll("[data-road-radius-flag]")].map(n=>({f:n.getAttribute("data-road-radius-flag"),t:(n.querySelector("title")||{}).textContent})));
console.log("\nFLAGS:", JSON.stringify(flags,null,1));
await page.evaluate(([x,y,p]) => window.__plannerView.centerOn(x,y,p), [1200, 400, 1.1]);
await page.waitForTimeout(400);
await canvas.screenshot({ path: `${OUT}three-click-real.png` });
console.log("\nshot →", `${OUT}three-click-real.png`);
if (errs.length) console.log("PAGE ERRORS:\n"+errs.slice(0,5).join("\n"));
await browser.close();
