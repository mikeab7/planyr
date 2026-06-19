/* Self-verification for NEW-1..NEW-5 (Site Planner). Seeds a scenario into
 * localStorage, boots the planner, and screenshots so the label/dimension
 * changes can be eyeballed. Logged-out / this-device mode (no auth needed). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-new";
const els = [
  // NEW-1: a horizontal 24' road — its width dimension should sit CENTERED along the length.
  { id: "road1", type: "road", cx: 0, cy: -160, w: 500, h: 26, rot: 0, travelW: 24, curb: 1 },
  // NEW-2: a thin VERTICAL landscape strip — "5′ Landscape" should run vertically (down the long axis).
  { id: "ls1", type: "landscape", cx: -360, cy: 60, w: 5, h: 260, rot: 0 },
  // NEW-2: a thin HORIZONTAL sidewalk strip — "5′ Sidewalk" should stay horizontal.
  { id: "sw1", type: "sidewalk", cx: 40, cy: 120, w: 300, h: 5, rot: 0 },
  // NEW-5: a thin VERTICAL trailer strip — its label should run vertically (in-line on the strip).
  { id: "tr1", type: "trailer", cx: 300, cy: 60, w: 24, h: 260, rot: 0, cfg: { trailerW: 12, trailerL: 53, trailerAisle: 0, single: true } },
  // NEW-5: a wide trailer field — its label stays horizontal (fits).
  { id: "tr2", type: "trailer", cx: 60, cy: -300, w: 220, h: 120, rot: 0 },
  // NEW-4: a building + truck court + trailer (back side) so the resize relationship is visible.
  { id: "b1", type: "building", cx: -160, cy: -360, w: 300, h: 120, rot: 0, dock: "single", dockSide: "bottom" },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -460, y: -460 }, { x: 460, y: -460 }, { x: 460, y: 260 }, { x: -460, y: 260 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify NEW", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "verify-new-prezoom.png" });
// Zoom in a few notches so labels/dimensions are at working detail (ppf > 0.18).
const cx = 820, cy = 450; // canvas area (right of the left panel)
for (let i = 0; i < 4; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "verify-new-overview.png" });
console.log("saved verify-new-overview.png");
await ctx.close();
await browser.close();
console.log("done");
