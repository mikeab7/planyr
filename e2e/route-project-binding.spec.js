/* NEW-5 — THE URL IS AUTHORITATIVE, IN BOTH DIRECTIONS.
 *
 * The owner's two repros, driven for real:
 *   A. open `#/project/<id>/site`, hard reload → expected the same project; actual, on
 *      production, it landed on `#/` (the "Select a project" map). Refreshing lost the
 *      project you were in.
 *   B. change the project id in the hash → expected that project opens; actual, the header
 *      kept rendering the OLD project's name while the hash said the new id, and a SECOND
 *      Layers panel mounted on top of the first (64 checkboxes where there should be 29).
 *
 * Both run LOGGED OUT against two seeded local projects, so they are Claude-verifiable here
 * (ATTEMPT-BEFORE-YOU-PARK) — no account, no cloud, no external GIS.
 *
 * ⛔ The duplicate-panel assertion counts panels by `data-testid="layer-panel"`, NOT by
 * checkbox count. Both workspace modes stay mounted by design (the hidden one keeps its
 * Leaflet map alive), so raw input counting cannot tell a legitimate hidden copy from a
 * leaked second planner — which is exactly why the original report's "64 vs 29" was hard to
 * act on. The invariant that actually matters is: exactly ONE panel is VISIBLE, and exactly
 * one planner surface exists.
 */
import { test, expect } from "@playwright/test";

const mkSite = (id, name, lat, lon) => ({
  schemaVersion: 12, id, groupId: id, site: name, name,
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat, lon }, county: "harris", status: "active",
  parcels: [{ id: `${id}-p1`, points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
});

const ALPHA = "route-alpha", BRAVO = "route-bravo";
const SITES = {
  [ALPHA]: mkSite(ALPHA, "Route Alpha Tract", 29.735, -94.977),   // Baytown-ish
  [BRAVO]: mkSite(BRAVO, "Route Bravo Tract", 39.8683, -104.9209), // Commerce City
};

async function seed(page) {
  // No aerial tiles / no agency GIS in the sandbox — a route test must not depend on either.
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", s);
      localStorage.removeItem("planarfit:currentSite:v1");
    } catch (_) {}
  }, JSON.stringify(SITES));
}

// The visible planner surface's own header text — the name the user actually sees.
const visibleProjectName = (page) => page.locator('[data-mode="plan"][data-mode-active="true"]');

test.describe("NEW-5 — route ↔ project binding", () => {
  test("A: a hard reload on a project deep link stays in that project", async ({ page }) => {
    test.setTimeout(90_000);
    await seed(page);
    await page.goto(`/#/project/${ALPHA}/site`, { waitUntil: "load" });
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await expect(visibleProjectName(page)).toContainText("Route Alpha Tract");

    // THE REPRO: a real reload, not a client-side navigation.
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1200); // let auth/boot settle — this is where the route was lost

    expect(page.url(), "the deep link must survive a reload").toContain(`#/project/${ALPHA}/site`);
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await expect(visibleProjectName(page)).toContainText("Route Alpha Tract");
  });

  test("B: changing the project id in the hash actually switches projects", async ({ page }) => {
    await seed(page);
    await page.goto(`/#/project/${ALPHA}/site`, { waitUntil: "load" });
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await expect(visibleProjectName(page)).toContainText("Route Alpha Tract");

    // THE REPRO: hand-edit the project id in the URL.
    await page.evaluate((id) => { window.location.hash = `#/project/${id}/site`; }, BRAVO);
    await page.waitForTimeout(1500);

    // The header must follow the URL — not keep rendering the old project.
    await expect(visibleProjectName(page)).toContainText("Route Bravo Tract");
    await expect(visibleProjectName(page)).not.toContainText("Route Alpha Tract");
    expect(page.url()).toContain(`#/project/${BRAVO}/site`);
  });

  test("B: switching projects tears the old planner down — never stacks a second one", async ({ page }) => {
    await seed(page);
    await page.goto(`/#/project/${ALPHA}/site`, { waitUntil: "load" });
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });

    // Open the Layers panel so a duplicate would be observable at all.
    await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).first().click();
    await expect(page.getByTestId("layer-panel").filter({ visible: true }).first()).toBeVisible();

    const countVisible = async (sel) => page.locator(sel).filter({ visible: true }).count();
    const before = {
      panels: await countVisible('[data-testid="layer-panel"]'),
      canvases: await countVisible('[data-testid="planner-canvas"]'),
    };
    expect(before.panels, "exactly one Layers panel is visible to begin with").toBe(1);
    expect(before.canvases).toBe(1);

    await page.evaluate((id) => { window.location.hash = `#/project/${id}/site`; }, BRAVO);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("planner-canvas").filter({ visible: true })).toBeVisible({ timeout: 20000 });

    // The invariant: one planner, one visible Layers panel — before AND after the switch.
    expect(await countVisible('[data-testid="planner-canvas"]'), "a second planner must not stack").toBe(1);
    expect(await countVisible('[data-testid="layer-panel"]'), "a second Layers panel must not stack").toBeLessThanOrEqual(1);
    // And no duplicated rows within whatever panel IS showing.
    const visiblePanel = page.getByTestId("layer-panel").filter({ visible: true });
    if (await visiblePanel.count()) {
      const labels = await visiblePanel.first().locator('input[type="checkbox"]').evaluateAll(
        (els) => els.map((el) => (el.closest("label")?.textContent || "").trim()).filter(Boolean));
      const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
      expect(dupes, "no layer row may appear twice").toEqual([]);
    }
  });

  test("navigating to the dashboard still clears the project (the fix must not freeze the URL)", async ({ page }) => {
    // The guard that keeps the fix honest: making the route authoritative must NOT make it
    // un-leavable. A deliberate user navigation to "no project" still writes "#/".
    await seed(page);
    await page.goto(`/#/project/${ALPHA}/site`, { waitUntil: "load" });
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => { window.location.hash = "#/"; });
    await page.waitForTimeout(1200);
    expect(page.url()).not.toContain("/project/");
    await expect(page.locator('[data-mode="map"][data-mode-active="true"]')).toBeVisible();
  });
});
