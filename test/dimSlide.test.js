import { describe, it, expect } from "vitest";
import { dimSlideRange, clampDimOffset, DIM_POS_F_DEFAULT, DIM_POS_F_ROAD } from "../src/workspaces/site-planner/lib/dimSlide.js";

// The rendered dimension line sits at this local length-coordinate (feet from centre).
const lineAt = (L, posF, offset) => L * (posF - 0.5) + offset;

describe("dimSlide — footprint dimension slide constraint (B590)", () => {
  it("a long-horizontal building slides along X (length), pins Y (depth)", () => {
    const r = dimSlideRange({ w: 620, h: 300 }, [], DIM_POS_F_DEFAULT);
    expect(r.axis).toBe("x");
    expect(r.lock).toBe("y");
    expect(r.L).toBe(620);
  });

  it("a long-vertical building slides along Y, pins X", () => {
    const r = dimSlideRange({ w: 300, h: 620 }, [], DIM_POS_F_DEFAULT);
    expect(r.axis).toBe("y");
    expect(r.lock).toBe("x");
    expect(r.L).toBe(620);
  });

  it("a square ties to horizontal (matches renderElPx's w >= h)", () => {
    expect(dimSlideRange({ w: 400, h: 400 }).axis).toBe("x");
  });

  it("with no bump-outs the line slides edge-to-edge and never leaves the footprint", () => {
    const L = 620, posF = DIM_POS_F_DEFAULT;
    const r = dimSlideRange({ w: L, h: 300 }, [], posF);
    // offset=min puts the line exactly on the −end edge; offset=max on the +end edge.
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2, 6);
    expect(lineAt(L, posF, r.max)).toBeCloseTo(L / 2, 6);
    // the default (offset 0) lands inside the band (18% in from the −end).
    expect(r.min).toBeLessThanOrEqual(0);
    expect(r.max).toBeGreaterThanOrEqual(0);
  });

  it("a bump-out at the −end pulls the band's −side in by its along-span", () => {
    const L = 620, posF = DIM_POS_F_DEFAULT;
    const r = dimSlideRange({ w: L, h: 300 }, [{ sign: -1, along: 55 }], posF);
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2 + 55, 6); // clear band starts past the bump
    expect(lineAt(L, posF, r.max)).toBeCloseTo(L / 2, 6);       // +end unaffected
  });

  it("a bump-out at the +end pulls the band's +side in by its along-span", () => {
    const L = 620, posF = DIM_POS_F_DEFAULT;
    const r = dimSlideRange({ w: L, h: 300 }, [{ sign: 1, along: 80 }], posF);
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2, 6);
    expect(lineAt(L, posF, r.max)).toBeCloseTo(L / 2 - 80, 6);
  });

  it("bump-outs at BOTH ends trim both sides (the middle clear-span)", () => {
    const L = 620, posF = DIM_POS_F_DEFAULT;
    const r = dimSlideRange({ w: L, h: 300 }, [{ sign: -1, along: 55 }, { sign: 1, along: 60 }], posF);
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2 + 55, 6);
    expect(lineAt(L, posF, r.max)).toBeCloseTo(L / 2 - 60, 6);
  });

  it("two bumps at the SAME end → the larger along-span wins (their union)", () => {
    const L = 620, posF = DIM_POS_F_DEFAULT;
    const r = dimSlideRange({ w: L, h: 300 }, [{ sign: -1, along: 55 }, { sign: -1, along: 90 }], posF);
    expect(r.endNeg).toBe(90);
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2 + 90, 6);
  });

  it("a road uses the centred default fraction (0.5) and still slides edge-to-edge", () => {
    const L = 500, posF = DIM_POS_F_ROAD;
    const r = dimSlideRange({ w: L, h: 60 }, [], posF);
    expect(lineAt(L, posF, r.min)).toBeCloseTo(-L / 2, 6);
    expect(lineAt(L, posF, r.max)).toBeCloseTo(L / 2, 6);
  });

  it("pathologically huge bumps (no clear band) pin to a single midpoint, never invert", () => {
    const r = dimSlideRange({ w: 100, h: 60 }, [{ sign: -1, along: 90 }, { sign: 1, along: 90 }], DIM_POS_F_DEFAULT);
    expect(r.min).toBe(r.max); // degenerate → pinned, not min > max
  });

  it("clampDimOffset forces the perpendicular axis to 0 and clamps the slide axis", () => {
    const r = dimSlideRange({ w: 620, h: 300 }, [], DIM_POS_F_DEFAULT); // axis x
    // a legacy free-drag offset with a big perpendicular (y) component...
    const out = clampDimOffset({ x: 50, y: 140 }, r);
    expect(out.y).toBe(0);              // depth component dropped → stays on the building
    expect(out.x).toBe(50);             // within band → kept
  });

  it("clampDimOffset clamps an out-of-band slide back to the nearest edge", () => {
    const r = dimSlideRange({ w: 620, h: 300 }, [{ sign: 1, along: 80 }], DIM_POS_F_DEFAULT);
    const past = clampDimOffset({ x: 9999, y: 0 }, r);
    expect(past.x).toBeCloseTo(r.max, 6); // can't slide past the +end bump
    const before = clampDimOffset({ x: -9999, y: 0 }, r);
    expect(before.x).toBeCloseTo(r.min, 6);
  });

  it("clampDimOffset is safe on null / partial input", () => {
    const r = dimSlideRange({ w: 620, h: 300 }, [], DIM_POS_F_DEFAULT);
    expect(clampDimOffset(null, r)).toEqual({ x: 0, y: 0 });
    expect(clampDimOffset({ y: 99 }, r)).toEqual({ x: 0, y: 0 }); // x missing → 0, y dropped
  });

  it("a vertical-long building clamps the Y component and zeroes X", () => {
    const r = dimSlideRange({ w: 300, h: 620 }, [], DIM_POS_F_DEFAULT); // axis y
    const out = clampDimOffset({ x: 120, y: 40 }, r);
    expect(out.x).toBe(0);
    expect(out.y).toBe(40);
  });
});
