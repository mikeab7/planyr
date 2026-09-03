/* Model workspace — Stage 3 formula-auditing tools (owner brief 2026-09-03), live-browser
 * verification: NEW-1 (trace precedents/dependents, level-at-a-time, cross-sheet markers) and
 * NEW-2 (inconsistent-formula detection + dismiss). Seeds a throwaway local project the same way
 * e2e/model-spreadsheet.spec.js does — nothing here touches real production data.
 *
 * Run: npx playwright test e2e/model-audit-tools.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model audit e2e (throwaway)", name: "ZZ Model audit e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function setCell(page, r, c, text) {
  await cell(page, r, c).click();
  await typeAndEnter(page, text);
}

/** Click a ribbon control by its own testid — DIRECTLY if the group is currently visible inline,
 *  or via the trailing "More ▾" overflow popover if the window is narrow enough that
 *  ribbonLayout.js collapsed its group there (the popover only mounts its contents while open —
 *  see Ribbon.jsx's MoreMenu). Mirrors how a real user would actually reach the control — which,
 *  for this new Audit group, is the COMMON case at the owner's own real working width (729px, far
 *  narrower than this suite's default test viewport, which already collapses it). MoreMenu closes
 *  itself the instant a plain action button (not a nested dropdown trigger) is picked from inside
 *  it — see Ribbon.jsx's own `aria-haspopup` note — so nothing further is needed to reach the
 *  target: no leftover popover to dismiss, no risk to a floating panel the click just opened. */
async function clickRibbonButton(page, testId) {
  const direct = page.getByTestId(testId);
  if (await direct.count()) { await direct.click(); return; }
  await page.getByTestId("ribbon-more").click();
  await page.getByTestId(testId).click();
}

async function ribbonButtonText(page, testId) {
  const direct = page.getByTestId(testId);
  if (await direct.count()) return direct.textContent();
  await page.getByTestId("ribbon-more").click();
  const text = await page.getByTestId(testId).textContent();
  await page.keyboard.press("Escape"); // nothing else opened this time — safe to just back out
  return text;
}

