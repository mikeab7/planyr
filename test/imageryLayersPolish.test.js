/* B2391216 follow-up — three polish items on the two-pane Imagery & Layers panel, pinned at the source and the pure model.
 * (The rendered, width × theme proof is ui-audit/verify-imagery-layers-panel.mjs; this is the part CI runs.)
 *  1. every row reserves the swatch slot, so a name starts at the same x in every pane; the owner-only grading rows are Title-Cased
 *  2. no "Show the N sources that don't cover this site" line in Flood & Drainage (floodRowRelevance scoping is untouched)
 *  3. Contour Lines' ▾ offers the Interval whether the row is off or on */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dropdownPlan } from "../src/workspaces/site-planner/lib/layerPanelModel.js";

const panel = readFileSync(new URL("../src/workspaces/site-planner/components/LayerPanel.jsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/workspaces/site-planner/components/GradingController.jsx", import.meta.url), "utf8");
const floodGroup = readFileSync(new URL("../src/workspaces/site-planner/lib/floodGroup.js", import.meta.url), "utf8");

describe("1 · name alignment and Title Case", () => {
  it("the Swatch slot is reserved for a row with no map colour (never returns null)", () => {
    const sw = panel.slice(panel.indexOf("function Swatch("), panel.indexOf("function Caret("));
    expect(sw).not.toMatch(/return null/);
    expect(sw).toMatch(/data-swatch="none"/);
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
    expect(panel).toMatch(/floodScope\.tiers\.map/);
  });
});

describe("3 · Interval is a setting, reachable on an off row", () => {
  const ctx = { hasInfo: true, settings: ["interval"] };
  it("off: Interval then ⓘ — nothing about a drawing layer (no opacity, status or zoom)", () => {
    expect(dropdownPlan({ ...ctx, on: false, hasStatus: true, zoomGated: true })).toEqual(["interval", "info"]);
  });
  it("on: Interval stays, with the drawing controls around it", () => {
    expect(dropdownPlan({ ...ctx, on: true })).toEqual(["opacity", "interval", "info"]);
  });
  it("an off row with no settings is still just ⓘ; a second layer's switch (the corridor) is not offered off", () => {
    expect(dropdownPlan({ on: false, hasInfo: true })).toEqual(["info"]);
    expect(dropdownPlan({ on: false, hasInfo: true, settings: ["corridor"] })).toEqual(["info"]);
  });
});
