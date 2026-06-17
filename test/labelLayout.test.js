import { describe, it, expect } from "vitest";
import { boxOf, boxesOverlap, fitLines, layoutLabels, buildingLabelLines, dimCalloutVisible, DIM_CALLOUT_MIN_PPF } from "../src/workspaces/site-planner/lib/labelLayout.js";

describe("labelLayout — shared label level-of-detail + collision engine (B121)", () => {
  it("boxOf centres a box on its point; boxesOverlap respects pad", () => {
    expect(boxOf(0, 0, 10, 10)).toEqual({ x: -5, y: -5, w: 10, h: 10 });
    const a = boxOf(0, 0, 10, 10);
    expect(boxesOverlap(a, boxOf(8, 0, 10, 10))).toBe(true);    // x-spans 3..13 vs -5..5
    expect(boxesOverlap(a, boxOf(20, 0, 10, 10))).toBe(false);  // far apart
    expect(boxesOverlap(a, boxOf(10, 0, 10, 10))).toBe(false);  // edges touch at x=5, no pad
    expect(boxesOverlap(a, boxOf(10, 0, 10, 10), 1)).toBe(true); // 1px pad closes the seam
  });

  it("fitLines keeps highest-priority leading lines that fit maxH, always ≥1", () => {
    const lines = ["Name", "sf", "dims"]; // index 0 = name = last to drop
    expect(fitLines(lines, 10, 1000)).toEqual(["Name", "sf", "dims"]); // plenty of room
    expect(fitLines(lines, 10, 25)).toEqual(["Name", "sf"]);           // floor(25/10)=2
    expect(fitLines(lines, 10, 5)).toEqual(["Name"]);                  // never blanks fully
    expect(fitLines(lines, 10, undefined)).toEqual(["Name", "sf", "dims"]); // no constraint
    expect(fitLines([], 10, 5)).toEqual([]);
  });

  it("non-overlapping labels both render in full", () => {
    const show = layoutLabels([
      { id: "a", cx: 0, cy: 0, lines: ["AA", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 100 },
      { id: "b", cx: 500, cy: 500, lines: ["BB", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 50 },
    ]);
    expect(show.get("a")).toEqual(["AA", "s", "d"]);
    expect(show.get("b")).toEqual(["BB", "s", "d"]);
  });

  it("on a hard collision the lower-importance label is hidden, not overprinted", () => {
    const show = layoutLabels([
      { id: "lo", cx: 0, cy: 0, lines: ["LL", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 1 },
      { id: "hi", cx: 0, cy: 0, lines: ["HH", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 999 },
    ], { pad: 0 });
    expect(show.get("hi")).toEqual(["HH", "s", "d"]); // higher importance wins the spot, full
    expect(show.has("lo")).toBe(false);               // loser hidden rather than stacked on top
  });

  it("a near-collision is resolved by dropping the loser's lowest lines (not hiding it)", () => {
    // hi sits at y=0 (1 line, y -5..5); lo at y=18 — 3 lines (y 3..33) clip hi, 2 lines (y 8..28) clear it.
    const show = layoutLabels([
      { id: "hi", cx: 0, cy: 0, lines: ["A"], lh: 10, charW: 6, maxH: 1000, importance: 100 },
      { id: "lo", cx: 0, cy: 18, lines: ["B", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 50 },
    ], { pad: 0 });
    expect(show.get("hi")).toEqual(["A"]);
    expect(show.get("lo")).toEqual(["B", "s"]); // dimensions line dropped to clear the neighbour
  });

  it("level-of-detail: a tight shape keeps only the name even with no neighbour", () => {
    const show = layoutLabels([
      { id: "x", cx: 0, cy: 0, lines: ["Name", "sf", "dims"], lh: 10, charW: 6, maxH: 15, importance: 1 },
    ]);
    expect(show.get("x")).toEqual(["Name"]); // floor(15/10)=1 line fits the shape
  });

  it("empty / missing input yields an empty map", () => {
    expect(layoutLabels([]).size).toBe(0);
    expect(layoutLabels(null).size).toBe(0);
  });

  it("buildingLabelLines (B123): name → sf → (incl. N bump-outs) → dims; parenthetical only with bump-outs", () => {
    expect(buildingLabelLines({ name: "Building 1", sqft: "198,000 sf", bumpCount: 2, dims: "300′ × 638′" }))
      .toEqual(["Building 1", "198,000 sf", "(incl. 2 bump-outs)", "300′ × 638′"]);
    expect(buildingLabelLines({ name: "Building 3", sqft: "90,000 sf", bumpCount: 0, dims: "300′ × 300′" }))
      .toEqual(["Building 3", "90,000 sf", "300′ × 300′"]); // no parenthetical line when no bump-outs
    expect(buildingLabelLines({ name: "Building 2", sqft: "50,000 sf", bumpCount: 1, dims: "200′ × 250′" })[2])
      .toBe("(incl. 1 bump-out)"); // singular
    // Drop order: feeding the stack to the LOD keeps name + sf and drops the dimensions
    // (and the parenthetical) first — so square footage outlives the dimensions on zoom-out.
    const stack = buildingLabelLines({ name: "Building 1", sqft: "198,000 sf", bumpCount: 2, dims: "300′ × 638′" });
    expect(fitLines(stack, 10, 25)).toEqual(["Building 1", "198,000 sf"]);
  });

  it("dimCalloutVisible (B121 r2): red edge-dimension callouts hide only when zoomed out", () => {
    expect(dimCalloutVisible(0.45)).toBe(true);                 // zoomed in → show
    expect(dimCalloutVisible(0.35)).toBe(true);                 // default working zoom → show
    expect(dimCalloutVisible(DIM_CALLOUT_MIN_PPF)).toBe(true);  // exactly at the threshold → show
    expect(dimCalloutVisible(0.1)).toBe(false);                 // zoomed out → hide (declutter)
  });
});
