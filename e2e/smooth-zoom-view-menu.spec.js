/* B286000 — the smooth-zoom switch is in the on-canvas View menu, driven in a real browser,
 * LOGGED OUT (so it is verifiable here — ATTEMPT-BEFORE-YOU-PARK).
 *
 * The source guard beside this (`test/smoothZoomHome.test.js`) proves WHERE the control is
 * authored. This one proves it is REACHABLE and that it still works: a user opens the View card,
 * sees the row, clicks it, and the per-device preference flips and persists across a reload.
 * Those are different failures — a control can be authored in the right component and still be
 * unreachable because the card it lives in is collapsed, clipped, or covered by map chrome, and
 * "the owner could not find it" is exactly the failure this item exists to fix.
 *
 * The seed is the same minimal saved plan `storage-tiers.spec.js` uses, for the same reason: the
 * planner canvas — and with it the View card — only exists once a plan is open.
 */
import { test, expect } from "@playwright/test";

const SEED_PLAN = { id: "e2e", groupId: "e2e", site: "E2E site", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, parcels: [], els: [], updatedAt: 1 };
const KEY = "planarfit:smoothZoom";

async function seedPlan(page) {
  await page.addInitScript((PLAN) => {
    try {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ e2e: PLAN }));
      localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ e2e: [] }));
      localStorage.setItem("planarfit:currentSite:v1", "e2e");
    } catch (_) { /* a refusing store makes the assertions below fail loudly, which is correct */ }
  }, SEED_PLAN);
}

/* The View card renders collapsed; its header is the eye button. */
async function openViewMenu(page) {
  const btn = page.getByTestId("view-menu-btn").filter({ visible: true });
  await expect(btn).toBeVisible({ timeout: 20_000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
}

const toggle = (page) => page.getByTestId("smooth-zoom-toggle").filter({ visible: true });

test.describe("smooth zoom lives in the View menu", () => {
  test("the row is reachable from the canvas View card, and starts ON", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");
    await openViewMenu(page);

    const row = toggle(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Smooth zoom");
    // The default is ON and the relocation did not change it.
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  });

  test("it is NOT in the plan menu any more", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");
    await page.getByTitle("Switch or rename plan").first().click();
    // The plan menu is open — Storage is still in it (deliberately, see the item), Smooth zoom is not.
    await expect(page.getByTestId("storage-menu-item")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("smooth-zoom-toggle")).toHaveCount(0);
  });

  test("clicking it flips the per-device preference, and the choice survives a reload", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");
    await openViewMenu(page);

    await toggle(page).click();
    await expect(toggle(page).locator('input[type="checkbox"]')).not.toBeChecked();
    // The localStorage key B286000 was told not to change.
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("0");

    await page.reload();
    await openViewMenu(page);
    await expect(toggle(page).locator('input[type="checkbox"]')).not.toBeChecked();

    // …and back on, so the guard covers both directions rather than just the off switch.
    await toggle(page).click();
    await expect(toggle(page).locator('input[type="checkbox"]')).toBeChecked();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1");
  });
});
