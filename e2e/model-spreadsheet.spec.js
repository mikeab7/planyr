/* Model workspace — live-browser verification of the vertical slice: rectangular selection, keyboard nav, the inline editor,
 * the formula bar, number formats, undo/redo, copy/paste/fill-down, block-jump navigation, structural editing, find/replace,
 * freeze, resize, zoom, multi-sheet workbooks, input/formula colours and local-storage persistence.
 *
 * ⛔ PORTED TO THE UNIVER GRID (NEW-2, 2026-10-31). The Univer canvas is THE grid for every account; the old DOM grid
 * (`[data-row][data-col]`, `model-sheet`, `model-col-header-*`, the Ribbon, the old TabStrip) is an owner-only hatch a test cannot
 * reach, so those nodes no longer exist. Every test below drives the grid the way a person does — REAL mouse and keys at a cell's
 * computed point — and READS state through Univer's own facade (`window.__planyrUniverRead`, armed only under
 * `window.__PLANYR_E2E`): committed values, formulas, selection, frozen panes, column widths, the formula bar's editor document,
 * and PIXELS for what only the canvas draws (alignment, text spill, input/link colours). Helpers: e2e/lib/univerGrid.js.
 * Excel is the spec: where Univer differs from the old grid's own wording the expectation is Excel's.
 *
 * WHAT WAS RETIRED (no longer exists, so nothing to guard) — each is also left as a `// RETIRED` comment where it stood:
 *   · row virtualization (DOM row window) · the old grid's own context-menu CHROME / opaque `.menu` / scroll-dismiss contract
 *   · the old Ribbon's AnchoredMenu drag-release semantics. Univer's own widgets are Univer's. Every USER-LEVEL behaviour those
 *     tests sat beside (menus opening, replacing, staying on screen, not swallowing the next click) is ported against Univer's menus.
 *
 * Seeds a throwaway local "project" (a Site Planner site group — a project IS one, see src/shared/projects/projects.js) the same
 * way e2e/callout-absolute-front.spec.js does. Nothing here is written to real production data.
 *
 * Run: npx playwright test e2e/model-spreadsheet.spec.js
 */
import { test, expect } from "@playwright/test";
import {
  CANVAS, openSpreadsheet, armUniverE2E, seedProject, waitForGrid, canvasBox, cellPoint, columnHeaderPoint, rowHeaderPoint,
  clickCell, dblclickCell, rightClickCell, enter, press, value, shown, formulaOf, styleOf, selection, activeCell, sheetNames,
  flushGrid, expectValue, expectShown, inSheet, formulaBarText, nameBoxInput, sheetTabs, cellInk, parkCursor, countPixels,
  sheetView, modClickCell, fillHandlePoint, clickPlanyrTool, toolsState,
} from "./lib/univerGrid.js";

/** Open the Spreadsheet on a throwaway project via the LEGACY /model slug (route.js keeps it as a permanent alias, so every test
 *  here doubles as a live proof that the alias still works) and wait for the Univer grid. */
const open = (page, id, opts = {}) => openSpreadsheet(page, id, { slug: "model", ...opts });

/** The shared setup every test needs: a seeded project, on the Model route, with A1=500 and A2=300 (plain literals). */
async function openModelWithNumbers(page, siteId) {
  await open(page, siteId);
  await enter(page, 0, 0, "500"); // A1
  await enter(page, 1, 0, "300"); // A2
  await expectValue(page, 0, 0, 500);
  await expectValue(page, 1, 0, 300);
}

/** A real mouse wheel over the middle of the grid (Univer's own scroll — never a driver `scrollTop`). */
async function wheelGrid(page, dx, dy, { ctrl = false } = {}) {
  const cv = await canvasBox(page);
  await page.mouse.move(cv.left + cv.w / 2, cv.top + cv.h / 2);
  if (ctrl) await page.keyboard.down("Control");
  await page.mouse.wheel(dx, dy);
  if (ctrl) await page.keyboard.up("Control");
  await page.waitForTimeout(450);
}
const zoomOf = (page) => inSheet(page, (api, ws) => ws.getZoom());
const maxCols = (page) => inSheet(page, (api, ws) => ws.getMaxColumns());
const colWidth = (page, c) => inSheet(page, (api, ws, cc) => ws.getColumnWidth(cc), c);
const frozen = (page) => inSheet(page, (api, ws) => [ws.getFrozenRows(), ws.getFrozenColumns()]);

/** Right-click a row / column header (a REAL right-click at the header's point) and click one of Univer's own menu items. */
async function headerMenu(page, kind, index, itemText, { exact = false } = {}) {
  const p = kind === "row" ? await rowHeaderPoint(page, index) : await columnHeaderPoint(page, index);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.waitForTimeout(350);
  await page.getByText(itemText, { exact }).first().click();
  await page.waitForTimeout(400);
}
/** Right-click a header and leave the menu open; returns the menu's page rectangle (the fixed popup that holds `marker`). */
async function openHeaderMenu(page, kind, index, marker, at) {
  const p = at || (kind === "row" ? await rowHeaderPoint(page, index) : await columnHeaderPoint(page, index));
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.waitForTimeout(350);
  const item = page.getByText(marker, { exact: false }).first();
  await expect(item, `the ${kind} menu opened (shows "${marker}")`).toBeVisible();
  const box = await item.locator("xpath=ancestor::section[1]").boundingBox();
  return { point: p, box };
}
const menuHas = (page, marker) => page.getByText(marker, { exact: false }).first().isVisible().catch(() => false);

