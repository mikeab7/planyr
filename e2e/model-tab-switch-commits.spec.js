/* Model workspace — a half-typed cell must COMMIT to the sheet it was typed on when the person
 * switches sheet tabs (Excel's contract), never carry over and land on the next sheet.
 *
 * RED ON THE PRE-FIX CODE: nothing cleared SheetView's `edit` on a sheet change and the editor has
 * no blur, so "500" typed on Sheet1!B5 landed in Sheet2!B5 on the next Enter. The formula bar's
 * pending text was silently reset by its re-seed effect. Real key presses throughout
 * (SYNTHETIC-KEYS-DONT-EDIT).
 *
 * Run: npx playwright test e2e/model-tab-switch-commits.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const tab = (page, name) => page.locator('[data-testid^="model-sheet-tab-"]').filter({ hasText: new RegExp(`^${name}$`) }).first();

async function seed(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model tabs e2e (throwaway)", name: "ZZ Model tabs e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
  await page.goto(`/#/project/${id}/model`);
  await expect(sheetEl(page)).toBeVisible();
  // A second sheet, holding a known value in B5 (row 4, col 1) the bug would overwrite.
  await page.getByTestId("model-add-sheet").click();
  await expect(tab(page, "Sheet2")).toBeVisible();
  await cell(page, 4, 1).click(); await page.keyboard.type("222"); await page.keyboard.press("Enter");
  await expect(cell(page, 4, 1)).toHaveText("222");
  await tab(page, "Sheet1").click();
  await expect(cell(page, 4, 1)).toHaveText("");
}

test.describe("Spreadsheet — switching sheet tabs with a half-typed entry", () => {
  test("a cell being typed commits to ITS sheet and does not touch the next one", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-1");
    await cell(page, 4, 1).click();
    await page.keyboard.type("500"); // no Enter
    await tab(page, "Sheet2").click();
    await expect(cell(page, 4, 1)).toHaveText("222");
    await cell(page, 6, 1).click(); // any click/Enter on Sheet2 must not receive the 500
    await page.keyboard.press("Enter");
    await expect(cell(page, 4, 1)).toHaveText("222");
    await tab(page, "Sheet1").click();
    await expect(cell(page, 4, 1)).toHaveText("500");
  });

  test("the formula bar's pending text commits to its own sheet too", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-2");
    await cell(page, 4, 1).click();
    const bar = page.getByTestId("model-formula-bar");
    await bar.click();
    await page.keyboard.type("777");
    await tab(page, "Sheet2").click();
    await expect(cell(page, 4, 1)).toHaveText("222");
    await tab(page, "Sheet1").click();
    await expect(cell(page, 4, 1)).toHaveText("777");
  });

  test("adding a sheet while typing keeps the entry on the sheet it was typed on", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-3");
    await cell(page, 4, 1).click();
    await page.keyboard.type("900");
    await page.getByTestId("model-add-sheet").click();
    await expect(tab(page, "Sheet3")).toBeVisible();
    await expect(cell(page, 4, 1)).toHaveText(""); // the new sheet is empty
    await tab(page, "Sheet1").click();
    await expect(cell(page, 4, 1)).toHaveText("900");
  });
});
