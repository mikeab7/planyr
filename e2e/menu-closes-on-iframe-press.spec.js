/* NEW-1 — the Schedule tab's grid lives in an IFRAME (/sequence/), so a press on a grid cell never reaches the
 * parent document: AnchoredMenu's document-level mousedown listener cannot see it and the schedule / project
 * switcher stayed open over the grid. The press is real; the parent only learns of it as a window `blur`
 * (focus moved into the frame). Drives the REAL Scheduler -> breadcrumb chain, bridged payload posted directly
 * (same idiom as scheduler-multi-schedule-switcher.spec.js), and presses INSIDE the real iframe element. */
import { test, expect } from "@playwright/test";

const GID = "g-zziframe";
const seed = (page) => page.addInitScript(([gid]) => {
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({
    p1: { id: "p1", groupId: gid, site: "ZZ-IFRAME-TEST", name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
  }));
}, [GID]);

async function boot(page) {
  await seed(page);
  await page.goto(`/#/project/${GID}/schedule`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="project-crumb"]:visible')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.postMessage({ source: "planar-seq", type: "planar:nav-state", section: "projects", activeId: 1,
    projects: [{ id: 1, name: "ZZ-IFRAME-TEST", linkedSiteId: "g-zziframe", linkedSiteName: "ZZ-IFRAME-TEST" }] }, window.location.origin));
  await expect(page.locator('[data-testid="schedule-crumb"]:visible')).toBeVisible({ timeout: 10_000 });
  // let the embedded app finish booting before any menu opens, so its own start-up chatter cannot be what closes one
  await page.frames().find((f) => f.url().includes("/sequence"))?.waitForLoadState("load");
  await page.waitForTimeout(2500);
}
// A press on a grid cell INSIDE the embedded app. Dispatched from within the frame because the shell can cover the
// frame with its own loader / empty-state in this sandbox, which would swallow a coordinate click before it got in.
const pressInsideFrame = async (page) => {
  const frame = page.frames().find((f) => f.url().includes("/sequence"));
  await frame.evaluate(() => {
    const el = document.querySelector("td, [role=gridcell], .task-row, .grid-row") || document.body;
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
};

// Open/closed is read off the crumb's own aria-expanded: the Scheduler's empty state renders schedule rows of its own,
// so counting rows would conflate that list with the dropdown.
const open = (page, crumb) => expect(page.locator(crumb)).toHaveAttribute("aria-expanded", "true");
const closed = (page, crumb) => expect(page.locator(crumb)).toHaveAttribute("aria-expanded", "false");

for (const [name, crumb] of [
  ["schedule switcher", '[data-testid="schedule-crumb"]:visible'],
  ["project switcher", '[data-testid="project-crumb"]:visible'],
]) {
  test(`${name} closes on a press inside the embedded grid`, async ({ page }) => {
    await boot(page);
    await page.locator(crumb).click();
    await open(page, crumb);
    await page.waitForTimeout(1500); // the embedded app announces itself: the menu must outlive that
    await open(page, crumb);
    await pressInsideFrame(page);
    await closed(page, crumb);
  });

  test(`${name} closes on Escape pressed inside the embedded grid`, async ({ page }) => {
    await boot(page);
    await page.locator(crumb).click();
    await open(page, crumb);
    const frame = page.frames().find((f) => f.url().includes("/sequence"));
    await frame.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await closed(page, crumb);
  });

  test(`${name} closes on Escape in the shell and survives a press inside its own panel`, async ({ page }) => {
    await boot(page);
    await page.locator(crumb).click();
    await open(page, crumb);
    await page.locator(".menu:visible, .psw-panel:visible").first().click({ position: { x: 4, y: 4 }, force: true });
    await open(page, crumb);
    await page.keyboard.press("Escape");
    await closed(page, crumb);
  });
}
