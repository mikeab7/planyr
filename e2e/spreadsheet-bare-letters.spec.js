/* NEW-1 (2026-10-29) — a bare letter on the Spreadsheet is a letter, never the fullscreen shortcut.
 *
 * Owner: "on the Spreadsheet tab, with a cell selected (not yet in edit mode), press F to start typing —
 * the whole app goes fullscreen instead of the cell starting an edit with 'f'."
 *
 * `Element.prototype.requestFullscreen` is SPIED (counted, not performed) so the assertion is "the toggle was never called",
 * independent of whether this browser grants fullscreen. The Site Planner arm is the known-good control: bare F must still toggle
 * there, and the run is void if it does not (a spy that can't see the call proves nothing).
 *
 * PORTED TO THE UNIVER GRID (NEW-2, 2026-10-31): the grid is a canvas, so the cell is clicked at its computed point, the text of the
 * edit in flight is read from Univer's cell-editor document (`cellEditorText`) and the committed text through the facade.
 * Same check also lives in ui-audit/verify-univer-parity.mjs as `bare-letter`.
 *
 * Run: npx playwright test e2e/spreadsheet-bare-letters.spec.js
 */
import { test, expect } from "@playwright/test";
import { armUniverE2E, seedProject, waitForGrid, openSpreadsheet, clickCell, expectValue, cellEditorText } from "./lib/univerGrid.js";

const fsCalls = (page) => page.evaluate(() => window.__fsCalls);

/** Count (never perform) every fullscreen request this page makes. */
async function spy(page) {
  await page.addInitScript(() => {
    window.__fsCalls = 0;
    Element.prototype.requestFullscreen = function () { window.__fsCalls += 1; return Promise.resolve(); };
    Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen;
  });
}
async function openGrid(page, id) {
  await spy(page);
  await openSpreadsheet(page, id, { slug: "model", name: "ZZ Bare letters e2e (throwaway)" });
}

test.describe("bare letters on the Spreadsheet", () => {
  test("control: bare F still toggles fullscreen where nothing is editable (the Site Planner)", async ({ page }) => {
    await spy(page);
    await seedProject(page, "e2e-bare-control", "ZZ Bare letters e2e (throwaway)");
    await page.goto("/#/project/e2e-bare-control/site");
    await expect(page.locator('[data-testid="toggle-fullscreen"]').first()).toBeVisible();
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press("f");
    await expect.poll(() => fsCalls(page)).toBe(1);
  });

  test("F on a selected (not editing) cell starts an edit with 'f' and never goes fullscreen", async ({ page }) => {
    await openGrid(page, "e2e-bare-f");
    await clickCell(page, 0, 0);
    await page.keyboard.press("f");
    await expect.poll(() => cellEditorText(page), { message: "the 'f' went into the cell editor" }).toBe("f");
    await page.keyboard.press("Shift+F");
    await expect.poll(() => cellEditorText(page)).toBe("fF");
    await page.keyboard.press("Enter");
    await expectValue(page, 0, 0, "fF");
    expect(await fsCalls(page)).toBe(0);
  });

  test("F with focus parked on <body> (after a toolbar click) is still a letter on this module", async ({ page }) => {
    await openGrid(page, "e2e-bare-body");
    await clickCell(page, 0, 0);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    expect(await fsCalls(page)).toBe(0);
  });

  test("control (measured unaffected): '?' on a selected cell starts an edit and does not open the shortcuts page", async ({ page }) => {
    await openGrid(page, "e2e-bare-help");
    await clickCell(page, 0, 0);
    await page.keyboard.press("?");
    await expect.poll(() => cellEditorText(page)).toBe("?");
    await expect(page.getByTestId("shortcuts-page")).toHaveCount(0);
  });

  test("fullscreen stays reachable on the Spreadsheet: Ctrl+Shift+F and the header button", async ({ page }) => {
    await openGrid(page, "e2e-bare-reach");
    await clickCell(page, 0, 0);
    await page.keyboard.press("Control+Shift+F");
    await expect.poll(() => fsCalls(page)).toBe(1);
    await page.locator('[data-testid="toggle-fullscreen"]').first().click();
    await expect.poll(() => fsCalls(page)).toBeGreaterThanOrEqual(1);
  });
});
