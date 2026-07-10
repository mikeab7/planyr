/* Click behavior — single-click SELECTS, double-click opens PROPERTIES (B754).
 *
 * The owner's rule: "clicking any element must not auto-open its properties menu. Single left-click
 * selects; double-click opens Properties." Before B754 the Site Planner's Properties companion was
 * DERIVED from the selection, so a plain click popped it open. This spec is the live guard for the
 * decoupled behavior — it runs LOGGED OUT against a seeded-blank site (no account), driving the real
 * SVG canvas:
 *   • a freshly DRAWN element is selected but the companion stays CLOSED (Site Planner: no auto-open);
 *   • a plain single-click selects WITHOUT opening the companion;
 *   • a double-click OPENS the companion (with its "Delete element" control);
 *   • the ✕ closes it again.
 * A building (a filled rectangle) is the hit target — its interior is reliably clickable, unlike the
 * fill:"none" markup shapes. The property panel carries data-testid="property-panel". */
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

// Drag a building rectangle; returns its approximate CENTER in client px (a reliable interior hit).
async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 300, y1 = box.y + 250, x2 = box.x + 540, y2 = box.y + 410;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

test.describe("click behavior — single-click selects, double-click opens Properties (logged out)", () => {
  test("Site Planner: click selects only; double-click opens Properties; ✕ closes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);

    // Freshly drawn → the companion stays CLOSED (B754: no auto-open on draw in the Site Planner).
    await expect(panel(page)).toHaveCount(0);

    // Double-click → Properties opens (with its "Delete element" control). The app reconstructs the
    // double-tap on pointerdown (pointer capture eats the DOM dblclick), so we issue two real down/up
    // pairs at the same point — capture releases on the first up before the second down, which a fast
    // clickCount:2 doesn't guarantee. Done FIRST (tap history is clean straight after the draw) so the
    // detection is deterministic.
    await page.keyboard.press("Escape"); // deselect + Select tool
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete element/i })).toBeVisible();

    // ✕ closes it (the element stays selected — but the panel is gone). Target by aria-label: the panel's
    // collapsible header is itself a role=button and rolls the ✕'s label into its own accessible name.
    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    // And a plain single-click SELECTS the building WITHOUT re-popping the companion (the old annoyance).
    await page.keyboard.press("Escape");
    await page.mouse.click(cx, cy);
    await expect(panel(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
