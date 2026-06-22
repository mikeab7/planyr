import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { approxTextPx, layoutExhibitCols, EXHIBIT_MIN_GANTT } from "../ui-audit/stress/exhibit-cols.mjs";

// Guards the PDF/Print Exhibit column sizing: content-fit defaults (B390) so the
// Start/End/Duration columns stop truncating and the giant Task-Name gap is gone, plus
// the per-column drag overrides (B392). The pure helpers live in public/sequence/index.html
// (Babel-compiled, not importable); ui-audit/stress/exhibit-cols.mjs is a faithful copy and
// the final describe asserts the real source hasn't drifted from it.

// Mirror buildPDFHtml's per-column fit profile for the date/duration columns under test.
const SPEC = (k, base, o = {}) => ({ k, base, min: o.min ?? 30, max: o.max ?? 300, flex: o.flex ?? false });
// What buildPDFHtml budgets a fixed-format value at: text + 12px padding + 3px slack.
const fitFor = (text, fs = 9) => approxTextPx(text, fs) + 12 + 3;

describe("approxTextPx — generous, monotonic text width", () => {
  it("is zero for empty / nullish and never negative", () => {
    expect(approxTextPx("", 9)).toBe(0);
    expect(approxTextPx(null, 9)).toBe(0);
    expect(approxTextPx(undefined, 9)).toBe(0);
  });
  it("grows with length and with font size", () => {
    expect(approxTextPx("0000", 9)).toBeGreaterThan(approxTextPx("00", 9));
    expect(approxTextPx("Status", 12)).toBeGreaterThan(approxTextPx("Status", 9));
  });
  it("a full date string measures wider than the old fixed 42px date column could show", () => {
    // The bug: Start/End were a fixed 42px and clipped "12/27/26" to "06/2…". The content
    // fit must budget MORE than the cell content needs so nothing truncates.
    const need = approxTextPx("12/27/26", 9) + 12; // text + td padding
    expect(need).toBeGreaterThan(42); // proves 42px was too narrow (the reported clip)
    expect(fitFor("12/27/26")).toBeGreaterThanOrEqual(need); // our fit budgets enough
  });
});

describe("layoutExhibitCols — content-fit + clamps + overrides", () => {
  const specs = () => [
    SPEC("name", 230, { min: 96, max: 280, flex: true }),
    SPEC("start", fitFor("12/27/26"), { min: 50, max: 96 }),
    SPEC("end", fitFor("12/27/26"), { min: 50, max: 96 }),
    SPEC("duration", fitFor("100d"), { min: 34, max: 74 }),
  ];

  it("each column is at least wide enough for its content; the Gantt keeps its floor", () => {
    const { widths, tableW, ganttW } = layoutExhibitCols(specs(), { budget: 900, override: {} });
    // Dates fit their full value (the core B390 fix).
    expect(widths.start).toBeGreaterThanOrEqual(approxTextPx("12/27/26", 9) + 12);
    expect(widths.duration).toBeGreaterThanOrEqual(approxTextPx("100d", 9) + 12);
    expect(tableW).toBe(widths.name + widths.start + widths.end + widths.duration);
    // The table only takes what its columns need — no dead gap absorbed into Task Name.
    expect(tableW).toBeLessThan(900 - EXHIBIT_MIN_GANTT + 1);
    expect(ganttW).toBe(900 - tableW);
    expect(ganttW).toBeGreaterThanOrEqual(EXHIBIT_MIN_GANTT);
  });

  it("a user drag override wins and is clamped to the column's [min,max]", () => {
    const wide = layoutExhibitCols(specs(), { budget: 900, override: { name: 270 } });
    expect(wide.widths.name).toBe(270);
    const tooWide = layoutExhibitCols(specs(), { budget: 900, override: { name: 9999 } });
    expect(tooWide.widths.name).toBe(280); // clamped to max
    const tooNarrow = layoutExhibitCols(specs(), { budget: 900, override: { name: 1 } });
    expect(tooNarrow.widths.name).toBe(96); // clamped to min
  });

  it("widening a column past the budget shrinks flexible columns, never the dates", () => {
    // Tight budget: the over-wide name must give width back to keep the Gantt floor — but
    // the squeeze is absorbed by the flexible name column, leaving the fixed date columns
    // at their content-fit width (a date must never be the thing that clips).
    const { widths, ganttW } = layoutExhibitCols(specs(), { budget: 600, override: { name: 280 } });
    expect(ganttW).toBeGreaterThanOrEqual(EXHIBIT_MIN_GANTT); // Gantt protected
    expect(widths.name).toBeLessThan(280); // the flexible column absorbed the squeeze
    expect(widths.start).toBeGreaterThanOrEqual(approxTextPx("12/27/26", 9) + 12); // date NOT clipped
  });
});

