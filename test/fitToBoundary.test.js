import { describe, it, expect } from "vitest";
import { fitToBoundary, CONFIDENT_FRAC } from "../src/shared/placement/fitToBoundary.js";

// Apply a known similarity (scale, rotation°, translation) to a ring — to synthesize a
// "drawing" from a "surveyed" boundary and check the solver recovers the inverse.
function transformRing(ring, { scale = 1, rotDeg = 0, tx = 0, ty = 0 } = {}) {
  const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ring.map((p) => ({ x: tx + scale * (c * p.x - s * p.y), y: ty + scale * (s * p.x + c * p.y) }));
}

// A simple L-shaped parcel in world feet (distinct corners → unambiguous correspondence).
const PARCEL = [
  { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 120 },
  { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 0, y: 240 },
];

describe("fitToBoundary — rung-2 similarity fit (B182/NEW-3)", () => {
  it("recovers an exact scale+rotation+translation (equal vertex counts)", () => {
    // The 'drawing' is the parcel shrunk, rotated, and shifted (e.g. sheet units).
    const drawing = transformRing(PARCEL, { scale: 0.01, rotDeg: 37, tx: 50, ty: -20 });
    const r = fitToBoundary(drawing, PARCEL);
    expect(r.ok).toBe(true);
    expect(r.method).toBe("correspondence");
    expect(r.confident).toBe(true);
    expect(r.residual).toBeLessThan(1e-6);
    // Inverse of the synthesized 0.01 scale.
    expect(r.transform.scale).toBeCloseTo(100, 3);
    // Every drawn vertex lands on its surveyed corner.
    for (let i = 0; i < drawing.length; i++) {
      const got = r.transform.apply(drawing[i]);
      expect(got.x).toBeCloseTo(PARCEL[i].x, 4);
      expect(got.y).toBeCloseTo(PARCEL[i].y, 4);
    }
  });

  it("matches even when the drawing ring starts at a different corner and runs the other way", () => {
    const rotated = transformRing(PARCEL, { scale: 2, rotDeg: -110, tx: 10, ty: 99 });
    // Reverse the winding and start three corners along.
    const reversed = rotated.slice().reverse();
    const shifted = reversed.slice(3).concat(reversed.slice(0, 3));
    const r = fitToBoundary(shifted, PARCEL);
    expect(r.ok).toBe(true);
    expect(r.confident).toBe(true);
    expect(r.residual).toBeLessThan(1e-6);
  });

  it("tolerates a closing duplicate vertex on either ring", () => {
    const drawing = transformRing(PARCEL, { scale: 0.5, rotDeg: 5 });
    const r = fitToBoundary([...drawing, drawing[0]], [...PARCEL, PARCEL[0]]);
    expect(r.ok).toBe(true);
    expect(r.confident).toBe(true);
  });

  it("flags a distorted (non-rigid) drawing with a high residual fraction, still ok", () => {
    const drawing = transformRing(PARCEL, { scale: 0.01, rotDeg: 20 });
    // Stretch one axis only — no single similarity can fit this.
    const skewed = drawing.map((p) => ({ x: p.x * 1.4, y: p.y }));
    const r = fitToBoundary(skewed, PARCEL);
    expect(r.ok).toBe(true);
    expect(r.confident).toBe(false);
    expect(r.residualFrac).toBeGreaterThan(CONFIDENT_FRAC);
    expect(r.reason).toMatch(/distorted|landing error/i);
  });

  it("falls back to the OBB path when vertex counts differ, giving a sane placement", () => {
    const drawing = transformRing(PARCEL, { scale: 0.02, rotDeg: 15, tx: 3, ty: 7 });
    // Densify one edge so the counts no longer match.
    const dense = [];
    for (let i = 0; i < drawing.length; i++) {
      const a = drawing[i], b = drawing[(i + 1) % drawing.length];
      dense.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const r = fitToBoundary(dense, PARCEL);
    expect(r.ok).toBe(true);
    expect(r.method).toBe("obb");
    // Centroid + area + orientation should land it roughly on the parcel.
    expect(r.residualFrac).toBeLessThan(0.25);
    expect(r.reason).toMatch(/orientation|differ/i);
  });

  it("rejects rings with fewer than 3 vertices", () => {
    const r = fitToBoundary([{ x: 0, y: 0 }, { x: 1, y: 1 }], PARCEL);
    expect(r.ok).toBe(false);
    expect(r.transform).toBeNull();
    expect(r.reason).toMatch(/3 boundary vertices/i);
  });

  it("falls to OBB when the correspondence search would exceed maxVertices", () => {
    // 8-vertex rings but a tiny cap forces the fallback path deterministically.
    const oct = [];
    for (let i = 0; i < 8; i++) oct.push({ x: 100 * Math.cos((i / 8) * 2 * Math.PI), y: 100 * Math.sin((i / 8) * 2 * Math.PI) });
    const drawing = transformRing(oct, { scale: 0.5, rotDeg: 0 });
    const r = fitToBoundary(drawing, oct, { maxVertices: 4 });
    expect(r.ok).toBe(true);
    expect(r.method).toBe("obb");
  });
});
