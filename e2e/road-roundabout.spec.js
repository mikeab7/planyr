/* NEW-5 — RIGHT-CLICK A ROAD END, GET A REAL ROUNDABOUT.
 *
 * The owner's condition on this feature was explicit: "do not ship a decorative circle that the
 * pavement math and the curb engine do not know about." `test/roundabout.test.js` asserts the pure
 * geometry; this spec asserts the parts only the running app can show — that the menu item is where
 * he already right-clicks, and that what lands is one dissolved region with the central island as a
 * genuine HOLE in the pavement rather than a disc pasted over the road end.
 *
 * Two deliberate choices, both learned the hard way while writing it:
 *  • The road is DRAWN with the Road tool from a blank site, exactly as `road-tee.spec.js` does,
 *    rather than seeded into localStorage. A seeded road renders at a view the initial fit never
 *    resolves, so every screen coordinate comes out NaN and the spec measures nothing.
 *  • The dissolved geometry is read through `window.__plannerRoadNet()` rather than from pixels,
 *    because "is the island a HOLE or a disc drawn on top" is exactly the distinction a screenshot
 *    cannot make — and it is the whole difference between real and decorative.
 *
 * Run: npx playwright test e2e/road-roundabout.spec.js
 */
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
const storedRoad = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).find((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2) || null;
});

/* Draw one straight road west→east and return the screen points of its body and its EAST end. */
async function drawRoad(page) {
  await canvas(page).click({ position: { x: 20, y: 20 } });   // Snap stays OFF (default)
  const box = await canvas(page).boundingBox();
  const y = box.y + 340;
  const west = { x: box.x + 220, y }, east = { x: box.x + 700, y };
  await pickRoadPreset(page);
  await page.mouse.click(west.x, west.y);
  await page.mouse.click(east.x, east.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(netSurfaces(page)).toHaveCount(1);
  return { body: { x: box.x + 380, y }, end: east };
}

/* Select the road, then right-click its terminus — the vertex menu only opens on the currently
 * editable path, which is exactly how "Add control point" already behaves. */
async function openTerminusMenu(page, pts) {
  await page.mouse.click(pts.body.x, pts.body.y);
  await page.waitForTimeout(350);
  await page.mouse.click(pts.end.x, pts.end.y, { button: "right" });
  await page.waitForTimeout(350);
}
const roundaboutItem = (page) => page.getByRole("button", { name: /◎\s*Roundabout/ });
const removeItem = (page) => page.getByRole("button", { name: /Remove roundabout/i });

test.describe("NEW-5 — a roundabout at a road terminus", () => {
  test("the menu offers it on the SAME menu the control-point actions live on", async ({ page }) => {
    await startBlank(page);
    const pts = await drawRoad(page);
    await openTerminusMenu(page, pts);
    await expect(roundaboutItem(page)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /control point/i }).first()).toBeVisible();
  });

  test("it lands as ONE dissolved region with the central island as a real HOLE", async ({ page }) => {
    await startBlank(page);
    const pts = await drawRoad(page);
    const before = await roadNetwork(page);
    expect(before.regions.length).toBe(1);
    expect(before.regions[0].holes.length).toBe(0);

    await openTerminusMenu(page, pts);
    await roundaboutItem(page).click();
    await page.waitForTimeout(500);

    const after = await roadNetwork(page);
    expect(after.regions.length, "the circle and its leg must dissolve to ONE surface").toBe(1);
    expect(after.regions[0].holes.length, "the island must be a HOLE, not a disc drawn on top").toBe(1);
    // The Road preset here draws an auto drive aisle, so this is the FHWA mini-roundabout end of the
    // range — a ~24 ft island, real landscaped ground rather than a painted dot. (Which class gets
    // which circle is asserted directly in test/roundabout.test.js.)
    expect(ringArea(after.regions[0].holes[0]), "the island is real ground, not a token dot").toBeGreaterThan(300);
    expect(ringArea(after.regions[0].outer)).toBeGreaterThan(ringArea(before.regions[0].outer));
    // …and the landscaped surface is DRAWN through that hole.
    await expect(page.getByTestId("roundabout-island")).toHaveCount(1);
  });

  test("the diameter comes from the road's own design vehicle and persists ON the road", async ({ page }) => {
    await startBlank(page);
    const pts = await drawRoad(page);
    await openTerminusMenu(page, pts);
    await roundaboutItem(page).click();
    await page.waitForTimeout(400);

    const road = await storedRoad(page);
    expect(road, "the road should still be there").toBeTruthy();
    expect(road.roundabout, "the roundabout must persist ON the road, not beside it").toBeTruthy();
    expect(road.roundabout.end).toBe("end");
    // Whatever class the preset drew, the circle is inside that class's published band — never a
    // one-size-fits-all number (the derivation itself is unit-tested in test/roundabout.test.js).
    expect(road.roundabout.d).toBeGreaterThanOrEqual(45);
    expect(road.roundabout.d).toBeLessThanOrEqual(200);
  });

  test("it is BONDED: moving the road carries the circle and re-derives the tie-in", async ({ page }) => {
    await startBlank(page);
    const pts = await drawRoad(page);
    await openTerminusMenu(page, pts);
    await roundaboutItem(page).click();
    await page.waitForTimeout(400);
    const centreOf = async () => {
      const net = await roadNetwork(page);
      const hole = net.regions[0].holes[0];
      return { x: hole.reduce((s, p) => s + p.x, 0) / hole.length, y: hole.reduce((s, p) => s + p.y, 0) / hole.length };
    };
    const before = await centreOf();

    // Drag the road body north. Nothing anywhere stores the circle's POSITION, so if it is truly
    // derived from the road's current points it must arrive with it.
    await page.mouse.move(pts.body.x, pts.body.y);
    await page.mouse.down();
    await page.mouse.move(pts.body.x, pts.body.y - 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const after = await centreOf();
    expect(Math.abs(after.y - before.y), "the roundabout did not travel with its road").toBeGreaterThan(20);
    expect(Math.abs(after.x - before.x), "…and it should not have slid sideways").toBeLessThan(25);
    const net = await roadNetwork(page);
    expect(net.regions.length, "the tie-in must re-derive, not tear").toBe(1);
    expect(net.regions[0].holes.length).toBe(1);
  });

  test("removing it puts the road back the way it was", async ({ page }) => {
    await startBlank(page);
    const pts = await drawRoad(page);
    const before = await roadNetwork(page);
    await openTerminusMenu(page, pts);
    await roundaboutItem(page).click();
    await page.waitForTimeout(400);
    await openTerminusMenu(page, pts);
    await removeItem(page).click();
    await page.waitForTimeout(400);
    const after = await roadNetwork(page);
    expect(after.regions.length).toBe(1);
    expect(after.regions[0].holes.length).toBe(0);
    expect(ringArea(after.regions[0].outer) / ringArea(before.regions[0].outer)).toBeCloseTo(1, 2);
  });
});
