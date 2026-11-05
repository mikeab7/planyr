/* Critical interaction lane (B1857905, reliability programme R2).
 *
 * A SMALL, curated, DETERMINISTIC subset of the broader e2e suite (e2e/, playwright.config.js),
 * wired into the required `build` check so a real interaction regression can no longer merge
 * silently — the gap the reliability brief's R2 stage exists to close. Deliberately narrow:
 * `.github/ci-gates.yml`'s own note on the sibling Signature-budget gate already states the
 * house rule this respects — "the full Playwright e2e suite... e2e.yml keeps that OUT of the
 * required build check on purpose... a gate people route around is worse than one that runs
 * nightly." This lane is not that suite; it is a handful of already-proven-reliable specs.
 *
 * Reads the contract list from e2e/critical-contracts.json (the single source of truth — see
 * that file's own header) rather than hardcoding a file list here, so there is one place to add
 * or remove a required contract, not two that can drift.
 *
 * ⛔ R3 (B1857905) — THE TWO STALE EXCLUSIONS R2 LEFT HERE ARE GONE. Both were repaired (see
 * e2e/ctrlz-undo.spec.js and e2e/inspector-key-scope.spec.js's own R3 comments for the current
 * product contract each now targets) and mutation-proven red-on-regression / green-on-correct
 * before being let back into this required lane — see the manifest's own header for the account.
 *
 * ⛔ DELIBERATELY NO "setup" PROJECT / SIGNED-IN DEPENDENCY (per the brief's own R2 instruction:
 * "Isolate the critical project from the global signed-in setup dependency when it is
 * intentionally local-only. A missing account must not prevent useful local interaction
 * protection."). Both contracts run fully logged out against a seeded-blank local site; neither
 * needs E2E_EMAIL/E2E_PASSWORD. A future auth-gated contract gets its own project with its own
 * dependency — never bolted onto this one.
 *
 * Zero retries (brief: "Begin critical suite acceptance with zero retries... a flaky retry-pass
 * is not proof of stable behavior"). checkRequiredContracts() in scripts/lib/e2eDrift.mjs also
 * treats a "flaky" status as non-green defensively, but this config's own retries:0 means a
 * genuinely flaky case shows as a hard failure here, not a flaky pass — the stronger of the two
 * signals, kept both because the JSON-report status is what the gate actually reads.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, "e2e", "critical-contracts.json"), "utf8"));
// Manifest files are repo-relative ("e2e/…"); testDir below is "./e2e", so testMatch wants the
// bare filename only.
const CRITICAL_FILES = manifest.contracts.map((c) => c.file.replace(/^e2e\//, ""));

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: CRITICAL_FILES,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || "critical-results.json" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--no-sandbox", "--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) },
      },
    },
  ],
  // CI reuses the preview server the build gate already brought up (BASE_URL set); local runs
  // without BASE_URL build+serve themselves, same pattern as playwright.config.js.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run preview -- --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
