/* B705200 (×2) — the owner's absolute rule, stated twice: "I don't wanna see control points on
 * anything ever unless I have the element selected." PR #1132 fixed the mount-time auto-select
 * that was arming PARCEL handles on every reopen, and its own audit pass declared every
 * vertex-editable kind "correctly gates on sel" — true of every HANDLE (the draggable grip
 * layer), and irrelevant here: `[data-measure-vertex]` is a separate, purely decorative circle
 * painted unconditionally in the measurement's own content pass (SitePlanner.jsx, the mode-line/
 * mode-area render branch), with `pointerEvents="none"` and no selection gate at all. It never
 * responded to a click, so nobody noticed it wasn't gated.
 *
 * Reproduced live on the owner's real plan (project smsrpaiqu5sv, plan "Concept A 1M SF" /
 * smsrrlk9u576, the magenta measurement south of the buildings): 8 `[data-measure-vertex]`
 * circles in the DOM with nothing selected. This spec reproduces the mechanism logged-out on a
 * seeded-blank site — no auth, no GIS — which is sufficient because the defect lives entirely in
 * the measurement content-render branch, not in any project-specific data. The signed-in check
 * against the real plan is V384528 (VERIFICATION.md).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const vertexDots = (p) => p.locator("[data-measure-vertex]");

function measureCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).length;
  });
}

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function armMeasure(page, mode) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
}

test.describe("B705200 (×2) — measurement vertex dots never show at rest, only when selected", () => {
  test("a Length measurement: no dots with nothing selected, dots appear on select, dots clear on deselect", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    await page.mouse.click(box.x + 300, box.y + 300);
    await page.mouse.click(box.x + 500, box.y + 300);
    await expect.poll(() => measureCount(page)).toBe(1);
    // Drawing a length commits it immediately (two clicks) with nothing selected afterward — the
    // exact state the owner's report describes: "touch nothing… I don't even have it selected."
    await page.keyboard.press("Escape");

    await expect(vertexDots(page), "vertex dots painted with nothing selected").toHaveCount(0);

    // Select the measurement by clicking its grab band (the drawn line).
    await page.keyboard.press("v"); // Select tool shortcut
    await page.mouse.click(box.x + 400, box.y + 300);
    await expect(page.getByTestId("measure-selected")).toBeVisible();
    await expect(vertexDots(page), "no vertex dots while the measurement IS selected").toHaveCount(2);

    // Deselect (click empty canvas) — the dots must clear with the selection.
    await page.mouse.click(box.x + 100, box.y + 100);
    await expect(page.getByTestId("measure-selected")).toHaveCount(0);
    await expect(vertexDots(page), "vertex dots survived deselect").toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a Polylength measurement: same gate holds for a multi-vertex run", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Polylength");
    await page.mouse.click(box.x + 280, box.y + 260);
    await page.mouse.click(box.x + 420, box.y + 300);
    await page.mouse.click(box.x + 560, box.y + 260);
    await page.keyboard.press("Enter");
    await expect.poll(() => measureCount(page)).toBe(1);
    await page.keyboard.press("Escape");

    await expect(vertexDots(page), "vertex dots painted with nothing selected").toHaveCount(0);

    await page.keyboard.press("v"); // Select tool shortcut
    await page.mouse.click(box.x + 350, box.y + 280);
    await expect(page.getByTestId("measure-selected")).toBeVisible();
    await expect(vertexDots(page)).toHaveCount(3);

    await page.mouse.click(box.x + 100, box.y + 100);
    await expect(vertexDots(page), "vertex dots survived deselect").toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
