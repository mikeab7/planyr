/* Model workspace — live-browser verification of the vertical slice: virtualised rows,
 * rectangular selection, keyboard nav, the inline editor, the formula bar, number formats,
 * undo/redo, copy/paste/fill-down, block-jump navigation, and local-storage persistence.
 *
 * Seeds a throwaway local "project" (a Site Planner site group — a project IS one, see
 * src/shared/projects/projects.js) the same way e2e/callout-absolute-front.spec.js does,
 * rather than driving the map-based "New project" flow: that flow needs live GIS tile hosts
 * this sandbox blocks, and Model attaches to any project id regardless of what's drawn on it.
 * Nothing here is written to real production data — the site is a fresh id seeded into this
 * browser context's own localStorage only.
 *
 * ⛔ B891184-FOLLOWUP (2026-08-31): rewritten after live production testing (a real Excel user
 * driving the shipped v1 on planyr.io) found the whole per-COLUMN formula model was wrong — see
 * lib/sheetModel.js's header. This spec now proves per-CELL formulas, A1 references resolving
 * to real values (not a silent blank/0), copy/paste, Ctrl+D fill-down, and Ctrl+Home/End/Arrow
 * navigation — none of which existed in the first version. The three original bugs (type-to-
 * edit losing a keystroke, column rename fighting the global keydown handler, a NaN width
 * warning) stay guarded below; none of them were touched by this rewrite.
 *
 * Run: npx playwright test e2e/model-spreadsheet.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model e2e (throwaway)", name: "ZZ Model e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

async function renameCol(page, idx, name) {
  await page.getByTestId(`model-col-header-${idx}`).dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** The shared setup every test needs: a seeded project, on the Model route, with A1=500 and
 *  A2=300 (plain literals) — the minimal fixture per-cell-formula tests build on. */
async function openModelWithNumbers(page, siteId) {
  await seedProject(page, siteId);
  await page.goto(`/#/project/${siteId}/model`);
  await expect(sheetEl(page)).toBeVisible();
  await cell(page, 0, 0).click(); await typeAndEnter(page, "500"); // A1
  await cell(page, 1, 0).click(); await typeAndEnter(page, "300"); // A2
}

test.describe("Model workspace — spreadsheet vertical slice", () => {
  test("renders a sheet for an open project, straight from a deep link", async ({ page }) => {
    await seedProject(page, "e2e-model-boot");
    await page.goto("/#/project/e2e-model-boot/model");
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.getByTestId("model-col-header-0")).toHaveText("A");
  });

  test("typing a full number character-by-character does not lose the leading digit", async ({ page }) => {
    // Regression guard for the onFocus/select-all bug: a naive re-introduction selects the
    // type-to-edit seed character, and the next keystroke replaces it.
    await seedProject(page, "e2e-model-type");
    await page.goto("/#/project/e2e-model-type/model");
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "1000000");
    await expect(cell(page, 0, 0)).toHaveText("1000000");
  });

  test("column rename applies, and survives typing a multi-character name", async ({ page }) => {
    // Regression guard for the header-rename-vs-global-keydown bug.
    await seedProject(page, "e2e-model-rename");
    await page.goto("/#/project/e2e-model-rename/model");
    await renameCol(page, 0, "Revenue");
    await expect(page.getByTestId("model-col-header-0")).toContainText("Revenue");
  });

  // ⛔ THE CORE FIX, MEASURED: a formula in ONE cell must never touch a neighbour in its column.
  test("a formula lives in the ONE cell it was typed into — not the whole column", async ({ page }) => {
    const id = "e2e-model-percell";
    await openModelWithNumbers(page, id);
    await cell(page, 3, 0).click(); // A4 — independent of A1/A2
    await typeAndEnter(page, "=A1+A2");
    await expect(cell(page, 3, 0)).toHaveText("800");
    // A1 and A2 are UNCHANGED — no column-wide conversion happened.
    await expect(cell(page, 0, 0)).toHaveText("500");
    await expect(cell(page, 1, 0)).toHaveText("300");
  });

  // ⛔ THE SILENT-ZERO REGRESSION: a real A1 reference to a populated cell must resolve to its
  // value, and SUM over real cells must total correctly — not read blank/0.
  test("A1 references resolve to real values; SUM over real cells is never a silent 0", async ({ page }) => {
    const id = "e2e-model-a1refs";
    await openModelWithNumbers(page, id);
    await cell(page, 0, 2).click(); // C1
    await typeAndEnter(page, "=A1");
    await expect(cell(page, 0, 2)).toHaveText("500");
    await cell(page, 1, 2).click(); // C2
    await typeAndEnter(page, "=SUM(A1:A2)");
    await expect(cell(page, 1, 2)).toHaveText("800");
  });

  test("an unresolvable reference errors loudly (#NAME?) — never a blank or a silent 0", async ({ page }) => {
    const id = "e2e-model-unresolvable";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "=ZQXW999"); // out-of-bounds / not a valid address
    await expect(cell(page, 0, 0)).toHaveText("#NAME?");
  });

  test("the formula bar shows the underlying formula, never the displayed value", async ({ page }) => {
    const id = "e2e-model-formulabar";
    await openModelWithNumbers(page, id);
    await cell(page, 3, 0).click();
    await typeAndEnter(page, "=A1+A2");
    await cell(page, 3, 0).click();
    await expect(page.getByTestId("model-formula-bar")).toHaveValue("=A1+A2");
  });

  test("the ribbon's Number group applies to the CELL, not the whole column", async ({ page }) => {
    const id = "e2e-model-format";
    await openModelWithNumbers(page, id); // A1=500 (General), A2=300 (General)
    await cell(page, 0, 0).click();
    await page.getByTestId("ribbon-currency").click();
    await expect(cell(page, 0, 0)).toHaveText("$500.00");
    await expect(cell(page, 1, 0)).toHaveText("300"); // A2, same column, untouched
  });

  test("numbers right-align, text left-aligns", async ({ page }) => {
    const id = "e2e-model-align";
    await openModelWithNumbers(page, id);
    await cell(page, 2, 0).click();
    await typeAndEnter(page, "Land cost");
    const numAlign = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).justifyContent);
    const textAlign = await cell(page, 2, 0).evaluate((el) => getComputedStyle(el).justifyContent);
    expect(numAlign).toBe("flex-end");
    expect(textAlign).toBe("flex-start");
  });

  test("shift-click makes a rectangular selection distinct from unselected cells", async ({ page }) => {
    const id = "e2e-model-select";
    await openModelWithNumbers(page, id);
    await cell(page, 0, 0).click();
    await page.keyboard.down("Shift");
    await cell(page, 1, 1).click();
    await page.keyboard.up("Shift");
    const selBg = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).backgroundColor);
    const outsideBg = await cell(page, 0, 2).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(selBg).not.toBe(outsideBg);
  });

  test("Delete blanks the selected range — including a formula cell — and Ctrl+Z restores it", async ({ page }) => {
    const id = "e2e-model-undo";
    await openModelWithNumbers(page, id);
    await cell(page, 0, 0).click();
    await page.keyboard.press("Delete");
    await expect(cell(page, 0, 0)).toHaveText("");
    await page.keyboard.press("Control+z");
    await expect(cell(page, 0, 0)).toHaveText("500");
  });

  test("Tab commits the edit and advances one column right", async ({ page }) => {
    const id = "e2e-model-tab";
    await openModelWithNumbers(page, id);
    await cell(page, 2, 0).click();
    await page.keyboard.type("500000");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-col", "1");
  });

  test("Ctrl+C / Ctrl+V copies a cell's value to a new location", async ({ page }) => {
    const id = "e2e-model-copypaste";
    await openModelWithNumbers(page, id);
    await cell(page, 0, 0).click();
    await page.keyboard.press("Control+c");
    await cell(page, 0, 3).click(); // D1
    await page.keyboard.press("Control+v");
    await expect(cell(page, 0, 3)).toHaveText("500");
  });

  test("Ctrl+D fills the selection's top row down, shifting relative references", async ({ page }) => {
    const id = "e2e-model-filldown";
    await openModelWithNumbers(page, id);
    await cell(page, 5, 0).click(); // A6
    await typeAndEnter(page, "=A1+1");
    await cell(page, 5, 0).click();
    await page.keyboard.down("Shift");
    await cell(page, 7, 0).click();
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+d");
    await expect(cell(page, 5, 0)).toHaveText("501");   // A6 =A1+1, A1=500
    await expect(cell(page, 6, 0)).toHaveText("301");   // A7 =A2+1, A2=300 (filled, shifted)
    await expect(cell(page, 7, 0)).toHaveText("1");     // A8 =A3+1, A3 blank -> 0+1
    await cell(page, 6, 0).click();
    await expect(page.getByTestId("model-formula-bar")).toHaveValue("=A2+1");
  });

  test("Ctrl+Home jumps to A1; Ctrl+End jumps to the last used cell", async ({ page }) => {
    const id = "e2e-model-ctrlhomeend";
    await openModelWithNumbers(page, id);
    await cell(page, 5, 2).click();
    await typeAndEnter(page, "x");
    await cell(page, 1, 0).click();
    await page.keyboard.press("Control+Home");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-row", "0");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-col", "0");
    await page.keyboard.press("Control+End");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-row", "5");
    await expect(page.getByTestId("model-active-cell")).toHaveAttribute("data-col", "2");
  });

  test("long text spills across an empty neighbour instead of hard-clipping", async ({ page }) => {
    const id = "e2e-model-spill";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "Total development cost including land carry");
    await expect(cell(page, 0, 0)).toHaveText("Total development cost including land carry");
  });

  test("row virtualization: only a bounded slice of rows is in the DOM after a deep scroll", async ({ page }) => {
    const id = "e2e-model-virtualized";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await sheetEl(page).evaluate((el) => { el.scrollTop = 20000; });
    await expect(async () => {
      const rowCount = await page.locator("[data-row]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("data-row"))).size);
      expect(rowCount).toBeLessThan(80);
      expect(rowCount).toBeGreaterThan(0);
    }).toPass();
    const scrollTop = await sheetEl(page).evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(5000); // proves the scroll actually moved, not stuck at 0
  });

  test("a row reached only by scrolling is genuinely editable, and the sheet survives a reload", async ({ page }) => {
    const id = "e2e-model-reload";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "1000000");
    await sheetEl(page).evaluate((el) => { el.scrollTop = 20000; });
    // The scroll is programmatic and settles within a frame or two, but reading the rendered
    // row window before React's own scroll-driven re-render has committed is a VOID
    // measurement (DRIVER-SCROLL-IS-NOT-APP-SCROLL) — poll until it reflects rows deep enough
    // to prove the scroll actually took, the same pattern the virtualization test above uses.
    let rows = [];
    await expect(async () => {
      rows = await page.locator("[data-row]").evaluateAll((els) => [...new Set(els.map((e) => Number(e.getAttribute("data-row"))))].sort((a, b) => a - b));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toBeGreaterThan(300);
    }).toPass();
    const deepRow = rows[Math.floor(rows.length / 2)];
    await cell(page, deepRow, 0).click();
    await typeAndEnter(page, "deep-row-marker");
    await expect(cell(page, deepRow, 0)).toHaveText("deep-row-marker");

    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(cell(page, 0, 0)).toHaveText("1000000");
  });

  test("the Undo button is disabled on a fresh load, even when the project already has data", async ({ page }) => {
    const id = "e2e-model-undo-fresh-load";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "hello");
    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  });

  test("column count extends past the original 8-column default", async ({ page }) => {
    const id = "e2e-model-columns";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    const start = await page.locator('[data-testid^="model-col-header-"]').count();
    await page.getByTestId("model-add-column").click();
    await page.getByTestId("model-add-column").click();
    await expect(page.locator('[data-testid^="model-col-header-"]')).toHaveCount(start + 2);
  });
});

