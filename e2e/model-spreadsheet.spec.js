/* Model workspace — live-browser verification of the vertical slice: virtualised rows,
 * rectangular selection, keyboard nav, the inline editor, the formula bar, number formats,
 * undo/redo and local-storage persistence.
 *
 * Seeds a throwaway local "project" (a Site Planner site group — a project IS one, see
 * src/shared/projects/projects.js) the same way e2e/callout-absolute-front.spec.js does,
 * rather than driving the map-based "New project" flow: that flow needs live GIS tile hosts
 * this sandbox blocks, and Model attaches to any project id regardless of what's drawn on it.
 * Nothing here is written to real production data — the site is a fresh id seeded into this
 * browser context's own localStorage only.
 *
 * This spec exists because it FOUND three real bugs no unit test could have (all fixed in the
 * same session): (1) the cell editor's `onFocus` selected the just-seeded type-to-edit
 * character, so the very next keystroke replaced it instead of continuing after it — typing
 * "1000000" landed as "000000"; (2) the column-header rename `<input>` had no guard against
 * the sheet's own global keydown handler, so every letter typed while renaming ALSO fired
 * type-to-edit on the active cell, whose autoFocus stole focus back and blurred the rename box
 * shut after one keystroke; (3) `Math.max(totalW, "100%")` produced a literal NaN width. None
 * of the pure unit tests (test/modelSheetModel.test.js, test/modelSheetEngine.test.js) could
 * see any of these — they never touch a real DOM input or a real keydown/focus sequence.
 *
 * Run: npx playwright test e2e/model-spreadsheet.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model e2e (throwaway)", name: "ZZ Model e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

async function renameCol(page, idx, name) {
  await page.getByTestId(`model-col-header-${idx}`).dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** The shared setup every test needs: a seeded project, on the Model route, with Revenue /
 *  Cost / NOI wired up (rename + two data rows + one formula column). Building this once
 *  keeps each `test()` focused on the ONE behaviour it names. */
async function openModelWithNoi(page, siteId) {
  await seedProject(page, siteId);
  await page.goto(`/#/project/${siteId}/model`);
  await expect(sheetEl(page)).toBeVisible();
  await renameCol(page, 0, "Revenue");
  await renameCol(page, 1, "Cost");
  await renameCol(page, 2, "NOI");
  await cell(page, 0, 0).click(); await typeAndEnter(page, "1000000"); await typeAndEnter(page, "1650000");
  await cell(page, 0, 1).click(); await typeAndEnter(page, "400000"); await typeAndEnter(page, "700000");
  await cell(page, 0, 2).click(); await typeAndEnter(page, "=[Revenue]-[Cost]");
}

test.describe("Model workspace — spreadsheet vertical slice", () => {
  test("renders a sheet for an open project, straight from a deep link", async ({ page }) => {
    await seedProject(page, "e2e-model-boot");
    await page.goto("/#/project/e2e-model-boot/model");
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.getByTestId("model-col-header-0")).toHaveText("A");
  });

  test("typing a full number character-by-character does not lose the leading digit", async ({ page }) => {
    // Regression guard for the onFocus/select-all bug: a naive re-introduction selects the
    // type-to-edit seed character, and the next keystroke replaces it.
    await seedProject(page, "e2e-model-type");
    await page.goto("/#/project/e2e-model-type/model");
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "1000000");
    await expect(cell(page, 0, 0)).toHaveText("1000000");
  });

  test("column rename applies, and survives typing a multi-character name", async ({ page }) => {
    // Regression guard for the header-rename-vs-global-keydown bug.
    await seedProject(page, "e2e-model-rename");
    await page.goto("/#/project/e2e-model-rename/model");
    await renameCol(page, 0, "Revenue");
    await expect(page.getByTestId("model-col-header-0")).toContainText("Revenue");
  });

  test("a formula column computes per row from same-row named-column references", async ({ page }) => {
    const id = "e2e-model-formula";
    await openModelWithNoi(page, id);
    await expect(cell(page, 0, 2)).toHaveText("600000");
    await expect(cell(page, 1, 2)).toHaveText("950000");
    await expect(page.getByTestId("model-col-header-2")).toContainText("fx");
  });

  test("the formula bar shows the underlying formula, never the displayed value", async ({ page }) => {
    const id = "e2e-model-formulabar";
    await openModelWithNoi(page, id);
    await cell(page, 0, 2).click();
    await expect(page.getByTestId("model-formula-bar")).toHaveValue("=[Revenue]-[Cost]");
  });

  test("a genuinely blank row shows nothing for a formula column, not a confident 0", async ({ page }) => {
    const id = "e2e-model-blank";
    await openModelWithNoi(page, id);
    await expect(cell(page, 10, 2)).toHaveText("");
  });

  test("the number-format picker applies through the shared formatValue", async ({ page }) => {
    const id = "e2e-model-format";
    await openModelWithNoi(page, id);
    await page.getByTestId("model-format-picker").selectOption("currency");
    await expect(cell(page, 0, 2)).toHaveText("$600,000.00");
  });

  test("shift-click makes a rectangular selection distinct from unselected cells", async ({ page }) => {
    const id = "e2e-model-select";
    await openModelWithNoi(page, id);
    await cell(page, 0, 0).click();
    await page.keyboard.down("Shift");
    await cell(page, 1, 1).click();
    await page.keyboard.up("Shift");
    const selBg = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).backgroundColor);
    const outsideBg = await cell(page, 0, 2).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(selBg).not.toBe(outsideBg);
  });

  test("Delete blanks the selected range, and Ctrl+Z restores it", async ({ page }) => {
    const id = "e2e-model-undo";
    await openModelWithNoi(page, id);
    await cell(page, 0, 0).click();
    await page.keyboard.down("Shift");
    await cell(page, 1, 1).click();
    await page.keyboard.up("Shift");
    await page.keyboard.press("Delete");
    await expect(cell(page, 0, 0)).toHaveText("");
    await page.keyboard.press("Control+z");
    await expect(cell(page, 0, 0)).toHaveText("1000000");
  });

  test("Tab commits the edit and advances one column right", async ({ page }) => {
    const id = "e2e-model-tab";
    await openModelWithNoi(page, id);
    await cell(page, 2, 0).click();
    await page.keyboard.type("500000");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-col", "1");
  });

  test("row virtualization: only a bounded slice of rows is in the DOM after a deep scroll", async ({ page }) => {
    const id = "e2e-model-virtualized";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 20000; });
    await expect(async () => {
      const rowCount = await page.locator("[data-row]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("data-row"))).size);
      expect(rowCount).toBeLessThan(80);
      expect(rowCount).toBeGreaterThan(0);
    }).toPass();
    const scrollTop = await sheetEl(page).evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(5000); // proves the scroll actually moved, not stuck at 0
  });

  test("a row reached only by scrolling is genuinely editable, and the sheet survives a reload", async ({ page }) => {
    const id = "e2e-model-reload";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "1000000");
    await sheetEl(page).evaluate((el) => { el.scrollTop = 20000; });
    const rows = await page.locator("[data-row]").evaluateAll((els) => [...new Set(els.map((e) => Number(e.getAttribute("data-row"))))].sort((a, b) => a - b));
    const deepRow = rows[Math.floor(rows.length / 2)];
    await cell(page, deepRow, 0).click();
    await typeAndEnter(page, "deep-row-marker");
    await expect(cell(page, deepRow, 0)).toHaveText("deep-row-marker");

    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(cell(page, 0, 0)).toHaveText("1000000");
  });
});
