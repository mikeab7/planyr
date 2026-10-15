/* NEW-1 (Memphis radius ×2, recurrence of B2289168 / B2289169) — the owner's report, in the MAP's lot picker with no project open
 * ("Selecting… / Drop a pin / Cancel"): "check the parcels that are supposedly wired up. this isnt right" — his screenshot is
 * the east side of Memphis International Airport (≈ 35.03, -89.95, Shelby County) showing the generic toast
 * "No parcel right there — zoom in and click directly on a lot."
 *
 * After this change Shelby has a source (the Shelby County Assessor's own CERTParcel service, relayed), and a county that still
 * has none (Chester TN, which Tennessee's statewide layer excludes) names itself in every case. RED ON THE MERGED B2289168 CODE:
 *  · the owner's spot never reached a Shelby source (there was none; the click queried Tennessee's statewide layer, which holds
 *    none of Shelby) — here the Assessor's point query is answered with one lot and must be SELECTED;
 *  · an excluded county was still routed to the statewide layer that excludes it, so a dead layer printed an OUTAGE message
 *    instead of the county gap — here every other ArcGIS server is held open and never answered;
 *  · a click before the nationwide county polygons were resident could not name the county and fell to the generic message —
 *    here that one asset is delayed past the click (on the merged build this printed the owner's exact sentence).
 * KNOWN-GOOD ARM: MS Webster (just outside the radius, never wired) has said its own gap sentence since before this work.
 */
import { test, expect } from "@playwright/test";

const GENERIC = /No parcel right there/i;
const OUTAGE = /isn't responding|Couldn't reach/i;

// One Shelby lot around the owner's point (WGS84), answered ONLY to the Assessor relay's point identify.
const LOT = { attributes: { OBJECTID: 1, PARCELID: "073088  00221", OWNER: "LIBERTY STREET MEMPHIS PARTNERS", PAR_ADDR1: "0 ARNOLD RD" },
  geometry: { rings: [[[-89.953, 35.027], [-89.947, 35.027], [-89.947, 35.033], [-89.953, 35.033], [-89.953, 35.027]]] } };

async function openMap(page, { delayPolygonsMs = 0 } = {}) {
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, (route) => {
    const u = decodeURIComponent(route.request().url() + " " + (route.request().postData() || ""));
    if (/scgis\.shelbycountytn\.gov/.test(u) && /\/query/.test(u) && /esriGeometryPoint/.test(u)) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ spatialReference: { wkid: 4326 }, fields: [], features: [LOT] }) });
    }
    /* every other server never answers */
  });
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

test.describe("Memphis radius — the no-project lot picker: Shelby selects a lot, a county with no source names itself", () => {
  test.setTimeout(60_000);

  test("KNOWN-GOOD ARM — MS Webster (never wired) says its own gap", async ({ page }) => {
    await openMap(page);
    await page.waitForTimeout(2500); // polygons resident
    await pickAt(page, 33.5409, -89.2631);
    await expect.poll(() => body(page), { timeout: 15_000 }).toMatch(/Webster County — no parcel data wired here yet/);
  });

  test("the owner's spot (airport east, Shelby) — the Shelby Assessor source answers and ONE lot is selected", async ({ page }) => {
    await openMap(page);
    await page.waitForTimeout(2500);
    await pickAt(page, 35.03, -89.95);
    await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="map-decide-summary"]') || {}).textContent || ""), { timeout: 20_000 }).toMatch(/^1 parcel/);
    expect(await body(page)).not.toMatch(GENERIC);
  });

  test("Chester TN (no source; excluded from the statewide layer) — every server dead: the county gap, not an outage", async ({ page }) => {
    await openMap(page);
    await page.waitForTimeout(2500);
    await pickAt(page, 35.4398, -88.6420);
    await expect.poll(() => body(page), { timeout: 15_000 }).toMatch(/Chester County — no parcel data wired here yet/);
    const t = await body(page);
    expect(t, "the generic message blames the click for a coverage gap").not.toMatch(GENERIC);
    expect(t, "an outage message for a county that has no source at all").not.toMatch(OUTAGE);
  });

  test("Chester, clicked BEFORE the county polygons land: still names the county", async ({ page }) => {
    await openMap(page, { delayPolygonsMs: 6000 });
    await pickAt(page, 35.4398, -88.6420);
    await expect.poll(() => body(page), { timeout: 20_000 }).toMatch(/Chester County — no parcel data wired here yet/);
    expect(await body(page)).not.toMatch(GENERIC);
  });
});
