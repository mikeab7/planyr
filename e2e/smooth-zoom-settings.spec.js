/* NEW-1 (was B286000) — the smooth-zoom switch is in Settings → Interface, driven in a real
 * browser, LOGGED OUT (so it is verifiable here — ATTEMPT-BEFORE-YOU-PARK).
 *
 * The source guard beside this (`test/smoothZoomHome.test.js`) proves WHERE the control is
 * authored. This one proves it is REACHABLE and that it still works: a user opens Settings, sees
 * the row, clicks it, and the per-device preference flips and persists across a reload. Those are
 * different failures — a control can be authored in the right component and still be unreachable
 * because the surface it lives in is collapsed, clipped or covered, and "the owner could not find
 * it" is exactly the failure this item exists to fix, twice over now.
 *
 * ⛔ SIGNED OUT, this suite drives the row-1 gear, which is the signed-out Settings home. The
 * signed-IN home (account → Settings → Interface) renders the SAME component — asserted by the
 * source guard, since signing in is not reachable from this sandbox (the proxy CORS-blocks
 * Supabase auth) — and its click-through is logged as a `V###` in VERIFICATION.md.
 *
 * The seed is the same minimal saved plan `storage-tiers.spec.js` uses: the planner canvas only
 * exists once a plan is open, and the second test asserts the switch is NOT on the canvas.
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

/* Signed out, Settings is the row-1 gear. Its popover portals to <body>. */
async function openSettings(page) {
  const gear = page.getByRole("button", { name: "Settings" }).filter({ visible: true });
  await expect(gear).toBeVisible({ timeout: 20_000 });
  if ((await gear.getAttribute("aria-expanded")) !== "true") await gear.click();
  await expect(gear).toHaveAttribute("aria-expanded", "true");
}

const toggle = (page) => page.getByTestId("smooth-zoom-toggle").filter({ visible: true });

test.describe("smooth zoom lives in Settings → Interface", () => {
  test("the row is reachable from Settings, beside the display theme, and starts ON", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");
    await openSettings(page);

    const row = toggle(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Smooth zoom");
    // Interface means "about the app": the theme picker is the other half of the same section.
    await expect(page.locator("[data-theme-picker]")).toBeVisible();
    // The default is ON and neither relocation changed it.
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
  });

  test("it is NOT in the View menu, and NOT in the plan menu — one home", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");

    // The View card: the per-DRAWING display menu it went back to being.
    const view = page.getByTestId("view-menu-btn").filter({ visible: true });
    await expect(view).toBeVisible({ timeout: 20_000 });
    await view.click();
    await expect(view).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Show dock doors")).toBeVisible(); // the card really is open
    await expect(page.getByTestId("smooth-zoom-toggle")).toHaveCount(0);
    await view.click(); // close it again so it cannot cover the plan crumb below

    // The plan menu: Storage is still in it (deliberately, see the item), Smooth zoom is not.
    await page.getByTitle("Switch or rename plan").first().click();
    await expect(page.getByTestId("storage-menu-item")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("smooth-zoom-toggle")).toHaveCount(0);
  });

  test("clicking it flips the per-device preference, and the choice survives a reload", async ({ page }) => {
    await seedPlan(page);
    await page.goto("/");
    await openSettings(page);

    await toggle(page).click();
    await expect(toggle(page).locator('input[type="checkbox"]')).not.toBeChecked();
    // The localStorage key the owner said not to change, prefix included.
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("0");

    await page.reload();
    await openSettings(page);
    await expect(toggle(page).locator('input[type="checkbox"]')).not.toBeChecked();

    // …and back on, so the guard covers both directions rather than just the off switch.
    await toggle(page).click();
    await expect(toggle(page).locator('input[type="checkbox"]')).toBeChecked();
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1");
  });
});
