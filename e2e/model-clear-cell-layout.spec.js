/* Spreadsheet — clearing (or refilling) one cell must change ONLY that cell (NEW-1), and an indent only insets text INSIDE its cell (NEW-2).
 *
 * Owner repro, live on planyr.io 2026-10-29: column B holds text labels, column C holds currency amounts. Clearing the C cell beside
 * "Civil Engineering" made that label visibly shift (the old grid's "spill" branch positioned text with its own constants).
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31). The grid is a CANVAS, so there is no DOM ink to measure; what is measured instead is
 * what a person SEES — the painted pixels of each cell (a screenshot clip of its interior, selection parked far away): the cell's
 * dark-ink extent and a hash of its exact pixels — plus Univer's own cell rectangles and column widths. Edits are real mouse + keys
 * (e2e/lib/univerGrid.js); state is read through Univer's facade. The same pixel method is the one ui-audit/verify-univer-parity.mjs
 * uses for its `spill-and-clear` and `indent` checks.
 *
 * RETIRED (2026-10-31) — nothing: every old test has a port below. The old "every cell edge equals the column HEADER's edge" assertion
 * compared two DOM boxes of the old grid; here the equivalent is "each cell rect == the running sum of Univer's column widths, and the
 * whole row's rects + widths are identical before and after".
 *
 * Run: npx playwright test e2e/model-clear-cell-layout.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  openSpreadsheet, enter, clickCell, rightClickCell, press, shown, flushGrid, cellInk, parkCursor, rowGeometry,
  clickUniverCommand, chooseFromToolbarMenu, modClickCell, storedIndent, expectShown, waitForGrid, runPaletteCommand,
} from "./lib/univerGrid.js";

const hash = (buf) => createHash("sha1").update(buf).digest("hex");
const INC = "planyr.sheet.command.increase-indent", DEC = "planyr.sheet.command.decrease-indent";
const CURRENCY = "Control+Shift+$";

/** "Costs" in A1; labels in B2:B4; currency amounts in C2:C4 (the owner's layout). */
async function openCostsSheet(page, id) {
  await openSpreadsheet(page, id);
  await enter(page, 0, 0, "Costs");
  const labels = ["Architectural", "Civil Engineering", "General"];
  const amounts = ["30000", "25000", "25000"];
  for (let i = 0; i < 3; i++) {
    await enter(page, 1 + i, 1, labels[i]);
    await enter(page, 1 + i, 2, amounts[i]);
    await clickCell(page, 1 + i, 2);
    await press(page, CURRENCY);
  }
  await expectShown(page, 2, 2, "$25,000.00", "known-good: the amount is a currency before anything is cleared");
}

/** What a person sees on one row's cells A..D: each cell's rectangle (Univer) and its painted text (ink extent + exact pixels). */
async function geometry(page, r, n = 4) {
  await parkCursor(page);
  const rects = await rowGeometry(page, r, n);
  const out = [];
  for (let c = 0; c < n; c++) {
    const k = await cellInk(page, r, c);
    out.push({ rect: rects[c], ink: { left: k.left, right: k.right, dark: k.dark }, pix: hash(k.buf) });
  }
  return out;
}
/** Everything about the row except the one cell we changed (its text); that cell keeps only its rectangle. */
const strip = (g, clearedCol) => g.map((x, i) => (i === clearedCol ? { rect: x.rect } : x));

const CLEARS = {
  Delete: async (page) => { await press(page, "Delete"); },
  // Excel's Backspace on a selected cell empties it AND opens it for editing: Enter commits the empty entry.
  Backspace: async (page) => { await press(page, "Backspace"); await press(page, "Enter"); },
  // Excel's cut blanks the source when it is PASTED (the marching ants stay until then): cut C3, paste far away from the row under test.
  "Ctrl+X cut + paste": async (page) => { await press(page, "Control+x"); await clickCell(page, 9, 6); await press(page, "Control+v"); },
  "context-menu Clear ▸ Clear contents": async (page) => {
    await rightClickCell(page, 2, 2);
    await page.getByText("Clear", { exact: true }).last().hover(); await page.waitForTimeout(350);
    await page.getByText(/^Clear contents$/i).last().click(); await page.waitForTimeout(250);
  },
};