/* ⛔ STAGE 1 (owner report, 2026-09-01 — "this should be a full blown model") — the grid grows
 * up (26-column / 1000-row default, extending past both on demand) and gains real structural
 * editing: insert/delete row AND column with formulas re-anchoring sheet-wide (not just the
 * cells that moved — proven below by reading the actual recomputed number back, never by
 * asserting a control exists), freeze panes, drag-resize + autofit, right-click context menus,
 * a Name Box (type an address, jump there / Ctrl+G), and Find/Replace (Ctrl+F / Ctrl+H).
 */
test.describe("Model workspace — Stage 1 (grid capacity, structural editing, freeze, find/replace)", () => {
  test("the default sheet starts at 26 columns (A..Z) and never caps at H", async ({ page }) => {
    const id = "e2e-stage1-columns";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.locator('[data-testid^="model-col-header-"]')).toHaveCount(26);
    await expect(page.getByTestId("model-col-header-25")).toHaveText("Z");
  });

  test("inserting a row via the row-header context menu GROWS a SUM range that spans it, and deleting it back SHRINKS the range back — read the actual number, not the control", async ({ page }) => {
    const id = "e2e-stage1-insert-row";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 1).click(); await typeAndEnter(page, "5000000");  // B1 Land
    await cell(page, 1, 1).click(); await typeAndEnter(page, "20000000"); // B2 Hard costs
    await cell(page, 2, 1).click(); await typeAndEnter(page, "3000000");  // B3 Soft costs
    await cell(page, 4, 1).click(); await typeAndEnter(page, "=SUM(B1:B3)"); // B5 Total
    await expect(cell(page, 4, 1)).toHaveText("28000000");

    // Right-click the row-2 header ("Hard costs") — Insert row above.
    await page.getByTestId("model-row-header-1").click({ button: "right" });
    await page.getByText("Insert row above", { exact: true }).click();
    await cell(page, 1, 1).click(); await typeAndEnter(page, "1000000"); // new row 2: Contingency
    // The Total's SUM formula (now one row down, at B6) must have grown to include the new row.
    await expect(cell(page, 5, 1)).toHaveText("29000000");

    // Delete that same row back out via the row-header menu.
    await page.getByTestId("model-row-header-1").click({ button: "right" });
    await page.getByText("Delete row", { exact: true }).click();
    await expect(cell(page, 4, 1)).toHaveText("28000000");
  });

  test("inserting a column via the column-header context menu shifts the cell content AND a formula's own column reference", async ({ page }) => {
    const id = "e2e-stage1-insert-col";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 1).click(); await typeAndEnter(page, "Amount"); // B1
    await cell(page, 1, 1).click(); await typeAndEnter(page, "=B1");    // B2, self-referencing column B by address

    await page.getByTestId("model-col-header-1").click({ button: "right" });
    await page.getByText("Insert column left", { exact: true }).click();
    await expect(page.locator('[data-testid^="model-col-header-"]')).toHaveCount(27);
    // "Amount" (the row-0 cell content) followed its column from B to C.
    await expect(cell(page, 0, 2)).toHaveText("Amount");
    // The formula that read "B1" must now read "C1" — proven by its VALUE still resolving
    // correctly to "Amount" at its new home (C2), not by inspecting the formula text.
    await expect(cell(page, 1, 2)).toHaveText("Amount");
  });

  test("the Name Box accepts a typed address and jumps there; Ctrl+G focuses it", async ({ page }) => {
    const id = "e2e-stage1-namebox";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    const nameBox = page.getByTestId("model-name-box");
    await nameBox.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("J50");
    await page.keyboard.press("Enter");
    const active = page.getByTestId("model-active-cell");
    await expect(active).toHaveAttribute("data-row", "49");
    await expect(active).toHaveAttribute("data-col", "9");

    // Control+Home rather than re-clicking cell(0,0) directly: the jump to J50 scrolled row 0 /
    // col 0 out of the virtualized window (only the visible slice of rows/cols is in the DOM), so
    // a locator for it times out — Control+Home both scrolls back and re-establishes a known
    // active cell in one native keystroke, same pattern the Ctrl+Home/End test above already uses.
    // Click the ACTIVE cell itself, not the whole "model-sheet" container — a blind click on the
    // container's own bounding-box centre can land below the last virtualized row at some scroll
    // depths/viewports, on empty space with nothing to catch focus, so Control+Home silently goes
    // nowhere (found live by the range/invalid-input test beside this one).
    await active.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+g");
    await expect(nameBox).toBeFocused();
  });

  // B1007280 — owner report, relayed verbatim: "I typed C50 into the name box and pressed
  // Enter. It selected column C and put me at C1. The row part was parsed and discarded."
  // Extensive live testing (direct type, Ctrl+G entry, slow/paused typing, double-click and
  // edge-click focus) could not reproduce that on current code — every path correctly landed
  // on row 50 — so this is not a fix for a reproduced defect; it locks in the CORRECT behavior
  // going forward, plus the two genuinely new pieces the same report asked for: range support
  // and a visible refusal for an address that doesn't resolve.
  test("Name Box: a range like C50:E60 selects that block; an unresolvable address refuses visibly, never silently lands wrong", async ({ page }) => {
    const id = "e2e-stage1-namebox-range";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    const nameBox = page.getByTestId("model-name-box");
    const active = page.getByTestId("model-active-cell");

    // A range jumps to its top-left corner and selects the whole rectangle — read back an
    // actual cell inside the range as proof, not just the anchor's own coordinates.
    await nameBox.click();
    await page.keyboard.type("C50:E60");
    await page.keyboard.press("Enter");
    await expect(active).toHaveAttribute("data-row", "49");
    await expect(active).toHaveAttribute("data-col", "2");
    await expect(page.locator('[data-row="55"][data-col="3"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-row="49"][data-col="1"]')).not.toHaveAttribute("data-selected", "true");

    // The corners typed in the OTHER order resolve to the identical rectangle.
    // Click the ACTIVE cell itself (guaranteed rendered — we just navigated there) rather than
    // blindly clicking the whole "model-sheet" container: at this scroll depth its own
    // bounding-box centre can land below the last virtualized row, on genuinely empty space
    // with no cell underneath to catch focus, so Control+Home would silently go nowhere (a
    // real bug this test caught in ITSELF, not in the app — same lesson as the row-header
    // testid needed for Stage 1's own context-menu tests).
    await active.click();
    await page.keyboard.press("Control+Home");
    await nameBox.click();
    await page.keyboard.type("E60:C50");
    await page.keyboard.press("Enter");
    await expect(active).toHaveAttribute("data-row", "49");
    await expect(active).toHaveAttribute("data-col", "2");

    // An address the sheet has no cell for (past its current 26-column width) refuses WHOLE —
    // the selection stays exactly where it was, and the box visibly flags the refusal rather
    // than silently doing nothing.
    await active.click();
    await page.keyboard.press("Control+Home");
    await nameBox.click();
    await page.keyboard.type("C50:QQ");
    await page.keyboard.press("Enter");
    await expect(active).toHaveAttribute("data-row", "0");
    await expect(active).toHaveAttribute("data-col", "0");
    await expect(nameBox).toHaveAttribute("data-invalid", "true");
    await expect(nameBox).toHaveValue("A1");
    await expect(nameBox).toBeFocused(); // stays focused so the user can immediately retype, like Excel
    await expect(nameBox).not.toHaveAttribute("data-invalid", "true", { timeout: 2000 }); // clears itself
  });

  test("Ctrl+F finds every cell containing the search text, case-insensitive, across the sheet", async ({ page }) => {
    const id = "e2e-stage1-find";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "Revenue 2026");
    await cell(page, 3, 2).click(); await typeAndEnter(page, "revenue growth");
    await cell(page, 1, 0).click(); await typeAndEnter(page, "Cost");

    await page.keyboard.press("Control+f");
    await page.getByTestId("model-find-input").fill("revenue");
    await expect(page.getByTestId("model-find-count")).toHaveText("1/2");
  });

  test("Ctrl+H Replace All rewrites every matching cell's text in one pass", async ({ page }) => {
    const id = "e2e-stage1-replace";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "Land Cost");
    await cell(page, 1, 0).click(); await typeAndEnter(page, "Total Cost");

    await page.keyboard.press("Control+h");
    await page.getByTestId("model-find-input").fill("Cost");
    await page.getByTestId("model-replace-input").fill("Expense");
    await page.getByTestId("model-replace-all").click();
    await expect(cell(page, 0, 0)).toHaveText("Land Expense");
    await expect(cell(page, 1, 0)).toHaveText("Total Expense");
  });

  test("freezing the top row keeps it visible after scrolling deep into the sheet, and Unfreeze releases it", async ({ page }) => {
    const id = "e2e-stage1-freeze";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "Header Row");

    await page.getByTestId("model-row-header-0").click({ button: "right" });
    await page.getByText("Freeze top row", { exact: true }).click();

    await sheetEl(page).evaluate((el) => { el.scrollTop = 8000; });
    await expect(cell(page, 0, 0)).toBeVisible();
    await expect(cell(page, 0, 0)).toHaveText("Header Row");

    await cell(page, 0, 0).click({ button: "right" });
    await page.getByText("Unfreeze panes", { exact: true }).click();
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });
  });

  test("dragging a column header's right edge resizes the column; double-click autofits it", async ({ page }) => {
    const id = "e2e-stage1-colresize";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 1).click(); await typeAndEnter(page, "A modestly long value for autofit");

    const header = page.getByTestId("model-col-header-1");
    const before = await header.boundingBox();
    await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width + 100, before.y + before.height / 2);
    await page.mouse.up();
    const afterDrag = await header.boundingBox();
    expect(afterDrag.width).toBeGreaterThan(before.width + 60);

    // Double-click the narrow resize-handle strip at the header's right edge, not the header's
    // center — the center has its OWN double-click (rename the column) and a plain `.dblclick()`
    // (which targets the locator's bounding-box center) would hit that instead of autofit, same
    // as real Excel: double-clicking a column header's body does not autofit, only its border does.
    await page.mouse.dblclick(afterDrag.x + afterDrag.width - 2, afterDrag.y + afterDrag.height / 2);
    const afterAutofit = await header.boundingBox();
    // Autofit sizes to the actual rendered text, not to wherever the drag happened to land.
    expect(afterAutofit.width).not.toBe(afterDrag.width);
    expect(afterAutofit.width).toBeGreaterThan(40);
  });

  // B1007280 — owner verbatim: "ctrl zoom should be captured by the spreadsheet not the
  // webpage." Covers the core guarantee (the grid scales, the page doesn't) plus the two
  // failure modes a live-verification pass actually caught while building this: freeze-pane
  // offsets staying correct at a non-100% zoom, and a drag-resize at a non-100% zoom storing a
  // LOGICAL (zoom-independent) width rather than the raw screen-pixel delta.
  test("Ctrl+wheel zooms the sheet, never the browser page; freeze offsets and drag-resize stay correct at 50%/200%", async ({ page }) => {
    const id = "e2e-stage1-zoom";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    const zoomLevel = page.getByTestId("model-zoom-level");
    const zoomOut = page.getByTestId("model-zoom-out");
    const zoomIn = page.getByTestId("model-zoom-in");
    await expect(zoomLevel).toHaveText("100%");

    // Ctrl+wheel over the grid changes the SHEET's own zoom, never the browser page's.
    const pageZoomBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    await page.mouse.move(700, 400);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    const pageZoomAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoomAfter).toBe(pageZoomBefore);
    await expect(async () => {
      expect(parseInt(await zoomLevel.textContent(), 10)).toBeGreaterThan(100);
    }).toPass();

    // A plain wheel (no modifier) never zooms — it scrolls, exactly as before this feature.
    await zoomLevel.click(); // reset to 100%
    await page.mouse.wheel(0, 100);
    await expect(zoomLevel).toHaveText("100%");
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; });

    // Real measured cell/header dimensions at 200% are ~2x the 100% values — not just "bigger."
    const at100 = await cell(page, 0, 0).boundingBox();
    for (let i = 0; i < 10; i++) await zoomIn.click(); // 100% -> 200%, the +/- buttons' own path
    await expect(zoomLevel).toHaveText("200%");
    const at200 = await cell(page, 0, 0).boundingBox();
    expect(at200.width).toBeGreaterThan(at100.width * 1.9);
    expect(at200.height).toBeGreaterThan(at100.height * 1.9);

    // Freeze panes: right-click a cell BELOW/RIGHT of what should freeze (Excel's own "freeze
    // panes" semantics — everything above/left of the clicked cell), scroll deep, and the
    // frozen top-left cell must still sit exactly at the sheet's own header/gutter edge, not
    // just "somewhere still visible."
    await cell(page, 1, 1).click({ button: "right" });
    await page.getByText("Freeze panes", { exact: true }).click();
    await sheetEl(page).evaluate((el) => { el.scrollTop = 3000; el.scrollLeft = 500; });
    await expect(cell(page, 0, 0)).toBeVisible();
    const frozenBox = await cell(page, 0, 0).boundingBox();
    const sheetBox = await sheetEl(page).boundingBox();
    const headerH = await page.getByTestId("model-col-header-0").evaluate((el) => el.getBoundingClientRect().height);
    const rowHeaderW = await page.getByTestId("model-row-header-0").evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(frozenBox.y - (sheetBox.y + headerH))).toBeLessThan(3);
    expect(Math.abs(frozenBox.x - (sheetBox.x + rowHeaderW))).toBeLessThan(3);

    // Clean up freeze/scroll before the resize check below.
    await cell(page, 0, 0).click({ button: "right" });
    await page.getByText("Unfreeze panes", { exact: true }).click();
    await sheetEl(page).evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; });

    // Drag-resize at 200% zoom: a +100 SCREEN-px drag must commit a +50 LOGICAL px change —
    // reading back at 100% proves the stored width is zoom-independent, not the raw drag delta.
    const headerB = page.getByTestId("model-col-header-1");
    const beforeDrag = await headerB.boundingBox();
    await page.mouse.move(beforeDrag.x + beforeDrag.width - 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width + 100, beforeDrag.y + beforeDrag.height / 2, { steps: 5 });
    await page.mouse.up();
    await zoomLevel.click(); // back to 100%
    await expect(zoomLevel).toHaveText("100%");
    const afterDragAt100 = await headerB.boundingBox();
    expect(Math.abs(afterDragAt100.width - (beforeDrag.width / 2 + 50))).toBeLessThan(4);
  });
});

