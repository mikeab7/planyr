/* Left sheet-rail toggle must not jump the drawing (B838 — VIEWPORT-STABLE).
 *
 * Drives the REAL Review workspace LOGGED OUT: opens a local sample PDF (client-side pdf.js, no
 * auth), then collapses / expands / drag-resizes the left sheet rail. The rail is an in-flow docked
 * column to the LEFT of the flex:1 canvas viewport; the sheet is translate(view.tx, view.ty) from
 * that moving origin. Before B838 there was NO compensation, so the rail delta slid the whole sheet
 * sideways by the full rail width (~198px on collapse). B838 ports the B837 discipline: a
 * useLayoutEffect measures the real wrapRef.offsetLeft and folds the exact delta into view.tx in the
 * same paint.
 *
 * The invariant this guards: the sheet's viewport screen-x is unchanged across every rail toggle.
 * We read the sheet box's boundingBox directly (it carries the live translate) + the data-view-tx
 * seam. Fully headless — no aerial tiles or auth involved.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const PDF = fileURLToPath(new URL("./fixtures/sample.pdf", import.meta.url));

test.describe("doc review sheet-rail toggle (B838)", () => {
  test("collapsing / expanding / resizing the sheet rail never jumps the drawing", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Reach the Review workspace and load a local PDF (no auth).
    await page.goto("/#/markup", { waitUntil: "load" });
    await page.waitForTimeout(1200);
    if (!(await page.locator('input[type="file"]').count())) {
      await page.getByRole("button", { name: /review/i }).first().click().catch(() => {});
      await page.waitForTimeout(800);
    }
    await page.locator('input[type="file"]').first().setInputFiles(PDF);
    const sheet = page.locator('[data-testid="review-sheet"]');
    await sheet.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000);

    const sheetLeft = async () => {
      const b = await sheet.boundingBox();
      return b ? b.x : null;
    };
    const base = await sheetLeft();
    expect(base).not.toBeNull();

    // Collapse the rail (224 → 26px). Without compensation the sheet would slide ~198px.
    await page.locator('[data-testid="sheet-rail-collapse"]').click();
    await page.waitForTimeout(400);
    expect(Math.abs((await sheetLeft()) - base), "collapse drifted the sheet").toBeLessThanOrEqual(2);

    // Expand it back.
    await page.locator('[data-testid="sheet-rail-expand"]').click();
    await page.waitForTimeout(400);
    expect(Math.abs((await sheetLeft()) - base), "expand drifted the sheet").toBeLessThanOrEqual(2);

    // Drag-resize the rail wider by ~120px — the sheet must stay pinned through the whole drag.
    const h = await page.locator('[data-testid="sheet-rail-resizer"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 120, h.y + h.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(Math.abs((await sheetLeft()) - base), "drag-resize drifted the sheet").toBeLessThanOrEqual(2);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
