/* NEW-1 (selected / hovered row outline) — the CI-RUNNABLE half of `ui-audit/verify-grid-row-outline.mjs`.
 *
 * The behaviour is painted pixels (red on the pre-fix grid: the pinned ID / TASK cells paint an opaque
 * background over a row-level inset shadow, so the hover/selected line started at START). That script
 * cannot run in CI, so this pins the structure it rests on: the line is a ::before on every CELL, and the
 * selected row's blue accent lives on the first cell, never only on the row container (which scrolls away).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

describe("Schedule grid — row outline runs through the pinned columns (NEW-1)", () => {
  it("draws the hover/selected top+bottom line on each cell, not as a row-level box-shadow", () => {
    expect(seq).toMatch(/\.drow:hover > \[data-col-key\]::before, \.drow\[data-row-sel\] > \[data-col-key\]::before/);
    expect(seq).not.toMatch(/\.drow:hover \{ box-shadow/);
  });
  it("marks the selected row so the same line shows without hover", () => {
    expect(seq).toMatch(/data-row-sel=\{\(isFocused && !hasRange\) \? "1" : undefined\}/);
  });
  it("puts the selected row's blue accent on the FIRST cell, not on the row border", () => {
    expect(seq).toMatch(/c === orderedCols\[0\]\) \? "inset 2px 0 0 0 var\(--blue\)"/);
    expect(seq).not.toMatch(/borderLeft: isFocused \? "2px solid var\(--blue\)"/);
  });
});
