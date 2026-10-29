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

/* NEW-2 follow-up (owner, 2026-10-29 3:29 PM, his real project): after Increase indent on a label whose
 * right neighbour is EMPTY (amount two columns over), the text did not move and the whole row from that cell
 * rightward sat wider than the rows around it. The rule pinned here: an indent only insets the text INSIDE
 * its cell. It never changes that cell's width or any other cell's position, so every cell edge in the
 * indented row equals the header's column edge. */
test.describe("Spreadsheet — an indent never changes a cell's width or any other cell's position (NEW-2)", () => {
  /** Left + width of the row's cells and of the column headers, rounded to 0.01 px. */
  async function edges(page, r, cols = 6) {
    return page.evaluate(([row, n]) => {
      const round = (x) => Math.round(x * 100) / 100;
      const out = { cells: [], headers: [] };
      for (let c = 0; c < n; c++) {
        const el = document.querySelector(`[data-row="${row}"][data-col="${c}"]`).getBoundingClientRect();
        const h = document.querySelector(`[data-testid="model-col-header-${c}"]`).getBoundingClientRect();
        out.cells.push({ left: round(el.left), right: round(el.right) });
        out.headers.push({ left: round(h.left), right: round(h.right) });
      }
      return out;
    }, [r, cols]);
  }
  const aligned = (e) => e.cells.every((c, i) => c.left === e.headers[i].left && c.right === e.headers[i].right);
  const ink = (page, r, c) => page.evaluate(([row, col]) => {
    const el = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const rg = document.createRange(); rg.setStart(node, 0); rg.setEnd(node, 1);
    return Math.round(rg.getBoundingClientRect().left * 100) / 100;
  }, [r, c]);

  /** Row 1: label B, C EMPTY, amount in D (the owner's Reimbursables row). Row 2: label B, amount in C. */
  async function open(page, id) {
    await openCostsSheet(page, id);
    await put(page, 1, 1, "Reimbursables");
    await cell(page, 1, 2).click(); await page.keyboard.press("Delete");
    await put(page, 1, 3, "2000");
    await cell(page, 1, 3).click(); await page.getByTestId("ribbon-currency").click();
  }

  for (const [label, row, steps] of [
    ["empty right neighbour, one step", 1, 1],
    ["empty right neighbour, several steps", 1, 5],
    ["filled right neighbour, one step", 2, 1],
    ["filled right neighbour, several steps", 2, 5],
  ]) {
    test(`${label}: every column edge still matches the header, only the text moves`, async ({ page }) => {
      await open(page, `e2e-indent-geom-${row}-${steps}`);
      const before = await edges(page, row);
      expect(aligned(before), "row aligned with the header before any indent").toBe(true);
      const inkBefore = await ink(page, row, 1);
      await cell(page, row, 1).click();
      for (let i = 0; i < steps; i++) await page.getByTestId("ribbon-indent-inc").click();
      const after = await edges(page, row);
      expect(aligned(after), "row aligned with the header after the indent").toBe(true);
      expect(after).toEqual(before);
      // …and the label really moved right by one step (14px) per press — the indent is drawn.
      expect(await ink(page, row, 1) - inkBefore).toBe(14 * steps);
    });
  }

  test("a row that is already indented stays aligned when its neighbour is later cleared and refilled", async ({ page }) => {
    await open(page, "e2e-indent-geom-toggle");
    await cell(page, 2, 1).click();
    await page.getByTestId("ribbon-indent-inc").click();
    await page.getByTestId("ribbon-indent-inc").click();
    const base = await edges(page, 2);
    const inkBase = await ink(page, 2, 1);
    await cell(page, 2, 2).click(); await page.keyboard.press("Delete");
    expect(aligned(await edges(page, 2))).toBe(true);
    expect(await ink(page, 2, 1)).toBe(inkBase);
    await put(page, 2, 2, "25000");
    expect(await edges(page, 2)).toEqual(base);
    expect(await ink(page, 2, 1)).toBe(inkBase);
  });

  /** The stored indent level of one cell, read from the sheet the app saved on this device. */
  const stored = (page, id, r, c) => page.evaluate(([pid, row, col]) => {
    const raw = localStorage.getItem(`planyr:model:sheet:v1:local:${pid}`);
    const sh = JSON.parse(raw);
    const wb = sh.sheets[0].sheet;
    return wb.styles[`${wb.columns[col].id}:${row}`]?.indent ?? 0;
  }, [id, r, c]);
  const press = async (page, testid, n = 1) => { for (let i = 0; i < n; i++) await page.getByTestId(testid).click(); };

  test("the stored indent level goes up one per press and back down; the drawn text follows (empty neighbour)", async ({ page }) => {
    const id = "e2e-indent-store";
    await open(page, id);
    await cell(page, 1, 1).click();
    const x0 = await ink(page, 1, 1);
    await press(page, "ribbon-indent-inc", 3);
    await expect.poll(() => stored(page, id, 1, 1)).toBe(3);
    expect(await ink(page, 1, 1) - x0).toBe(42);
    await press(page, "ribbon-indent-dec", 2);
    await expect.poll(() => stored(page, id, 1, 1)).toBe(1);
    expect(await ink(page, 1, 1) - x0).toBe(14);
    await press(page, "ribbon-indent-dec", 5); // floors at 0
    await expect.poll(() => stored(page, id, 1, 1)).toBe(0);
    expect(await ink(page, 1, 1)).toBe(x0);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  test("undo and redo of an indent restore the exact geometry, and the indent survives a reload", async ({ page }) => {
    const id = "e2e-indent-undo";
    await open(page, id);
    await cell(page, 1, 1).click();
    const base = await edges(page, 1); const x0 = await ink(page, 1, 1);
    await press(page, "ribbon-indent-inc", 2);
    const x2 = await ink(page, 1, 1);
    expect(x2 - x0).toBe(28);
    await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z");
    expect(await ink(page, 1, 1)).toBe(x0);
    expect(await edges(page, 1)).toEqual(base);
    await page.keyboard.press("Control+y"); await page.keyboard.press("Control+y");
    expect(await ink(page, 1, 1)).toBe(x2);
    await expect.poll(() => stored(page, id, 1, 1)).toBe(2);
    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    expect(await ink(page, 1, 1)).toBe(x2);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  test("a multi-cell selection spanning an empty-neighbour row and a filled-neighbour row steps EACH cell from its own level", async ({ page }) => {
    const id = "e2e-indent-multi";
    await open(page, id);
    await cell(page, 2, 1).click();
    await press(page, "ribbon-indent-inc", 3);                 // B3 already at 3
    await cell(page, 1, 1).click();
    await cell(page, 2, 1).click({ modifiers: ["Shift"] });    // select B2:B3 (B2 at 0, B3 at 3)
    const x1 = await ink(page, 1, 1); const x2 = await ink(page, 2, 1);
    await press(page, "ribbon-indent-inc", 1);
    await expect.poll(() => stored(page, id, 1, 1)).toBe(1);
    await expect.poll(() => stored(page, id, 2, 1)).toBe(4);
    expect(await ink(page, 1, 1) - x1).toBe(14);
    expect(await ink(page, 2, 1) - x2).toBe(14);
    for (const r of [1, 2]) expect(aligned(await edges(page, r)), `row ${r}`).toBe(true);
  });

  test("the command-palette route (the only keyboard route) indents and outdents the same way", async ({ page }) => {
    const id = "e2e-indent-palette";
    await open(page, id);
    await cell(page, 1, 1).click();
    const x0 = await ink(page, 1, 1);
    for (const q of ["Increase Indent", "Increase Indent"]) {
      await page.keyboard.press("Control+k");
      await page.getByTestId("model-command-palette-input").fill(q);
      await page.keyboard.press("Enter");
    }
    await expect.poll(() => stored(page, id, 1, 1)).toBe(2);
    expect(await ink(page, 1, 1) - x0).toBe(28);
    await page.keyboard.press("Control+k");
    await page.getByTestId("model-command-palette-input").fill("Decrease Indent");
    await page.keyboard.press("Enter");
    await expect.poll(() => stored(page, id, 1, 1)).toBe(1);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  for (const align of ["left", "center", "right"]) {
    test(`${align}-aligned label with several indent steps keeps every edge on the header's grid`, async ({ page }) => {
      await open(page, `e2e-indent-align-${align}`);
      await cell(page, 1, 1).click();
      await page.getByTestId(`ribbon-align-${align}`).click();
      await press(page, "ribbon-indent-inc", 12);
      expect(aligned(await edges(page, 1))).toBe(true);
      // a different row, a different neighbour: untouched
      expect(aligned(await edges(page, 2))).toBe(true);
    });
  }

  test("an already-indented label is not disturbed when its neighbour is cleared or filled (both directions)", async ({ page }) => {
    await open(page, "e2e-indent-neighbour");
    await cell(page, 2, 1).click();
    await press(page, "ribbon-indent-inc", 4);
    const base = await edges(page, 2); const x0 = await ink(page, 2, 1);
    await cell(page, 2, 2).click(); await page.keyboard.press("Delete");
    expect(await ink(page, 2, 1)).toBe(x0);
    await put(page, 2, 3, "999");
    expect(await ink(page, 2, 1)).toBe(x0);
    expect(aligned(await edges(page, 2))).toBe(true);
    await cell(page, 2, 3).click(); await page.keyboard.press("Delete");
    await put(page, 2, 2, "25000");
    expect(await ink(page, 2, 1)).toBe(x0);
    expect(aligned(await edges(page, 2))).toBe(true);
    void base;
  });
});
