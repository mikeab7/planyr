/* B2429233 — a schedule delete verifies its own result. Drives the REAL Scheduler shell + the REAL
 * embedded schedule app (signed out, so its own seed list and no cloud). One arm lets the delete
 * through (the list drops the row, no notice); the other drops the `planar:nav-delete` message on
 * the way to the iframe, so the schedule genuinely stays — the shell must SAY so, not close the
 * confirm and go quiet. The embedded app's own last-schedule delete is covered by
 * test/scheduleDeleteLast.test.js and the signed-in live pass recorded on the item. */
import { test, expect } from "@playwright/test";

const GID = "g-zzdelverify";
const seed = (page) => page.addInitScript(([gid]) => {
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({
    p1: { id: "p1", groupId: gid, site: "ZZ-DELETE-VERIFY", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
  }));
}, [GID]);

async function openListAndConfirmDelete(page, label, { swallowDelete = false } = {}) {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-testid="schedule-owner-row"]:visible', { hasText: label });
  await expect(row).toBeVisible({ timeout: 30_000 });
  if (swallowDelete) {
    // The confirm stays real; the delete message to the embedded app is swallowed (the shell posts
    // through the iframe's own window, so the stub goes on that window), so the schedule stays.
    await page.evaluate(() => {
      const w = document.querySelector("iframe").contentWindow;
      const orig = w.postMessage.bind(w);
      w.postMessage = (m, ...rest) => { if (m && m.type === "planar:nav-delete") return; return orig(m, ...rest); };
    });
  }
  await row.locator('[data-testid="schedule-owner-kebab"]').click();
  await page.locator('[data-testid="schedule-owner-delete"]:visible').click();
  await page.locator('[data-testid="schedule-owner-delete-confirm"]:visible').click();
  return row;
}

test("a delete the embedded app never carries out is NOT silent — a notice names the schedule", async ({ page }) => {
  const row = await openListAndConfirmDelete(page, "Bee Sand Development", { swallowDelete: true });
  const notice = page.locator('[data-testid="schedule-delete-failed"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText("“Bee Sand Development” could not be deleted");
  await expect(row).toBeVisible();   // and it really is still listed
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});

test("a delete the embedded app carries out removes the row and shows no notice", async ({ page }) => {
  const row = await openListAndConfirmDelete(page, "Bee Sand Development");
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(8000);   // past the verification window
  await expect(page.locator('[data-testid="schedule-delete-failed"]')).toHaveCount(0);
});

test("deleting every schedule one by one — the LAST one included — really deletes it (B2429233 red on main)", async ({ page }) => {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });
  const rows = page.locator('[data-testid="schedule-owner-row"]:visible');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);
  for (let left = total; left > 0; left--) {
    await expect(rows).toHaveCount(left, { timeout: 10_000 });
    await rows.first().locator('[data-testid="schedule-owner-kebab"]').click();
    await page.locator('[data-testid="schedule-owner-delete"]:visible').click();
    await page.locator('[data-testid="schedule-owner-delete-confirm"]:visible').click();
    // the row must actually go — on main the final delete left it listed with no message
    await expect(rows).toHaveCount(left - 1, { timeout: 10_000 });
  }
  // the embedded app is left on its own "No schedules yet" state, never a crash
  await expect(page.frameLocator("iframe").locator("[data-schedule-empty]")).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(7000);
  await expect(page.locator('[data-testid="schedule-delete-failed"]')).toHaveCount(0);
});
