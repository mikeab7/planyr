/* Spreadsheet — drag-select AUTOSCROLL (B2452528, NEW-1; owner: "In Excel you click a cell, hold, and drag down to select multiple. In
 * Planyr it only works for cells visible on the screen.").
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31). Univer owns the drag-select session and its autoscroll natively (parity check `autoscroll`
 * in ui-audit/verify-univer-parity.mjs covers the four directions on the standalone host); these tests keep the USER-LEVEL behaviours against
 * the real app: every gesture holds the mouse perfectly STILL at/past an edge after the last move — the regression a pointermove-only
 * driver cannot see — and asserts (a) the grid scrolled and (b) the selection grew beyond what was visible when the drag began.
 * There is no DOM to read: scroll and selection come from Univer's facade (`ws.getScrollState()`, `ws.getVisibleRange()`,
 * `ws.getSelection()`), the mouse is the real one, and a cell's point is computed from Univer's own geometry (a canvas has no nodes to
 * click). NOTE `getCellRect()` is sheet-absolute and does not follow scrolling, so every gesture that starts after a scroll begins from a
 * plain viewport point (the canvas centre) and lets Univer decide which cell that is.
 *
 * RETIRED (2026-10-31) — the old "release stops it" tests asserted `el.scrollTop` of the DOM scroller; the port asserts the same user-level
 * fact (the visible window and the selection stop changing the moment the button is released) from Univer's scroll state.
 *
 * Run: npx playwright test e2e/model-drag-autoscroll.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import {
  openSpreadsheet, cellPoint, canvasBox, columnHeaderPoint, rowHeaderPoint, enter, clickCell, selection, activeCell, value,
  sheetView, scrollGridTo, inSheet, fillHandlePoint,
} from "./lib/univerGrid.js";

const VIEW_W = 1000, VIEW_H = 700;

async function openSheet(page, id) {
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await openSpreadsheet(page, id, { name: "ZZ Drag autoscroll e2e (throwaway)" });
}

/** Where the grid has scrolled to, as one comparable number per axis (rows / columns plus the offset inside the first one). */
const scrollPos = async (page) => {
  const v = await sheetView(page);
  const rh = await inSheet(page, (api, ws) => ws.getRowHeight(0)), cw = await inSheet(page, (api, ws) => ws.getColumnWidth(0));
  return { top: v.top * rh + v.offY, left: v.left * cw + v.offX, v };
};
const sel0 = async (page) => (await selection(page))[0];
/** A point `n` px past the grid's bottom, kept INSIDE the browser viewport (events for a point outside it are not delivered, which would
 *  read as "the app didn't scroll"). Same for the right edge. */
const below = (b, n) => Math.min(b.bottom + n, VIEW_H - 2);
const rightOf = (b, n) => b.right - 150;
const hold = (page, ms) => page.waitForTimeout(ms);
/** The selection's far edge (`r2` / `c2`) is still moving outward while the pointer is held — or it has legitimately reached the sheet's last
 *  row / column (a 26-column sheet runs out of columns within a second at this speed; that is "arrived", not "stalled"). */
async function expectStillGrowing(page, key, prev) {
  const s = await sel0(page);
  const last = await inSheet(page, (api, ws) => ({ r2: ws.getMaxRows() - 1, c2: ws.getMaxColumns() - 1 }));
  expect(s[key] > prev || s[key] === last[key], `${key} was ${prev}, now ${s[key]} (sheet ends at ${last[key]})`).toBe(true);
}
/** The stable picture of the gesture: the visible window and the selection's reach. */
const read = async (page) => { const v = await sheetView(page); const s = await sel0(page); return { ...v, s }; };

// Univer is a heavy canvas app and every step here is a real mouse/keyboard gesture with a settle: allow for it (a loaded CI box is ~3x slower).
test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(120_000); });

