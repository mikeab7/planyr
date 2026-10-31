/* Model workspace — Stage 3 formula-auditing tools (owner brief 2026-09-03), live-browser
 * verification: NEW-1 (trace precedents/dependents, level-at-a-time, cross-sheet markers) and
 * NEW-2 (inconsistent-formula detection + dismiss). Seeds a throwaway local project — nothing here touches real production data.
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31): the grid is a canvas, so cells are driven with REAL mouse/keyboard at a cell's computed
 * point and READ through Univer's facade + the Planyr tools controller (e2e/lib/univerGrid.js); what must be DRAWN (an arrow, a corner
 * marker) is asserted on the canvas's PIXELS, never on a registration. The tools sit on the Formulas tab of Univer's one header strip.
 *
 * Run: npx playwright test e2e/model-audit-tools.spec.js
 */
import { test, expect } from "@playwright/test";
import {
  openSpreadsheet, enter, enterFormula, clickCell, press, expectValue, flushGrid, waitForGrid, toolsState, clickPlanyrTool, countPixels, PIXEL,
  cornerClip, gridClip, runPaletteCommand, defineNameFromSelection, inSheet, sheetNames, addSheetViaTab,
} from "./lib/univerGrid.js";

const arrowCount = (page) => toolsState(page, (t) => { const r = t.getState().rendered; return r ? r.arrows.length : 0; });
const renderedOf = (page) => toolsState(page, (t) => { const r = t.getState().rendered; return r && { mode: r.mode, level: r.level, arrows: r.arrows.length, markers: (r.markers || []).length }; });
const flagsOf = (page) => toolsState(page, (t) => t.getState().flags.map((f) => `${f.row}:${f.col}:${f.kind}`));
// The input/formula colour convention paints typed inputs BLUE, which is the arrow's colour; the pixel checks measure arrows, so it goes off first.
const colourOff = (page) => toolsState(page, (t) => { if (t.getState().autoColor) t.run("planyr.tools.toggle-autocolor"); return true; });

