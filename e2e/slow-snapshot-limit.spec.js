/* NEW-4 (2026-10-22, dispatcher: "Couldn't record, try again in a moment" on "Something was slow just now").
 * Opening the ? panel arms a manual capture (B1231280) and the recorder allowed 6 manual captures per PAGE LOAD, so after six
 * openings the row answered "try again in a moment" — a recovery that never came without a reload. The budget now refills on a
 * rolling window and a refusal says what it is. Red on ff7be38 (the 7th press shows the misleading copy; the window override is
 * ignored so it never recovers). The window is shortened with the recorder's own install override so the test is not 10 minutes long. */
import { test, expect } from "@playwright/test";

const rowText = (page) => page.locator('[data-testid="report-slow"]');
async function openClose(page) {
  await page.locator('[data-testid="help-report-fab"]').click();
  await expect(page.locator("[data-menu-layer]")).toBeVisible();
}
async function closeMenu(page) { await page.keyboard.press("Escape"); await expect(page.locator("[data-menu-layer]")).toHaveCount(0); await page.waitForTimeout(350); }  // past the old 200 ms post-close reset, so main fails for the budget, not for a double-press race

test.describe("Something was slow — snapshot limit", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__PLANYR_PERFREC = { budgetWindowMs: 6000 }; });
    await page.goto("/?planyrDiag=1#/site");
    await page.waitForFunction(() => !!window.pfRec, null, { timeout: 30000 });
  });

  test("the 7th press says it is a limit that ends, not 'try again in a moment'", async ({ page }) => {
    for (let i = 0; i < 6; i++) { await openClose(page); await closeMenu(page); }
    await openClose(page);                                  // the 7th open: the recorder refuses
    const row = rowText(page);
    await expect(row).toBeEnabled();
    await row.click();
    await expect(row).not.toHaveText(/^Something was slow just now$/);   // the press answered
    const text = (await row.innerText()).trim();
    expect(text, `row text was: ${text}`).not.toMatch(/try again in a moment/i);
    expect(text).toMatch(/limit/i);
    await expect(row).toHaveAttribute("data-slow-note", "limit");
    expect(text).toMatch(/\bmin\b/i);                        // says when it frees
  });

  test("the budget refills — after the window the same press records again, with no reload", async ({ page }) => {
    for (let i = 0; i < 6; i++) { await openClose(page); await closeMenu(page); }
    await page.waitForTimeout(6500);                         // the (shortened) rolling window passes
    await openClose(page);                                   // arms a capture again
    const row = rowText(page);
    await row.click();
    // recorded ("Recording…" → "Recorded …"), not refused — a refusal reads "Couldn't record…" / "Snapshot limit reached…"
    await expect(row).toContainText(/Record(ing|ed)/);
  });
});
