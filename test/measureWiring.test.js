/* Source-level wiring guards for the measurement styling / label work (NEW-1 · NEW-2 · NEW-3).
 *
 * WHY a source scan and not only pure-unit tests: the pure layers below (measureStyle,
 * measureLabel, standardsApply) can be perfectly green while nothing on the canvas calls them —
 * which is exactly how a feature ships dead (the B1127 "a new kind with no render branch is a
 * silent spinner" trap). These assert the CALL SITES exist, so removing the wiring goes red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");
const EXPORT_SHEET = read("../src/workspaces/site-planner/lib/exportSheet.js");

describe("NEW-1: measurements are styled through the ONE resolver, on every mode", () => {
  it("the render calls measureStyle and no longer hardcodes the accent", () => {
    expect(SP).toMatch(/const st = measureStyle\(m, \{ accent: PAL\.accent, uncalibrated: calibrationState === "uncalibrated", selected: isSel \}\)/);
    // the old hardcoded line — the whole point of the item — must be gone
    expect(SP).not.toMatch(/const mcolor = warn \? "#b45309" : PAL\.accent/);
  });
  it("stroke, weight, dash, fill and fill opacity all come off the resolved style", () => {
    expect(SP).toMatch(/stroke=\{mcolor\} strokeWidth=\{st\.weight\} strokeDasharray=\{mdash\}/);
    expect(SP).toMatch(/fill=\{st\.fill\} fillOpacity=\{st\.fillOpacity\}/);
    expect(SP).toMatch(/const mdash = dashArray\(st\.dash, st\.weight\)/);
  });
  it("the COUNT mode markers follow the style too (not just area)", () => {
    expect(SP).toMatch(/fill=\{mcolor \+ "28"\} stroke=\{mcolor\} strokeWidth=\{st\.weight\}/);
  });
  it("all four creation paths stamp the Standards defaults", () => {
    // the two-click distance, plus polyline / area / count through finishMeasure
    expect(SP).toMatch(/mode: "line", pts: \[measDraft\[0\], sp\], \.\.\.measureDefaultStyle\(settings\)/);
    expect(SP).toMatch(/const std = measureDefaultStyle\(settings\);/);
    ["polyline", "area", "count"].forEach((mode) => {
      expect(SP).toMatch(new RegExp(`mode: "${mode}", pts: measDraft, \\.\\.\\.std`));
    });
  });
  it("the properties panel edits the full style through the SHARED colour control", () => {
    expect(SP).toMatch(/colorCtl\(\(v\) => liveMeasure\(\{ stroke: v \}\)\)/);
    expect(SP).toMatch(/colorCtl\(\(v\) => liveMeasure\(\{ fill: v \}\)\)/);
    expect(SP).toMatch(/setSelMeasure\(\{ weight: n \}\)/);
    expect(SP).toMatch(/setSelMeasure\(\{ dash: e\.target\.value \}\)/);
    expect(SP).toMatch(/liveMeasure\(\{ fillOpacity: \+e\.target\.value \}\)/);
    // reuses the ONE shared line-style list, not a parallel one
    expect(SP).toMatch(/value=\{m\.dash \|\| MEASURE_LINE\.dash\}[\s\S]{0,220}\{DASH_OPTIONS\}/);
  });
  it("Standards carries a MEASUREMENTS section that applies retroactively", () => {
    expect(SP).toMatch(/data-std-sec="measure"/);
    expect(SP).toMatch(/title="Measurements"/);
    expect(SP).toMatch(/applyAllStandards\(beforeParcels, beforeEls, stdParcelValues\(\), Object\.keys\(TYPE\), \{ measures: beforeMeasures, measureValues: stdMeasureValues\(\) \}\)/);
    expect(SP).toMatch(/setMeasures\(res\.measures\)/);
    // "Save for all projects" promotes the measurement defaults to the account scope too
    expect(SP).toMatch(/MEASURE_STD_KEYS\.forEach\(\(k\) => \{ up = setStandardPref\(up, "measureStyle", k, measureStdValueUI\(k\) \?\? null\); \}\)/);
  });
  it("double-click a measurement still opens its Properties (parity with every other object)", () => {
    expect(SP).toMatch(/if \(isDoubleTap\(e, m\.id, sel\?\.kind === "measure" && sel\.i === idx\)\) \{[\s\S]{0,200}setPropsFor\(\{ kind: "measure", i: idx \}\)/);
  });
  it("the owner rule holds: NO × delete badge on a selected measurement", () => {
    expect(SP).toMatch(/no × delete badge on a measurement \(owner rule\)/);
  });
});

describe("NEW-2: the label reveal zoom is per-measurement, captured by click", () => {
  it("the render gates on measureLabelVisible, not the bare global floor", () => {
    expect(SP).toMatch(/measureLabelVisible\(m, labelPpf, \{ settings, globalFloor: DIM_CALLOUT_MIN_PPF, selected: isSel \}\)/);
  });
  it("both controls CAPTURE the live zoom — no raw zoom number is ever typed", () => {
    expect(SP).toMatch(/onClick=\{\(\) => setSelMeasure\(\{ labelPpf: view\.ppf \}\)\}>Set at current zoom</);
    expect(SP).toMatch(/onClick=\{\(\) => draftMeasureStd\(\{ labelPpf: view\.ppf \}\)\}>Set at current zoom</);
    expect(SP).not.toMatch(/label="Show label from \(ppf\)"/);
  });
  it("both controls offer a Reset to default", () => {
    expect((SP.match(/>Reset to default</g) || []).length).toBe(2);
    expect(SP).toMatch(/setSelMeasure\(\{ labelPpf: null \}\)/);
    expect(SP).toMatch(/draftMeasureStd\(\{ labelPpf: null \}\)/);
  });
  it("the readout is the plain-English band helper", () => {
    expect(SP).toMatch(/labelRevealNote\(m, settings, DIM_CALLOUT_MIN_PPF\)/);
  });
});

describe("NEW-3: the summary chip, the segment dimensions, and print parity", () => {
  it("the run-on one-liner is gone", () => {
    expect(SP).not.toMatch(/′ perim`/);
    expect(SP).not.toMatch(/\$\{f0\(polyArea\(fpts\)\)\} sf · \$\{f2\(polyArea\(fpts\) \/ SQFT_PER_ACRE\)\} ac/);
  });
  it("the panel reads the same formatters as the canvas (one number convention)", () => {
    expect(SP).toMatch(/rows\.push\(\["Perimeter", fmtFeet\(pathLen\(\[\.\.\.fpts, fpts\[0\]\]\)\)\]\)/);
    expect(SP).toMatch(/rows\.push\(\["Length", fmtFeet\(pathLen\(fpts\)\)\]\)/);
  });
  it("the chip is a real plate + hairline carrying the parcel chip's print contract", () => {
    expect(SP).toMatch(/data-print-chip="measure"/);
    expect(SP).toMatch(/<rect data-chip-bg[\s\S]{0,220}stroke=\{mcolor\}/);
    expect(SP).toMatch(/<text key=\{k\} data-chip-text/);
    expect(SP).toMatch(/"data-chip-sub": "1"/);
  });
  it("the export restyles EVERY chip through one selector, so measure and acre can't drift", () => {
    expect(EXPORT_SHEET).toMatch(/root\.querySelectorAll\("\[data-print-chip\]"\)/);
    expect(EXPORT_SHEET).not.toMatch(/querySelectorAll\('\[data-print-chip="acre"\]'\)/);
    expect(EXPORT_SHEET).toMatch(/data-chip-sub/);
  });
  it("the chip is laid out by the SHARED collision engine, not painted at the centroid", () => {
    expect(SP).toMatch(/const measureChipPlace = layoutLabels\(/);
    // and its boxes become obstacles for the element-label pass
    expect(SP).toMatch(/obstacles: \[\.\.\.parcelChipBoxes, \.\.\.measureChipBoxes\]/);
  });
  it("the chip paints AFTER the transparent grab layer, or the drag is swallowed", () => {
    // Found live: an area's hit path is a transparent FILLED polygon over the whole shape, so a
    // chip drawn before it in document order was unreachable — every press moved the measurement
    // instead of the label. Both branches must keep the chip last.
    const block = SP.slice(SP.indexOf("{/* measurements — line (distance)"), SP.indexOf("{/* in-progress measure draft */}"));
    const countChip = block.indexOf("{chipNode}");        // the count branch renders first
    const areaChip = block.lastIndexOf("{chipNode}");     // the line / polyline / area branch
    expect(countChip).toBeGreaterThan(-1);
    expect(areaChip).toBeGreaterThan(countChip);
    expect(countChip).toBeGreaterThan(block.indexOf("hit targets — one transparent circle"));
    expect(areaChip).toBeGreaterThan(block.indexOf("wide invisible hit path"));
  });
  it("a colour chip shows its own colour (no hardcoded background override)", () => {
    // ColorField paints the current colour as the chip background; a `background:` in the caller's
    // style override blanks it, which is how these panels shipped with colourless colour controls.
    expect(SP).not.toMatch(/const swatch = \{[^}]*background: "var\(--surface-raised\)"/);
  });
  it("the chip is draggable with a leader back to its anchor (the parcel labelOffset mechanic)", () => {
    expect(SP).toMatch(/const startMeasChip = \(e, i\) => \{/);
    expect(SP).toMatch(/d\.mode === "measChip"/);
    expect(SP).toMatch(/chip\.moved && <line x1=\{chip\.anchor\.x\}/);
  });
  it("per-edge segment lengths are drawn, gated SEPARATELY from the summary chip", () => {
    expect(SP).toMatch(/const segs = fpts\.length > 2 \|\| isArea \? measureSegments\(fpts, isArea\) : \[\]/);
    expect(SP).toMatch(/if \(!detailLabelVisible\(s\.ft, labelPpf\)\) return null/);
  });
  it("chip figures are tabular so digits never jitter between frames", () => {
    expect(SP).toMatch(/fontFamily=\{NUM_FONT\} fontVariantNumeric=\{TABULAR_NUMS\} pointerEvents="none"/);
  });
});
