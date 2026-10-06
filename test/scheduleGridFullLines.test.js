/* NEW-1 (Schedule grid: one light full grid on every column) — the CI-RUNNABLE half.
 *
 * The behaviour is painted pixels, proven in a real browser by `ui-audit/verify-grid-full-lines.mjs`
 * (red on the pre-fix grid: the pinned ID/TASK cells painted an opaque fill over the row's own bottom
 * line, so those two columns showed no row lines while every other column did). That script cannot run
 * in this repo's CI, so this pins the structural fact it rests on: every grid cell draws its OWN right
 * and bottom line from the ONE `GRID_LINE` rule — never a per-column special case.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

describe("Schedule grid — one cell-line rule (NEW-1)", () => {
  it("defines the single line rule from the existing --bd token, solid and without alpha", () => {
    expect(seq).toMatch(/const GRID_LINE = "1px solid var\(--bd\)";/);
  });
  it("body cells draw both their right and bottom line from it (range cells share the range colour)", () => {
    expect(seq).toMatch(/borderRight: \(selected && hasRange\) \? GRID_LINE_RANGE : GRID_LINE,\s*borderBottom: \(selected && hasRange\) \? GRID_LINE_RANGE : GRID_LINE,/);
  });
  it("the filler rows and the review-proposal rows draw the same two lines", () => {
    expect(seq).toMatch(/flexShrink:0,borderRight:GRID_LINE,borderBottom:GRID_LINE,height:ROW_H,/);
    expect(seq).toMatch(/borderRight:GRID_LINE, borderBottom:GRID_LINE,/);
  });
  it("no grid cell hard-codes its own divider colour any more", () => {
    const grid = seq.slice(seq.indexOf("function GridView("), seq.indexOf("// ── HealthPicker"));
    expect(grid).not.toMatch(/borderBottom:\s*"1px solid var\(--bd\)"/);
  });
});
