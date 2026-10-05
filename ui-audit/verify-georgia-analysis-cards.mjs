/* NEW-1 (B2095744) — the Site Analysis panel on a Georgia site renders NO Texas-institution card and names no Texas agency.
 * Owner report (Michael's Adairsville plan, build b8658dc): 'Leaking petroleum tanks (TCEQ LPST)', 'Water service (CCN)',
 * 'Sewer service (CCN)', 'Active surface faults' and 'Oil & gas wells' each read "Not screened in Georgia".
 *   GA ARM        a Bartow Co. (Adairsville) site: none of those card titles, no TCEQ / TxDOT / RRC / CCN / LPST text anywhere in
 *                 the panel; the generic checks (Road authority, Traffic counts) read "Not screened in Georgia"; the Georgia EPD
 *                 UST card is present.
 *   KNOWN-GOOD    a Katy TX site still shows the Texas cards by their Texas names — an instrument that cannot see a card VOIDS the run.
 *   npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-georgia-analysis-cards.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;
const PROXY = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";
const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county) => ({ id, groupId: id, site: `Throwaway ${id}`, name: "Concept A", origin: { lat, lon }, county, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() });
let fail = 0;
const check = (n, ok, x = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`); if (!ok) fail++; };

async function analysisText(site, { mockAll = false } = {}) {
  const launch = { ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] };
  if (PROXY) launch.args.push("--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1");
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ [site.id]: site })}));localStorage.setItem('planarfit:currentSite:v1','${site.id}');}}catch(e){}})()`);
  // The Texas hosts hang from this sandbox, which would leave the known-good arm on "Querying…" forever: answer every
  // external request with an empty feature set so the Texas cards RENDER (the arm asserts card NAMES, not data).
  if (mockAll) await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ features: [], count: 0, exceededTransferLimit: false }) }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-georgia-analysis-cards");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(3500);
  try { await page.locator("button:visible", { hasText: /^Analysis$/ }).first().click({ timeout: 5000 }); } catch (e) { console.log("  (no Analysis button)"); }
  await page.waitForTimeout(25000); // the fan-out is throttled; wait for it to settle
  const text = await page.evaluate(() => document.body.innerText);
  await browser.close();
  return text;
}
const TEXAS_AGENCY = /\b(TCEQ|TxDOT|RRC|Railroad Commission|CCN|LPST|growth fault)/i;

console.log("— Georgia site (Adairsville, Bartow Co.) —");
const ga = await analysisText(mkSite("GA1", 34.3687, -84.9344, "ga_bartow"));
check("the Analysis panel rendered (Road authority card present — the instrument can see cards)", /Road authority/i.test(ga));
for (const t of ["Leaking petroleum tanks", "Water service", "Sewer service", "Active surface faults", "Oil & gas wells"]) check(`no "${t}" card`, !new RegExp(t, "i").test(ga));
check("no Texas agency or concept name anywhere in the panel", !TEXAS_AGENCY.test(ga), (ga.match(TEXAS_AGENCY) || [""])[0]);
check("Traffic counts reads Not screened in Georgia (a generic check, neutral name)", /Traffic counts[\s\S]{0,200}Not screened in Georgia/i.test(ga));
check("the Georgia EPD underground-storage-tank card is present", /Underground storage tanks \(Georgia EPD\)/i.test(ga));

console.log("— Texas site (Katy) — known-good arm —");
const tx = await analysisText(mkSite("TX1", 29.7836, -95.8244, "harris"), { mockAll: true });
check("Texas still shows its cards by their Texas names", /TCEQ LPST|Leaking petroleum tanks \(TCEQ/i.test(tx) && /Water service \(CCN\)/i.test(tx) && /Active surface faults/i.test(tx));
if (!/Texas|TCEQ|CCN/i.test(tx)) { console.log("VOID — the known-good arm showed no Texas card"); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
