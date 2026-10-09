/* NEW-2 — the inspector header's ⋯ menu closes on an outside click or Escape, and the press that closes it
 * does nothing else (the building is neither deleted nor deselected).
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/inspector-more-menu.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const buildings = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.type === "building" && !e.dogEar);
});

async function boot(page) {
  await startBlank(page);
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + 200, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 400, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await buildings(page)).length).toBe(1);
  const [b] = await buildings(page);
  const pt = await page.evaluate((id) => {
    const r = document.querySelector(`[data-el-id="${id}"]`).querySelector("rect, path").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, b.id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
  return { b, box };
}

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

test("⋯ closes on a click on the empty canvas — building neither deleted nor deselected", async ({ page }) => {
  const { b, box } = await boot(page);
  await page.getByTestId("building-more").click();
  await expect(page.getByTestId("building-delete")).toBeVisible();
  await page.mouse.click(box.x + 60, box.y + 60);                  // empty canvas, far from the building
  await expect(page.getByTestId("building-delete")).toHaveCount(0);
  expect((await buildings(page)).length).toBe(1);
  await expect(page.getByTestId("building-header")).toBeVisible();  // still selected, panel still on it
  await expect(page.locator(`[data-el-id="${b.id}"]`)).toBeVisible();
});

test("⋯ closes on a click elsewhere in the panel", async ({ page }) => {
  await boot(page);
  await page.getByTestId("building-more").click();
  await expect(page.getByTestId("building-delete")).toBeVisible();
  await page.getByTestId("building-header").click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId("building-delete")).toHaveCount(0);
  expect((await buildings(page)).length).toBe(1);
});

test("⋯ closes on Escape, the building stays, and the trigger toggles it", async ({ page }) => {
  await boot(page);
  await page.getByTestId("building-more").click();
  await expect(page.getByTestId("building-delete")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("building-delete")).toHaveCount(0);
  expect((await buildings(page)).length).toBe(1);
  await page.getByTestId("building-more").click();
  await expect(page.getByTestId("building-delete")).toBeVisible();
  await page.getByTestId("building-more").click();                // re-press of its own trigger closes, not reopens
  await expect(page.getByTestId("building-delete")).toHaveCount(0);
});

test("⋯ → Delete building still deletes", async ({ page }) => {
  await boot(page);
  await page.getByTestId("building-more").click();
  await page.getByTestId("building-delete").click();
  await expect.poll(async () => (await buildings(page)).length).toBe(0);
});