test.describe("Model workspace — trace precedents/dependents (NEW-1)", () => {
  test("trace precedents draws one arrow at level 1, more at level 2, including a NAMED-RANGE hop", async ({ page }) => {
    const id = "e2e-model-trace-precedents";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    // A1 = 100 (input), C1 = 0.05, named "TaxRate", D1 = A1*TaxRate, E1 = D1+1
    await setCell(page, 0, 0, "100");
    await setCell(page, 0, 2, "0.05");
    // Define the name against the current selection (C1) via the Name Manager's own fast path.
    await cell(page, 0, 2).click();
    await clickRibbonButton(page, "ribbon-names");
    await page.getByTestId("name-manager-new-input").fill("TaxRate");
    await page.getByTestId("name-manager-create").click();
    await page.getByTestId("name-manager").getByTitle("Close (Esc)").click();

    await setCell(page, 0, 3, "=A1*TaxRate"); // D1
    await setCell(page, 0, 4, "=D1+1"); // E1

    await cell(page, 0, 4).click(); // select E1
    await clickRibbonButton(page, "ribbon-trace-precedents");
    await expect(page.getByTestId("model-trace-overlay").locator("line")).toHaveCount(1);

    await clickRibbonButton(page, "ribbon-trace-precedents"); // step to level 2
    await expect(page.getByTestId("model-trace-overlay").locator("line")).toHaveCount(3);
    // The named-range hop's dashed rect sits over C1 — nothing asserts pixel position here
    // (SheetView.jsx's own unit-level geometry is covered elsewhere); this proves the SECOND
    // click actually revealed a THIRD edge, i.e. real level-at-a-time stepping.

    await clickRibbonButton(page, "ribbon-trace-clear");
    await expect(page.getByTestId("model-trace-overlay")).toHaveCount(0);
  });

  test("trace dependents works from a plain INPUT cell, not just a formula cell", async ({ page }) => {
    const id = "e2e-model-trace-dependents";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    await setCell(page, 0, 0, "5"); // A1, a plain literal
    await setCell(page, 0, 1, "=A1*2"); // B1
    await setCell(page, 1, 1, "=A1+1"); // B2

    await cell(page, 0, 0).click(); // select A1
    await clickRibbonButton(page, "ribbon-trace-dependents");
    await expect(page.getByTestId("model-trace-overlay").locator("line")).toHaveCount(2);
  });

  test("a cross-sheet precedent renders as a clickable marker, never an arrow, and navigates on click", async ({ page }) => {
    const id = "e2e-model-trace-crosssheet";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    await setCell(page, 0, 0, "10"); // Sheet1!A1
    await page.getByTestId("model-add-sheet").click(); // create Sheet2, switches active tab to it
    await setCell(page, 0, 0, "=Sheet1!A1*2"); // Sheet2!A1

    await cell(page, 0, 0).click(); // Sheet2!A1 still selected
    await clickRibbonButton(page, "ribbon-trace-precedents");
    await expect(page.getByTestId("model-trace-cross-sheet-marker")).toBeVisible();
    await expect(page.getByTestId("model-trace-overlay").locator("line")).toHaveCount(0);

    await page.getByTestId("model-trace-cross-sheet-marker").click();
    await expect(page.getByTestId("model-sheet-tab-0")).toHaveAttribute("data-tab-index", "0");
    // Landed back on Sheet1, at A1 — its value proves the navigation, not just the tab switch.
    await expect(cell(page, 0, 0)).toHaveText("10");
  });

  test("Escape clears an active trace", async ({ page }) => {
    const id = "e2e-model-trace-escape";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await setCell(page, 0, 0, "5");
    await setCell(page, 0, 1, "=A1*2");
    await cell(page, 0, 1).click();
    await clickRibbonButton(page, "ribbon-trace-precedents");
    await expect(page.getByTestId("model-trace-overlay")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-trace-overlay")).toHaveCount(0);
  });
});

test.describe("Model workspace — inconsistent-formula detection (NEW-2)", () => {
  test("overtyping one cell in a formula run flags it, lists it, and Dismiss clears it for good", async ({ page }) => {
    const id = "e2e-model-inconsistency";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    for (let r = 0; r < 5; r++) {
      await setCell(page, r, 1, String(10 + r));
      await setCell(page, r, 2, "2");
      await setCell(page, r, 0, `=B${r + 1}*C${r + 1}`);
    }
    await setCell(page, 2, 0, "5000"); // row 3 overtyped with a hardcoded number

    await expect(cell(page, 2, 0).getByTestId("model-inconsistency-marker")).toBeAttached();
    expect(await ribbonButtonText(page, "ribbon-inconsistencies")).toContain("1");

    await clickRibbonButton(page, "ribbon-inconsistencies");
    await expect(page.getByTestId("inconsistency-panel")).toBeVisible();
    await expect(page.getByTestId("inconsistency-row")).toHaveCount(1);
    await expect(page.getByTestId("inconsistency-row")).toContainText("A3");

    await page.getByTestId("inconsistency-row").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("inconsistency-row")).toHaveCount(0);
    await expect(cell(page, 2, 0).getByTestId("model-inconsistency-marker")).toHaveCount(0);

    // Dismissal survives a reload (persisted on the sheet, not ephemeral view state).
    await page.reload();
    await expect(sheetEl(page)).toBeVisible();
    await expect(cell(page, 2, 0).getByTestId("model-inconsistency-marker")).toHaveCount(0);
  });

  test("a deliberate exception (a subtotal at the run's edge) is never flagged in the first place", async ({ page }) => {
    const id = "e2e-model-inconsistency-total";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    for (let r = 0; r < 4; r++) {
      await setCell(page, r, 1, String(10 + r));
      await setCell(page, r, 0, `=B${r + 1}*2`);
    }
    await setCell(page, 4, 0, "=SUM(A1:A4)"); // total row, run's own edge
    await expect(page.getByTestId("model-inconsistency-marker")).toHaveCount(0);
    const text = await ribbonButtonText(page, "ribbon-inconsistencies");
    expect(text).not.toMatch(/[1-9]/);
  });
});

// ⛔ B1117409 (owner brief 2026-09-03) — reported as "Enter does not submit the Name Manager New
// name field ... only the Define button works." Investigated (code read + git blame on
// NameManager.jsx: the New name input's `onKeyDown` has called the identical `create()` the
// Define button calls since the very first commit that introduced this panel) and driven live,
// through the EXACT reported path — ribbon overflow, Name Manager, type a name, press a real
// (native, bubbling) Enter key — and it defines the name correctly, same as clicking Define.
// NOT REPRODUCIBLE on this codebase. Filed anyway per this repo's DEDUPE-FIRST/STANDING RULE #2
// discipline, and left here as a permanent regression lock so a future change to this panel that
// broke Enter-to-define would fail CI immediately instead of silently reaching production.
test.describe("Model workspace — Name Manager (B1117409)", () => {
  test("pressing Enter in the New name field defines the name, same as clicking Define — reached via the ribbon overflow path, as reported", async ({ page }) => {
    const id = "e2e-model-namemgr-enter";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();

    await cell(page, 0, 0).click(); // "Select a cell" per the repro
    await clickRibbonButton(page, "ribbon-names"); // opens via the ribbon overflow ("More ▾") at this viewport
    await expect(page.getByTestId("name-manager")).toBeVisible();

    const input = page.getByTestId("name-manager-new-input");
    await input.click();
    await page.keyboard.type("MyRange");
    await page.keyboard.press("Enter"); // a real, native, bubbling key press — not a synthetic dispatch
    await expect(input).toHaveValue(""); // the field only ever clears once the name was actually defined (create() guards on canCreate)
    await expect(page.getByTestId("name-manager-new-error")).toHaveCount(0);

    const rows = page.getByTestId("name-manager-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("MyRange"); // the range really was defined, not just cleared
  });
});
