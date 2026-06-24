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
  // The submit button has a dedicated testid — the form ALSO renders a "Sign in" mode-toggle
  // tab, so targeting by name "/^sign in$/" hit a strict-mode violation (two matches). The
  // testid is unambiguous and mode-independent.
  await page.getByTestId("auth-submit").click();
  // Signed-in: the email field is gone and the app chrome shows the module tabs.
  await expect(page.getByTestId("module-tab-site-planner")).toBeVisible({ timeout: 15_000 });
}

/* Switch to a workspace module by its tab. moduleId is the internal id
 * ("site-planner" | "doc-review" | …) — the user-facing label may differ ("Review").
 *
 * A transient overlay (a post-sign-in "cloud on"/sync toast, or a closing auth-panel backdrop)
 * can briefly sit over the header tabs and intercept the click. Retry the whole click→verify
 * until the tab actually becomes current, rather than failing on the first interception. */
export async function openModule(page, moduleId) {
  const tab = page.getByTestId(`module-tab-${moduleId}`);
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => {
    await tab.click({ timeout: 3_000 });
    await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}
