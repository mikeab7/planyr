/* FINAL UI SPEC Part A — the condensed Detention-Pond inspector. Drives the REAL app,
 * logged out, on a seeded-blank site (no network dependency): draws a pond, selects it, and
 * asserts the new structure renders with zero page errors — the "At a glance" table, the
 * always-on "Elevations: NAVD88" chip, and the four collapsed groups (Sizing & criteria,
 * Outlet & storms, Flood & datum notes, Appearance) that open on click. The engine values
 * (drainage / flood facts) are GIS-gated and unit-tested elsewhere; this is the structure. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape"); // disarm the draw tool
  // Click the pond body to select it → its inspector docks open.
  await page.mouse.click((x1 + x2) / 2, (y1 + y2) / 2);
}

test.describe("Pond inspector — FINAL UI SPEC Part A structure", () => {
  test("condensed inspector renders: at-a-glance, datum chip, and four collapsed groups", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawPond(page);

    // Selecting the pond docks its condensed inspector.
    await expect(page.getByText("At a glance", { exact: true })).toBeVisible();
    // The always-on datum chip (a watch-out chip, condensed one line).
    await expect(page.getByText("Elevations: NAVD88", { exact: true })).toBeVisible();

    // The four collapsed groups, closed by default (their bodies hidden).
    for (const title of ["Sizing & criteria", "Outlet & storms", "Flood & datum notes", "Appearance"]) {
      await expect(page.getByRole("button", { name: new RegExp(title, "i") })).toBeVisible();
    }
    // Detention-storage detail is inside the (closed) Sizing group → not visible yet.
    await expect(page.getByText("Total depth (ft)")).toHaveCount(0);

    // Open "Sizing & criteria" → its detail (freeboard field) appears; close → hides.
    const sizing = page.getByRole("button", { name: /Sizing & criteria/i });
    await sizing.click();
    await expect(page.getByText("Freeboard (ft)")).toBeVisible();
    await sizing.click();
    await expect(page.getByText("Freeboard (ft)")).toHaveCount(0);

    // Open "Appearance" → the Fill/Outline controls (moved from the old Properties section).
    // (The header's accessible name includes its closed-state summary, so match a substring.)
    await page.getByRole("button", { name: /Appearance/i }).click();
    await expect(page.getByText("Fill", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Outline", { exact: true }).first()).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
