/* B1806241/B1806242 (dispatch, 2026-09-20 — owner live pass on planyr.io build 27671fa,
 * PR #1786's own merge commit, right after B1790016/B1790017 shipped the car-parking spec
 * sheet) — two defects in the rebuilt car-parking Properties panel:
 *
 * NEW-1 (B1806241) — the spec sheet's own GEOMETRY section grew a "Rotation" row
 * (SitePlanner.jsx's `specRow("Rotation", …)`, B1790016), but the panel's generic trailing
 * Rotation field — rendered after every type's own branch for every selected element that
 * isn't a dock zone / building / centerline road — was never taught to exclude "parking",
 * which the rebuild didn't exist for when that exclusion list was written. So a car-parking
 * field carried TWO live Rotation controls: one inside GEOMETRY, an orphaned second one below
 * the Pin/Delete action bar. Fixed by adding `selEl.type !== "parking"` to that exclusion.
 *
 * NEW-2 (B1806242) — the Aisle side picture control (AisleSideCard, B1790017) correctly
 * disables both cards when flipping the field's depth would be a no-op (both outer edges are
 * already stall rows — flipDepth mirrors the field about its own midpoint, which is symmetric
 * for a depth that is an exact whole number of stall+aisle modules, `parkFlipIsNoOp`), but
 * neither card's own hover title changed to say why — LOUD-FAILURE requires the CONTROL to
 * name the reason, not only a separate paragraph a pointer resting on the button never reads.
 * Fixed by adding a `disabledReason` prop (the same convention RotationStepper already uses)
 * that becomes the disabled card's title.
 *
 * Both are plain canvas/panel UI with no cloud/GIS dependency — Claude-doable logged out per
 * ATTEMPT-BEFORE-YOU-PARK. Verify: sandbox.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_KEY = "planarfit:sites:v1";

const readEls = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
}, SITE_KEY);

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

async function drawFreestandingField(page, box) {
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 320, { steps: 5 });
  await page.mouse.move(box.x + 650, box.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function selectAndOpenProperties(page, elId) {
  const box = await page.locator(`[data-el-id="${elId}"]`).first().boundingBox();
  const x = box.x + Math.min(8, box.width / 2), y = box.y + Math.min(4, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
}

async function fieldGroups(page) {
  return page.evaluate(() => [...document.querySelectorAll('div[data-field-group="1"]')].map((d) => ({
    label: d.querySelector("span")?.textContent,
    inputValue: d.querySelector("input")?.value,
  })));
}

async function setSpecRow(page, label, value) {
  const groups = await fieldGroups(page);
  const idx = groups.findIndex((g) => g.label === label);
  expect(idx, `field-group row labelled "${label}" — got: ${JSON.stringify(groups)}`).not.toBe(-1);
  const input = page.locator('div[data-field-group="1"]').nth(idx).locator("input").first();
  await input.fill(String(value));
  await input.press("Enter");
  await page.waitForTimeout(150);
}

test.describe("Car-parking spec sheet — NEW-1 no duplicate Rotation, NEW-2 disabled aisle cards explain why", () => {
  test("exactly one Rotation control renders, inside GEOMETRY, nothing below Pin/Delete", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    const els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);

    // Exactly one "Rotation" field-group row.
    const groups = await fieldGroups(page);
    const rotationRows = groups.filter((g) => g.label === "Rotation" || g.label === "Rotation (°)");
    expect(rotationRows, JSON.stringify(groups)).toHaveLength(1);

    // The one row lives above "Delete element", never below it.
    const order = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('div[data-field-group="1"] span, button')];
      const texts = nodes.map((n) => n.textContent?.trim());
      const rotIdx = texts.findIndex((t) => t === "Rotation" || t === "Rotation (°)");
      const delIdx = texts.findIndex((t) => t === "Delete element");
      return { rotIdx, delIdx };
    });
    expect(order.rotIdx).toBeGreaterThan(-1);
    expect(order.delIdx).toBeGreaterThan(-1);
    expect(order.rotIdx).toBeLessThan(order.delIdx);

    // Rotating still works through the surviving control (no regression from the removal).
    await setSpecRow(page, "Rotation", 45);
    const after = await readEls(page);
    expect(after.find((e) => e.id === fieldId).rot).toBe(45);
  });

  test("both Aisle side cards disable at a whole-module depth and name the reason on hover", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    let els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);

    // Stall depth 18 / drive aisle 24 are this plan's standing defaults; set Depth to 360 —
    // exactly 6 double-loaded modules (2*18+24=60) — so flipping is a genuine no-op.
    await setSpecRow(page, "Stall depth", 18);
    await setSpecRow(page, "Drive aisle", 24);
    await setSpecRow(page, "Depth", 360);

    els = await readEls(page);
    expect(els.find((e) => e.id === fieldId).h).toBe(360);

    const cards = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /Stalls first|Aisle first/.test(b.textContent || ""))
      .map((b) => ({ title: b.getAttribute("title"), disabled: b.disabled })));
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.disabled).toBe(true);
      // The control's OWN title must name the reason — not just an unrelated static label.
      expect(c.title).toMatch(/nothing to swap|both edges|already stall rows/i);
    }

    // Control case: a depth with a genuine leftover row re-enables both cards with their
    // ordinary titles (no stale disabled-reason once the condition clears).
    await setSpecRow(page, "Depth", 380);
    const cards2 = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')]
      .filter((b) => /Stalls first|Aisle first/.test(b.textContent || ""))
      .map((b) => ({ title: b.getAttribute("title"), disabled: b.disabled })));
    for (const c of cards2) {
      expect(c.disabled).toBe(false);
      expect(c.title).not.toMatch(/nothing to swap/i);
    }
  });
});
