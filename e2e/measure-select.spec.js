/* B910 / NEW-1 — clicking a measurement selects it straight from the Measure tool, and repeated
 * clicks cycle the stack instead of feeling inert.
 *
 * The bug: the Measure tool STAYS active after you draw (so you can measure many things in a row),
 * but the measurement's hit target + its select handler both gated on the Select tool — so the
 * measurement you'd just drawn silently swallowed clicks, with no selection, no ×, no hint to
 * switch tools. Fix: a click grabs a finished measurement from the Measure tool too, drops back to
 * Select (the grips / × / highlight are gated on Select, so they appear), and a repeat click at the
 * same spot cycles the selection DOWN through any overlapping measurements (smaller-area-wins first).
 *
 * Runs LOGGED OUT against a seeded-blank site, driving the real SVG canvas. The selected measurement
 * renders data-testid="measure-selected" (carrying data-sel-i = its index) only when a measurement
 * is selected AND the tool is Select — so its mere presence proves BOTH the selection and the
 * tool-drop happened from a single click made while the Measure tool was active. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const selected = (p) => p.getByTestId("measure-selected");

function measureCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Arm the Measure tool in a specific mode via the Measure ▾ menu.
async function armMeasure(page, mode) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
}

// A two-click distance ("Length") measure between two client-px points.
async function drawLength(page, x1, y1, x2, y2) {
  const before = await measureCount(page);
  await page.mouse.click(x1, y1);
  await page.mouse.click(x2, y2);
  await expect.poll(() => measureCount(page)).toBe(before + 1);
}

test.describe("measurement selection — click from the Measure tool, cycle the stack (logged out)", () => {
  test("a single click selects a freshly drawn measurement without switching to Select first", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const x1 = box.x + 300, y = box.y + 260, x2 = box.x + 520;
    await drawLength(page, x1, y, x2, y);

    // Still in the Measure tool (never switched to Select) → nothing selected yet.
    await expect(selected(page)).toHaveCount(0);

    // Single click on the measurement line — the reported repro. It must select, which surfaces the
    // handles/×/highlight (all gated on the Select tool → their presence proves the tool dropped too).
    await page.mouse.click(Math.round((x1 + x2) / 2), y);
    await expect(selected(page)).toBeVisible();

    // A click on empty canvas clears the selection.
    await page.mouse.click(box.x + 120, box.y + 120);
    await expect(selected(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("repeated clicks on overlapping measurements cycle the selection (not inert)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const cx = box.x + 420, cy = box.y + 300;
    // Two measures crossing at (cx, cy): one horizontal, one vertical — the crossing point sits on both.
    await drawLength(page, cx - 130, cy, cx + 130, cy); // horizontal → index 0
    await drawLength(page, cx, cy - 130, cx, cy + 130); // vertical   → index 1
    expect(await measureCount(page)).toBe(2);

    // First click at the crossing selects one of them.
    await page.mouse.click(cx, cy);
    await expect(selected(page)).toBeVisible();
    const first = await selected(page).getAttribute("data-sel-i");

    // A second click at the SAME spot cycles to the OTHER measurement underneath — still a live
    // selection (never a silent deselect), and a different measurement than the first.
    await page.mouse.click(cx, cy);
    await expect(selected(page)).toBeVisible();
    await expect.poll(() => selected(page).getAttribute("data-sel-i")).not.toBe(first);

    // Empty-canvas click deselects.
    await page.mouse.click(box.x + 120, box.y + 120);
    await expect(selected(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
