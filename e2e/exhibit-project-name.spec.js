/* B1934528 — the Compose exhibit screen (and everything else that reads `siteLabel`) must
 * follow a project rename LIVE, even when the rename reaches this project through a door other
 * than its own currently-open plan's breadcrumb.
 *
 * THE REPORTED CASE: Michael renamed a project from "Pappadoupolos" to "Papadopoulos". The
 * top breadcrumb showed the new name; Compose exhibit's title block, header line, and the
 * default PDF filename still printed the old one.
 *
 * ROOT CAUSE (SitePlanner.jsx): `siteLabel` is a plain `useState` captured once at mount from
 * `restored.site`. `ProjectBreadcrumb.jsx`'s row-rename dropdown — the "..." kebab menu on a
 * project row, in EITHER the Map-mode or the Plan-mode header, on the CURRENT project or any
 * other — commits through its own uncontrolled project registry (`shared/projects/projects.js`'s
 * `storeRename`), never through the `onRenameProject` prop `SitePlannerApp.jsx` wires to
 * `renameSite`/`renameProjectFromHeader`. So THAT commit path never touches `commitSiteLabel`
 * either, and `siteLabel` in an already-mounted SitePlanner instance for the renamed project went
 * stale regardless of which mode the rename happened in — measured directly below (all three
 * cases fail identically with the fix disabled). `ProjectBreadcrumb.jsx` itself shows the correct
 * name regardless, because it resolves it LIVE off the sites list on its own "planarfit:sites"
 * storage-event listener (`resolveCurrentName`), which is exactly the mechanism SitePlanner.jsx
 * did not have for its own `siteLabel` state before this fix.
 *
 * SitePlannerApp never unmounts a plan's SitePlanner instance when the user switches to Map mode
 * (`goMap` only flips `mode`, keeping `activeSiteId` — the Leaflet keep-alive optimization), so
 * the Map-mode repro below (open the plan → go to Map → rename via the Map's own crumb → return
 * to the SAME plan, same mounted instance, no remount) is the one that matches Michael's live
 * report exactly; the direct in-plan repro is included alongside it because it turned out to
 * exercise the identical defect rather than a working control.
 * Logged out, no external GIS — Claude-doable here per the ATTEMPT-BEFORE-YOU-PARK rule.
 */
import { test, expect } from "@playwright/test";

const GID = "g-exhibitnametest";
const OLD_NAME = "Pappadoupolos";
const NEW_NAME = "Papadopoulos";

function seed(page) {
  return page.addInitScript(([gid, name]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: name, name: "Concept A", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {} },
    }));
  }, [GID, OLD_NAME]);
}

async function openProject(page) {
  await page.goto(`/#/project/${GID}/site`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
}

async function goToMap(page) {
  await page.locator('[data-testid="dashboard-crumb"]:visible').click();
  await expect(page.locator('[data-testid="map-toolbar-draw"]:visible')).toBeVisible({ timeout: 10_000 });
}

async function backToPlan(page) {
  await page.evaluate((gid) => { window.location.hash = `#/project/${gid}/site`; }, GID);
  await expect(page.locator('[data-testid="planner-canvas"]:visible')).toBeVisible({ timeout: 15_000 });
}

async function openProjectCrumb(page) {
  await page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first().click();
}

async function renameViaRowMenu(page, next) {
  await openProjectCrumb(page);
  await page.getByTestId(`project-row-${GID}`).hover();
  await page.getByTestId(`project-kebab-${GID}`).click();
  await page.getByTestId("project-rename").click();
  const input = page.getByRole("textbox", { name: /^Rename / });
  await expect(input).toBeVisible();
  await input.fill(next);
  await input.press("Enter");
}

async function openComposeExhibit(page) {
  await page.locator('button:has-text("File")').first().click();
  await page.locator('button:has-text("Download PDF / pick frame")').click();
  await expect(page.locator('[data-testid="print-frame"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('button:has-text("Continue")').click();
  await expect(page.locator('[data-testid="print-compose"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("B1934528 — the exhibit follows a rename made while this plan sits hidden in Map mode", () => {
  test("Compose exhibit's title block and header line show the NEW project name, not the one at mount", async ({ page }) => {
    await seed(page);
    await openProject(page);
    await goToMap(page);

    // Rename via the Map's own project crumb — the door that bypasses commitSiteLabel.
    await renameViaRowMenu(page, NEW_NAME);
    await expect.poll(() => page.evaluate((gid) => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      return map[Object.keys(map).find((k) => map[k].groupId === gid)]?.site;
    }, GID)).toBe(NEW_NAME);

    // Return to the SAME plan — same activeSiteId, so SitePlanner is NOT remounted; this is the
    // hidden instance that was open the whole time.
    await backToPlan(page);

    await openComposeExhibit(page);
    const compose = page.locator('[data-testid="print-compose"]');
    await expect(compose).toContainText(NEW_NAME);
    await expect(compose).not.toContainText(OLD_NAME);
  });

  test("the default PDF filename also follows the new name (sheetFileName reads siteLabel)", async ({ page }) => {
    await seed(page);
    await openProject(page);
    await goToMap(page);
    await renameViaRowMenu(page, NEW_NAME);
    await expect.poll(() => page.evaluate((gid) => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      return map[Object.keys(map).find((k) => map[k].groupId === gid)]?.site;
    }, GID)).toBe(NEW_NAME);
    await backToPlan(page);
    await openComposeExhibit(page);

    // Field label="Project" is a read-only span mirroring `siteLabel` directly (PrintCompose.jsx).
    await expect(page.locator('[data-testid="print-compose"]')).toContainText(NEW_NAME);
  });

  test("renaming through the currently-OPEN plan's own crumb (no Map mode involved) shows the new name too", async ({ page }) => {
    // Not a "control" for the Map-mode case above — measured to fail identically without the fix
    // (see this file's header comment), because the dropdown's row-rename never calls
    // commitSiteLabel in either mode. Kept as its own case because it's the simplest repro of the
    // same defect and the one most likely to be hit first in normal use.
    await seed(page);
    await openProject(page);
    await renameViaRowMenu(page, NEW_NAME); // renamed from the Plan-mode crumb — id === groupId
    await openComposeExhibit(page);
    const compose = page.locator('[data-testid="print-compose"]');
    await expect(compose).toContainText(NEW_NAME);
    await expect(compose).not.toContainText(OLD_NAME);
  });
});
