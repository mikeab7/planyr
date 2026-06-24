/* Shared e2e helpers (B278). */
import { expect } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_EMAIL || "";
export const E2E_PASSWORD = process.env.E2E_PASSWORD || "";
export const hasAccount = !!(E2E_EMAIL && E2E_PASSWORD);

/* Where auth.setup.js saves the signed-in session for the auth-gated specs to reuse. */
export const STORAGE_STATE = "e2e/.auth/user.json";

/* Sign in with the seeded test account (B280). Opens the account/auth panel, fills the
 * email + password fields (targeted by their stable type + placeholder), submits, and waits
 * for the signed-in chrome. Call `test.skip(!hasAccount, …)` BEFORE this in any spec that
 * needs auth so a contributor without the secrets gets a clean skip, not a failure. */
export async function signIn(page) {
  // Open the auth panel from the header. The signed-out header shows a "Sign in" affordance;
  // clicking any control that reveals the email field is enough — we find it by role/text.
  const emailField = page.locator('input[type="email"]');
  if (!(await emailField.count())) {
    await page.getByRole("button", { name: /sign in|account|log ?in/i }).first().click().catch(() => {});
  }
  await expect(emailField.first()).toBeVisible();
  await emailField.first().fill(E2E_EMAIL);
  await page.locator('input[type="password"]').first().fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // Signed-in: the email field is gone and the app chrome shows the module tabs.
  await expect(page.getByTestId("module-tab-site-planner")).toBeVisible({ timeout: 15_000 });
}

/* Switch to a workspace module by its tab. moduleId is the internal id
 * ("site-planner" | "doc-review" | …) — the user-facing label may differ ("Review"). */
export async function openModule(page, moduleId) {
  await page.getByTestId(`module-tab-${moduleId}`).click();
}