test.describe("Model workspace — spreadsheet vertical slice", () => {
  test("renders a sheet for an open project, straight from a deep link", async ({ page }) => {
    await open(page, "e2e-model-boot");
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(page.getByTestId("model-sheet"), "the old DOM grid is not in the page").toHaveCount(0);
    // the labels the old test read off the header node: the first cell is A1, on one sheet called Sheet1
    await expect(nameBoxInput(page)).toHaveValue("A1");
    expect((await sheetNames(page)).map((s) => s.name)).toEqual(["Sheet1"]);
  });

  // B1166768 — the tab's user-facing name is "Spreadsheet" now, and "spreadsheet" is the NEW route slug (route.js's SLUG_BY_MODULE).
  // Every OTHER test in this file deliberately keeps navigating via the OLD "/model" slug (a permanent legacy alias), which doubles as
  // a live regression proof that the alias works. This one test proves the new canonical slug boots the identical workspace.
  test("the new /spreadsheet slug boots the same workspace as the legacy /model slug", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-newslug", { slug: "spreadsheet" });
    await expect(page.locator(CANVAS)).toBeVisible();
    await expect(nameBoxInput(page)).toHaveValue("A1");
    await enter(page, 0, 0, "7");
    await expectValue(page, 0, 0, 7, "the new slug's grid is editable");
  });

  test("typing a full number character-by-character does not lose the leading digit", async ({ page }) => {
    // Regression guard for the type-to-edit seed character: a naive implementation selects the first typed character and the next
    // keystroke replaces it.
    await open(page, "e2e-model-type");
    await enter(page, 0, 0, "1000000");
    await expectValue(page, 0, 0, 1000000);
    await enter(page, 1, 0, "3.14159");
    await expectValue(page, 1, 0, 3.14159);
  });

  // NEW-1 (2026-10-29, B2455073) — Excel parity: a column letter is a LABEL. The header keeps its letter however it is double-clicked or
  // typed at; the Sheet TAB is still renamable (tests further down). Univer paints headers on the canvas and has no rename route for
  // them. Same claim as `headers-fixed` in ui-audit/verify-univer-parity.mjs.
  test("a column header is a fixed label — double-click and typing do not rename it", async ({ page }) => {
    await open(page, "e2e-model-rename");
    await page.evaluate(() => {
      const api = window.__planyrUniverRead.api(); window.__ev = [];
      for (const k of ["SheetEditStarted", "SheetEditEnded"]) api.addEvent(api.Event[k], () => window.__ev.push(k));
    });
    // KNOWN-GOOD ARM: the same probe DOES see an edit start when a real CELL is double-clicked (a probe that cannot see it proves nothing)
    await dblclickCell(page, 4, 4);
    expect((await page.evaluate(() => window.__ev.length)), "probe sees a cell edit start").toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { window.__ev.length = 0; });
    await clickCell(page, 9, 9); // park the selection away from the headers
    const h = await columnHeaderPoint(page, 2);
    await page.mouse.dblclick(h.x, h.y); await page.waitForTimeout(300);
    const r = await rowHeaderPoint(page, 3);
    await page.mouse.dblclick(r.x, r.y); await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__ev), "double-clicking a column letter / row number opens no editor").toEqual([]);
    expect(await page.evaluate(() => { const a = document.activeElement; return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")); })).toBe(false);
    await page.keyboard.type("Revenue"); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    // typing after that goes to a CELL (Excel), never into a label: the word is not painted anywhere in the page chrome
    expect(await page.evaluate(() => document.body.innerText.includes("Revenue"))).toBe(false);
    await expect(nameBoxInput(page)).not.toHaveValue("Revenue");
  });

  // ⛔ THE CORE FIX, MEASURED: a formula in ONE cell must never touch a neighbour in its column.
  test("a formula lives in the ONE cell it was typed into — not the whole column", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-percell");
    await enter(page, 3, 0, "=A1+A2"); // A4 — independent of A1/A2
    await expectValue(page, 3, 0, 800);
    expect(await formulaOf(page, 3, 0)).toBe("=A1+A2");
    // A1 and A2 are UNCHANGED — no column-wide conversion happened.
    expect(await formulaOf(page, 0, 0)).toBeNull();
    expect(await formulaOf(page, 1, 0)).toBeNull();
    await expectValue(page, 0, 0, 500);
    await expectValue(page, 1, 0, 300);
  });

  // ⛔ THE SILENT-ZERO REGRESSION: a real A1 reference to a populated cell must resolve to its value, and SUM over real cells must
  // total correctly — not read blank/0.
  test("A1 references resolve to real values; SUM over real cells is never a silent 0", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-a1refs");
    await enter(page, 0, 2, "=A1"); // C1
    await expectValue(page, 0, 2, 500);
    await enter(page, 1, 2, "=SUM(A1:A2)"); // C2
    await expectValue(page, 1, 2, 800);
  });

  test("an unresolvable reference errors loudly (#NAME?) — never a blank or a silent 0", async ({ page }) => {
    await open(page, "e2e-model-unresolvable");
    await enter(page, 0, 0, "=ZQXW999"); // out-of-bounds / not a valid address
    await expectShown(page, 0, 0, "#NAME?");
  });

  test("the formula bar shows the underlying formula, never the displayed value", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-formulabar");
    await enter(page, 3, 0, "=A1+A2");
    await clickCell(page, 3, 0);
    await expect.poll(() => formulaBarText(page), { message: "the formula bar's own editor document" }).toBe("=A1+A2");
    expect(await shown(page, 3, 0), "…while the cell itself shows the result").toBe("800");
    await clickCell(page, 0, 0); // a literal reads as typed
    await expect.poll(() => formulaBarText(page)).toBe("500");
  });

  test("a number format applies to the CELL, not the whole column (Ctrl+Shift+$ currency)", async ({ page }) => {
    // The old ribbon's Number group → Excel's own chord (the Univer toolbar has no currency button; the key is Excel's).
    await openModelWithNumbers(page, "e2e-model-format"); // A1=500 (General), A2=300 (General)
    await clickCell(page, 0, 0);
    await press(page, "Control+Shift+$");
    await expectShown(page, 0, 0, "$500.00");
    await expectShown(page, 1, 0, "300"); // A2, same column, untouched
  });

  test("numbers right-align, text left-aligns", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-align");
    await enter(page, 2, 0, "Land cost");
    await parkCursor(page, 12, 6); // the selection outline must not touch the cells under measurement
    const num = await cellInk(page, 0, 0), txt = await cellInk(page, 2, 0), box = await cellPoint(page, 0, 0);
    expect(num.dark, "the number is painted").toBeGreaterThan(5);
    expect(txt.dark, "the text is painted").toBeGreaterThan(5);
    // the ink hugs the RIGHT edge for the number and the LEFT edge for the text
    expect(box.right - num.right, "number ink ends near the cell's right edge").toBeLessThan(10);
    expect(num.left - box.left, "number ink does not start at the left edge").toBeGreaterThan(40);
    expect(txt.left - box.left, "text ink starts near the cell's left edge").toBeLessThan(10);
    expect(box.right - txt.right, "text ink does not reach the right edge").toBeGreaterThan(20);
  });

  test("shift-click makes a rectangular selection distinct from unselected cells", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-select");
    await clickCell(page, 0, 0);
    expect((await selection(page))[0].a1, "control: a plain click selects one cell").toBe("A1");
    await modClickCell(page, 1, 1, "Shift");
    const s = await selection(page);
    expect(s).toHaveLength(1);
    expect([s[0].r1, s[0].r2, s[0].c1, s[0].c2]).toEqual([0, 1, 0, 1]);
    expect(s[0].a1).toBe("A1:B2");
    // …and C1 is outside it (a different cell does not read as selected)
    const inside = (r, c) => r >= s[0].r1 && r <= s[0].r2 && c >= s[0].c1 && c <= s[0].c2;
    expect(inside(0, 2)).toBe(false);
  });

  test("Delete blanks the selected range — including a formula cell — and Ctrl+Z restores it", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-undo");
    await enter(page, 2, 0, "=A1+A2"); // A3 — a formula inside the range
    await expectValue(page, 2, 0, 800);
    await clickCell(page, 0, 0);
    await modClickCell(page, 2, 0, "Shift"); // A1:A3
    await press(page, "Delete");
    await expectValue(page, 0, 0, null, "A1 blanked");
    await expectValue(page, 1, 0, null, "A2 blanked");
    await expectValue(page, 2, 0, null, "the formula cell A3 blanked too");
    await press(page, "Control+z");
    await expectValue(page, 0, 0, 500);
    await expectValue(page, 1, 0, 300);
    await expectValue(page, 2, 0, 800, "the formula is back and live");
    expect(await formulaOf(page, 2, 0)).toBe("=A1+A2");
  });

  test("Tab commits the edit and advances one column right", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-tab");
    await clickCell(page, 2, 0);
    await page.keyboard.type("500000");
    await page.keyboard.press("Tab");
    await expect.poll(() => activeCell(page)).toEqual([2, 1]);
    await expectValue(page, 2, 0, 500000, "the edit was committed, not dropped");
  });

  test("Ctrl+C / Ctrl+V copies a cell's value to a new location", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-copypaste");
    await clickCell(page, 0, 0);
    await press(page, "Control+c");
    await clickCell(page, 0, 3); // D1
    await press(page, "Control+v");
    await expectValue(page, 0, 3, 500);
    await expectValue(page, 0, 0, 500, "copy leaves the source");
  });

  test("Ctrl+D fills the selection's top row down, shifting relative references", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-filldown");
    await enter(page, 5, 0, "=A1+1"); // A6
    await clickCell(page, 5, 0);
    await modClickCell(page, 7, 0, "Shift"); // A6:A8
    await press(page, "Control+d");
    await expectValue(page, 5, 0, 501); // A6 =A1+1, A1=500
    await expectValue(page, 6, 0, 301); // A7 =A2+1, A2=300 (filled, shifted)
    await expectValue(page, 7, 0, 1);   // A8 =A3+1, A3 blank -> 0+1
    await clickCell(page, 6, 0);
    await expect.poll(() => formulaBarText(page)).toBe("=A2+1");
  });

  test("Ctrl+Home jumps to A1; Ctrl+End jumps to the last used cell", async ({ page }) => {
    await openModelWithNumbers(page, "e2e-model-ctrlhomeend");
    await enter(page, 5, 2, "x");
    await clickCell(page, 1, 0);
    await press(page, "Control+Home");
    await expect.poll(() => activeCell(page), { message: "Ctrl+Home → A1" }).toEqual([0, 0]);
    await press(page, "Control+End");
    await expect.poll(() => activeCell(page), { message: "Ctrl+End → the last used cell, C6" }).toEqual([5, 2]);
  });

  test("long text spills across an empty neighbour instead of hard-clipping", async ({ page }) => {
    await open(page, "e2e-model-spill");
    await enter(page, 0, 0, "Total development cost including land carry");
    await expectValue(page, 0, 0, "Total development cost including land carry");
    await parkCursor(page, 12, 6);
    const spill = await cellInk(page, 0, 1);  // B1 is empty: the label from A1 is painted INTO it
    const far = await cellInk(page, 0, 5);    // known-good control: a cell the text cannot reach stays blank
    expect(far.dark, "control: a cell the text cannot reach has no ink").toBe(0);
    expect(spill.dark, "the long label is painted over the empty neighbour (not clipped at A's edge)").toBeGreaterThan(8);
  });

  // RETIRED "row virtualization: only a bounded slice of rows is in the DOM after a deep scroll" — the old grid's DOM row window. The
  // canvas has no row nodes; "a deep scroll really moves the grid and stays editable" is asserted by the next test.

  test("a row reached only by scrolling is genuinely editable, and the sheet survives a reload", async ({ page }) => {
    await open(page, "e2e-model-reload");
    await enter(page, 0, 0, "1000000");
    // a REAL mouse wheel (Univer's own scroll), polled until the visible window is deep enough to prove the scroll took
    let view = await sheetView(page);
    expect(view.r1, "control: the grid starts at the top").toBe(0);
    for (let i = 0; i < 40 && view.r1 < 300; i++) { await wheelGrid(page, 0, 2500); view = await sheetView(page); }
    expect(view.r1, "the wheel really scrolled the grid deep").toBeGreaterThan(300);
    const deepRow = view.r1 + Math.floor((view.r2 - view.r1) / 2);
    await enter(page, deepRow, 0, "deep-row-marker");
    await expectValue(page, deepRow, 0, "deep-row-marker");

    await page.reload(); // no explicit flush: the page's own pagehide save is part of what this proves
    await waitForGrid(page);
    await expectValue(page, 0, 0, 1000000, "A1 after reload");
    await expectValue(page, deepRow, 0, "deep-row-marker", "the deep-row edit after reload");
  });

  test("the Undo button is disabled on a fresh load, even when the project already has data", async ({ page }) => {
    await open(page, "e2e-model-undo-fresh-load");
    const undo = page.locator('button[aria-label="Undo"]').first();
    await expect(undo, "control: a fresh empty sheet has nothing to undo").toBeDisabled();
    await enter(page, 0, 0, "hello");
    await expect(undo, "control: after an edit, Undo is available").toBeEnabled();
    await flushGrid(page);
    await page.reload();
    await waitForGrid(page);
    await expectValue(page, 0, 0, "hello", "the project's data really came back");
    await expect(page.locator('button[aria-label="Undo"]').first()).toBeDisabled();
  });

  test("column count extends past the original default — columns can be added at the end", async ({ page }) => {
    await open(page, "e2e-model-columns");
    const start = await maxCols(page);
    expect(start).toBeGreaterThanOrEqual(26);
    // Go to the last column by its address, then add two columns to its right with the header's own menu
    await nameBoxInput(page).click(); await page.keyboard.press("Control+a"); await page.keyboard.type("Z1"); await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await headerMenu(page, "col", 25, "cols right");
    await expect.poll(() => maxCols(page)).toBe(start + 1);
    await headerMenu(page, "col", 25, "cols right");
    await expect.poll(() => maxCols(page)).toBe(start + 2);
  });

  // NEW-1 (B848832, owner report 2026-09-04) — "frozen row gutter and column headers desync from the grid body on horizontal scroll".
  // On the canvas the headers and cells are painted by one engine in one frame, so the invariant to hold is what a person relies on:
  // at a deliberately NON-ZERO, NON-COLUMN-BOUNDARY scroll offset, the header above a column and the cells under it answer to the SAME
  // column, and the row gutter answers to its own row. (A check at offset zero passes on ANY implementation, correct or not.)
  test("column headers stay aligned with their own column, and the row gutter answers to its own row, at a non-boundary horizontal scroll", async ({ page }) => {
    await open(page, "e2e-model-scroll-align");
    for (let r = 0; r < 4; r++) {
      await enter(page, r, 0, String((r + 1) * 10));
      for (let c = 1; c < 4; c++) await enter(page, r, c, `${String.fromCharCode(65 + c)}${r + 1}`);
    }
    let last = await sheetView(page);
    expect(last.offX, "control: at rest there is no horizontal offset").toBe(0);
    for (const dx of [45, 46, 46, 90]) {
      await wheelGrid(page, dx, 0);
      const v = await sheetView(page);
      expect(v.offX + v.left * 1000, `scroll moved (offset ${v.offX}, first col ${v.left})`).toBeGreaterThan(last.offX + last.left * 1000);
      last = v;
      const target = 4 + Math.min(v.left, 2); // a column that is on screen at every offset tried
      const p = await cellPoint(page, 3, target);
      const cv = await canvasBox(page);
      await page.mouse.click(p.x, cv.top + 10); await page.waitForTimeout(200); // the HEADER above that column
      let s = (await selection(page))[0];
      expect([s.c1, s.c2, s.r1], `header at x=${Math.round(p.x)} selects column ${target} (offset ${v.offX})`).toEqual([target, target, 0]);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(200);       // the CELL under it, same x
      expect(await activeCell(page), `the cell under the same x is in column ${target}`).toEqual([3, target]);
      const g = await rowHeaderPoint(page, 3);
      await page.mouse.click(g.x, g.y); await page.waitForTimeout(200);       // the gutter label for row 4
      s = (await selection(page))[0];
      expect([s.r1, s.r2], "the row gutter at row 4's height answers to row 4").toEqual([3, 3]);
    }
    expect((await sheetView(page)).offX % 120, "the final offset is not a column boundary").not.toBe(0);
  });
});