// Univer is a heavy canvas app and every step here is a real mouse/keyboard gesture with a settle: allow for it (a loaded CI box is ~3x slower).
test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(120_000); });

test.describe("Spreadsheet — clearing a cell moves nothing beside it (NEW-1)", () => {
  for (const [name, clear] of Object.entries(CLEARS)) {
    test(`${name} on the amount leaves the label beside it exactly where it was`, async ({ page }) => {
      await openCostsSheet(page, `e2e-clear-${name.replace(/\W/g, "")}`);
      const before = await geometry(page, 2);
      const rowAbove = await geometry(page, 1), rowBelow = await geometry(page, 3);
      await clickCell(page, 2, 2);
      await clear(page);
      await expectShown(page, 2, 2, "", `${name}: the amount cell is blank`);
      const after = await geometry(page, 2);
      expect(strip(after, 2)).toEqual(strip(before, 2));
      // The neighbouring rows are untouched too (the old test compared a row with ITSELF — vacuous; this compares before with after).
      expect(await geometry(page, 1)).toEqual(rowAbove);
      expect(await geometry(page, 3)).toEqual(rowBelow);
    });
  }

  test("known-good: the instrument sees a real change — editing the label itself changes its painted pixels", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-control");
    const before = await geometry(page, 2);
    expect(before[1].ink.dark, "the label has ink").toBeGreaterThan(20);
    await enter(page, 2, 1, "Civil");
    const after = await geometry(page, 2);
    expect(after[1].pix, "B3's pixels changed when its own text changed").not.toEqual(before[1].pix);
    expect(after[0]).toEqual(before[0]);                 // …but the cell to its left did not
  });

  test("typing the value back into the emptied cell does not shift the label either", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-retype");
    const before = await geometry(page, 2);
    await clickCell(page, 2, 2);
    await press(page, "Delete");
    const cleared = await geometry(page, 2);
    await enter(page, 2, 2, "25000");
    const refilled = await geometry(page, 2);
    expect(strip(cleared, 2)).toEqual(strip(before, 2));
    expect(strip(refilled, 2)).toEqual(strip(before, 2));
  });

  test("Ctrl+Z after the clear restores the exact original layout", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-undo");
    const before = await geometry(page, 2);
    await clickCell(page, 2, 2);
    await press(page, "Delete");
    await expectShown(page, 2, 2, "");
    await press(page, "Control+z");
    await expectShown(page, 2, 2, "$25,000.00", "Ctrl+Z brings the amount (and its currency format) back");
    expect(await geometry(page, 2)).toEqual(before);
  });

  test("clearing a cell to the LEFT of the label (A) leaves the label in place", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-left");
    await enter(page, 2, 0, "Phase 1");
    const before = await geometry(page, 2);
    await clickCell(page, 2, 0);
    await press(page, "Delete");
    await expectShown(page, 2, 0, "");
    const after = await geometry(page, 2);
    expect(strip(after, 0)).toEqual(strip(before, 0));
  });

  test("clearing a plain number and a text neighbour behaves the same", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-kinds");
    // A plain (General) number and a text value in the column beside row 1's and row 3's labels.
    await enter(page, 1, 2, "42");
    await enter(page, 3, 2, "n/a");
    for (const r of [1, 3]) {
      const before = await geometry(page, r);
      await clickCell(page, r, 2);
      await press(page, "Delete");
      await expectShown(page, r, 2, "");
      expect(strip(await geometry(page, r), 2)).toEqual(strip(before, 2));
    }
  });

  test("a label LONGER than its column keeps its start point when its neighbour empties", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-long");
    await enter(page, 2, 1, "Civil Engineering and Surveying — Phase 1 Allowance");
    const before = await geometry(page, 2);
    await clickCell(page, 2, 2);
    await press(page, "Delete");
    await expectShown(page, 2, 2, "");
    const after = await geometry(page, 2);
    // The text may now extend across the empty cell (Excel's rule) — so a C-cell's ink grows — but B's text must START where it started,
    // and must not LOSE ink (it is only ever clipped at the column edge while the neighbour is full).
    expect(after[1].ink.left).toBe(before[1].ink.left);
    expect(after[1].rect).toEqual(before[1].rect);
    expect(after[0]).toEqual(before[0]);
    expect(after[2].rect).toEqual(before[2].rect);
    expect(after[1].ink.dark).toBeGreaterThanOrEqual(before[1].ink.dark);
    expect(after[2].ink.dark, "the long label now spills over the emptied cell").toBeGreaterThan(before[2].ink.dark);
  });

  test("indented, centred and top-aligned labels keep their text position when the neighbour empties", async ({ page }) => {
    await openCostsSheet(page, "e2e-clear-styled");
    // Row 1: indent twice. Row 2: centred. Row 3: top-aligned.
    await clickCell(page, 1, 1); await clickUniverCommand(page, INC); await clickUniverCommand(page, INC);
    await clickCell(page, 2, 1); await chooseFromToolbarMenu(page, "sheet.command.set-horizontal-text-align", "center");
    await clickCell(page, 3, 1); await chooseFromToolbarMenu(page, "sheet.command.set-vertical-text-align", "top");
    for (const r of [1, 2, 3]) {
      const before = await geometry(page, r);
      expect(before[1].ink.dark, `row ${r} label has ink`).toBeGreaterThan(20);
      await clickCell(page, r, 2);
      await press(page, "Delete");
      await expectShown(page, r, 2, "");
      expect(strip(await geometry(page, r), 2), `row ${r}`).toEqual(strip(before, 2));
    }
  });
});

