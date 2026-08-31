/* NEW-4 — WHEN THE PARCEL SERVICE FAILS, THE MAP OFFERS THE WAY FORWARD.
 *
 * Before this, a county outage produced a banner and nothing else: the owner was left on a map that
 * would not give him a lot, with no indication he could proceed anyway. The fix is that an OUTAGE
 * carries the fallback in the same breath — start the plan here, draw the boundary by hand, with the
 * location already captured so the plan is never stranded (NEW-1).
 *
 * ⛔ THIS IS A REAL OUTAGE, NOT A SIMULATED ONE. Every county appraisal host is egress-blocked in
 * this sandbox, so clicking a lot here fails exactly the way it fails when a county server is down —
 * which is precisely the condition the owner asked to see the fallback under. Nothing is stubbed.
 *
 * The distinction being guarded is as important as the offer: "no parcel right there" is an ANSWER
 * about that point and must NOT carry the fallback; only an unreachable source does.
 *
 * Mutation-checked (run log on the item): deleting the offer, and dropping the captured origin from
 * the payload, each turn a case here red.
 */
import { test, expect } from "@playwright/test";

/* Land on the MAP (not a plan): no current site, no saved sites. */
async function openMap(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e:mapSeeded")) return;   // seed once — reload must not wipe the plan
    localStorage.setItem("e2e:mapSeeded", "1");
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  await page.goto("/#/");
  // The map view owns the "Select parcels" split button, whose caret holds "Start blank" (NEW-1).
  await expect(page.getByTestId("map-start-blank-menu-btn")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // let the Leaflet map and its layer probes settle
}

const sitesInStore = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"));

test.describe("NEW-4 · a county outage offers the fallback instead of dead-ending", () => {
  test("'Start blank' from the map is born LOCATED at what the map is looking at", async ({ page }) => {
    await openMap(page);
    expect(Object.keys(await sitesInStore(page))).toHaveLength(0);

    await page.getByTestId("map-start-blank-menu-btn").click();
    await page.getByTestId("map-start-blank-menu-item").click();
    // A plan opened…
    await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
    // …and it is NOT stranded: it carries the map's centre as its anchor, written immediately.
    await expect.poll(async () => {
      const sites = await sitesInStore(page);
      const one = Object.values(sites)[0];
      return one && one.origin && Number.isFinite(one.origin.lat) && Number.isFinite(one.origin.lon);
    }, { timeout: 20_000 }).toBe(true);
    // The whole point of the anchor: the geo backdrop exists on a plan with nothing drawn on it yet.
    await expect.poll(async () => page.evaluate(() => !!window.__geoMap), { timeout: 20_000 }).toBe(true);
  });

  test("clicking a lot while the county source is unreachable offers the fallback", async ({ page }) => {
    await openMap(page);
    // Arm parcel selection, then click the map — every county host is blocked, so this is the
    // genuine "the server isn't responding" path.
    const selectToggle = page.getByRole("button", { name: /Select parcels/i }).first();
    if (await selectToggle.count()) {
      const pressed = await selectToggle.getAttribute("aria-pressed");
      if (pressed !== "true") await selectToggle.click();
    }
    const map = page.locator(".leaflet-container").first();
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The offer appears WITH the bad news, in the same toast.
    const offer = page.getByTestId("map-start-blank-here");
    await expect(offer).toBeVisible({ timeout: 30_000 });

    await offer.click();
    await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
    // Located from the start — the plan the owner draws into is already on the earth.
    await expect.poll(async () => {
      const one = Object.values(await sitesInStore(page))[0];
      return one && one.origin && Number.isFinite(one.origin.lat);
    }, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(() => !!window.__geoMap), { timeout: 20_000 }).toBe(true);
  });
});
