/**
 * Visual verification for B159 building+arc markers.
 * Seeds one site per status variant (status at TOP LEVEL — not inside data:{}).
 * Takes one wide-angle shot showing all 4 markers, then crops each marker individually.
 *
 * Run:  node ui-audit/verify-markers.mjs
 * (preview server must be running on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/markers/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Four sites spread around a central lat/lon so all markers are visible on-screen.
// status is TOP LEVEL on each site object — that's what statusOf() reads.
const CENTER = { lat: 29.783, lon: -95.89 };
// Sites clustered near Harris county default center (29.76, -95.37) so they're
// visible at the map's default zoom 11 without needing a "Fit all" button.
const fourSites = {
  s_active:   { id: "s_active",   groupId: "s_active",   site: "Katy Active Site",    name: "Plan 1", status: "active",   origin: { lat: 29.77, lon: -95.38 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_complete: { id: "s_complete", groupId: "s_complete", site: "Brookshire Complete",  name: "Plan 1", status: "complete", origin: { lat: 29.77, lon: -95.36 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_onhold:   { id: "s_onhold",   groupId: "s_onhold",   site: "Bear Creek On Hold",  name: "Plan 1", status: "onhold",   origin: { lat: 29.75, lon: -95.38 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_pursuit:  { id: "s_pursuit",  groupId: "s_pursuit",  site: "Cypress Pursuit",     name: "Plan 1", status: "pursuit",  origin: { lat: 29.75, lon: -95.36 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(fourSites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(3000); // allow aerial tiles time to load

  // The map finder shows a "Your sites" panel; click "Fit all" to centre on the 4 markers.
  try {
    await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(1200);
  } catch (e) {
    console.warn("  fit-all not found:", e.message);
  }

  // Wide overview — all 4 markers visible.
  await page.screenshot({ path: OUT + "overview.png" });
  console.log("  saved overview.png");

  // Grab the marker elements. They are Leaflet divIcon containers (.leaflet-marker-icon).
  const markers = await page.locator(".leaflet-marker-icon").all();
  console.log(`  found ${markers.length} .leaflet-marker-icon elements`);

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    // Log the inner HTML so we can confirm the SVG path + colors.
    const html = await m.innerHTML().catch(() => "(unreadable)");
    const fillMatch  = html.match(/fill="([^"]+)"/);
    const strokeMatch = html.match(/stroke="([^"]+)"/);
    const dashMatch  = html.includes("stroke-dasharray=\"4 2.5");
    console.log(`  marker[${i}] fill=${fillMatch?.[1]} stroke=${strokeMatch?.[1]} dashed=${dashMatch}`);

    // Screenshot each marker with 30px padding so the ring is fully visible.
    try {
      const box = await m.boundingBox();
      if (box) {
        const pad = 32;
        await page.screenshot({
          path: OUT + `marker-${i}.png`,
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width:  box.width  + pad * 2,
            height: box.height + pad * 2,
          },
        });
        console.log(`  saved marker-${i}.png`);
      }
    } catch (e) {
      console.warn(`  marker[${i}] screenshot failed:`, e.message);
    }
  }

  await ctx.close();
  await browser.close();
  console.log("done.");
}

run().catch((e) => { console.error(e); process.exit(1); });
