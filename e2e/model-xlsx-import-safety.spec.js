/* Model workspace — live-browser verification of NEW-1/NEW-2 (owner chat block, 2026-09-05).
 *
 * NEW-1: Import Excel used to replace the WHOLE workbook unconditionally, with nothing in the
 * label or the flow warning that it would — confirmed live on the owner's Goose Creek project,
 * a two-sheet import silently wiped an existing Sheet1. The pure gate (`workbookHasContent`) is
 * proven headlessly in test/modelXlsxIO.test.js; this spec proves the other half — the real
 * button flow actually asks before replacing a workbook that has something in it, and an empty
 * workbook still imports with no prompt at all (the exact case CLAUDE.md calls "the trap": a test
 * that only tries the empty workbook passes on the old, unconditional-replace behavior too).
 *
 * NEW-2: a non-.xlsx file used to surface JSZip's own developer-facing error (a "central
 * directory"/zip message plus a link to JSZip's own docs) straight to the user. This proves the
 * real button flow shows a plain sentence instead — the parse-layer fix is proven headlessly in
 * test/modelXlsxIO.test.js.
 *
 * Run: npx playwright test e2e/model-xlsx-import-safety.spec.js
 */
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model xlsx-safety e2e (throwaway)", name: "ZZ Model xlsx-safety e2e (throwaway)",
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

async function buildFixtureXlsx(sheetNames) {
  const wb = new ExcelJS.Workbook();
  for (const name of sheetNames) {
    const ws = wb.addWorksheet(name);
    ws.getCell("A1").value = `hello from ${name}`;
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

test.describe("Model workspace — Import Excel safety (NEW-1/NEW-2)", () => {
  test("importing Excel into a workbook that already has content ASKS FIRST, and 'Keep this workbook' leaves it untouched", async ({ page }) => {
    await seedProject(page, "e2e-model-xlsx-confirm-keep");
    await page.goto("/#/project/e2e-model-xlsx-confirm-keep/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "existing data"); // A1 — the current workbook now has content

    const buf = await buildFixtureXlsx(["Imported1", "Imported2"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", {
      name: "two-sheets.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buf,
    });

    const confirm = page.getByTestId("model-import-replace-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("two-sheets.xlsx");
    // The existing cell is STILL there — nothing was replaced yet.
    await expect(cell(page, 0, 0)).toHaveText("existing data");

    await confirm.getByRole("button", { name: "Keep this workbook" }).click();
    await expect(confirm).toBeHidden();
    // Still untouched after declining.
    await expect(cell(page, 0, 0)).toHaveText("existing data");
    await expect(page.getByTestId("model-sheet-tab-0")).not.toContainText("Imported1");
  });

  test("importing Excel into a workbook that already has content, then confirming 'Replace', replaces it", async ({ page }) => {
    await seedProject(page, "e2e-model-xlsx-confirm-replace");
    await page.goto("/#/project/e2e-model-xlsx-confirm-replace/model");
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "existing data");

    const buf = await buildFixtureXlsx(["Imported1", "Imported2"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", {
      name: "two-sheets.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buf,
    });

    const confirm = page.getByTestId("model-import-replace-confirm");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Replace" }).click();
    await expect(confirm).toBeHidden();

    await expect(page.getByTestId("model-file-notice")).toContainText("two-sheets.xlsx");
    await expect(cell(page, 0, 0)).toHaveText("hello from Imported1");
    await expect(page.getByTestId("model-sheet-tab-0")).toContainText("Imported1");
    await expect(page.getByTestId("model-sheet-tab-1")).toContainText("Imported2");
  });

  test("importing Excel into a brand-new, never-typed-into workbook needs NO confirmation — the trap CLAUDE.md names", async ({ page }) => {
    await seedProject(page, "e2e-model-xlsx-confirm-empty");
    await page.goto("/#/project/e2e-model-xlsx-confirm-empty/model");
    await expect(sheetEl(page)).toBeVisible();

    const buf = await buildFixtureXlsx(["Imported1"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", {
      name: "one-sheet.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buf,
    });

    // No confirm banner at all — it goes straight through, exactly like before this fix.
    await expect(page.getByTestId("model-import-replace-confirm")).toHaveCount(0);
    await expect(page.getByTestId("model-file-notice")).toContainText("one-sheet.xlsx");
    await expect(cell(page, 0, 0)).toHaveText("hello from Imported1");
  });

  test("a non-Excel file shows a plain sentence, never JSZip's own developer error", async ({ page }) => {
    await seedProject(page, "e2e-model-xlsx-bad-file");
    await page.goto("/#/project/e2e-model-xlsx-bad-file/model");
    await expect(sheetEl(page)).toBeVisible();

    await page.setInputFiles("[data-testid=model-import-xlsx-input]", {
      name: "test_not_really.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("this is just a plain text file, not a real xlsx workbook"),
    });

    const notice = page.getByTestId("model-file-notice");
    await expect(notice).toBeVisible();
    const text = (await notice.textContent()) || "";
    expect(text.toLowerCase()).not.toContain("jszip");
    expect(text.toLowerCase()).not.toContain("central directory");
    expect(text.toLowerCase()).not.toMatch(/https?:\/\//);
    expect(text).toContain("test_not_really.xlsx");
  });
});
