import { describe, it, expect } from "vitest";
import {
  insunitsToFeet, insertMatrix, matMul, matApply,
  bulgeArcPoints, dxfArcPoints, arcPoints, ellipsePoints, IDENTITY,
} from "../src/workspaces/site-planner/lib/dxf/dxfGeom.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("insunitsToFeet — $INSUNITS → feet per drawing unit (B747)", () => {
  it("recognises the civil/architectural units exactly", () => {
    expect(insunitsToFeet(2)).toEqual({ ftPerUnit: 1, known: true, label: "feet" });
    expect(insunitsToFeet(1).ftPerUnit).toBeCloseTo(1 / 12, 12);
    expect(insunitsToFeet(4).ftPerUnit).toBeCloseTo(1 / 304.8, 12);   // mm
    expect(insunitsToFeet(6).ftPerUnit).toBeCloseTo(3.280839895, 9);  // meters
    expect(insunitsToFeet(10).ftPerUnit).toBe(3);                     // yards
    expect(insunitsToFeet(1).known).toBe(true);
  });
  it("flags unitless (0) / absent / exotic codes as assumed feet (never a silent guess)", () => {
    expect(insunitsToFeet(0)).toEqual({ ftPerUnit: 1, known: false, label: "unitless" });
    expect(insunitsToFeet(undefined).known).toBe(false);
    expect(insunitsToFeet(99).known).toBe(false);
    expect(insunitsToFeet(99).ftPerUnit).toBe(1); // assume feet
  });
});

describe("affine transforms", () => {
  it("identity leaves a point unchanged", () => {
    expect(matApply(IDENTITY, 3, 5)).toEqual({ x: 3, y: 5 });
  });
  it("insertMatrix composes translate · rotate(deg) · scale", () => {
    const m = insertMatrix({ position: { x: 10, y: 20 }, xScale: 2, yScale: 2, rotation: 90 });
    const p = matApply(m, 1, 0); // (1,0) scaled ×2 → (2,0), rotated 90° CCW → (0,2), +translate → (10,22)
    expect(near(p.x, 10)).toBe(true);
    expect(near(p.y, 22)).toBe(true);
  });
  it("defaults xScale/yScale/rotation sanely", () => {
    const m = insertMatrix({ position: { x: 5, y: 7 } });
    expect(matApply(m, 0, 0)).toEqual({ x: 5, y: 7 });
  });
  it("matMul applies the right-hand transform first", () => {
    const t = [1, 0, 0, 1, 3, 4];          // translate(3,4)
    const s = [2, 0, 0, 2, 0, 0];          // scale 2
    const p = matApply(matMul(t, s), 1, 1); // scale then translate → (2,2)+(3,4) = (5,6)
    expect(p).toEqual({ x: 5, y: 6 });
  });
});

describe("bulge-arc flattening", () => {
  it("bulge=1 is a semicircle: points ride a unit circle, dip below, and end exactly on p1", () => {
    const pts = bulgeArcPoints({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    for (const p of pts) expect(near(Math.hypot(p.x - 1, p.y - 0), 1, 1e-6)).toBe(true); // radius 1 about (1,0)
    const last = pts[pts.length - 1];
    expect(near(last.x, 2)).toBe(true);
    expect(near(last.y, 0)).toBe(true);
    expect(pts.some((p) => p.y < -0.5)).toBe(true); // +bulge (CCW) dips below the chord
  });
  it("bulge=-1 mirrors above the chord", () => {
    const pts = bulgeArcPoints({ x: 0, y: 0 }, { x: 2, y: 0 }, -1);
    expect(pts.some((p) => p.y > 0.5)).toBe(true);
    expect(near(pts[pts.length - 1].x, 2)).toBe(true);
  });
  it("a zero / degenerate bulge is a straight segment (just the endpoint)", () => {
    expect(bulgeArcPoints({ x: 0, y: 0 }, { x: 4, y: 0 }, 0)).toEqual([{ x: 4, y: 0 }]);
  });
});

describe("arc / circle / ellipse flattening", () => {
  it("a DXF arc sweeps CCW start→end and normalises a wrapped sweep", () => {
    const q = dxfArcPoints(0, 0, 10, 0, Math.PI / 2); // quarter circle
    expect(near(q[0].x, 10) && near(q[0].y, 0)).toBe(true);
    const end = q[q.length - 1];
    expect(near(end.x, 0, 1e-6) && near(end.y, 10, 1e-6)).toBe(true);
    for (const p of q) expect(near(Math.hypot(p.x, p.y), 10, 1e-6)).toBe(true);
  });
  it("a full circle closes back near the start", () => {
    const c = arcPoints(5, 5, 3, 0, 2 * Math.PI);
    expect(near(c[0].x, c[c.length - 1].x, 1e-6)).toBe(true);
    for (const p of c) expect(near(Math.hypot(p.x - 5, p.y - 5), 3, 1e-6)).toBe(true);
  });
  it("an axis-aligned ellipse respects the major/minor radii", () => {
    // major axis endpoint (10,0) from centre, ratio 0.5 → minor 5
    const e = ellipsePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, 2 * Math.PI);
    const xs = e.map((p) => p.x), ys = e.map((p) => p.y);
    expect(near(Math.max(...xs), 10, 1e-3)).toBe(true);
    expect(near(Math.max(...ys), 5, 1e-3)).toBe(true);
  });
});
