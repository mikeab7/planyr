/* Auth setup (B278 speed-up) — signs in ONCE and saves the session, so the auth-gated
 * specs reuse it instead of re-doing a full interactive sign-in per test. Before this, every
 * signed-in test re-authenticated against the live site (~16 sign-ins, serial → ~30 min);
 * with a shared storageState the suite signs in once and each test just reloads an already-
 * authenticated page (~minutes).
 *
 * Runs as its own Playwright project that the main project depends on. When the seeded account
 * (B280) isn't configured, it skips cleanly and the dependent auth specs skip too. */
import { test as setup } from "@playwright/test";
import { signIn, hasAccount, STORAGE_STATE } from "./helpers.js";

setup("authenticate once", async ({ page }) => {
  setup.skip(!hasAccount, "set E2E_EMAIL / E2E_PASSWORD (B280 seeded account) to run");
  await page.goto("/");
  await signIn(page);
  // Persist cookies + localStorage (the Supabase session lives in localStorage) so every
  // dependent test starts already signed in.
  await page.context().storageState({ path: STORAGE_STATE });
});
