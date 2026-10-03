/* NEW-1 — opening the Account modal on a touch device must never raise the keyboard.
 *
 * Signed-out here, so this drives the sign-in modal, which shares `Wrap` (the focus-in / trap)
 * with the signed-in Settings panel; the Settings sections themselves need a signed-in session
 * (logged as a V### in VERIFICATION.md) and are guarded at source by test/accountNoAutofocus.test.js.
 * KNOWN-GOOD ARM: the same modal at a fine pointer DOES focus the email field (typing is the
 * only purpose of a sign-in form) — if that arm stops reporting it, the touch arm proves nothing. */
import { test, expect } from "@playwright/test";

const isTextEntry = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
};
async function openSignIn(page) {
  await page.goto("/?app&auth=signin"); // Shell's landing deep link opens the auth panel on that tab
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
}

test.describe("touch / coarse pointer", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("opening the account modal leaves nothing focused", async ({ page }) => {
    await openSignIn(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await page.waitForTimeout(400);
    expect(await page.evaluate(isTextEntry)).toBe(false);
    for (const tab of ["Create account", "Sign in"]) {
      const b = page.getByRole("dialog").getByRole("button", { name: tab }).first();
      if (await b.count()) { await b.click(); expect(await page.evaluate(isTextEntry)).toBe(false); }
    }
  });
});

test.describe("fine pointer (known-good arm)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("sign-in still focuses the email field", async ({ page }) => {
    await openSignIn(page);
    await expect(page.locator('input[type="email"]').first()).toBeFocused();
  });
});
