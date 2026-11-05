/* NEW-1 (parcel-slow toast without parcels) — the parcel-source "slow / unavailable" banner may only
 * appear when parcels matter to what the user is doing: Select parcels is ON (a live outline layer is
 * what reports). It must never be raised by a layer the user has already left behind.
 *
 * Owner report 2026-10-15 (planyr.io #/site, no project, metro zoom, satellite): "That county's parcel
 * server is slow right now — showing statewide outlines…" with the tool not in use.
 *
 * ROOT CAUSE (measured): turning Select parcels off removes the outline layers (`clearDisplays`) but never
 * cancelled their 8 s hang-guard timers, and `layerInDrawRange` reads a REMOVED layer (no `_map`) as "in
 * range" — so the timer fired later, called `markDown`, and raised the banner on a map with the tool off.
 * The banner also was never retracted when the mode ended, so it outlived the tool.
 *
 * ⛔ THE SERVER IS MADE DEAD ON PURPOSE, NOT LEFT TO THE SANDBOX'S NETWORK: whether county GIS hosts answer here varies
 * run to run (measured — one run had live Harris outlines, the next had none), so every ArcGIS MapServer /
 * FeatureServer request is held open and never answered. That is exactly a server that hangs, the condition the 8 s
 * guard exists for.
 *
 * Arms (each stated in the PR): tool ON → banner DOES appear (the useful case, known-good arm, must not
 * regress) · tool toggled OFF before the guard fires → no banner, ever · tool ON then OFF after a banner
 * → banner retracted · Drop-a-pin mode → no banner.
 */
import { test, expect } from "@playwright/test";

const STATUS = '[data-testid="map-status-toast"]';
const OUTAGE = /parcel server is slow|Statewide parcel outlines are slow|live parcel server is unavailable/i;

async function openMap(page) {
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => { /* never answered */ });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:ctxSeeded")) return;
    localStorage.setItem("e2e:ctxSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

// Put the map at a Harris lot-level zoom, where an outline layer is inside its draw range.
async function zoomToLots(page) {
  await page.evaluate(() => { const m = window.__mapFinderMap; m.setView([29.7604, -95.3698], 16, { animate: false }); });
  await page.waitForTimeout(400);
}

// evaluate, never locator.textContent(): that WAITS for an absent element until the test times out.
const outageText = (page) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.textContent : ""; }, STATUS);

test.describe("NEW-1 · the parcel outage banner only exists while parcels are in use", () => {
  test.setTimeout(75_000);
  test("KNOWN-GOOD ARM — Select parcels ON at lot zoom with a dead county server DOES warn", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await page.getByTestId("map-toolbar-select-parcels").click();
    await expect(page.locator(STATUS)).toContainText(OUTAGE, { timeout: 25_000 });
  });

  test("RED PROOF — Select parcels toggled ON then OFF before the guard fires: no banner, ever", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await page.getByTestId("map-toolbar-select-parcels").click();
    await page.waitForTimeout(1200);                       // layers mounted, requests outstanding
    await page.getByRole("button", { name: /^Cancel$/ }).first().click(); // tool off
    // Outlive the 8 s hang-guard (and the slow-notice timer) by a wide margin.
    await page.waitForTimeout(12_000);
    expect(await outageText(page), "a parcel banner appeared with Select parcels OFF").not.toMatch(OUTAGE);
    expect(await page.locator(STATUS).count()).toBe(0);
  });

  test("a banner raised while the tool was on is retracted the moment the tool is turned off", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await page.getByTestId("map-toolbar-select-parcels").click();
    await expect(page.locator(STATUS)).toContainText(OUTAGE, { timeout: 25_000 });
    await page.getByRole("button", { name: /^Cancel$/ }).first().click();
    await expect.poll(() => page.locator(STATUS).count(), { timeout: 2_000 }).toBe(0);
  });

  test("Drop a pin armed (no Select parcels) never shows the parcel banner", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await page.getByTestId("map-toolbar-drop-pin").click();
    await page.waitForTimeout(12_000);
    expect(await outageText(page)).not.toMatch(OUTAGE);
  });

  test("metro zoom with Select parcels ON: no outline request is in range, so no banner", async ({ page }) => {
    await openMap(page);
    await page.evaluate(() => { window.__mapFinderMap.setView([29.8, -95.1], 9, { animate: false }); });
    await page.getByTestId("map-toolbar-select-parcels").click();
    await page.waitForTimeout(12_000);
    expect(await outageText(page)).not.toMatch(OUTAGE);
  });
});
