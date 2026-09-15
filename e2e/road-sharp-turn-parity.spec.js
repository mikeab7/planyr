/* B1612608 (item 1) — PDF-PARITY for the sharp-turn road-surface join fix. The road pavement path
 * (`[data-testid="road-network-surface"]`, `roadNetwork.regionPathD` over `roadStripRing`) is drawn
 * exactly once, on the live canvas; `exportSheet.buildExportSvg` CLONES that live `<svg>` rather than
 * re-deriving the geometry (see e2e/measure-export-lod.spec.js's header for the general rule this
 * follows), so the fix needs no separate export-side change — but that claim is asserted here on the
 * real built sheet, not left as a read of the source.
 *
 * Draws a road with a TIGHT bend (short legs relative to its width, so even the default Arc corner
 * treatment feasibility-clamps toward a hard corner — the real-world repro shape, not a synthetic
 * `treatment:"sharp"` fixture) and diffs the live pavement path's `d` attribute against the same
 * element in the exported sheet: they must be the identical string.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).click({ position: { x: 20, y: 20 } });
}

test.describe("B1612608 item 1 — PDF-PARITY on a sharp road turn", () => {
  test("the exported sheet's pavement path is byte-identical to the live canvas's", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    // A short truck-court-stub-style bend: a long leg in, then a SHORT leg turning ~75° off it —
    // short relative to a wide road, so the arc corner's feasibility clamp pulls it toward sharp.
    await page.getByRole("button", { name: "Road", exact: true }).click();
    await page.getByRole("button", { name: "Road presets" }).click();
    await page.getByRole("button", { name: /^\d+′$/ }).last().click(); // the widest preset on offer
    await page.mouse.click(box.x + 400, box.y + 150);
    await page.mouse.click(box.x + 400, box.y + 450);
    await page.mouse.click(box.x + 470, box.y + 480);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    const live = await page.locator('[data-testid="road-network-surface"]').first().getAttribute("d");
    expect(live, "the live canvas must actually draw a dissolved road surface").toBeTruthy();

    const exported = await page.evaluate(async () => {
      const markup = await window.__plannerExportSvg();
      if (!markup) return null;
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      const el = doc.querySelector('[data-testid="road-network-surface"]');
      return el ? el.getAttribute("d") : null;
    });
    expect(exported, "the exported sheet must carry the same pavement path").toBeTruthy();
    expect(exported).toBe(live);
  });
});