/* ⛔ B1076480 (owner report, 2026-09-02 — "USE THE MODULE LIKE A PERSON") — three real bugs found
 * by clicking the live module in a non-resting state, none of which any prior test in this file
 * could have caught (every context-menu test above only asserts an item's CLICK fires, never that
 * the menu itself is visible/positioned/dismissible correctly) — plus a fourth found while fixing
 * the first: the "keep the active cell on screen" auto-scroll can immediately close a context menu
 * it never should have touched. Raw `page.mouse` coordinate clicks are used for the "menu already
 * open" cases deliberately, not `locator.click({button:"right"})` — Playwright's own actionability
 * check refuses to even attempt a click through an existing backdrop (a real DIFFERENT question
 * from what a genuine right-click does, since the browser hit-tests mousedown and contextmenu
 * separately, at their own dispatch times — see DRIVER-SCROLL-IS-NOT-APP-SCROLL in CLAUDE.md).
 */
test.describe("Model workspace — B1076480 (context-menu chrome, positioning, dead-click, self-dismiss)", () => {
  async function rightClickAt(page, locator) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    return box;
  }

  test("a right-click context menu renders opaque chrome — background, border, shadow — never bare text floating over the grid", async ({ page }) => {
    const id = "e2e-b1032840-chrome";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await page.getByTestId("model-row-header-5").click({ button: "right" });
    const menu = page.locator(".menu");
    await expect(menu).toBeVisible();
    const style = await menu.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, border: cs.borderStyle, boxShadow: cs.boxShadow };
    });
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.border).not.toBe("none");
    expect(style.boxShadow).not.toBe("none");
  });

  test("the menu opens anchored at the click point, not hard-pinned to the viewport's left edge", async ({ page }) => {
    const id = "e2e-b1032840-position";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    // A ROW header sits at the sticky-left gutter (~9px from the edge) — indistinguishable by
    // x-position alone from the regression's hard clamp to the ~8px viewport margin. Column F
    // (index 5) sits several hundred px in, so a clamp-to-margin regression is unmissable here.
    const colHeader = page.getByTestId("model-col-header-5");
    const box = await colHeader.boundingBox();
    expect(box.x).toBeGreaterThan(300); // sanity: this target really is far from the left edge
    await colHeader.click({ button: "right" });
    const menu = page.locator(".menu");
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    // The regression pinned the menu to the ~8px viewport margin regardless of click position;
    // a correctly anchored menu opens within a small gap of the actual header's left edge.
    expect(Math.abs(menuBox.x - box.x)).toBeLessThan(250);
  });

  test("right-clicking a DIFFERENT header while a menu is already open opens the new menu — not a dead click swallowed by the old menu's backdrop", async ({ page }) => {
    const id = "e2e-b1032840-deadclick";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await rightClickAt(page, page.getByTestId("model-row-header-5"));
    const menu = page.locator(".menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Insert row above"); // the ROW menu opened
    await rightClickAt(page, page.getByTestId("model-col-header-1"));
    // The regression left the STALE row menu standing (its backdrop silently ate the second
    // right-click — a real click event target check, not a position heuristic that a stale
    // menu near the left gutter could satisfy by coincidence): the menu must now show the
    // COLUMN items, proving it genuinely reopened rather than surviving untouched.
    await expect(menu).toContainText("Insert column left");
    await expect(menu).not.toContainText("Insert row above");
  });

  test("the same header right-clicked twice in a row keeps showing a menu, never hangs", async ({ page }) => {
    const id = "e2e-b1032840-doubleclick";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const colB = page.getByTestId("model-col-header-1");
    await rightClickAt(page, colB);
    await expect(page.locator(".menu")).toBeVisible();
    await rightClickAt(page, colB);
    await expect(page.locator(".menu")).toBeVisible();
  });

  test("a context menu near a viewport edge FLIPS to stay fully on screen, rather than merely clamping over the click point", async ({ page }) => {
    const id = "e2e-b1032840-flip";
    await page.setViewportSize({ width: 900, height: 500 });
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    // Row 15 (index 14) sits right at the bottom edge of this small viewport.
    const rowHeader = page.getByTestId("model-row-header-14");
    const box = await rowHeader.boundingBox();
    await rightClickAt(page, rowHeader);
    const menu = page.locator(".menu");
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(500);
    expect(menuBox.y).toBeLessThan(box.y); // opened ABOVE the click point — a real flip, not a clamp
  });

  test("right-clicking a row that requires auto-scrolling itself into view does not immediately self-dismiss the menu it just opened", async ({ page }) => {
    const id = "e2e-b1032840-selfscroll";
    await page.setViewportSize({ width: 900, height: 500 });
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const rowHeader = page.getByTestId("model-row-header-14"); // the last partially-cut row
    await rightClickAt(page, rowHeader);
    // Give the "keep active cell on screen" auto-scroll (and the deferred scroll-dismiss arm) a
    // full beat to fire — the regression closed the menu within ~10-15ms of it opening.
    await page.waitForTimeout(300);
    await expect(page.locator(".menu")).toBeVisible();

    // And a GENUINE later scroll still dismisses it — the fix must not disable real dismissal.
    await sheetEl(page).evaluate((el) => {
      el.scrollTop += 200;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(page.locator(".menu")).toBeHidden();
  });

  // ⛔ MUTATION-TESTED HONESTLY, per the owner's explicit instruction that a check proving nothing
  // must be labelled as such: this spec stays GREEN even with ModelApp.jsx's own fix fully reverted
  // — `ProjectBreadcrumb.jsx` (the shared component ModelApp feeds `currentProject` into) already
  // warms and self-heals its OWN internal project list independently on mount + on any `storage`
  // event, so simulating "the cache got updated" here is satisfied by ProjectBreadcrumb alone and
  // cannot isolate ModelApp's own contribution. It IS still a real, valid regression guard for the
  // USER-VISIBLE symptom (the breadcrumb must not stay stuck on "Project" forever once the device's
  // project cache catches up) — just not proof that THIS file's change specifically matters.
  // ModelApp's own contribution (why warmProjectsIfEmpty alone, what Notes/Scheduler use, is not
  // enough — B853266's documented "diverged but non-empty cache" gap) is mutation-proven instead by
  // the source guard in test/modelBreadcrumbWarm.test.js.
  test("the breadcrumb does not stay stuck on 'Project' forever — it self-heals once the on-device project cache catches up", async ({ page }) => {
    // ⛔ Pre-seeding localStorage via addInitScript BEFORE navigation (as every other test in this
    // file does, and as this test itself originally did) makes the on-device cache warm from the
    // very first render — the exact condition the real bug needed to be ABSENT to reproduce.
    // Every prior manual repro attempt against this bug made the identical mistake (see the
    // session's repro-bugs.mjs). The real failure is a COLD cache at mount: nothing seeded yet,
    // so listProjects() returns nothing for this id and the breadcrumb falls back to "Project" —
    // then a cache warm (a cloud pull in production; here, a same-tab write + the same synthetic
    // `storage` event notifyProjectsChanged() dispatches) must update the breadcrumb WITHOUT a
    // reload.
    const id = "e2e-b1032840-breadcrumb";
    await page.goto(`/#/project/${id}/model`); // no seed — the cache for this id is genuinely cold
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.getByText("Project", { exact: true }).first()).toBeVisible();

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
    await expect(page.getByText("Project", { exact: true })).not.toBeVisible();
  });

  test("right-clicking INSIDE an existing multi-cell selection preserves it — the context menu acts on the whole range, not just the clicked cell", async ({ page }) => {
    // Found while screenshotting every transient surface open (not at rest): a multi-cell drag
    // selection collapsed to a single cell the instant it was right-clicked, because the cell's
    // onMouseDown handler ran cellClick() unconditionally for ANY button — so "Delete rows" from
    // the menu that followed would have silently acted on one cell instead of the range the user
    // deliberately built.
    const id = "e2e-b1032840-preserve-multiselect";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 1, 1).click();
    await page.keyboard.down("Shift");
    await cell(page, 3, 3).click();
    await page.keyboard.up("Shift");
    await expect(cell(page, 2, 2)).toHaveAttribute("data-selected", "true");
    await expect(cell(page, 1, 1)).toHaveAttribute("data-selected", "true");
    await expect(cell(page, 3, 3)).toHaveAttribute("data-selected", "true");
    await cell(page, 2, 2).click({ button: "right" }); // inside the B2:D4 range
    // Still the whole range, not collapsed to just (2,2):
    await expect(cell(page, 1, 1)).toHaveAttribute("data-selected", "true");
    await expect(cell(page, 3, 3)).toHaveAttribute("data-selected", "true");
    const menu = page.locator(".menu");
    await expect(menu).toContainText("Delete rows"); // plural — proves the menu saw the range
    await expect(menu).toContainText("Delete columns");
  });

  test("dragging the fill handle straight down fills every cell it passes over — not just the neighboring column", async ({ page }) => {
    // Found while screenshotting the fill-handle mid-drag: the handle sits at the cell's own
    // bottom-right corner, straddling the border with the NEXT column by design (so it renders
    // in the right visual spot) — but the cell's own `overflow: hidden` (needed to ellipsis-clip
    // long text against an occupied neighbor) also clipped the handle out of HIT-TESTING at that
    // same boundary, so a press on the handle's own visible right/bottom half silently landed on
    // the next column's cell instead of starting the fill drag. A straight-down drag from the
    // handle filled nothing at all.
    const id = "e2e-b1032840-fillhandle";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 4).click(); // E1
    await typeAndEnter(page, "10");
    await cell(page, 0, 4).click();
    const fillHandle = page.getByTestId("model-fill-handle");
    const fhBox = await fillHandle.boundingBox();
    const startX = fhBox.x + fhBox.width / 2, startY = fhBox.y + fhBox.height / 2;
    const e4Box = await cell(page, 3, 4).boundingBox();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      const y = startY + (e4Box.y + e4Box.height / 2 - startY) * (i / 5);
      await page.mouse.move(startX, y); // purely vertical — same X throughout
    }
    await page.mouse.up();
    await expect(cell(page, 1, 4)).toHaveText("10"); // E2
    await expect(cell(page, 2, 4)).toHaveText("10"); // E3
    await expect(cell(page, 3, 4)).toHaveText("10"); // E4
    await expect(cell(page, 0, 5)).toHaveText(""); // F1 — the neighboring column untouched
  });

  test("freezing BOTH rows and columns together, then scrolling deep, never lets a scrolled-past row's number overpaint a frozen row's own label", async ({ page }) => {
    // Found while screenshotting the frozen-pane boundary scrolled away from the top-left (the
    // sweep's #21): the frozen rows' data stayed correct and visible, but their OWN row-number
    // labels in the left gutter got silently overpainted by whatever row had scrolled underneath
    // — e.g. frozen row 1 (holding real data) displaying the label "37". Root cause: the row-
    // header gutter cell's z-index was a flat 2 for every row, frozen or scrolling; a frozen
    // row's `position:sticky` + explicit z-index makes it a real stacking context, trapping that
    // z-index:2 inside it, while a SCROLLING row (`position:absolute`, wrapper z-index:"auto")
    // has no such context, so ITS z-index:2 header escapes to compete directly against the
    // frozen row's own wrapper z-index — a tie broken by DOM order, which scrolling rows always
    // win since they render after the frozen band. A user could easily edit the wrong row while
    // believing its label.
    const id = "e2e-b1032840-freeze-both";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "ROW0");
    await cell(page, 1, 0).click(); await typeAndEnter(page, "ROW1");
    await cell(page, 2, 2).click({ button: "right" }); // freezes rows 0-1 AND columns A-B
    await page.getByText("Freeze panes", { exact: true }).click();
    await sheetEl(page).evaluate((el) => { el.scrollTop = 800; el.scrollLeft = 400; });
    await page.waitForTimeout(200);
    await expect(page.getByTestId("model-row-header-0")).toHaveText("1");
    await expect(page.getByTestId("model-row-header-1")).toHaveText("2");
    // The frozen row's own header must win the hit-test at its own screen position — not
    // whatever scrolling row's raw (freeze-unaware) absolute position happens to land there.
    const topmostAtFrozenHeader = await page.evaluate(() => {
      const el = document.getElementById("model-row-header-0") || document.querySelector('[data-testid="model-row-header-0"]');
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top ? top.getAttribute("data-testid") : null;
    });
    expect(topmostAtFrozenHeader).toBe("model-row-header-0");
  });
});

