/* B1664513 (dispatch: "Parking tool's rect presets did not commit on the deployed build
 * when a live check tried to place one") — root-caused by static reading of SitePlanner.jsx's
 * pointer-up draw-commit handler: the fixed-width PRESET branch (`if (d.depth) { if
 * (draftRect.parkLen >= 4) {...} }`) had no `else`, unlike the free-draw branch right below it
 * (which falls back to a click-started polygon for a short/zero drag). A plain click — pointer
 * down and up at the same point, no drag — leaves `parkLen === 0`, fails the `>= 4` guard, and the
 * whole branch is skipped: nothing is created, no message is shown, and the tool stays armed with
 * zero visible feedback. This is the LOUD-FAILURE fix: the short-drag case now flashes a warning
 * and leaves the preset tool armed for a real drag, instead of silently doing nothing.
 *
 * This spec drives the real canvas logged out with Snap off (no cloud/GIS dependency).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

function parkingEls(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "parking");
  });
}

async function armSingleRowPreset(page) {
  await page.getByRole("button", { name: "Parking type" }).click();
  await page.getByRole("button", { name: /^Single row/ }).click();
}

test.describe("Parking preset — a click with no drag warns instead of silently doing nothing", () => {
  test("a plain click (no drag) on an armed preset commits NOTHING and shows a warning, tool stays armed", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await armSingleRowPreset(page);

    // A plain click: down and up at the SAME point, no intervening move — parkLen === 0.
    await page.mouse.move(box.x + 400, box.y + 400);
    await page.mouse.down();
    await page.mouse.up();

    expect(await parkingEls(page)).toHaveLength(0); // nothing committed
    await expect(page.getByText(/too short to place/i)).toBeVisible(); // LOUD-FAILURE, not silence
    // The preset tool is still armed — the very next (real) drag should still work.
    await page.mouse.move(box.x + 300, box.y + 450);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 460, { steps: 5 });
    await page.mouse.move(box.x + 700, box.y + 465, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("Escape");

    const els = await parkingEls(page);
    expect(els).toHaveLength(1);
    expect(els[0].w).toBeGreaterThan(4);
  });

  test("a real drag on an armed preset commits normally (no regression)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await armSingleRowPreset(page);

    await page.mouse.move(box.x + 300, box.y + 450);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 460, { steps: 5 });
    await page.mouse.move(box.x + 700, box.y + 465, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("Escape");

    const els = await parkingEls(page);
    expect(els).toHaveLength(1);
    await expect(page.getByText(/too short to place/i)).not.toBeVisible();
  });
});
