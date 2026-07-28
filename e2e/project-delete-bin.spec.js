/* Project delete → Recently deleted (NEW-1) — the logged-out half of "I swear I delete sites and
 * they don't actually delete."
 *
 * The root cause is cross-CLIENT (a second signed-in browser's pullCloud → mergePulledSites read
 * "the cloud is missing this row" as "a push that didn't land" and heal-the-split re-pushed the
 * deleted project back, GUTTED by the site_elements cascade). That half needs two signed-in
 * clients, so it lives in test/siteSoftDelete.test.js (a two-cache harness that proves its teeth
 * by re-running with the guard disabled) plus a V### live click-through.
 *
 * What THIS spec locks is the client-side half the sandbox can drive logged out:
 *   • the delete confirm tells the honest new story (recoverable, not "can't be undone");
 *   • the delete actually removes the project — and STAYS removed across a reload, i.e. the new
 *     durable-tombstone gate in saveSite didn't break, or over-block, the ordinary delete path;
 *   • a sibling project is untouched;
 *   • the Recently deleted bin does NOT render logged out (there is no cloud row to bin).
 */
import { test, expect } from "@playwright/test";

const SEED = {
  bin1: { id: "bin1", groupId: "bin-g1", site: "ZZ BIN ONE", name: "Plan 1", status: "active", lat: 29.78, lng: -95.8, els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 200, h: 100 }] },
  bin2: { id: "bin2", groupId: "bin-g2", site: "ZZ BIN TWO", name: "Plan 1", status: "active", lat: 29.79, lng: -95.81, els: [] },
};

const storedIds = (page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")));

async function seed(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => {
    const now = Date.now();
    const withTs = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, updatedAt: now }]));
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(withTs));
  }, SEED);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /select a project/i })).toBeVisible({ timeout: 20_000 });
}

// The per-row kebab only mounts on the hovered ("active") row, and its testid is keyed by the
// project = site GROUP id, not the plan id.
async function openManageMenu(page, name, groupId) {
  await page.getByRole("button", { name: /select a project/i }).click();
  await page.getByRole("button", { name }).first().hover();
  await page.getByTestId(`project-kebab-${groupId}`).click();
}

test.describe("deleting a project (logged out)", () => {
  // Two full app boots per test (seed, then a post-delete reload) — the sandbox blocks the map/GIS
  // hosts, so each boot spends its time waiting those out. Well past the 30s default.
  test.setTimeout(120_000);

  test("the confirm promises a restore, the delete sticks across a reload, and siblings survive", async ({ page }) => {
    await seed(page);
    await openManageMenu(page, "ZZ BIN ONE", "bin-g1");
    await page.getByTestId("project-delete").click();

    // The delete is recoverable now, so the confirm must say so rather than the old
    // "This can't be undone." (which would be a false statement about what happens next).
    const menu = page.getByTestId("project-manage-menu");
    await expect(menu).toContainText(/recently deleted/i);
    await expect(menu).toContainText(/restore/i);
    await expect(menu).not.toContainText(/can.t be undone/i);

    await page.getByTestId("project-delete-confirm").click();
    await expect.poll(() => storedIds(page)).toEqual(["bin2"]);

    // …and it stays gone. A reload clears the per-tab resurrection set, so this is exactly the
    // path the new durable-tombstone gate has to keep correct without over-blocking.
    await page.keyboard.press("Escape"); // close the dropdown so nothing holds the page on unload
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /select a project/i })).toBeVisible({ timeout: 20_000 });
    expect(await storedIds(page)).toEqual(["bin2"]);
  });

  test("the Recently deleted bin is absent logged out — there is no cloud row to bin", async ({ page }) => {
    await seed(page);
    await page.getByRole("button", { name: /select a project/i }).click();
    await expect(page.getByTestId("project-bin-toggle")).toHaveCount(0);
  });
});