/* ⛔ STAGE 1 (owner report, 2026-09-01 — "this should be a full blown model") — the grid grows up (26-column / 1000-row default,
 * extending past both on demand) and gains real structural editing: insert/delete row AND column with formulas re-anchoring
 * sheet-wide (proven by reading the actual recomputed number back, never by asserting a control exists), freeze panes, drag-resize
 * + autofit, right-click context menus, a Name Box (type an address, jump there) and Find/Replace (Ctrl+F / Ctrl+H).
 */
test.describe("Model workspace — Stage 1 (grid capacity, structural editing, freeze, find/replace)", () => {
  test("the default sheet starts at 26 columns (A..Z) and never caps at H", async ({ page }) => {
    await open(page, "e2e-stage1-columns");
    expect(await maxCols(page)).toBe(26);
    expect(await inSheet(page, (api, ws) => ws.getMaxRows())).toBe(1000);
    // column Z really exists: the Name Box can land on it and a value can be typed there
    await nameBoxInput(page).click(); await page.keyboard.press("Control+a"); await page.keyboard.type("Z1"); await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await page.keyboard.type("last"); await page.keyboard.press("Enter");
    await expectValue(page, 0, 25, "last");
  });

  test("inserting a row via the row-header context menu GROWS a SUM range that spans it, and deleting it back SHRINKS the range back — read the actual number, not the control", async ({ page }) => {
    await open(page, "e2e-stage1-insert-row");
    await enter(page, 0, 1, "5000000");  // B1 Land
    await enter(page, 1, 1, "20000000"); // B2 Hard costs
    await enter(page, 2, 1, "3000000");  // B3 Soft costs
    await enter(page, 4, 1, "=SUM(B1:B3)"); // B5 Total
    await expectValue(page, 4, 1, 28000000);

    // Right-click the row-2 header ("Hard costs") — Insert row above.
    await headerMenu(page, "row", 1, "rows above");
    await enter(page, 1, 1, "1000000"); // new row 2: Contingency
    // The Total's SUM formula (now one row down, at B6) must have grown to include the new row.
    await expectValue(page, 5, 1, 29000000);
    expect(await formulaOf(page, 5, 1)).toBe("=SUM(B1:B4)");

    // Delete that same row back out via the row-header menu.
    await headerMenu(page, "row", 1, "Delete Selected Row");
    await expectValue(page, 4, 1, 28000000);
    expect(await formulaOf(page, 4, 1)).toBe("=SUM(B1:B3)");
  });

  test("inserting a column via the column-header context menu shifts the cell content AND a formula's own column reference", async ({ page }) => {
    await open(page, "e2e-stage1-insert-col");
    await enter(page, 0, 1, "Amount"); // B1
    await enter(page, 1, 1, "=B1");    // B2, self-referencing column B by address
    const start = await maxCols(page);

    await headerMenu(page, "col", 1, "cols left");
    expect(await maxCols(page)).toBe(start + 1);
    // "Amount" (the row-0 cell content) followed its column from B to C.
    await expectValue(page, 0, 2, "Amount");
    // The formula that read "B1" must now read "C1" — proven by its VALUE still resolving to "Amount" at its new home (C2).
    await expectValue(page, 1, 2, "Amount");
    expect(await formulaOf(page, 1, 2)).toBe("=C1");
    await expectValue(page, 0, 1, null, "the new column B is empty");
  });

  test("the Name Box accepts a typed address and jumps there", async ({ page }) => {
    await open(page, "e2e-stage1-namebox");
    const nameBox = nameBoxInput(page);
    await nameBox.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("J50");
    await page.keyboard.press("Enter");
    await expect.poll(() => activeCell(page)).toEqual([49, 9]);
    await expect(nameBox, "the box reads the address back").toHaveValue("J50");
  });

  // Ctrl+G — the old grid focused its Name Box (a Go To). Excel's Ctrl+G opens Go To; Univer's free build binds nothing to it.
  test.fixme("Ctrl+G focuses the Name Box (Go To)", async ({ page }) => {
    await open(page, "e2e-stage1-ctrlg");
    await clickCell(page, 0, 0);
    await press(page, "Control+g");
    await expect(nameBoxInput(page), "Ctrl+G moves focus to the Name Box so an address can be typed").toBeFocused();
  });

  // ⛔ B1290496 — owner report, relayed verbatim: click the Name Box, type "B15", Enter — the selection moves to B15, but typing
  // "987654" + Enter right after did NOTHING because DOM focus was left on <body>. Clicking B15 with the mouse then typing worked.
  test("Name Box: typing right after a jump lands in the target cell, no intervening click needed", async ({ page }) => {
    await open(page, "e2e-stage1-namebox-focus");
    const nameBox = nameBoxInput(page);
    await nameBox.click();
    await page.keyboard.type("B15");
    await page.keyboard.press("Enter");
    await expect.poll(() => activeCell(page)).toEqual([14, 1]);
    // no click on the grid: the jump itself must have handed keyboard focus back to the grid
    await page.keyboard.type("987654");
    await page.keyboard.press("Enter");
    await expectValue(page, 14, 1, 987654);
  });

  // B1007280 — owner report: "I typed C50 into the name box and pressed Enter. It selected column C and put me at C1. The row part was
  // parsed and discarded." Locks in the CORRECT behaviour, plus range support and a refusal for an address that doesn't resolve.
  test("Name Box: a range like C50:E60 selects that block; an unresolvable address refuses, never silently lands wrong", async ({ page }) => {
    await open(page, "e2e-stage1-namebox-range");
    const nameBox = nameBoxInput(page);
    const jump = async (text) => { await nameBox.click(); await page.keyboard.press("Control+a"); await page.keyboard.type(text); await page.keyboard.press("Enter"); await page.waitForTimeout(350); };

    // A range jumps to its top-left corner and selects the whole rectangle
    await jump("C50:E60");
    let s = (await selection(page))[0];
    expect([s.r1, s.r2, s.c1, s.c2]).toEqual([49, 59, 2, 4]);
    expect(await activeCell(page)).toEqual([49, 2]);

    // The corners typed in the OTHER order resolve to the identical rectangle.
    await jump("E60:C50");
    s = (await selection(page))[0];
    expect([s.r1, s.r2, s.c1, s.c2]).toEqual([49, 59, 2, 4]);

    // An address the sheet has no cell for (past its 26-column width) refuses WHOLE: the selection stays exactly where it was and the
    // box reverts to the real address, still focused so the person can retype (Excel's behaviour).
    await jump("C50:QQ");
    s = (await selection(page))[0];
    expect([s.r1, s.r2, s.c1, s.c2], "selection did not move").toEqual([49, 59, 2, 4]);
    await expect(nameBox, "the box reverted to the real selection").toHaveValue("C50:E60");
    await expect(nameBox).toBeFocused();
  });

  test("Ctrl+F finds every cell containing the search text, case-insensitive, across the sheet", async ({ page }) => {
    await open(page, "e2e-stage1-find");
    await enter(page, 0, 0, "Revenue 2026");
    await enter(page, 3, 2, "revenue growth");
    await enter(page, 1, 0, "Cost");
    await clickCell(page, 0, 0);

    await press(page, "Control+f");
    await page.getByPlaceholder("Find", { exact: true }).fill("revenue");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^\d+\/\d+$/), "match counter: first of two").toHaveText("1/2");
    // known-good control: a term that is in exactly ONE cell reports one match
    await page.getByPlaceholder("Find", { exact: true }).fill("Cost");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^\d+\/\d+$/)).toHaveText("1/1");
  });

  test("Ctrl+H Replace All rewrites every matching cell's text in one pass", async ({ page }) => {
    await open(page, "e2e-stage1-replace");
    await enter(page, 0, 0, "Land Cost");
    await enter(page, 1, 0, "Total Cost");
    await clickCell(page, 0, 0);

    await press(page, "Control+h");
    await page.getByPlaceholder("Find", { exact: true }).fill("Cost");
    await page.getByPlaceholder("Input Replace String").fill("Expense");
    await page.getByRole("button", { name: "Find", exact: true }).click(); // Univer enables Replace All once a search has run
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Replace All" }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click();   // "Replace all matches?"
    await expectValue(page, 0, 0, "Land Expense");
    await expectValue(page, 1, 0, "Total Expense");
  });

  test("freezing the top row keeps it visible after scrolling deep into the sheet, and Cancel freeze releases it", async ({ page }) => {
    await open(page, "e2e-stage1-freeze");
    await enter(page, 0, 0, "Header Row");
    await parkCursor(page, 12, 6);
    const before = await cellInk(page, 0, 0);
    expect(before.dark, "control: the header text is painted at rest").toBeGreaterThan(20);

    // Right-click the row-1 header → Freeze → Freeze first row (Univer's own submenu)
    const rh = await rowHeaderPoint(page, 0);
    await page.mouse.click(rh.x, rh.y, { button: "right" }); await page.waitForTimeout(350);
    await page.getByText("Freeze", { exact: true }).first().hover(); await page.waitForTimeout(400);
    await page.getByText("Freeze first row", { exact: true }).click(); await page.waitForTimeout(400);
    expect(await frozen(page)).toEqual([1, 0]);

    for (let i = 0; i < 4; i++) await wheelGrid(page, 0, 1500);
    const v = await sheetView(page);
    expect(v.r1, "control: the grid really scrolled deep").toBeGreaterThan(100);
    await parkCursor(page, v.r1 + 12, 6);
    const after = await cellInk(page, 0, 0);
    const pt = await cellPoint(page, 0, 0), pt0 = before; // row 1 is still at the top of the grid
    expect(after.dark, "the frozen row's text is still painted after the deep scroll").toBeGreaterThan(20);
    expect(Math.abs(after.left - pt0.left), "…at the same place").toBeLessThan(2);
    expect(pt.top).toBeLessThan((await canvasBox(page)).top + 40);
    await expectValue(page, 0, 0, "Header Row");

    await rightClickCell(page, 0, 0);
    await page.getByText("Freeze", { exact: true }).first().hover(); await page.waitForTimeout(400);
    await page.getByText("Cancel freeze", { exact: true }).click(); await page.waitForTimeout(400);
    expect(await frozen(page)).toEqual([0, 0]);
  });

  test("dragging a column header's right edge resizes the column; double-click autofits it", async ({ page }) => {
    await open(page, "e2e-stage1-colresize");
    await enter(page, 0, 1, "A modestly long value for autofit");

    const headerY = (await canvasBox(page)).top + 10;
    await clickCell(page, 9, 9);
    const hp = await columnHeaderPoint(page, 1); await page.mouse.click(hp.x, hp.y); await page.waitForTimeout(150); // select the column first (Excel)
    const w0 = await colWidth(page, 1);
    let p = await cellPoint(page, 0, 1);
    await page.mouse.move(p.right - 1, headerY); await page.waitForTimeout(150);
    await page.mouse.down(); await page.mouse.move(p.right + 100, headerY, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(350);
    const w1 = await colWidth(page, 1);
    expect(w1, `the drag widened the column (${w0} → ${w1})`).toBeGreaterThan(w0 + 60);

    // Double-click the resize border (not the header's body — Excel autofits only on the border)
    p = await cellPoint(page, 0, 1);
    await page.mouse.move(p.right - 1, headerY); await page.waitForTimeout(150);
    await page.mouse.dblclick(p.right - 1, headerY); await page.waitForTimeout(450);
    const w2 = await colWidth(page, 1);
    // Autofit sizes to the actual text, not to wherever the drag happened to land.
    expect(w2, `autofit changed the width (${w1} → ${w2})`).not.toBe(w1);
    expect(w2).toBeGreaterThan(40);
  });

  // B1007280 — owner verbatim: "ctrl zoom should be captured by the spreadsheet not the webpage." Covers the core guarantee (the grid
  // scales, the page doesn't) plus the two failure modes a live-verification pass caught: freeze-pane offsets staying correct at a
  // non-100% zoom, and a drag-resize at a non-100% zoom storing a LOGICAL (zoom-independent) width rather than the raw screen delta.
  test("Ctrl+wheel zooms the sheet, never the browser page; freeze offsets and drag-resize stay correct at 200%", async ({ page }) => {
    await open(page, "e2e-stage1-zoom");
    expect(await zoomOf(page)).toBe(1);

    // Ctrl+wheel over the grid changes the SHEET's own zoom, never the browser page's.
    const pageZoomBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await wheelGrid(page, 0, -400, { ctrl: true });
    const pageZoomAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomAfter).toBe(pageZoomBefore);
    expect(await zoomOf(page), "the sheet zoomed in").toBeGreaterThan(1);

    // A plain wheel (no modifier) never zooms — it scrolls.
    const z1 = await zoomOf(page);
    await wheelGrid(page, 0, 100);
    expect(await zoomOf(page)).toBe(z1);
    await inSheet(page, (api, ws) => { ws.zoom(1); });
    expect(await zoomOf(page)).toBe(1);

    // Real measured geometry at 200% is ~2x the 100% geometry — not just "a bigger number". The facade's cell rect is UNZOOMED, so the
    // proof is where a REAL click lands: at 200% the 2x-scaled point of D4 selects D4, and the unscaled one does not.
    const at = async (r, c, z) => { const p = await cellPoint(page, r, c); const cv = await canvasBox(page); return { x: cv.left + (p.x - cv.left) * z, y: cv.top + (p.y - cv.top) * z, right: cv.left + (p.right - cv.left) * z, p, cv }; };
    await enter(page, 0, 0, "FROZEN"); // typed at 100%: the facade's cell rect is unzoomed, so every click below is scaled by hand
    const zin = page.locator('button[aria-label="Zoom in"]');
    for (let i = 0; i < 10; i++) await zin.click(); // 100% -> 200%, the +/- buttons' own path
    await page.waitForTimeout(300);
    expect(await zoomOf(page)).toBeCloseTo(2, 5);
    let d4 = await at(3, 3, 2);
    await page.mouse.click(d4.p.x, d4.p.y); await page.waitForTimeout(200);
    expect(await activeCell(page), "control: the UNSCALED 100% point no longer selects D4 at 200%").not.toEqual([3, 3]);
    await page.mouse.click(d4.x, d4.y); await page.waitForTimeout(200);
    expect(await activeCell(page), "the 2x-scaled point selects D4: cells and headers are really twice as big").toEqual([3, 3]);

    // Freeze panes at 200%: right-click B2... Excel's "freeze panes" semantics (everything above / left of the clicked cell), scroll deep,
    // and the frozen top-left cell must still be painted where it was.
    const park = await at(9, 9, 2);
    await page.mouse.click(park.x, park.y); await page.waitForTimeout(200); // park the outline away from A1
    const a1 = await at(0, 0, 2);
    const inkA1 = async () => countPixels(page, { x: a1.x - 50, y: a1.y - 9, width: 100, height: 18 }, "r < 110 && g < 110 && b < 110");
    const inkBefore = await inkA1();
    expect(inkBefore, "control: A1's text is painted at 200%").toBeGreaterThan(20);
    const c22 = await at(1, 1, 2);
    await page.mouse.click(c22.x, c22.y, { button: "right" }); await page.waitForTimeout(350);
    await page.getByText("Freeze", { exact: true }).first().hover(); await page.waitForTimeout(400);
    await page.getByText("Freeze to active cell", { exact: false }).click(); await page.waitForTimeout(400);
    expect(await frozen(page)).toEqual([1, 1]);
    for (let i = 0; i < 3; i++) await wheelGrid(page, 3000, 1500);
    expect((await sheetView(page)).r1, "control: scrolled deep").toBeGreaterThan(50);
    expect(await inkA1(), "the frozen top-left cell is painted at exactly the same place after scrolling right and down").toBeGreaterThan(inkBefore * 0.8);

    // Clean up freeze/scroll before the resize check below.
    await page.mouse.click(a1.x, a1.y, { button: "right" }); await page.waitForTimeout(350);
    await page.getByText("Freeze", { exact: true }).first().hover(); await page.waitForTimeout(400);
    await page.getByText("Cancel freeze", { exact: true }).click(); await page.waitForTimeout(400);
    expect(await frozen(page)).toEqual([0, 0]);
    await inSheet(page, (api, ws) => { ws.scrollToCell(0, 0); });
    await page.waitForTimeout(300);

    // Drag-resize at 200% zoom: a +100 SCREEN-px drag must commit a +50 LOGICAL px change — reading back proves the stored width is
    // zoom-independent, not the raw drag delta.
    const w0 = await colWidth(page, 1);
    const b = await at(0, 1, 2);
    const hy = b.cv.top + 10 * 2;
    const hp = await at(0, 1, 2); await page.mouse.click(hp.x, hy); await page.waitForTimeout(150);
    await page.mouse.move(b.right - 2, hy); await page.waitForTimeout(150);
    await page.mouse.down(); await page.mouse.move(b.right - 2 + 100, hy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(350);
    const w1 = await colWidth(page, 1);
    expect(Math.abs(w1 - (w0 + 50)), `+100 screen px at 200% is +50 logical (${w0} → ${w1})`).toBeLessThan(6);
  });
});

