/* NEW-1 (Memphis radius ×2, recurrence of B2289168 / B2289169) — a Shelby County click in the MAP's lot picker (no project
 * open: "Selecting… / Drop a pin / Cancel") must SAY "Shelby County — no parcel data wired here yet", never the generic
 * "No parcel right there — zoom in and click directly on a lot." and never "the server isn't responding".
 *
 * Owner report 2026-10-15, verbatim: "check the parcels that are supposedly wired up. this isnt right" — his screenshot is
 * the east side of Memphis International Airport (Swinnea / Tchulahoma / Getwell, ≈ 35.03, -89.95) with the generic toast.
 *
 * RED ON THE MERGED B2289168 CODE, two ways (each arm below):
 *  · the click still queried Tennessee's statewide layer for Shelby (which holds none of Shelby), so a slow or dead layer
 *    printed an OUTAGE message instead of the county gap — here every ArcGIS server is held open and never answered;
 *  · a click before the nationwide county polygons were resident could not name the county and fell to the generic
 *    message — here that one asset is delayed past the click.
 * KNOWN-GOOD ARM: MS Webster (just outside the radius, never wired) has said its own gap sentence since before this work.
 */
import { test, expect } from "@playwright/test";

const GENERIC = /No parcel right there/i;
const OUTAGE = /isn't responding|Couldn't reach/i;

async function openMap(page, { delayPolygonsMs = 0 } = {}) {
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => { /* a server that never answers */ });
  if (delayPolygonsMs) {
    await page.route(/\/geo\/county-polygons\.json/, async (route) => {
      await new Promise((r) => setTimeout(r, delayPolygonsMs));
      await route.continue();
    });
  }
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:shelbySeeded")) return;
    localStorage.setItem("e2e:shelbySeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-select-parcels")).toBeVisible({ timeout: 30_000 });
}

async function pickAt(page, lat, lng) {
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
  await page.waitForTimeout(300);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(300);
  const pt = await page.evaluate(([a, b]) => {
    const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y);
}

const body = (page) => page.evaluate(() => document.body.innerText);

test.describe("Memphis radius — a county with no parcel source names itself in the no-project lot picker", () => {
  test.setTimeout(60_000);

  test("KNOWN-GOOD ARM — MS Webster (never wired) says its own gap", async ({ page }) => {
    await openMap(page);
    await page.waitForTimeout(2500); // polygons resident
    await pickAt(page, 33.5409, -89.2631);
    await expect.poll(() => body(page), { timeout: 15_000 }).toMatch(/Webster County — no parcel data wired here yet/);
  });

  test("the owner's spot (airport east, Shelby) — healthy polygons, every parcel server dead: county gap, not an outage", async ({ page }) => {
    await openMap(page);
    await page.waitForTimeout(2500);
    await pickAt(page, 35.03, -89.95);
    await expect.poll(() => body(page), { timeout: 15_000 }).toMatch(/Shelby County — no parcel data wired here yet/);
    const t = await body(page);
    expect(t, "the generic message blames the click for a coverage gap").not.toMatch(GENERIC);
    expect(t, "an outage message for a county that has no source at all").not.toMatch(OUTAGE);
  });

  test("downtown Memphis, clicked BEFORE the county polygons land: still names Shelby", async ({ page }) => {
    await openMap(page, { delayPolygonsMs: 6000 });
    await pickAt(page, 35.1495, -90.049);
    await expect.poll(() => body(page), { timeout: 20_000 }).toMatch(/Shelby County — no parcel data wired here yet/);
    expect(await body(page)).not.toMatch(GENERIC);
  });
});
