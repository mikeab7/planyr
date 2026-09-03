/* B1112448/NEW-1 — "Duplicate" never rendered in the Schedule module's project switcher because
 * AppHeader.jsx destructured only onRenameProject/onDeleteProject and forwarded only those two
 * into <ProjectBreadcrumb>, so ProjectBreadcrumb's own `canDuplicate = !!onDuplicateProject` was
 * always false no matter what Scheduler.jsx passed in. The prior guard for this
 * (test/schedulerNavState.test.js) was a source regex against Scheduler.jsx ALONE — it could not
 * see AppHeader.jsx in between, so it stayed green the entire time the feature was 100% dead.
 *
 * This mounts the REAL Scheduler → AppHeader → ProjectBreadcrumb chain (the actual built app, not
 * a fabricated harness) and clicks through it exactly like the owner does: open the switcher,
 * open a row's kebab menu, and read the rendered "Duplicate" row. Runs fully LOGGED OUT, seeding
 * the legacy `planarfit:sites:v1` local site store the same way e2e/schedule-link-panel.spec.js
 * already does — deliberately NOT waiting on the embedded scheduler iframe to boot (its own React
 * tree loads React/Babel from a CDN this sandbox's browser can't reach), since `canManage` and the
 * kebab's Rename/Duplicate/Delete rows are driven purely by the props Scheduler.jsx hands AppHeader
 * (always wired, whether or not the iframe has reported in yet) — exactly the layer this bug lived
 * in. (ATTEMPT-BEFORE-YOU-PARK: this is Claude-doable in the sandbox, so it is not filed as
 * `Verify: live`.)
 *
 * RED-PROOF: reverting AppHeader.jsx's onDuplicateProject destructure/forward (the exact bug this
 * item found) makes the assertion below fail — the row is simply absent from the DOM, matching the
 * owner's live measurement (`[data-testid="project-duplicate"]` absent, menu items read only
 * ["Rename","Delete"]).
 */
import { test, expect } from "@playwright/test";

const GID = "g-duptest";

function seed(page) {
  return page.addInitScript(([gid]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: "ZZ Duplicate Test", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
  }, [GID]);
}

test.describe("NEW-1/B1112448 — Duplicate is reachable from the Schedule module's switcher", () => {
  test("the switcher kebab menu renders Duplicate between Rename and Delete", async ({ page }) => {
    await seed(page);
    await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });

    // Workspaces stay mounted-but-hidden (keep-alive), so more than one AppHeader/ProjectBreadcrumb
    // can exist in the DOM at once — scope every selector to the currently VISIBLE one, never a
    // bare testid that could resolve to a different, hidden workspace's copy.
    const crumb = page.locator('[data-testid="project-crumb"]:visible');
    await expect(crumb).toBeVisible({ timeout: 15_000 });
    await crumb.click();

    const row = page.locator(`[data-testid="project-row-${GID}"]:visible`);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Open that row's kebab (Rename/Duplicate/Delete manage menu).
    const kebab = row.locator(`[data-testid="project-kebab-${GID}"]`);
    await expect(kebab).toBeVisible();
    await kebab.click();

    const menu = page.locator('[data-testid="project-manage-menu"]:visible');
    await expect(menu).toBeVisible();
    const items = menu.locator('[role="menuitem"]');
    await expect(items).toHaveCount(3, { timeout: 5000 });

    // Exact shape of the owner's live measurement, corrected: Rename, Duplicate, Delete — in
    // that order — not the pre-fix ["Rename","Delete"].
    await expect(menu.locator('[data-testid="project-rename"]')).toBeVisible();
    const duplicateRow = menu.locator('[data-testid="project-duplicate"]');
    await expect(duplicateRow).toBeVisible();
    await expect(duplicateRow).toHaveText(/Duplicate/);
    await expect(menu.locator('[data-testid="project-delete"]')).toBeVisible();

    const texts = await items.allTextContents();
    expect(texts.findIndex((t) => /Rename/.test(t))).toBeLessThan(texts.findIndex((t) => /Duplicate/.test(t)));
    expect(texts.findIndex((t) => /Duplicate/.test(t))).toBeLessThan(texts.findIndex((t) => /Delete/.test(t)));

    // Clicking it closes the manage menu — the click handler runs (setMenuFor(null) then
    // onDuplicateProject(id)), proving the row is not just painted but actually wired.
    await duplicateRow.click();
    await expect(menu).toBeHidden();
  });
});