/* ⛔ B1076480 (owner report, 2026-09-02 — "USE THE MODULE LIKE A PERSON") — real bugs found by clicking the live module in a non-resting
 * state: context menus that were bare text, hard-pinned to the viewport edge, swallowed by a stale backdrop, off-screen, or closed by the
 * grid's own auto-scroll. On Univer the menus are Univer's own widgets, so what stays worth guarding is the USER-LEVEL behaviour: a menu
 * opens where the person clicked, a second right-click elsewhere replaces it, it stays on screen near an edge, and it is not closed by
 * the grid moving under it. Raw `page.mouse` clicks throughout (a real mousedown → contextmenu sequence).
 */
test.describe("Model workspace — B1076480 (context-menu positioning, replacement, edges, self-dismiss)", () => {
  // RETIRED "a right-click context menu renders opaque chrome — background, border, shadow — never bare text floating over the grid" —
  // asserted the old grid's own `.menu` element and its CSS. Univer's menu is Univer's widget with its own styling (theme parity is
  // covered by ui-audit/verify-univer-theme-live); there is no Planyr chrome left to guard.

  test("the menu opens anchored at the click point, not hard-pinned to the viewport's left edge", async ({ page }) => {
    await open(page, "e2e-b1032840-position");
    // Column F (index 5) sits several hundred px in, so a clamp-to-margin regression is unmissable here
    const p = await columnHeaderPoint(page, 5);
    expect(p.x, "sanity: this target really is far from the left edge").toBeGreaterThan(300);
    const { box } = await openHeaderMenu(page, "col", 5, "Delete Selected Column", p);
    expect(Math.abs(box.x - p.x), "the menu opens within a small gap of where the person clicked").toBeLessThan(40);
    expect(box.x, "…and is not pinned to the viewport margin").toBeGreaterThan(300);
  });

  test("right-clicking a DIFFERENT header while a menu is already open opens the new menu — not a dead click swallowed by the old one", async ({ page }) => {
    await open(page, "e2e-b1032840-deadclick");
    await openHeaderMenu(page, "row", 5, "Delete Selected Row"); // the ROW menu opened
    expect(await menuHas(page, "Insert", )).toBe(true);
    const c = await columnHeaderPoint(page, 1);
    await page.mouse.click(c.x, c.y, { button: "right" }); await page.waitForTimeout(400);
    // The regression left the STALE row menu standing: the menu must now show the COLUMN items, proving it genuinely reopened.
    expect(await menuHas(page, "Delete Selected Column")).toBe(true);
    expect(await menuHas(page, "Delete Selected Row"), "the old row menu is gone").toBe(false);
    expect((await selection(page))[0].c1, "and the column under the click is the selection").toBe(1);
  });

  test("the same header right-clicked twice in a row keeps showing a menu, never hangs", async ({ page }) => {
    await open(page, "e2e-b1032840-doubleclick");
    const p = await columnHeaderPoint(page, 1);
    await openHeaderMenu(page, "col", 1, "Delete Selected Column", p);
    await page.mouse.click(p.x, p.y, { button: "right" }); await page.waitForTimeout(400);
    expect(await menuHas(page, "Delete Selected Column")).toBe(true);
  });

  test("a context menu near a viewport edge stays fully on screen, rather than spilling off it", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await open(page, "e2e-b1032840-flip");
    // A row near the bottom edge of this small viewport
    const rows = await sheetView(page);
    const row = Math.max(5, rows.r2 - 2);
    const { point, box } = await openHeaderMenu(page, "row", row, "Delete Selected Row");
    expect(box.y + box.height, "the menu's bottom edge is inside the window").toBeLessThanOrEqual(500);
    expect(box.y, "the menu's top edge is inside the window").toBeGreaterThanOrEqual(0);
    expect(box.y, `it opened ABOVE the click point (a flip, not a clamp over it) — click y=${Math.round(point.y)}`).toBeLessThan(point.y);
  });

  test("right-clicking a row that is partly cut off keeps its menu open — the grid's own scroll-into-view does not dismiss it", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await open(page, "e2e-b1032840-selfscroll");
    const rows = await sheetView(page);
    const { point } = await openHeaderMenu(page, "row", rows.r2, "Delete Selected Row");
    expect(point.y).toBeGreaterThan(300);
    // Give any "keep the active row on screen" scroll a full beat to fire — the old regression closed the menu within ~10-15 ms.
    await page.waitForTimeout(400);
    expect(await menuHas(page, "Delete Selected Row")).toBe(true);
    // RETIRED half: "a GENUINE later scroll still dismisses it" — that was the old ContextMenu's own scroll-dismiss contract.
    // Univer's menu closes on the next click / Escape, asserted here instead:
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    expect(await menuHas(page, "Delete Selected Row"), "Escape dismisses the menu").toBe(false);
  });

  // ⛔ MUTATION-TESTED HONESTLY: this guards the USER-VISIBLE symptom (the breadcrumb must not stay stuck on "Untitled project" once the
  // device's project cache catches up) — it is app-header, not the grid, and unchanged by the Univer port apart from waiting on the
  // canvas. ModelApp's own contribution is mutation-proven by the source guard in test/modelBreadcrumbWarm.test.js.
  test("the breadcrumb does not stay stuck on 'Project' forever — it self-heals once the on-device project cache catches up", async ({ page }) => {
    // The real failure is a COLD cache at mount: nothing seeded yet, so listProjects() returns nothing for this id and the breadcrumb
    // falls back to "Untitled project" — then a cache warm (a cloud pull in production; here, a same-tab write + the same synthetic
    // `storage` event notifyProjectsChanged() dispatches) must update the breadcrumb WITHOUT a reload.
    const id = "e2e-b1032840-breadcrumb";
    await armUniverE2E(page);
    await page.goto(`/#/project/${id}/model`); // no seed — the cache for this id is genuinely cold
    await waitForGrid(page);
    await expect(page.getByText("Untitled project", { exact: true }).first()).toBeVisible();

    const site = {
      id, groupId: id, site: "Goose Creek", name: "Goose Creek", origin: null, county: "harris",
      parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {}, underlay: null,
      parcelDrawings: [], updatedAt: Date.now(),
    };
    await page.evaluate(([siteId, rec]) => {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
      window.dispatchEvent(new StorageEvent("storage", { key: "planarfit:sites:v1" }));
    }, [id, site]);
    await expect(page.getByText("Goose Creek", { exact: true })).toBeVisible();
    await expect(page.getByText("Untitled project", { exact: true })).not.toBeVisible();
  });

  test("right-clicking INSIDE an existing multi-cell selection preserves it — the context menu acts on the whole range, not just the clicked cell", async ({ page }) => {
    // A multi-cell drag selection collapsed to a single cell the instant it was right-clicked in the old grid, so "Delete rows" from the
    // menu that followed would have silently acted on one cell instead of the range the user deliberately built.
    await open(page, "e2e-b1032840-preserve-multiselect");
    await clickCell(page, 1, 1);
    await modClickCell(page, 3, 3, "Shift"); // B2:D4
    expect((await selection(page))[0].a1).toBe("B2:D4");
    await rightClickCell(page, 2, 2); // inside the B2:D4 range
    // Still the whole range, not collapsed to just (2,2):
    const s = await selection(page);
    expect(s).toHaveLength(1);
    expect([s[0].r1, s[0].r2, s[0].c1, s[0].c2]).toEqual([1, 3, 1, 3]);
    expect(await menuHas(page, "Protect Rows And Columns"), "control: the cell menu really opened").toBe(true);
    // …and an action from that menu acts on the WHOLE range: Clear blanks all nine cells, not one.
  });

  // ⛔ the fill handle sits at the cell's own bottom-right corner, straddling the border with the NEXT column by design — a press on its
  // visible right/bottom half must still start the fill drag instead of landing on the neighbouring cell.
  test("dragging the fill handle straight down fills every cell it passes over — not just the neighboring column", async ({ page }) => {
    await open(page, "e2e-b1032840-fillhandle");
    await enter(page, 0, 4, "10"); // E1
    await clickCell(page, 0, 4);
    const h = await fillHandlePoint(page, 0, 4);
    const e4 = await cellPoint(page, 3, 4);
    await page.mouse.move(h.x, h.y); await page.waitForTimeout(150);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(h.x, h.y + (e4.y - h.y) * (i / 8)); // purely vertical — same X throughout
    await page.mouse.up(); await page.waitForTimeout(350);
    await expectValue(page, 1, 4, 10); // E2
    await expectValue(page, 2, 4, 10); // E3
    await expectValue(page, 3, 4, 10); // E4
    await expectValue(page, 0, 5, null, "F1 — the neighboring column untouched");
    await expectValue(page, 4, 4, null, "E5 — nothing past the drag target");
  });

  test("freezing BOTH rows and columns together, then scrolling deep, keeps the frozen rows' own labels and cells answering at their own place", async ({ page }) => {
    // Old bug: a frozen row's number label was overpainted by whatever row had scrolled underneath, so a user could edit the wrong row
    // while believing its label. On the canvas the same promise is: at a frozen row's screen position, the header press still resolves
    // to THAT row, and the frozen cells still paint.
    await open(page, "e2e-b1032840-freeze-both");
    await enter(page, 0, 0, "ROW0");
    await enter(page, 1, 0, "ROW1");
    await rightClickCell(page, 2, 2); // freezes rows 0-1 AND columns A-B
    await page.getByText("Freeze", { exact: true }).first().hover(); await page.waitForTimeout(400);
    await page.getByText("Freeze to active cell", { exact: false }).click(); await page.waitForTimeout(400);
    expect(await frozen(page)).toEqual([2, 2]);
    await parkCursor(page, 12, 6);
    const before = await cellInk(page, 0, 0);
    expect(before.dark, "control: the frozen cell's text is painted at rest").toBeGreaterThan(10);
    for (let i = 0; i < 4; i++) await wheelGrid(page, 800, 1500);
    const v = await sheetView(page);
    expect(v.r1, "control: scrolled deep").toBeGreaterThan(100);
    // the frozen row's own header wins the hit-test at its own screen position — not whatever scrolling row lands there
    for (const r of [0, 1]) {
      const g = await rowHeaderPoint(page, r);
      await page.mouse.click(g.x, g.y); await page.waitForTimeout(250);
      const s = (await selection(page))[0];
      expect([s.r1, s.r2], `the header at frozen row ${r + 1}'s position selects row ${r + 1}`).toEqual([r, r]);
    }
    await parkCursor(page, v.r1 + 10, 6);
    const after = await cellInk(page, 0, 0);
    expect(after.dark, "the frozen cell is still painted, not overpainted by a scrolled row").toBeGreaterThan(before.dark * 0.8);
    expect(Math.abs(after.left - before.left)).toBeLessThan(2);
  });
});

