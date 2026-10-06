/* NEW-1 (MAP-HANDLES) — the on-canvas +/− edit clusters must follow their element's EFFECTIVE
 * visibility. Owner report (Goose Creek, View reading "7 groups hidden"): green/orange "+" and red
 * "−" discs still floated over the aerial where the hidden buildings/parking had been.
 *
 * ROOT CAUSE: the hover scan (`onMove`) walked the whole `els` model, so hovering the footprint of a
 * HIDDEN element still armed `hoverElId` → `featActiveId` → `sideAddNodes`/`parkingAddNodes`. Hiding
 * clears `sel`, but nothing ever cleared (or refused) the hover. The gate is now one shared predicate
 * (`contentVisibility.refHidden`) asked by the hover scan, `featActiveId` and every handle group.
 *
 * Drives a real browser, logged out, blank site, no GIS/DB calls. Asserts DOM nodes (zero handle
 * nodes = zero hit targets) hidden, and that they come back un-hidden.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const editNodes = (p) => p.getByTestId("feature-edit-nodes");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1); await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 }); await page.mouse.up();
}
async function setGroup(page, key, on) {
  const btn = page.getByTestId("view-menu-btn");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  const cb = page.getByTestId(`view-row-${key}`);
  if ((await cb.isChecked()) !== on) await cb.click();
}
async function hoverAway(page, box) { await page.mouse.move(box.x + box.width - 40, box.y + 40); await page.waitForTimeout(80); }

for (const [type, key, draw] of [
  ["building", "el:building", async (page, b) => {
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await drag(page, b.x + 200, b.y + 160, b.x + 700, b.y + 460);
  }],
  ["parking", "el:parking", async (page, b) => {
    await page.getByRole("button", { name: "Parking", exact: true }).click();
    await drag(page, b.x + 200, b.y + 160, b.x + 700, b.y + 460);
  }],
]) {
  test(`${type}: hover/selection handles vanish when its group is hidden and return when shown`, async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await draw(page, box);
    await page.keyboard.press("Escape");
    // Zoom in until the edit controls are legible (they are gated on zoom).
    await page.mouse.move(box.x + 450, box.y + 300);
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
    await page.waitForTimeout(400);
    // Aim at the drawn element's own centre (read off the DOM), so the hover lands on its footprint.
    const bb = await page.locator('[data-feature^="el:"]').first().boundingBox();
    const center = { x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2) };

    await page.mouse.move(center.x, center.y); await page.mouse.move(center.x + 3, center.y + 2);
    await expect(editNodes(page), "precondition: the handles exist while visible").toHaveCount(1, { timeout: 5000 });

    await setGroup(page, key, false);
    await hoverAway(page, box);
    await page.mouse.move(center.x, center.y); await page.mouse.move(center.x + 3, center.y + 2);
    await page.waitForTimeout(150);
    await expect(editNodes(page)).toHaveCount(0);
    expect(await page.locator('[data-testid="feature-edit-nodes"] circle, [data-testid="feature-edit-nodes"] g[style*="cursor"]').count()).toBe(0);

    await setGroup(page, key, true);
    await hoverAway(page, box);
    await page.mouse.move(center.x, center.y); await page.mouse.move(center.x + 3, center.y + 2);
    await expect(editNodes(page)).toHaveCount(1, { timeout: 5000 });
  });
}
