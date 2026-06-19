/* NEW-4 via the OWNER'S path: change the truck court's Depth field 135 -> 170 and confirm
 * (a) the dock-wall edge stays put (top edge unchanged), (b) only the far edge moves, and
 * (c) the trailer parking follows. Reads the on-screen geometry before/after. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ID = "verify-new4b";
const B = { id: "b1", type: "building", cx: 0, cy: -150, w: 300, h: 120, rot: 0, dock: "single", dockSide: "bottom" };
const courtCy = -150 + 60 + 135 / 2;
const court = { id: "court1", type: "paving", cx: 0, cy: courtCy, w: 300, h: 135, rot: 0, attachedTo: "b1", truckCourt: { side: "bottom" } };
const trCy = courtCy + 135 / 2 + 50 / 2;
const trailer = { id: "tr1", type: "trailer", cx: 0, cy: trCy, w: 300, h: 50, rot: 0, attachedTo: "b1", forCourt: "court1", noFit: true, cfg: { trailerW: 12, trailerL: 50, trailerAisle: 0, single: true } };
const parcel = { id: "pc1", locked: false, points: [{ x: -260, y: -260 }, { x: 260, y: -260 }, { x: 260, y: 200 }, { x: -260, y: 200 }] };
const site = { id: ID, groupId: ID, site: "V4b", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [B, court, trailer], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
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

// Helper: building-rect bottom edge (dock wall) + trailer-rect top edge, in screen px.
// Identify rects by fill: building is dark; trailer tan. Simpler: read tspan label centres.
const centers = async () => page.evaluate(() => {
  const find = (re) => { const t = [...document.querySelectorAll("svg text, svg tspan")].find((n) => re.test(n.textContent || "")); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  return { building: find(/Building 1/), trailer: find(/trailers/) };
});

await page.mouse.click(760, 470); // select the court (sits below the building)
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "new4b-before.png" });
const before = await centers();
console.log("before:", JSON.stringify(before));

// Find the Depth field and set it to 170.
const depth = page.locator('div:has(> span:text-is("Depth (ft)")) input').first();
let usedField = false;
try {
  await depth.fill("170", { timeout: 3000 });
  await depth.press("Enter");
  usedField = true;
} catch (e) { console.warn("depth field not found:", e.message); }
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "new4b-after.png" });
const after = await centers();
console.log("after:", JSON.stringify(after));

if (usedField && before.building && after.building && before.trailer && after.trailer) {
  const bMoved = Math.abs(after.building.y - before.building.y);
  const trMoved = after.trailer.y - before.trailer.y;
  console.log(`building label moved ${bMoved.toFixed(1)}px (want ~0 = dock wall anchored)`);
  console.log(`trailer label moved ${trMoved.toFixed(1)}px down (want > 0 = pushed out)`);
  console.log((bMoved < 6 && trMoved > 8) ? "RESULT: anchored to dock wall + trailer pushed out ✅" : "RESULT: ❌ check geometry");
}
await ctx.close();
await browser.close();
console.log("done");
