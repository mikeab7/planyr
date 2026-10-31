/* Spreadsheet selection — NEW-2 (Ctrl+click multi-range), B2530689, 2026-10-29. (Drag-select edge AUTOSCROLL is B2452528 /
 * e2e/model-drag-autoscroll.spec.js; the last test below only checks the two compose.)
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31): the grid is a canvas, so the selection is READ from Univer's facade
 * (`ws.getSelection().getActiveRangeList()`, one entry per range) and cell formatting from `getCellStyle()`; every gesture is the REAL
 * mouse / keyboard at a point computed from Univer's cell geometry (e2e/lib/univerGrid.js). Seeds a throwaway local project; nothing is
 * written to real data. Excel for Windows is the spec where Univer differs from the old grid.
 *
 * RETIRED (2026-10-31) — nothing: each old test has a port. The old "highlighted cells in the DOM" assertions are now "the selection list
 * holds exactly these ranges" plus, for the virtualisation test, a PAINTED-pixel check that the highlight is still drawn.
 *
 * Run: npx playwright test e2e/model-multirange-selection.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import {
  openSpreadsheet, cellPoint, canvasBox, columnHeaderPoint, enter, clickCell, modClickCell, press, selection, activeCell, styleOf, value,
  expectValue, clickUniverCommand, scrollGridTo, cellShot, sheetView,
} from "./lib/univerGrid.js";
import { createHash } from "node:crypto";

const open = (page, id) => openSpreadsheet(page, id, { name: "ZZ Selection e2e (throwaway)" });
const a1s = async (page) => (await selection(page)).map((s) => s.a1);
const hash = (b) => createHash("sha1").update(b).digest("hex");
const BOLD = "sheet.command.set-range-bold";
const CTRL = "Control";
const isBold = async (page, r, c) => (await styleOf(page, r, c)).bold;

// Univer is a heavy canvas app and every step here is a real mouse/keyboard gesture with a settle: allow for it (a loaded CI box is ~3x slower).
test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(120_000); });

test.describe("NEW-2 — Ctrl+click builds a multi-range selection", () => {
  test("known-good arm: a plain click selects one cell, and Ctrl+click on an empty cell adds a SEPARATE range", async ({ page }) => {
    await open(page, "e2e-sel-known");
    await clickCell(page, 0, 0);
    expect(await a1s(page)).toEqual(["A1"]);
    await modClickCell(page, 2, 2, CTRL);
    expect(await a1s(page)).toEqual(["A1", "C3"]);
  });

  test("Ctrl+click A1, C3, E5 → three separate ranges; bold applies to all three in one undo step", async ({ page }) => {
    await open(page, "e2e-sel-ctrl");
    for (const [r, c, v] of [[0, 0, "a"], [2, 2, "b"], [4, 4, "c"]]) await enter(page, r, c, v);
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 2, CTRL);
    await modClickCell(page, 4, 4, CTRL);
    expect(await a1s(page)).toEqual(["A1", "C3", "E5"]);
    expect(await activeCell(page), "the active cell moved to the newest").toEqual([4, 4]);
    await clickUniverCommand(page, BOLD);
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) expect(await isBold(page, r, c), `(${r},${c}) bold`).toBe(true);
    expect(await isBold(page, 1, 1), "an unselected cell stays regular").toBe(false);
    await clickCell(page, 4, 4);                             // hand the keyboard back to the grid (undo does not need the selection)
    await press(page, "Control+z");                          // ONE undo step reverts all three
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) expect(await isBold(page, r, c), `(${r},${c}) after undo`).toBe(false);
  });

  test("Ctrl+click on a selected cell; a plain click collapses to one range", async ({ page }) => {
    await open(page, "e2e-sel-toggle");
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 2, CTRL);
    expect(await a1s(page)).toEqual(["A1", "C3"]);
    await modClickCell(page, 2, 2, CTRL); // already selected → out (Excel 365 and the old grid both take the cell out of the selection)
    expect(await a1s(page)).toEqual(["A1"]);
    await modClickCell(page, 2, 2, CTRL);
    await clickCell(page, 5, 5);
    expect(await a1s(page)).toEqual(["F6"]);
  });

  test("Ctrl+drag adds a rectangle, Ctrl+click on a column header adds the whole column, Delete clears every range", async ({ page }) => {
    await open(page, "e2e-sel-ctrl-drag");
    for (const [r, c] of [[0, 0], [1, 0], [0, 3], [1, 3], [2, 5]]) await enter(page, r, c, "x");
    await clickCell(page, 0, 0);
    await page.keyboard.down(CTRL);
    const a = await cellPoint(page, 0, 3), b = await cellPoint(page, 1, 3);
    await page.mouse.move(a.left + 8, a.top + 8); await page.mouse.down(); await page.mouse.move(b.left + 8, b.top + 8, { steps: 3 }); await page.mouse.up();
    const h = await columnHeaderPoint(page, 5);
    await page.mouse.click(h.x, h.y);
    await page.keyboard.up(CTRL);
    await page.waitForTimeout(200);
    expect(await a1s(page), "the earlier cell stays its own range, the drag is a rectangle, the header adds the whole column").toEqual(["A1", "D1:D2", "F:F"]);
    await press(page, "Delete");
    for (const [r, c] of [[0, 0], [0, 3], [1, 3], [2, 5]]) expect(await value(page, r, c), `(${r},${c}) cleared`).toBeNull();
    expect(await value(page, 1, 0), "outside the selection: kept").toBe("x");
  });

  test("Ctrl+Enter fills the typed value into every selected cell", async ({ page }) => {
    await open(page, "e2e-sel-ctrl-enter");
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 2, CTRL);
    await modClickCell(page, 4, 4, CTRL);
    await page.keyboard.type("7", { delay: 8 });
    await press(page, "Control+Enter");
    for (const [r, c] of [[0, 0], [2, 2], [4, 4]]) await expectValue(page, r, c, 7, `(${r},${c}) filled`);
    expect(await value(page, 1, 1)).toBeNull();
  });

  test("copy on a multi-range selection says so — never a silent no-op", async ({ page }) => {
    await open(page, "e2e-sel-copy-refuse");
    await enter(page, 0, 0, "a");
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 2, CTRL);
    await press(page, "Control+c");
    await expect(page.getByTestId("model-file-notice")).toContainText("multiple selections");
  });

  test("a multi-range selection still highlights after scrolling away and back (virtualised)", async ({ page }) => {
    await open(page, "e2e-sel-virtual");
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 2, CTRL);
    // known-good: a selected cell is painted differently from an unselected one (the instrument sees the highlight)
    const sel = hash((await cellShot(page, 2, 2)).buf), plain = hash((await cellShot(page, 4, 4)).buf);
    expect(sel, "the highlight is visible in the pixels").not.toEqual(plain);
    await scrollGridTo(page, 400, 0);
    await page.waitForTimeout(300);
    await scrollGridTo(page, 0, 0);
    await page.waitForTimeout(400);
    expect(await a1s(page)).toEqual(["A1", "C3"]);
    expect(hash((await cellShot(page, 2, 2)).buf), "C3 is painted selected again after the round trip").toEqual(sel);
  });
});

test.describe("NEW-2 × B2452528 — a Ctrl+drag rides the shared autoscroll", () => {
  test("Ctrl+drag past the bottom edge, mouse held still, adds a tall range and keeps the earlier cell selected", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, "e2e-sel-ctrl-autoscroll");
    await clickCell(page, 0, 4);
    const box = await canvasBox(page);
    const start = await cellPoint(page, 3, 1);
    await page.keyboard.down(CTRL);
    await page.mouse.move(start.left + 10, start.top + 8); await page.mouse.down();
    await page.mouse.move(start.left + 12, Math.min(box.bottom + 40, 698), { steps: 6 });
    await page.waitForTimeout(900);
    const mid = await selection(page);
    await page.mouse.up();
    await page.keyboard.up(CTRL);
    const v = await sheetView(page);
    expect(v.top, "the grid scrolled").toBeGreaterThan(0);
    const after = await selection(page);
    expect(after.length, "two ranges").toBe(2);
    expect(after[0].a1, "the earlier cell is still its own range").toBe("E1");
    expect(after[1].r1, "the Ctrl+drag range starts where it was pressed").toBe(3);
    expect(after[1].c1).toBe(1);
    expect(after[1].r2, "…and reaches well past the first screenful").toBeGreaterThan(25);
    expect(mid[1] && mid[1].r2, "it was still growing while held").toBeGreaterThan(20);
  });
});
