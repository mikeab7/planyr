/* V245 (B715) live-look verification: site acreage DISSOLVES overlapping ACTIVE parcels (counts
 * shared ground once), on the real running app — a hand-drawn overlap (no sign-in / HCAD import
 * needed; the dissolve math is agnostic to where a parcel boundary came from).
 *
 * Geometry: two 200x100 rectangles overlapping by a 100x100 square.
 *   additive (WRONG if not dissolved): 20,000 + 20,000 = 40,000 sf = 0.9183 ac
 *   dissolved (CORRECT): 40,000 - 10,000 overlap = 30,000 sf = 0.6887 ac
 * Confirms the Yield panel donut/row AND the Site Analysis header agree on the dissolved figure,
 * the B652 "active parcels overlap" banner names both parcels with the right overlap acreage, and
 * a normal NON-overlapping site's acreage is the plain additive sum (fast path unchanged).
 *
 * Run: node ui-audit/verify-v245-parcel-dissolve-live.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const rect = (id, x0, y0, x1, y1) => ({ id, locked: false, active: true, points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });

async function runScenario({ id, label, parcels, expectAcres, expectOverlapBanner, expectOverlapAcres }) {
  console.log(`\n== ${label} ==`);
  const demoSite = {
    id, groupId: id, site: label, name: "Plan 1",
    // A real-world origin (Katy, TX) so Site Analysis mounts (it needs a georeferenced plan) —
    // the acreage header is pure local geometry, independent of the GIS screening rows below it.
    origin: { lat: 29.782, lon: -95.795 }, county: "harris", parcels, els: [], measures: [], callouts: [],
    markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [id]: demoSite })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)});
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
  await page.waitForTimeout(500);

  // Yield panel (docked by default? open it via the rail if not already visible)
  const yieldBtn = page.locator('button[title="Yield"]').first();
  if (await yieldBtn.count()) {
    const pressed = await yieldBtn.getAttribute("aria-pressed");
    if (pressed !== "true") await yieldBtn.click();
  }
  await page.waitForTimeout(400);
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const siteAreaMatch = bodyText.match(/Site area\s+([\d.]+)\s*ac/);
  log(!!siteAreaMatch, `Yield "Site area" row present (${siteAreaMatch ? siteAreaMatch[1] + " ac" : "NOT FOUND"})`);
  if (siteAreaMatch) {
    const got = parseFloat(siteAreaMatch[1]);
    log(Math.abs(got - expectAcres) < 0.02, `Yield site acreage = ${got} ac (expected ~${expectAcres.toFixed(2)} ac)`);
  }

  // Site Analysis header
  await page.locator('button[title="Analysis"]').first().click();
  await page.waitForTimeout(400);
  const analysisText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const analysisMatch = analysisText.match(/·\s*([\d.]+)\s*ac\b/);
  log(!!analysisMatch, `Site Analysis header acreage present (${analysisMatch ? analysisMatch[1] + " ac" : "NOT FOUND"})`);
  if (analysisMatch) {
    const got = parseFloat(analysisMatch[1]);
    log(Math.abs(got - expectAcres) < 0.02, `Site Analysis acreage = ${got} ac — MATCHES Yield (${expectAcres.toFixed(2)} ac)`);
  }

  // B652 overlap banner
  const hasBanner = /Active parcels overlap/i.test(bodyText) || /Active parcels overlap/i.test(analysisText);
  log(hasBanner === expectOverlapBanner, expectOverlapBanner
    ? `"⚠ Active parcels overlap" banner IS shown (as expected for overlapping parcels)`
    : `"⚠ Active parcels overlap" banner is ABSENT (as expected — no overlap in this scenario)`);
  if (expectOverlapBanner) {
    const overlapMatch = bodyText.match(/cover the same ground \(~([\d.]+) ac of overlap\)/);
    log(!!overlapMatch, `banner reports the overlap acreage (${overlapMatch ? overlapMatch[1] : "NOT FOUND"} ac)`);
    if (overlapMatch) log(Math.abs(parseFloat(overlapMatch[1]) - expectOverlapAcres) < 0.02, `overlap acreage = ${overlapMatch[1]} ac (expected ~${expectOverlapAcres.toFixed(2)} ac)`);
  }

  await page.screenshot({ path: OUT + `v245-${id}.png` });
  log(errors.length === 0, `no page errors (${errors.length})`);
  if (errors.length) fail += errors.length;
  await ctx.close();
}

// Scenario 1: two OVERLAPPING active parcels — dissolve must count the shared 100x100 once.
await runScenario({
  id: "verify-v245-overlap", label: "V245 Overlap Demo",
  parcels: [rect("pA", 0, 0, 200, 100), rect("pB", 100, 0, 300, 100)],
  expectAcres: 30000 / 43560, expectOverlapBanner: true, expectOverlapAcres: 10000 / 43560,
});

// Scenario 2: two DISJOINT active parcels — plain additive sum, unchanged from before B715.
await runScenario({
  id: "verify-v245-disjoint", label: "V245 Disjoint Demo",
  parcels: [rect("pA", 0, 0, 200, 100), rect("pB", 250, 0, 450, 100)],
  expectAcres: 40000 / 43560, expectOverlapBanner: false,
});

// Scenario 3: the map-finder "YOUR SITES" list — the THIRD surface named in the pending check
// ("Yield panel, Site Analysis, and the map-list tooltip all agree").
{
  console.log("\n== Map-finder site list agrees with the Yield/Analysis dissolved figures ==");
  const s1 = { id: "v245-list-overlap", groupId: "v245-list-overlap", site: "Overlap Site", name: "Plan 1", origin: { lat: 29.782, lon: -95.795 }, county: "harris", parcels: [rect("pA", 0, 0, 200, 100), rect("pB", 100, 0, 300, 100)], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), status: "active" };
  const s2 = { id: "v245-list-disjoint", groupId: "v245-list-disjoint", site: "Disjoint Site", name: "Plan 1", origin: { lat: 29.782, lon: -95.795 }, county: "harris", parcels: [rect("pA", 0, 0, 200, 100), rect("pB", 250, 0, 450, 100)], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), status: "active" };
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [s1.id]: s1, [s2.id]: s2 })}));
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE + "#/site-planner", { waitUntil: "load" });
  await page.waitForTimeout(2000);
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const mOverlap = t.match(/Overlap Site Active · ([\d.]+) ac/);
  const mDisjoint = t.match(/Disjoint Site Active · ([\d.]+) ac/);
  log(!!mOverlap && Math.abs(parseFloat(mOverlap[1]) - 0.7) < 0.05, `list shows the OVERLAP site at the DISSOLVED figure (${mOverlap ? mOverlap[1] : "?"} ac, expected ~0.7 — matches Yield/Analysis's 0.69)`);
  log(!!mDisjoint && Math.abs(parseFloat(mDisjoint[1]) - 0.9) < 0.05, `list shows the DISJOINT site at the plain additive figure (${mDisjoint ? mDisjoint[1] : "?"} ac, expected ~0.9 — matches Yield/Analysis's 0.92)`);
  await page.screenshot({ path: OUT + "v245-map-list.png" });
  await ctx.close();
}

console.log(fail === 0 ? "\n✓ ALL V245 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
