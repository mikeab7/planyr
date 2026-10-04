/* NEW-1 (California) — California county lines + city limits actually DRAW on a California site.
 *
 * The Georgia rows shipped (#1895) with no vector source behind them: turning either on toasted
 * "no vector source registered" and drew nothing, and every unit test stayed green. This is the same harness for
 * California: it drives the REAL built app at an Ontario, CA site, turns each row on, and asserts (a) no failure
 * toast, (b) the layer requested the CDT State Geoportal's own service, (c) vector geometry is on the map — and it carries a
 * KNOWN-GOOD ARM (FOUNDATION: a row that must already work, a Texas row on a Texas site, is run the same way
 * and must draw) so an instrument that cannot see a drawn layer voids the run instead of scoring it.
 *
 * Needs outbound HTTPS to services2.arcgis.com. From the build sandbox that goes through the agent proxy:
 * set PW_PROXY (defaults to $HTTPS_PROXY). Exits 2 (VOID) rather than 0 if the network is unreachable. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PROXY = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";

const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county) => ({
  id, groupId: id, site: `Site ${id}`, name: "Concept A",
  origin: { lat, lon }, county,
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now(),
});
const SITES = { CA1: mkSite("CA1", 34.0633, -117.5931, "ca_statewide"), TX1: mkSite("TX1", 29.7836, -95.8244, "harris") };

const launch = { executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] };
// Chromium flags, not Playwright's `proxy` option: the latter sent localhost through the relay too (the app never loaded).
if (PROXY) launch.args.push("--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch(launch);
let fail = 0, voided = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

async function run(siteId, rowText, urlNeedle) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(SITES)}));localStorage.setItem('planarfit:currentSite:v1','${siteId}');}}catch(e){}})()`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-california-lines");
  const seen = [];
  page.on("response", (r) => { if (r.url().includes(urlNeedle)) seen.push(r.status()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  // The app opens on the Dashboard; the planner is the "Site" tab.
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(3500);
  if (!(await page.locator("label:visible", { hasText: rowText }).count())) {
    const btn = page.locator("button:visible", { hasText: "Layers" }).first();
    try { await btn.click({ timeout: 4000 }); } catch (_) {}
    await page.waitForTimeout(500);
  }
  const label = page.locator("label:visible", { hasText: rowText }).first();
  let present = true;
  try { await label.waitFor({ state: "visible", timeout: 5000 }); } catch (_) { present = false; }
  const before = await page.evaluate(() => document.querySelectorAll(".leaflet-pane svg path, .leaflet-pane canvas").length);
  if (present) await label.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(9000);
  const after = await page.evaluate(() => ({
    geom: document.querySelectorAll(".leaflet-pane svg path").length,
    canvases: document.querySelectorAll(".leaflet-pane canvas").length,
    text: document.body.innerText,
  }));
  await ctx.close();
  return { present, before, after, seen };
}

console.log("— known-good arm: Texas county lines on a Texas site —");
const tx = await run("TX1", "County boundaries", "Texas_County_Boundaries");
check("Texas row present", tx.present);
if (!tx.seen.length) { console.log("  VOID — the browser could not reach the TxDOT service (network egress); this run measures nothing."); voided++; }
else {
  check("Texas county layer requested its service", tx.seen.some((s) => s === 200));
  check("Texas county lines DRAW (the instrument can see a drawn layer)", tx.after.geom + tx.after.canvases > tx.before);
}

for (const [row, needle, label] of [["County boundaries (California)", "California_County_Boundaries_and_Identifiers", "county"], ["City limits (California)", "California_Cities_and_Identifiers", "city"]]) {
  console.log(`— California ${label} —`);
  const ga = await run("CA1", row, needle);
  check(`${row} row present`, ga.present);
  check("no 'no vector source registered' / 'failed' toast", !/no vector source registered|layer failed/i.test(ga.after.text), (ga.after.text.match(/[^\n]*(?:layer failed|no vector source)[^\n]*/i) || [""])[0]);
  check("it requested the CDT State Geoportal's own service", ga.seen.length > 0, `statuses ${JSON.stringify(ga.seen)}`);
  check("the CDT service answered 200", ga.seen.some((s) => s === 200));
  check("vector geometry is on the map", ga.after.geom + ga.after.canvases > ga.before, `${ga.before} → ${ga.after.geom} paths + ${ga.after.canvases} canvases`);
  check("the row no longer says it has no source wired up", !/doesn.t have a data source wired up/i.test(ga.after.text));
}

/* The header badge on a California site — the user-visible half of NEW-1. Reads `data-jurisdiction-full` (the
 * badge's untruncated text), asserts the right city + county and NO ETJ wording, and runs the Texas site as the
 * known-good control (its badge must not say California). */
async function badge(siteId) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(SITES)}));localStorage.setItem('planarfit:currentSite:v1','${siteId}');}}catch(e){}})()`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-california-lines");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(12000);
  const full = await page.evaluate(() => Array.from(document.querySelectorAll("[data-jurisdiction-full]")).map((n) => n.getAttribute("data-jurisdiction-full")).filter(Boolean));
  await ctx.close();
  return full;
}
console.log("— header badge —");
const caBadge = await badge("CA1");
console.log("  CA site badge:", JSON.stringify(caBadge));
check("California badge names the city and county", caBadge.some((t) => /City of Ontario, CA/.test(t) && /San Bernardino County/.test(t)));
check("California badge never says ETJ", !caBadge.some((t) => /etj/i.test(t)));
const txBadge = await badge("TX1");
console.log("  TX site badge:", JSON.stringify(txBadge));
check("known-good arm: the Texas site's badge is not California's", !txBadge.some((t) => /, CA\b|California/.test(t)));
await browser.close();
if (voided) { console.log("VOID"); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
