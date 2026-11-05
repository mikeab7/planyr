/* NEW-1 / NEW-2 (B2424384–B2424386, 2026-10-22) — a slow parcel server is never "not found" and never silence.
 *
 * Michael on V1853888's note that a Perry id search "came back empty on the first live run and passed on re-run": "how would a user know to do that?"
 * The state layer has answered in 50 ms, 27 s, 44 s and a 504 at 59 s. The app used to give up at 8 s, ask once more, and then show a sentence with nothing to press.
 *
 * The Tennessee statewide layer is stubbed (the sandbox network varies run to run) so a slow answer is exact: arms — (1) answers late → the lot is FOUND, and a "still looking" line was
 * shown while it waited · (2) fails on the first ask only → the app's own retry finds it, no button needed · (3) fails every ask → the toast says the server didn't answer, has a
 * Try again, never "No Tennessee parcel with ID", and pressing Try again once the server is back finds the lot · (4) known-good — an id the server really does not have reads "No Tennessee parcel".
 * Search runs on the Map home (never a real project). */
import { test, expect } from "@playwright/test";

const TN_LAYER = /Tennessee_Property_Boundaries_Public_Use\/FeatureServer\/0\/query/;
const ID = "068 066    00401 000 2026";
const ATTRS = { COUNTY_ID: 68, GISLINK: "068066    00401", PARCELID: ID, CMAP: "066", GP: " ", PARCEL: "004.01", COUNTY_NAME: "Perry", OBJECTID: 1 };
const FEATURE = { attributes: ATTRS, geometry: { rings: [[[-87.8475, 35.6385], [-87.8470, 35.6385], [-87.8470, 35.6390], [-87.8475, 35.6390], [-87.8475, 35.6385]]] } };
const TOAST = '[data-testid="map-status-toast"]';

async function openMap(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:slowSeeded")) return;
    localStorage.setItem("e2e:slowSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  // every OTHER parcel service is held off; the TN statewide layer is the one under test
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, (route) => { if (!TN_LAYER.test(route.request().url())) route.abort(); else route.fallback(); });
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { const m = window.__mapFinderMap; if (m) m.setView([35.6387, -87.8473], 15, { animate: false }); });
  await page.waitForTimeout(800);
}
const search = async (page, text) => {
  const box = page.getByPlaceholder(/Type an address/);
  await box.click(); await box.fill(text); await box.press("Enter");
};
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

