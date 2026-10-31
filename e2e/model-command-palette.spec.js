/* Model workspace — the command palette (NEW-1, owner chat block: "Command palette for the
 * Spreadsheet, and get the audit tools out of the overflow"). Live-verify per the brief: open the
 * Spreadsheet, press Ctrl+K, type a few letters of an action, press Enter, and confirm the action
 * actually happened to the sheet — not just that a menu opened or closed. Covers at least three
 * different actions (a formatting edit, a structural edit, and an audit tool), Escape closing the
 * palette without running anything, and that Ctrl+F still opens Find. Both themes.
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31): the palette is the same component fed by the Planyr tools controller (lib/univerTools/);
 * the grid is a canvas, so "the action actually happened" is read through Univer's facade (bold style, the shifted value, the trace
 * state + arrow pixels), never from a DOM cell. Ctrl+F is Univer's own Find dialog.
 *
 * Run: npx playwright test e2e/model-command-palette.spec.js
 */
import { test, expect } from "@playwright/test";
import {
  armUniverE2E, seedProject, waitForGrid, enter, clickCell, press, value, styleOf, openPalette, runPaletteCommand, toolsState, showFormulasTab,
  countPixels, gridClip, PIXEL,
} from "./lib/univerGrid.js";

const paletteInput = (page) => page.getByTestId("model-command-palette-input");

async function setTheme(page, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) { /* best-effort */ } }, theme);
}
async function open(page, id, theme) {
  await armUniverE2E(page);
  await seedProject(page, id, "ZZ Model palette e2e (throwaway)");
  await setTheme(page, theme);
  await page.goto(`/#/project/${id}/spreadsheet`);
  await waitForGrid(page);
}

for (const theme of ["light", "dark"]) {
  test.describe(`Model workspace — command palette (${theme} theme)`, () => {
    test("Ctrl+K opens it, three different actions (incl. an audit tool) actually happen, Escape closes without running, Ctrl+F is untouched", async ({ page }) => {
      await open(page, `e2e-model-palette-${theme}`, theme);
      expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme") || ""), "the requested theme is really applied").toContain(theme);

      await enter(page, 0, 0, "hello");

      // ---- Action 1: a formatting command ("Bold") — confirm the cell really is bold in Univer's own style. ----
      await clickCell(page, 0, 0);
      expect((await styleOf(page, 0, 0)).bold, "KNOWN-GOOD: not bold before").toBe(false);
      await runPaletteCommand(page, "bold");
      await expect(paletteInput(page)).toHaveCount(0); // the palette closes itself the instant an action runs
      await expect.poll(async () => (await styleOf(page, 0, 0)).bold).toBe(true);

      // ---- Action 2: a structural command ("Insert Row Above") — confirm the sheet's content
      // actually shifted down a row, not just that some menu closed. ----
      await clickCell(page, 0, 0);
      await runPaletteCommand(page, "insert row above");
      await expect.poll(() => value(page, 0, 0)).toBeNull();
      await expect.poll(() => value(page, 1, 0)).toBe("hello");

      // ---- Action 3: an audit tool — the module's own differentiator ("Trace Precedents") —
      // confirm the trace actually rendered (state AND canvas pixels), then clear it with the existing Escape shortcut. ----
      await toolsState(page, (t) => { if (t.getState().autoColor) t.run("planyr.tools.toggle-autocolor"); return true; }); // blue input text would read as arrow ink
      await enter(page, 2, 0, "5");
      await enter(page, 2, 1, "=A3*2");
      await clickCell(page, 8, 5);
      const clip = await gridClip(page, 0, 0, 5, 3);
      const base = await countPixels(page, clip, PIXEL.ARROW);
      await clickCell(page, 2, 1);
      await runPaletteCommand(page, "trace precedents");
      expect(await toolsState(page, (t) => { const r = t.getState().rendered; return r && { mode: r.mode, arrows: r.arrows.length }; })).toEqual({ mode: "precedents", arrows: 1 });
      await clickCell(page, 8, 5);
      await expect.poll(async () => (await countPixels(page, clip, PIXEL.ARROW)) - base, { message: "the arrow is drawn on the canvas" }).toBeGreaterThan(30);
      await clickCell(page, 2, 1);
      await press(page, "Escape");
      expect(await toolsState(page, (t) => t.getState().trace)).toBeNull();

      // ---- Escape closes the palette WITHOUT running anything — a typed-but-not-committed query
      // must not silently apply. ----
      await clickCell(page, 1, 1);
      await openPalette(page);
      await page.keyboard.type("bold", { delay: 10 });
      await page.keyboard.press("Escape");
      await expect(paletteInput(page)).toHaveCount(0);
      expect((await styleOf(page, 1, 1)).bold, "Escape ran nothing").toBe(false);

      // ---- Ctrl+F still opens Find — the palette's own Ctrl+K binding never displaced it. ----
      // (a DIFFERENT cell: two clicks on the same cell inside Univer's double-click window open the editor — a real double-click, not a bug)
      await clickCell(page, 4, 3);
      await page.keyboard.press("Control+f");
      const find = page.getByPlaceholder("Find", { exact: true });
      await expect(find).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(find).toHaveCount(0);
    });

    test("the Formula Auditing tools are reachable on the toolbar without opening any overflow menu", async ({ page }) => {
      await open(page, `e2e-model-palette-audit-home-${theme}`, theme);
      // NEW-1 — Formula Auditing is a permanent toolbar group (Univer's Formulas tab, one header strip), reachable DIRECTLY at the default viewport.
      await showFormulasTab(page);
      const vw = page.viewportSize().width;
      for (const id of ["trace-precedents", "trace-dependents", "toggle-inconsistencies"]) {
        const btn = page.locator(`[data-u-command="planyr.tools.${id}"]`).first();
        await expect(btn, id).toBeVisible();
        const box = await btn.boundingBox();
        expect(box.width, `${id} has a real box`).toBeGreaterThan(10);
        expect(box.x + box.width, `${id} sits inside the viewport, not off in an overflow`).toBeLessThanOrEqual(vw);
      }
    });
  });
}