/* ⛔ B1106256 (owner report, 2026-09-03 — "a click next to an open menu is swallowed") — the
 * ribbon's AnchoredMenu-based dropdowns (font family, font size, number format, borders, …) used
 * to dismiss via a full-viewport interactive backdrop that itself intercepted the very press
 * meant to reach whatever was underneath it (a different ribbon button, or a re-press of the
 * SAME trigger). Two failure paths, both fixed by removing the backdrop entirely in favor of a
 * document-level, capture-phase `mousedown` listener (shared/ui/AnchoredMenu.jsx):
 *   - post-#1371: the backdrop closed on its own `onMouseDown`, unmounting between mousedown and
 *     mouseup, so the underlying control's native `click` never fired at all (mousedown/mouseup
 *     need a shared target).
 *   - pre-#1371: the backdrop closed on `onClick` alone, so a right-click's mousedown landed ON
 *     the backdrop and stayed there through mouseup (click never fires for the secondary button
 *     per spec) — the backdrop, still topmost, then won the browser's own `contextmenu` hit-test.
 * Raw `page.mouse` coordinate sequences are used throughout, never a bare `locator.click()`, for
 * the same reason e2e/model-spreadsheet.spec.js's B1076480 suite above does: the whole bug is
 * about whether a REAL mousedown→mouseup→click(or contextmenu) sequence resolves correctly once
 * a menu starts closing mid-gesture, which a synthetic `element.click()` can't reproduce or
 * disprove (Playwright's `locator.click()`/`page.mouse.*` dispatch real, CDP-level input and are
 * not the "synthetic .click()" this concern is about — used here for full control over exactly
 * where each down/up lands).
 */
