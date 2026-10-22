/* NEW-1 (2026-10-22, work-laptop report) — the map's own full-window canvases hold pixels only while they have ink to carry.
 * Measured on live ff7be38 at the laptop's pixel ratio (2.6775): the city-limits and city-name canvases were 29.3 MB each, BLANK, at
 * every parcel zoom — 58.6 MB of GPU-side backing — and stayed 29.3 MB each while the Map view was hidden behind the planner.
 * Red on ff7be38 (z18: 5122x1499 each); green here. A known-good arm proves the check can see a canvas that SHOULD be full-size
 * (state lines at a wide zoom). The laptop's window and pixel ratio are the fixture: 1913x641 @ 2.6775. */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1913, height: 641 }, deviceScaleFactor: 2.6775 });

const census = (page) => page.evaluate(() => {
  const pick = (sel) => { const c = document.querySelector(sel + " canvas"); return c ? { w: c.width, h: c.height, mb: (c.width * c.height * 4) / 1048576 } : null; };
  return { admin: pick(".leaflet-adminboundaries-pane"), names: pick(".leaflet-placenames-pane") };
});
const gotoMap = async (page) => {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto("/?planyrDiag=1#/site");
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 60000 });
};

test("at a parcel zoom both full-window canvases hand their pixels back", async ({ page }) => {
  await gotoMap(page);
  await page.evaluate(() => window.__mapFinderMap.setView([35.7209, -86.3218], 18, { animate: false }));
  await page.waitForTimeout(2500);
  const c = await census(page);
  expect(c.admin, "city-limits canvas exists").not.toBeNull();
  expect(c.names, "city-names canvas exists").not.toBeNull();
  expect(c.admin.mb, `city-limits canvas is ${c.admin.w}x${c.admin.h}`).toBeLessThan(1);
  expect(c.names.mb, `city-names canvas is ${c.names.w}x${c.names.h}`).toBeLessThan(1);
});

test("known-good arm — at a wide zoom the state-lines canvas IS full-size and has ink", async ({ page }) => {
  await gotoMap(page);
  await page.evaluate(() => window.__mapFinderMap.setView([37, -96], 5, { animate: false }));
  await page.waitForTimeout(3000);
  const c = await census(page);
  expect(c.admin.mb, "state lines draw at zoom 5, so the canvas is allocated").toBeGreaterThan(10);
  const ink = await page.evaluate(() => { const cv = document.querySelector(".leaflet-adminboundaries-pane canvas"); const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; });
  expect(ink, "something is actually drawn").toBeGreaterThan(50);
});

test("zooming back out re-allocates and redraws (the release is not a one-way door)", async ({ page }) => {
  await gotoMap(page);
  await page.evaluate(() => window.__mapFinderMap.setView([35.7209, -86.3218], 18, { animate: false }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__mapFinderMap.setView([37, -96], 5, { animate: false }));
  await page.waitForTimeout(3000);
  const c = await census(page);
  expect(c.admin.mb).toBeGreaterThan(10);
  const levels = await page.evaluate(() => document.querySelector(".leaflet-adminboundaries-pane").dataset.levels);
  expect(levels).toMatch(/country|admin1/);
});
