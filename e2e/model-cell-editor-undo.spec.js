/* Model workspace — NEW-1 (2026-10-29): Ctrl+Z while a cell editor is open must act on the editor's
 * text ONLY, never on the sheet's committed edits (owner, Windows: "start typing into a cell, press
 * Ctrl+Z to remove what I just typed — instead the sheet undo starts undoing OTHER, earlier changes").
 *
 * PORTED TO THE UNIVER GRID (NEW-2, 2026-10-31 — the Univer canvas is the grid for every account, the old DOM grid is gone from
 * this path). The grid is a canvas, so each test drives it with REAL mouse + keys at a cell's computed point (e2e/lib/univerGrid.js)
 * and READS state through Univer's own facade: committed cells via the worksheet, the text still IN FLIGHT in the cell editor / the
 * formula bar via their editor documents (`cellEditorText`, `formulaBarText`). Univer groups rapid typing into ONE undo step (so does
 * Excel), so "abc" is typed with a pause between letters to make each its own step — the same character-by-character result the old
 * editor gave. Equivalent checks in the ui-audit parity harness: `undo-typing` (ui-audit/verify-univer-parity.mjs).
 *
 * Run: npx playwright test e2e/model-cell-editor-undo.spec.js */
import { test, expect } from "@playwright/test";
import {
  openSpreadsheet, enter, clickCell, dblclickCell, expectValue, value, cellEditorText, formulaBarText, clickFormulaBar,
} from "./lib/univerGrid.js";

/** Two COMMITTED edits = two sheet-level undo frames the bug would start eating. */
async function seed(page, id) {
  await openSpreadsheet(page, id, { slug: "model", name: "ZZ Model undo e2e (throwaway)" });
  await enter(page, 0, 0, "500");
  await enter(page, 1, 0, "300");
  await expectValue(page, 0, 0, 500);
  await expectValue(page, 1, 0, 300);
}

const committedIntact = async (page) => {
  await expectValue(page, 0, 0, 500, "A1 must still be 500");
  await expectValue(page, 1, 0, 300, "A2 must still be 300");
};
const editorIs = (page, text, msg) => expect.poll(() => cellEditorText(page), { message: msg, timeout: 4000 }).toBe(text);
/** Type one letter at a time with a pause long enough that Univer closes its typing group — each letter is its own undo step. */
async function typeSlowly(page, text) { for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(700); } }

test.describe("Spreadsheet — undo while typing in a cell", () => {
  test("Ctrl+Z undoes the typing inside the editor and never touches committed cells", async ({ page }) => {
    await seed(page, "e2e-model-edundo-1");
    await clickCell(page, 2, 0);
    await typeSlowly(page, "abc");
    await editorIs(page, "abc", "the editor holds what was typed");
    await page.keyboard.press("Control+z");
    await editorIs(page, "ab", "Ctrl+Z took the last letter out of the EDITOR");
    await committedIntact(page);
    await page.keyboard.press("Control+z");
    await editorIs(page, "a");
    await page.keyboard.press("Control+y");
    await editorIs(page, "ab", "Ctrl+Y redoes inside the editor");
    await page.keyboard.press("Control+Shift+z");
    await editorIs(page, "abc", "Ctrl+Shift+Z redoes inside the editor");
    await committedIntact(page);
    // a known-good control: the same sequence is OBSERVABLE as a real commit — Enter lands exactly what the editor showed
    await page.keyboard.press("Enter");
    await expectValue(page, 2, 0, "abc", "the redone text commits");
  });

  test("with nothing left to undo, Ctrl+Z puts the editor back to the cell's original value and never reaches the sheet", async ({ page }) => {
    await seed(page, "e2e-model-edundo-2");
    await dblclickCell(page, 0, 0); // edit A1 (500)
    await editorIs(page, "500", "double-click opens A1 with its content");
    await page.keyboard.press("End");
    await page.keyboard.type("7");
    await page.waitForTimeout(800);
    await editorIs(page, "5007");
    await page.keyboard.press("Control+z");
    await editorIs(page, "500", "first Ctrl+Z removes the 7");
    await page.keyboard.press("Control+z");
    await editorIs(page, "500", "a second Ctrl+Z has nothing left in the editor — it must not walk into the sheet's own history");
    await committedIntact(page);
    await page.keyboard.press("Escape");
    await committedIntact(page);
  });

  test("after Enter, Ctrl+Z undoes that whole committed cell edit as one step", async ({ page }) => {
    await seed(page, "e2e-model-edundo-3");
    await enter(page, 2, 0, "999");
    await expectValue(page, 2, 0, 999);
    await page.keyboard.press("Control+z");
    await expectValue(page, 2, 0, null, "the 999 is gone in ONE Ctrl+Z");
    await committedIntact(page);
  });

  test("Ctrl+Z pressed the instant after typing (before the editor has settled) is still the editor's, not the sheet's", async ({ page }) => {
    // The old grid's B1287888 window was "the key lands on the grid container, not the input". Univer keeps its editor as a hidden
    // focus holder, so the equivalent person-level race is: type, and press Ctrl+Z with NO pause at all.
    await seed(page, "e2e-model-edundo-4");
    await clickCell(page, 2, 0);
    await page.keyboard.type("x");
    await page.waitForTimeout(700);
    await page.keyboard.type("y");
    await page.keyboard.press("Control+z"); // no settle
    await editorIs(page, "x", "the editor undid its own last letter");
    await committedIntact(page);
    await page.keyboard.press("Escape");
    await expectValue(page, 2, 0, null, "Escape abandoned the typing; nothing was committed");
    await committedIntact(page);
  });

  test("the formula bar keeps undo for its own text (headers are fixed labels, so there is no column-rename box any more)", async ({ page }) => {
    await seed(page, "e2e-model-edundo-5");
    await clickCell(page, 2, 0);
    await clickFormulaBar(page);
    await page.keyboard.type("hello");
    await expect.poll(() => formulaBarText(page)).toBe("hello");
    await page.keyboard.press("Control+z");
    await expect.poll(() => formulaBarText(page), { message: "Ctrl+Z in the formula bar undid the formula bar's own text" }).not.toBe("hello");
    await committedIntact(page);
    expect(await value(page, 2, 0)).toBeNull();
  });
});
