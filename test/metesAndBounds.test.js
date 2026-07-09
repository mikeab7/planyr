import { describe, it, expect } from "vitest";
import {
  parseCalls, callsToPath, pathCloses, misclosure, ringsOverlap, VARA_FT,
} from "../src/workspaces/site-planner/lib/metesAndBounds.js";

describe("metes-and-bounds parser + plotter", () => {
  it("parses a basic quadrant call to azimuth + feet", () => {
    const calls = parseCalls("THENCE N 45 E, 150.00 feet");
    expect(calls).toHaveLength(1);
    expect(calls[0].az).toBeCloseTo(45, 6);
    expect(calls[0].distFt).toBeCloseTo(150, 6);
  });

  it("maps all four quadrants to clockwise-from-north azimuth", () => {
    const az = (s) => parseCalls(s + " 100 ft")[0].az;
    expect(az("N 30 E")).toBeCloseTo(30, 6);
    expect(az("S 30 E")).toBeCloseTo(150, 6);
    expect(az("S 30 W")).toBeCloseTo(210, 6);
    expect(az("N 30 W")).toBeCloseTo(330, 6);
  });

  it("converts varas to feet (1 vara = 100/36 ft)", () => {
    expect(VARA_FT).toBeCloseTo(2.77778, 5);
    expect(parseCalls("N 0 E 100 varas")[0].distFt).toBeCloseTo(277.778, 3);
  });

  // B26: a dash-separated DMS bearing ("S 12-15 W") must parse, not be silently dropped.
  it("B26: parses dash-separated degrees-minutes", () => {
    const c = parseCalls("S 12-15 W 100 ft");
    expect(c).toHaveLength(1);
    expect(c[0].deg).toBeCloseTo(12.25, 6);   // 12° 15'
    expect(c[0].az).toBeCloseTo(192.25, 6);   // SW => 180 + deg
  });

  // B26: a quadrant bearing can't exceed 90° — a bogus call must be skipped, not plotted.
  it("B26: rejects a >90° quadrant bearing instead of plotting a wrong direction", () => {
    expect(parseCalls("N 145 E 100 ft")).toEqual([]);
  });

  it("callsToPath dead-reckons from the POB (planner frame: north decreases y)", () => {
    const pts = callsToPath(parseCalls("N 0 E 100 ft"), { x: 0, y: 0 }); // due north
    expect(pts).toHaveLength(2);
    expect(pts[1].x).toBeCloseTo(0, 6);
    expect(pts[1].y).toBeCloseTo(-100, 6);    // north subtracts y
  });

  it("misclosure is the straight gap from the last point back to the POB", () => {
    expect(misclosure([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
    expect(misclosure([{ x: 0, y: 0 }])).toBe(0);
  });

  // B26: the old 25-ft absolute closure floor let a small lot "close" on a big gap.
  // With the floor dropped to 5 ft, a 10-ft misclosure on a ~30-ft-perimeter lot
  // must read as NOT closed (while a ~3-ft gap still closes).
  it("B26: a small lot does not falsely close on a 10-ft gap", () => {
    const open = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];     // gap 10 ft
    expect(pathCloses(open)).toBe(false);
    const closed = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 2, y: 2 }];    // gap ~2.8 ft
    expect(pathCloses(closed)).toBe(true);
  });

  it("ringsOverlap detects intersection and disjointness", () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const overlapping = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    const disjoint = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }];
    expect(ringsOverlap(a, overlapping)).toBe(true);
    expect(ringsOverlap(a, disjoint)).toBe(false);
    expect(ringsOverlap(a, [])).toBe(false);
  });
});


describe("spelled-out DEG./MIN./SEC. bearings (survey verbose form)", () => {
  it("parses 'NORTH nn DEG. nn MIN. nn SEC. WEST' keeping West (no DEG-letter leak)", () => {
    const c = parseCalls("THENCE NORTH 02 DEG. 29 MIN. 38 SEC. WEST, A DISTANCE OF 531.21 FEET");
    expect(c).toHaveLength(1);
    expect(c[0].az).toBeCloseTo(357.506, 2); // N 2 deg 29' 38" W
    expect(c[0].distFt).toBeCloseTo(531.21, 2);
  });
  it("keeps minutes + seconds (not just whole degrees) in the verbose form", () => {
    const c = parseCalls("THENCE SOUTH 23 DEG. 57 MIN. 24 SEC. WEST, A DISTANCE OF 29.45 FEET");
    expect(c[0].az).toBeCloseTo(203.957, 2); // S 23 deg 57' 24" W
  });
  it("parses fully spelled-out degrees / minutes / seconds", () => {
    const c = parseCalls("THENCE North 87 degrees 04 minutes 16 seconds East, 1773.49 feet");
    expect(c[0].az).toBeCloseTo(87.071, 2);
    expect(c[0].distFt).toBeCloseTo(1773.49, 2);
  });
  it("still parses the compact symbol DMS form", () => {
    const c = parseCalls('THENCE S 16°13\'23" E, 403.47 feet');
    expect(c[0].az).toBeCloseTo(163.777, 2);
  });
});
