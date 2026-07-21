/* B924 (NEW-2) — the shared ContextMenu primitive (src/shared/ui/ContextMenu.jsx, B915) keeps a
 * right-click menu FULLY on screen no matter where you click, because it renders in a body portal
 * and clamps to the viewport by MEASURING the rendered menu (never a hardcoded height guess). The
 * pure placement math is unit-tested in test/contextMenuPlacement.test.js; THIS spec proves the
 * whole thing end-to-end in a real browser: open the canvas right-click menu hard against the
 * bottom-right corner on a short viewport and assert every edge of the rendered menu box sits
 * inside the viewport. Runs LOGGED OUT on a seeded-blank site (no account needed). */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

test.describe("context menu stays fully in-viewport near the bottom-right corner (logged out)", () => {
  // A short viewport so a menu opened low would overflow the bottom unless it flips + clamps.
  test.use({ viewport: { width: 1000, height: 540 } });

  test("right-click at the bottom-right corner → menu fully within the viewport", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Right-click the canvas hard against its bottom-right corner (near the viewport's bottom edge).
    const box = await canvas(page).boundingBox();
    const clickX = Math.round(box.x + box.width - 14);
    const clickY = Math.round(box.y + box.height - 10);
    await page.mouse.click(clickX, clickY, { button: "right" });

    // The dedicated canvas menu opens (its unique "Export to Google Earth" row confirms it).
    await expect(page.getByText(/Export to Google Earth/i)).toBeVisible();

    // Measure the ACTUAL rendered menu box and assert it is entirely inside the viewport.
    const menu = page.locator('[role="menu"]').filter({ hasText: /Export to Google Earth/i }).first();
    const rect = await menu.boundingBox();
    const vw = page.viewportSize().width;
    const vh = page.viewportSize().height;
    expect(rect, "menu should be rendered").not.toBeNull();
    expect(rect.x, "menu left edge on-screen").toBeGreaterThanOrEqual(0);
    expect(rect.y, "menu top edge on-screen").toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, "menu right edge on-screen").toBeLessThanOrEqual(vw + 1);
    expect(rect.y + rect.height, "menu bottom edge on-screen").toBeLessThanOrEqual(vh + 1);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
