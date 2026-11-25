/* ONE UNDO TOAST, AND IT NEVER LIES (owner pick "A", 2026-11-25; lib/undoToast.js).
 *
 * The owner's screenshot: "Deleted Parcel 2 [Undo]" and "Deleted Parcel 3 [Undo]" stacked, and Undo on the OLDER
 * toast reversed the NEWER delete (every toast called the global undo). This drives the real planner, logged out
 * on a blank site: three deletes in a row show ONE toast that keeps count and "Undo all 3" brings back exactly
 * those three; a different action replaces it; Ctrl+Z withdraws it; a real edit after it withdraws it.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const railBtn = (p) => p.getByTestId("rail-parcel-tools");
const row = (p, id) => p.locator(`[data-parcel-action="${id}"]`);

/* The persisted (logged-out) site model — on-disk truth, so an assertion survives a reload. */
function readModel(page) {
  return page.evaluate(() => {
    const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const parcels = site.parcels || [];
    return {
      count: parcels.filter((p) => p.active !== false).length,
      total: parcels.length,
      parcels: parcels.map((p) => ({ id: p.id, pts: (p.points || []).length, locked: !!p.locked, chipHidden: !!p.chipHidden, active: p.active !== false })),
    };
  });
}

async function boot(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-toolbar-draw").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

/* Open the flyout (idempotent — it is a toggle, so only open when it is closed). */
async function openMenu(page) {
  if (await row(page, "draw").isVisible().catch(() => false)) return;
  await railBtn(page).click();
  await expect(row(page, "draw")).toBeVisible();
}

/* Pick a row from the flyout. */
async function pick(page, id) {
  await openMenu(page);
  await row(page, id).click();
}

/* Draw a rectangular parcel from the menu's own "Draw new parcel" row.
 *
 * ⚠ Drawing a parcel RE-FITS the view, so the coordinates you drew at no longer locate it
 * afterwards (the same trap e2e/click-contract.spec.js documents). Read `outlineBox` for where a
 * parcel actually IS on screen; never reuse the draw coordinates. */
async function drawParcel(page, x0, y0, x1, y1) {
  await pick(page, "draw");
  await expect(page.getByText(/drop boundary points/i)).toBeVisible();
  const b = await canvas(page).boundingBox();
  const pt = (fx, fy) => [b.x + fx, b.y + fy];
  for (const [x, y] of [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]) { await page.mouse.click(x, y); await page.waitForTimeout(80); }
  await page.mouse.click(...pt(x0, y0)); // close on the first point
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250); // let the re-fit settle before anyone reads a box
}

/* A screen point ON a rendered parcel — its centre, or the midpoint of its first boundary edge.
 *
 * ⚠ Read it through the live SVG transform, NOT `boundingBox()`. Selecting a parcel thickens its
 * stroke, which inflates the reported box by several pixels on every side — enough to put a
 * "click the top edge" outside the edge hit tolerance, which is exactly how the reshape assertion
 * first failed here against a build where the gesture worked fine. */
function outlinePoint(page, i, what) {
  return page.evaluate(({ i, what }) => {
    const poly = document.querySelectorAll('[data-testid="parcel-outline"]')[i];
    if (!poly) return null;
    const pts = poly.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const [ux, uy] = what === "edge"
      ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      : [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const p = poly.ownerSVGElement.createSVGPoint();
    p.x = ux; p.y = uy;
    const s = p.matrixTransform(poly.getScreenCTM());
    return [Math.round(s.x), Math.round(s.y)];
  }, { i, what });
}
/* Select the (first) parcel by clicking inside it — THIS PARCEL only exists for a selected parcel (NEW-1, 2026-10-11). */
async function selectParcel(page, i = 0) {
  await page.keyboard.press("Escape");
  const at = await outlinePoint(page, i, "edge"); // a parcel is picked on its outline (its fill is off)
  await page.mouse.click(...at);
  await page.waitForTimeout(150);
}
const outlineCount = (page) => page.getByTestId("parcel-outline").count();
const undoToasts = (page) => page.locator('[data-testid="sync-toast"]').filter({ has: page.getByRole("button", { name: /^Undo/ }) });

async function threeParcels(page) {
  await boot(page);
  await drawParcel(page, 120, 120, 220, 220);
  await drawParcel(page, 260, 120, 360, 220);
  await drawParcel(page, 400, 120, 500, 220);
  await expect.poll(() => readModel(page).then((m) => m.total)).toBe(3);
}
async function deleteFirst(page) {
  await selectParcel(page, 0);
  await pick(page, "deleteSelected");
}

test.describe("one undo toast that keeps count", () => {
  test("three deletes in a row → one toast, 'Undo all 3' brings back exactly those three", async ({ page }) => {
    await threeParcels(page);
    await deleteFirst(page);
    await expect(undoToasts(page)).toHaveCount(1);
    await expect(undoToasts(page).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await deleteFirst(page);
    await deleteFirst(page);
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(0);
    await expect(undoToasts(page)).toHaveCount(1);                  // ONE toast, not three
    await expect(undoToasts(page)).toContainText("Deleted 3 parcels");
    await expect(page.getByTestId("toast-more")).toHaveCount(0);   // no "+n more" pile-up
    await undoToasts(page).getByRole("button", { name: "Undo all 3" }).click();
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(3);
    await expect(undoToasts(page)).toHaveCount(0);
  });

  test("a different action in between ends the run: the next delete starts a fresh 'Deleted Parcel …'", async ({ page }) => {
    await threeParcels(page);
    await deleteFirst(page);
    await expect(undoToasts(page)).toHaveCount(1);
    await selectParcel(page, 0);
    await pick(page, "lock");                                       // a real edit that is not a delete
    await expect.poll(() => readModel(page).then((m) => m.parcels.some((p) => p.locked))).toBe(true);
    await expect(undoToasts(page)).toHaveCount(0);                  // the delete toast no longer names the newest step
    await deleteFirst(page);
    await expect(undoToasts(page)).toHaveCount(1);
    await expect(undoToasts(page)).toContainText(/^Deleted Parcel/); // not "Deleted 2 parcels"
    await undoToasts(page).getByRole("button", { name: "Undo", exact: true }).click();
    // exactly the second delete comes back; the lock and the first delete stand
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(2);
    await expect.poll(() => readModel(page).then((m) => m.parcels.some((p) => p.locked))).toBe(true);
  });

  test("Ctrl+Z withdraws the toast (its Undo would otherwise point at the wrong step)", async ({ page }) => {
    await threeParcels(page);
    await deleteFirst(page);
    await deleteFirst(page);
    await expect(undoToasts(page)).toContainText("Deleted 2 parcels");
    await page.keyboard.press("Control+z");
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(2);
    await expect(undoToasts(page)).toHaveCount(0);
  });

  test("a real edit after the delete withdraws the toast", async ({ page }) => {
    await threeParcels(page);
    await deleteFirst(page);
    await expect(undoToasts(page)).toHaveCount(1);
    await drawParcel(page, 120, 260, 220, 340);
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(3);
    await expect(undoToasts(page)).toHaveCount(0);
  });
});