test.describe("a slow state parcel server on the Site search", () => {
  test.setTimeout(120_000);

  test("answers at 12 s (past the old 8 s limit): the lot is FOUND, and 'still looking' was shown while waiting", async ({ page }) => {
    await openMap(page);
    let first = true; // a cold server: the first ask is the slow one, the follow-up lot lookup finds it warm
    await page.route(TN_LAYER, async (route) => { if (first) { first = false; await new Promise((r) => setTimeout(r, 12_000)); } await json(route, { features: [FEATURE] }); });
    await search(page, ID);
    await expect(page.getByTestId("map-lookup-slow")).toContainText(/Still looking/, { timeout: 9_000 });
    await expect(page.locator(TOAST)).toHaveCount(0);
    await expect(page.getByTestId("map-lookup-slow")).toHaveCount(0, { timeout: 20_000 }); // done
    expect(await page.locator(TOAST).count(), "no failure toast for a slow-but-answered search").toBe(0);
    await expect(page.getByText(/Parcel .*Perry County, TN/).first()).toBeVisible({ timeout: 20_000 }); // the follow-up lot selection asks the same slow server
  });

  test("fails the first ask only: the app's own retry finds the lot with no button and no error", async ({ page }) => {
    await openMap(page);
    let n = 0;
    await page.route(TN_LAYER, (route) => (n++ === 0 ? route.abort("failed") : json(route, { features: [FEATURE] })));
    await search(page, ID);
    await expect(page.getByText(/Parcel .*Perry County, TN/).first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator(TOAST).count()).toBe(0);
  });

  test("never answers: 'didn't answer' + Try again (never 'No Tennessee parcel'), and Try again finds the lot once the server is back", async ({ page }) => {
    await openMap(page);
    await page.route(TN_LAYER, (route) => route.abort("failed"));
    await search(page, ID);
    const toast = page.locator(TOAST);
    await expect(toast).toContainText(/parcel server didn't answer/, { timeout: 20_000 });
    expect(await toast.textContent()).not.toMatch(/No Tennessee parcel with ID/);
    await expect(page.getByTestId("map-try-again")).toBeVisible();
    await page.unroute(TN_LAYER);
    await page.route(TN_LAYER, (route) => json(route, { features: [FEATURE] }));
    await page.getByTestId("map-try-again").click();
    await expect(page.getByText(/Parcel .*Perry County, TN/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("map-try-again")).toHaveCount(0);
  });

  test("KNOWN-GOOD ARM — a server that answers with no such lot says 'No Tennessee parcel', with no Try again", async ({ page }) => {
    await openMap(page);
    await page.route(TN_LAYER, (route) => json(route, { features: [] }));
    await search(page, "068 066    00499 000 2026");
    await expect(page.locator(TOAST)).toContainText(/No Tennessee parcel with ID/, { timeout: 15_000 });
    await expect(page.getByTestId("map-try-again")).toHaveCount(0);
  });
});

/* NEW-2 — the lot CLICK on a slow source. A point query is the one carrying esriGeometryPoint; outline (envelope) queries are answered normally so only the click is under test. */
test.describe("a slow state parcel server on a lot click", () => {
  test.setTimeout(120_000);
  const POINT = /esriGeometryPoint/;
  const clickMapCentre = async (page) => {
    await page.getByTestId("map-toolbar-select-parcels").click();
    await page.waitForTimeout(1500);
    const box = await page.locator(".leaflet-container").first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const outlines = (route) => json(route, { features: [FEATURE] });

  test("the first point query fails, the app's retry round asks again: no 'no parcel' card, no outage toast", async ({ page }) => {
    await openMap(page);
    let n = 0;
    await page.route(TN_LAYER, (route) => (POINT.test(route.request().url()) ? (n++ === 0 ? route.abort("failed") : json(route, { features: [FEATURE] })) : outlines(route)));
    await clickMapCentre(page);
    await expect(page.getByText(/Looking up lot|Selecting/).first()).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => n, { timeout: 25_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    expect(await page.locator(TOAST).allTextContents().then((t) => t.join(" "))).not.toMatch(/No parcel right there|didn't answer/);
  });

  test("the server never answers a point query: 'didn't answer' + Try again — never 'No parcel right there' — and Try again selects the lot once it is back", async ({ page }) => {
    await openMap(page);
    let up = false;
    await page.route(TN_LAYER, (route) => (POINT.test(route.request().url()) ? (up ? json(route, { features: [FEATURE] }) : route.abort("failed")) : outlines(route)));
    await clickMapCentre(page);
    const toast = page.locator(TOAST);
    await expect(toast).toContainText(/didn't answer/, { timeout: 30_000 });
    expect(await toast.textContent()).not.toMatch(/No parcel right there/);
    await expect(page.getByTestId("map-try-again")).toBeVisible();
    up = true;
    await page.getByTestId("map-try-again").click();
    await expect(page.getByTestId("map-try-again")).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await toast.allTextContents()).join(" "), { timeout: 15_000 }).not.toMatch(/didn't answer|No parcel right there/);
  });

  test("KNOWN-GOOD ARM — every server answers and the point is empty: 'No parcel right there', and no Try again", async ({ page }) => {
    await openMap(page);
    await page.route(TN_LAYER, (route) => (POINT.test(route.request().url()) ? json(route, { features: [] }) : outlines(route)));
    await clickMapCentre(page);
    await expect(page.locator(TOAST)).toContainText(/No parcel right there/, { timeout: 15_000 });
    await expect(page.getByTestId("map-try-again")).toHaveCount(0);
  });
});