test.describe("Model workspace — trace precedents/dependents (NEW-1)", () => {
  test("trace precedents draws one arrow at level 1, more at level 2, including a NAMED-RANGE hop", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-trace-precedents");
    await colourOff(page);

    // A1 = 100 (input), C1 = 0.05, named "TaxRate", D1 = A1*TaxRate, E1 = D1+1
    await enter(page, 0, 0, "100");
    await enter(page, 0, 2, "0.05");
    await clickCell(page, 0, 2);
    await defineNameFromSelection(page, "TaxRate");   // palette → Name Manager → define against the current selection (C1)
    await enterFormula(page, 0, 3, "=A1*TaxRate");     // D1 (ends in a name: see enterFormula)
    await enter(page, 0, 4, "=D1+1");                 // E1
    await expectValue(page, 0, 3, 5);
    await expectValue(page, 0, 4, 6);

    await clickCell(page, 0, 4);                      // select E1
    const clip = await gridClip(page, 0, 0, 4, 5);
    await clickCell(page, 10, 8);                     // park the cursor away from the clip so it cannot read as ink
    const base = await countPixels(page, clip, PIXEL.ARROW);
    await clickCell(page, 0, 4);
    await clickPlanyrTool(page, "trace-precedents");
    expect(await renderedOf(page), "level 1: one precedent edge (D1 → E1)").toMatchObject({ mode: "precedents", level: 1, arrows: 1 });
    await clickCell(page, 10, 8);                     // moving the cursor away does not clear the trace
    await expect.poll(async () => (await countPixels(page, clip, PIXEL.ARROW)) - base, { message: "an arrow is painted on the canvas" }).toBeGreaterThan(40);

    await clickCell(page, 0, 4);
    await clickPlanyrTool(page, "trace-precedents"); // step to level 2
    // level 2 adds D1's own precedents: A1 and (through the name) C1 — a THIRD edge and a FOURTH, exactly like the old grid's count of 3 arrows beyond level 1's
    const lvl2 = await renderedOf(page);
    expect(lvl2.level).toBe(2);
    expect(lvl2.arrows, "level 2 reveals D1's precedents A1 and the named-range hop to C1 (1 + 2 edges)").toBe(3);

    await clickPlanyrTool(page, "trace-clear");
    expect(await toolsState(page, (t) => t.getState().trace)).toBeNull();
    await clickCell(page, 10, 8);
    await expect.poll(async () => (await countPixels(page, clip, PIXEL.ARROW)) - base, { message: "the arrows are gone from the canvas" }).toBeLessThan(6);
  });

  test("trace dependents works from a plain INPUT cell, not just a formula cell", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-trace-dependents");
    await enter(page, 0, 0, "5");        // A1, a plain literal
    await enter(page, 0, 1, "=A1*2");    // B1
    await enter(page, 1, 1, "=A1+1");    // B2
    await clickCell(page, 0, 0);
    await clickPlanyrTool(page, "trace-dependents");
    expect(await renderedOf(page)).toMatchObject({ mode: "dependents", level: 1, arrows: 2 });
  });

  test("a cross-sheet precedent renders as a marker on the cell, never an arrow", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-trace-crosssheet");
    await colourOff(page);
    await enter(page, 0, 0, "10");                                    // Sheet1!A1
    await addSheetViaTab(page);                                       // the real "+" in the tab strip; Univer switches to the new sheet
    expect((await sheetNames(page)).filter((s) => s.active).length).toBe(1);
    await enter(page, 0, 0, "=Sheet1!A1*2");                          // Sheet2!A1
    await expectValue(page, 0, 0, 20);
    await clickCell(page, 0, 0);
    await clickPlanyrTool(page, "trace-precedents");
    const r = await renderedOf(page);
    expect(r.arrows, "no arrow for an edge that leaves the sheet").toBe(0);
    expect(r.markers, "one marker for the edge that leaves it").toBe(1);
    const clip = await gridClip(page, 0, 0, 4, 6);
    expect(await countPixels(page, clip, "b > 150 && b - r > 80 && g < 170")).toBeGreaterThan(20); // the marker label is drawn on the canvas (blue frame)
    await expect(page.getByTestId("univer-trace-strip")).toContainText(/link/);
    // The old grid's DOM marker navigated to Sheet1 on click. A Univer canvas label is not clickable — a documented limit
    // (docs/SPREADSHEET-UNIVER-SPIKE.md, "Honest limits"); the person goes to the other sheet from the tab strip.
  });

  test("Escape clears an active trace", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-trace-escape");
    await enter(page, 0, 0, "5");
    await enter(page, 0, 1, "=A1*2");
    await clickCell(page, 0, 1);
    await clickPlanyrTool(page, "trace-precedents");
    expect((await renderedOf(page)).arrows).toBe(1);
    await clickCell(page, 0, 1);       // focus back on the grid, as a person would
    await press(page, "Escape");
    expect(await toolsState(page, (t) => t.getState().trace)).toBeNull();
    await expect(page.getByTestId("univer-trace-strip")).toHaveCount(0);
  });
});

