/* Spreadsheet selection — NEW-1 (drag-select edge AUTOSCROLL) and NEW-2 (Ctrl+click multi-range), 2026-10-29.
 * Real mouse input only (page.mouse / click({modifiers})) — a synthetic event would not exercise the pointer
 * path the owner uses. Seeds a throwaway local project like model-spreadsheet.spec.js; nothing is written
 * to real data.
 *
 * Run: npx playwright test e2e/model-selection-drag-ctrl.spec.js
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

test.describe("NEW-1 — drag-select autoscrolls like Excel", () => {
  test("holding the mouse still below the grid keeps scrolling and extending the selection; release stops it", async ({ page }) => {
    await open(page, "e2e-sel-drag-down");
    const box = await sheetEl(page).boundingBox();
    const initialMax = maxOf(await (async () => { await cell(page, 0, 0).click(); await page.keyboard.press("Shift+ArrowDown"); return selected(page); })(), 0);
    await cell(page, 2, 1).click();
    const start = await cell(page, 2, 1).boundingBox();
    await page.mouse.move(start.x + 10, start.y + 8);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, box.y + box.height - 20, { steps: 6 }); // down to near the bottom edge
    await page.mouse.move(start.x + 12, box.y + box.height + 40);               // past it, then HOLD STILL
    await page.waitForTimeout(500);
    const a = await scrollPos(page);
    await page.waitForTimeout(500);
    const b = await scrollPos(page);
    expect(a.top, "the grid scrolled with the mouse held still").toBeGreaterThan(0);
    expect(b.top, "…and kept scrolling").toBeGreaterThan(a.top);
    const keys = await selected(page);
    expect(maxOf(keys, 0), "selection grew beyond what was visible when the drag began").toBeGreaterThan(initialMax + 5);
    await page.mouse.up();
    const c = await scrollPos(page);
    await page.waitForTimeout(400);
    const d = await scrollPos(page);
    expect(d.top, "releasing stops the scroll immediately").toBe(c.top);
    // The selection holds after release.
    expect(maxOf(await selected(page), 0)).toBeGreaterThan(initialMax + 5);
  });

  test("right edge, then back up and left; a diagonal scrolls both axes", async ({ page }) => {
    await open(page, "e2e-sel-drag-right");
    const box = await sheetEl(page).boundingBox();
    const start = await cell(page, 1, 1).boundingBox();
    await page.mouse.move(start.x + 10, start.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, start.y + 8, { steps: 8 });
    await page.waitForTimeout(700);
    let p = await scrollPos(page);
    expect(p.left, "scrolled right with the pointer held at the right edge").toBeGreaterThan(0);
    expect(maxOf(await selected(page), 1), "selection extended into columns that were off-screen").toBeGreaterThan(8);
    // Diagonal: bottom-right corner scrolls both axes.
    await page.mouse.move(box.x + box.width - 1, box.y + box.height + 30);
    await page.waitForTimeout(600);
    p = await scrollPos(page);
    expect(p.top).toBeGreaterThan(0);
    expect(p.left).toBeGreaterThan(0);
    // Back up and left (over the header band / gutter) scrolls the other way.
    const before = p;
    await page.mouse.move(box.x + 6, box.y + 4);
    await page.waitForTimeout(600);
    p = await scrollPos(page);
    expect(p.top).toBeLessThan(before.top);
    expect(p.left).toBeLessThan(before.left);
    await page.mouse.up();
  });

  test("a column-header drag and a row-header drag autoscroll too", async ({ page }) => {
    await open(page, "e2e-sel-drag-headers");
    const box = await sheetEl(page).boundingBox();
    const h = await page.getByTestId("model-col-header-2").boundingBox();
    await page.mouse.move(h.x + 20, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, h.y + h.height / 2, { steps: 8 });
    await page.waitForTimeout(700);
    expect((await scrollPos(page)).left).toBeGreaterThan(0);
    await page.mouse.up();
    const cols = (await selected(page)).map((k) => Number(k.split(":")[1]));
    expect(Math.max(...cols)).toBeGreaterThan(9);

    const rh = await page.getByTestId("model-row-header-1").boundingBox();
    await page.mouse.move(rh.x + 10, rh.y + rh.height / 2);
    await page.mouse.down();
    await page.mouse.move(rh.x + 10, box.y + box.height + 40, { steps: 8 });
    await page.waitForTimeout(700);
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    await page.mouse.up();
  });

  test("releasing the button OUTSIDE the browser window ends the drag and the selection holds", async ({ page }) => {
    await open(page, "e2e-sel-drag-outside");
    const start = await cell(page, 2, 1).boundingBox();
    const vp = page.viewportSize();
    await page.mouse.move(start.x + 10, start.y + 8);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, vp.height - 30, { steps: 6 });
    await page.mouse.move(start.x + 12, vp.height + 60); // out of the window entirely, button still held
    await page.waitForTimeout(500);
    const during = await scrollPos(page);
    expect(during.top).toBeGreaterThan(0);
    await page.mouse.up();                                // released outside the window
    const held = maxOf(await selected(page), 0);
    const a = await scrollPos(page);
    await page.waitForTimeout(400);
    const b = await scrollPos(page);
    expect(b.top, "no runaway scroll after the release").toBe(a.top);
    expect(held, "the selection holds").toBeGreaterThan(20);
  });

  test("with frozen panes the anchor stays put while the scrolling pane autoscrolls", async ({ page }) => {
    await open(page, "e2e-sel-drag-frozen");
    await cell(page, 1, 0).click({ button: "right" });
    await page.getByText("Freeze panes", { exact: true }).click();
    const box = await sheetEl(page).boundingBox();
    const start = await cell(page, 5, 2).boundingBox();
    await page.mouse.move(start.x + 10, start.y + 8);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, box.y + box.height + 40, { steps: 6 });
    await page.waitForTimeout(700);
    await page.mouse.up();
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    expect(maxOf(await selected(page), 0)).toBeGreaterThan(25);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });   // back to the top: the anchor row is rendered again
    await page.waitForTimeout(200);
    const keys = await selected(page);
    expect(keys).toContain("5:2");                 // the anchor is still the first selected cell…
    expect(keys.some((k) => Number(k.split(":")[0]) < 5)).toBe(false); // …and nothing above it joined
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-row", "5");
  });

  test("Shift+Arrow past the bottom of the screen scrolls to follow the selection's moving end", async ({ page }) => {
    await open(page, "e2e-sel-shift-arrow");
    await cell(page, 0, 0).click();
    for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowDown");
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
  });

  test("plain click, typing, and column resize still behave", async ({ page }) => {
    await open(page, "e2e-sel-regress");
    await cell(page, 0, 0).click();
    await page.keyboard.type("hello"); await page.keyboard.press("Enter");
    await expect(cell(page, 0, 0)).toHaveText("hello");
    await cell(page, 3, 3).click();
    expect(await selected(page)).toEqual(["3:3"]);
    const hd = await page.getByTestId("model-col-header-1").boundingBox();
    const w0 = hd.width;
    await page.mouse.move(hd.x + hd.width - 1, hd.y + hd.height / 2);
    await page.mouse.down(); await page.mouse.move(hd.x + hd.width + 40, hd.y + hd.height / 2, { steps: 4 }); await page.mouse.up();
    expect((await page.getByTestId("model-col-header-1").boundingBox()).width).toBeGreaterThan(w0 + 20);
    await cell(page, 0, 0).dblclick();
    await expect(page.locator('[data-testid="model-sheet"] input')).toBeVisible(); // double-click still edits
  });
});

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
