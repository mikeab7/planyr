/* Spreadsheet — drag-select AUTOSCROLL (B2452528, NEW-1; owner: "In Excel you click a cell, hold,
 * and drag down to select multiple. In Planyr it only works for cells visible on the screen.").
 *
 * Every gesture here holds the mouse perfectly STILL at/past an edge after the last move — the
 * regression a pointermove-only driver cannot see — and asserts (a) the grid scrolled and (b) the
 * selection grew beyond what was visible when the drag began. Rows are virtualised, so the
 * selection's reach is read from the rendered `data-selected` cells (the ones near the viewport)
 * plus the scroll offset, never from a count of rendered nodes.
 *
 * Run: npx playwright test e2e/model-drag-autoscroll.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function openSheet(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Drag autoscroll e2e (throwaway)", name: "ZZ Drag autoscroll e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
  await page.setViewportSize({ width: 900, height: VIEW_H });
  await page.goto(`/#/project/${id}/model`);
  await expect(sheetEl(page)).toBeVisible();
  await expect(cell(page, 0, 0)).toBeVisible();
}

/** Scroll offsets + the extent of the RENDERED selected cells. */
const read = (page) => sheetEl(page).evaluate((el) => {
  const sel = [...el.querySelectorAll('[data-selected="true"]')];
  const rows = sel.map((n) => +n.dataset.row), cols = sel.map((n) => +n.dataset.col);
  return {
    top: el.scrollTop, left: el.scrollLeft,
    minRow: rows.length ? Math.min(...rows) : null, maxRow: rows.length ? Math.max(...rows) : null,
    minCol: cols.length ? Math.min(...cols) : null, maxCol: cols.length ? Math.max(...cols) : null,
  };
});
/** The ANCHOR (active cell) — the Name Box shows its address, which stays readable when the anchor's
 *  own row has scrolled out of the virtualised render window. */
const anchorOf = async (page) => {
  const v = await page.getByTestId("model-name-box").inputValue();
  const m = /^([A-Z]+)(\d+)$/.exec(v.trim());
  const col = [...m[1]].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return { row: +m[2] - 1, col };
};
const box = (page) => sheetEl(page).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.left + el.clientWidth, bottom: r.top + el.clientHeight, w: r.width, h: r.height };
});
/** A point `n` px past the grid's bottom, kept INSIDE the browser viewport (events for a point outside
 *  it are not delivered, which would read as "the app didn't scroll"). */
const VIEW_H = 640;
const below = (b, n) => Math.min(b.bottom + n, VIEW_H - 2);
const hold = (page, ms) => page.evaluate((t) => new Promise((res) => setTimeout(res, t)), ms);

