// NEW-1/NEW-2 (amends B2315856–B2315859, B2319137): grading is a PER-PLAN switch, off by default, inside the Grading panel;
// the map paint is a separate per-plan checkbox that shares one source of truth with the Cut & Fill Layers row.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gradingCfg } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { GradingPanel, OFF_LINE } from "../src/workspaces/site-planner/components/GradingPanels.jsx";

const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

describe("grading is off per plan until switched on", () => {
  it("the stored switch defaults off and only a literal true turns it on", () => {
    expect(gradingCfg(undefined).enabled).toBe(false);
    expect(gradingCfg({}).enabled).toBe(false);
    expect(gradingCfg({ enabled: true }).enabled).toBe(true);
    expect(gradingCfg({ enabled: 1 }).enabled).toBe(false);
  });
  it("grOn (everything that does work) needs the owner gate AND the plan switch", () => {
    expect(sp).toMatch(/const grPlanOn = gradingOn && \(settings\.grading \|\| \{\}\)\.enabled === true;/);
    expect(sp).toMatch(/useGradingBase\(\{ enabled: grPlanOn && !!origin,/);
    expect(sp).toMatch(/const grOn = grBase\.on;/);
  });
  it("the controller (DEM, sweep, FFE solve, rock, fixes) mounts only while grading is on for the plan", () => {
    expect(sp).toMatch(/\{grOn && grInput && \(\s*<Suspense fallback=\{null\}><GradingController/);
  });
  it("with it off, gsEls/gsInputs are the non-owner inputs: no suggested FFE, no host ids, no grading pack", () => {
    expect(sp).toMatch(/\(grOn && e\.type === "building" && grModel && grModel\.autoFfe/);
    expect(sp).toMatch(/\.\.\.\(grOn && e\.type !== "building" \? \{ hostId:/);
    expect(sp).toMatch(/\.\.\.\(grOn && grBase\.pack \? \{ grading: grBase\.pack \} : \{\}\)/);
    // the panel is handed a null model while off, so a stale suggestion can never reach it
    expect(sp).toMatch(/model=\{grOn \? \(grModel \|\| null\) : null\}/);
  });
  it("the canvas paint and the two Layers rows are behind grOn", () => {
    expect(sp).toMatch(/grOn && grModel && \(grModel\.buildable \|\| grModel\.cutfill\)/);
    expect(sp).toMatch(/gradingRows=\{grOn && grModel \?/);
  });
  it("the dock item stays on the owner gate so the switch is reachable", () => {
    expect(sp).toMatch(/_pid === "grading" && gradingOn && \(/);
    expect(sp).toMatch(/\], gradingOn\); \/\/ owner-only Grading item/);
  });
});

describe("the Grading panel body", () => {
  const html = (p) => renderToStaticMarkup(React.createElement(GradingPanel, p));
  it("off: the switch and one line, nothing else", () => {
    const h = html({ planOn: false, model: null });
    expect(h).toContain("Grade this plan");
    expect(h).toContain(OFF_LINE);
    expect(OFF_LINE).toBe("Turn this on to suggest finish elevations and show cut and fill for this plan.");
    expect(h).not.toContain("Show cut and fill on the map");
    expect(h).not.toContain('data-section="grading"');
    expect(h).not.toContain("data-ground");
  });
  it("on: the show-on-map checkbox appears, unchecked by default", () => {
    const h = html({ planOn: true, model: null });
    expect(h).toContain("Show cut and fill on the map");
    expect(h).toMatch(/data-testid="grading-show-on-map"(?![^>]*checked)/);
  });
});

describe("Show cut and fill on the map shares ONE state with the Cut & Fill Layers row", () => {
  it("both write settings.grading.layers.cutfill through grSetLayer", () => {
    expect(sp).toMatch(/onShowOnMap=\{\(v\) => grSetLayer\("cutfill", v\)\}/);
    expect(sp).toMatch(/rows: grModel\.layerRows, onToggle: grSetLayer/);
    expect(sp).toMatch(/showOnMap=\{!!\(settings\.grading \|\| \{\}\)\.layers\?\.cutfill\}/);
  });
  it("the cut-and-fill layer and the controller's own row read the same cfg flag, default off", () => {
    expect(gradingCfg({}).layers.cutfill).toBe(false);
    expect(gradingCfg({ layers: { cutfill: true } }).layers.cutfill).toBe(true);
    const ctl = readFileSync(new URL("../src/workspaces/site-planner/components/GradingController.jsx", import.meta.url), "utf8");
    expect(ctl).toMatch(/on: cfg\.layers\.cutfill,/);
  });
});
