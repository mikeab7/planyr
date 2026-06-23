/* Verify B191–B193 — shared-header project switcher.
 *
 * Logged-out (sandbox proxy blocks sign-in), so we seed two located projects into the
 * legacy local store and drive the live built app on :4173. Checks: the breadcrumb
 * renders in every workspace (Site map, Markup, Schedule); the dropdown is portal-
 * mounted with search + "All projects" + recent projects (newest-first w/ timestamps)
 * + "New project"; selecting a project loads it in place; the Dashboard crumb routes
 * back to the all-projects map; search filters.
 *
 * Run:  npm run build && npx vite preview   (separate shell)
 *       node ui-audit/verify-new1to3.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const sites = {
  k1: { id: "k1", groupId: "k1", site: "Katy Logistics Park", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, status: "active",  updatedAt: now - 2 * 60 * 1000 },
  b2: { id: "b2", groupId: "b2", site: "Brookshire Tract",   name: "Plan 1", origin: { lat: 29.78,  lon: -95.95 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, status: "pursuit", updatedAt: now - 3 * 60 * 60 * 1000 },
  s3: { id: "s3", groupId: "s3", site: "Schiel Road",        name: "Plan 1", origin: { lat: 29.74,  lon: -95.80 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, status: "onhold",  updatedAt: now - 5 * 24 * 60 * 60 * 1000 },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

const shot = async (n) => { await page.screenshot({ path: OUT + n }); console.log("  saved", n); };

// ── 1. Breadcrumb renders on the map (Dashboard crumb + project crumb) ──
const dashCrumb = page.locator('button[title="All projects — Dashboard"]:visible');
await ok("Dashboard crumb visible (B192)", await dashCrumb.isVisible());
await ok("Dashboard crumb is literal text", (await dashCrumb.innerText()).trim().includes("Dashboard"));
const projCrumb = page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first();
await ok("Project crumb visible (B191)", await projCrumb.isVisible());
await ok("Map shows 'Select a project' (no current project)", (await projCrumb.innerText()).includes("Select a project"));
await shot("new1to3-map-breadcrumb.png");

// ── 2. Dropdown opens (portal), has search + All projects + recents + New project ──
await projCrumb.click();
await page.waitForTimeout(400);
const search = page.locator('input[placeholder="Search projects…"]');
await ok("Dropdown search field present", await search.isVisible());
const allProj = page.locator('button:has-text("All projects (Dashboard)")');
await ok('"All projects (dashboard)" row pinned', await allProj.isVisible());
const newProj = page.locator('button:has-text("New project")');
await ok('"New project" action at bottom', await newProj.isVisible());
// recent projects newest-first: Katy (2m) before Brookshire (3h) before Schiel (5d)
const rowTexts = await page.locator('button:has-text("ago"), button:has-text("Katy"), button:has-text("Brookshire"), button:has-text("Schiel")').allInnerTexts();
const order = ["Katy Logistics Park", "Brookshire Tract", "Schiel Road"].map((n) => rowTexts.findIndex((t) => t.includes(n)));
await ok("Recent projects newest-edited first", order[0] >= 0 && order[0] < order[1] && order[1] < order[2], JSON.stringify(rowTexts.filter((t) => /Katy|Brookshire|Schiel/.test(t))));
await ok("Relative timestamps shown", rowTexts.some((t) => /ago/.test(t)), rowTexts.find((t) => /ago/.test(t)) || "");
// portal-mounted: the menu lives at <body> > div, not inside <header>
const portaled = await page.evaluate(() => {
  const inp = document.querySelector('input[placeholder="Search projects…"]');
  if (!inp) return false;
  return !inp.closest("header"); // escaped the header's stacking context
});
await ok("Dropdown portal-mounted outside <header>", portaled);
await shot("new1to3-dropdown.png");

// ── 3. Search filters ──
await search.fill("brook");
await page.waitForTimeout(300);
const brookVisible = await page.locator('button:has-text("Brookshire Tract")').isVisible();
const katyGone = await page.locator('div[role="dialog"], body').locator('button:has-text("Katy Logistics Park")').count();
await ok("Search filters by name", brookVisible && katyGone === 0, `brook=${brookVisible} katyRows=${katyGone}`);
await shot("new1to3-search.png");

// ── 4. Selecting a project loads it in place ──
await page.locator('button:has-text("Brookshire Tract")').click();
await page.waitForTimeout(1400);
const projCrumb2 = page.locator('button[title="Switch project"]:visible').first();
const loaded = (await projCrumb2.innerText()).includes("Brookshire Tract");
await ok("Selecting a project loads it (breadcrumb shows it)", loaded, await projCrumb2.innerText().catch(() => ""));
await shot("new1to3-project-loaded.png");

// ── 5. Dashboard crumb routes back to the all-projects map ──
await page.locator('button[title="All projects — Dashboard"]:visible').click();
await page.waitForTimeout(1000);
const backToMap = await page.locator('input[placeholder="Find a site — address or place…"]').isVisible().catch(() => false);
await ok("Dashboard crumb returns to all-projects map (B192)", backToMap);
await shot("new1to3-back-to-dashboard.png");

// ── 6. Breadcrumb present in Markup + Schedule (shared header) ──
await page.locator('button:has-text("Library"):visible').first().click();
await page.waitForTimeout(1200);
await ok("Breadcrumb present in Markup", await page.locator('button[title="All projects — Dashboard"]:visible').isVisible());
await shot("new1to3-markup.png");

await page.locator('button:has-text("Schedule"):visible').first().click();
await page.waitForTimeout(1200);
await ok("Breadcrumb present in Schedule", await page.locator('button[title="All projects — Dashboard"]:visible').isVisible());
await shot("new1to3-schedule.png");

// ── 7. Cross-workspace: pick a project from Schedule → lands in Site Planner ──
await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Katy Logistics Park")').click();
await page.waitForTimeout(1500);
const inPlanner = (await page.locator('button[title="Switch project"]:visible').first().innerText().catch(() => "")).includes("Katy");
await ok("Cross-workspace open routes into Site Planner (B191)", inPlanner);
await shot("new1to3-crossworkspace.png");

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
console.log("ALL PASS");
