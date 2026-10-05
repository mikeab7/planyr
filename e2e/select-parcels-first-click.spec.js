/* NEW-1 — the FIRST click on "Select parcels" after the Map loads must engage the mode. */
import { test, expect } from "@playwright/test";

const W = 12000, H = 9000;
const site = {
  schemaVersion: 12, id: "fc1", groupId: "fc1", site: "First Click", name: "Concept A",
  updatedAt: 1786000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.9038, lon: -95.9769 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [], underlay: null, settings: {},
};

for (const waitMs of [1500, 6000]) {
  test(`first real mouse click engages Select parcels after ${waitMs}ms`, async ({ page }) => {
    await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
    await page.addInitScript(() => { window.__PLANYR_E2E = true; });
    await page.addInitScript((s) => {
      try { localStorage.removeItem("planarfit:currentSite:v1"); localStorage.setItem("planarfit:sites:v1", s); } catch (_) {}
    }, JSON.stringify({ [site.id]: site }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    const btn = page.getByTestId("map-toolbar-select-parcels");
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(waitMs);
    const box = await btn.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("select-parcels-tip")).toBeVisible({ timeout: 3000 });
  });
}

/* The lost-press signature, delivered directly: pointerdown + pointerup over the button and NO click
 * (what a browser does when a re-render replaces the node between the two halves of a press). Red on
 * the pre-fix build (nothing engages); green once lib/pressWatch's recovery is wired. The real-click
 * arm above is the known-good arm: it proves "engaged" is observable at all. */
async function openMap(page) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript((s) => {
    try { localStorage.removeItem("planarfit:currentSite:v1"); localStorage.setItem("planarfit:sites:v1", s); } catch (_) {}
  }, JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await expect(page.getByTestId("map-toolbar-select-parcels")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}
const press = (page, dx) => page.getByTestId("map-toolbar-select-parcels").evaluate((el, dx) => {
  const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const mk = (type, px) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", clientX: px, clientY: y, button: 0 });
  el.dispatchEvent(mk("pointerdown", x)); el.dispatchEvent(mk("pointerup", x + dx));
}, dx);

test("a press that completes with no click is recovered (and reported)", async ({ page }) => {
  await openMap(page);
  await press(page, 0);
  await expect(page.getByTestId("map-toolbar-select-parcels")).toHaveCount(0, { timeout: 3000 });
  const trace = await page.evaluate(() => window.__selectParcelsTrace && window.__selectParcelsTrace());
  expect(trace.map((e) => e.kind)).toContain("press-lost-recovered");
});

test("a release OUTSIDE the button (drag-off) is NOT recovered", async ({ page }) => {
  await openMap(page);
  await press(page, 400);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("map-toolbar-select-parcels")).toHaveCount(1);
});
