/* ⛔ A PRESS INSIDE A MENU STACKED ABOVE A DROPDOWN MUST NOT CLOSE THAT DROPDOWN (B1358128).
 *
 * This is the WIRING half of menuLayers.js (the verdict itself is pinned in test/menuLayers.test.js).
 * It is a browser spec because the property is a collaboration between three things that no unit
 * test can put in one room: AnchoredMenu's document-level capture `mousedown` dismissal, a SECOND
 * React portal mounted at `document.body`, and the switcher's own `[open]` effect, which clears the
 * row menu's target and the inline rename editor whenever the dropdown closes.
 *
 * WHY IT IS WORTH A SPEC. When the dropdown closed underneath its own row menu, the Delete row's
 * `setMenuFor((m) => ({ ...m, confirm: true }))` spread a just-nulled target into a NEW object —
 * truthy — so the confirmation stayed on screen with its project ERASED, asked "Delete this
 * project?", and deleted `undefined`: no network call, no error, and every surrounding step
 * behaving as though it had worked. Rename lost its editor in the same batch and opened nothing at
 * all. Two owner-reported bugs, one cause, and NOTHING in the repo could see either: the existing
 * project-manage harness drives the app LOGGED OUT and asserts localStorage, which is exactly the
 * half that still "worked".
 *
 * Runs LOGGED OUT against a seeded site store, so it is Claude-verifiable here (ATTEMPT-BEFORE-
 * YOU-PARK). The signed-in half — that the delete reaches `sites.deleted_at` — is
 * ui-audit/verify-signed-in-project-delete.mjs.
 */
import { test, expect } from "@playwright/test";

const now = Date.now();
const plan = (id, groupId, site, name, ts) => ({
  id, groupId, site, name, origin: null, county: null, parcels: [], els: [], measures: [],
  callouts: [], markups: [], settings: {}, underlay: null, updatedAt: ts,
});
const SITES = {
  "zzmenu-a": plan("zzmenu-a", "zzmenu-a", "ZZ Menu Alpha", "Plan 1", now),
  "zzmenu-b": plan("zzmenu-b", "zzmenu-b", "ZZ Menu Beta", "Plan 1", now - 1000),
};

async function boot(page) {
  await page.addInitScript((sites) => {
    try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(sites)); } catch (e) {}
  }, SITES);
  await page.goto("/#/site");
  await expect(page.getByTestId("project-crumb")).toBeVisible({ timeout: 30_000 });
}
const search = (page) => page.locator('input[placeholder="Search projects"]');

async function openPicker(page) {
  await page.getByTestId("project-crumb").click();
  await expect(search(page)).toBeVisible();
}

test("pressing a row's kebab menu leaves the project dropdown open", async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.getByTestId("project-row-zzmenu-b").click({ button: "right" });
  await expect(page.getByTestId("project-manage-menu")).toBeVisible();
  await page.getByTestId("project-delete").click();
  // THE assertion: the dropdown underneath is still open. Before the fix it was gone.
  await expect(search(page)).toBeVisible();
});

test("the delete confirmation still knows WHICH project it is for", async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.getByTestId("project-row-zzmenu-b").click({ button: "right" });
  await page.getByTestId("project-delete").click();
  const menu = page.getByTestId("project-manage-menu");
  await expect(menu).toContainText("ZZ Menu Beta");
  await expect(menu).not.toContainText("Delete this project?");
});

test("Rename opens its inline editor instead of nothing at all", async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.getByTestId("project-row-zzmenu-b").click({ button: "right" });
  await page.getByTestId("project-rename").click();
  await expect(page.locator('[data-testid="project-row-zzmenu-b"] input')).toBeVisible();
});

test("the delete really removes the project it named, and only that one", async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.getByTestId("project-row-zzmenu-b").click({ button: "right" });
  await page.getByTestId("project-delete").click();
  await page.getByTestId("project-delete-confirm").click();
  await expect.poll(async () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")))).toEqual(["zzmenu-a"]);
});

test("clicking OUTSIDE every menu still dismisses the dropdown (the fix does not wedge it open)", async ({ page }) => {
  await boot(page);
  await openPicker(page);
  await page.mouse.click(700, 600);
  await expect(search(page)).toHaveCount(0);
});
