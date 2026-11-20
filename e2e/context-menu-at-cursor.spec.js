/* NEW-1 (2026-11-10) — a right-click menu opens AT THE CURSOR: its top-left corner a few px from the click, so the first row
 * (on a road: "Add control point") is directly under the pointer. Owner: "My click goes to like the middle of the menu. So I
 * have to move my mouse up to go add a control point, when really I should right click and Add control point should be the
 * slightest mouse movement from where my cursor is."
 *
 * The defect (shared `ContextMenu` → `placeContextMenu`): any bottom overflow, even 25 px of it, FLIPPED the whole menu above the
 * pointer, so the first row sat a full menu-height away; a menu too tall to flip clamped to the top of the window with the pointer
 * mid-menu. Fixed once in `src/shared/ui/contextMenuPlacement.js` — every right-click menu goes through that primitive.
 *
 * Drives the real canvas LOGGED OUT: a road (roomy / the measured overflow case / hard against the bottom edge / right edge), a
 * pond (a non-road element) and the empty-canvas map menu. Pure math: test/contextMenuPlacement.test.js.
 * Run: npx playwright test e2e/context-menu-at-cursor.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const MENU = '.menu[role="menu"]';

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
async function drawRoad(page, x1, x2, y) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
  await page.mouse.click(x1, y);
  await page.mouse.click(x2, y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}
async function drawPond(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}
/* Right-click and report the menu box, its first row and the click, all in viewport px. */
async function rightClick(page, x, y) {
  await page.mouse.click(x, y, { button: "right" });
  const menu = page.locator(MENU).first();
  await expect(menu).toBeVisible();
  const m = await menu.boundingBox();
  const first = await menu.locator("button").first().boundingBox();
  const vp = page.viewportSize();
  return { m, first, click: { x, y }, vp };
}
function expectOnScreen({ m, vp }, what) {
  expect(m.x, `${what}: left edge on-screen`).toBeGreaterThanOrEqual(0);
  expect(m.y, `${what}: top edge on-screen`).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width, `${what}: right edge on-screen`).toBeLessThanOrEqual(vp.width + 1);
  expect(m.y + m.height, `${what}: bottom edge on-screen`).toBeLessThanOrEqual(vp.height + 1);
}
/* The strict contract when nothing is in the way: top-left within a few px of the click; first row under the pointer.
   `headerSlack`: the pond / map menus open with a small uppercase section label above their first button (contents unchanged). */
function expectAtCursor(r, what, headerSlack = 0) {
  expectOnScreen(r, what);
  expect(Math.abs(r.m.x - r.click.x), `${what}: menu left edge at the click x`).toBeLessThanOrEqual(5);
  expect(Math.abs(r.m.y - r.click.y), `${what}: menu top edge at the click y`).toBeLessThanOrEqual(5);
  expect(r.first.x, `${what}: first row spans the click x`).toBeLessThanOrEqual(r.click.x + 5);
  expect(r.first.x + r.first.width, `${what}: first row spans the click x`).toBeGreaterThanOrEqual(r.click.x);
  const below = r.first.y - r.click.y;
  expect(below, `${what}: first row sits just BELOW the pointer (not above it)`).toBeGreaterThanOrEqual(-1);
  expect(below, `${what}: first row sits just below the pointer`).toBeLessThanOrEqual(10 + headerSlack);
}

test.describe("right-click menus open at the cursor (logged out, 1280×720)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("road, roomy: top-left at the click, Add control point under the pointer", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const y = box.y + 110;
    await drawRoad(page, box.x + 200, box.x + 700, y);
    const r = await rightClick(page, box.x + 450, y);
    expectAtCursor(r, "road, roomy");
    await expect(page.locator(MENU).first().locator("button").first()).toContainText("Add control point");
  });

  test("road, mid-canvas where the menu overflows the bottom by a little (the reported case): first row stays within reach", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const y = box.y + box.height / 2; // ≈ y 400 of 720: the 335 px road menu overflows the bottom by ~25 px
    await drawRoad(page, box.x + 200, box.x + 700, y);
    const r = await rightClick(page, box.x + 450, y);
    expectOnScreen(r, "road, mid-canvas");
    // The pointer is INSIDE the menu, in its top portion — never a whole menu-height away from Add control point.
    expect(r.click.y, "pointer is not above the menu").toBeGreaterThanOrEqual(r.m.y);
    expect(r.click.y, "pointer is not below the menu").toBeLessThanOrEqual(r.m.y + r.m.height);
    expect(r.click.y - r.first.y, "Add control point is within a short reach of the pointer").toBeLessThanOrEqual(60);
    expect(Math.abs(r.m.x - r.click.x), "menu's left edge is at the pointer's x (the 2 px gap)").toBeLessThanOrEqual(5);
    await expect(page.locator(MENU).first().locator("button").first()).toContainText("Add control point");
  });

  test("road hard against the bottom edge: menu flips up, fully on screen, hugging the pointer", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const y = box.y + box.height - 14;
    await drawRoad(page, box.x + 200, box.x + 700, y);
    const r = await rightClick(page, box.x + 450, y);
    expectOnScreen(r, "road, bottom edge");
    expect(r.m.y + r.m.height, "menu's bottom edge is within a few px of the pointer").toBeGreaterThanOrEqual(r.click.y - 12);
    expect(r.m.y + r.m.height, "menu does not cover the pointer").toBeLessThanOrEqual(r.click.y + 1);
  });

  test("pond (a non-road element), roomy: top-left at the click", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPond(page, box.x + 320, box.y + 60, box.x + 560, box.y + 200);
    const r = await rightClick(page, box.x + 440, box.y + 130);
    expectAtCursor(r, "pond, roomy", 30);
  });

  test("pond, low on the canvas: on screen and the pointer stays inside the menu's top half or below it", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPond(page, box.x + 320, box.y + 330, box.x + 560, box.y + 520);
    const r = await rightClick(page, box.x + 440, box.y + 425);
    expectOnScreen(r, "pond, low");
    // Slid (pointer in the top half) or flipped (menu wholly above the pointer): never parked with the pointer mid-menu.
    const inside = r.click.y >= r.m.y && r.click.y <= r.m.y + r.m.height;
    if (inside) expect(r.click.y - r.m.y, "pointer in the menu's top half").toBeLessThanOrEqual(r.m.height / 2 + 1);
    else expect(r.m.y + r.m.height, "flipped: menu ends at the pointer").toBeLessThanOrEqual(r.click.y + 1);
  });

  test("empty canvas (Map menu): top-left at the click", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const r = await rightClick(page, box.x + 500, box.y + 200);
    expectAtCursor(r, "map menu", 30);
  });
});

test.describe("right-click menu near the right edge (logged out, narrow window)", () => {
  test.use({ viewport: { width: 1000, height: 720 } });

  test("road near the right edge: menu opens to the LEFT of the pointer, fully on screen, tight against it", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const y = box.y + 110;
    const xClick = Math.min(box.x + box.width - 30, page.viewportSize().width - 40);
    await drawRoad(page, xClick - 360, xClick + 10, y);
    const r = await rightClick(page, xClick, y);
    expectOnScreen(r, "road, right edge");
    expect(r.click.x - (r.m.x + r.m.width), "menu's right edge hugs the pointer (opens to its left)").toBeLessThanOrEqual(12);
    expect(r.click.x - (r.m.x + r.m.width), "menu does not cover the pointer").toBeGreaterThanOrEqual(-1);
    expect(Math.abs(r.m.y - r.click.y), "still level with the click").toBeLessThanOrEqual(5);
  });
});
