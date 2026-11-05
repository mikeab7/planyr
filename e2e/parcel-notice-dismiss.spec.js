/* NEW-1 (amendment to B2288560, owner 2026-10-16: "it should be at the center bottom, and be removable") — the parcel-source
 * "slow / unavailable" banner now rides the shared bottom-centre notice slot, carries a ✕, and a dismissal holds for the
 * rest of that Select-parcels session (a pan with the server still slow does not bring it back), but not beyond it.
 *
 * ⛔ THE SERVER IS MADE DEAD ON PURPOSE (same as parcel-outage-context.spec.js): every ArcGIS MapServer / FeatureServer
 * request is held open, so the hang-guard raises the banner deterministically instead of depending on the sandbox network.
 *
 * Arms: position (centred on the window, low, clear of the zoom stack and the scale bar) · the ✕ (labelled, hit-sized) ·
 * dismiss holds through a pan · dismiss → Cancel → re-enter shows again · Cancel without dismissing still clears (B2288560)
 * · panels open/closed do not move it · a narrow window wraps it between the corner furniture · an unrelated `err`
 * (the Drop-a-pin / file-drop style messages) is not given a ✕ it should not have.
 */
import { test, expect } from "@playwright/test";

const NOTICE = '[data-testid="parcel-source-notice"]';
const STATUS = '[data-testid="map-status-toast"]';
const DISMISS = '[data-testid="map-status-toast-dismiss"]';
const OUTAGE = /parcel server is slow|Statewide parcel outlines are slow|live parcel server is unavailable/i;

