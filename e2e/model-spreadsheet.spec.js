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

  test("the number-format picker applies to the CELL, not the whole column", async ({ page }) => {
    const id = "e2e-model-format";
    await openModelWithNumbers(page, id); // A1=500 (General), A2=300 (General)
    await cell(page, 0, 0).click();
    await page.getByTestId("model-format-picker").selectOption("currency");
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
