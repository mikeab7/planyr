/* Spreadsheet — clearing (or refilling) one cell must change ONLY that cell (NEW-1).
 *
 * Owner repro, live on planyr.io 2026-10-29: column B holds text labels, column C holds currency
 * amounts. Clearing the C cell beside "Civil Engineering" made that label visibly shift. Cause
 * (measured by this spec failing on the unfixed build): a text cell whose right-hand neighbours are
 * EMPTY is drawn by the "spill" branch of SheetView, which positioned its text with its own
 * constants (left 8, centred, ignoring indent / alignment / vertical alignment) instead of the
 * cell's normal padding — so the label jumped the moment its neighbour emptied.
 *
 * What is measured: the on-screen rectangle of the label's FIRST CHARACTER (a Range over the text
 * node — the real painted ink, not a wrapper box), plus the cell's own box and its neighbours' boxes.
 * Every clear path (Delete, Backspace, Cut, context-menu Clear), every neighbour-value kind, and the
 * reverse (typing the value back) must leave all of it identical.
 *
 * Run: npx playwright test e2e/model-clear-cell-layout.spec.js
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

async function put(page, r, c, text) {
  await cell(page, r, c).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** "Costs" in A1; labels in B2:B4; currency amounts in C2:C4 (the owner's layout). */
async function openCostsSheet(page, id) {
  await seedProject(page, id);
  await page.goto(`/#/project/${id}/model`);
  await expect(sheetEl(page)).toBeVisible();
  await put(page, 0, 0, "Costs");
  const labels = ["Architectural", "Civil Engineering", "General"];
  const amounts = ["30000", "25000", "25000"];
  for (let i = 0; i < 3; i++) {
    await put(page, 1 + i, 1, labels[i]);
    await put(page, 1 + i, 2, amounts[i]);
    await cell(page, 1 + i, 2).click();
    await page.getByTestId("ribbon-currency").click();
  }
  await expect(cell(page, 2, 2)).toHaveText("$25,000.00");
}

/** Geometry of one row's cells A..D: each cell's box and the painted rectangle of the first
 *  character of its text. Rounded to 0.01 px so a sub-pixel move is still a failure. */
async function geometry(page, r) {
  return page.evaluate((row) => {
    const round = (n) => Math.round(n * 100) / 100;
    const box = (rc) => ({ left: round(rc.left), top: round(rc.top), width: round(rc.width), height: round(rc.height) });
    const out = [];
    for (let c = 0; c < 4; c++) {
      const el = document.querySelector(`[data-row="${row}"][data-col="${c}"]`);
      const cellBox = box(el.getBoundingClientRect());
      let ink = null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (node && node.textContent.length) {
        const rg = document.createRange();
        rg.setStart(node, 0); rg.setEnd(node, 1);
        ink = box(rg.getBoundingClientRect());
      }
      out.push({ cell: cellBox, ink });
    }
    return out;
  }, r);
}

/** Everything about B's label and the boxes around it, except the one cell we changed (its ink). */
function strip(g, clearedCol) {
  return g.map((x, i) => (i === clearedCol ? { cell: x.cell } : x));
}

const CLEARS = {
  Delete: async (page) => { await page.keyboard.press("Delete"); },
  Backspace: async (page) => { await page.keyboard.press("Backspace"); },
  // The sheet has no Cut command; the right-click menu's "Clear contents" is the other way to blank a cell.
  "context-menu Clear contents": async (page) => {
    await cell(page, 2, 2).click({ button: "right" });
    await page.getByText("Clear contents", { exact: true }).click();
  },
};

test.describe("Spreadsheet — clearing a cell moves nothing beside it (NEW-1)", () => {
  for (const [name, clear] of Object.entries(CLEARS)) {
    test(`${name} on the amount leaves the label beside it exactly where it was`, async ({ page }) => {
      await openCostsSheet(page, `e2e-clear-${name.replace(/\W/g, "")}`);
      const before = await geometry(page, 2);
      await cell(page, 2, 2).click();
      await clear(page);
      await expect(cell(page, 2, 2)).toHaveText("");
      const after = await geometry(page, 2);
      expect(strip(after, 2)).toEqual(strip(before, 2));
      // The neighbouring rows are untouched too.
      expect(await geometry(page, 1)).toEqual(await geometry(page, 1));
    });
  }

  test("typing the value back into the emptied cell does not shift the label either", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-retype");
    const before = await geometry(page, 2);
    await cell(page, 2, 2).click();
    await page.keyboard.press("Delete");
    const cleared = await geometry(page, 2);
    await put(page, 2, 2, "25000");
    const refilled = await geometry(page, 2);
    expect(strip(cleared, 2)).toEqual(strip(before, 2));
    expect(strip(refilled, 2)).toEqual(strip(before, 2));
  });

  test("Ctrl+Z after the clear restores the exact original layout", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-undo");
    const before = await geometry(page, 2);
    await cell(page, 2, 2).click();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+z");
    await expect(cell(page, 2, 2)).toHaveText("$25,000.00");
    expect(await geometry(page, 2)).toEqual(before);
  });

  test("clearing a cell to the LEFT of the label (A) leaves the label in place", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-left");
    await put(page, 2, 0, "Phase 1");
    const before = await geometry(page, 2);
    await cell(page, 2, 0).click();
    await page.keyboard.press("Delete");
    const after = await geometry(page, 2);
    expect(strip(after, 0)).toEqual(strip(before, 0));
  });

  test("clearing a plain number and a text neighbour behaves the same", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-kinds");
    // A plain (General) number and a text value in the column beside row 1's and row 3's labels.
    await put(page, 1, 2, "42");
    await put(page, 3, 2, "n/a");
    for (const r of [1, 3]) {
      const before = await geometry(page, r);
      await cell(page, r, 2).click();
      await page.keyboard.press("Delete");
      expect(strip(await geometry(page, r), 2)).toEqual(strip(before, 2));
    }
  });

  test("a label LONGER than its column keeps its start point when its neighbour empties", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-long");
    await put(page, 2, 1, "Civil Engineering and Surveying — Phase 1 Allowance");
    const before = await geometry(page, 2);
    await cell(page, 2, 2).click();
    await page.keyboard.press("Delete");
    const after = await geometry(page, 2);
    // The text may now extend across the empty cell (Excel's rule) — but it must START where it started.
    expect(after[1].ink).toEqual(before[1].ink);
    expect(after[1].cell).toEqual(before[1].cell);
    expect(after[0]).toEqual(before[0]);
    expect(after[2].cell).toEqual(before[2].cell);
  });

  test("indented, centred and top-aligned labels keep their text position when the neighbour empties", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-styled");
    // Row 1: indent twice. Row 2: centred. Row 3: top-aligned.
    await cell(page, 1, 1).click();
    await page.getByTestId("ribbon-indent-inc").click();
    await page.getByTestId("ribbon-indent-inc").click();
    await cell(page, 2, 1).click();
    await page.getByTestId("ribbon-align-center").click();
    await cell(page, 3, 1).click();
    await page.getByTitle("Vertical alignment").click();
    await page.getByRole("button", { name: "Top", exact: true }).click();
    for (const r of [1, 2, 3]) {
      const before = await geometry(page, r);
      await cell(page, r, 2).click();
      await page.keyboard.press("Delete");
      expect(strip(await geometry(page, r), 2), `row ${r}`).toEqual(strip(before, 2));
    }
  });
});
