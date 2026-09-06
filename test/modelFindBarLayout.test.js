/* FindReplaceBar.jsx / ModelApp.jsx — Find must never overlap ribbon/header chrome (NEW-1,
 * B1251888). Measured live on production build e63dfd1: with Ctrl+F open,
 * `document.elementFromPoint` over the lower half of every Formula Auditing button (Trace
 * Precedents, Trace Dependents, Remove Arrows, Inconsistent formulas), the File menu button, and
 * several ribbon controls (Number format, Percent style, Currency style, Thousands separator,
 * Increase/Decrease decimal, Insert/Delete rows or columns, Freeze panes) all resolved to the
 * Find panel div instead of the control underneath it — because the bar was `position: fixed;
 * top: 46` guessing where the header ended, a guess PR #1487 broke the moment it added the
 * Formula Auditing buttons to the row Find was floating over.
 *
 * ⛔ THE FIX REMOVES THE GUESS ENTIRELY rather than re-tuning the number. FindReplaceBar now
 * renders in NORMAL DOCUMENT FLOW as a sibling AFTER the header (AppHeader) and the ribbon/
 * formula-bar card, BEFORE the sheet grid — never `position: fixed`/`absolute`. That is a
 * structural guarantee, not a measurement: in a vertical flex column, a later sibling with static
 * positioning can only ever push the elements below it down, and can never draw over an earlier
 * sibling, at ANY window width, because it has no coordinates of its own to get wrong. `--check`
 * happy path for this class of bug is exactly what B225984/CI-REQUIRED-CHECK-style incidents in
 * this repo have shown a hardcoded offset cannot give you.
 *
 * CI cannot run a browser (no jsdom in this vitest config — see vitest.config.js's own header), so
 * — same shape as test/headerCenterSlot.test.js — this suite guards the two halves that CAN be
 * checked without one: the rendered component carries no fixed/absolute positioning at all, and
 * the real source places it below the header/ribbon in DOM order. The live click-through itself is
 * V913728 (VERIFICATION.md) for a signed-in-shaped browser pass.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import FindReplaceBar from "../src/workspaces/model/components/FindReplaceBar.jsx";

const FIND_BAR_SOURCE = readFileSync(new URL("../src/workspaces/model/components/FindReplaceBar.jsx", import.meta.url), "utf8");
const MODEL_APP_SOURCE = readFileSync(new URL("../src/workspaces/model/ModelApp.jsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(createElement(FindReplaceBar, {
    sheet: {}, onClose: () => {}, onGoTo: () => {}, onReplaceOne: () => {}, onReplaceAll: () => {},
    ...props,
  }));
}

describe("FindReplaceBar never floats over other chrome (NEW-1, B1251888)", () => {
  it("renders nothing when closed (unchanged behaviour)", () => {
    expect(render({ open: false })).toBe("");
  });

  it("⛔ the rendered bar carries NO fixed or absolute positioning anywhere in its markup", () => {
    const html = render({ open: true });
    expect(html).toContain('data-testid="model-find-row"');
    // react-dom serializes inline styles as `position:fixed` / `position:absolute` with no spaces.
    expect(html).not.toMatch(/position:\s*fixed/);
    expect(html).not.toMatch(/position:\s*absolute/);
  });

  it("⛔ and neither does the source — a fixed/absolute overlay can't quietly come back with a new offset", () => {
    expect(FIND_BAR_SOURCE).not.toMatch(/position:\s*["']fixed["']/);
    expect(FIND_BAR_SOURCE).not.toMatch(/position:\s*["']absolute["']/);
  });

  it("Replace row and every control still render when open (behaviour preserved, only placement changed)", () => {
    const html = render({ open: true, showReplace: true });
    for (const id of ["model-find-input", "model-find-count", "model-replace-input", "model-replace-one", "model-replace-all"]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });
});

describe("ModelApp mounts Find AFTER the header/ribbon and BEFORE the sheet grid, in DOM order (NEW-1, B1251888)", () => {
  it("FindReplaceBar's own JSX sits between the toolbar card's closing tag and <SheetView", () => {
    const toolbarCardCloseIdx = MODEL_APP_SOURCE.indexOf("<FormulaBar");
    const findBarIdx = MODEL_APP_SOURCE.indexOf("<FindReplaceBar");
    const sheetViewIdx = MODEL_APP_SOURCE.indexOf("<SheetView");
    expect(toolbarCardCloseIdx).toBeGreaterThan(-1);
    expect(findBarIdx).toBeGreaterThan(toolbarCardCloseIdx); // after the ribbon/formula-bar card
    expect(sheetViewIdx).toBeGreaterThan(findBarIdx); // before the grid it pushes down when open
  });

  it("AppHeader (the header row carrying the File menu + Formula Auditing buttons) renders before Find too", () => {
    const appHeaderIdx = MODEL_APP_SOURCE.indexOf("<AppHeader");
    const findBarIdx = MODEL_APP_SOURCE.indexOf("<FindReplaceBar");
    expect(appHeaderIdx).toBeGreaterThan(-1);
    expect(findBarIdx).toBeGreaterThan(appHeaderIdx);
  });

  it("there is only one <FindReplaceBar mount point — not a duplicate left behind by the move", () => {
    const count = MODEL_APP_SOURCE.split("<FindReplaceBar").length - 1;
    expect(count).toBe(1);
  });
});
