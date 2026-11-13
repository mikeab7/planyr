/* B910 / NEW-1 — clicking a measurement selects it, and repeated clicks cycle the stack instead of
 * feeling inert.
 *
 * ⛔ AMENDED by B2671280 (owner constraint #56). B910 let a LEFT click grab a finished measurement from the
 * MEASURE tool and drop to Select. That ate the first click of the next measurement whenever it landed on (or,
 * for an Area, inside) an existing one, so it is RETIRED: with a Measure tool armed a left press is always a
 * point (e2e/measure-first-click.spec.js), and a measurement is picked in the SELECT tool, by right-click, and
 * (this file) cycled by repeated clicks. Everything below drives the Select tool; the first test also asserts
 * the Measure tool does NOT select on a left click.
 *
 * Runs LOGGED OUT against a seeded-blank site, driving the real SVG canvas. The selected measurement
 * renders data-testid="measure-selected" (carrying data-sel-i = its index) only when a measurement
 * is selected AND the tool is Select — so its mere presence proves BOTH the selection and the
 * tool-drop happened from a single click made while the Measure tool was active. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const selected = (p) => p.getByTestId("measure-selected");

// Hand over to the Select tool (the rail's "Select V"), as a person does before picking a finished measurement.
async function toSelect(page) {
  const b = page.getByRole("button", { name: /^Select V$/ });
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
}

function measureCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

// Arm the Measure tool in a specific mode via the Measure ▾ menu.
async function armMeasure(page, mode) {
  await page.getByRole("button", { name: /^Measure mode:/ }).click();
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
  test("a single click in the Select tool selects a freshly drawn measurement; the Measure tool's left click places a point instead", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const x1 = box.x + 300, y = box.y + 260, x2 = box.x + 520;
    await drawLength(page, x1, y, x2, y);

    // Still in the Measure tool → nothing selected yet.
    await expect(selected(page)).toHaveCount(0);

    // B2671280: a left click ON the measurement from the Measure tool is a POINT, never a selection.
    await page.mouse.click(Math.round((x1 + x2) / 2), y);
    await expect(selected(page)).toHaveCount(0);
    await expect(page.getByTestId("measure-draft")).toHaveAttribute("data-points", "1");

    // In the Select tool a single click on the line selects it, which surfaces the handles / highlight.
    await toSelect(page);
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
    // Two measures crossing at (cx, cy): one horizontal, one vertical — the crossing point sits on both.
    // The crossing is kept OFF each line's midpoint: a measurement's summary chip sits at its midpoint and, in the
    // Select tool, captures a press of its own (chip drag), so a crossing under a chip never cycles.
    const cx = box.x + 540, cy = box.y + 300;
    await drawLength(page, cx - 200, cy, cx + 200, cy);       // horizontal → index 0 (chip at cx-0)
    await drawLength(page, cx + 120, cy - 200, cx + 120, cy + 60); // vertical   → index 1 (chip at cy-70)
    expect(await measureCount(page)).toBe(2);
    const crossX = cx + 120, crossY = cy;

    // First click at the crossing (Select tool) selects one of them.
    await toSelect(page);
    await page.mouse.click(crossX, crossY);
    await expect(selected(page)).toBeVisible();
    const first = await selected(page).getAttribute("data-sel-i");

    // A second click at the SAME spot cycles to the OTHER measurement underneath — still a live
    // selection (never a silent deselect), and a different measurement than the first.
    await page.mouse.click(crossX, crossY);
    await expect(selected(page)).toBeVisible();
    await expect.poll(() => selected(page).getAttribute("data-sel-i")).not.toBe(first);

    // Empty-canvas click deselects.
    await page.mouse.click(box.x + 120, box.y + 120);
    await expect(selected(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
