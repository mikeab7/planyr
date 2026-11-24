/* Total stalls when several parking fields / trailer rows are selected. Logged out, no GIS.
 * Two car fields + one trailer row, marquee-selected: car and trailer totals show separately; a Width edit changes the
 * car total live, Undo/Redo follow it; Ctrl-clicking a member out of the selection drops it from the total.
 * Run: BASE_URL=http://localhost:4173 npx playwright test e2e/multi-props-stall-totals.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank, selectTool } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const ofType = async (page, t) => (await plan(page)).filter((e) => e.type === t);
async function drag(page, x1, y1, x2, y2) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 });
  await page.mouse.up();
}
const num = async (loc) => Number((await loc.innerText()).replace(/[^\d]/g, ""));
test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("multi-select shows total car and trailer stalls, live", async ({ page }) => {
  await startBlank(page);
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await drag(page, 150, 250, 400, 400);
  await expect.poll(async () => (await ofType(page, "parking")).length).toBe(1);
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await drag(page, 480, 250, 700, 420);
  await expect.poll(async () => (await ofType(page, "parking")).length).toBe(2);
  await page.getByRole("button", { name: "Parking type" }).click();
  await page.getByRole("button", { name: "Trailer parking", exact: true }).click();
  await drag(page, 150, 520, 450, 600);
  await expect.poll(async () => (await ofType(page, "trailer")).length).toBe(1);
  await selectTool(page);
  await page.getByRole("button", { name: /^Select multiple/ }).click();
  await drag(page, 100, 200, 760, 640);
  if (!(await page.getByTestId("multi-props").isVisible())) await page.getByRole("button", { name: "Properties" }).first().click();
  const car = page.getByTestId("multi-stalls-car-total");
  const trailer = page.getByTestId("multi-stalls-trailer-total");
  await expect(car).toBeVisible();
  await expect(page.getByTestId("multi-stalls-car")).toContainText("2 parking fields");
  await expect(trailer).toBeVisible();
  const t0 = await num(car), tr0 = await num(trailer);
  expect(t0).toBeGreaterThan(0);
  expect(tr0).toBeGreaterThan(0);
  // the trailer total is the one row's own count (the label on the plan)
  await expect(page.getByTestId("multi-stalls-trailer")).toContainText("1 trailer row");
  // Ctrl-click the trailer row OUT of the selection: its total goes away, the car total is unchanged
  const tb = await page.locator(`[data-el-id="${(await ofType(page, "trailer"))[0].id}"]`).first().boundingBox();
  const vx = Math.max(tb.x, 400) + 40; // the panel covers the left of the canvas: click the part that is in view
  await page.keyboard.down("Control");
  await page.mouse.click(vx, tb.y + tb.height / 2);
  await page.keyboard.up("Control");
  await expect(page.getByTestId("multi-stalls-trailer")).toHaveCount(0);
  expect(await num(car)).toBe(t0);
  // an edit that changes stall counts updates the car total live; trailer untouched
  const width = page.getByTestId("multi-prop-width");
  await width.fill("300"); await width.press("Enter");
  await expect.poll(() => num(car)).not.toBe(t0);
  const t1 = await num(car);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => num(car)).toBe(t0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => num(car)).toBe(t1);
});
