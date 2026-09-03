/* Diagnostic probe for NEW-1 (B1112449/B1112450 recurrence) — drives the REAL
 * Scheduler -> AppHeader -> ProjectBreadcrumb chain with a bridged payload shaped exactly like
 * the owner's live production report: a site with TWO linked schedules sharing one linkedSiteId.
 * Bypasses the embedded iframe's own boot (it loads React/Babel from a CDN this sandbox can't
 * reach) by posting the bridge message directly, same idiom as e2e/schedule-link-panel.spec.js.
 */
import { test, expect } from "@playwright/test";

const GID = "g-zzmulti";

function seed(page) {
  return page.addInitScript(([gid]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: gid, site: "ZZ-RENAME-TEST-G", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
  }, [GID]);
}

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);
const navState = (projects, activeId, section = "projects") =>
  ({ type: "planar:nav-state", section, activeId, projects });

test("a site with two linked schedules shows two selectable switcher rows and a disambiguating breadcrumb", async ({ page }) => {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });

  const crumb = page.locator('[data-testid="project-crumb"]:visible');
  await expect(crumb).toBeVisible({ timeout: 15_000 });

  // Post the real bridged shape: two schedules, same linkedSiteId, second one active.
  await postSeq(page, navState(
    [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
      { id: 18, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
    ],
    18,
    "projects",
  ));
  await page.waitForTimeout(600);

  // Breadcrumb should disambiguate the active schedule.
  await expect(crumb).toContainText("ZZ-RENAME-TEST-G (2)");

  await crumb.click();
  const search = page.locator('input[placeholder="Search projects…"]:visible');
  await search.fill("ZZ");
  await page.waitForTimeout(300);

  const rows = page.locator('[data-testid^="project-row-"]:visible');
  const count = await rows.count();
  const texts = await rows.allTextContents();
  expect(count).toBe(2);
  expect(texts.some((t) => t.includes("ZZ-RENAME-TEST-G (2)"))).toBe(true);
});

test("a multi-linked-schedule bridge payload is captured to telemetry (B1112449/B1112450 recurrence instrument)", async ({ page }) => {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });
  const crumb = page.locator('[data-testid="project-crumb"]:visible');
  await expect(crumb).toBeVisible({ timeout: 15_000 });

  await postSeq(page, navState(
    [
      { id: 16, name: "ZZ-RENAME-TEST-G", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
      { id: 18, name: "ZZ-RENAME-TEST-G (2)", linkedSiteId: GID, linkedSiteName: "ZZ-RENAME-TEST-G" },
    ],
    18,
    "projects",
  ));
  await page.waitForTimeout(600);

  const recent = await page.evaluate(() => (window.pfTelemetry ? window.pfTelemetry.recent() : []));
  const hit = recent.find((r) => (r.source || "").includes("schedule-multi-link-payload"));
  expect(hit).toBeTruthy();
  expect(hit.message).toContain(GID);
  expect(hit.message).toMatch(/"id":16/);
  expect(hit.message).toMatch(/"id":18/);
});
