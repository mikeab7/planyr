/* NEW-1 — toast when a layer that is ON cannot draw at the current zoom (owner-approved: a toast,
 * not a greyed row). Once per CROSSING: on load out of range, then again only after the map has
 * come back in range and gone out. The crossing rule itself is pinned in test/layerHiddenToast.test.js;
 * this spec proves the rendered toast, its Zoom in action, and the re-arm on the real app.
 * Hermetic: logged out, the gate is answered from the live zoom. */
import { test, expect } from "@playwright/test";

/* A tract whose whole-site fit lands BELOW the z16 terrain gate — the owner's situation restated
 * as geometry ("he was zoomed out"). Waller County, as on his real plan. */
const W = 12000, H = 9000;
const site = {
  schemaVersion: 12, id: "zg1", groupId: "zg1", site: "Zoom Gate", name: "Concept A",
  updatedAt: 1786000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.9038, lon: -95.9769 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [],
  underlay: null, settings: {},
  // Contours ON from the moment the plan opens — the row the owner reported.
  layerOverrides: { contours: true },
};

const PANEL = '[data-testid="layer-panel"][data-surface="planner"]';
const CONTOURS = `${PANEL} [data-testid="layer-row-contours"]`;

async function openPlanner(page) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", s);
      localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "all", radius: 2.5 }));
    } catch (_) {}
  }, JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Zoom Gate", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1500);
  // BOTH hosts stay mounted (the finder's copy is hidden), so click the VISIBLE control and assert
  // against the planner SURFACE, never against page text.
  await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first().click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400);
}


const TOAST = '[data-testid="sync-toast-host"] [data-testid="sync-toast"]';

test("layer-hidden toast: on load out of range, Zoom in draws, zoom out toasts once", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await openPlanner(page);
  const row = page.locator(CONTOURS);
  await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom");

  // 1. initial load, layer already on, map out of range → exactly one combined-style toast
  const toast = page.locator(TOAST, { hasText: "hidden at this zoom" });
  await expect(toast).toHaveCount(1, { timeout: 5000 });
  await expect(toast).toContainText(/is hidden at this zoom/);

  // 2. Zoom in → contours draw, toast gone
  await toast.getByRole("button", { name: "Zoom in" }).click();
  await expect(row).toHaveAttribute("data-layer-state", "drawing", { timeout: 5000 });
  await expect(page.locator(TOAST, { hasText: "hidden at this zoom" })).toHaveCount(0);

  // 3. zoom back out past the gate → the toast returns, exactly once, however long we stay out
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); }
  await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom", { timeout: 5000 });
  await expect(page.locator(TOAST, { hasText: "hidden at this zoom" })).toHaveCount(1, { timeout: 5000 });
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(400); }
  await expect(page.locator(TOAST, { hasText: "hidden at this zoom" })).toHaveCount(0); // still out of range: no re-fire
});
