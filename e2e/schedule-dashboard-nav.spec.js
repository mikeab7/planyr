/* B1128272 — owner report: "when I'm on schedule and click dashboard, it often takes me
 * back to the map." Root cause read from source: pressing the Schedule module's Dashboard
 * breadcrumb fired TWO navigations at once — the in-module reports-view switch AND the
 * shell's "leave this workspace, go to the Site Planner map" action — and the second
 * usually won the race. The fix splits the wordmark's action from the crumb's (see
 * src/shared/ui/dashboardNav.js) so pressing the crumb can never leave the module.
 *
 * This drives the REAL Scheduler → AppHeader → ProjectBreadcrumb chain (the actual built
 * app), logged out, the same way e2e/scheduler-duplicate-menu.spec.js does — seeding the
 * legacy `planarfit:sites:v1` local site store and routing straight to
 * `#/project/<gid>/schedule`, deliberately not waiting on the embedded scheduler iframe to
 * boot (its own React tree loads React/Babel from a CDN this sandbox's browser can't
 * reach). That's fine here: which handler the crumb/wordmark buttons call is decided
 * entirely by Scheduler.jsx's own props to AppHeader, and the observable effect — which
 * URL hash the click lands on — is shell-level state, independent of anything the iframe
 * itself ever renders. (ATTEMPT-BEFORE-YOU-PARK: Claude-doable in the sandbox.)
 *
 * The distinct tooltip text this same fix introduces doubles as a precise, unambiguous
 * selector for each control.
 *
 * RED-PROOF (performed by hand while fixing this item, not re-run here): restoring
 * `const goDashboard = () => { goDashboardWithinModule(); onGoDashboard?.(); };` makes the
 * crumb click below land on "#/" instead of "#/schedule" — see test/scheduleDashboardNav.js
 * for the source-level guard against exactly that regression.
 */
import { test, expect } from "@playwright/test";

const GID = "g-dashnavtest";

function seed(page) {
  return page.addInitScript(([gid]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: "ZZ Dashboard Nav Test", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
  }, [GID]);
}

test.describe("B1128272 — Schedule's Dashboard crumb stays in Schedule; the wordmark still leaves it", () => {
  test("pressing the crumb clears the routed project but keeps the Schedule module — never the map", async ({ page }) => {
    await seed(page);

    // Workspaces stay mounted-but-hidden (keep-alive), so scope every selector to the
    // currently VISIBLE header, never a bare selector that could match a hidden workspace's
    // own copy of AppHeader.
    for (let i = 0; i < 5; i++) {
      // Fresh navigation each pass — the reported symptom is "often," so one pass alone
      // proves nothing about a race; this exercises the click from a clean routed state
      // five times running.
      await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });

      const crumb = page.locator('button[title="Schedule dashboard — reports for every project"]:visible');
      await expect(crumb).toBeVisible({ timeout: 15_000 });
      await crumb.click();

      await expect.poll(() => page.evaluate(() => window.location.hash), {
        message: `pass ${i + 1}/5: pressing the Dashboard crumb must clear the project but stay on Schedule ("#/schedule"), never jump to the Site Planner map ("#/")`,
        timeout: 5_000,
      }).toBe("#/schedule");
    }
  });

  test("pressing the wordmark still leaves the Schedule workspace for the Site Planner map", async ({ page }) => {
    await seed(page);
    await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });

    const wordmark = page.locator('button[title="Leave Schedule — go to the Site Planner map"]:visible');
    await expect(wordmark).toBeVisible({ timeout: 15_000 });
    await wordmark.click();

    await expect.poll(() => page.evaluate(() => window.location.hash), {
      message: "the wordmark must still leave the workspace and land on the Site Planner map home",
      timeout: 5_000,
    }).toBe("#/");
  });
});
