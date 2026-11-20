import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// B2584496 — the Schedule grid's selected / hovered ROW MARKER is ONE element per row, so a frozen (sticky, opaque) cell and a plain cell
// cannot draw it differently.
//
// The painted proof is ui-audit/verify-grid-row-marker-uniform.mjs (real Chromium at device pixel ratios 0.8 … 3, the single-pixel
// CIEDE2000 <= 1.0 bar; RED on the unfixed page: 24 of 25 states fail at every fractional ratio, 25/25 pass at 1 and 2). That needs a
// browser, so this is the CI-runnable half: it pins the structure the proof rests on.
//   MEASURED cause (build 879a557): the marker pixel itself was already identical on every cell; the grid-line pixels BESIDE it are each
//   cell's own border and a frozen cell rasterises them differently from a plain one wherever the device pixel ratio is fractional
//   (browser zoom 125 / 150 / 175 %): ID / Task read thinner and greyer, Start onward heavier and bluer. So the line AND those two pixels
//   are now painted by one element that sits above the frozen cells.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const css = src.slice(src.indexOf(".drow { display: flex;"), src.indexOf("/* A full-cell hover-revealed overlay"));
const harness = readFileSync(fileURLToPath(new URL("../ui-audit/verify-grid-row-marker-uniform.mjs", import.meta.url)), "utf8");

// the rule block that carries the marker (hover | selected | selected "+ New task"), as written in the stylesheet
const MARKER_SEL = /\[data-grid-scroll\]:not\(\[data-kbnav\]\) \.drow:hover::after,\s*\.drow\[data-row-sel\]::after,\s*\.drow\[data-new-task-row="sel"\]::after\s*\{([^}]*)\}/;

describe("Schedule grid — the row marker is one element on the ROW (B2584496)", () => {
  const block = css.match(MARKER_SEL)?.[1] ?? "";
  it("is a single ::after on .drow for hover, the selected task row and the focused + New task row", () => {
    expect(block).not.toBe("");
  });
  it("keeps today's marker: 1px #94a3b8 top and bottom, no pointer events", () => {
    expect(block).toMatch(/border-top:1px solid #94a3b8/);
    expect(block).toMatch(/border-bottom:1px solid #94a3b8/);
    expect(block).toMatch(/pointer-events:none/);
    expect(block).toMatch(/top:0; bottom:0/);   // the marker stays where it was (inside the row), so the older painted harnesses read the same pixels
  });
  it("paints above the frozen cells and below the sticky header and the editors", () => {
    const z = Number(block.match(/z-index:(\d+)/)?.[1]);
    expect(src).toMatch(/pinStyle\(c\.k, \[rowBg, cellOverlay\], 5\)/);   // the frozen cells are sticky at z 5
    expect(z).toBeGreaterThan(5);                       // over the frozen ID / Task / Health cells (sticky, z 5)
    expect(z).toBeLessThan(10);                          // under the sticky header (z 10)
    expect(src).toMatch(/data-grid-header="1" style=\{\{position:"sticky",top:0,zIndex:10/);
  });
  it("re-draws the cells' grid line (var(--bd), the same colour) one pixel each side, so those pixels come from this one element", () => {
    expect(block).toMatch(/box-shadow:0 -1px 0 0 var\(--bd\), 0 1px 0 0 var\(--bd\)/);
  });
  it("widens that band at FRACTIONAL ratios only (whole ratios 1, 2, 3 are untouched)", () => {
    expect(css).toMatch(/@media \(max-resolution: 0\.95dppx\), \(min-resolution: 1\.05dppx\) and \(max-resolution: 1\.95dppx\), \(min-resolution: 2\.05dppx\) and \(max-resolution: 2\.95dppx\)/);
    expect(css).toMatch(/box-shadow:0 -2px 0 0 var\(--bd\), 0 2px 0 0 var\(--bd\)/);
    expect(css).toMatch(/@media \(min-resolution: 1\.45dppx\) and \(max-resolution: 1\.55dppx\), \(min-resolution: 2\.45dppx\) and \(max-resolution: 2\.55dppx\)/);
    expect(css).toMatch(/box-shadow:0 -2\.5px 0 0 var\(--bd\), 0 2\.5px 0 0 var\(--bd\)/);
  });
  it("a row inside a multi-row range draws only the marker (its neighbouring edge is the range's own blue line)", () => {
    expect(css).toMatch(/\.drow:has\(> \[data-cell-in-range\]\):is\(:hover, \[data-row-sel\]\)::after \{ box-shadow:none; \}/);
    expect(src).toMatch(/data-cell-in-range=\{\(selected && hasRange\) \? "1" : undefined\}/);
  });
  it("there is no per-cell marker any more (a ::before inside each cell is what a frozen cell drew differently)", () => {
    expect(css).not.toMatch(/\[data-col-key\]::before/);
    expect(css).not.toMatch(/\[data-row-line\]::before/);
    expect(css).not.toMatch(/\[data-grid-strip\]::before/);
  });
  it("the marker line is not offset onto the grid lines (that hid the first row's top line under the header and turned range edges grey)", () => {
    expect(block).not.toMatch(/top:-1px/);
    expect(src).not.toMatch(/--mk-top/);
  });
});

describe("Schedule grid — the painted acceptance harness measures what it claims (B2584496)", () => {
  it("sets a REAL device scale factor on the browser context (a CDP override on a page Playwright already sized is ignored by its screenshot: every difference read 0.00)", () => {
    expect(harness).toMatch(/deviceScaleFactor: dpr/);
    expect(harness).toMatch(/not the \$\{curDpr\} this run claims/);   // and it VOIDs if the screenshot scale is not the ratio asked for
  });
  it("judges single pixels against the CIE just-noticeable difference, fixed before any fix was measured", () => {
    expect(harness).toMatch(/const PIXEL_MAX_DE = 1\.0;/);
  });
  it("covers the owner's case (a Needs Attn. row selected by clicking its Dur cell) and the fractional ratios", () => {
    expect(harness).toMatch(/\["Needs Attn\.", 3\]/);
    expect(harness).toMatch(/clickDur/);
    expect(harness).toMatch(/"0\.8,1,1\.25,1\.5,1\.75,2,2\.5"/);
  });
  it("has known-good and negative arms (VOID, not a score, if the instrument cannot tell a marked edge from an idle one)", () => {
    expect(harness).toMatch(/known-good arm: a hovered row's edge strip is not darker than an idle row's/);
    expect(harness).toMatch(/negative arm: two idle rows' edge strips differ/);
    expect(harness).toMatch(/known-good arm: the Needs Attn\. \/ Complete rows do not carry their status tint/);
  });
  it("never uses the clicked (Dur) column as the reference: it carries the row above's active-cell box", () => {
    expect(harness).toMatch(/x\.c\.k !== "duration"/);
  });
});