async function openMap(page, size) {
  if (size) await page.setViewportSize(size);
  await page.route(/\/(MapServer|FeatureServer)(\/|\?|$)/i, () => { /* never answered */ });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:dismissSeeded")) return;
    localStorage.setItem("e2e:dismissSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}
const zoomToLots = async (page, lat = 29.7604, lng = -95.3698) => {
  await page.evaluate(([a, b]) => { window.__mapFinderMap.setView([a, b], 16, { animate: false }); }, [lat, lng]);
  await page.waitForTimeout(400);
};
const startSelect = (page) => page.getByTestId("map-toolbar-select-parcels").click();
const cancelSelect = (page) => page.getByRole("button", { name: /^Cancel$/ }).first().click();
const raised = async (page) => { await startSelect(page); await expect(page.locator(NOTICE)).toContainText(OUTAGE, { timeout: 25_000 }); };
// evaluate, never locator.textContent(): that WAITS for an absent element until the test times out.
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
const cornerFurniture = (page) => page.evaluate(() => [...document.querySelectorAll(".leaflet-bottom .leaflet-control")].map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className, x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0));
const overlaps = (a, b) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;

test.describe("NEW-1 (B2288560 amendment) · the parcel-source banner: bottom centre, with a ✕", () => {
  test.setTimeout(90_000);

  test("POSITION — bottom-centre of the map, clear of the zoom stack and the scale bar; ✕ is labelled and hit-sized", async ({ page }) => {
    await openMap(page, { width: 1280, height: 800 });
    await zoomToLots(page);
    await raised(page);
    const r = await rectOf(page, NOTICE);
    const vw = 1280, vh = 800;
    expect(Math.abs((r.x + r.w / 2) - vw / 2), "banner is not horizontally centred").toBeLessThan(3);
    expect(r.b, "banner is not at the bottom").toBeGreaterThan(vh - 60);
    expect(r.y, "banner is not in the lower part of the map").toBeGreaterThan(vh * 0.6);
    for (const f of await cornerFurniture(page)) expect(overlaps(r, f), `banner covers ${f.cls}`).toBe(false);
    const d = await rectOf(page, DISMISS);
    expect(d, "no ✕ on the banner").not.toBeNull();
    expect(Math.min(d.w, d.h), "✕ too small to hit").toBeGreaterThanOrEqual(28);
    await expect(page.locator(DISMISS)).toHaveAttribute("aria-label", "Dismiss");
    await page.screenshot({ path: test.info().outputPath("banner-bottom-center.png") });
  });

  test("DISMISS holds — click ✕, keep panning at lot zoom with the server still dead: stays hidden", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await raised(page);
    await page.locator(DISMISS).click();
    await expect.poll(() => count(page, STATUS), { timeout: 2_000 }).toBe(0);
    await page.screenshot({ path: test.info().outputPath("after-dismiss.png") });
    // Pan to a different lot-zoom view (and another, Fort Bend side) and outlive the 8 s hang guard.
    await zoomToLots(page, 29.7654, -95.3598);
    await page.waitForTimeout(3000);
    await zoomToLots(page, 29.55, -95.75);
    await page.waitForTimeout(10_000);
    expect(await count(page, STATUS), "a dismissed parcel banner came back during the same Select-parcels session").toBe(0);
  });

  test("a NEW occasion shows it again — dismiss → Cancel Select parcels → re-enter with the server still dead", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await raised(page);
    await page.locator(DISMISS).click();
    await expect.poll(() => count(page, STATUS), { timeout: 2_000 }).toBe(0);
    await cancelSelect(page);
    await page.waitForTimeout(500);
    await startSelect(page);
    await expect(page.locator(NOTICE)).toContainText(OUTAGE, { timeout: 25_000 });
  });

  test("B2288560 intact — Cancel WITHOUT dismissing still clears it at once", async ({ page }) => {
    await openMap(page);
    await zoomToLots(page);
    await raised(page);
    await cancelSelect(page);
    await expect.poll(() => count(page, STATUS), { timeout: 2_000 }).toBe(0);
  });

  test("panels do not move it — Sites panel collapsed / expanded and the Layers panel open leave it centred", async ({ page }) => {
    await openMap(page, { width: 1280, height: 800 });
    await zoomToLots(page);
    await raised(page);
    const base = await rectOf(page, NOTICE);
    await page.getByTitle(/Collapse the sites panel|Expand the sites panel/).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const toggled = await rectOf(page, NOTICE);
    expect(Math.abs((toggled.x + toggled.w / 2) - (base.x + base.w / 2)), "Sites panel toggle shifted the banner").toBeLessThan(2);
    const layers = page.getByText(/Imagery & layers/i).first();
    if (await layers.count()) { await layers.click().catch(() => {}); await page.waitForTimeout(400); }
    const withLayers = await rectOf(page, NOTICE);
    expect(Math.abs((withLayers.x + withLayers.w / 2) - 640), "Layers panel shifted the banner off-centre").toBeLessThan(3);
    expect(withLayers.b, "banner left the bottom").toBeGreaterThan(740);
  });

  test("NARROW window — wraps between the corner furniture, never overflows, never covers the zoom buttons", async ({ page }) => {
    await openMap(page, { width: 390, height: 700 });
    await zoomToLots(page);
    await raised(page);
    const r = await rectOf(page, NOTICE);
    expect(r.x, "overflows the left edge").toBeGreaterThanOrEqual(0);
    expect(r.r, "overflows the right edge").toBeLessThanOrEqual(390);
    for (const f of await cornerFurniture(page)) expect(overlaps(r, f), `banner covers ${f.cls} at a narrow width`).toBe(false);
    expect(r.h, "did not wrap onto extra lines").toBeGreaterThan(40);
    await page.screenshot({ path: test.info().outputPath("narrow.png") });
  });

  test("OTHER BANNERS UNTOUCHED — a non-parcel message in the same `err` slot keeps the bottom-left stack and gets no ✕", async ({ page }) => {
    await openMap(page);
    // An address search that finds nothing raises a plain setErr (it used to be the empty-map right-click → Google Earth export,
    // removed 2026-10-22, B2380112). Both geocoders are stubbed to answer "no match" so the message does not depend on the network.
    await page.route(/geocode\.arcgis\.com|nominatim\.openstreetmap\.org/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: route.request().url().includes("nominatim") ? "[]" : JSON.stringify({ candidates: [], suggestions: [] }),
    }));
    const box = page.getByPlaceholder(/Type an address/);
    await box.fill("zzzz nowhere lane 00000");
    await box.press("Enter");
    await expect(page.locator(STATUS)).toContainText(/Couldn't find that address/, { timeout: 10_000 });
    expect(await page.locator(STATUS).textContent()).not.toMatch(OUTAGE);
    expect(await count(page, DISMISS), "an unrelated message grew the parcel ✕").toBe(0);
    expect(await count(page, NOTICE), "an unrelated message was floated as a parcel notice").toBe(0);
    const r = await rectOf(page, STATUS);
    expect(r.x, "the unrelated message left its bottom-left slot").toBeLessThan(40);
  });
});
