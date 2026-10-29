/* B2391216 follow-up — three polish items on the two-pane Imagery & Layers panel, pinned at the source and the pure model.
 * (The rendered, width × theme proof is ui-audit/verify-imagery-layers-panel.mjs; this is the part CI runs.)
 *  1. NO row reserves a swatch slot (B2436064 ×2): the name starts one SPACE.sm gap after the checkbox on every row, so names align by
 *     construction; the colour chip follows the name, only on an ON row with a map colour; the owner-only grading rows are Title-Cased
 *  2. no "Show the N sources that don't cover this site" line in Flood & Drainage (floodRowRelevance scoping is untouched)
 *  3. a row's ▾ holds the SAME parts off or on (NEW-2): Opacity · settings · Draw above plan · key · ⓘ; only status + "Too far out" are on-only */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dropdownPlan } from "../src/workspaces/site-planner/lib/layerPanelModel.js";

const panel = readFileSync(new URL("../src/workspaces/site-planner/components/LayerPanel.jsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/workspaces/site-planner/components/GradingController.jsx", import.meta.url), "utf8");
const floodGroup = readFileSync(new URL("../src/workspaces/site-planner/lib/floodGroup.js", import.meta.url), "utf8");

describe("1 · name alignment and Title Case", () => {
  it("the colour chip renders nothing unless the row is on AND has a map colour — no empty placeholder", () => {
    const sw = panel.slice(panel.indexOf("function Swatch("), panel.indexOf("function Caret("));
    expect(sw).toMatch(/if \(!show \|\| !color\) return null/);
    expect(sw).not.toMatch(/data-swatch="none"/);
    expect(panel).not.toMatch(/SWATCH_SLOT/);
  });
  it("every checkbox label is checkbox → name with the one SPACE.sm gap; the chip comes AFTER the name", () => {
    expect(panel).toMatch(/const CHECK_GAP = SPACE\.sm;/);
    const row = panel.slice(panel.indexOf("function LayerRow("), panel.indexOf("function SimpleCheckRow("));
    expect(row.indexOf('type="checkbox"')).toBeLessThan(row.indexOf("<span title={spec.label}"));
    expect(row.indexOf("<span title={spec.label}")).toBeLessThan(row.indexOf("<Swatch"));
    const simple = panel.slice(panel.indexOf("function SimpleCheckRow("), panel.indexOf("function SectionHeading("));
    expect(simple).not.toMatch(/Swatch/);
    expect(simple).toMatch(/gap: CHECK_GAP/);
  });
  it("the owner-only grading rows are Title-Cased", () => {
    for (const label of ["Level-Pad Limit at ${cfg.slopeRatio}:1", "Cut & Fill", "Proposed Contours", "Paper Background"]) expect(controller).toContain(`label: ${label.includes("${") ? "`" : '"'}${label}${label.includes("${") ? "`" : '"'}`);
    expect(controller).not.toMatch(/label: [`"](Level-pad limit|Proposed contours|Paper background)/);
  });
});

describe("2 · no reveal line for sources that cannot serve the site", () => {
  it("LayerPanel renders no 'sources that don't cover this site' control", () => {
    expect(panel).not.toMatch(/cover this site/);
    expect(panel).not.toMatch(/floodOff/);
  });
  it("the scoping itself is untouched — floodRowRelevance still decides which rows are on or off", () => {
    expect(floodGroup).toMatch(/export function floodRowRelevance/);
    expect(panel).toMatch(/floodScope\.tiers\b/); // the tiers are still what the Flood & Drainage pane lists
  });
});

describe("3 · a row's ▾ holds the same parts off or on", () => {
  const ctx = { hasInfo: true, settings: ["interval"], canLift: true, hasLegend: true };
  it("off: Opacity · settings · Draw above plan · key · ⓘ", () => {
    expect(dropdownPlan({ ...ctx, on: false })).toEqual(["opacity", "interval", "above", "legend", "info"]);
  });
  it("on: the same list", () => {
    expect(dropdownPlan({ ...ctx, on: true })).toEqual(["opacity", "interval", "above", "legend", "info"]);
  });
  it("status and 'Too far out to draw' belong to a DRAWING layer — on only, and they lead", () => {
    expect(dropdownPlan({ ...ctx, on: false, hasStatus: true, zoomGated: true })).toEqual(["opacity", "interval", "above", "legend", "info"]);
    expect(dropdownPlan({ ...ctx, on: true, hasStatus: true, zoomGated: true })).toEqual(["status", "zoom", "opacity", "interval", "above", "legend", "info"]);
  });
  it("an off row with a second layer's switch (the corridor) and a ramp offers them too", () => {
    expect(dropdownPlan({ on: false, hasInfo: true, settings: ["corridor"], hasRamp: true, hasLegend: true })).toEqual(["opacity", "corridor", "ramp", "info"]);
    expect(dropdownPlan({ on: false })).toEqual(["opacity"]);
  });
  it("the ⓘ is the small glyph alone — no 'About this layer' block — and its accessible name stays", () => {
    const info = panel.slice(panel.indexOf("function InfoReveal("), panel.indexOf("/* The ▾ body."));
    expect(info).not.toMatch(/About this layer/);
    expect(info).toMatch(/aria-label=\{`About \$\{label\}`\}/);
  });
  it("changing how an off layer LOOKS turns it on (opacity, Draw above plan, corridor); the Contour Interval never does", () => {
    const wake = panel.match(/const wakeRow = [^\n]+/)[0];
    expect(wake).toMatch(/setAll\(\{ on: true \}\)/);
    expect(panel).toMatch(/opacity: \{ value: opacity, onChange: \(v\) => \{ if \(!anyOn\) wakeRow\(\)/);
    expect(panel).toMatch(/onChange: \(v\) => \{ if \(v && !anyOn\) wakeRow\(\); setAll\(\{ above: v \}\)/);
    expect(panel).toMatch(/onToggle: \(v\) => \{ if \(v && !anyOn\) wakeRow\(\)/);
    expect(panel).toMatch(/interval: \{ value: interval, onChange: setContourInterval \}/);
  });
});