test.describe("Spreadsheet — drag-select autoscroll", () => {
  test("known-good arm: a plain drag inside the visible area, and a plain click, select exactly that and never scroll", async ({ page }) => {
    await openSheet(page, "e2e-drag-plain");
    const a = await cellPoint(page, 1, 1), z = await cellPoint(page, 3, 2);
    await page.mouse.move(a.left + 5, a.top + 5);
    await page.mouse.down();
    await page.mouse.move(z.left + 5, z.top + 5, { steps: 5 });
    await page.mouse.up();
    const r = await read(page);
    expect([r.s.r1, r.s.r2, r.s.c1, r.s.c2, r.top, r.left]).toEqual([1, 3, 1, 2, 0, 0]);
    await clickCell(page, 5, 4);
    const one = await sel0(page);
    expect([one.r1, one.r2, one.c1, one.c2]).toEqual([5, 5, 4, 4]);
  });

  test("down: held still below the grid, the grid scrolls and the selection keeps growing", async ({ page }) => {
    await openSheet(page, "e2e-drag-down");
    const b = await canvasBox(page);
    const a = await cellPoint(page, 2, 1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, b.bottom - 30, { steps: 4 }); // inside, still visible
    const inside = await read(page);
    await page.mouse.move(a.x, below(b, 25));                 // past the bottom edge …
    await hold(page, 900);                                    // … and held perfectly still
    const mid = await read(page);
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    expect(mid.s.r2).toBeGreaterThan(inside.s.r2);
    await hold(page, 600);
    const later = await read(page);
    expect(later.s.r2).toBeGreaterThan(mid.s.r2);             // still going while held
    expect((await activeCell(page))[0]).toBe(2);              // the anchor row never moved
    await page.mouse.up();
    const done = await read(page); const donePos = await scrollPos(page);
    await hold(page, 300);
    const settled = await scrollPos(page);                    // release stops it immediately — no runaway
    await hold(page, 600);
    const after = await scrollPos(page); const afterSel = await sel0(page);
    expect(settled.top).toBe(donePos.top);
    expect(after.top).toBe(donePos.top);
    expect(afterSel.r2).toBe(done.s.r2);
  });

  test("the farther past the edge, the faster it scrolls (Excel)", async ({ page }) => {
    await openSheet(page, "e2e-drag-speed");
    const b = await canvasBox(page);
    const a = await cellPoint(page, 0, 0);
    const speed = async (past) => {
      await page.mouse.move(a.left + 20, a.top + 8);
      await page.mouse.down();
      await page.mouse.move(a.left + 20, below(b, past));
      const t0 = (await scrollPos(page)).top;
      await hold(page, 400);
      const t1 = (await scrollPos(page)).top;
      await page.mouse.up();
      await scrollGridTo(page, 0, 0);
      await clickCell(page, 0, 0);
      await hold(page, 250);
      return t1 - t0;
    };
    const slow = await speed(3);
    const fast = await speed(500); // clamped to the viewport's last pixel row
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  test("up: from far down the sheet, held above the grid, scrolls back and extends upward", async ({ page }) => {
    await openSheet(page, "e2e-drag-up");
    await scrollGridTo(page, 250, 0);
    await hold(page, 600);
    const b = await canvasBox(page);
    const sx = b.left + b.w / 2, sy = b.top + b.h / 2;      // a plain viewport point: Univer picks the cell
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const before = await read(page); const beforePos = await scrollPos(page);
    const anchorBefore = (await activeCell(page))[0];
    expect(before.r1, "known-good: the grid really is scrolled far down").toBeGreaterThan(100);
    await page.mouse.move(sx, b.top - 15);                    // above the grid (over the formula bar)
    await hold(page, 900);
    const mid = await read(page); const midPos = await scrollPos(page);
    expect(midPos.top).toBeLessThan(beforePos.top);
    expect(mid.s.r1).toBeLessThan(before.s.r1);
    expect((await activeCell(page))[0]).toBe(anchorBefore);  // anchor stays put
    await page.mouse.up();
  });

  test("right: held past the right edge, the grid scrolls sideways and the selection reaches new columns", async ({ page }) => {
    await openSheet(page, "e2e-drag-right");
    const b = await canvasBox(page);
    const a = await cellPoint(page, 1, 0);
    await page.mouse.move(a.left + 10, a.top + 8);
    await page.mouse.down();
    await page.mouse.move(b.right - 40, a.top + 8, { steps: 4 });
    const inside = await read(page);
    await page.mouse.move(rightOf(b, 6), a.top + 8);
    await hold(page, 900);
    const mid = await read(page);
    expect((await scrollPos(page)).left).toBeGreaterThan(0);
    expect(mid.s.c2).toBeGreaterThan(inside.s.c2);
    // …and it keeps going while the pointer sits still past the edge (a one-off scroll-into-view of a half-visible column would stop here)
    await hold(page, 600);
    await expectStillGrowing(page, "c2", mid.s.c2);
    expect((await activeCell(page))[1]).toBe(0);
    await page.mouse.up();
  });

  test("left: scrolls back toward the first column", async ({ page }) => {
    await openSheet(page, "e2e-drag-left");
    await scrollGridTo(page, 0, 30);
    await hold(page, 600);
    const b = await canvasBox(page);
    const cx = b.left + b.w * 0.6, cy = b.top + 100;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(b.left + 120, cy, { steps: 4 });
    await page.mouse.move(b.left + 25, cy);                   // over the row header strip
    const startPos = (await scrollPos(page)).left;
    await hold(page, 900);
    const mid = await read(page);
    expect((await scrollPos(page)).left).toBeLessThan(startPos);
    expect(mid.s.c1).toBeLessThan((await activeCell(page))[1]); // reached left of the anchor
    await page.mouse.up();
  });

  test("diagonal: both axes scroll at once from one still pointer", async ({ page }) => {
    await openSheet(page, "e2e-drag-diag");
    const b = await canvasBox(page);
    const a = await cellPoint(page, 0, 0);
    await page.mouse.move(a.left + 10, a.top + 8);
    await page.mouse.down();
    await page.mouse.move(rightOf(b, 6), below(b, 25), { steps: 6 });
    await hold(page, 900);
    const mid = await read(page); const pos = await scrollPos(page);
    expect(pos.top).toBeGreaterThan(0);
    expect(pos.left).toBeGreaterThan(0);
    expect(mid.s.r2).toBeGreaterThan(15);
    expect(mid.s.c2).toBeGreaterThan(5);
    await hold(page, 600);
    const later = await sel0(page);
    await expectStillGrowing(page, "r2", mid.s.r2);
    await expectStillGrowing(page, "c2", mid.s.c2);
    void later;
    await page.mouse.up();
  });

  test("releasing OUTSIDE the grid ends the drag and the selection holds", async ({ page }) => {
    await openSheet(page, "e2e-drag-outside");
    const b = await canvasBox(page);
    const a = await cellPoint(page, 0, 0);
    await page.mouse.move(a.left + 10, a.top + 8);
    await page.mouse.down();
    await page.mouse.move(a.left + 10, below(b, 60));
    await hold(page, 500);
    await page.mouse.up(); // released over the tab strip — outside the grid entirely
    const done = await sel0(page); const donePos = await scrollPos(page);
    expect(done.r2).toBeGreaterThan(5);
    await hold(page, 300);
    const settled = await scrollPos(page); const settledSel = await sel0(page);
    await hold(page, 600);
    const after = await scrollPos(page); const afterSel = await sel0(page);
    expect(settled.top).toBe(donePos.top);
    expect(after.top).toBe(donePos.top);
    expect(afterSel.r2).toBe(settledSel.r2);
    // and a later plain move (no button) must not resurrect the drag
    await page.mouse.move(a.left + 30, a.top + 200);
    await hold(page, 200);
    await page.mouse.move(a.left + 30, below(b, 20));
    await hold(page, 400);
    const later = await scrollPos(page); const laterSel = await sel0(page);
    expect(later.top).toBe(donePos.top);
    expect(laterSel.r2).toBe(settledSel.r2);
  });

  test("column-header drag past the right edge selects more columns", async ({ page }) => {
    await openSheet(page, "e2e-drag-colhdr");
    const b = await canvasBox(page);
    const h = await columnHeaderPoint(page, 1);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(rightOf(b, 6), h.y, { steps: 4 });
    await hold(page, 900);
    const mid = await read(page);
    expect((await scrollPos(page)).left).toBeGreaterThan(0);
    expect(mid.s.c2).toBeGreaterThan(6);
    await hold(page, 600);
    await expectStillGrowing(page, "c2", mid.s.c2);
    expect(mid.s.c1).toBe(1);
    expect(mid.s.r1, "a column-header drag selects whole columns").toBe(0);
    await page.mouse.up();
  });

  test("row-header drag past the bottom edge selects more rows", async ({ page }) => {
    await openSheet(page, "e2e-drag-rowhdr");
    const b = await canvasBox(page);
    const h = await rowHeaderPoint(page, 2);
    await page.mouse.move(h.x, h.y - 2);
    await page.mouse.down();
    await page.mouse.move(h.x, below(b, 25), { steps: 4 });
    await hold(page, 900);
    const mid = await read(page);
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    expect(mid.s.r2).toBeGreaterThan(20);
    expect(mid.s.r1).toBe(2);
    const cols = await inSheet(page, (api, ws) => ws.getMaxColumns());
    expect(mid.s.c1).toBe(0);
    expect(mid.s.c2, "a row-header drag selects whole rows").toBe(cols - 1);
    await page.mouse.up();
  });

  test("fill handle dragged past the bottom edge keeps filling further down", async ({ page }) => {
    await openSheet(page, "e2e-drag-fill");
    await enter(page, 0, 0, "7");
    await clickCell(page, 0, 0);
    const b = await canvasBox(page);
    const v0 = await sheetView(page);
    const hnd = await fillHandlePoint(page, 0, 0);
    await page.mouse.move(hnd.x, hnd.y); await hold(page, 250);   // a person hovers before pressing; Univer arms its fill cursor on hover
    await page.mouse.down();
    await page.mouse.move(hnd.x, hnd.y + 40, { steps: 4 });
    await page.mouse.move(hnd.x, below(b, 25), { steps: 4 });
    await hold(page, 1100);
    await page.mouse.up();
    await hold(page, 400);
    expect((await scrollPos(page)).top, "the grid scrolled while the handle was held past the edge").toBeGreaterThan(0);
    // a row well past the first screenful got the filled value
    const probe = v0.r2 + 2;
    expect(await value(page, probe, 0), `A${probe + 1} (beyond the first screenful) was filled`).toBe(7);
  });

  test("Shift+Arrow past the bottom keeps the moving end in view", async ({ page }) => {
    await openSheet(page, "e2e-drag-shift");
    await clickCell(page, 0, 0);
    for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowDown");
    await hold(page, 300);
    const s = await read(page);
    expect(s.s.r2).toBe(40);
    expect((await scrollPos(page)).top).toBeGreaterThan(0);
    expect(s.r1 <= 40 && 40 <= s.r2, `the moving end (row 41) is on screen: rows ${s.r1}-${s.r2}`).toBe(true);
  });
});
