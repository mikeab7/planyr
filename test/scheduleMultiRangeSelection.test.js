/* B2530690 — the Schedule grid's Ctrl+click multi-select + drag edge-scroll, pinned at the source level (the real
 * behaviour is ui-audit/verify-schedule-multirange.mjs: real Control-held clicks in a real grid, local and signed in
 * on planyr.io). RED-PROOF: on origin/main the grid had no beginCellDrag, treated Ctrl+click as a plain click and
 * extended ranges only from per-cell onMouseEnter, so every assertion here fails there. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
const grid = html.slice(html.indexOf("function GridView("), html.indexOf("function GridView(") + 400000);

describe("Schedule grid — Ctrl+click / edge-scroll wiring", () => {
  it("ONE drag session owns every range-extending press, with the shared edge-scroll speed", () => {
    expect(grid).toMatch(/const beginCellDrag = \(startEvent, \{ rowMode, apply, onEnd \}\) =>/);
    expect(grid).toMatch(/axisVelocity\(pointer\.y - rect\.top, TL_H \* zoom, rect\.height\)/);
    expect(grid).toMatch(/requestAnimationFrame\(tick\)/);
  });
  it("a press near the edge is a click until the pointer has really travelled (no immediate scroll)", () => {
    expect(grid).toMatch(/if \(!moved\) return;/);
    expect(grid).toMatch(/< 3\) return;/);
  });
  it("the per-cell mouseenter extension is gone — cells and the strip carry no onMouseEnter extension", () => {
    expect(grid).not.toMatch(/cellMouseEnter/);
  });
  it("Ctrl/Cmd+press adds a range; on a selected cell it is a toggle decided on release", () => {
    expect(grid).toMatch(/const additive = \(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey;/);
    expect(grid).toMatch(/addRange\(prev, \{r1:ri, r2:ri, c1:ci, c2:ci\}\)/);
    expect(grid).toMatch(/toggleCellOut\(prev, ri, ci\)/);
    expect(grid).toMatch(/const base = additive \? rangesOf\(currentSelection\(\)\) : undefined;/);   // the ID column: a whole row
  });
  it("Shift only extends the newest range", () => {
    expect(grid).toMatch(/withActive\(cur, \{r1: anchorRi, r2: ri, c1: anchorCi, c2: ci\}\)/);
  });
  it("what can't take several blocks refuses out loud (indent / outdent / move / insert / row drag)", () => {
    expect(html).toMatch(/const blockOnlyTargets = \(anchorId\) => \{\s*if \(isMulti\(selRange\)\) \{ showToast\(MULTI_SELECTION_MESSAGE, \{ type: "warn" \}\);/);
    expect(html).toMatch(/if \(isMulti\(selRange\)\) \{ showToast\(MULTI_SELECTION_MESSAGE, \{ type: "warn" \}\); return; \}   \/\/ B2530690/);
    expect(grid).toMatch(/if \(isMulti\(selRange\)\) \{ showToast\(MULTI_SELECTION_MESSAGE, \{ type: "warn" \}\); cancel\(\); return; \}/);
  });
  it("Delete, bulk fill and formatting walk every range (selRowsOf / cellsOf / rangesOf), not just the newest", () => {
    expect(html).toMatch(/rangesOf\(selRange\)\.every\(g => g\.c1 === 0 && g\.c2 === lastColIdx\)/);
    expect(html).toMatch(/cellsOf\(selRange\)\.forEach\(\(\{r, c\}\) =>/);
    expect(html).toMatch(/for \(const \{r, c\} of cellsOf\(selRange\)\)/);
    expect(grid).toMatch(/for \(const r of selRowsOf\(selRange, tasks\.length - 1\)\)/);
  });
  it("the stale 'a discontiguous selection cannot occur' claim is gone", () => {
    expect(html).not.toMatch(/there is no ctrl-click or other\s*\/\/\s*discontiguous multi-select anywhere/);
  });
});
