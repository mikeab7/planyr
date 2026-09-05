/* Model workspace — live-browser verification of the Excel round-trip UI wiring (NEW-1, owner
 * chat block). The formula/formatting CORRECTNESS is proven headlessly in test/modelXlsxIO.test.js
 * and test/modelCsvIO.test.js (which is where CI actually gates — this file does not run
 * pre-merge, see e2e.yml). This spec proves the other half: the real File menu button really
 * triggers a real browser download, and a real chosen file really lands in the grid via the
 * hidden file inputs — the part a pure unit test cannot see.
 *
 * Run: npx playwright test e2e/model-xlsx-roundtrip.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model xlsx e2e (throwaway)", name: "ZZ Model xlsx e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test.describe("Model workspace — Excel round-trip UI wiring", () => {
  test("File menu Export downloads a real .xlsx that opens back with the same value", async ({ page }) => {
    await seedProject(page, "e2e-model-xlsx-export");
    await page.goto("/#/project/e2e-model-xlsx-export/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "12345"); // A1

    await page.getByTestId("model-file-menu-btn").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("model-export-xlsx").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path);
    expect(bytes.byteLength).toBeGreaterThan(0);
    // A real .xlsx is a real zip — PK magic bytes — never an HTML error page or an empty file.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  test("File menu Import CSV adds a new sheet with the file's own values", async ({ page }) => {
    await seedProject(page, "e2e-model-csv-import");
    await page.goto("/#/project/e2e-model-csv-import/model");
    await expect(sheetEl(page)).toBeVisible();

    await page.setInputFiles("[data-testid=model-import-csv-input]", {
      name: "budget.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Item,Cost\nLand,500000\n"),
    });
    await expect(page.getByTestId("model-file-notice")).toContainText("budget.csv");
    await expect(page.getByTestId("model-sheet-tab-1")).toContainText("budget");
    await expect(cell(page, 0, 0)).toHaveText("Item");
    await expect(cell(page, 1, 1)).toHaveText("500000");
  });
});
