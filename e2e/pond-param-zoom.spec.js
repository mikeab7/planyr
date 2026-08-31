/* NEW-1 — pond DESIGN-PARAMETER labels are inspect-zoom information, not site-overview information.
 *
 * Owner report (2026-07-26, screenshot of a 6.58-ac detention pond at working zoom): the berm-height
 * tag ("berm 8.2 ft") and the basin floor elevation ("Floor 145.1") painted at a FIXED size with a
 * heavy halo, so at a zoom where the pond's grading isn't legible anyway they out-shouted the
 * building dimension numbers — "that stuff is bigger than the building numbers … does not need to be
 * that big or even visible at that zoom."
 *
 * The fix (lib/labelLayout `pondParamLabelVisible` / `pondParamFontPx`, unit-tested) puts these
 * numbers on their own tier below the detail tier: each reveals only once the band it measures (the
 * berm's exterior face run, or the interior side-slope run down to that contour) projects to a
 * readable width on screen, and the font rides the shared dimension-number zoom scale so it can
 * never out-size a building dim.
 *
 * This spec proves the WIRING live, logged out on a seeded-blank site with no GIS calls: draw a
 * detention pond, confirm the floor / water-surface elevation callouts are ABSENT at the default
 * working zoom, that they RETURN on zoom-in, and that the depth rings themselves keep drawing at the
 * overview zoom (we hid the numbers, not the pond's grading). The berm tag needs real terrain grade
 * (fmElev.existGradeFt) which the sandbox can't fetch, so its gate is covered by the unit tests. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

// One 1.12× wheel step per event (the handler ignores magnitude) — same helper as
// dim-callout-edit.spec.js.
async function wheelZoom(page, steps, dir /* -1 in, +1 out */) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape"); // back to Select tool
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

test.describe("NEW-1 — pond elevation callouts wait for inspect zoom", () => {
  test("floor/WS elevations are hidden at working zoom, return on zoom-in, and the rings never leave", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    await drawPond(page);

    const elevLabels = page.locator("[data-contour-label]");
    const depthRings = page.locator('[data-contour="line"], [data-contour="water"], [data-contour="bottom"]');

    // At the default working zoom the basin's depth rings DO draw (the pond still reads as graded
    // ground) but none of its elevation numbers do — the regression the owner reported.
    await expect.poll(() => depthRings.count()).toBeGreaterThan(0);
    expect(await elevLabels.count()).toBe(0);

    // Zoom into the pond: the side-slope band grows past the tier threshold and the numbers return.
    await wheelZoom(page, 22, -1);
    await expect.poll(() => elevLabels.count()).toBeGreaterThan(0);

    // Every revealed number is at or below the dimension-number size (11px) — never the oversized
    // fixed label that started this. (The shared scale is clamped to 1× at/above working zoom.)
    const sizes = await elevLabels.evaluateAll((ns) => ns.map((n) => parseFloat(n.getAttribute("font-size"))));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) { expect(s).toBeGreaterThan(0); expect(s).toBeLessThanOrEqual(11); }

    // Zoom back out to the overview and they declutter again, rings still intact.
    await wheelZoom(page, 22, +1);
    await expect.poll(() => elevLabels.count()).toBe(0);
    expect(await depthRings.count()).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
