/* B955/NEW-1 — road → parking-drive / truck-court connect. Drives the REAL canvas LOGGED OUT with
 * Snap OFF: a road drawn to a PARKING field's edge welds on and renders a type-scaled clean
 * intersection (car-scale curb returns), and editing the curb-return radius re-solves it. The
 * intersection + edge-detection geometry is unit-tested in test/roadGeometry.test.js (rectEdges /
 * nearestRectEdge / teeGeometry car-vs-truck); this is the connect + render + wiring guard. The
 * truck-court variant shares this exact path with a truck-scale radius (see V415, live-verify). */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const teeReturns = (p) => p.locator('[data-testid="road-tee-return"]');

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}
async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /travel — click points/i }).first().click();
}
function driveRoad(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).find((e) => e.type === "road" && e.driveTee) || null;
  });
}

async function drawParkingThenRoad(page, box) {
  // Parking field (free-drag rectangle).
  await page.getByRole("button", { name: "Car Parking", exact: true }).click();
  await page.mouse.move(box.x + 300, box.y + 450);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 520, { steps: 5 });
  await page.mouse.move(box.x + 820, box.y + 640, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  // Road ending ON the parking field's top edge → drive connect.
  await pickRoadPreset(page);
  await page.mouse.click(box.x + 560, box.y + 200);
  await page.mouse.click(box.x + 560, box.y + 450);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test.describe("B955 — road → parking-drive connect", () => {
  test("a road drawn to a parking field welds on + renders car-scale curb returns (Snap OFF)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } }); // Snap stays OFF (default)
    const box = await canvas(page).boundingBox();
    await drawParkingThenRoad(page, box);

    const road = await driveRoad(page);
    expect(road).toBeTruthy();
    expect(road.driveTee.kind).toBe("parking");
    expect(road.driveTee.returnR).toBe(20); // car-scale seed
    await expect(teeReturns(page)).toHaveCount(2);
    await expect(page.locator('[data-export="road-tee-cover"]').first()).toBeAttached();
  });

  test("editing the drive curb-return radius re-solves the returns", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();
    await drawParkingThenRoad(page, box);
    await expect(teeReturns(page)).toHaveCount(2);
    const before = await teeReturns(page).first().getAttribute("points");

    // Open the road's Properties (double-click its stub away from the mid-span dim label), bump the
    // Drive curb return, and confirm the return polyline changes.
    await page.mouse.dblclick(box.x + 560, box.y + 300);
    await expect(page.getByTestId("property-panel")).toBeVisible();
    const curbReturn = page.getByTestId("property-panel").locator('xpath=.//*[contains(text(),"Curb return")]/following::input[1]');
    await curbReturn.fill("45");
    await curbReturn.press("Enter");
    await page.waitForTimeout(200);

    const after = await teeReturns(page).first().getAttribute("points");
    expect(after).not.toEqual(before);
  });
});
