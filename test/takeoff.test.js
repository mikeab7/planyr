import { describe, it, expect } from "vitest";
import {
  dist, pathLength, polyArea, measureValue, measureLabel, rollup, canCommitMeasure,
} from "../src/workspaces/doc-review/lib/takeoff.js";

describe("doc-review takeoff geometry + unit conversion", () => {
  it("dist is euclidean (3-4-5)", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("pathLength sums segments; closed adds the wrap-around edge", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    expect(pathLength(pts, false)).toBe(7);            // 3 + 4
    expect(pathLength(pts, true)).toBe(12);            // + 5 back to start
    expect(pathLength([{ x: 0, y: 0 }], false)).toBe(0); // degenerate
  });

  it("polyArea via shoelace (10x10 square = 100); degenerate => 0", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(polyArea(sq)).toBe(100);
    expect(polyArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });

  it("measureValue converts page units to feet via calibration", () => {
    const m = { kind: "distance", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
    expect(measureValue(m, 2)).toMatchObject({   // 2 ft per page unit
      kind: "distance", calibrated: true, lengthFt: 20, raw: 10,
    });
  });

  it("measureValue area scales by ftPerUnit^2 and reports acres", () => {
    const m = { kind: "area", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const v = measureValue(m, 3);                // raw area 100 * 3^2 = 900 sf
    expect(v.areaSf).toBe(900);
    expect(v.areaAc).toBeCloseTo(900 / 43560, 9);
  });

  // B24: measureValue/measureLabel used to deref m.pts[0].x and crash on empty/short
  // point sets. This guard is exactly the kind of fix a concurrent merge could undo.
  it("B24: degenerate measurements never throw", () => {
    expect(() => measureValue({ kind: "distance", pts: [] }, 5)).not.toThrow();
    expect(measureValue({ kind: "distance", pts: [] }, 5).lengthFt).toBeNull();
    expect(() => measureValue({ kind: "distance" }, 5)).not.toThrow();       // no pts key
    expect(() => measureLabel({ kind: "area", pts: [] }, 0)).not.toThrow();
  });

  it("measureLabel: count is a bare number; uncalibrated says 'set scale'", () => {
    expect(measureLabel({ kind: "count", pts: [{}, {}, {}] }, 0)).toBe("3");
    expect(measureLabel({ kind: "distance", pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, 0)).toBe("set scale");
  });

  // B296: linear measures (distance/perimeter) now carry one decimal so sub-foot precision
  // isn't hidden by whole-foot rounding (a 150.6 ft line used to read "151 ft"); area keeps
  // its 2-dp acres · whole sf. Guards against a regression back to f0.
  it("B296: calibrated linear labels show one decimal; area unchanged", () => {
    // 10 page-units × 1.06 ft/unit = 10.6 ft → "10.6 ft" (was "11 ft")
    expect(measureLabel({ kind: "distance", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, 1.06)).toBe("10.6 ft");
    // perimeter of a 3-4-5 triangle closed = 12 → "12.0 ft" (one decimal even when whole)
    expect(measureLabel({ kind: "perimeter", pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] }, 1)).toBe("12.0 ft");
    // area still acres-2dp · whole-sf (10×10 raw × 3² = 900 sf)
    expect(measureLabel({ kind: "area", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, 3)).toBe("0.02 ac · 900 sf");
  });

  // B299: a 2-point area/perimeter is degenerate — polyArea is 0 for <3 pts, and a 2-point
  // "closed" perimeter only measures its single segment (not the doubled-back loop). The
  // commit guard must require ≥3 for area/perimeter so these never reach the takeoff list.
  it("B299: 2-point area is 0 sf and 2-point closed perimeter is a single segment", () => {
    const ab = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(polyArea(ab)).toBe(0);                 // would save as a 0-sf area
    expect(pathLength(ab, true)).toBe(10);        // single segment, not 20 (no wrap for <3 pts)
  });
  it("B299: canCommitMeasure requires ≥3 pts for area/perimeter, ≥2 for spans, ≥1 for count", () => {
    expect(canCommitMeasure("area", 2)).toBe(false);
    expect(canCommitMeasure("area", 3)).toBe(true);
    expect(canCommitMeasure("perimeter", 2)).toBe(false);
    expect(canCommitMeasure("perimeter", 3)).toBe(true);
    expect(canCommitMeasure("distance", 1)).toBe(false);
    expect(canCommitMeasure("distance", 2)).toBe(true);
    expect(canCommitMeasure("rect", 2)).toBe(true);
    expect(canCommitMeasure("cloud", 2)).toBe(true);
    expect(canCommitMeasure("count", 1)).toBe(true);
    expect(canCommitMeasure("count", 0)).toBe(false);
  });

  it("rollup totals calibrated items and counts uncalibrated ones", () => {
    const markups = [
      { kind: "distance", page: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },                         // 10 * 2 = 20 ft
      { kind: "count", page: 1, pts: [{}, {}] },                                                      // 2
      { kind: "area", page: 2, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, // page 2 uncalibrated
    ];
    const r = rollup(markups, { 1: 2 });           // page 1 = 2 ft/unit; page 2 has no calibration
    expect(r.distFt).toBe(20);
    expect(r.count).toBe(2);
    expect(r.uncal).toBe(1);
  });
});
