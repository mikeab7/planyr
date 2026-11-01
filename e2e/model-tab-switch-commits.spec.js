/* Model workspace — a half-typed cell must COMMIT to the sheet it was typed on when the person
 * switches sheet tabs (Excel's contract), never carry over and land on the next sheet.
 *
 * RED ON THE PRE-FIX CODE (old grid): nothing cleared SheetView's `edit` on a sheet change and the editor has
 * no blur, so "500" typed on Sheet1!B5 landed in Sheet2!B5 on the next Enter. The formula bar's
 * pending text was silently reset by its re-seed effect. Real key presses throughout
 * (SYNTHETIC-KEYS-DONT-EDIT).
 *
 * PORTED TO THE UNIVER GRID (NEW-2, 2026-10-31): the tab strip, the cell editor and the formula bar are Univer's; the cells are a
 * canvas, so cells are clicked at their computed point and read through the facade (e2e/lib/univerGrid.js). Every assertion still
 * reads BOTH sheets, so a write landing on the wrong one cannot pass.
 *
 * Run: npx playwright test e2e/model-tab-switch-commits.spec.js */
import { test, expect } from "@playwright/test";
import { openSpreadsheet, clickCell, enter, value, expectValue, clickFormulaBar, sheetNames, sheetTabs } from "./lib/univerGrid.js";

const tab = (page, name) => sheetTabs(page).filter({ hasText: new RegExp(`^${name}$`) }).first();
/** Click a tab (a real click on Univer's strip) and wait until Univer really shows that sheet. */
async function goTab(page, name) {
  await tab(page, name).click();
  await expect.poll(async () => (await sheetNames(page)).find((s) => s.active)?.name, { message: `${name} becomes the shown sheet` }).toBe(name);
  await page.waitForTimeout(300);
}
const addSheet = async (page) => {
  const n = (await sheetNames(page)).length;
  await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
  await expect.poll(async () => (await sheetNames(page)).length).toBe(n + 1);
  await page.waitForTimeout(400);
};

async function seed(page, id) {
  await openSpreadsheet(page, id, { slug: "model", name: "ZZ Model tabs e2e (throwaway)" });
  // A second sheet, holding a known value in B5 (row 4, col 1) the bug would overwrite.
  await addSheet(page);
  await expect(tab(page, "Sheet2")).toBeVisible();
  await enter(page, 4, 1, "222");
  await expectValue(page, 4, 1, 222);
  await goTab(page, "Sheet1");
  await expectValue(page, 4, 1, null, "Sheet1!B5 starts empty");
}

test.describe("Spreadsheet — switching sheet tabs with a half-typed entry", () => {
  test("a cell being typed commits to ITS sheet and does not touch the next one", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-1");
    await clickCell(page, 4, 1);
    await page.keyboard.type("500"); // no Enter
    await goTab(page, "Sheet2");
    await expectValue(page, 4, 1, 222, "Sheet2!B5 untouched by the half-typed 500");
    await clickCell(page, 6, 1); // any click/Enter on Sheet2 must not receive the 500
    await page.keyboard.press("Enter");
    await expectValue(page, 4, 1, 222);
    await goTab(page, "Sheet1");
    await expectValue(page, 4, 1, 500, "the 500 committed to Sheet1 where it was typed");
  });

  test("the formula bar's pending text commits to its own sheet too", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-2");
    await clickCell(page, 4, 1);
    await clickFormulaBar(page);
    await page.keyboard.type("777");
    await goTab(page, "Sheet2");
    await expectValue(page, 4, 1, 222, "Sheet2!B5 untouched by the formula bar's 777");
    await goTab(page, "Sheet1");
    await expectValue(page, 4, 1, 777, "the 777 committed to Sheet1 where it was typed");
  });

  test("adding a sheet while typing keeps the entry on the sheet it was typed on", async ({ page }) => {
    await seed(page, "e2e-model-tabcommit-3");
    await clickCell(page, 4, 1);
    await page.keyboard.type("900");
    await addSheet(page);
    await expect(tab(page, "Sheet3")).toBeVisible();
    await expect.poll(async () => (await sheetNames(page)).find((s) => s.active)?.name).toBe("Sheet3");
    expect(await value(page, 4, 1), "the new sheet is empty").toBeNull(); // the new sheet is empty
    await goTab(page, "Sheet1");
    await expectValue(page, 4, 1, 900, "the 900 committed to Sheet1");
  });
});
