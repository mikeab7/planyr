/* Poppable / floating Site Planner panels (NEW-1 / NEW-2).
 *
 * Drives the REAL app, LOGGED OUT: a fresh "Start blank" site reaches the planner without the
 * seeded account, so this runs in CI without secrets (no auth gate). Covers the pointer/gesture
 * LIVE-VERIFY class the manual gate used to own: detach → drag-clamp → dock, the rail's
 * closed-by-default + active-state semantics, and that a floating card never pans the map.
 */
import { test, expect } from "@playwright/test";

// Enter the planner with a fresh blank site (works logged-out — no seeding, no auth).
async function openBlankPlanner(page) {
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Start blank", { exact: false }).first().click();
  await page.locator('button[title="Analysis"]').first().waitFor({ state: "visible", timeout: 20_000 });
}

// boundingBox() can transiently return null while the heavy planner re-renders — retry briefly.
async function box(loc) {
  let b = null;
  for (let i = 0; i < 25 && !b; i++) { b = await loc.boundingBox(); if (!b) await new Promise((r) => setTimeout(r, 80)); }
  return b;
}

test.describe("floating panels", () => {
  test("left rail is the entry point — panels are closed by default and single-click toggles", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openBlankPlanner(page);

    const analysis = page.locator('button[title="Analysis"]').first();
    await expect(analysis).toBeVisible();
    // NEW-2: nothing docked on load; icon inactive.
    await expect(page.locator('[data-testid="panel-chrome-analysis"]')).toHaveCount(0);
    await expect(analysis).toHaveAttribute("aria-pressed", "false");

    // Single click opens it docked with a chrome header; the icon lights up.
    await analysis.click();
    await expect(page.locator('[data-testid="panel-chrome-analysis"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-chrome-analysis-detach"]')).toBeVisible();
    await expect(analysis).toHaveAttribute("aria-pressed", "true");

    // The header ✕ closes it (NEW-2 collapse control); re-clicking the icon also toggles it.
    await page.locator('[data-testid="panel-chrome-analysis-close"]').click();
    await expect(page.locator('[data-testid="panel-chrome-analysis"]')).toHaveCount(0);
    await expect(analysis).toHaveAttribute("aria-pressed", "false");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detach floats a panel, dragging clamps it to the map, and dock returns it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openBlankPlanner(page);

    const analysis = page.locator('button[title="Analysis"]').first();
    await analysis.click();

    // Detach → a floating card appears, the docked form is gone, the rail icon stays active.
    await page.locator('[data-testid="panel-chrome-analysis-detach"]').click();
    const card = page.locator('[data-testid="floating-panel-analysis"]');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-testid="panel-chrome-analysis"]')).toHaveCount(0);
    await expect(analysis).toHaveAttribute("aria-pressed", "true");

    const canvas = page.locator('[data-testid="planner-canvas"]').first();
    const viewBoxBefore = await canvas.getAttribute("viewBox");

    // Drag the title bar far past the bottom-right corner — it must clamp inside the map viewport.
    const start = await box(card);
    const grabX = start.x + start.width / 2, grabY = start.y + 14;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 3000, grabY + 3000, { steps: 14 });
    await page.mouse.up();

    const after = await box(card);
    const cv = await box(canvas);
    expect(after).not.toBeNull();
    // Whole card within the canvas rect (2px slack for sub-pixel rounding).
    expect(after.x).toBeGreaterThanOrEqual(cv.x - 2);
    expect(after.y).toBeGreaterThanOrEqual(cv.y - 2);
    expect(after.x + after.width).toBeLessThanOrEqual(cv.x + cv.width + 2);
    expect(after.y + after.height).toBeLessThanOrEqual(cv.y + cv.height + 2);

    // The card is portaled to <body> (outside the canvas wrapper), so dragging it can't pan/zoom
    // the map — the canvas frame is untouched and nothing threw.
    expect(await canvas.getAttribute("viewBox")).toBe(viewBoxBefore);

    // Dock returns it to the left column.
    await page.locator('[data-testid="floating-panel-analysis-chrome-dock"]').click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-testid="panel-chrome-analysis"]')).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("all five left-rail panels can float at once", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openBlankPlanner(page);

    for (const [title, id] of [["Yield", "yield"], ["Parcel", "parcel"], ["Analysis", "analysis"], ["References", "references"], ["Standards", "standards"]]) {
      await page.locator(`button[title="${title}"]`).first().click();
      await page.locator(`[data-testid="panel-chrome-${id}-detach"]`).click();
      await expect(page.locator(`[data-testid="floating-panel-${id}"]`)).toBeVisible();
    }
    // Five distinct cards coexist (the ^= selector would also match nested chrome testids, so match exact ids).
    const distinct = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid]"))
      .map((e) => e.getAttribute("data-testid"))
      .filter((t) => /^floating-panel-(yield|parcel|analysis|references|standards)$/.test(t)).length);
    expect(distinct).toBe(5);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("below the 760px breakpoint the app is docked-only (no detach, no float)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 700, height: 900 });
    await openBlankPlanner(page);

    await page.locator('button[title="Analysis"]').first().click();
    const chrome = page.locator('[data-testid="panel-chrome-analysis"]');
    await expect(chrome).toBeVisible();
    // No detach affordance below the breakpoint, and double-clicking the header must not float it.
    await expect(page.locator('[data-testid="panel-chrome-analysis-detach"]')).toHaveCount(0);
    await chrome.dblclick();
    await expect(page.locator('[data-testid="floating-panel-analysis"]')).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
