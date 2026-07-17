/* NEW-1 — single-occupancy left dock (amends B656/B733).
 *
 * The dock holds at most ONE panel. When the element inspector OPENS (double-click — B750's explicit
 * open; a plain click still just selects) it TAKES OVER the dock, replacing whatever was docked, and
 * hands that panel back when the inspector closes. Two panels never stack in the dock — to see the
 * inspector AND another panel at once you detach one to a floating card (B717).
 *
 * Drives the REAL app LOGGED OUT (a fresh "Start blank" site reaches the planner, no account/secrets).
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");

function buildingCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building").length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a building rectangle; returns its approximate CENTER in client px (a reliable interior hit).
// `ox`/`oy` offset the top-left corner from the canvas origin — push it right of a top-left floating
// card so neither the draw-drag nor the later double-tap lands on the portaled card instead of the SVG.
async function drawBuilding(page, ox = 300, oy = 250) {
  const b = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + 240, y2 = y1 + 160;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

// Reconstruct the app's double-tap (pointer capture eats the DOM dblclick): two real down/up pairs.
async function doubleTap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

test.describe("single-occupancy left dock (NEW-1, logged out)", () => {
  test("opening the inspector TAKES OVER the docked panel; closing RESTORES it — never two at once", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Dock the Yield panel, then draw a building on the (now narrower) canvas.
    await page.locator('button[title="Yield"]').first().click();
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toBeVisible();
    const { cx, cy } = await drawBuilding(page);
    // A freshly drawn element does NOT open the inspector (B750), so Yield still holds the dock alone.
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toBeVisible();

    // Double-click the building → the inspector TAKES OVER: Yield's chrome is gone, the inspector docks.
    await page.keyboard.press("Escape");
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete element/i })).toBeVisible();
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toHaveCount(0); // never stacked — single occupancy

    // ✕ the inspector → the dock is handed BACK to Yield (the element stays selected, the inspector is gone).
    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toBeVisible();

    // Re-open the inspector, then DESELECT (Escape) → Yield is restored again.
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(cx + 260, cy + 180); // click empty canvas to drop the selection
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-chrome-yield"]')).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a FLOATING panel coexists with the docked inspector — the intended two-at-once path", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Detach Yield to a floating card over the map FIRST (the dock is now empty). The card is portaled
    // to <body>, so it doesn't consume canvas width — drawing after this keeps the hit point stable.
    await page.locator('button[title="Yield"]').first().click();
    await page.locator('[data-testid="panel-chrome-yield-detach"]').click();
    const card = page.locator('[data-testid="floating-panel-yield"]');
    await expect(card).toBeVisible();

    // Drag the card by its title bar to the far bottom-right (it clamps inside the map) so it doesn't
    // overlap where the building is drawn / double-tapped in the top-left drawing area.
    const cb = await card.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + 14);
    await page.mouse.down();
    await page.mouse.move(cb.x + 3000, cb.y + 3000, { steps: 12 });
    await page.mouse.up();

    const { cx, cy } = await drawBuilding(page);

    // Double-click the building → the inspector docks. The floating Yield card is UNTOUCHED by selection:
    // floating Yield + docked inspector coexist (the deliberate two-at-once workflow).
    await page.keyboard.press("Escape");
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('[data-testid="floating-panel-yield"]')).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