test.describe("Spreadsheet — drag-select autoscroll", () => {
  test("down: held still below the grid, the grid scrolls and the selection keeps growing", async ({ page }) => {
    await openSheet(page, "e2e-drag-down");
    const b = await box(page);
    const a = await cell(page, 2, 1).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, b.bottom - 30, { steps: 4 }); // inside, still visible
    const inside = await read(page);
    await page.mouse.move(a.x + a.width / 2, below(b, 25)); // past the bottom edge …
    await hold(page, 900);                                    // … and held perfectly still
    const mid = await read(page);
    expect(mid.top).toBeGreaterThan(0);
    expect(mid.maxRow).toBeGreaterThan(inside.maxRow);
    await hold(page, 600);
    const later = await read(page);
    expect(later.maxRow).toBeGreaterThan(mid.maxRow); // still going while held
    expect((await anchorOf(page)).row).toBe(2);       // the anchor row never moved
    await page.mouse.up();
    const done = await read(page);
    await hold(page, 500);
    const after = await read(page);
    expect(after.top).toBe(done.top);                 // release stops it immediately — no runaway
    expect(after.maxRow).toBe(done.maxRow);
  });

  test("the farther past the edge, the faster it scrolls", async ({ page }) => {
    await openSheet(page, "e2e-drag-speed");
    const b = await box(page);
    const a = await cell(page, 0, 0).boundingBox();
    const speed = async (past) => {
      await page.mouse.move(a.x + 20, a.y + 8);
      await page.mouse.down();
      await page.mouse.move(a.x + 20, below(b, past));
      const t0 = (await read(page)).top;
      await hold(page, 400);
      const t1 = (await read(page)).top;
      await page.mouse.up();
      await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });
      await hold(page, 250); // let the virtualised rows re-render at the top before the next press
      return t1 - t0;
    };
    const slow = await speed(3);
    const fast = await speed(500); // clamped to the viewport's last pixel row
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  test("up: from far down the sheet, held above the grid, scrolls back and extends upward", async ({ page }) => {
    await openSheet(page, "e2e-drag-up");
    await sheetEl(page).evaluate((el) => { el.scrollTop = 6000; });
    const b = await box(page);
    const a = await page.locator('[data-col="1"]').nth(8).boundingBox(); // some visible cell
    const anchorRow = +(await page.locator('[data-col="1"]').nth(8).getAttribute("data-row"));
    const anchorBefore = anchorRow;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const before = await read(page);
    await page.mouse.move(a.x + a.width / 2, b.top - 15); // above the grid (over the formula bar)
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.top).toBeLessThan(before.top);
    expect(mid.minRow).toBeLessThan(before.minRow);
    expect((await anchorOf(page)).row).toBe(anchorBefore); // anchor stays put
    await page.mouse.up();
  });

  test("right: held past the right edge, the grid scrolls sideways and the selection reaches new columns", async ({ page }) => {
    await openSheet(page, "e2e-drag-right");
    const b = await box(page);
    const a = await cell(page, 1, 0).boundingBox();
    await page.mouse.move(a.x + 10, a.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.right - 40, a.y + 8, { steps: 4 });
    const inside = await read(page);
    await page.mouse.move(b.right + 6, a.y + 8);
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.left).toBeGreaterThan(0);
    expect(mid.maxCol).toBeGreaterThan(inside.maxCol);
    expect((await anchorOf(page)).col).toBe(0);
    await page.mouse.up();
  });

  test("left: scrolls back toward the first column", async ({ page }) => {
    await openSheet(page, "e2e-drag-left");
    await sheetEl(page).evaluate((el) => { el.scrollLeft = 900; });
    const b = await box(page);
    // a cell that is actually on screen after the scroll, near the right side
    const a = await sheetEl(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cand = [...el.querySelectorAll('[data-row="1"][data-col]')].map((n) => ({ c: +n.dataset.col, b: n.getBoundingClientRect() }))
        .filter((o) => o.b.left > r.left + 300 && o.b.right < r.left + el.clientWidth - 20);
      const o = cand[cand.length - 1];
      return { x: o.b.left + 6, y: o.b.top + 8 };
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.left + 120, a.y, { steps: 4 });
    await page.mouse.move(b.left + 2, a.y);
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.left).toBeLessThan(900);
    expect(mid.minCol).toBeLessThan((await anchorOf(page)).col); // reached left of the anchor
    await page.mouse.up();
  });

  test("diagonal: both axes scroll at once from one still pointer", async ({ page }) => {
    await openSheet(page, "e2e-drag-diag");
    const b = await box(page);
    const a = await cell(page, 0, 0).boundingBox();
    await page.mouse.move(a.x + 10, a.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.right + 6, below(b, 25), { steps: 6 });
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.top).toBeGreaterThan(0);
    expect(mid.left).toBeGreaterThan(0);
    expect(mid.maxRow).toBeGreaterThan(15);
    expect(mid.maxCol).toBeGreaterThan(5);
    await page.mouse.up();
  });

  test("releasing OUTSIDE the grid ends the drag and the selection holds", async ({ page }) => {
    await openSheet(page, "e2e-drag-outside");
    const b = await box(page);
    const a = await cell(page, 0, 0).boundingBox();
    await page.mouse.move(a.x + 10, a.y + 8);
    await page.mouse.down();
    await page.mouse.move(a.x + 10, below(b, 60));
    await hold(page, 500);
    await page.mouse.up(); // released over the tab strip — outside the grid element entirely
    const done = await read(page);
    expect(done.maxRow).toBeGreaterThan(5);
    await hold(page, 500);
    const after = await read(page);
    expect(after.top).toBe(done.top);
    expect(after.maxRow).toBe(done.maxRow);
    // and a later plain move (no button) must not resurrect the drag
    await page.mouse.move(a.x + 30, a.y + 200);
    await hold(page, 200);
    expect((await read(page)).maxRow).toBe(done.maxRow);
  });

  test("column-header drag past the right edge selects more columns", async ({ page }) => {
    await openSheet(page, "e2e-drag-colhdr");
    const b = await box(page);
    const h = await page.getByTestId("model-col-header-1").boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.right + 6, h.y + h.height / 2, { steps: 4 });
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.left).toBeGreaterThan(0);
    expect(mid.maxCol).toBeGreaterThan(6);
    expect((await anchorOf(page)).col).toBe(1);
    await page.mouse.up();
  });

  test("row-header drag past the bottom edge selects more rows", async ({ page }) => {
    await openSheet(page, "e2e-drag-rowhdr");
    const b = await box(page);
    const h = await page.getByTestId("model-row-header-2").boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, below(b, 25), { steps: 4 });
    await hold(page, 900);
    const mid = await read(page);
    expect(mid.top).toBeGreaterThan(0);
    expect(mid.maxRow).toBeGreaterThan(20);
    expect((await anchorOf(page)).row).toBe(2);
    expect(mid.minCol).toBe(0);
    expect(mid.maxCol).toBe(25);
    await page.mouse.up();
  });

  test("fill handle dragged past the bottom edge keeps filling further down", async ({ page }) => {
    await openSheet(page, "e2e-drag-fill");
    await cell(page, 0, 0).click();
    await page.keyboard.type("7");
    await page.keyboard.press("Enter");
    await cell(page, 0, 0).click();
    const b = await box(page);
    const hnd = page.getByTestId("model-fill-handle");
    const hb = await hnd.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, below(b, 25), { steps: 4 });
    await hold(page, 900);
    await page.mouse.up();
    await expect.poll(async () => (await read(page)).top).toBeGreaterThan(0);
    // a row well past the first screenful got the filled value
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });
    await expect(cell(page, 14, 0)).toHaveText("7");
  });

  test("Shift+Arrow past the bottom keeps the moving end in view", async ({ page }) => {
    await openSheet(page, "e2e-drag-shift");
    await cell(page, 0, 0).click();
    for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowDown");
    const s = await read(page);
    expect(s.top).toBeGreaterThan(0);
    expect(s.maxRow).toBe(40);
  });

  test("regressions: a plain drag inside the visible area, and a plain click, still select exactly that", async ({ page }) => {
    await openSheet(page, "e2e-drag-plain");
    const a = await cell(page, 1, 1).boundingBox();
    const z = await cell(page, 3, 2).boundingBox();
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(z.x + 5, z.y + 5, { steps: 5 });
    await page.mouse.up();
    const r = await read(page);
    expect([r.minRow, r.maxRow, r.minCol, r.maxCol, r.top, r.left]).toEqual([1, 3, 1, 2, 0, 0]);
    await cell(page, 5, 4).click();
    const one = await read(page);
    expect([one.minRow, one.maxRow, one.minCol, one.maxCol]).toEqual([5, 5, 4, 4]);
  });
});
