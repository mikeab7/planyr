/* NEW-1 / NEW-2 / NEW-3 (Schedule grid: right-edge strip, the "14 × 18" pill, the stuck hover row) — the
 * CI-RUNNABLE half of `ui-audit/verify-grid-strip.mjs` (real browser, pixels; it cannot run in CI).
 *
 * The behaviour is painted pixels and key/pointer sequencing, so this pins the structure it rests on:
 *   NEW-1  every row type carries a flex-filling `[data-grid-strip]` after its last cell, drawn with the ONE
 *          GRID_LINE rule; the data-row strip takes the range fill + outline and its press/enter/right-click are the
 *          SAME three functions the cells use (never a second implementation);
 *   NEW-2  no `{rows} × {columns}` readout renders anywhere in the grid;
 *   NEW-3  the row-HOVER outline is gated on the grid NOT carrying `data-kbnav`, which a navigation key sets and only a
 *          pointermove at DIFFERENT coordinates clears.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");
const grid = seq.slice(seq.indexOf("function GridView("), seq.indexOf("// ── HealthPicker"));

describe("Schedule grid — the right-edge strip reads as the row continuing (NEW-1)", () => {
  it("every row type (data, review-proposal, empty/new-task) ends with a flex-filling strip carrying the cell line", () => {
    const strips = grid.match(/<div data-grid-strip/g) || [];
    expect(strips.length).toBe(3);
    expect(grid).toMatch(/data-grid-strip style=\{\{flex:"1 1 0", minWidth:0, height:ROW_H, borderBottom:GRID_LINE\}\}/);
  });
  it("the data-row strip takes the range fill, the range line colour and the outline from the same rules as the cells", () => {
    expect(grid).toMatch(/background: \(stripJoinsRange && inRange\(ri, stripCi\)\) \? "#dbeafe" : "transparent"/);
    expect(grid).toMatch(/borderBottom: \(stripJoinsRange && inRange\(ri, stripCi\)\) \? GRID_LINE_RANGE : GRID_LINE/);
    expect(grid).toMatch(/boxShadow: stripShadow\(ri\)/);
  });
  it("the outline's right edge moves from the last cell to the strip's far end when the range reaches the last column", () => {
    expect(grid).toMatch(/if\(ci===maxC && !\(stripJoinsRange && ci===stripCi\)\) s\.push\("inset -2px 0 0 0 #2563eb"\)/);
    expect(grid).toMatch(/sh\.push\("inset -2px 0 0 0 #2563eb"\)/);
  });
  it("a press / drag-enter / right-click in the strip run the SAME functions as the last cell — one implementation", () => {
    expect(grid).toMatch(/onMouseDown=\{e => cellMouseDown\(e, task, ri, c, ci\)\}/);
    expect(grid).toMatch(/onMouseDown=\{e => cellMouseDown\(e, task, ri, stripCol, stripCi\)\}/);
    expect(grid).toMatch(/onMouseEnter=\{\(\) => cellMouseEnter\(task, ri, stripCol, stripCi\)\}/);
    expect(grid).toMatch(/onContextMenu=\{e => cellContextMenu\(e, task, ri, stripCol, stripCi\)\}/);
    // …and the cells hold no second inline copy of the press logic
    expect(grid.match(/e\.shiftKey && selectedId !== null/g)?.length).toBe(1);
  });
  it("the strip takes the same hover / selected-row outline as the cells", () => {
    expect(seq).toMatch(/\.drow\[data-row-sel\] > \[data-grid-strip\]::before/);
    expect(seq).toMatch(/\.drow:hover > \[data-grid-strip\]::before/);
  });
});

describe("Schedule grid — no size readout (NEW-2)", () => {
  it("the `rows × columns` pill is gone, and so is what only fed it", () => {
    expect(grid).not.toMatch(/\{rangeRowCount\} × \{rangeColCount\}/);
    expect(grid).not.toMatch(/rangeRowCount|rangeColCount/);
    expect(grid).not.toMatch(/\{hasRange && \(\s*<div style=\{\{position:"absolute",right:12/);
  });
  it("`hasRange` (the paint test the range fill keys off) survives", () => {
    expect(grid).toMatch(/const hasRange = !!selRange &&/);
  });
});

describe("Schedule grid — keyboard navigation hands the highlight to the keyboard (NEW-3)", () => {
  it("the row-hover outline and grip only paint while the grid is not in keyboard-nav mode", () => {
    expect(seq).toMatch(/\[data-grid-scroll\]:not\(\[data-kbnav\]\) \.drow:hover > \[data-col-key\]::before/);
    expect(seq).toMatch(/\[data-grid-scroll\]:not\(\[data-kbnav\]\) \.drow:hover \.rowgrip \{ opacity: 1; \}/);
    // the bare, ungated hover rule must not come back
    expect(seq).not.toMatch(/(^|\n)\.drow:hover > \[data-col-key\]::before/);
    expect(seq).not.toMatch(/(^|\n)\.drow:hover \.rowgrip/);
  });
  it("a nav key sets data-kbnav; only a pointermove at DIFFERENT coordinates clears it (a synthesized same-spot move does not)", () => {
    expect(grid).toMatch(/new Set\(\["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab","PageUp","PageDown","Home","End","Enter"\]\)/);
    expect(grid).toMatch(/el\.setAttribute\("data-kbnav", "1"\)/);
    expect(grid).toMatch(/if \(e\.clientX !== at\.x \|\| e\.clientY !== at\.y\) el\.removeAttribute\("data-kbnav"\)/);
    expect(grid).toMatch(/addEventListener\("pointermove", onMove, true\)/);
  });
});
