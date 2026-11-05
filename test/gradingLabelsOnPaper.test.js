// NEW-3 (2026-10-30, owner on Georgia Test Site › Concept A, paper background on): "the mouse will tell you what elevations you're
// working with, they're showing behind the white, so you can barely see it."
//
// MEASURED CAUSE (code, not the owner's description — the labels were never white): the contour layer's permanent labels ride the
// label band (`pane: labelPane`, above the planner's SVG) in dark topo brown with a white halo, and are fine on paper — the "750"
// index label. The transient HOVER readout was created with NO pane, so Leaflet put it in the basemap's own marker pane, UNDER the
// planner SVG and so under the grading paper (painted in that SVG at 92%): it showed through the white faintly. "726" is not a
// multiple of five, so it cannot be a permanent (index) label — it is this readout. Fix: the hover label rides the same band.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hoverMarkerPaneOptions } from "../src/workspaces/site-planner/lib/contours.js";
import { GRADING_PAPER_RGB, CONTOUR_PROPOSED_INDEX_RGB, CONTOUR_PROPOSED_RGB } from "../src/workspaces/site-planner/lib/gradingPaint.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const lum = (hex) => { const n = parseInt(hex.replace("#", "").slice(0, 6), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbToHex = (rgb) => (rgb.startsWith("#") ? rgb : "#" + (rgb.match(/\d+/g) || []).slice(0, 3).map((v) => (+v).toString(16).padStart(2, "0")).join(""));

describe("the hover elevation readout rides the label band, above the paper", () => {
  it("hoverMarkerPaneOptions: the layer's label pane when it has one, nothing otherwise (the Map finder's plain map)", () => {
    expect(hoverMarkerPaneOptions("pf-pane-line-label")).toEqual({ pane: "pf-pane-line-label" });
    expect(hoverMarkerPaneOptions(null)).toEqual({});
    expect(hoverMarkerPaneOptions(undefined)).toEqual({});
  });
  const src = read("../src/workspaces/site-planner/lib/terrainLayers.js");
  it("terrainLayers: the ONE hover marker takes its pane from the layer's labelPane (red on the pre-fix source, which had no pane)", () => {
    const m = /L\.marker\(here, \{([\s\S]*?)\}\)\.addTo\(hoverGroup\)/.exec(src);
    expect(m, "the hover marker call").not.toBeNull();
    expect(m[1]).toMatch(/\.\.\.hoverMarkerPaneOptions\(labelPane\)/);
  });
  it("the permanent labels still carry the same pane (the two stay in one band)", () => {
    expect(src).toMatch(/\.\.\.\(labelPane \? \{ pane: labelPane \} : null\)/);
  });
  it("and the label band is hosted ABOVE the plan SVG (mapStack) — the thing the paper sits inside", () => {
    const stack = read("../src/workspaces/site-planner/lib/mapStack.js");
    expect(stack).toMatch(/PANE_LINE_LABEL/);
  });
});

describe("every label family over the paper is DARK ink — nothing white on white", () => {
  const paper = rgbToHex(GRADING_PAPER_RGB);
  it("positive control: white ink on the paper would fail (the check can see the bug), dark brown passes", () => {
    expect(contrast("#ffffff", paper)).toBeLessThan(1.3);
    expect(contrast("#5B2E0D", paper)).toBeGreaterThan(7);
  });
  it("existing-contour labels + the hover readout: dark topo brown text (white is only the halo)", () => {
    const src = read("../src/workspaces/site-planner/lib/terrainLayers.js");
    const css = /const CONTOUR_INDEX_COL = "(#[0-9A-Fa-f]{6})"/.exec(src);
    expect(css).not.toBeNull();
    expect(contrast(css[1], paper)).toBeGreaterThan(7);
    expect(src).toMatch(/color:\$\{CONTOUR_INDEX_COL\};/);
    expect(src).toMatch(/text-shadow:0 0 2px #fff/);          // the halo, not the ink
    expect(src).not.toMatch(/;color:#fff/);
  });
  it("proposed-contour labels: dark brown fill with a paper-coloured halo", () => {
    expect(contrast(rgbToHex(CONTOUR_PROPOSED_INDEX_RGB), paper)).toBeGreaterThan(7);
    expect(contrast(rgbToHex(CONTOUR_PROPOSED_RGB), paper)).toBeGreaterThan(3);
    const g = read("../src/workspaces/site-planner/components/GradingPanels.jsx");
    expect(g).toMatch(/data-contour-label=\{lb\.level\}[\s\S]*?fill=\{CONTOUR_PROPOSED_INDEX_RGB\} stroke=\{GRADING_PAPER_RGB\}/);
  });
  it("cut / fill spot tags: PAL.ink text on a solid panel pill (never white text)", () => {
    const g = read("../src/workspaces/site-planner/components/GradingPanels.jsx");
    const pill = /function Pill2[\s\S]*?\n\}\n/.exec(g)[0];
    expect(pill).toMatch(/fill=\{fill \|\| PAL\.panelBg\}/);
    expect(pill).toMatch(/fontWeight=\{700\} fill=\{PAL\.ink\}/);
  });
});
