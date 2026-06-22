/* Verification for B383 — "Add parcel" action in the Parcel left-hand panel.
 *
 * The Parcel panel now leads with a primary ＋ Add parcel control (accent chip) that opens an
 * AnchoredMenu with the add methods:
 *   • Identify from county GIS  (headline; needs a georeferenced frame — disabled copy when origin is null)
 *   • Draw a new boundary       (always available — selectTool("parcel"))
 * The old standalone "🔍 Identify parcel" toggle is folded into that menu (no duplicate entry point);
 * the armed-status row + the identify result card stay as the body of the Identify path.
 *
 * Logged-out against the built app (vite preview on :4173). Seeds one LOCKED parcel — the default
 * every county-pulled / drawn lot carries. Scenario A: a georeferenced site (origin set → Identify
 * enabled). Scenario B: no origin → Identify shows the disabled copy, Draw still works.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: true, points: [{ x: -440, y: -200 }, { x: 440, y: -200 }, { x: 440, y: 320 }, { x: -440, y: 320 }] };
// NB: keep the site name free of the word "parcel" — Playwright text matching is case-insensitive
// substring, so a "…Parcel…" site name would collide with the ＋ Add parcel button locator.
const geoSite = {
  id: "uiaudit-b383", groupId: "uiaudit-b383", site: "Katy Tract Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
// A second site with NO georeferenced frame (origin null) → Identify must be disabled.
const noGeoSite = { ...geoSite, id: "uiaudit-b383b", groupId: "uiaudit-b383b", site: "Ungeoref Tract Demo", origin: null };

const seedFor = (site) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };
// The sandbox egress proxy CORS-blocks the external GIS hosts (FEMA/COH/etc.) the planner probes
// on load — that network noise is environmental, not an app bug. Count only genuine app errors.
const appErrors = (errs) => errs.filter((e) => !/CORS policy|Failed to load resource|net::ERR|ERR_FAILED|f=json|arcgis|houstontx|fema|usgs|esri/i.test(e));

async function openPlannerParcelPanel(site) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(site));
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1700);
  // The single restored parcel auto-selects → the Parcel panel auto-opens. Only click the rail
  // tab if it's NOT already open (the rail button TOGGLES, so a blind click would close it).
  const addBtn = page.locator('button[title^="Add land to this plan"]').first();
  if (!(await addBtn.isVisible().catch(() => false))) {
    try { await page.locator('button[title="Parcel"]').first().click({ timeout: 5000 }); } catch {}
    await page.waitForTimeout(500);
  }
  return { ctx, page, errors, addBtn };
}

// ---------- Scenario A: georeferenced plan (Identify enabled) ----------
console.log("Scenario A — georeferenced plan (Identify enabled):");
{
  const { ctx, page, errors, addBtn } = await openPlannerParcelPanel(geoSite);

  ok(await addBtn.count() > 0 && await addBtn.isVisible(), "＋ Add parcel button is present in the Parcel panel");

  // Primary salience: accent background (light #C2410C / dark #F26B3A) — not a plain chip.
  const bg = await addBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(["rgb(194, 65, 12)", "rgb(242, 107, 58)"].includes(bg), `＋ Add parcel reads as a primary action (accent bg: ${bg})`);

  // Open the menu → both add methods present.
  await addBtn.click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Identify from county GIS/).count() > 0, "menu shows 'Identify from county GIS'");
  ok(await page.getByText(/Draw a new boundary/).count() > 0, "menu shows 'Draw a new boundary'");
  await page.screenshot({ path: OUT + "b383-add-parcel-menu.png" }); // the ＋ Add parcel flyout, open

  // Identify is enabled here → clicking it arms identify mode (the status row appears).
  await page.getByText(/Identify from county GIS/).first().click();
  await page.waitForTimeout(350);
  const armed = page.getByText(/Identifying/).first();
  ok(await armed.count() > 0 && await armed.isVisible(), "clicking Identify arms identify mode (status row shows)");

  // The status row is the off-switch — clicking it stops identifying.
  await armed.click();
  await page.waitForTimeout(250);
  ok(await page.getByText(/Identifying/).count() === 0, "clicking the status row stops identifying");

  // Re-open the menu → Draw a new boundary → the parcel draw tool is armed (boundary hint shows).
  await addBtn.click();
  await page.waitForTimeout(300);
  await page.getByText(/Draw a new boundary/).first().click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Click to drop boundary points/).count() > 0, "'Draw a new boundary' arms the parcel draw tool (boundary hint shows)");

  // The folded-away standalone toggle should be gone (no "Identify parcel" entry point besides the menu).
  ok(await page.getByText(/🔍 Identify parcel/).count() === 0, "the old standalone '🔍 Identify parcel' toggle is consolidated away");

  await page.screenshot({ path: OUT + "b383-add-parcel-geo.png" });
  { const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS-CORS lines ignored)`); if (ae.length) console.log("    app errors:", ae.slice(0, 5)); }
  await ctx.close();
}

// ---------- Scenario B: no georeferenced frame (Identify disabled, Draw still works) ----------
console.log("Scenario B — no georeferenced frame (origin null):");
{
  const { ctx, page, errors, addBtn } = await openPlannerParcelPanel(noGeoSite);
  ok(await addBtn.count() > 0 && await addBtn.isVisible(), "＋ Add parcel button present even without a GIS frame");

  await addBtn.click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/needs a georeferenced plan/).count() > 0, "menu's Identify path shows the disabled 'needs a georeferenced plan' copy");
  ok(await page.getByText(/Draw a new boundary/).count() > 0, "Draw a new boundary still offered without a GIS frame");

  await page.getByText(/Draw a new boundary/).first().click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Click to drop boundary points/).count() > 0, "Draw works without origin (boundary hint shows)");

  await page.screenshot({ path: OUT + "b383-add-parcel-nogeo.png" });
  { const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS-CORS lines ignored)`); if (ae.length) console.log("    app errors:", ae.slice(0, 5)); }
  await ctx.close();
}

await browser.close();
console.log(`\nB383 verification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