test.describe("Model workspace — B1106256 (a click next to an open menu is no longer swallowed)", () => {
  async function openFontFamilyMenu(page) {
    await page.getByTitle("Font family").click();
    const menu = page.locator(".menu", { hasText: "Arial" });
    await expect(menu).toBeVisible();
    return menu;
  }

  test("(1) left-clicking Bold while the font-family menu is open both dismisses the menu AND toggles Bold", async ({ page }) => {
    const id = "e2e-b1106256-leftclick";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const menu = await openFontFamilyMenu(page);

    const bold = page.getByTestId("ribbon-bold");
    await expect(bold).toHaveAttribute("aria-pressed", "false");
    const box = await bold.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(menu).toBeHidden();
    await expect(bold).toHaveAttribute("aria-pressed", "true"); // the press reached Bold, not just the backdrop
  });

  test("(2) right-clicking a DIFFERENT column header while the font-family menu is open closes it and opens the header's own context menu", async ({ page }) => {
    const id = "e2e-b1106256-rightclick";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const menu = await openFontFamilyMenu(page);

    const colHeader = page.getByTestId("model-col-header-3");
    const box = await colHeader.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });

    await expect(menu).toBeHidden();
    const contextMenu = page.locator(".menu", { hasText: "Insert column left" });
    await expect(contextMenu).toBeVisible(); // the header's own contextmenu wasn't eaten by the old menu's backdrop
  });

  test("(3) clicking empty ribbon background while the font-family menu is open just dismisses it — nothing else fires", async ({ page }) => {
    const id = "e2e-b1106256-emptyspace";
    await page.setViewportSize({ width: 1600, height: 900 }); // real blank trailing space in the ribbon row
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const menu = await openFontFamilyMenu(page);

    const ribbon = page.getByTestId("model-ribbon");
    const box = await ribbon.boundingBox();
    const x = box.x + box.width - 15, y = box.y + box.height / 2;
    // Sanity: this point really is blank ribbon background, not a control — a click here proves
    // "empty space just dismisses", not "a control's own handler happened to do nothing".
    const onAControl = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("button"), [x, y]);
    expect(onAControl).toBe(false);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();

    await expect(menu).toBeHidden();
    await expect(page.getByTestId("ribbon-bold")).toHaveAttribute("aria-pressed", "false"); // nothing else was activated
  });

  test("(4) press-trigger, drag onto a menu item, release: native click needs a shared mousedown/mouseup target, so nothing selects — unchanged by this fix", async ({ page }) => {
    const id = "e2e-b1106256-dragrelease";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    const trigger = page.getByTitle("Font family");
    const menu = await openFontFamilyMenu(page);
    await expect(trigger).toHaveText(/Default/);

    // Re-press the (already open) trigger and drag onto the "Arial" row without releasing.
    const arialItem = menu.getByText("Arial", { exact: true });
    const triggerBox = await trigger.boundingBox();
    const itemBox = await arialItem.boundingBox();
    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await page.mouse.down();
    // The trigger is the menu's own anchor, so AnchoredMenu's dismiss listener stands down for
    // this mousedown (same exclusion that stops a re-press from double-toggling) — the menu stays
    // open through the press and the drag.
    await expect(menu).toBeVisible();
    await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2, { steps: 5 });
    await page.mouse.up();

    // mousedown landed on the trigger, mouseup on the Arial row — different targets, so no native
    // `click` fires anywhere: neither the trigger's own open/close toggle nor Arial's onClick.
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveText(/Default/); // nothing was selected
  });
});

