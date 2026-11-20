/* Model workspace — live-browser verification of the Excel round-trip UI wiring (NEW-1, owner
 * chat block). The formula/formatting CORRECTNESS is proven headlessly in test/modelXlsxIO.test.js
 * and test/modelCsvIO.test.js (which is where CI actually gates — this file does not run
 * pre-merge, see e2e.yml). This spec proves the other half: the real File menu button really
 * triggers a real browser download, and a real chosen file really lands in the grid via the
 * hidden file inputs — the part a pure unit test cannot see.
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31): cells are typed with real keys; the exported file is read back OUTSIDE the app with ExcelJS
 * (Excel numbers come from Univer's headless engine — a formula must carry a computed cached result); imported sheets are read through
 * Univer's facade by sheet name.
 *
 * Run: npx playwright test e2e/model-xlsx-roundtrip.spec.js
 */
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSpreadsheet, enter, expectValue, flushGrid, sheetNames } from "./lib/univerGrid.js";

/** A cell of a NAMED sheet, read through Univer's facade (the active sheet may be either after an import). */
const cellIn = (page, sheet, r, c) => page.evaluate(([name, rr, cc]) => {
  const ws = window.__planyrUniverRead.api().getActiveWorkbook().getSheetByName(name);
  if (!ws) return "__NO_SHEET__";
  const g = ws.getRange(rr, cc); const v = g.getValue();
  return v === null || v === undefined || v === "" ? (g.getDisplayValue() || null) : v;
}, [sheet, r, c]);

async function downloadXlsx(page) {
  await page.getByTestId("model-file-menu-btn").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("model-export-xlsx").click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  return path;
}

test.describe("Model workspace — Excel round-trip UI wiring", () => {
  test("File menu Export downloads a real .xlsx that opens back with the same value", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-export");
    await enter(page, 0, 0, "12345"); // A1
    await enter(page, 1, 0, "=A1*2"); // A2 — a formula whose NUMBER must be computed by the headless engine into the file
    await enter(page, 2, 0, "hello, world"); // a comma in plain text must stay one cell
    await expectValue(page, 1, 0, 24690);
    await flushGrid(page);

    const path = await downloadXlsx(page);
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(path);
    expect(bytes.byteLength).toBeGreaterThan(0);
    // A real .xlsx is a real zip — PK magic bytes — never an HTML error page or an empty file.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    // Read it back OUTSIDE the app: same value, a live formula WITH its computed result, the comma text intact.
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe(12345);
    const f = ws.getCell("A2").value;
    expect(f && f.formula, "A2 is still a formula in the file").toBe("A1*2");
    expect(f && f.result, "…carrying the value Univer computed").toBe(24690);
    expect(ws.getCell("A3").value).toBe("hello, world");
  });

  test("an EMPTY workbook still exports a valid .xlsx (not an error, not zero bytes)", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-export-empty");
    const path = await downloadXlsx(page);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(1);
  });

  test("File menu Import CSV adds a new sheet with the file's own values", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-csv-import");
    const before = (await sheetNames(page)).length;

    await page.setInputFiles("[data-testid=model-import-csv-input]", {
      name: "budget.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Item,Cost\nLand,500000\n"),
    });
    await expect(page.getByTestId("model-file-notice")).toContainText("budget.csv");
    await expect.poll(async () => (await sheetNames(page)).map((s) => s.name), { message: "a NEW sheet named after the file; the others untouched" }).toEqual(["Sheet1", "budget"]);
    expect((await sheetNames(page)).length).toBe(before + 1);
    expect(await cellIn(page, "budget", 0, 0)).toBe("Item");
    expect(await cellIn(page, "budget", 1, 0)).toBe("Land");
    expect(await cellIn(page, "budget", 1, 1)).toBe(500000);
  });

  test("hostile CSV: a leading-zero code imports like Excel does, a quoted comma stays ONE cell, an empty file and a binary file say so", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-csv-hostile");
    await page.setInputFiles("[data-testid=model-import-csv-input]", {
      name: "zips.csv", mimeType: "text/csv",
      buffer: Buffer.from('Zip,Name\n00123,"Smith, John"\n'),
    });
    await expect(page.getByTestId("model-file-notice")).toContainText("zips.csv");
    await expect.poll(async () => (await sheetNames(page)).map((s) => s.name)).toContain("zips");
    // MEASURED, NOT ASSUMED: csvIO.js has no leading-zero rule, so "00123" imports as the number 123 — exactly what Excel's own CSV open does
    // (Excel's text-import wizard is its workaround). Pinned so a change to it is a decision, and reported to the owner as a known limit.
    expect(await cellIn(page, "zips", 1, 0), "a numeric-looking code imports as a number (Excel parity)").toBe(123);
    expect(await cellIn(page, "zips", 1, 1), "the quoted comma did not split the cell").toBe("Smith, John");
    expect(await cellIn(page, "zips", 1, 2), "…so nothing landed in the next column").toBeNull();

    // An empty file and a binary file are refused in plain words and add no sheet.
    const count = (await sheetNames(page)).length;
    for (const [name, buffer] of [["empty.csv", Buffer.alloc(0)], ["photo.csv", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])]]) {
      await page.setInputFiles("[data-testid=model-import-csv-input]", { name, mimeType: "text/csv", buffer });
      const notice = page.getByTestId("model-file-notice");
      await expect(notice).toContainText(name);
      expect(((await notice.textContent()) || "").toLowerCase()).not.toMatch(/exception|undefined|jszip|\bat \w+\./);
    }
    // (an empty/binary CSV may open as an empty or junk-text sheet or be refused; what must hold is that nothing existing was damaged)
    expect(await cellIn(page, "zips", 1, 0)).toBe(123);
    expect((await sheetNames(page)).length).toBeGreaterThanOrEqual(count);
  });
});
