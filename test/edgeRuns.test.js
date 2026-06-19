import { describe, it, expect } from "vitest";
import { segBearing, bearingDelta, edgeRuns, runOfEdge, runSetbackValue } from "../src/workspaces/site-planner/lib/edgeRuns.js";

describe("segBearing / bearingDelta", () => {
  it("reports directed bearings in [0,360)", () => {
    expect(segBearing({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(segBearing({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(segBearing({ x: 0, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
    expect(segBearing({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(270);
  });
  it("wraps the difference to the short way around", () => {
    expect(bearingDelta(10, 350)).toBeCloseTo(20);
    expect(bearingDelta(350, 10)).toBeCloseTo(20);
    expect(bearingDelta(0, 180)).toBeCloseTo(180);
    expect(bearingDelta(5, 5)).toBeCloseTo(0);
  });
});

describe("edgeRuns", () => {
  it("returns one run per side of a square", () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const runs = edgeRuns(sq);
    expect(runs).toHaveLength(4);
    runs.forEach((r) => { expect(r.edges).toHaveLength(1); expect(r.lengthFt).toBeCloseTo(100); });
  });

  it("groups many near-collinear segments into ONE side (the Mesa case)", () => {
    // A bottom edge digitized as 4 nearly-straight segments (pts 0..4), then 2 sides.
    const pts = [
      { x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 }, { x: 150, y: 2 }, { x: 200, y: 0 }, // ~East, 4 segs
      { x: 200, y: 100 }, // North
      { x: 0, y: 100 },   // West
    ];
    const runs = edgeRuns(pts, 8);
    // The 4 bottom segments collapse into a single run; + the two long sides + the closing edge.
    const bottom = runs.find((r) => r.edges.includes(0));
    expect(bottom.edges).toEqual([0, 1, 2, 3]);
    // Run length ≈ sum of the 4 wiggly segments (each ~50).
    expect(bottom.lengthFt).toBeGreaterThan(200);
    expect(bottom.lengthFt).toBeLessThan(210);
  });

  it("breaks a run at a genuine corner / notch beyond tolerance", () => {
    // A side with a 90° notch in the middle must NOT be one run.
    const pts = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, // East
      { x: 100, y: 20 }, { x: 130, y: 20 }, // notch up then East again
      { x: 130, y: 100 }, { x: 0, y: 100 },
    ];
    const runs = edgeRuns(pts, 8);
    const run0 = runOfEdge(runs, 0);
    expect(run0.edges).toContain(0);
    expect(run0.edges).not.toContain(1); // the 90° jog breaks the run
  });

  it("merges a side that straddles the index-0 seam", () => {
    // Start the ring mid-way along the bottom side: edges [n-1] and [0] are collinear.
    const pts = [
      { x: 100, y: 0 }, { x: 200, y: 0 }, // edges 0 (East) ...
      { x: 200, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }, // ... edge 4 closes back to (100,0): East again
    ];
    const runs = edgeRuns(pts, 8);
    const bottom = runOfEdge(runs, 0);
    // edge 4 (0,0)->(100,0) is collinear with edge 0 (100,0)->(200,0): same run, wrapping the seam.
    expect(bottom.edges).toContain(0);
    expect(bottom.edges).toContain(4);
  });

  it("covers every edge exactly once (a partition)", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 },
      { x: 100, y: 50 }, { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const runs = edgeRuns(pts);
    const all = runs.flatMap((r) => r.edges).sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("handles a single triangle and degenerate input", () => {
    expect(edgeRuns([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toHaveLength(1); // 2-pt → one edge
    expect(edgeRuns([{ x: 0, y: 0 }])).toEqual([]);
    expect(edgeRuns(null)).toEqual([]);
    const tri = edgeRuns([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]);
    expect(tri).toHaveLength(3);
  });

  it("places the run midpoint at its arc-length centre", () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const bottom = runOfEdge(edgeRuns(sq), 0);
    expect(bottom.mid.x).toBeCloseTo(50);
    expect(bottom.mid.y).toBeCloseTo(0);
  });
});

describe("runSetbackValue", () => {
  const sq = [{ x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const runs = edgeRuns(sq);
  const bottom = runOfEdge(runs, 0); // edges [0,1]

  it("returns the shared value when every edge in the run agrees", () => {
    const sb = [25, 25, 10, 10, 10];
    expect(runSetbackValue(bottom, sb)).toBe(25);
  });
  it("returns null when the run's edges disagree (a per-segment override)", () => {
    const sb = [25, 40, 10, 10, 10];
    expect(runSetbackValue(bottom, sb)).toBeNull();
  });
  it("guards bad input", () => {
    expect(runSetbackValue(null, [1, 2])).toBeNull();
    expect(runSetbackValue(bottom, null)).toBeNull();
  });
});