/* ⛔ B1107632 — replaces the ONE-FRAME-LATE scroll-dismiss arm (B1076480) with an EXPLICIT guard.
 * `shared/ui/programmaticScroll.js` lets the "keep active cell fully on screen" layout effect
 * (SheetView.jsx) MARK its own deliberate `scrollTop`/`scrollLeft` writes, and ContextMenu's
 * dismiss listener — now armed IMMEDIATELY, no rAF delay — consumes that mark instead of racing
 * it. The B1076480 suite above already covers the row case (line 688); this suite adds the
 * column case, proves a genuine scroll still dismisses, and repeats the open/close cycle to
 * match the (informal, pre-commit) CPU-throttle stress check's intent with a committed, CI-
 * runnable equivalent.
 *
 * Click targeting: a partially-cut header's own `boundingBox()` reports its full, un-clipped
 * layout box — its geometric center can land outside what the scrolling container actually
 * paints there, which a raw `page.mouse` click (unlike Playwright's `locator.click()`, which
 * auto-scrolls the target fully into view first — exactly the DRIVER-SCROLL-IS-NOT-APP-SCROLL
 * trap this suite exists to avoid) will silently miss. `hitTestablePoint` scans for a real,
 * currently-painted point on the target instead of assuming the center is one.
 */
test.describe("Model workspace — B1107632 (explicit scroll-dismiss guard)", () => {
  /** A point on `testId` that a real `elementFromPoint` hit-test resolves back to `testId` —
   *  robust to the element being partially clipped by an ancestor's overflow. */
  async function hitTestablePoint(page, testId) {
    return page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      const r = el.getBoundingClientRect();
      for (let y = Math.ceil(r.top) + 1; y < r.bottom; y += 2) {
        for (let x = Math.ceil(r.left) + 1; x < r.right; x += 4) {
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.getAttribute("data-testid") === id) return { x, y };
        }
      }
      return null;
    }, testId);
  }

  async function rightClickPoint(page, { x, y }) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
  }

  test("right-clicking a column header that requires auto-scrolling itself into view does not immediately self-dismiss the menu it just opened", async ({ page }) => {
    const id = "e2e-b1107632-colscroll";
    await seedProject(page, id);
    await page.setViewportSize({ width: 300, height: 500 }); // narrow enough to cut a column header
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    // Find the column header straddling the sheet's own clipped right edge (the "last partially
    // visible column"), then a real hit-testable point on it.
    const target = await page.evaluate(() => {
      const clip = document.querySelector('[data-testid="model-sheet"]').getBoundingClientRect();
      for (let c = 0; c < 20; c++) {
        const el = document.querySelector(`[data-testid="model-col-header-${c}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.left < clip.right && r.right > clip.right) return `model-col-header-${c}`;
      }
      return null;
    });
    expect(target, "no partially-cut column header found at this viewport width").not.toBeNull();
    const point = await hitTestablePoint(page, target);
    expect(point, `no hit-testable point found on ${target}`).not.toBeNull();

    await rightClickPoint(page, point);
    // Give the auto-scroll nudge (and its deferred native `scroll` event) a full beat to land.
    await page.waitForTimeout(300);
    await expect(page.locator(".menu")).toBeVisible();

    // And a genuine later scroll still dismisses it.
    await sheetEl(page).evaluate((el) => {
      el.scrollLeft += 200;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(page.locator(".menu")).toBeHidden();
  });

  test("repeated right-click-and-close cycles on a row requiring auto-scroll never self-dismiss — deterministic across N opens, not merely observed once", async ({ page }) => {
    const id = "e2e-b1107632-repeat";
    await seedProject(page, id);
    // Stage 3 (NEW-1) added the sheet TAB STRIP below the grid — a required ~36px of chrome
    // that wasn't there when this viewport height was first tuned to make row 14 "partially cut,
    // requiring auto-scroll." +40px restores that same relationship rather than accidentally
    // making row 14 either fully on-screen (defeats the point of this test) or fully off (the
    // regression this fix closes).
    await page.setViewportSize({ width: 900, height: 540 });
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    const point = await hitTestablePoint(page, "model-row-header-14");
    expect(point, "no hit-testable point found on model-row-header-14").not.toBeNull();

    for (let i = 0; i < 6; i++) {
      await rightClickPoint(page, point);
      await page.waitForTimeout(300);
      await expect(page.locator(".menu"), `self-closed on open #${i + 1}`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".menu")).toBeHidden();
    }
  });
});

// ── STAGE 3 (NEW-1/NEW-2, owner brief 2026-09-03) — multi-sheet workbooks + input/formula/
// cross-sheet-link colour ──────────────────────────────────────────────────────────────────
const tab = (page, i) => page.getByTestId(`model-sheet-tab-${i}`);

test.describe("Model workspace — Stage 3 (multi-sheet workbooks, tab strip)", () => {
  test("a fresh project opens with exactly one tab, 'Sheet1', already active", async ({ page }) => {
    const id = "e2e-stage3-onetab";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await expect(tab(page, 0)).toHaveText("Sheet1");
    await expect(page.getByTestId("model-sheet-tab-1")).toHaveCount(0);
  });

  test("+ adds a new sheet, named Sheet2, and switches to it", async ({ page }) => {
    const id = "e2e-stage3-add";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "111"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click();
    await expect(tab(page, 1)).toHaveText("Sheet2");
    // The new sheet is BLANK — its own A1 must not show Sheet1's content.
    await expect(cell(page, 0, 0)).toHaveText("");
    // Switching back to Sheet1 shows its own data again.
    await tab(page, 0).click();
    await expect(cell(page, 0, 0)).toHaveText("111");
  });

  test("double-click renames a tab inline — no window.prompt, ever", async ({ page }) => {
    const id = "e2e-stage3-rename";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    let promptCalled = false;
    await page.exposeFunction("__e2ePromptFlag", () => { promptCalled = true; });
    await page.addInitScript(() => { window.prompt = () => { window.__e2ePromptFlag?.(); return null; }; });
    await tab(page, 0).dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Revenue");
    await page.keyboard.press("Enter");
    await expect(tab(page, 0)).toHaveText("Revenue");
    expect(promptCalled).toBe(false);
  });

  test("a cross-sheet formula (Sheet1!A1) reads another sheet's value, live", async ({ page }) => {
    const id = "e2e-stage3-crosssheet";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "500"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click(); // Sheet2, now active
    await cell(page, 0, 0).click(); await typeAndEnter(page, "=Sheet1!A1*2");
    await expect(cell(page, 0, 0)).toHaveText("1000");
  });

  test("renaming the referenced sheet rewrites the cross-sheet formula's qualifier", async ({ page }) => {
    const id = "e2e-stage3-rename-rewrite";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "7"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click(); // Sheet2
    await cell(page, 0, 0).click(); await typeAndEnter(page, "=Sheet1!A1");
    // A double-click on a tab lands two ordinary clicks before the dblclick itself (real browser
    // behavior, matched here — Excel's own tabs work the same way), so this ALSO switches the
    // active sheet to Sheet1 first; switch back to Sheet2 afterward to read its own formula.
    await tab(page, 0).dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Costs");
    await page.keyboard.press("Enter");
    await tab(page, 1).click(); // back to Sheet2
    await expect(cell(page, 0, 0)).toHaveText("7"); // still resolves — the reference followed the rename
    await cell(page, 0, 0).click();
    await expect(page.getByTestId("model-formula-bar")).toHaveValue("=Costs!A1"); // the qualifier itself was rewritten
  });

  test("deleting a referenced sheet turns the cross-sheet formula into #REF!, not a crash", async ({ page }) => {
    const id = "e2e-stage3-delete-ref";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "9"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click(); // Sheet2
    await cell(page, 0, 0).click(); await typeAndEnter(page, "=Sheet1!A1+1");
    await tab(page, 0).click({ button: "right" });
    await page.getByText("Delete", { exact: true }).click();
    await expect(tab(page, 0)).toHaveText("Sheet2");
    await expect(cell(page, 0, 0)).toHaveText("#REF!");
  });

  test("the last remaining sheet cannot be deleted — the Delete menu item is disabled", async ({ page }) => {
    const id = "e2e-stage3-lastsheet";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await tab(page, 0).click({ button: "right" });
    const del = page.getByText("Delete", { exact: true });
    await expect(del).toBeVisible();
    await expect(del).toBeDisabled();
    await expect(tab(page, 0)).toHaveText("Sheet1"); // still there
  });

  test("the tab strip stays pinned when the grid scrolls horizontally — never inside the grid's own scroller", async ({ page }) => {
    // Numeric proof, not just a passing assertion (the historical trap: SheetView.jsx's own
    // "+ Add column" button once landed at x=3173 in a 1191px window because it was laid out
    // to the grid's full column extent instead of the viewport). getBoundingClientRect().x
    // before vs. after scrolling the grid FULLY right (scrollLeft driven to its max, not a
    // magic number) must be bit-for-bit identical — this asserts exact equality, not "close".
    const id = "e2e-stage3-pinned";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    const strip = page.getByTestId("model-tab-strip");
    const before = await strip.evaluate((el) => el.getBoundingClientRect().toJSON());
    const scrollInfo = await sheetEl(page).evaluate((el) => {
      el.scrollLeft = el.scrollWidth; // drive fully right, not a fixed offset
      return { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(scrollInfo.scrollLeft).toBeGreaterThan(0); // sanity: the grid actually had room to scroll
    await page.waitForTimeout(100);
    const after = await strip.evaluate((el) => el.getBoundingClientRect().toJSON());
    console.log(`[tab-strip-pin] before.x=${before.x} after.x=${after.x} scrollLeft=${scrollInfo.scrollLeft} scrollWidth=${scrollInfo.scrollWidth}`);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  test("round-trip through local storage: a second sheet + a cross-sheet formula survive a reload", async ({ page }) => {
    const id = "e2e-stage3-roundtrip";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "42"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click(); // Sheet2
    await cell(page, 0, 0).click(); await typeAndEnter(page, "=Sheet1!A1+8");
    await expect(cell(page, 0, 0)).toHaveText("50");
    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(tab(page, 1)).toHaveText("Sheet2");
    await expect(cell(page, 0, 0)).toHaveText("50"); // the cross-sheet formula, and Sheet1's own value, both survived
  });

  test("a PRE-Stage-3 single-sheet localStorage blob still opens without loss, now inside a one-sheet workbook", async ({ page }) => {
    const id = "e2e-stage3-migrate";
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
    await expect(sheetEl(page)).toBeVisible();
    await expect(tab(page, 0)).toHaveText("Sheet1");
    await expect(page.getByTestId("model-sheet-tab-1")).toHaveCount(0);
    await expect(cell(page, 0, 0)).toHaveText("12345");
    await expect(cell(page, 0, 1)).toHaveText("24690");
  });
});

test.describe("Model workspace — Stage 3 (input/formula/cross-sheet-link colour)", () => {
  test("an input, a same-sheet formula, and a cross-sheet formula each render a distinctly different colour", async ({ page }) => {
    const id = "e2e-stage3-colour";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "5"); // A1 — input
    await cell(page, 0, 1).click(); await typeAndEnter(page, "=A1+1"); // B1 — same-sheet formula
    await page.getByTestId("model-add-sheet").click();
    await cell(page, 0, 0).click(); await typeAndEnter(page, "=Sheet1!A1"); // Sheet2!A1 — cross-sheet
    await tab(page, 0).click();

    const inputColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);
    const formulaColor = await cell(page, 0, 1).evaluate((el) => getComputedStyle(el).color);
    expect(inputColor).not.toBe(formulaColor);

    await tab(page, 1).click();
    const crossColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);
    expect(crossColor).not.toBe(inputColor);
    expect(crossColor).not.toBe(formulaColor);
  });

  test("the ribbon toggle turns automatic colouring off, and back on", async ({ page }) => {
    const id = "e2e-stage3-colour-toggle";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "5"); // input — blue while ON
    const onColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);

    await page.getByTestId("ribbon-autocolor").click(); // OFF
    const offColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);
    expect(offColor).not.toBe(onColor);

    await page.getByTestId("ribbon-autocolor").click(); // back ON
    await expect.poll(() => cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color)).toBe(onColor);
  });

  test("a manual font colour always wins over the automatic classification", async ({ page }) => {
    const id = "e2e-stage3-colour-manual";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await cell(page, 0, 0).click(); await typeAndEnter(page, "5"); // input — auto-blue while ON
    const autoColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);

    await cell(page, 0, 0).click();
    // Open the "A" text-colour swatch (ColorSwatchButton's trigger carries this title).
    await page.locator('[title="Text colour"]').click();
    await page.locator('button[title="#c62828"]').click(); // a palette red — deliberately NOT the auto-colour blue
    const manualColor = await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color);
    expect(manualColor).not.toBe(autoColor);
    expect(manualColor).toBe("rgb(198, 40, 40)"); // #c62828, exactly what was picked — the auto-colour never overrides it
  });

  test("the toggle persists across a reload (a standing display choice, not a mid-task gesture)", async ({ page }) => {
    const id = "e2e-stage3-colour-persist";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(page.getByTestId("ribbon-autocolor")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ribbon-autocolor").click();
    await expect(page.getByTestId("ribbon-autocolor")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(page.getByTestId("ribbon-autocolor")).toHaveAttribute("aria-pressed", "false");
  });
});
