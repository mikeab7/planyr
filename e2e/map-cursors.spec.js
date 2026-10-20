/* Map view cursors — owner-approved convention (2026-10-20). The Map has ONE cursor owner: whichever surface is armed decides what
 * the map shows, over everything beneath it, and a pan shows grabbing and then GOES BACK to the armed mode (it used to fall back to
 * the open hand while the next click still dropped the pin).
 *
 * Red on main: after one pan in Drop-a-pin the container cursor is "" (the hand); a Drop-a-pin started from the Select-parcels bar
 * ends on the +/− cursor of the mode it left; Leaflet's own `.leaflet-interactive` pointer wins over every feature.
 *
 * Run: npx playwright test e2e/map-cursors.spec.js
 */
import { test, expect } from "@playwright/test";

const container = (p) => p.locator(".leaflet-container").first();
const cursorOfContainer = (p) => container(p).evaluate((n) => getComputedStyle(n).cursor);

async function openMap(page) {
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await expect(container(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  const live = await page.evaluate(async () => {
    const raf = await Promise.race([new Promise((r) => requestAnimationFrame(() => r("raf"))), new Promise((r) => setTimeout(() => r("timeout"), 1500))]);
    return { vis: document.visibilityState, raf };
  });
  expect(live).toEqual({ vis: "visible", raf: "raf" }); // FOREGROUND-OR-VOID
}
async function pan(page) {
  const b = await container(page).boundingBox();
  const x = b.x + b.width * 0.5, y = b.y + b.height * 0.7;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 90, y - 40, { steps: 8 });
  const during = await cursorOfContainer(page);
  await page.mouse.up(); await page.waitForTimeout(250);
  return during;
}

test.describe("Map view cursors", () => {
  test("idle map is the open hand; the known-good arm reads a toolbar button as pointer", async ({ page }) => {
    await openMap(page);
    const btn = await page.getByRole("button", { name: "Drop a pin" }).first().boundingBox();
    expect(await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [btn.x + btn.width / 2, btn.y + btn.height / 2]), "instrument arm").toBe("pointer");
    expect(await cursorOfContainer(page)).toBe("grab");
  });

  test("Drop a pin: crosshair, still crosshair after a pan (grabbing only DURING it), and everything beneath inherits it", async ({ page }) => {
    await openMap(page);
    await page.getByRole("button", { name: "Drop a pin" }).first().click();
    await page.waitForTimeout(250);
    expect(await cursorOfContainer(page)).toBe("crosshair");
    expect(await pan(page), "during the pan").toBe("grabbing");
    expect(await cursorOfContainer(page), "after the pan the armed mode owns the cursor again").toBe("crosshair");
    // a feature layer's own cursor (Leaflet's pointer hand) must not win over the armed mode
    const innerOwned = await page.evaluate(() => {
      const c = document.querySelector(".leaflet-container");
      const pane = c.querySelector(".leaflet-map-pane");
      return { owned: c.hasAttribute("data-cursor-owned"), pane: getComputedStyle(pane).cursor };
    });
    expect(innerOwned).toEqual({ owned: true, pane: "crosshair" });
  });

  test("Select parcels shows the +/− cursor; Drop a pin from its bar ends on crosshair, not the leftover +", async ({ page }) => {
    await openMap(page);
    await page.getByRole("button", { name: "Select parcels" }).first().click();
    await page.waitForTimeout(300);
    expect(await cursorOfContainer(page), "select parcels = the + cursor").toMatch(/^url\(/);
    expect(await pan(page)).toBe("grabbing");
    expect(await cursorOfContainer(page), "back to + after a pan, not the open hand").toMatch(/^url\(/);
    // the Drop-a-pin on the select bar (when it is offered there) must win
    const drop = page.getByRole("button", { name: /drop a pin/i }).first();
    if (await drop.isVisible().catch(() => false)) {
      await drop.click(); await page.waitForTimeout(300);
      expect(await cursorOfContainer(page)).toBe("crosshair");
    }
  });
});
