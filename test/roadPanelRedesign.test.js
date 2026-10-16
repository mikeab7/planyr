/* Road Properties panel redesign (NEW-1/NEW-2/NEW-3) — source guards + the Yield-cost golden master. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { costRollup, roadQuantities } from "../src/workspaces/site-planner/lib/costTakeoff.js";

const SRC = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
const roadBranch = (() => {
  const a = SRC.indexOf('selEl.type === "road" ? (() => {');
  const b = SRC.indexOf("})() : isDockZone(selEl) ? (() => {", a);
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  return SRC.slice(a, b);
})();

describe("NEW-2 — cost is gone from the road panel", () => {
  it("no cost controls or copy anywhere in the road panel branch", () => {
    for (const s of ["Curb & paving", "Curb &amp; paving", "Curb type", "Curbed sides", "Gutter pan", "roadQuantities", "setRoadCost", "Set unit prices"]) {
      expect(roadBranch, s).not.toContain(s);
    }
    expect(SRC).not.toContain("Curb &amp; paving (cost)");
    expect(SRC).not.toContain("setRoadCost");
  });
  it("the Yield panel still prices roads off the SAME rollup", () => {
    expect((SRC.match(/costRollup\(els, roadPavedWidth, roadLengthOf,/g) || []).length).toBe(2);
  });
  it("GOLDEN MASTER — Yield road cost on curbed roads is byte-identical (values recorded from the untouched lib)", () => {
    const els = [
      { id: "a", type: "road", curbType: "curb-gutter", curbedSides: 2, panWidth: 2 },
      { id: "b", type: "road", curbType: "barrier", curbedSides: 1 },
      { id: "c", type: "road" },
      { id: "d", type: "road", curbType: "none" },
    ];
    const fc = (e) => ({ a: 36, b: 24, c: 40, d: 30 }[e.id]);
    const len = (e) => ({ a: 1000, b: 500, c: 250, d: 80 }[e.id]);
    expect(JSON.stringify(costRollup(els, fc, len, { pavingSy: 31, curbBarrierLf: 18, curbGutterLf: 24 })))
      .toBe('{"segments":4,"pavingSy":6266.666666666667,"curbBarrierLf":1000,"curbGutterLf":2000,"pavingCost":194266.6666666667,"curbBarrierCost":18000,"curbGutterCost":48000,"total":260266.6666666667}');
    expect(JSON.stringify(roadQuantities(els[0], 36, 1000)))
      .toBe('{"lengthFt":1000,"fcfcWidth":36,"curbType":"curb-gutter","curbedSides":2,"panWidth":2,"curbCategory":"linear","pavingWidth":32,"pavingSf":32000,"pavingSy":3555.5555555555557,"curbLf":2000}');
  });
});

describe("NEW-1 — the rebuilt panel", () => {
  it("Length is read-only for a drawn road: no input on the centerline branch", () => {
    const m = roadBranch.match(/<Field gutter=\{ROAD_GUTTER_W\} oneLine label="Length">([\s\S]*?)<\/Field>/);
    expect(m).toBeTruthy();
    // the centerline arm is a plain readout span; only the legacy rect road gets an input
    expect(m[1]).toMatch(/\{cl \? \(\s*<span data-testid="road-length"/);
    expect(m[1]).toMatch(/\) : stepBox\(\{ ariaLabel: "Road length"/);
  });
  it("every row is a one-line Field on the wider gutter", () => {
    for (const l of ["Length", "Width", "Right-of-way", "Class", "Name"]) expect(roadBranch).toContain(`oneLine label="${l}"`);
    expect(roadBranch).toContain("ROAD_GUTTER_W");
  });
  it("the cross-section has its own section with the strip + one full-width button", () => {
    expect(roadBranch).toMatch(/<Collapse sectionId="road-xsection" title="Cross-section"/);
    expect(roadBranch).toContain("<RoadXSectionStrip");
    expect(roadBranch).toContain('data-testid="edit-road-xsection"');
    expect(roadBranch).not.toContain("Design cross-section…");
  });
  it("intersection params sit in one collapsed-by-default section, only when the road has a junction", () => {
    expect(roadBranch).toMatch(/\{cl && \(myTees\.length > 0 \|\| dj\) && \(\s*<Collapse sectionId="road-intersection" title="Intersection">/);
  });
  it("the label controls are shared and slider-free", () => {
    const a = SRC.indexOf("const inlineLabelControls = ");
    const b = SRC.indexOf("const coalesceLabelWrite = ");
    const body = SRC.slice(a, b);
    expect(body).not.toContain('type="range"');
    expect(body).toContain("SegmentedControl");
    expect(body).toContain('label="Repeat every"');
  });
});

describe("NEW-3 — the min-radius review is hidden behind ONE flag", () => {
  it("the panel parts render only when the flag is on", () => {
    expect(roadBranch).toMatch(/const warn = radiusReviewOn && cl \?/);
    expect(roadBranch).toMatch(/\{radiusReviewOn && warn && \(/);
    expect(roadBranch).toMatch(/\{radiusReviewOn && cl && \(\s*<div data-testid="road-curve-at-vertex"/);
  });
  it("the canvas flags and the tight-corner toasts are gated too", () => {
    expect(SRC).toMatch(/const roadRadiusFlags = useMemo\(\(\) => \{\s*const out = \[\];\s*if \(!radiusReviewOn\) return out;/);
    expect(SRC).toContain("const stt = radiusReviewOn && !d.connect && r && roadRadiusStatus(r, settings)");
    expect(SRC).toContain("const st = radiusReviewOn && roadRadiusStatus(el, settings)");
    expect(SRC).toContain("if (radiusReviewOn && threshold > 0 && isCenterlineRoad(el))");
  });
  it("there is exactly one flag: the panel reads it once, from the one module", () => {
    expect((SRC.match(/= roadRadiusReviewOn\(\);/g) || []).length).toBe(1);
  });
});
