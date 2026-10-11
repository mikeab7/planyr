/* NEW-2 (2026-10-11, owner-approved "A · Explained list") — the Measure ▾ menu, the remembered mode
 * and how each mode FINISHES.
 *
 *   • the menu is an explained list: icon · name · one-line hint, the current mode tinted + checked;
 *   • the ▾ pill shows the current mode's ICON (aria-label says it in words);
 *   • pick Area → Select → click the Measure label: Area is armed (the label arms the last mode);
 *   • Polylength finishes with a real DOUBLE-CLICK and with ENTER — one measurement either way, and a
 *     double-click does not leave a stray duplicate vertex behind (the two presses of a double-click are
 *     two clicks, so the second one lands on the first's point);
 *   • Area closes on a double-click, Count commits on a double-click or Enter, Length is two clicks.
 *
 * The hints in Measure ▾ must stay TRUE: they are asserted here against the gestures they describe.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const pill = (p) => p.getByRole("button", { name: /^Measure mode:/ });

function readMeasures(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).map((m) => ({ mode: m.mode, n: (m.pts || []).length, pts: m.pts }));
  });
}

async function start(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
async function pickMode(page, label) {
  await pill(page).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
/* A real double-click: two presses (clickCount 1 then 2) so Chromium synthesises the native dblclick. */
async function dbl(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
}

test.describe("NEW-2 — Measure ▾ is an explained list; Measure remembers its mode", () => {
  test("rows carry an icon, a name and the hint that is true; the current mode is tinted and checked", async ({ page }) => {
    await start(page);
    await pill(page).click();
    const hints = { line: "Two clicks, straight line", polyline: "Click points; double-click or Enter to finish", area: "Click corners; double-click to close", count: "Click each item; double-click or Enter to finish" };
    for (const [k, hint] of Object.entries(hints)) {
      const row = page.getByTestId(`measure-mode-${k}`);
      await expect(row).toBeVisible();
      await expect(row.locator("svg[data-menu-icon]")).toHaveCount(1);
      await expect(row).toContainText(hint);
    }
    // default mode is Length: checked; the others are not.
    await expect(page.getByTestId("measure-mode-line").locator("[data-menu-check]")).toHaveCount(1);
    await expect(page.locator("[data-menu-check]")).toHaveCount(1);
  });

  test("pick Area → arm Select → click Measure: Area is armed, the ▾ shows the Area icon, aria says it in words", async ({ page }) => {
    await start(page);
    await pickMode(page, "Area");
    await expect(pill(page)).toHaveAttribute("aria-label", "Measure mode: Area");
    await expect(pill(page)).toHaveAttribute("data-rail-pill", "value");
    await expect(pill(page).locator("svg[data-menu-icon]")).toHaveCount(1);
    const areaD = await pill(page).locator("svg[data-menu-icon]").innerHTML();
    await page.getByRole("button", { name: /^Select V$/ }).click();
    await expect(page.getByRole("button", { name: /^Measure$/ })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /^Measure$/ }).click();
    await expect(page.getByRole("button", { name: /^Measure$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(pill(page)).toHaveAttribute("aria-label", "Measure mode: Area");
    expect(await pill(page).locator("svg[data-menu-icon]").innerHTML()).toBe(areaD);
    // …and it survives a reload (persisted), arming Area without opening the menu.
    await page.reload();
    await expect(pill(page)).toHaveAttribute("aria-label", "Measure mode: Area");
  });

  test("Length: exactly two clicks", async ({ page }) => {
    await start(page);
    await pickMode(page, "Length");
    const b = await canvas(page).boundingBox();
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.mouse.click(b.x + 500, b.y + 300);
    await expect.poll(() => readMeasures(page)).toEqual([expect.objectContaining({ mode: "line", n: 2 })]);
  });

  test("Polylength finishes with a DOUBLE-CLICK (three points, no stray duplicate) and, separately, with ENTER", async ({ page }) => {
    await start(page);
    await pickMode(page, "Polylength");
    const b = await canvas(page).boundingBox();
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.mouse.click(b.x + 400, b.y + 360);
    await dbl(page, b.x + 520, b.y + 300);
    await expect.poll(() => readMeasures(page).then((m) => m.length)).toBe(1);
    const [m1] = await readMeasures(page);
    expect(m1.mode).toBe("polyline");
    expect(m1.n, "double-click must not leave a duplicate last vertex").toBe(3);

    await page.mouse.click(b.x + 300, b.y + 420);
    await page.mouse.click(b.x + 400, b.y + 470);
    await page.mouse.click(b.x + 520, b.y + 420);
    await page.keyboard.press("Enter");
    await expect.poll(() => readMeasures(page).then((m) => m.length)).toBe(2);
    expect((await readMeasures(page))[1]).toMatchObject({ mode: "polyline", n: 3 });
  });

  test("Area closes on a double-click (three corners, no duplicate)", async ({ page }) => {
    await start(page);
    await pickMode(page, "Area");
    const b = await canvas(page).boundingBox();
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.mouse.click(b.x + 500, b.y + 300);
    await dbl(page, b.x + 500, b.y + 420);
    await expect.poll(() => readMeasures(page).then((m) => m.length)).toBe(1);
    expect((await readMeasures(page))[0]).toMatchObject({ mode: "area", n: 3 });
  });

  test("Count commits on Enter and on a double-click — the double-click counts that spot ONCE", async ({ page }) => {
    await start(page);
    await pickMode(page, "Count");
    const b = await canvas(page).boundingBox();
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.mouse.click(b.x + 380, b.y + 300);
    await page.keyboard.press("Enter");
    await expect.poll(() => readMeasures(page).then((m) => m.length)).toBe(1);
    expect((await readMeasures(page))[0]).toMatchObject({ mode: "count", n: 2 });

    await page.mouse.click(b.x + 300, b.y + 400);
    await dbl(page, b.x + 380, b.y + 400);
    await expect.poll(() => readMeasures(page).then((m) => m.length)).toBe(2);
    expect((await readMeasures(page))[1]).toMatchObject({ mode: "count", n: 2 });
  });
});
