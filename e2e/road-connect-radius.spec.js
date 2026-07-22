/* B945/NEW-1 (snap-and-connect road endpoints) + B946/NEW-2 (auto-fix sub-min road radius).
 *
 * Drives the REAL SVG canvas LOGGED OUT against a seeded-blank site (no account, no GIS), so the
 * wiring is exercised end-to-end, not just the pure geometry (which test/roadGeometry.test.js
 * covers). Reads outcomes from the persisted site model in localStorage.
 *   • NEW-1: with Snap on, a new road whose FINAL point lands on an existing matching road's
 *            endpoint MERGES into one polyline (the two roads collapse to one).
 *   • NEW-2: assigning a class whose minimum the road violates AUTO-ROUNDS the tight corner —
 *            the stored per-vertex arc radius grows to meet the class minimum. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

function roads(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2);
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /travel — click points/i }).first().click();
}

test.describe("NEW-1 — snap-and-connect road endpoints", () => {
  test("a new road ending on a matching road's endpoint merges into one", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });   // focus the canvas
    await page.keyboard.press("s");                             // Snap ON (default off) — gates the magnet
    const box = await canvas(page).boundingBox();

    // Road A — horizontal.
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 300, box.y + 320);
    await page.mouse.click(box.x + 560, box.y + 320);
    await page.keyboard.press("Enter");
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(1);

    // Road B — drawn so its FINAL point lands exactly on Road A's LEFT endpoint → merge.
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 300, box.y + 180);
    await page.mouse.click(box.x + 300, box.y + 320); // == A's left endpoint client px
    await page.keyboard.press("Enter");

    // Merge collapses the two roads into ONE (the target is absorbed).
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(1);
    const merged = (await roads(page))[0];
    expect(merged.pts.length).toBeGreaterThanOrEqual(3); // A(2) + B(1 new) share the join node
  });

  test("dragging a road endpoint onto another matching road's endpoint merges them", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("s"); // Snap ON — gates the endpoint-drag magnet
    const box = await canvas(page).boundingBox();

    // Two separate, parallel roads.
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 300, box.y + 300);
    await page.mouse.click(box.x + 560, box.y + 300);
    await page.keyboard.press("Enter");
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 300, box.y + 440);
    await page.mouse.click(box.x + 560, box.y + 440);
    await page.keyboard.press("Enter");
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(2);

    // Select the SECOND road (click its strip, away from the mid-span dim label) so its vertex
    // handles render, then drag its left endpoint handle up onto the first road's left endpoint.
    await page.mouse.click(box.x + 360, box.y + 440);
    const handle = page.locator('[data-testid="road-vtx-0"]').first();
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 380, { steps: 6 });
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 8 }); // onto road A's left endpoint
    await page.mouse.up();

    // The magnet welded + merged the two into one road.
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(1);
  });
});

test.describe("NEW-2 — auto-fix sub-minimum road radius on class change", () => {
  test("assigning a stricter class rounds a tight corner up to its minimum", async ({ page }) => {
    await startBlank(page);
    await canvas(page).click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("s"); // Snap ON so the clicked points land on the grid
    const box = await canvas(page).boundingBox();

    // A road with a genuine interior corner (3 clicked points making a ~right-angle bend).
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 280, box.y + 300);
    await page.mouse.click(box.x + 520, box.y + 300);
    await page.mouse.click(box.x + 520, box.y + 470);
    await page.keyboard.press("Enter");
    await expect.poll(() => roads(page).then((r) => r.length)).toBe(1);

    const before = (await roads(page))[0];
    const rBefore = (before.vtx || []).reduce((m, v) => Math.max(m, (v && v.radius) || 0), 0);

    // Double-click the paved strip (away from the mid-span dimension label) to open Properties,
    // then switch the class to Truck route (50 ft minimum) → NEW-2 auto-fix rounds the corner.
    await page.mouse.dblclick(box.x + 340, box.y + 300);
    await expect(page.getByTestId("property-panel")).toBeVisible();
    const classSel = page.getByTestId("property-panel").locator("select").first();
    await classSel.selectOption({ label: "Truck route" });

    // The stored arc radius grew toward the class minimum (the fix reshaped the corner).
    await expect.poll(async () => {
      const after = (await roads(page))[0];
      return (after.vtx || []).reduce((m, v) => Math.max(m, (v && v.radius) || 0), 0);
    }).toBeGreaterThan(rBefore);
  });
});
