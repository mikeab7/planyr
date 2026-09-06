/* Model workspace — the command palette (NEW-1, owner chat block: "Command palette for the
 * Spreadsheet, and get the audit tools out of the overflow"). Live-verify per the brief: open the
 * Spreadsheet, press Ctrl+K, type a few letters of an action, press Enter, and confirm the action
 * actually happened to the sheet — not just that a menu opened or closed. Covers at least three
 * different actions (a formatting edit, a structural edit, and an audit tool), Escape closing the
 * palette without running anything, and that Ctrl+F still opens Find. Both themes.
 *
 * Run: npx playwright test e2e/model-command-palette.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const paletteInput = (page) => page.getByTestId("model-command-palette-input");

async function seedProject(page, id) {
  const site = {
    id, groupId: id, site: "ZZ Model palette e2e (throwaway)", name: "ZZ Model palette e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

async function setTheme(page, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) { /* best-effort */ } }, theme);
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function setCell(page, r, c, text) {
  await cell(page, r, c).click();
  await typeAndEnter(page, text);
}

async function openPalette(page) {
  await page.keyboard.press("Control+K");
  await expect(paletteInput(page)).toBeVisible();
}

/** Open the palette, type `query`, press Enter — mirrors exactly how a real user drives it. */
async function runCommand(page, query) {
  await openPalette(page);
  await paletteInput(page).fill(query);
  await page.keyboard.press("Enter");
}

for (const theme of ["light", "dark"]) {
  test.describe(`Model workspace — command palette (${theme} theme)`, () => {
    test("Ctrl+K opens it, three different actions (incl. an audit tool) actually happen, Escape closes without running, Ctrl+F is untouched", async ({ page }) => {
      const id = `e2e-model-palette-${theme}`;
      await seedProject(page, id);
      await setTheme(page, theme);
      await page.goto(`/#/project/${id}/model`);
      await expect(sheetEl(page)).toBeVisible();

      await setCell(page, 0, 0, "hello");

      // ---- Action 1: a formatting command ("Bold") — confirm the cell actually renders bold. ----
      await cell(page, 0, 0).click();
      await runCommand(page, "bold");
      await expect(paletteInput(page)).toHaveCount(0); // the palette closes itself the instant an action runs
      await expect(cell(page, 0, 0)).toHaveCSS("font-weight", "700");

      // ---- Action 2: a structural command ("Insert Row Above") — confirm the sheet's content
      // actually shifted down a row, not just that some menu closed. ----
      await cell(page, 0, 0).click();
      await runCommand(page, "insert row above");
      await expect(cell(page, 0, 0)).toHaveText("");
      await expect(cell(page, 1, 0)).toHaveText("hello");

      // ---- Action 3: an audit tool — the module's own differentiator ("Trace Precedents") —
      // confirm the trace arrows actually drew, then clear them with the existing Escape shortcut. ----
      await setCell(page, 2, 0, "5");
      await setCell(page, 2, 1, "=A3*2");
      await cell(page, 2, 1).click();
      await runCommand(page, "trace precedents");
      await expect(page.getByTestId("model-trace-overlay")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("model-trace-overlay")).toHaveCount(0);

      // ---- Escape closes the palette WITHOUT running anything — a typed-but-not-committed query
      // must not silently apply. ----
      await cell(page, 1, 1).click();
      await openPalette(page);
      await paletteInput(page).fill("bold");
      await page.keyboard.press("Escape");
      await expect(paletteInput(page)).toHaveCount(0);
      await expect(cell(page, 1, 1)).not.toHaveCSS("font-weight", "700");

      // ---- Ctrl+F still opens Find — the palette's own Ctrl+K binding never displaced it. ----
      await page.keyboard.press("Control+F");
      await expect(page.getByTestId("model-find-input")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("model-find-input")).toHaveCount(0);
    });

    test("the permanent Formula Auditing toolbar (row 1) is reachable without opening any overflow menu", async ({ page }) => {
      const id = `e2e-model-palette-audit-home-${theme}`;
      await seedProject(page, id);
      await setTheme(page, theme);
      await page.goto(`/#/project/${id}/model`);
      await expect(sheetEl(page)).toBeVisible();

      // NEW-1 — Formula Auditing moved off the collapsible Home ribbon into a permanent row-1
      // home, so its buttons must be reachable DIRECTLY, with no "More ▾" click required, at any
      // viewport this suite runs at.
      await expect(page.getByTestId("ribbon-trace-precedents")).toBeVisible();
      await expect(page.getByTestId("ribbon-trace-dependents")).toBeVisible();
      await expect(page.getByTestId("ribbon-inconsistencies")).toBeVisible();
    });
  });
}
