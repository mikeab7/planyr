/* UI audit screenshot harness (dev tool — not part of the app build).
 *
 * Drives a headless Chromium over the built app (vite preview on :4173) and saves
 * screenshots of key screens/states to ui-audit/screens/. Auth-gated cloud views
 * are out of scope (no Supabase credentials in this environment), so we seed a
 * representative site directly into localStorage and let the app boot into the
 * planner (SitePlannerApp resumes into "plan" when currentSite points at a saved
 * record). This needs no network tiles and no backend.
 *
 * Run:  npm install --no-save playwright
 *       node ui-audit/capture.mjs            (preview server must be running)
 * If the managed Chromium revision differs, set PW_CHROME to the chrome binary.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// A representative industrial site exercising every element type, so the H2
// colour/pattern differentiation is visible on a real plan (building, paving,
// car parking, trailer parking, detention pond, sidewalk, landscape, road).
const DEMO_ID = "uiaudit-demo";
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e2", type: "sidewalk", cx: 0, cy: 58, w: 420, h: 9, rot: 0 },
  { id: "e3", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
  { id: "e4", type: "road", cx: 0, cy: 252, w: 580, h: 26, rot: 0 },
  { id: "e5", type: "parking", cx: -330, cy: -40, w: 150, h: 180, rot: 0 },
  { id: "e6", type: "trailer", cx: 330, cy: -40, w: 150, h: 200, rot: 0 },
  { id: "e7", type: "landscape", cx: -330, cy: 140, w: 150, h: 70, rot: 0 },
  { id: "e8", type: "pond", cx: 330, cy: 165, w: 190, h: 120, rot: 0 },
];
const parcel = {
  id: "pc1", locked: false,
  points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }],
};
// A tiny "site plan"-looking backdrop (SVG data URL) + a couple of pixel-relative
// markups, so the B67 parcel-drawing modal can be screenshotted without a real PDF.
const planSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='800' height='600' fill='#fff'/><rect x='40' y='40' width='720' height='520' fill='none' stroke='#333' stroke-width='2'/><rect x='110' y='110' width='320' height='190' fill='none' stroke='#333' stroke-width='1.5'/><text x='140' y='210' font-family='sans-serif' font-size='22' fill='#333'>BUILDING A</text><line x1='40' y1='400' x2='760' y2='400' stroke='#999' stroke-dasharray='6 4'/><text x='250' y='560' font-family='sans-serif' font-size='26' font-weight='bold' fill='#333'>SITE PLAN — SCHIEL RD</text></svg>`;
const drawing = {
  id: "dwg1", parcelId: "pc1", name: "Schiel Rd - Survey", kind: "image", page: 1, pageCount: 1,
  intrinsic: { w: 800, h: 600 }, src: "data:image/svg+xml," + encodeURIComponent(planSvg),
  markups: [
    { id: "m1", type: "rect", color: "#dc2626", pts: [{ x: 0.13, y: 0.17 }, { x: 0.55, y: 0.52 }] },
    { id: "m2", type: "text", color: "#2563eb", pts: [{ x: 0.16, y: 0.6 }], text: "verify setback" },
  ], createdAt: Date.now(), updatedAt: Date.now(),
};
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "UI Audit Demo", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [drawing], updatedAt: Date.now(),
};

const seedScript = (current) => `(() => {
  try {
    const sites = ${JSON.stringify(current ? { [demoSite.id]: demoSite } : {})};
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(sites));
    ${current ? `localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});`
              : `localStorage.removeItem('planarfit:currentSite:v1');`}
  } catch (e) {}
})();`;

// Two LOCATED saved sites (with an origin) + no currentSite, so the app boots to the
// map finder showing the "Your sites" panel, markers, the scale bar and "Fit all" (B96b).
const locatedSites = {
  a1: { id: "a1", groupId: "a1", site: "Katy Logistics Park", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris", parcels: [parcel], els: [els[0]], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" } },
  a2: { id: "a2", groupId: "a2", site: "Brookshire Tract", name: "Plan 1", origin: { lat: 29.78, lon: -95.95 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "pursuit" } },
};
const mapSitesSeed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(locatedSites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const fitFirst = async (page) => { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); };

// Each shot: { name, seed:true|false, viewport?, prep?(page) }. `seed:true` boots
// into the planner with the demo site; `false` boots to the map finder.
const SHOTS = [
  { name: "planner-plan.png", seed: true, prep: fitFirst },
  { name: "planner-setup.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('button[title="Setup"]').click({ timeout: 5000 }); } },
  { name: "planner-yield.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('button[title="Yield"]').click({ timeout: 5000 }); } },
  { name: "planner-parcel-panel.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('button[title="Parcel"]').click({ timeout: 5000 }); } },
  { name: "parcel-drawing.png", seed: true, prep: async (p) => {
      await fitFirst(p);
      await p.locator('button[title="Parcel"]').click({ timeout: 5000 });          // open Parcel panel
      await p.locator('button:has-text("Parcel 1")').first().click({ timeout: 5000 }); // select the parcel
      await p.waitForTimeout(300);
      await p.locator('button:has-text("Schiel Rd")').first().click({ timeout: 5000 }); // open the markup modal
      await p.waitForTimeout(600);
    } },
  { name: "planner-overlay-panel.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('button[title="Overlay"]').click({ timeout: 5000 }); } },
  { name: "planner-parking-menu.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('[aria-label="Parking presets"]').click({ timeout: 5000 }); } },
  { name: "planner-road-menu.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('[aria-label="Road presets"]').click({ timeout: 5000 }); } },
  { name: "planner-building-menu.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('[aria-label="Dock layout"]').click({ timeout: 5000 }); } },
  { name: "planner-boundary-menu.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('[title="Draw or split a parcel boundary"]').click({ timeout: 5000 }); } },
  { name: "planner-file-menu.png", seed: true, prep: async (p) => { await fitFirst(p); await p.locator('button:has-text("File ▾")').click({ timeout: 5000 }); } },
  { name: "planner-shortcuts.png", seed: true, prep: async (p) => { await p.locator('[title="Keyboard shortcuts (?)"]').click({ timeout: 5000 }); } },
  { name: "planner-mobile.png", seed: true, viewport: { width: 390, height: 844 }, prep: fitFirst },
  { name: "map.png", seed: false },
  { name: "map-sites.png", rawSeed: mapSitesSeed },
  { name: "doc-review.png", seed: false, prep: async (p) => {
      await p.locator('[title="Switch module"]').click({ timeout: 5000 });
      await p.getByRole("menuitem", { name: "Document Review" }).click({ timeout: 5000 });
      await p.waitForTimeout(1200);
    } },
];

async function shot(browser, s) {
  const ctx = await browser.newContext({ viewport: s.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(s.rawSeed || seedScript(s.seed));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  if (s.prep) { try { await s.prep(page); } catch (e) { console.warn(`  prep(${s.name}) warn:`, e.message); } }
  await page.waitForTimeout(650);
  await page.screenshot({ path: OUT + s.name });
  console.log("  saved", s.name);
  await ctx.close();
}

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
console.log("Capturing →", OUT);
for (const s of SHOTS) await shot(browser, s);
await browser.close();
console.log("done.");
