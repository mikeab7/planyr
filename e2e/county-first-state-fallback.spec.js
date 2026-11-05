/* NEW-1 / NEW-2 (B2387345 + follow-on, 2026-10-28) — COUNTY FIRST, THE STATE'S LAYER WHEN THE COUNTY DOES NOT ANSWER.
 *
 * Owner: "wire it to the county one, but then default it to the state one." A click on the Map with Select parcels ON asks the county's own server; when that
 * server is DEAD the click goes on to the next-best source for that ground instead of stopping at "couldn't reach the county server".
 *
 * Every parcel service is stubbed (this sandbox's network varies run to run, and the point is an EXACT dead county): the county's host is aborted (a refused
 * connection — the same shape as Niagara's "service not started"), the stand-in answers with a lot.
 * Arms — (1) Texas: Chambers County's CAD is dead, TxGIO answers → the lot is selected AND the notice names Chambers County and the all-Texas layer ·
 *        (2) Niagara County NY in Cambria: the county's new server is dead, the Town of Cambria's layer answers → notice names the town's layer ·
 *        (3) Niagara County NY in Lockport: nothing stands in → the honest "didn't answer" with Try again, NEVER "No lot here" ·
 *        (4) KNOWN-GOOD — the county answers → the lot is selected and NO backup notice shows.
 * Mutation-checked: dropping `fallbacks:` from the Map's identify call turns arm 2 (the Cambria town layer — the only stand-in no breaker can supply) red; arm 1 can also
 * pass on the older breaker-open route (see its note), which test/parcelFallbacks.test.js pins at the orchestration level. */
import { test, expect } from "@playwright/test";

const NOTICE = '[data-testid="parcel-backup-notice"]';
const TOAST = '[data-testid="map-status-toast"]';
const ring = (lat, lng, d = 0.0002) => [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const LAYER_INFO = { type: "Feature Layer", geometryType: "esriGeometryPolygon", capabilities: "Query", maxRecordCount: 1000, fields: [] };

/* Open the Map at (lat, lng), lot zoom, with every parcel service dead unless `live` (a map of url-regex → attribute bag) says otherwise. */
async function open(page, lat, lng, live = []) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:fbSeeded")) return;
    localStorage.setItem("e2e:fbSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, (route) => route.abort("failed")); // everything dead by default
  for (const [re, attributes] of live) {
    await page.route(re, (route) => {
      const u = route.request().url();
      const geometry = { rings: ring(lat, lng), spatialReference: { wkid: 4326 } };
      if (/\/identify/.test(u)) return json(route, { results: [{ layerId: 0, attributes, geometry }] }); // TxGIO's statewide MapServer is identify-only
      if (/\/query/.test(u)) return json(route, { features: [{ attributes, geometry }] });
      return json(route, LAYER_INFO);
    });
  }
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(([la, ln]) => { const m = window.__mapFinderMap; if (m) m.setView([la, ln], 17, { animate: false }); }, [lat, lng]);
  await page.waitForTimeout(800);
  await page.getByTestId("map-toolbar-select-parcels").click();
  await page.waitForTimeout(600);
}
async function clickCentre(page) {
  const box = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const lastIdentify = (page) => page.evaluate(() => (window.__mapLastIdentify ? window.__mapLastIdentify() : null)); // the app's own record of the last click (E2E only)
const noticeText = (page) => page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.textContent : ""; }, NOTICE);

test.describe("county first, the state's layer when the county does not answer", () => {
  test.setTimeout(120_000);

  test("Texas — Chambers County's CAD is dead, TxGIO answers: the lot is selected and the notice says where it came from", async ({ page }) => {
    await open(page, 29.7721, -94.6783, [[/stratmap_land_parcels_48_most_recent\/MapServer/i, { county: "CHAMBERS", prop_id: "12345", situs_addr: "100 MAIN ST" }]]);
    await clickCentre(page);
    await expect(page.locator(NOTICE)).toBeVisible({ timeout: 40_000 });
    const t = await noticeText(page);
    /* Two honest routes reach this notice. Chambers' outline layer fails first (the dead host feeds the circuit breaker), so by click time the county is
     * usually already SKIPPED and TxGIO is asked up front — the older "is unavailable" wording; if the breaker is still closed the click asks the county,
     * it stays silent, and the NEW fallback round asks TxGIO — the "didn't answer" wording. Both name the county and the layer. */
    expect(t).toMatch(/Chambers [Cc]ounty’s own parcel server (didn’t answer|is unavailable)/);
    expect(t).toMatch(/all-Texas TxGIO layer/);
    expect(await page.locator(TOAST).count(), "no failure toast when the stand-in answered").toBe(0);
  });

  test("Niagara County NY, in Cambria — the county's server is dead, the Town of Cambria's layer answers", async ({ page }) => {
    await open(page, 43.1325, -78.8822, [[/BPQWtme4xLWlUYsj\/arcgis\/rest\/services\/Map\/FeatureServer\/0/i, { PrintKey: "134.00-1-42.2", OwnrName: "Hoover Irrevocable Trust", PrclStreet: "Raymond Rd", PrclNumb: "2993", ACRES: 0.69 }]]);
    await clickCentre(page);
    await expect(page.locator(NOTICE)).toBeVisible({ timeout: 40_000 });
    const t = await noticeText(page);
    expect(t).toMatch(/Niagara County’s own parcel server didn’t answer/);
    expect(t).toMatch(/Town of Cambria’s layer/);
    expect(t).not.toMatch(/TxGIO|all-Texas/);
    const li = await lastIdentify(page);
    expect(li.via, "the stand-in round answered, not the county").toBe("fallback");
    expect(li.hits).toEqual(["ny_niagara"]);
    expect(li.silent).toEqual(["ny_niagara"]);
  });

  test("Niagara County NY, in Lockport — nothing stands in: 'didn't answer' + Try again, never 'No lot here'", async ({ page }) => {
    await open(page, 43.1706, -78.6903);
    await clickCentre(page);
    await expect(page.locator(TOAST)).toContainText(/didn't answer|isn't responding|couldn't be checked/i, { timeout: 60_000 });
    expect(await page.locator(TOAST).textContent()).not.toMatch(/No lot here|No parcel right there/);
    expect(await page.locator(NOTICE).count()).toBe(0);
  });

  test("KNOWN-GOOD ARM — the county answers: the lot is selected and no backup notice shows", async ({ page }) => {
    await open(page, 29.7721, -94.6783, [
      [/ChambersCADPublic\/MapServer/i, { PROP_ID: "999", SITUS: "1 COUNTY RD" }],
      [/stratmap_land_parcels_48_most_recent\/MapServer/i, { county: "CHAMBERS", prop_id: "12345" }],
    ]);
    await clickCentre(page);
    await expect.poll(async () => (await lastIdentify(page))?.hits, { timeout: 30_000 }).toEqual(["chambers"]); // the COUNTY answered — a click that did nothing would not pass
    expect((await lastIdentify(page)).via).toBe("primary");
    await page.waitForTimeout(1_500);
    expect(await page.locator(NOTICE).count()).toBe(0);
    expect(await page.locator(TOAST).count()).toBe(0);
  });
});
