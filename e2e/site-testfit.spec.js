/* Dense site test-fit render spec (B278/B280/B281 amendment) — the auth-gated, live half of the
 * dense-testfit fixture. Covers the zoom-/data-density rendering LIVE-VERIFY class: the dense
 * industrial test-fit (building + bonded children + truck courts + bump-outs + parking) must draw on
 * the Site Planner SVG canvas without a render crash. Needs the seeded e2e account (B280) with the
 * fixture row (e2e/seed/seed-fixtures.sql, id e2e-fixture-testfit) — without E2E_EMAIL/E2E_PASSWORD the
 * whole describe skips cleanly. The deterministic model half (yield counts + tombstone/merge) is the
 * sandbox vitest test/siteFitFixture.test.js. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { hasAccount, STORAGE_STATE, openModule } from "./helpers.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/sites/dense-testfit.fixture.json", import.meta.url)), "utf8"));

test.describe("dense site test-fit render", () => {
  // Sandbox-safe pre-check on the fixture — always runs, so the spec is never a no-op.
  test("the fixture is a genuinely dense test-fit — pre-check", async () => {
    expect(fixture.site.els.length).toBeGreaterThan(15);
    expect(fixture.site.els.some((e) => e.type === "building" && !e.dogEar)).toBe(true);
    expect(fixture.site.els.some((e) => e.type === "truckCourt")).toBe(true);
    expect(fixture.site.els.some((e) => e.dogEar)).toBe(true);
  });

  test.describe("live canvas (auth-gated)", () => {
    test.skip(!hasAccount, "needs the seeded e2e account (E2E_EMAIL/E2E_PASSWORD) + the e2e-fixture-testfit row");
    test.use({ storageState: hasAccount ? STORAGE_STATE : undefined });

    test("opens the seeded dense test-fit and renders the canvas without a crash", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto("/#/site-planner");
      await openModule(page, "site-planner");
      // Resume into the seeded fixture site; the planner canvas is an inline SVG.
      await page.goto(`/#/site-planner/${fixture.site.id}`);
      await expect(page.locator("svg").first()).toBeVisible({ timeout: 15000 });
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
});
