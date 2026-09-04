#!/usr/bin/env node
/* verify-place-comp-split-button — B848304: the map toolbar's "Drop a pin" / "Comp from parcel"
 * buttons plus the Site/Comp mode toggle's implied third meaning collapsed into ONE "Place comp"
 * split button (primary click = last-used anchor, caret = the three named ways to anchor a comp).
 *
 * Drives a real, unmocked Chromium session — logged out, no fixture needed (MapFinder is the
 * default landing screen for a session with no open plan), no external GIS needed for the "on the
 * map" and menu/stickiness checks. Reports the LITERAL rendered button label and LITERAL menu item
 * text at each step, per the owner's acceptance script.
 *
 * ⛔ "On a parcel" completing against a REAL parcel (owner acceptance step 2) is Blocker: live-GIS
 * in this sandbox — confirmed live: the ArcGIS World Geocoding Service the address search calls
 * (services.arcgis.com) is reachable through this environment's proxy, but the COUNTY parcel
 * services (e.g. gis.hcad.org) are not (403 at the CONNECT tunnel, not a timeout — the proxy's
 * allowlist excludes them). What IS proven here instead, without inventing a live parcel: (a) the
 * caret's "On a parcel" item correctly arms select-mode and updates stickiness — the NEW code this
 * item ships; (b) the underlying "fill the open row, never append a duplicate" mechanism the parcel
 * path shares with the pin path is UNTOUCHED by this change and is separately re-proven by
 * verify-comp-entry-p0.mjs's CYCLE 8 (mid-flow pin↔parcel switching on an armed row, 55/55 passing
 * against this exact build).
 *
 *   node ui-audit/verify-place-comp-split-button.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const report = (label, text) => console.log(`  ▸ ${label}: ${JSON.stringify(text)}`);

async function rowCount(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("td[data-cell]")];
    return new Set(cells.map((c) => c.dataset.cell.split("-")[0])).size;
  });
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-place-comp-split-button");
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await pacedWait(page, 800);

console.log("\n=== Mode toggle — renamed, not removed (drives the rail tab + toolbar workflow) ===");
{
  const tablist = page.locator('div[role="tablist"][aria-label="What an address search creates"]');
  check("the Site/Comp switch still exists, under its renamed accessible name", await tablist.count() === 1);
  const segTexts = await tablist.locator("button").allTextContents();
  report("switch segment labels", segTexts);
  // Deliberately still singular ("Site"/"Comp") — pluralizing collides with the rail tab's own
  // accessible name ("Comps 0"); the rename lives in the aria-label + per-segment tooltip instead
  // (see MapFinder.jsx's SiteCompSwitch header for the tried-and-reverted history).
  check('segments stay singular ("Site"/"Comp") — the rename is in the aria-label/tooltips, not the glyph', segTexts.join(",") === "Site,Comp");
  const segTitles = await tablist.locator("button").evaluateAll((els) => els.map((el) => el.title));
  report("switch segment tooltips", segTitles);
  check("both segments carry a tooltip explaining the real (browsing) job", segTitles.every((t) => t && t.length > 0));
}

console.log("\n=== Reach Comps, seed a sheet that already has a row (the append bug never shows on the first row) ===");
// ⛔ B850016 (NEW-11) — the rail "Comps" tab and the toolbar switch are now independent (see
// MapFinder.jsx's `mode`/`panelTab` state comments). Before that fix, clicking the rail tab ALSO
// armed `mode` to "comp" (the coupling bug), which is what used to make the toolbar's "Place comp"
// button appear below with no separate click. Now the toolbar switch must be armed explicitly,
// matching how a real user reaches this split button.
await page.locator('div[role="tablist"][aria-label="What an address search creates"] button', { hasText: "Comp" }).click();
await pacedWait(page, 150);
await page.getByRole("tab", { name: /^Comps/ }).first().click();
await pacedWait(page, 200);
await page.getByText("＋ Paste comps", { exact: true }).click();
await pacedWait(page, 200);
{
  const header = await page.locator('[data-comp-entry-panel] span').first().innerText();
  report("paste-grid dialog header", header);
  check('the paste-grid dialog is titled "Paste comps" (renamed from "New comps")', header === "Paste comps");
}
const textarea = page.locator("textarea").first();
await textarea.click();
await textarea.fill("West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
await page.keyboard.press("Enter");
await pacedWait(page, 400);
check("exactly 1 row exists before any placement (the pre-existing row this run's checks must not duplicate)", (await rowCount(page)) === 1);

console.log("\n=== STEP 1 — Click Place comp, click the map ===");
{
  const btn = page.getByRole("button", { name: "Place comp", exact: true });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  const label = await btn.innerText();
  report("Place comp button label (fresh session, nothing chosen yet)", label);
  check('reads bare "Place comp" before any anchor kind has been chosen this session', label === "Place comp");

  await btn.click();
  await pacedWait(page, 150);
  check('toolbar shows "Click the map to place a comp…" once armed', await page.getByText("Click the map to place a comp", { exact: false }).count() > 0);

  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + 150);
  await pacedWait(page, 3500); // resolveCompCounty races a 3s internal timeout with no network in this sandbox

  // The rail tab's own label+count run together ("Comps0") with no separator, distinguishing it
  // from the toolbar switch's bare "Comps" segment (same role, same leading text, no digit). Read
  // via evaluate rather than a Locator — the docked entry panel can cover the rail without
  // detaching it, and innerText()'s visibility wait is the wrong tool for "what does the DOM say".
  const railCompsText = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const t = tabs.find((el) => /^Comps\d/.test(el.textContent || ""));
    return t ? t.textContent : null;
  });
  report("rail Comps tab text (saved count, not the staged grid)", railCompsText);
  check("Comps counter (saved count) is unchanged by placement — it only arms/fills a row, never saves", railCompsText === "Comps0");
  check("row count is STILL 1 after the map pick — the existing row was filled, not duplicated", (await rowCount(page)) === 1);
  check("the existing row's Location is no longer the unset placeholder", await page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).count() === 0);
}

console.log("\n=== Add a second unlocated row (a second comp being entered), then STEP 2's caret mechanics ===");
await textarea.click();
await textarea.fill("Beltway 8 industrial pad, 5.1 AC, $1,225,000, closed 4/2/2026");
await page.keyboard.press("Enter");
await pacedWait(page, 400);
check("row count is 2 after pasting a second comp", (await rowCount(page)) === 2);

{
  const caretBtn = page.locator('[data-testid="map-place-comp-menu-btn"]');
  await caretBtn.click();
  await pacedWait(page, 150);
  const items = await page.locator('[data-testid^="map-place-comp-menu-item-"]').allTextContents();
  report("caret menu item text, in order", items);
  check('the three items read exactly "On the map" / "On a parcel" / "On a site plan"', JSON.stringify(items) === JSON.stringify(["On the map", "On a parcel", "On a site plan"]));

  await page.locator('[data-testid="map-place-comp-menu-item-parcel"]').click();
  await pacedWait(page, 200);
  check('choosing "On a parcel" arms parcel-select mode', await page.getByText("Selecting a parcel for a comp", { exact: false }).count() > 0);
  // Completing against a REAL parcel is Blocker: live-GIS in this sandbox (see file header). The
  // underlying fill-vs-append mechanism this arms into is proven separately by
  // verify-comp-entry-p0.mjs's CYCLE 8 against this same build (55/55, unaffected by this diff).
  await page.locator("button", { hasText: "Cancel" }).first().click();
  await pacedWait(page, 150);
}

console.log("\n=== STEP 3 — reopen the caret; \"On a parcel\" is now the primary action, shown without opening the menu ===");
{
  const btn = page.getByRole("button", { name: /^Place comp/ });
  const label = await btn.innerText();
  report("Place comp button label after choosing \"On a parcel\"", label);
  check('button label reads "Place comp on a parcel" — last-used stickiness, visible without opening the caret', label === "Place comp on a parcel");
}

console.log("\n=== STEP 4 — \"On a site plan\" is present, and disabled (with a tooltip) when unreachable ===");
{
  const caretBtn = page.locator('[data-testid="map-place-comp-menu-btn"]');
  await caretBtn.click();
  await pacedWait(page, 150);
  const item = page.locator('[data-testid="map-place-comp-menu-item-site-plan"]');
  check('"On a site plan" is present in the menu (never omitted)', await item.count() === 1);
  const ariaDisabled = await item.getAttribute("aria-disabled");
  const title = await item.getAttribute("title");
  report("On a site plan — aria-disabled / title", { ariaDisabled, title });
  check("marked disabled (no site plan uploaded on this fresh session) and carries an explanatory tooltip", ariaDisabled === "true" && !!title && title.length > 0);
  await page.keyboard.press("Escape");
}

console.log("\n=== Save is a signed-out dead end here — Blocker: auth for the counter/reload half of the acceptance script ===");
{
  const saveBtn = page.getByRole("button", { name: /^Save/ }).first();
  const hasSave = await saveBtn.count() > 0;
  check("a Save affordance exists on the sheet", hasSave);
  if (hasSave) {
    await saveBtn.click();
    await pacedWait(page, 1500);
    const failedLoudly = await page.getByText(/Sign in to add a comp|Supabase not configured/).count() > 0;
    check("LOUD-FAILURE: a signed-out save says so explicitly rather than silently no-opping", failedLoudly);
  }
}

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