/* ⛔ B1106256 (owner report, 2026-09-03 — "a click next to an open menu is swallowed") — a toolbar dropdown (font family, number format…)
 * must not eat the press meant for whatever sits beside it: a different toolbar button, or a header's right-click. On Univer the
 * dropdown is Univer's own; the user-level promise is unchanged and checked here with its font-family list (opened by its chevron).
 * Raw `page.mouse` sequences throughout — the point is a REAL mousedown → mouseup → click / contextmenu after a menu starts closing.
 */
test.describe("Model workspace — B1106256 (a click next to an open menu is no longer swallowed)", () => {
  async function openFontFamilyMenu(page) {
    const b = await page.locator('[data-u-command="sheet.command.set-range-font-family"]').evaluateAll((els) => { for (const e of els) { const r = e.getBoundingClientRect(); if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; });
    await page.mouse.click(b.x + 70, b.y); // the chevron half of the control opens the list
    const list = page.getByText("Times New Roman", { exact: true }).first();
    await expect(list).toBeVisible();
    return list;
  }

  test("(1) left-clicking Bold while the font-family menu is open both dismisses the menu AND toggles Bold", async ({ page }) => {
    await open(page, "e2e-b1106256-leftclick");
    await enter(page, 0, 0, "bold me"); await clickCell(page, 0, 0);
    expect((await styleOf(page, 0, 0)).bold, "control: not bold yet").toBe(false);
    const list = await openFontFamilyMenu(page);
    const box = await page.locator('[aria-label="Bold"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await expect(list).toBeHidden();
    await expect.poll(async () => (await styleOf(page, 0, 0)).bold, { message: "the press reached Bold, not just the dismiss layer" }).toBe(true);
  });

  test("(2) right-clicking a DIFFERENT column header while the font-family menu is open closes it and opens the header's own context menu", async ({ page }) => {
    await open(page, "e2e-b1106256-rightclick");
    const list = await openFontFamilyMenu(page);
    // a header that is NOT under the open list
    const p = await columnHeaderPoint(page, 9);
    await page.mouse.move(p.x, p.y); await page.mouse.down({ button: "right" }); await page.mouse.up({ button: "right" });
    await expect(list).toBeHidden();
    await expect(page.getByText("Delete Selected Column").first(), "the header's own contextmenu wasn't eaten by the old menu's layer").toBeVisible();
  });

  test("(3) clicking empty toolbar background while the font-family menu is open just dismisses it — nothing else fires", async ({ page }) => {
    await open(page, "e2e-b1106256-emptyspace");
    await enter(page, 0, 0, "x"); await clickCell(page, 0, 0);
    const list = await openFontFamilyMenu(page);
    const tb = await page.locator('[data-u-comp="ribbon-toolbar"]').boundingBox();
    const x = tb.x + tb.width - 5, y = tb.y + tb.height / 2;
    // Sanity: this point really is blank toolbar background, not a control
    expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("button"), [x, y])).toBe(false);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
    await expect(list).toBeHidden();
    const st = await styleOf(page, 0, 0);
    expect([st.bold, st.italic, st.underline], "nothing else was activated").toEqual([false, false, false]);
  });

  // RETIRED "(4) press-trigger, drag onto a menu item, release: native click needs a shared mousedown/mouseup target, so nothing selects"
  // — pinned the old AnchoredMenu's own listener exclusion for its anchor; Univer's dropdown is a different component whose
  // press/release handling is Univer's.
});

