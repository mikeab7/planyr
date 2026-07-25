/* Road-connection defect reproduction — against the OWNER'S REAL PLAN, not a mock.
 *
 * Seeds the actual Tsakiris / Concept A element set (pulled from Supabase site smrjdgmlinea)
 * into the logged-out store and parks the viewport on each junction the owner screenshotted:
 *   J1  road→road tee, 40' aisle into the 40' truck loop, ~90°   (e1454683splyoj → e38duuwgj)
 *   J2  road→road tee, 36' aisle into the 40' aisle,  ~57° skew  (e1454692rfhccx → e1454683splyoj)
 *   J3  road→road tee, the same 36' aisle into the truck loop    (e1454692rfhccx → e38duuwgj)
 *   J4  road→parking drive on the fire lane                      (e1454682splyoj → e52duuwgj)
 *   J5  road↔road end-to-end weld south of the pond              (e1454683splyoj ↔ e54duuwgj)
 * and dumps, per junction, what the render path actually emitted (cover polys, return arcs,
 * knockout holes) so a miss is attributable to DETECTION vs GEOMETRY vs PAINT ORDER.
 *
 * Run:  node ui-audit/diagnose-road-junctions.mjs            (needs preview on :4173)
 *       LABEL=after node ui-audit/diagnose-road-junctions.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const LABEL = process.env.LABEL || "before";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const FIXTURE = process.env.FIXTURE || "tsakiris-concept-a.json";
const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${FIXTURE}`, import.meta.url), "utf8"));
const SITE_ID = "tsakiris-concept-a";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A",
  origin: null, county: "waller", parcels: [], els: fixture.els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};

const JUNCTIONS = [
  { key: "J1-road-road-straight-tee", x: 543.9, y: 450.5, ppf: 1.6, note: "40' aisle tees into the 40' truck loop, ~90deg" },
  { key: "J2-road-road-oblique-tee", x: 545.2, y: 206.1, ppf: 1.6, note: "36' aisle tees into the 40' aisle at ~57deg" },
  { key: "J3-road-road-oblique-tee-2", x: 389.3, y: 450.2, ppf: 1.6, note: "36' aisle tees into the truck loop at ~20deg" },
  { key: "J4-drive-to-parking", x: -216.8, y: 446.0, ppf: 1.6, note: "fire lane drive onto the parking field" },
  { key: "J5-road-road-weld", x: 549.4, y: -321.7, ppf: 1.6, note: "aisle welds end-to-end onto the truck stub" },
  { key: "OVERVIEW-east", x: 470, y: 330, ppf: 0.42, note: "the whole east cluster the owner screenshotted" },
  { key: "J6-pond-west-skew-tee", x: 240, y: 300, ppf: 1.6, note: "36' aisle into the truck loop by the pond (the redrawn one)" },
  { key: "J6z-fork-crotch", x: 232, y: 292, ppf: 5.5, note: "the crotch of the pond-west fork, zoomed hard" },
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });

// ---- what did the render path actually emit? -------------------------------------------
const emitted = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  return {
    networkLayer: !!document.querySelector('[data-testid="road-network-layer"]'),
    networkRegions: q('[data-testid="road-network-surface"]').length,
    networkEdges: q('[data-testid="road-network-edge"]').length,
    clusters: q("[data-road-cluster]").map((n) => n.getAttribute("data-road-cluster")),
    // legacy patch render — must be GONE
    legacyCovers: q('[data-export="road-tee-cover"]').length,
    legacyReturns: q('[data-testid="road-tee-return"]').length,
    legacyMask: !!document.querySelector("#tee-cover-knockout"),
  };
});
console.log(`\n=== RENDER PATH EMISSION (${LABEL}) ===`);
console.log(JSON.stringify(emitted, null, 2));

for (const j of JUNCTIONS) {
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [j.x, j.y, j.ppf]);
  await page.waitForTimeout(450);
  const path = `${OUT}${LABEL}-${j.key}.png`;
  await page.locator('[data-testid="planner-canvas"]').screenshot({ path });
  console.log(`shot  ${j.key.padEnd(28)} ${j.note}`);
}

if (errors.length) console.log("\nPAGE ERRORS:\n" + errors.slice(0, 10).join("\n"));
console.log(`\nscreens → ${OUT}`);
await browser.close();
