/* v3 UI SPEC Part A — the Yield panel's top-level groups. Drives the REAL app logged out on a
 * seeded-blank site (no network): draws a parcel + pond, opens Yield, and asserts the SITE YIELD
 * header, the LAND USE (open) · BUILDINGS (closed) · BUILDABILITY (closed) · COSTS (closed)
 * groups render and toggle, and the A9 footer legend shows, with zero page errors. The verdict
 * strip + the DETENTION DETAIL groups are GIS-gated (need a live drainage check) and unit-tested
 * elsewhere (test/yieldVerdicts.test.js). */
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

test.describe("Yield panel — v3 UI SPEC Part A top-level groups", () => {
  test("SITE YIELD header + LAND USE / BUILDINGS / BUILDABILITY / COSTS render; BUILDINGS toggles; footer legend shows", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await drawPond(page);
    await page.getByRole("button", { name: "Yield", exact: true }).click();

    // A1 header.
    await expect(page.getByText("Site Yield", { exact: true })).toBeVisible();

    // The top-level groups (LAND USE open · BUILDINGS · BUILDABILITY · COSTS closed).
    await expect(page.getByRole("button", { name: /Land use/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Buildings/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Buildability/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Costs/i }).first()).toBeVisible();

    // A5 LAND USE is open by default → its legend labels show (Buildings/Open space/Pond/Paving).
    await expect(page.getByText("Open space", { exact: true })).toBeVisible();
    await expect(page.getByText("Impervious (buildings + paving)", { exact: true })).toBeVisible();

    // A6 BUILDINGS is closed → the Car-stalls row is hidden until we open it.
    await expect(page.getByText("Car stalls", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /Buildings/i }).first().click();
    await expect(page.getByText("Car stalls", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Buildings/i }).first().click();
    await expect(page.getByText("Car stalls", { exact: true })).toHaveCount(0);

    // A9 footer legend.
    await expect(page.getByText("measured from your drawing", { exact: true })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
