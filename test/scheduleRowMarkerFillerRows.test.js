import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 (Schedule grid) — the hovered / selected ROW MARKER (the two thin lines) must run the full width of EVERY kind of
// row, ID and Task included. The painted proof (pixels, on blank rows, "+ New task", task rows, scrolled, Split) is
// `ui-audit/verify-grid-filler-row-marker.mjs` (63 arms; 24 fail on the pre-fix page). This is the CI-runnable half and
// pins the structural facts that proof rests on:
//   the marker is a ::before INSIDE each cell, so (a) every child of a row that should carry it must be matched by the rule,
//   and (b) must be positioned (relative or sticky) so the ::before is boxed by its OWN cell. A child that is matched but
//   NOT positioned anchors the line to the whole row — painted over ordinary cells and UNDER the opaque sticky ID / Task
//   cells, which is exactly the owner's "starts at START, not on ID/Task" report.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const css = src.slice(src.indexOf(".drow { display: flex;"), src.indexOf("/* A full-cell hover-revealed overlay"));
const sel = (name) => css.includes(name);

describe("Schedule grid — ONE row-level marker covers every kind of row (NEW-1, B2584496)", () => {
  it("hover rule and selected rules are on the ROW's ::after, which therefore reaches task cells, blank / new / review cells and the filler strip alike", () => {
    expect(sel(".drow:hover::after")).toBe(true);
    expect(sel(".drow[data-row-sel]::after")).toBe(true);
    expect(sel('.drow[data-new-task-row="sel"]::after')).toBe(true);
  });
  it("no per-cell marker rule remains (a ::before in each cell is what let a frozen cell paint the line differently from a plain one)", () => {
    expect(css).not.toMatch(/> \[data-col-key\]::before/);
    expect(css).not.toMatch(/> \[data-row-line\]::before/);
    expect(css).not.toMatch(/> \[data-grid-strip\]::before/);
  });
});

describe("Schedule grid — the filler strip and blank-row cells stay positioned (kept from B2623536; harmless now that the line is row-level)", () => {
  // every `<div data-grid-strip …/>` in the row renderers
  const strips = [...src.matchAll(/<div data-grid-strip\b[\s\S]{0,900}?(?:\/>|>\s*<\/div>)/g)].map(m => m[0]);
  it("finds the three row strips (task row, review row, blank row)", () => { expect(strips.length).toBeGreaterThanOrEqual(3); });
  it('every filler strip is position:"relative"', () => {
    for (const st of strips) expect(st, st.slice(0, 120)).toMatch(/position:\s*"relative"/);
  });
  it("the blank / + New task row cells and the review-proposal cells carry data-row-line and are positioned", () => {
    const blank = src.slice(src.indexOf("data-new-task-row={ri===tasks.length"), src.indexOf("{ri===tasks.length && c.k===\"name\" ? \"+ New task\""));
    expect(blank).toMatch(/<div key=\{c\.k\} data-row-line className=\{pinCls\(c\.k\) \|\| undefined\} style=\{\{[^}]*position:"relative"/);
    expect(src).toMatch(/return <div key=\{c\.k\} data-row-line className=\{pinCls\(c\.k\) \|\| undefined\} style=\{wrap\}>/);
    expect(src).toMatch(/const wrap = \{width:w, flexShrink:0, height:ROW_H, position:"relative"/);
  });
  it("a frozen cell is still sticky (the position:relative above is overridden by pinStyle, which comes later in the object)", () => {
    const blank = src.slice(src.indexOf("data-new-task-row={ri===tasks.length"), src.indexOf("{ri===tasks.length && c.k===\"name\" ? \"+ New task\""));
    expect(blank.indexOf('position:"relative"')).toBeGreaterThan(-1);
    expect(blank.indexOf('position:"relative"')).toBeLessThan(blank.indexOf("pinStyle(c.k"));
  });
});
