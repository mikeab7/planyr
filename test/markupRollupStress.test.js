/* Adversarial STRESS TEST for the Markup yield-panel rollup (B351-adjacent, round 5).
 *
 * The Markup tool hands `rollup` the WHOLE markup list — measurements (distance/perimeter/area/
 * count) AND redline annotations (rect/cloud/line/arrow/text) mixed together. The yield panel
 * then prints totals and, crucially, a warning: "N measurement(s) on uncalibrated sheets are
 * excluded." So rollup must count ONLY measurements: a redline cloud or a text note on an
 * uncalibrated sheet must not be mistaken for an excluded measurement (a confusing wrong count),
 * and must never be summed into feet/acres.
 */
import { describe, it, expect } from "vitest";
import { rollup } from "../src/workspaces/doc-review/lib/takeoff.js";

const sq = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];

describe("STRESS · rollup counts only measurements, never redline annotations", () => {
  it("redline shapes / text on an UNcalibrated sheet do NOT inflate `uncal`", () => {
    const markups = [
      { kind: "rect", page: 1, pts: sq(10) },
      { kind: "cloud", page: 1, pts: sq(20) },
      { kind: "line", page: 1, pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      { kind: "arrow", page: 1, pts: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { kind: "text", page: 1, pts: [{ x: 1, y: 1 }], text: "see detail" },
    ];
    const r = rollup(markups, {}); // page 1 uncalibrated
    expect(r.uncal).toBe(0);       // pre-fix this was 5 → "5 measurement(s) … excluded"
    expect(r).toMatchObject({ areaSf: 0, perimFt: 0, distFt: 0, count: 0 });
  });

  it("redline shapes on a CALIBRATED sheet are ignored, not summed into the totals", () => {
    const markups = [
      { kind: "rect", page: 1, pts: sq(10) },           // would be 100 sf if mistaken for area
      { kind: "area", page: 1, pts: sq(10) },           // the real measurement: 100 sf
    ];
    const r = rollup(markups, { 1: 1 });                // 1 ft/unit
    expect(r.areaSf).toBe(100);                         // only the real area, the rect is not counted
    expect(r.uncal).toBe(0);
  });

  it("a true uncalibrated MEASUREMENT still counts toward `uncal`", () => {
    const markups = [
      { kind: "area", page: 2, pts: sq(10) },           // page 2 has no calibration
      { kind: "cloud", page: 2, pts: sq(5) },           // redline — must NOT add to uncal
    ];
    expect(rollup(markups, { 1: 2 }).uncal).toBe(1);    // exactly one excluded measurement, not two
  });

  it("totals every measurement kind on calibrated pages (distance/perimeter/area/count)", () => {
    const markups = [
      { kind: "distance", page: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, // 10 * 2 = 20 ft
      { kind: "perimeter", page: 1, pts: sq(10) },                            // perimeter 40 * 2 = 80 ft
      { kind: "area", page: 1, pts: sq(10) },                                 // 100 * 2*2 = 400 sf
      { kind: "count", page: 1, pts: [{}, {}, {}] },                          // 3
      { kind: "text", page: 1, pts: [{ x: 0, y: 0 }] },                       // ignored
    ];
    const r = rollup(markups, { 1: 2 });
    expect(r.distFt).toBe(20);
    expect(r.perimFt).toBe(80);
    expect(r.areaSf).toBe(400);
    expect(r.count).toBe(3);
    expect(r.uncal).toBe(0);
  });

  it("survives null / unknown-kind / empty entries without throwing or miscounting", () => {
    const markups = [null, { kind: "doodle", page: 1, pts: [] }, { kind: "count", page: 1, pts: [{}] }, {}];
    let r;
    expect(() => { r = rollup(markups, { 1: 1 }); }).not.toThrow();
    expect(r.count).toBe(1);
    expect(r.uncal).toBe(0);
  });

  it("a non-finite page calibration excludes the measurement (counts as uncal, never a bogus total)", () => {
    const r = rollup([{ kind: "distance", page: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], { 1: NaN });
    expect(r.distFt).toBe(0);
    expect(r.uncal).toBe(1);
  });
});
