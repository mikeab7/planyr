/* Model workspace — NEW-1 (2026-10-29): Ctrl+Z while a cell editor is open must act on the editor's
 * text ONLY, never on the sheet's committed edits (owner, Windows: "start typing into a cell, press
 * Ctrl+Z to remove what I just typed — instead the sheet undo starts undoing OTHER, earlier changes").
 *
 * RED ON THE PRE-FIX CODE: the window-level undo listener in ModelApp.jsx asked nothing about where
 * the key came from. Real key presses throughout (SYNTHETIC-KEYS-DONT-EDIT); the one synthetic
 * dispatch (the editor-not-yet-focused window) bubbles on purpose.
 *
 * Run: npx playwright test e2e/model-cell-editor-undo.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const editor = (page) => sheetEl(page).locator("input").first();

async function seed(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model undo e2e (throwaway)", name: "ZZ Model undo e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
  await page.goto(`/#/project/${id}/model`);
  await expect(sheetEl(page)).toBeVisible();
  // Two COMMITTED edits = two sheet-level undo frames the bug would start eating.
  await cell(page, 0, 0).click(); await page.keyboard.type("500"); await page.keyboard.press("Enter");
  await cell(page, 1, 0).click(); await page.keyboard.type("300"); await page.keyboard.press("Enter");
  await expect(cell(page, 0, 0)).toHaveText("500");
  await expect(cell(page, 1, 0)).toHaveText("300");
}

const committedIntact = async (page) => {
  await expect(cell(page, 0, 0)).toHaveText("500");
  await expect(cell(page, 1, 0)).toHaveText("300");
};

test.describe("Spreadsheet — undo while typing in a cell", () => {
  test("Ctrl+Z undoes the typing inside the editor and never touches committed cells", async ({ page }) => {
    await seed(page, "e2e-model-edundo-1");
    await cell(page, 2, 0).click();
    await page.keyboard.type("abc");
    await expect(editor(page)).toHaveValue("abc");
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue("ab");
    await committedIntact(page);
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue("a");
    await page.keyboard.press("Control+y");
    await expect(editor(page)).toHaveValue("ab");
    await page.keyboard.press("Control+Shift+z");
    await expect(editor(page)).toHaveValue("abc");
    await committedIntact(page);
  });

  test("with nothing left to undo, Ctrl+Z abandons the edit back to the original value", async ({ page }) => {
    await seed(page, "e2e-model-edundo-2");
    await cell(page, 0, 0).dblclick(); // edit A1 (500)
    await page.keyboard.press("End");
    await page.keyboard.type("7");
    await expect(editor(page)).toHaveValue("5007");
    await page.keyboard.press("Control+z");
    await expect(editor(page)).toHaveValue("500");
    await page.keyboard.press("Control+z");
    await expect(sheetEl(page).locator("input")).toHaveCount(0);
    await committedIntact(page);
  });

  test("after Enter, Ctrl+Z undoes that whole committed cell edit as one step", async ({ page }) => {
    await seed(page, "e2e-model-edundo-3");
    await cell(page, 2, 0).click();
    await page.keyboard.type("999"); await page.keyboard.press("Enter");
    await expect(cell(page, 2, 0)).toHaveText("999");
    await page.keyboard.press("Control+z");
    await expect(cell(page, 2, 0)).toHaveText("");
    await committedIntact(page);
  });

  test("the editor-not-yet-focused window (key lands on the grid, B1287888) is covered too", async ({ page }) => {
    await seed(page, "e2e-model-edundo-4");
    await cell(page, 2, 0).click();
    await page.keyboard.type("xy");
    await expect(editor(page)).toHaveValue("xy");
    // Same key, but delivered to the grid container instead of the input (bubbles, as a real key does).
    await page.evaluate(() => {
      document.querySelector('[data-testid="model-sheet"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await expect(editor(page)).toHaveValue("x");
    await committedIntact(page);
  });

  test("the formula bar and column-rename box keep undo for their own text", async ({ page }) => {
    await seed(page, "e2e-model-edundo-5");
    await cell(page, 2, 0).click();
    const fb = page.getByTestId("model-formula-bar");
    await fb.click(); await page.keyboard.type("hello");
    await page.keyboard.press("Control+z");
    await committedIntact(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("model-col-header-1").dblclick();
    await page.keyboard.press("Control+A"); await page.keyboard.type("Revenue");
    await page.keyboard.press("Control+z");
    await committedIntact(page);
  });
});
