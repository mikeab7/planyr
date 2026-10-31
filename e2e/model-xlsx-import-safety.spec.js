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
 * PORTED to the Univer grid (NEW-2, 2026-10-31): cells are typed with real keys and read through Univer's facade; sheet tabs come from the
 * facade (the tab strip is Univer's own). The import path itself (File ▾ → hidden file input → ExcelJS in a worker → the grid) is unchanged.
 *
 * Run: npx playwright test e2e/model-xlsx-import-safety.spec.js
 */
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSpreadsheet, enter, expectValue, sheetNames, value, flushGrid } from "./lib/univerGrid.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function buildFixtureXlsx(sheetNames) {
  const wb = new ExcelJS.Workbook();
  for (const name of sheetNames) {
    const ws = wb.addWorksheet(name);
    ws.getCell("A1").value = `hello from ${name}`;
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
const names = async (page) => (await sheetNames(page)).map((s) => s.name);

test.describe("Model workspace — Import Excel safety (NEW-1/NEW-2)", () => {
  test("importing Excel into a workbook that already has content ASKS FIRST, and 'Keep this workbook' leaves it untouched", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-confirm-keep");
    await enter(page, 0, 0, "existing data"); // A1 — the current workbook now has content
    await expectValue(page, 0, 0, "existing data");
    const before = await names(page);

    const buf = await buildFixtureXlsx(["Imported1", "Imported2"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", { name: "two-sheets.xlsx", mimeType: XLSX_MIME, buffer: buf });

    const confirm = page.getByTestId("model-import-replace-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("two-sheets.xlsx");
    // The existing cell is STILL there — nothing was replaced yet.
    expect(await value(page, 0, 0)).toBe("existing data");

    await confirm.getByRole("button", { name: "Keep this workbook" }).click();
    await expect(confirm).toBeHidden();
    // Still untouched after declining.
    await page.waitForTimeout(800);
    expect(await value(page, 0, 0)).toBe("existing data");
    expect(await names(page)).toEqual(before);
    expect(await names(page)).not.toContain("Imported1");
  });

  test("importing Excel into a workbook that already has content, then confirming 'Replace', replaces it", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-confirm-replace");
    await enter(page, 0, 0, "existing data");
    await expectValue(page, 0, 0, "existing data");

    const buf = await buildFixtureXlsx(["Imported1", "Imported2"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", { name: "two-sheets.xlsx", mimeType: XLSX_MIME, buffer: buf });

    const confirm = page.getByTestId("model-import-replace-confirm");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Replace" }).click();
    await expect(confirm).toBeHidden();

    await expect(page.getByTestId("model-file-notice")).toContainText("two-sheets.xlsx");
    await expect.poll(() => names(page), { message: "both imported sheets, and only them" }).toEqual(["Imported1", "Imported2"]);
    await expectValue(page, 0, 0, "hello from Imported1");
    // Persisted through the one save path, not just painted.
    await flushGrid(page);
  });

  test("importing Excel into a brand-new, never-typed-into workbook needs NO confirmation — the trap CLAUDE.md names", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-confirm-empty");

    const buf = await buildFixtureXlsx(["Imported1"]);
    await page.getByTestId("model-file-menu-btn").click();
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", { name: "one-sheet.xlsx", mimeType: XLSX_MIME, buffer: buf });

    // No confirm banner at all — it goes straight through, exactly like before this fix.
    await expect(page.getByTestId("model-import-replace-confirm")).toHaveCount(0);
    await expect(page.getByTestId("model-file-notice")).toContainText("one-sheet.xlsx");
    await expect.poll(() => names(page)).toEqual(["Imported1"]);
    await expectValue(page, 0, 0, "hello from Imported1");
  });

  test("a non-Excel file shows a plain sentence, never JSZip's own developer error", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-bad-file");

    await page.setInputFiles("[data-testid=model-import-xlsx-input]", {
      name: "test_not_really.xlsx",
      mimeType: XLSX_MIME,
      buffer: Buffer.from("this is just a plain text file, not a real xlsx workbook"),
    });

    const notice = page.getByTestId("model-file-notice");
    await expect(notice).toBeVisible();
    const text = (await notice.textContent()) || "";
    expect(text.toLowerCase()).not.toContain("jszip");
    expect(text.toLowerCase()).not.toContain("central directory");
    expect(text.toLowerCase()).not.toMatch(/https?:\/\//);
    expect(text).toContain("test_not_really.xlsx");
    // A refused file changes nothing: the (empty) workbook is still the one sheet it was.
    expect((await names(page)).length).toBe(1);
  });

  test("hostile files: an EMPTY .xlsx is refused in plain words; a CSV renamed .xlsx never replaces anything without the prompt", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-xlsx-hostile");
    await enter(page, 0, 0, "keep me");
    await expectValue(page, 0, 0, "keep me");

    // 1 — zero bytes: a plain refusal that names the file; no prompt, no change.
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", { name: "empty.xlsx", mimeType: XLSX_MIME, buffer: Buffer.alloc(0) });
    const notice = page.getByTestId("model-file-notice");
    await expect(notice).toContainText("empty.xlsx");
    const text = ((await notice.textContent()) || "").toLowerCase();
    expect(text).not.toContain("jszip");
    expect(text).not.toContain("central directory");
    await expect(page.getByTestId("model-import-replace-confirm")).toHaveCount(0);
    expect(await value(page, 0, 0)).toBe("keep me");

    // 2 — comma-separated text wearing an .xlsx name: the reader accepts it as a one-sheet workbook (measured; unchanged by the grid), so what
    // must hold is the SAFETY property — it asks before replacing a workbook with content, and declining changes nothing.
    await page.setInputFiles("[data-testid=model-import-xlsx-input]", { name: "really-a-csv.xlsx", mimeType: XLSX_MIME, buffer: Buffer.from("a,b\n1,2\n") });
    const confirm = page.getByTestId("model-import-replace-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("really-a-csv.xlsx");
    expect(await value(page, 0, 0)).toBe("keep me");
    await confirm.getByRole("button", { name: "Keep this workbook" }).click();
    await page.waitForTimeout(600);
    expect(await value(page, 0, 0)).toBe("keep me");
  });
});
