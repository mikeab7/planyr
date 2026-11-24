/* NEW-1 — bulk-edit PROPERTIES across a same-type multi-selection. Logged out, no GIS.
 * Three buildings, two different lengths: the Properties panel says "Mixed", one typed Length lands on all three
 * (and re-fits what is bonded to each), ONE Undo puts all three back, Redo re-applies, and the value survives a reload.
 * Run: BASE_URL=http://localhost:4173 npx playwright test e2e/multi-props-bulk-edit.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank, selectTool } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const bldgs = async (page) => (await plan(page)).filter((e) => e.type === "building" && !e.dogEar).sort((a, b) => a.cx - b.cx);
async function drawBldg(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("typing a Length on three selected buildings sets all three in one undo step", async ({ page }) => {
  await startBlank(page);
  await drawBldg(page, 200, 300, 350, 400);
  await expect.poll(async () => (await bldgs(page)).length).toBe(1);
  await drawBldg(page, 420, 300, 670, 400);
  await expect.poll(async () => (await bldgs(page)).length).toBe(2);
  await drawBldg(page, 760, 300, 910, 400);
  await expect.poll(async () => (await bldgs(page)).length).toBe(3);
  await selectTool(page);
  await page.getByRole("button", { name: /^Select multiple/ }).click();
  // marquee around all three
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + 120, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 1040, box.y + 470, { steps: 14 });
  await page.mouse.up();
  const props = page.getByRole("button", { name: "Properties" }).first();
  if (!(await page.getByTestId("multi-props").isVisible())) await props.click();
  const len = page.getByTestId("multi-prop-length");
  await expect(len).toBeVisible();
  await expect(len).toHaveAttribute("placeholder", "Mixed");
  const before = (await bldgs(page)).map((b) => [b.w, b.h]);
  await len.fill("420"); await len.press("Enter");
  await expect.poll(async () => (await bldgs(page)).map((b) => Math.round(Math.max(b.w, b.h))).join()).toBe("420,420,420");
  await expect(len).toHaveValue("420");
  // ONE undo restores all three
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => JSON.stringify((await bldgs(page)).map((b) => [b.w, b.h]))).toBe(JSON.stringify(before));
  // …and Redo re-applies all three
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(async () => (await bldgs(page)).map((b) => Math.round(Math.max(b.w, b.h))).join()).toBe("420,420,420");
  // survives a reload (saved)
  await page.waitForTimeout(1500);
  await page.reload();
  await expect.poll(async () => (await bldgs(page)).map((b) => Math.round(Math.max(b.w, b.h))).join()).toBe("420,420,420");
});