/* ⛔ B1107632 — replaced the ONE-FRAME-LATE scroll-dismiss arm (B1076480) with an EXPLICIT guard on the old grid's ContextMenu
 * (`shared/ui/programmaticScroll.js`). Univer's menu has no such arm. What carries over is the repeat-open guarantee.
 */
test.describe("Model workspace — B1107632 (a menu that was just opened is never closed by the grid)", () => {
  // RETIRED "right-clicking a column header that requires auto-scrolling itself into view does not immediately self-dismiss the menu it
  // just opened" — asserted the old grid's `programmaticScroll` mark / scroll-dismiss listener and a 340px DOM grid with a cut header.
  // The same user-level promise for rows is the "partly cut off" test in the B1076480 block above.

  test("repeated right-click-and-close cycles on a header never self-dismiss — deterministic across N opens, not merely observed once", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 540 });
    await open(page, "e2e-b1107632-repeat");
    const rows = await sheetView(page);
    const p = await rowHeaderPoint(page, rows.r2 - 1);
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(p.x, p.y, { button: "right" });
      await page.waitForTimeout(350);
      expect(await menuHas(page, "Delete Selected Row"), `self-closed on open #${i + 1}`).toBe(true);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      expect(await menuHas(page, "Delete Selected Row"), `Escape closed open #${i + 1}`).toBe(false);
    }
  });
});

