/* Spreadsheet selection — NEW-2 (Ctrl+click multi-range), B2530689, 2026-10-29. (Drag-select edge AUTOSCROLL is
 * B2452528 / e2e/model-drag-autoscroll.spec.js; the one test below only checks the two compose.)
 * Real mouse input only (page.mouse / click({modifiers})) — a synthetic event would not exercise the pointer
 * path the owner uses. Seeds a throwaway local project like model-spreadsheet.spec.js; nothing is written
 * to real data.
 *
 * Run: npx playwright test e2e/model-multirange-selection.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function open(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Selection e2e (throwaway)", name: "ZZ Selection e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
  await page.goto(`/#/project/${id}/model`);
  await expect(sheetEl(page)).toBeVisible();
}

/** The selected cells currently rendered, as "r:c" keys. */
const selected = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="model-sheet"] [data-selected="true"]')].map((n) => `${n.dataset.row}:${n.dataset.col}`));
const maxOf = (keys, i) => Math.max(...keys.map((k) => Number(k.split(":")[i])));
const scrollPos = (page) => sheetEl(page).evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));

// `Control` on Linux/Windows; the app also accepts Meta.
const CTRL = { modifiers: ["Control"] };

test.describe("NEW-2 — Ctrl+click builds a multi-range selection", () => {
  test("Ctrl+click A1, C3, E5 → three separate highlighted ranges; bold applies to all three in one undo step", async ({ page }) => {
    await open(page, "e2e-sel-ctrl");
    for (const [r, c, v] of [[0, 0, "a"], [2, 2, "b"], [4, 4, "c"]]) { await cell(page, r, c).click(); await page.keyboard.type(v); await page.keyboard.press("Enter"); }
    await cell(page, 0, 0).click();
    await cell(page, 2, 2).click(CTRL);
    await cell(page, 4, 4).click(CTRL);
    expect((await selected(page)).sort()).toEqual(["0:0", "2:2", "4:4"]);
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-row", "4"); // the active cell moved to the newest
    await page.getByTestId("ribbon-bold").click();
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) expect(await cell(page, r, c).evaluate((n) => getComputedStyle(n).fontWeight)).toBe("700");
    expect(await cell(page, 1, 1).evaluate((n) => getComputedStyle(n).fontWeight)).not.toBe("700");
    await sheetEl(page).focus();
    await page.keyboard.press("Control+z"); // ONE undo step reverts all three
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) expect(await cell(page, r, c).evaluate((n) => getComputedStyle(n).fontWeight)).not.toBe("700");
  });

  test("Ctrl+click on a selected cell deselects it; a plain click collapses to one range", async ({ page }) => {
    await open(page, "e2e-sel-toggle");
    await cell(page, 0, 0).click();
    await cell(page, 2, 2).click(CTRL);
    await cell(page, 2, 2).click(CTRL); // already selected → out
    expect(await selected(page)).toEqual(["0:0"]);
    await cell(page, 2, 2).click(CTRL);
    await cell(page, 5, 5).click();
    expect(await selected(page)).toEqual(["5:5"]);
  });

  test("Ctrl+drag adds a rectangle, Ctrl+click on a column header adds the whole column, Delete clears every range", async ({ page }) => {
    await open(page, "e2e-sel-ctrl-drag");
    for (const [r, c] of [[0, 0], [1, 0], [0, 3], [1, 3], [2, 5]]) { await cell(page, r, c).click(); await page.keyboard.type("x"); await page.keyboard.press("Enter"); }
    await cell(page, 0, 0).click();
    await page.keyboard.down("Control");
    const a = await cell(page, 0, 3).boundingBox(), b = await cell(page, 1, 3).boundingBox();
    await page.mouse.move(a.x + 8, a.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 8, b.y + 8, { steps: 3 }); await page.mouse.up();
    await page.getByTestId("model-col-header-5").click({ modifiers: ["Control"] });
    await page.keyboard.up("Control");
    const keys = await selected(page);
    expect(keys).toContain("0:0"); expect(keys).toContain("0:3"); expect(keys).toContain("1:3"); expect(keys).toContain("2:5");
    expect(keys).not.toContain("1:0"); // earlier range is its own rectangle, not a bounding box
    await sheetEl(page).focus();
    await page.keyboard.press("Delete");
    for (const [r, c] of [[0, 0], [0, 3], [1, 3], [2, 5]]) await expect(cell(page, r, c)).toHaveText("");
    await expect(cell(page, 1, 0)).toHaveText("x"); // outside the selection: kept
  });

  test("Ctrl+Enter fills the typed value into every selected cell", async ({ page }) => {
    await open(page, "e2e-sel-ctrl-enter");
    await cell(page, 0, 0).click();
    await cell(page, 2, 2).click(CTRL);
    await cell(page, 4, 4).click(CTRL);
    await page.keyboard.type("7");
    await page.keyboard.press("Control+Enter");
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) await expect(cell(page, r, c)).toHaveText("7");
    await expect(cell(page, 1, 1)).toHaveText("");
  });

  test("copy on a multi-range selection says so — never a silent no-op", async ({ page }) => {
    await open(page, "e2e-sel-copy-refuse");
    await cell(page, 0, 0).click();
    await cell(page, 2, 2).click(CTRL);
    await page.keyboard.press("Control+c");
    await expect(page.getByTestId("model-file-notice")).toContainText("multiple selections");
  });

  test("a multi-range selection still highlights after scrolling away and back (virtualised)", async ({ page }) => {
    await open(page, "e2e-sel-virtual");
    await cell(page, 0, 0).click();
    await cell(page, 2, 2).click(CTRL);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 2000; });
    await page.waitForTimeout(150);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(150);
    expect((await selected(page)).sort()).toEqual(["0:0", "2:2"]);
  });
});

test.describe("NEW-2 × B2452528 — a Ctrl+drag rides the shared autoscroll", () => {
  test("Ctrl+drag past the bottom edge, mouse held still, adds a tall range and keeps the earlier cell selected", async ({ page }) => {
    await open(page, "e2e-sel-ctrl-autoscroll");
    await cell(page, 0, 4).click();
    const box = await sheetEl(page).boundingBox();
    const start = await cell(page, 3, 1).boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.move(start.x + 10, start.y + 8); await page.mouse.down();
    await page.mouse.move(start.x + 12, box.y + box.height + 40, { steps: 6 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.keyboard.up("Control");
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    expect(maxOf(await selected(page), 0)).toBeGreaterThan(25);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(200);
    const keys = await selected(page);
    expect(keys).toContain("0:4");   // the earlier cell is still its own range
    expect(keys).toContain("3:1");   // and the Ctrl+drag range starts where it was pressed
    expect(keys).not.toContain("1:4");
  });
});
