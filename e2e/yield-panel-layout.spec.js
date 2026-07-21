/* FINAL UI SPEC Part B (B1.2) — the Yield panel folds into top-level Collapse groups.
 * Drives the REAL app logged out on a seeded-blank site (no network): draws a parcel + pond,
 * opens Yield, and asserts the ① Stormwater (open) · ② Land & yield (closed) · ④ Costs
 * (closed) groups render and toggle, with zero page errors. The verdict strip + the detailed
 * drainage groups are GIS-gated (need a live drainage check) and unit-tested elsewhere. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawParcel(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Parcel ▾", exact: true }).click();
  await page.getByText("Draw new parcel", { exact: true }).click();
  for (const [x, y] of [[80, 80], [700, 80], [700, 500], [80, 500]]) await page.mouse.click(box.x + x, box.y + y);
  await page.getByRole("button", { name: "Finish", exact: false }).first().click();
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.count()) await done.click();
  await page.keyboard.press("Escape");
}

async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(box.x + 560, box.y + 420, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test.describe("Yield panel — FINAL UI SPEC Part B top-level groups", () => {
  test("Stormwater / Land & yield / Costs render, and Land & yield toggles", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await drawPond(page);
    await page.getByRole("button", { name: "Yield", exact: true }).click();

    // The three top-level groups' headers.
    await expect(page.getByRole("button", { name: /Stormwater/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Land & yield/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Costs road \+ earthwork/i })).toBeVisible();

    // ① Stormwater is open by default → its base rows (Detention storage) show.
    await expect(page.getByText("Detention storage", { exact: true })).toBeVisible();

    // ② Land & yield is closed → the Site-area row is hidden until we open it.
    await expect(page.getByText("Site area", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /Land & yield/i }).click();
    await expect(page.getByText("Site area", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Land & yield/i }).click();
    await expect(page.getByText("Site area", { exact: true })).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