describe("anti-drift: the exhibit-cols helpers still match public/sequence/index.html", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  it("EXHIBIT_MIN_GANTT + approxTextPx + layoutExhibitCols are present in the real source", () => {
    expect(src).toMatch(/const EXHIBIT_MIN_GANTT = 240;/);
    expect(src).toMatch(/function approxTextPx\(str, fs\)\{/);
    expect(src).toMatch(/function layoutExhibitCols\(specs, opts\)\{/);
    expect(src).toMatch(/return \{ widths, tableW, ganttW: Math\.max\(EXHIBIT_MIN_GANTT, opts\.budget-tableW\) \};/);
  });
  it("buildPDFHtml content-fits the split columns and emits drag handles in preview", () => {
    expect(src).toMatch(/const fit=layoutExhibitCols\(specs,\{override:cfg\.colWidths\|\|\{\}, budget:contentPx-2\}\)/);
    expect(src).toMatch(/data-rs="\$\{c\.k\}"/);
    expect(src).toMatch(/type:'planarColResize'/);
  });
  it("buildGanttSVG layers vertical rules BEHIND the bars (B397 paint order)", () => {
    // bands → grid → left edge → today → dependency (curved B396/B402) → bars → header labels → bar labels → de-collided names (B402)
    expect(src).toMatch(/\$\{rowBands\.join\(""\)\}\$\{gridRules\}\$\{leftEdge\}\$\{todayLine\}\$\{arrows\}\$\{barLayer\.join\(""\)\}\$\{yearLabels\}\$\{monthLabels\}\$\{headerLines\}\$\{taskHeaderText\}\$\{labelLayer\.join\(""\)\}\$\{nameLayer\}/);
    expect(src).toMatch(/const rowBands=\[\], barLayer=\[\], labelLayer=\[\], nameRecords=\[\];/);
  });
  it("buildGanttSVG draws ONE continuous full-height left chart-edge boundary, not per-row (B398)", () => {
    expect(src).toMatch(/const leftEdge=`<line x1="\$\{LABEL_W\}" y1="0" x2="\$\{LABEL_W\}" y2="\$\{svgH\}"/);
  });
  it("buildGanttSVG uses a two-tier light header + weighted year>quarter>month grid rules (B399)", () => {
    expect(src).toMatch(/const YEAR_TIER=14, MON_TIER=16, HEADER_H=YEAR_TIER\+MON_TIER/);
    expect(src).toMatch(/const yearLabels=yearSpans\.map/);
    expect(src).toMatch(/const monthLabels=visibleMonths\.map/);
    expect(src).toMatch(/if\(m\.mo===0\)   return `<line[^`]*stroke="#8b95a3" stroke-width="1\.3"/);   // YEAR thickest
    expect(src).toMatch(/if\(m\.mo%3===0\) return `<line[^`]*stroke="#c2c9d2" stroke-width="0\.8"/);   // QUARTER medium, no label
    expect(src).toMatch(/stroke="#e7ebf0" stroke-width="0\.4"/);                                       // MONTH thinnest
    expect(src).toMatch(/var GANTT_HEAD=30, GANTT_ROW=18;/);                                           // paginator header height in lock-step
  });
  it("buildGanttSVG adds a viewBox so the whole timeline fits the page width (B400)", () => {
    expect(src).toMatch(/viewBox="0 0 \$\{svgWidth\} \$\{svgH\}"/);
  });
});
