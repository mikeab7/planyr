/* B205 verification — in the Site planner (plan mode) the redundant center "‹ Map"
 * back-button is gone, and the Row-1 breadcrumb's "Map" crumb is the single way back to
 * the map (and it works). We seed a site + currentSite so the app boots into the planner. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const ID = "mapcrumb-demo";
const parcel = { id: "pc1", locked: false, points: [{ x: -200, y: -150 }, { x: 200, y: -150 }, { x: 200, y: 150 }, { x: -200, y: 150 }] };
const site = { id: ID, groupId: ID, site: "SCHIEL", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [ID]: site }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(ID)});
} catch (e) {} })();`;

const results = [];
const ok = (name, cond, extra = "") => { results.push(!!cond); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Both AppHeaders are in the DOM (map-mode hidden via display:none, plan-mode shown),
  // so every query is scoped to VISIBLE elements (offsetParent !== null).
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /SCHIEL/.test(b.innerText) && b.offsetParent !== null), { timeout: 15000 });
  await page.waitForTimeout(500);

  // We should be in the planner (plan mode): the site switcher is visible.
  const inPlanner = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /SCHIEL/.test(b.innerText) && b.offsetParent !== null));
  ok("Booted into the planner (plan mode)", inPlanner);

  // (B205) No redundant, VISIBLE center "‹ Map" back button anymore.
  const backBtns = await page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null;
    const byTitle = [...document.querySelectorAll('button')].filter(b => vis(b) && (b.getAttribute('title') || "").toLowerCase().includes("back to the map"));
    const byText = [...document.querySelectorAll('button')].filter(b => vis(b) && b.innerText.trim() === "‹ Map");
    return { byTitle: byTitle.length, byText: byText.length };
  });
  ok('No center "‹ Map" back button in the planner header', backBtns.byTitle === 0 && backBtns.byText === 0, JSON.stringify(backBtns));

  // The visible breadcrumb "Map" crumb is present (the single way back).
  const homeCrumb = await page.evaluate(() => { const b = [...document.querySelectorAll('button[title^="All projects —"]')].find(x => x.offsetParent !== null); return b ? b.innerText.trim() : null; });
  ok('Breadcrumb home crumb reads "Map"', homeCrumb === "Map", `got "${homeCrumb}"`);

  // Clicking it returns to the map finder (the address search appears).
  await page.evaluate(() => { const b = [...document.querySelectorAll('button[title^="All projects —"]')].find(x => x.offsetParent !== null); if (b) b.click(); });
  await page.waitForTimeout(900);
  const onMap = await page.evaluate(() => { const i = document.querySelector('input[placeholder^="Find a site"]'); return !!(i && i.offsetParent !== null); });
  ok('Clicking "Map" returns to the map finder', onMap);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 4 ? 0 : 1);
}
