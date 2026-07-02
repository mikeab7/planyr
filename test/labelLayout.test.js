import { describe, it, expect } from "vitest";
import { boxOf, boxesOverlap, fitLines, layoutLabels, buildingLabelLines, dimCalloutVisible, DIM_CALLOUT_MIN_PPF, detailLabelVisible, DETAIL_LABEL_MIN_PX, suppressedDimIds } from "../src/workspaces/site-planner/lib/labelLayout.js";

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
    expect(show.get("a").lines).toEqual(["AA", "s", "d"]);
    expect(show.get("b").lines).toEqual(["BB", "s", "d"]);
  });

  it("on a hard collision the lower-importance label is hidden, not overprinted", () => {
    const show = layoutLabels([
      { id: "lo", cx: 0, cy: 0, lines: ["LL", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 1 },
      { id: "hi", cx: 0, cy: 0, lines: ["HH", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 999 },
    ], { pad: 0 });
    expect(show.get("hi").lines).toEqual(["HH", "s", "d"]); // higher importance wins the spot, full
    expect(show.has("lo")).toBe(false);               // loser hidden rather than stacked on top
  });

  it("a near-collision is resolved by dropping the loser's lowest lines (not hiding it)", () => {
    // hi sits at y=0 (1 line, y -5..5); lo at y=18 — 3 lines (y 3..33) clip hi, 2 lines (y 8..28) clear it.
    const show = layoutLabels([
      { id: "hi", cx: 0, cy: 0, lines: ["A"], lh: 10, charW: 6, maxH: 1000, importance: 100 },
      { id: "lo", cx: 0, cy: 18, lines: ["B", "s", "d"], lh: 10, charW: 6, maxH: 1000, importance: 50 },
    ], { pad: 0 });
    expect(show.get("hi").lines).toEqual(["A"]);
    expect(show.get("lo").lines).toEqual(["B", "s"]); // dimensions line dropped to clear the neighbour
  });

  it("level-of-detail: a tight shape keeps only the name even with no neighbour", () => {
    const show = layoutLabels([
      { id: "x", cx: 0, cy: 0, lines: ["Name", "sf", "dims"], lh: 10, charW: 6, maxH: 15, importance: 1 },
    ]);
    expect(show.get("x").lines).toEqual(["Name"]); // floor(15/10)=1 line fits the shape
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

  it("detailLabelVisible (B149): a fine width label needs the zoom floor AND DETAIL_LABEL_MIN_PX of measured feature", () => {
    const P = DETAIL_LABEL_MIN_PX; // calibrated to 30px (see lib/labelLayout.js — the ppf-8 zoom cap)
    // A 5′ sidewalk strip is the headline case: at site-overview zoom (~0.2 ppf) it's ~1px, so
    // its "5′ Sidewalk" width label is illegible clutter and must NOT draw (the reported bug). It
    // reveals only once you zoom in far enough that the 5′ projects to ≥ the threshold — resolution-
    // independently, and threshold-agnostically (we derive the boundary ppf from the constant).
    expect(detailLabelVisible(5, 0.2)).toBe(false);          // overview: 5×0.2=1px → hidden (the bug)
    expect(detailLabelVisible(5, 0.35)).toBe(false);         // working zoom: still a sliver → hidden
    expect(detailLabelVisible(5, P / 5 + 0.01)).toBe(true);  // just past the 5′ reveal point → shown
    expect(detailLabelVisible(5, P / 5 - 0.01)).toBe(false); // just shy of it → still hidden
    // A wider 25′ buffer / 37′ aisle reveals at a LOWER zoom (self-tuning) but is still gone at overview.
    expect(detailLabelVisible(25, 0.2)).toBe(false);         // 25×0.2=5px → hidden at overview
    expect(detailLabelVisible(25, P / 25 + 0.01)).toBe(true); // reveals sooner than the 5′ strip
    expect(P / 25).toBeLessThan(P / 5);                       // wider feature ⇒ lower reveal ppf
    // The shared zoom floor (dimCalloutVisible) still bites: even a long feature can't show below it.
    expect(detailLabelVisible(500, 0.1)).toBe(false);               // 500×0.1=50px but ppf<floor → hidden
    expect(detailLabelVisible(500, DIM_CALLOUT_MIN_PPF)).toBe(true); // at the floor with ≥threshold → shown
    // Calibrated so the narrowest real strip (5′) reveals BELOW the planner's ppf-8 zoom cap (headroom).
    expect(P / 5).toBeLessThan(8);
  });

  it("leader line (B121 r2b): a label wider than its shape is pulled outside with a leader to the centroid", () => {
    // tiny shape (halfW/halfH = 5px) but a ~60px-wide name → can't fit inside.
    const show = layoutLabels([
      { id: "small", cx: 100, cy: 100, lines: ["Building 3"], lh: 12, charW: 6, halfW: 5, halfH: 5, importance: 1 },
    ]);
    const p = show.get("small");
    expect(p.lines).toEqual(["Building 3"]);          // name kept
    expect(p.leader).toEqual({ x: 100, y: 100 });     // connector points back to the shape centroid
    expect(p.y).toBeLessThan(100);                    // label sits ABOVE the shape
    expect(p.x).toBe(100);                            // horizontally centred over it
  });

  it("a label that fits inside its shape stays inside with no leader", () => {
    const show = layoutLabels([
      { id: "big", cx: 0, cy: 0, lines: ["Building 1"], lh: 12, charW: 6, halfW: 200, halfH: 200, importance: 1 },
    ]);
    expect(show.get("big")).toMatchObject({ x: 0, y: 0, leader: null });
  });

  it("NEW-2/5: a rotated label is tested against the strip's rotated footprint and fits inside a thin vertical strip", () => {
    // A thin VERTICAL strip: narrow across (halfW=8px) but tall (halfH=120px). The "5′ Landscape"
    // label is ~66px wide horizontally — too wide to sit across the strip — but rotated 90° its
    // length runs DOWN the strip's long axis, so it fits inside (no leader).
    const item = { id: "ls", cx: 0, cy: 0, lines: ["5′ Landscape"], lh: 12, charW: 6, halfW: 8, halfH: 120, importance: 1 };
    const flat = layoutLabels([{ ...item, rot: 0 }]).get("ls");
    const rotated = layoutLabels([{ ...item, rot: 90 }]).get("ls");
    expect(flat.leader).not.toBeNull();   // horizontal: overflows → pulled outside with a leader
    expect(rotated.leader).toBeNull();     // rotated along the long axis: fits inside
    expect(rotated.rot).toBe(90);          // render applies this rotation
    expect(rotated).toMatchObject({ x: 0, y: 0 });
  });

  it("B195: a noLeader label that can't fit overflows IN PLACE instead of leadering out", () => {
    // A small shape (halfW/halfH = 8px) with a label too wide to fit. A normal label is pulled
    // outside with a leader; a `noLeader` label (a trailer strip sized to its own area) instead
    // stays centred on the shape and overflows — controlled overflow rather than floating away.
    const item = { id: "t", cx: 50, cy: 50, lines: ["50′ Trailer Parking", "29 trailers"], lh: 12, charW: 6, halfW: 8, halfH: 8, importance: 1 };
    const led = layoutLabels([{ ...item }]).get("t");
    const ovf = layoutLabels([{ ...item, noLeader: true }]).get("t");
    expect(led.leader).not.toBeNull();                 // normal label escapes with a leader
    expect(ovf.leader).toBeNull();                     // noLeader: never leadered out
    expect(ovf).toMatchObject({ x: 50, y: 50 });       // overflows centred in place
  });

  it("B195: a noLeader label drops a line to fit inside before it overflows", () => {
    // Tall enough for 1 line but not 2 (halfH small), wide enough that width never binds. The
    // engine drops the count line and shows the 1-line label INSIDE rather than overflowing.
    const p = layoutLabels([
      { id: "t", cx: 0, cy: 0, lines: ["50′ Trailer Parking", "29 trailers"], lh: 10, charW: 4, halfW: 400, halfH: 7, noLeader: true, importance: 1 },
    ]).get("t");
    expect(p.lines).toEqual(["50′ Trailer Parking"]);  // count line dropped to fit the short side
    expect(p.leader).toBeNull();                       // and it sits inside, no leader
  });

  it("B121 r3: layoutLabels returns each placement's committed screen box", () => {
    // Single 1-line label at the origin: widthOf(["AA"],6)=12, height=1·lh=10, box centred on (0,0).
    const p = layoutLabels([
      { id: "a", cx: 0, cy: 0, lines: ["AA"], lh: 10, charW: 6, maxH: 1000, importance: 100 },
    ]).get("a");
    expect(p.box).toEqual(boxOf(0, 0, 12, 10));
  });

  it("B121 r3: suppressedDimIds hides a dimension whose box overlaps a committed label, keeps clear ones", () => {
    const labelBoxes = [boxOf(0, 0, 40, 20)];          // a placed centred label at the origin
    const set = suppressedDimIds([
      { id: "over", box: boxOf(5, 0, 20, 10) },         // overlaps the label → hidden
      { id: "clear", box: boxOf(300, 0, 20, 10) },      // far away → kept
      { id: "nobox" },                                  // no box (not visible this frame) → skipped
    ], labelBoxes, 0);
    expect(set.has("over")).toBe(true);
    expect(set.has("clear")).toBe(false);
    expect(set.has("nobox")).toBe(false);
  });

  it("B121 r3: suppressedDimIds pad closes a touching seam; empty inputs are safe", () => {
    const labelBoxes = [boxOf(0, 0, 10, 10)];           // spans -5..5
    const touching = [{ id: "t", box: boxOf(10, 0, 10, 10) }]; // spans 5..15 — edges touch at x=5
    expect(suppressedDimIds(touching, labelBoxes, 0).has("t")).toBe(false); // no pad → no overlap
    expect(suppressedDimIds(touching, labelBoxes, 1).has("t")).toBe(true);  // 1px pad closes the seam
    expect(suppressedDimIds([{ id: "x", box: boxOf(0, 0, 4, 4) }], []).size).toBe(0); // no labels → nothing hidden
    expect(suppressedDimIds([], labelBoxes).size).toBe(0);
    expect(suppressedDimIds(null, null).size).toBe(0);
  });

  it("B121: buildingLabelLines omits the sf line when sqft is falsy (Show areas off)", () => {
    expect(buildingLabelLines({ name: "Building 1", sqft: null, bumpCount: 0, dims: "300′ × 638′" }))
      .toEqual(["Building 1", "300′ × 638′"]);          // name + dims, no sf line
    expect(buildingLabelLines({ name: "Building 2", sqft: undefined, bumpCount: 2, dims: "200′ × 250′" }))
      .toEqual(["Building 2", "(incl. 2 bump-outs)", "200′ × 250′"]); // bump note kept, sf dropped
  });
});