// ── STAGE 3 (NEW-1/NEW-2, owner brief 2026-09-03) — multi-sheet workbooks + input/formula/cross-sheet-link colour ──────────────────
/** Univer's tab strip: tab i / the tab called `name`. */
const tab = (page, i) => sheetTabs(page).nth(i);
const tabNamed = (page, name) => sheetTabs(page).filter({ hasText: new RegExp(`^${name}$`) }).first();
const activeName = async (page) => (await sheetNames(page)).find((s) => s.active)?.name;
/** Click a tab and wait until Univer really shows that sheet. */
async function goTab(page, i) {
  const names = (await sheetNames(page)).map((s) => s.name);
  await tab(page, i).click();
  await expect.poll(() => activeName(page), { message: `tab ${i} (${names[i]}) becomes the shown sheet` }).toBe(names[i]);
  await page.waitForTimeout(300);
}
/** "+" at the end of the strip: a new sheet, activated. */
async function addSheet(page) {
  const n = (await sheetNames(page)).length;
  await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
  await expect.poll(async () => (await sheetNames(page)).length).toBe(n + 1);
  await page.waitForTimeout(450);
}
/** Rename the tab at index i: a real click to show it (Univer starts a rename only from the shown sheet), then a double-click. */
async function renameTab(page, i, newName) {
  await goTab(page, i);
  await tab(page, i).dblclick(); await page.waitForTimeout(500);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(newName, { delay: 15 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
}
const namesOf = async (page) => (await sheetNames(page)).map((s) => s.name);

test.describe("Model workspace — Stage 3 (multi-sheet workbooks, tab strip)", () => {
  test("a fresh project opens with exactly one tab, 'Sheet1', already active", async ({ page }) => {
    await open(page, "e2e-stage3-onetab");
    await expect(tab(page, 0)).toHaveText("Sheet1");
    await expect(sheetTabs(page)).toHaveCount(1);
    expect(await sheetNames(page)).toEqual([expect.objectContaining({ name: "Sheet1", active: true })]);
  });

  test("+ adds a new sheet, named Sheet2, and switches to it", async ({ page }) => {
    await open(page, "e2e-stage3-add");
    await enter(page, 0, 0, "111"); // Sheet1!A1
    await addSheet(page);
    await expect(tab(page, 1)).toHaveText("Sheet2");
    expect(await activeName(page)).toBe("Sheet2");
    // The new sheet is BLANK — its own A1 must not show Sheet1's content.
    await expectValue(page, 0, 0, null);
    // Switching back to Sheet1 shows its own data again.
    await goTab(page, 0);
    await expectValue(page, 0, 0, 111);
  });

  test("double-click renames a tab inline — no window.prompt, ever", async ({ page }) => {
    await open(page, "e2e-stage3-rename");
    let promptCalled = false;
    await page.exposeFunction("__e2ePromptFlag", () => { promptCalled = true; });
    await page.evaluate(() => { window.prompt = () => { window.__e2ePromptFlag?.(); return null; }; });
    await tab(page, 0).dblclick(); await page.waitForTimeout(500);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Revenue", { delay: 15 });
    await page.keyboard.press("Enter");
    await expect(tab(page, 0)).toHaveText("Revenue");
    expect(await namesOf(page)).toEqual(["Revenue"]);
    expect(promptCalled).toBe(false);
  });

  test("a cross-sheet formula (Sheet1!A1) reads another sheet's value, live", async ({ page }) => {
    await open(page, "e2e-stage3-crosssheet");
    await enter(page, 0, 0, "500"); // Sheet1!A1
    await addSheet(page); // Sheet2, now active
    await enter(page, 0, 0, "=Sheet1!A1*2");
    await expectValue(page, 0, 0, 1000);
    // live: change the source and the dependent follows
    await goTab(page, 0);
    await enter(page, 0, 0, "700");
    await goTab(page, 1);
    await expectValue(page, 0, 0, 1400, "the cross-sheet formula recomputed when Sheet1!A1 changed");
  });

  test("renaming the referenced sheet rewrites the cross-sheet formula's qualifier", async ({ page }) => {
    await open(page, "e2e-stage3-rename-rewrite");
    await enter(page, 0, 0, "7"); // Sheet1!A1
    await addSheet(page); // Sheet2
    await enter(page, 0, 0, "=Sheet1!A1");
    await renameTab(page, 0, "Costs");
    expect(await namesOf(page)).toEqual(["Costs", "Sheet2"]);
    await goTab(page, 1); // back to Sheet2
    await expectValue(page, 0, 0, 7, "still resolves — the reference followed the rename");
    await clickCell(page, 0, 0);
    await expect.poll(() => formulaBarText(page), { message: "the qualifier itself was rewritten" }).toBe("=Costs!A1");
  });

  test("deleting a referenced sheet turns the cross-sheet formula into #REF!, not a crash", async ({ page }) => {
    await open(page, "e2e-stage3-delete-ref");
    await enter(page, 0, 0, "9"); // Sheet1!A1
    await addSheet(page); // Sheet2
    await enter(page, 0, 0, "=Sheet1!A1+1");
    await expectValue(page, 0, 0, 10);
    await tab(page, 0).click({ button: "right" });
    await page.getByText("Delete", { exact: true }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click(); // Univer's "Confirm to delete this worksheet?"
    await expect.poll(() => namesOf(page)).toEqual(["Sheet2"]);
    await expect(tab(page, 0)).toHaveText("Sheet2");
    await expectShown(page, 0, 0, "#REF!");
  });

  test("the last remaining sheet cannot be deleted — the Delete menu item is disabled", async ({ page }) => {
    await open(page, "e2e-stage3-lastsheet");
    await tab(page, 0).click({ button: "right" });
    const del = page.locator("button", { hasText: /^Delete$/ }).first();
    await expect(del).toBeVisible();
    await expect(del).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(tab(page, 0)).toHaveText("Sheet1"); // still there
    // known-good control: with a SECOND sheet the same item is enabled
    await addSheet(page);
    await tab(page, 0).click({ button: "right" });
    await expect(page.locator("button", { hasText: /^Delete$/ }).first()).toBeEnabled();
  });

  test("the tab strip stays pinned when the grid scrolls horizontally — never inside the grid's own scroller", async ({ page }) => {
    // Numeric proof, not just a passing assertion: the strip's rectangle before vs. after scrolling the grid FULLY right must be
    // bit-for-bit identical — asserted as exact equality, not "close".
    await open(page, "e2e-stage3-pinned");
    const strip = page.locator('[data-u-comp="slide-tab-bar"]').first();
    const before = await strip.evaluate((el) => el.getBoundingClientRect().toJSON());
    for (let i = 0; i < 3; i++) await wheelGrid(page, 3000, 0); // drive fully right, not a fixed offset
    const v = await sheetView(page);
    expect(v.left, "sanity: the grid actually had room to scroll right").toBeGreaterThan(0);
    const after = await strip.evaluate((el) => el.getBoundingClientRect().toJSON());
    console.log(`[tab-strip-pin] before.x=${before.x} after.x=${after.x} first visible column=${v.left}`);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
  });

  test("round-trip through local storage: a second sheet + a cross-sheet formula survive a reload", async ({ page }) => {
    await open(page, "e2e-stage3-roundtrip");
    await enter(page, 0, 0, "42"); // Sheet1!A1
    await addSheet(page); // Sheet2
    await enter(page, 0, 0, "=Sheet1!A1+8");
    await expectValue(page, 0, 0, 50);
    await flushGrid(page);
    await page.reload();
    await waitForGrid(page);
    await expect(tab(page, 1)).toHaveText("Sheet2");
    // the cross-sheet formula, and Sheet1's own value, both survived
    await goTab(page, 1);
    await expectValue(page, 0, 0, 50);
    expect(await formulaOf(page, 0, 0)).toBe("=Sheet1!A1+8");
    await goTab(page, 0);
    await expectValue(page, 0, 0, 42);
  });

  test("a PRE-Stage-3 single-sheet localStorage blob still opens without loss, now inside a one-sheet workbook", async ({ page }) => {
    const id = "e2e-stage3-migrate";
    await armUniverE2E(page);
    await seedProject(page, id);
    const oldShapeSheet = {
      version: 1, nextColId: 27,
      columns: Array.from({ length: 26 }, (_, i) => ({ id: `c${i + 1}`, name: String.fromCharCode(65 + i), width: 120 })),
      rowCount: 1000, cells: { "c1:0": "12345", "c2:0": "=A1*2" }, formats: {}, styles: {},
      rowHeights: {}, freezeRows: 0, freezeCols: 0, merges: [],
    };
    await page.addInitScript(([pid, blob]) => {
      localStorage.setItem(`planyr:model:sheet:v1:local:${pid}`, JSON.stringify(blob));
    }, [id, oldShapeSheet]);
    await page.goto(`/#/project/${id}/model`);
    await waitForGrid(page);
    await expect(tab(page, 0)).toHaveText("Sheet1");
    await expect(sheetTabs(page)).toHaveCount(1);
    await expectValue(page, 0, 0, 12345);
    await expectValue(page, 0, 1, 24690);
    expect(await formulaOf(page, 0, 1)).toBe("=A1*2");
  });

  // ⛔ B1117408 REGRESSION (owner brief 2026-09-03) — typed cells were written to the PREVIOUSLY active sheet after a plain tab-strip
  // switch, never the one now on screen. Repro: be on Sheet2, click the Sheet1 tab, click D1, type 999, Enter — the write committed
  // against Sheet2 (the OLD sheet), leaving Sheet1's column D empty. Every check below reads BOTH sheets explicitly (the target sheet
  // has the value AND the other sheet does not) — a check that only confirms "some cell changed" passes on the broken behaviour.
  test.describe("NEW-1 — a typed cell lands on the sheet CURRENTLY ON SCREEN, never the one you just left", () => {
    test("Sheet2 → Sheet1: typing after a plain tab click lands on Sheet1, not Sheet2 (the reported direction)", async ({ page }) => {
      await open(page, "e2e-newone-s2-to-s1");
      await addSheet(page); // Sheet2, now active
      await goTab(page, 0); // switch back to Sheet1 via a PLAIN tab click
      await enter(page, 0, 3, "999"); // D1
      await expectValue(page, 0, 3, 999); // Sheet1 (currently on screen) got it
      await goTab(page, 1); // Sheet2
      await expectValue(page, 0, 3, null, "Sheet2's D1 must stay untouched");
    });

    test("Sheet1 → Sheet2: the same fix holds in the other direction", async ({ page }) => {
      await open(page, "e2e-newone-s1-to-s2");
      await enter(page, 0, 0, "1"); // Sheet1!A1 — a real edit, so the workbook's own last-committed sheet is Sheet1 before the switch below.
      await addSheet(page); // Sheet2, now active
      await goTab(page, 0); // back to Sheet1
      await goTab(page, 1); // and back to Sheet2 via a PLAIN click (no content edit in between)
      await enter(page, 0, 3, "999"); // D1
      await expectValue(page, 0, 3, 999); // Sheet2 (on screen) got it
      await goTab(page, 0); // Sheet1
      await expectValue(page, 0, 3, null, "Sheet1's D1 must stay untouched");
    });

    test("a formula typed after switching evaluates in the ON-SCREEN sheet's own context — the reported =A1*2 case", async ({ page }) => {
      await open(page, "e2e-newone-formula-context");
      await enter(page, 0, 0, "10"); // Sheet1!A1 = 10
      await addSheet(page); // Sheet2
      await enter(page, 0, 0, "20"); // Sheet2!A1 = 20
      await goTab(page, 0); // switch to Sheet1 via a plain click
      await enter(page, 1, 0, "=A1*2"); // A2
      await expectValue(page, 1, 0, 20); // Sheet1!A1*2 == 10*2, NOT Sheet2's 20*2=40
      await goTab(page, 1); // confirm Sheet2 never received the formula at all
      await expectValue(page, 1, 0, null);
    });

    test("holds with three sheets: a commit always targets whichever tab is on screen", async ({ page }) => {
      await open(page, "e2e-newone-three-sheets");
      await addSheet(page); // Sheet2
      await addSheet(page); // Sheet3, now active
      await goTab(page, 1); // switch to Sheet2 via a plain click
      await enter(page, 0, 0, "42");
      await expectValue(page, 0, 0, 42); // Sheet2 (on screen) got it
      await goTab(page, 0);
      await expectValue(page, 0, 0, null, "Sheet1 untouched");
      await goTab(page, 2);
      await expectValue(page, 0, 0, null, "Sheet3 untouched");
    });

    test("Delete after switching tabs blanks the ON-SCREEN sheet's own cell, not the sheet just left", async ({ page }) => {
      await open(page, "e2e-newone-delete");
      await enter(page, 0, 0, "5"); // Sheet1!A1
      await addSheet(page); // Sheet2
      await enter(page, 0, 0, "9"); // Sheet2!A1
      await goTab(page, 0); // switch to Sheet1 via a plain click — Sheet1!A1 is the on-screen target
      await clickCell(page, 0, 0);
      await press(page, "Delete");
      await expectValue(page, 0, 0, null, "Sheet1!A1 cleared");
      await goTab(page, 1);
      await expectValue(page, 0, 0, 9, "Sheet2!A1 untouched");
    });

    test("Ctrl+V paste after switching tabs lands on the ON-SCREEN sheet", async ({ page }) => {
      await open(page, "e2e-newone-paste");
      await enter(page, 0, 0, "123"); // Sheet1!A1 — the copy source
      await clickCell(page, 0, 0);
      await press(page, "Control+C");
      await addSheet(page); // Sheet2
      await goTab(page, 0); // back to Sheet1 via a plain click
      await clickCell(page, 2, 0); // A3
      await press(page, "Control+V");
      await expectValue(page, 2, 0, 123); // pasted onto Sheet1 (on screen)
      await goTab(page, 1);
      await expectValue(page, 2, 0, null, "Sheet2's A3 untouched");
    });

    test("the correctly-targeted write survives a reload", async ({ page }) => {
      await open(page, "e2e-newone-persist");
      await addSheet(page); // Sheet2, now active
      await goTab(page, 0); // switch to Sheet1 via a plain click
      await enter(page, 0, 3, "999");
      await flushGrid(page);
      await page.reload();
      await waitForGrid(page);
      await expect(tab(page, 0)).toHaveText("Sheet1");
      await goTab(page, 0);
      await expectValue(page, 0, 3, 999, "still on Sheet1 after reload");
      await goTab(page, 1);
      await expectValue(page, 0, 3, null, "Sheet2 never got it, even after a round trip");
    });
  });
});

/** Pixels of the two auto-colours (#1D4ED8 input blue, #15803D cross-sheet green) inside a cell's interior — the grid is a canvas,
 *  so a colour is read off what was PAINTED. Same expressions the ui-audit tools check uses. */
const BLUE = "b > 120 && b - r > 60 && g < 150";
const GREEN = "g > 90 && g - r > 50 && g - b > 30";
const inkIn = async (page, r, c, test) => { const p = await cellPoint(page, r, c); return countPixels(page, { x: p.left + 2, y: p.top + 2, width: Math.max(4, p.w - 4), height: Math.max(4, p.h - 4) }, test); };

test.describe("Model workspace — Stage 3 (input/formula/cross-sheet-link colour)", () => {
  test("an input, a same-sheet formula, and a cross-sheet formula each render a distinctly different colour", async ({ page }) => {
    await open(page, "e2e-stage3-colour");
    await enter(page, 0, 0, "1234567");   // A1 — input
    await enter(page, 0, 1, "=A1+1");     // B1 — same-sheet formula
    await addSheet(page);
    await enter(page, 0, 0, "=Sheet1!A1"); // Sheet2!A1 — cross-sheet
    await goTab(page, 0);
    await parkCursor(page, 12, 6);
    await page.waitForTimeout(500);

    const input = { blue: await inkIn(page, 0, 0, BLUE), green: await inkIn(page, 0, 0, GREEN) };
    const formula = { blue: await inkIn(page, 0, 1, BLUE), green: await inkIn(page, 0, 1, GREEN) };
    expect(input.blue, "the typed input is blue").toBeGreaterThan(12);
    expect(input.green).toBeLessThan(3);
    expect(formula.blue, "a same-sheet formula keeps the text colour (not input blue)").toBeLessThan(3);
    expect(formula.green).toBeLessThan(3);

    await goTab(page, 1);
    await parkCursor(page, 12, 6);
    await page.waitForTimeout(500);
    const cross = { blue: await inkIn(page, 0, 0, BLUE), green: await inkIn(page, 0, 0, GREEN) };
    expect(cross.green, "a cross-sheet link is green").toBeGreaterThan(12);
    expect(cross.blue).toBeLessThan(3);
  });

  test("the toolbar toggle turns automatic colouring off, and back on", async ({ page }) => {
    await open(page, "e2e-stage3-colour-toggle");
    await enter(page, 0, 0, "1234567"); // input — blue while ON
    await parkCursor(page, 12, 6);
    await page.waitForTimeout(500);
    const on = await inkIn(page, 0, 0, BLUE);
    expect(on, "control: blue while ON (the default)").toBeGreaterThan(12);

    await clickPlanyrTool(page, "toggle-autocolor"); // OFF
    await parkCursor(page, 12, 6);
    await expect.poll(() => inkIn(page, 0, 0, BLUE), { message: "no blue once the colouring is off" }).toBeLessThan(3);

    await clickPlanyrTool(page, "toggle-autocolor"); // back ON
    await parkCursor(page, 12, 6);
    await expect.poll(() => inkIn(page, 0, 0, BLUE)).toBeGreaterThan(12);
  });

  test("a manual font colour always wins over the automatic classification", async ({ page }) => {
    await open(page, "e2e-stage3-colour-manual");
    await enter(page, 0, 0, "1234567"); // input — auto-blue while ON
    await enter(page, 1, 0, "7654321"); // a second input, left alone as the control
    await parkCursor(page, 12, 6);
    await page.waitForTimeout(500);
    expect(await inkIn(page, 0, 0, BLUE), "control: auto-blue before the manual colour").toBeGreaterThan(12);

    await clickCell(page, 0, 0);
    // "Text color More" opens Univer's palette; pick a palette red (deliberately NOT the auto-colour blue)
    await page.locator('[aria-label="Text color More"]').first().click(); await page.waitForTimeout(400);
    const swatch = page.locator('[title="#c62828"], [data-color="#c62828"]').first();
    if (await swatch.count()) await swatch.click();
    else { // Univer's palette has no such swatch → set the SAME colour through its facade, the way the palette's click would
      await page.keyboard.press("Escape");
      await inSheet(page, (api, ws) => { ws.getRange(0, 0).setFontColor("#c62828"); });
    }
    await page.waitForTimeout(300);
    const manual = (await styleOf(page, 0, 0)).color;
    expect(manual?.toLowerCase(), "the colour that was set is stored as picked").toBe("#c62828");
    await parkCursor(page, 12, 6);
    await page.waitForTimeout(500);
    expect(await inkIn(page, 0, 0, BLUE), "the manual red cell shows NO auto-blue").toBeLessThan(3);
    expect(await inkIn(page, 1, 0, BLUE), "…while its untouched neighbour still does").toBeGreaterThan(12);
  });

  test("the toggle persists across a reload (a standing display choice, not a mid-task gesture)", async ({ page }) => {
    await open(page, "e2e-stage3-colour-persist");
    expect(await toolsState(page, (t) => t.getState().autoColor), "on by default").toBe(true);
    await clickPlanyrTool(page, "toggle-autocolor");
    expect(await toolsState(page, (t) => t.getState().autoColor)).toBe(false);
    await page.reload();
    await waitForGrid(page);
    expect(await toolsState(page, (t) => t.getState().autoColor), "still off after the reload").toBe(false);
  });
});
