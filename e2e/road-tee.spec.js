/* B953/NEW-1 — clean T-intersection at a road tee. Drives the REAL canvas LOGGED OUT (no account,
 * no GIS) with Snap OFF, teeing one road into another's side and asserting the clean-tee overlay
 * renders (the two curb-return fillets + the merged-pavement cover), and that editing the curb-return
 * radius re-solves the geometry. The intersection geometry itself is unit-tested in
 * test/roadGeometry.test.js (teeGeometry); this is the render + wiring guard. */
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
function roads(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2);
  });
}

test.describe("B953 — clean tee intersection", () => {
  test("teeing a road into another's side renders two curb returns + a pavement cover (Snap OFF)", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } }); // Snap stays OFF (default)
    const box = await canvas(page).boundingBox();

    // Through road, then a side road ending on its mid-span → a tee.
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 260, box.y + 340);
    await page.mouse.click(box.x + 720, box.y + 340);
    await page.keyboard.press("Enter");
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 490, box.y + 160);
    await page.mouse.click(box.x + 490, box.y + 340); // onto the through road's side → tee
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    // The clean-tee overlay renders: exactly two return fillets + a cover patch.
    await expect(page.locator('[data-testid="road-tee-layer"]')).toBeVisible();
    await expect(teeReturns(page)).toHaveCount(2);
    await expect(page.locator('[data-export="road-tee-cover"]').first()).toBeAttached();
    // The through road gained a vertex at the tee (B949 topology), and both roads remain.
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(2);
    await expect.poll(() => roads(page).then((r) => Math.max(...r.map((x) => x.pts.length)))).toBe(3);
  });

  test("two separate roads that don't touch render NO tee overlay", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 260, box.y + 300);
    await page.mouse.click(box.x + 720, box.y + 300);
    await page.keyboard.press("Enter");
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 260, box.y + 480);
    await page.mouse.click(box.x + 720, box.y + 480);
    await page.keyboard.press("Enter");
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(2);
    await expect(teeReturns(page)).toHaveCount(0);
  });

  test("editing the curb-return radius re-solves the return geometry", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const box = await canvas(page).boundingBox();
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 260, box.y + 340);
    await page.mouse.click(box.x + 720, box.y + 340);
    await page.keyboard.press("Enter");
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 490, box.y + 160);
    await page.mouse.click(box.x + 490, box.y + 340);
    await page.keyboard.press("Enter");
    await expect(teeReturns(page)).toHaveCount(2);

    const before = await teeReturns(page).first().getAttribute("points");

    // Open the SIDE road's Properties (double-click its stub away from the mid-span dim label at y≈250),
    // then set a much larger curb return — the return polyline must change.
    await page.mouse.dblclick(box.x + 490, box.y + 205);
    await expect(page.getByTestId("property-panel")).toBeVisible();
    const panel = page.getByTestId("property-panel");
    // Find the "Curb return (ft)" numeric input by its Field label.
    const curbReturn = panel.locator('xpath=.//*[contains(text(),"Curb return")]/following::input[1]');
    await curbReturn.fill("60");
    await curbReturn.press("Enter");
    await page.waitForTimeout(200);

    const after = await teeReturns(page).first().getAttribute("points");
    expect(after).not.toEqual(before);
  });
});
