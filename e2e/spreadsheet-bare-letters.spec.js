/* NEW-1 (2026-10-29) — a bare letter on the Spreadsheet is a letter, never the fullscreen shortcut.
 *
 * Owner: "on the Spreadsheet tab, with a cell selected (not yet in edit mode), press F to start typing —
 * the whole app goes fullscreen instead of the cell starting an edit with 'f'."
 *
 * The grid is a focusable <div> with type-to-edit, not a contenteditable and not an INPUT, so the shell's
 * window keydown (AppHeader) let the key through. `Element.prototype.requestFullscreen` is SPIED (counted,
 * not performed) so the assertion is "the toggle was never called", independent of whether this browser
 * grants fullscreen. The Site Planner arm is the known-good control: bare F must still toggle there, and the
 * run is void if it does not (a spy that can't see the call proves nothing).
 *
 * Run: npx playwright test e2e/spreadsheet-bare-letters.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const fsCalls = (page) => page.evaluate(() => window.__fsCalls);

async function seed(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Bare letters e2e (throwaway)", name: "ZZ Bare letters e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
    window.__fsCalls = 0;
    Element.prototype.requestFullscreen = function () { window.__fsCalls += 1; return Promise.resolve(); };
    Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen;
  }, [id, site]);
}

test.describe("bare letters on the Spreadsheet", () => {
  test("control: bare F still toggles fullscreen where nothing is editable (the Site Planner)", async ({ page }) => {
    await seed(page, "e2e-bare-control");
    await page.goto("/#/project/e2e-bare-control/site");
    await expect(page.locator('[data-testid="toggle-fullscreen"]').first()).toBeVisible();
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press("f");
    await expect.poll(() => fsCalls(page)).toBe(1);
  });

  test("F on a selected (not editing) cell starts an edit with 'f' and never goes fullscreen", async ({ page }) => {
    await seed(page, "e2e-bare-f");
    await page.goto("/#/project/e2e-bare-f/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await page.keyboard.press("f");
    await expect(sheetEl(page).locator("input").first()).toHaveValue("f");
    await page.keyboard.press("Shift+F");
    await expect(sheetEl(page).locator("input").first()).toHaveValue("fF");
    await page.keyboard.press("Enter");
    await expect(cell(page, 0, 0)).toHaveText("fF");
    expect(await fsCalls(page)).toBe(0);
  });

  test("F with focus parked on <body> (after a toolbar click) is still a letter on this module", async ({ page }) => {
    await seed(page, "e2e-bare-body");
    await page.goto("/#/project/e2e-bare-body/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("f");
    expect(await fsCalls(page)).toBe(0);
  });

  test("control (measured unaffected): '?' on a selected cell starts an edit and does not open the shortcuts page", async ({ page }) => {
    await seed(page, "e2e-bare-help");
    await page.goto("/#/project/e2e-bare-help/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await page.keyboard.press("?");
    await expect(sheetEl(page).locator("input").first()).toHaveValue("?");
    await expect(page.getByTestId("shortcuts-page")).toHaveCount(0);
  });

  test("fullscreen stays reachable on the Spreadsheet: Ctrl+Shift+F and the header button", async ({ page }) => {
    await seed(page, "e2e-bare-reach");
    await page.goto("/#/project/e2e-bare-reach/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await page.keyboard.press("Control+Shift+F");
    await expect.poll(() => fsCalls(page)).toBe(1);
    await page.locator('[data-testid="toggle-fullscreen"]').first().click();
    await expect.poll(() => fsCalls(page)).toBeGreaterThanOrEqual(1);
  });
});