/* NEW-2 follow-up (owner, 2026-10-29 3:29 PM, his real project): after Increase indent on a label whose right neighbour is EMPTY (amount two
 * columns over), the text did not move and the whole row from that cell rightward sat wider than the rows around it. The rule pinned here: an
 * indent only insets the text INSIDE its cell. It never changes that cell's width or any other cell's position. */
test.describe("Spreadsheet — an indent never changes a cell's width or any other cell's position (NEW-2)", () => {
  const near = (got, want) => Math.abs(got - want) <= 1.5;   // text anti-aliasing: ±1 px on a painted edge (the parity check's tolerance)
  /** Each cell of the row sits where Univer's column widths say it must (rect.x == running sum, rect.w == column width). */
  const aligned = (rects) => { let x = rects[0].x; return rects.every((r) => { const ok = Math.abs(r.x - x) < 0.01 && Math.abs(r.w - r.colW) < 0.01; x += r.colW; return ok; }); };
  const edges = async (page, r) => { await parkCursor(page); return rowGeometry(page, r, 6); };
  const ink = async (page, r, c) => { await parkCursor(page); return (await cellInk(page, r, c)).left; };

  /** Row 1: label B, C EMPTY, amount in D (the owner's Reimbursables row). Row 2: label B, amount in C. */
  async function open(page, id) {
    await openCostsSheet(page, id);
    await enter(page, 1, 1, "Reimbursables");
    await clickCell(page, 1, 2); await press(page, "Delete");
    await enter(page, 1, 3, "2000");
    await clickCell(page, 1, 3); await press(page, CURRENCY);
  }
  const pressN = async (page, cmd, n = 1) => { for (let i = 0; i < n; i++) await clickUniverCommand(page, cmd); };

  for (const [label, row, steps] of [
    ["empty right neighbour, one step", 1, 1],
    ["empty right neighbour, several steps", 1, 5],
    ["filled right neighbour, one step", 2, 1],
    ["filled right neighbour, several steps", 2, 5],
  ]) {
    test(`${label}: every column edge is unchanged, only the text moves`, async ({ page }) => {
      await open(page, `e2e-indent-geom-${row}-${steps}`);
      const before = await edges(page, row);
      expect(aligned(before), "known-good: the row sits on Univer's column grid before any indent").toBe(true);
      const inkBefore = await ink(page, row, 1);
      expect(inkBefore, "known-good: the label has ink").toBeGreaterThan(0);
      await clickCell(page, row, 1);
      await pressN(page, INC, steps);
      const after = await edges(page, row);
      expect(aligned(after), "row still on the column grid after the indent").toBe(true);
      expect(after).toEqual(before);
      // …and the label really moved right by one step (14 px) per press — the indent is drawn.
      const moved = (await ink(page, row, 1)) - inkBefore;
      expect(near(moved, 14 * steps), `moved ${moved}px for ${steps} step(s)`).toBe(true);
    });
  }

  test("a row that is already indented stays aligned when its neighbour is later cleared and refilled", async ({ page }) => {
    await open(page, "e2e-indent-geom-toggle");
    await clickCell(page, 2, 1);
    await pressN(page, INC, 2);
    const base = await edges(page, 2);
    const inkBase = await ink(page, 2, 1);
    await clickCell(page, 2, 2); await press(page, "Delete");
    expect(aligned(await edges(page, 2))).toBe(true);
    expect(near(await ink(page, 2, 1), inkBase)).toBe(true);
    await enter(page, 2, 2, "25000");
    expect(await edges(page, 2)).toEqual(base);
    expect(near(await ink(page, 2, 1), inkBase)).toBe(true);
  });

  test("the stored indent level goes up one per press and back down; the drawn text follows (empty neighbour)", async ({ page }) => {
    const id = "e2e-indent-store";
    await open(page, id);
    await clickCell(page, 1, 1);
    const x0 = await ink(page, 1, 1);
    const stored = async () => { await flushGrid(page); return storedIndent(page, id, 1, 1); };
    await clickCell(page, 1, 1); await pressN(page, INC, 3);
    await expect.poll(stored).toBe(3);
    expect(near((await ink(page, 1, 1)) - x0, 42)).toBe(true);
    await clickCell(page, 1, 1); await pressN(page, DEC, 2);
    await expect.poll(stored).toBe(1);
    expect(near((await ink(page, 1, 1)) - x0, 14)).toBe(true);
    await clickCell(page, 1, 1); await pressN(page, DEC, 5); // floors at 0
    await expect.poll(stored).toBe(0);
    expect(near(await ink(page, 1, 1), x0)).toBe(true);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  test("undo and redo of an indent restore the exact geometry, and the indent survives a reload", async ({ page }) => {
    const id = "e2e-indent-undo";
    await open(page, id);
    await clickCell(page, 1, 1);
    const base = await edges(page, 1); const x0 = await ink(page, 1, 1);
    await clickCell(page, 1, 1); await pressN(page, INC, 2);
    const x2 = await ink(page, 1, 1);
    expect(near(x2 - x0, 28)).toBe(true);
    await clickCell(page, 1, 1);
    await press(page, "Control+z"); await press(page, "Control+z");       // ONE undo step per click
    expect(near(await ink(page, 1, 1), x0)).toBe(true);
    expect(await edges(page, 1)).toEqual(base);
    await clickCell(page, 1, 1);
    await press(page, "Control+y"); await press(page, "Control+y");
    await page.waitForTimeout(300);
    expect(near(await ink(page, 1, 1), x2), "Ctrl+Y re-applies both steps").toBe(true);
    await flushGrid(page);
    await expect.poll(async () => { await flushGrid(page); return storedIndent(page, id, 1, 1); }).toBe(2);
    await page.reload();
    await waitForGrid(page);
    expect(near(await ink(page, 1, 1), x2), "the indent is still drawn after a reload").toBe(true);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  test("a multi-cell selection spanning an empty-neighbour row and a filled-neighbour row steps EACH cell from its own level", async ({ page }) => {
    const id = "e2e-indent-multi";
    await open(page, id);
    await clickCell(page, 2, 1);
    await pressN(page, INC, 3);                                  // B3 already at 3
    const stored = async (r) => { await flushGrid(page); return storedIndent(page, id, r, 1); };
    await clickCell(page, 1, 1);
    await modClickCell(page, 2, 1, "Shift");                     // select B2:B3 (B2 at 0, B3 at 3)
    const x1 = await ink(page, 1, 1); const x2 = await ink(page, 2, 1);
    // (ink() parks the cursor, so re-select before pressing the button)
    await clickCell(page, 1, 1); await modClickCell(page, 2, 1, "Shift");
    await pressN(page, INC, 1);
    await expect.poll(() => stored(1)).toBe(1);
    await expect.poll(() => stored(2)).toBe(4);
    expect(near((await ink(page, 1, 1)) - x1, 14)).toBe(true);
    expect(near((await ink(page, 2, 1)) - x2, 14)).toBe(true);
    for (const r of [1, 2]) expect(aligned(await edges(page, r)), `row ${r}`).toBe(true);
  });

  test("the command-palette route (the keyboard route) indents and outdents the same way", async ({ page }) => {
    const id = "e2e-indent-palette";
    await open(page, id);
    await clickCell(page, 1, 1);
    const x0 = await ink(page, 1, 1);
    const stored = async () => { await flushGrid(page); return storedIndent(page, id, 1, 1); };
    await clickCell(page, 1, 1);
    for (const q of ["Increase Indent", "Increase Indent"]) await runPaletteCommand(page, q);
    await expect.poll(stored).toBe(2);
    expect(near((await ink(page, 1, 1)) - x0, 28)).toBe(true);
    await clickCell(page, 1, 1);
    await runPaletteCommand(page, "Decrease Indent");
    await expect.poll(stored).toBe(1);
    expect(aligned(await edges(page, 1))).toBe(true);
  });

  for (const align of ["left", "center", "right"]) {
    test(`${align}-aligned label with several indent steps keeps every edge on the column grid`, async ({ page }) => {
      await open(page, `e2e-indent-align-${align}`);
      await clickCell(page, 1, 1);
      await chooseFromToolbarMenu(page, "sheet.command.set-horizontal-text-align", align);
      const before = await edges(page, 1);
      await clickCell(page, 1, 1);
      await pressN(page, INC, 12);
      const after = await edges(page, 1);
      expect(aligned(after)).toBe(true);
      expect(after).toEqual(before);
      // the text never leaves its own cell on the left (a deep indent in a 120 px column is clamped, never pushed out)
      await parkCursor(page);
      const k = await cellInk(page, 1, 1);
      expect(k.left === -1 || k.left >= after[1].x + 1, `ink starts at ${k.left}, cell starts at ${after[1].x}`).toBe(true);
      // a different row, a different neighbour: untouched
      expect(aligned(await edges(page, 2))).toBe(true);
    });
  }

  test("an already-indented label is not disturbed when its neighbour is cleared or filled (both directions)", async ({ page }) => {
    await open(page, "e2e-indent-neighbour");
    await clickCell(page, 2, 1);
    await pressN(page, INC, 4);
    const x0 = await ink(page, 2, 1);
    await clickCell(page, 2, 2); await press(page, "Delete");
    expect(near(await ink(page, 2, 1), x0)).toBe(true);
    await enter(page, 2, 3, "999");
    expect(near(await ink(page, 2, 1), x0)).toBe(true);
    expect(aligned(await edges(page, 2))).toBe(true);
    await clickCell(page, 2, 3); await press(page, "Delete");
    await enter(page, 2, 2, "25000");
    expect(near(await ink(page, 2, 1), x0)).toBe(true);
    expect(aligned(await edges(page, 2))).toBe(true);
  });
});
