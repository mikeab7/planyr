/* Building footprint reshape (NEW-1 / B872) — logged-out, sandbox-headless interactive drive.
 *
 * The interactive half of the reshape feature: draw a rect building, convert it to an editable
 * footprint, then drag a loaded-wall corner. Asserts the flow runs on the REAL canvas with zero
 * page errors and that the panel flips to the irregular-footprint state (read-only bounding dims +
 * "Reset to rectangle"). The pure geometry is exhaustively covered by test/footprintEdit.test.js;
 * this proves the wiring + the polygon-branch render don't crash when actually exercised. Runs with
 * no seeded account (sandbox-safe), like smoke.spec.js. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

test.describe("building footprint reshape (logged out)", () => {
  test("draw a building → Edit footprint → drag a corner, no crash", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    await openModule(page, "site-planner");

    // Logged out the Site module opens on the map/picker; "Start blank" drops into a fresh
    // drawable canvas (the left rail with the draw tools).
    await page.getByRole("button", { name: /Start blank/i }).first().click();

    // The planner canvas is an inline SVG; the left rail carries the draw tools.
    const svg = page.getByTestId("planner-canvas");
    await expect(svg).toBeVisible({ timeout: 15000 });
    const buildingTool = page.getByRole("button", { name: /^Building$/ }).first();
    await expect(buildingTool).toBeVisible({ timeout: 10000 });
    await buildingTool.click();

    // Drag a good-sized rectangle on the canvas → a placed building (auto-selected, tool→select).
    const box = await svg.boundingBox();
    const x0 = box.x + box.width * 0.35, y0 = box.y + box.height * 0.4;
    const x1 = box.x + box.width * 0.7, y1 = box.y + box.height * 0.62;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();

    // The drawn building auto-selects; open its inspector (the "Properties" tab).
    await page.getByRole("button", { name: /^Properties$/ }).click();

    // The building inspector shows a "✎ Edit footprint…" action for a placed rectangle.
    const editBtn = page.getByRole("button", { name: /Edit footprint/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 8000 });
    await editBtn.click();

    // Converted: the panel now reads the irregular-footprint state (bounding dims + reset).
    await expect(page.getByText(/Irregular footprint/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: /Reset to rectangle/i })).toBeVisible();

    // Drag a corner of the (now polygon) building — the vertex-edit engine + release recompute run.
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    await page.mouse.move(x0, y0);        // a corner of the drawn box
    await page.mouse.down();
    await page.mouse.move((x0 + midX) / 2, y0, { steps: 6 }); // slide it inward
    await page.mouse.up();

    // Reset restores the rectangle (the irregular state clears).
    await page.getByRole("button", { name: /Reset to rectangle/i }).click();
    await expect(page.getByText(/Irregular footprint/i)).toHaveCount(0, { timeout: 8000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
