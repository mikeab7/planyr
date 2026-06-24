/* Playwright e2e config (B278).
 *
 * The automated verifier for the shared-markup refinement loop (B421/NEW-9): it drives the
 * REAL app in a browser and asserts each tool arms, draws the right markup, and exposes the
 * right property controls. It is the loop's source of truth that the matrix (tools.matrix.js)
 * is actually implemented, not just specified.
 *
 * Two run modes:
 *   • CI / against a deploy — set BASE_URL to the Cloudflare preview (or production) URL.
 *     The suite hits that origin; no local server is started. This is how B281 runs it.
 *   • Local — leave BASE_URL unset; Playwright builds + serves the app on :4173 itself.
 *
 * Auth-gated specs need the seeded test account (B280): the E2E_EMAIL / E2E_PASSWORD secrets.
 * When they're absent the login helper marks those specs skipped (so a contributor without
 * the secrets still gets the logged-out coverage), never a false failure.
 *
 * Sandbox note: outbound HTTPS is TLS-inspected, so Chromium must be launched with
 * --ignore-certificate-errors + ignoreHTTPSErrors (the same flag every ui-audit harness uses).
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const useLocalServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Sign-in now happens ONCE in the setup project (storageState reuse), so the test phase is
  // safe to parallelize — the per-tool specs only read the seeded account + arm tools client-
  // side (no server writes to race). This is the bulk of the 31 min → ~few min speed-up.
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true, // TLS-inspecting proxy in CI/sandbox (see ui-audit note)
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Signs in once and writes e2e/.auth/user.json; the main project depends on it.
      name: "setup",
      testMatch: /auth\.setup\.js/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--no-sandbox", "--ignore-certificate-errors"] },
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--no-sandbox", "--ignore-certificate-errors"] },
      },
      // setup runs first (one sign-in). A skipped setup (no seeded account) doesn't block this.
      dependencies: ["setup"],
    },
  ],
  // Local-only: build once and serve the static preview. Skipped when BASE_URL targets a deploy.
  webServer: useLocalServer
    ? {
        command: "npm run build && npm run preview -- --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
