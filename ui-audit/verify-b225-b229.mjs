/* Self-verification for B225–B229 (Site map finder).
 *   B227 — shared status tokens on pins + chips + list markers
 *   B228 — left-rail rework: chips-as-filters, type-to-filter, collapsible groups
 *   B229 — per-layer source-vintage stamp
 *   B225/B226 — address search recenters + selects parcel + info (UI wiring; the
 *               live geocode/parcel calls may be blocked by the sandbox proxy, so
 *               we assert the flow runs and SOME honest state results, not the網).
 * Logged-out / this-device mode (no auth). Run with the preview server on :4173.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/b225-b229/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Token colors we expect to see (B227).
const TOK = { pursuit: "#378ADD", active: "#639922", onhold: "#BA7517", complete: "#888780", dead: "#E24B4A" };

// Seven sites clustered near the Harris default center so the pins sit on-screen
// at the landing zoom. status is TOP-LEVEL (statusOf reads site.status for raw seeds).
const mk = (id, site, status, lat, lon) => ({ id, groupId: id, site, name: "Plan 1", status, origin: { lat, lon }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() });
const sites = {
  a1: mk("a1", "Katy Active One", "active", 29.78, -95.39),
  a2: mk("a2", "Brookshire Active Two", "active", 29.77, -95.37),
  p1: mk("p1", "Cypress Pursuit", "pursuit", 29.76, -95.40),
  h1: mk("h1", "Bear Creek On Hold", "onhold", 29.75, -95.38),
  c1: mk("c1", "Spring Complete", "complete", 29.79, -95.36),
  c2: mk("c2", "Tomball Complete Two", "complete", 29.74, -95.41),
  d1: mk("d1", "Humble Dead Deal", "dead", 29.73, -95.36),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesGroups:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "PASS" : "FAIL"} — ${name}${extra ? " · " + extra : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  // ---- B227: pins paint in the status-token colors ----
  const fills = await page.$$eval(".leaflet-marker-icon svg path", (ps) =>
    ps.map((p) => ({ fill: p.getAttribute("fill"), stroke: p.getAttribute("stroke") })));
  const allCols = fills.flatMap((f) => [f.fill, f.stroke]).filter(Boolean).map((c) => c.toLowerCase());
  ok("pins render", fills.length >= 5, `${fills.length} pin paths`);
  ok("B227 active pin = green #639922", allCols.includes(TOK.active.toLowerCase()));
  ok("B227 pursuit pin = blue #378ADD (hollow stroke)", allCols.includes(TOK.pursuit.toLowerCase()));
  ok("B227 onhold pin = amber #BA7517", allCols.includes(TOK.onhold.toLowerCase()));
  ok("B227 complete pin = gray #888780", allCols.includes(TOK.complete.toLowerCase()));
  ok("B227 dead pin = red #E24B4A", allCols.includes(TOK.dead.toLowerCase()));
  // module accent colors must NOT appear as a pin (the bug B227 closes)
  ok("B227 module amber #EF9F27 NOT used as a pin", !allCols.includes("#ef9f27"));
  ok("B227 module teal #1D9E75 NOT used as a pin", !allCols.includes("#1d9e75"));

  // ---- B228: type-to-filter exists; collapsible groups; chips filter ----
  const nameInput = page.locator('input[placeholder="Filter by name…"]');
  ok("B228 type-to-filter input present", (await nameInput.count()) === 1);

  // Expanded sections (Active/Pursuit/On Hold) show their rows; Complete/Dead collapsed.
  const rowVisible = async (txt) => (await page.locator(`div:has-text("${txt}")`).filter({ hasText: txt }).count()) > 0 && await page.getByText(txt, { exact: false }).first().isVisible().catch(() => false);
  ok("B228 active row visible by default", await rowVisible("Katy Active One"));
  // A Complete site's row should be hidden initially (group collapsed by default).
  const completeRowVisibleBefore = await page.getByText("Spring Complete", { exact: false }).first().isVisible().catch(() => false);
  ok("B228 Complete group collapsed by default (row hidden)", !completeRowVisibleBefore);
  // Expand Complete by clicking its SECTION HEADER (title="Expand"), not the chip.
  await page.locator('button[title="Expand"]').filter({ hasText: "Complete" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const completeRowVisibleAfter = await page.getByText("Spring Complete", { exact: false }).first().isVisible().catch(() => false);
  ok("B228 expanding Complete reveals its rows", completeRowVisibleAfter);
  // collapse it again to restore the default state
  await page.locator('button[title="Collapse"]').filter({ hasText: "Complete" }).first().click().catch(() => {});
  await page.waitForTimeout(200);

  await page.screenshot({ path: OUT + "left-rail-default.png" });

  // Type-to-filter narrows the list — AND auto-expands a match in a collapsed group
  // (Tomball is a Complete site; the group is collapsed by default).
  await nameInput.fill("Tomball");
  await page.waitForTimeout(300);
  const katyAfterFilter = await page.getByText("Katy Active One", { exact: false }).first().isVisible().catch(() => false);
  const tomballAfterFilter = await page.getByText("Tomball Complete Two", { exact: false }).first().isVisible().catch(() => false);
  ok("B228 type-to-filter hides non-matches", !katyAfterFilter);
  ok("B228 type-to-filter surfaces a match even in a collapsed group", tomballAfterFilter);
  await nameInput.fill("");
  await page.waitForTimeout(200);

  // Chip filter: click the Active CHIP (title mentions "show only this status") → only
  // active pins remain on the map.
  const pinsBefore = await page.locator(".leaflet-marker-icon").count();
  await page.locator('button[title*="show only this status"]').filter({ hasText: "Active" }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const pinsAfter = await page.locator(".leaflet-marker-icon").count();
  ok("B228 chip filter narrows the map pins", pinsAfter > 0 && pinsAfter < pinsBefore, `${pinsBefore} → ${pinsAfter}`);
  await page.screenshot({ path: OUT + "chip-filter-active.png" });
  // clear the chip filter (click the same Active chip again to toggle off)
  await page.locator('button[title*="remove from the filter"]').filter({ hasText: "Active" }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  // ---- B229: layer source-vintage stamp ----
  // Toggle the first layer (FEMA flood zones) ON and look for the "as of:" line.
  const femaToggle = page.getByText("FEMA flood zones", { exact: false }).first();
  await femaToggle.scrollIntoViewIfNeeded().catch(() => {});
  // the checkbox is the sibling input in the same label
  await page.locator('label:has-text("FEMA flood zones") input[type="checkbox"]').first().check().catch(() => {});
  await page.waitForTimeout(400);
  const asOfCount = await page.getByText(/as of:/i).count();
  ok("B229 vintage 'as of:' stamp appears when a layer is on", asOfCount >= 1, `${asOfCount} stamps`);
  const asOfText = asOfCount ? await page.getByText(/as of:/i).first().innerText() : "";
  ok("B229 vintage stamp shows the FIRM-panel vintage (honest, not a fake date)", /FIRM panel/i.test(asOfText), asOfText);
  await page.screenshot({ path: OUT + "layer-vintage.png" });

  // ---- B225/B226: address search wiring ----
  const search = page.locator('input[placeholder*="Find a site"]');
  ok("B225 address search input present", (await search.count()) === 1);
  const goBtn = page.getByRole("button", { name: /^Go$/ });
  ok("B225 Go button present", (await goBtn.count()) >= 1);
  await search.fill("19630 Crossbranch Dr, Katy, TX");
  await goBtn.first().click().catch(() => {});
  await page.waitForTimeout(6000); // allow geocode + identify (or their failure) to settle
  const infoCard = await page.getByText(/No parcel at this point|Parcel info unavailable/i).count()
    + await page.locator('button:has-text("Plan this site")').count();
  const errToast = await page.getByText(/Couldn.t find that address|Address search is unavailable/i).count();
  ok("B225/B226 Go produced an honest result (info card or error), not a silent no-op", (infoCard + errToast) >= 1,
     infoCard ? "parcel info card shown" : errToast ? "honest error shown (network blocked in sandbox)" : "none");
  await page.screenshot({ path: OUT + "address-search-result.png" });

  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
