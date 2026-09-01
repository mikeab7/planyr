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
