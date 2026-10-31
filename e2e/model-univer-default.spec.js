/* The Univer grid is THE grid for every account (NEW-1, 2026-10-31 — cutover steps 8–9a; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * What this proves, signed OUT (a visitor who is by definition not the owner — the signed-in non-admin test account and the owner
 * hatch from both sides are in ui-audit/verify-univer-live.mjs, which needs the real is_admin() RPC):
 *   1. the Spreadsheet tab shows the Univer canvas with NO switch anywhere ("Try the new grid" / "Use the regular grid" do not exist
 *      for this person) and none of the old grid's DOM;
 *   2. a device that carried the OLD switch ("on" or "off") lands on Univer too, and the retired key is removed;
 *   3. a stored regular-grid flag never reaches a visitor who is not a confirmed admin;
 *   4. an edit made in it is saved and survives a reload (the same ONE persistence path the old grid used);
 *   5. File ▾ still exports (the menu is the same menu, minus the owner-only row).
 *
 * Run: npx playwright test e2e/model-univer-default.spec.js */
import { test, expect } from "@playwright/test";
import { armUniverE2E, seedProject, waitForGrid, enter, expectValue, flushGrid, CANVAS } from "./lib/univerGrid.js";

const LEGACY_KEY = "planyr:model:univerGrid";
const REGULAR_KEY = "planyr:model:regularGrid";

async function open(page, id, init) {
  await armUniverE2E(page);
  await seedProject(page, id);
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.goto(`/#/project/${id}/spreadsheet`);
  await waitForGrid(page);
}

test.describe("Spreadsheet — the Univer grid is the default for everyone", () => {
  test("a visitor gets the Univer canvas, no grid switch anywhere, and none of the old grid's DOM", async ({ page }) => {
    await open(page, "ug-default-1");
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId("model-sheet"), "the old grid must not be in the page").toHaveCount(0);
    await page.getByTestId("model-file-menu-btn").click();
    await expect(page.getByTestId("model-export-xlsx")).toBeVisible();   // the File menu is there …
    await expect(page.getByTestId("model-univer-switch"), "… without the owner-only grid row").toHaveCount(0);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/Try the new grid|Use the regular grid|Use the new grid/);
  });

  for (const legacy of ["1", "0"]) {
    test(`a device that had the OLD switch set to "${legacy}" lands on Univer, and the retired key is dropped`, async ({ page }) => {
      await open(page, `ug-legacy-${legacy}`, { fn: ([k, v]) => { if (!sessionStorage.getItem("ug-seeded")) { sessionStorage.setItem("ug-seeded", "1"); localStorage.setItem(k, v); } }, arg: [LEGACY_KEY, legacy] });
      await expect(page.locator(CANVAS)).toBeVisible();
      await expect(page.getByTestId("model-sheet")).toHaveCount(0);
      await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), LEGACY_KEY), { message: "the retired key is removed" }).toBeNull();
    });
  }

  test("a stored 'use the regular grid' flag never reaches a visitor who is not a confirmed admin", async ({ page }) => {
    await open(page, "ug-regular-flag", { fn: ([k]) => localStorage.setItem(k, "1"), arg: [REGULAR_KEY] });
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId("model-sheet")).toHaveCount(0);
  });

  test("an edit is saved and survives a reload", async ({ page }) => {
    await open(page, "ug-persist");
    await enter(page, 0, 0, "500");
    await enter(page, 1, 0, "=A1*2");
    await expectValue(page, 1, 0, 1000);
    await flushGrid(page);
    await page.reload();
    await waitForGrid(page);
    await expectValue(page, 0, 0, 500, "A1 after reload");
    await expectValue(page, 1, 0, 1000, "=A1*2 after reload");
  });

  test("File ▾ → Download as Excel produces a real .xlsx from the Univer grid", async ({ page }) => {
    await open(page, "ug-export");
    await enter(page, 0, 0, "42");
    await flushGrid(page);
    await page.getByTestId("model-file-menu-btn").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("model-export-xlsx").click()]);
    expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
    const { createReadStream } = await import("node:fs");
    const path = await dl.path();
    const head = await new Promise((res) => { const chunks = []; createReadStream(path, { start: 0, end: 3 }).on("data", (d) => chunks.push(d)).on("end", () => res(Buffer.concat(chunks))); });
    expect(head.toString("latin1").startsWith("PK"), "an .xlsx is a zip").toBe(true);
  });
});