test.describe("Model workspace — inconsistent-formula detection (NEW-2)", () => {
  test("overtyping one cell in a formula run flags it, lists it, and Dismiss clears it for good", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-inconsistency");
    await colourOff(page);
    for (let r = 0; r < 5; r++) {
      await enter(page, r, 1, String(10 + r));
      await enter(page, r, 2, "2");
      await enter(page, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    await expectValue(page, 4, 0, 28);
    expect(await flagsOf(page), "KNOWN-GOOD: a clean formula run carries no flag").toEqual([]);
    await enter(page, 2, 0, "5000"); // row 3 overtyped with a hardcoded number
    await expect.poll(() => flagsOf(page)).toEqual(["2:0:hardcoded"]);

    await clickCell(page, 9, 5);
    expect(await countPixels(page, await cornerClip(page, 2, 0), PIXEL.ORANGE), "corner marker on A3").toBeGreaterThanOrEqual(4);
    expect(await countPixels(page, await cornerClip(page, 1, 0), PIXEL.ORANGE), "none on A2 (known-good control)").toBe(0);

    await clickPlanyrTool(page, "toggle-inconsistencies");
    await expect(page.getByTestId("inconsistency-panel")).toBeVisible();
    await expect(page.getByTestId("inconsistency-row")).toHaveCount(1);
    await expect(page.getByTestId("inconsistency-row")).toContainText("A3");

    await page.getByTestId("inconsistency-row").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("inconsistency-row")).toHaveCount(0);
    expect(await flagsOf(page)).toEqual([]);
    expect(await countPixels(page, await cornerClip(page, 2, 0), PIXEL.ORANGE), "marker gone after Dismiss").toBe(0);

    // Dismissal survives a reload (persisted on the sheet, not ephemeral view state).
    await flushGrid(page);
    await page.reload();
    await waitForGrid(page);
    await expectValue(page, 2, 0, 5000, "the overtyped value after reload");
    await page.waitForTimeout(900);
    expect(await flagsOf(page), "dismissal persisted").toEqual([]);
    expect(await countPixels(page, await cornerClip(page, 2, 0), PIXEL.ORANGE)).toBe(0);
  });

  test("a deliberate exception (a subtotal at the run's edge) is never flagged in the first place", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-inconsistency-total");
    for (let r = 0; r < 4; r++) {
      await enter(page, r, 1, String(10 + r));
      await enter(page, r, 0, `=B${r + 1}*2`);
    }
    await enter(page, 4, 0, "=SUM(A1:A4)"); // total row, run's own edge
    await expectValue(page, 4, 0, 92);
    await page.waitForTimeout(900);
    expect(await flagsOf(page)).toEqual([]);
    // Control that the detector is alive in this very page: overtype a middle formula and it must flag.
    await enter(page, 1, 0, "77");
    await expect.poll(() => flagsOf(page)).toEqual(["1:0:hardcoded"]);
  });
});

// ⛔ B1117409 (owner brief 2026-09-03) — reported as "Enter does not submit the Name Manager New
// name field ... only the Define button works." NOT REPRODUCIBLE on the old codebase; kept as a permanent regression lock.
// On Univer the panel is the SAME NameManager component, fed by the tools controller, reached through the command palette.
test.describe("Model workspace — Name Manager (B1117409)", () => {
  test("pressing Enter in the New name field defines the name, same as clicking Define — reached via the command palette", async ({ page }) => {
    await openSpreadsheet(page, "e2e-model-namemgr-enter");
    await clickCell(page, 0, 0); // "Select a cell" per the repro
    await runPaletteCommand(page, "Name Manager");
    await expect(page.getByTestId("name-manager")).toBeVisible();

    const input = page.getByTestId("name-manager-new-input");
    await input.click();
    await page.keyboard.type("MyRange");
    await page.keyboard.press("Enter"); // a real, native, bubbling key press — not a synthetic dispatch
    await expect(input).toHaveValue(""); // the field only ever clears once the name was actually defined (create() guards on canCreate)
    await expect(page.getByTestId("name-manager-new-error")).toHaveCount(0);

    const rows = page.getByTestId("name-manager").getByTestId("name-manager-row"); // (the panel's outer wrapper shares the testid, so scope to the dialog)
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("MyRange"); // the range really was defined, not just cleared
    const names = await page.evaluate(() => { const r = (window.__planyrUniverRead.api().getActiveWorkbook().save().resources || []).find((x) => x.name === "SHEET_DEFINED_NAME_PLUGIN"); return r ? Object.values(JSON.parse(r.data)).map((d) => `${d.name}=${d.formulaOrRefString}`) : []; });
    expect(names.some((n) => /^MyRange=.*\$A\$1$/.test(n)), `Univer holds the name: ${JSON.stringify(names)}`).toBe(true);
  });
});
