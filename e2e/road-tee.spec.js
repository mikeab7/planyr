/* B953/NEW-1 — clean T-intersection at a road tee. Drives the REAL canvas LOGGED OUT (no account,
 * no GIS) with Snap OFF, teeing one road into another's side.
 *
 * REWRITTEN for the dissolved-network render (NEW-1/NEW-2): the junction is a boolean UNION of the two
 * strips plus the curb-return wedges, not a patch over a seam, so these assert the DISSOLVED result —
 * one pavement region, no slivers, two real returns — instead of counting cover/return elements. The
 * old element-counting assertions passed on every broken build the owner reported. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork, netSurfaces, ringArea } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}
async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
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

    // The two roads dissolve into ONE pavement region with ONE outline, and the tee contributes two
    // real curb-return wedges. A sliver hole would stroke as the faint seam this render exists to kill.
    await expect(page.locator('[data-testid="road-network-layer"]')).toBeAttached();
    await expect.poll(async () => (await roadNetwork(page))?.tees.length ?? 0).toBe(1);
    await expect(netSurfaces(page)).toHaveCount(1);
    const net = await roadNetwork(page);
    expect(net.tees[0].wedges).toBe(2);
    expect(net.tees[0].R).toBeGreaterThan(0);
    for (const h of net.regions[0].holes) expect(ringArea(h)).toBeGreaterThan(200);
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
    // No junction → no tee, and the two roads stay as two separate dissolved regions.
    await expect.poll(async () => (await roadNetwork(page))?.tees.length ?? -1).toBe(0);
    await expect(netSurfaces(page)).toHaveCount(2);
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
    await expect.poll(async () => (await roadNetwork(page))?.tees.length ?? 0).toBe(1);

    const before = (await roadNetwork(page)).tees[0].R;

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

    const after = (await roadNetwork(page)).tees[0].R;
    expect(after).toBeGreaterThan(before);   // a bigger requested radius really solves a bigger return
  });
});
