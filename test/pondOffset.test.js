import { describe, it, expect } from "vitest";
import { offsetInward, ringsArea, maxInwardOffset } from "../src/workspaces/site-planner/lib/pondOffset.js";

// --- helpers -------------------------------------------------------------
const segHit = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
// A ring is SIMPLE when no two non-adjacent edges cross (no spikes / bowties).
const isSimple = (r) => {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (i + 1) % n === j || (j + 1) % n === i) continue;
      if (segHit(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
  }
  return true;
};
const square = (s) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
// Sharp triangle (the screenshot's acute-corner case): a long skinny wedge.
const acuteTriangle = [{ x: 0, y: 0 }, { x: 400, y: 20 }, { x: 60, y: 120 }];

describe("offsetInward — robust inward offset (clipper-lib)", () => {
  it("a square offsets to ONE simple ring of ~the expected area, with no spikes", () => {
    const rings = offsetInward(square(200), 40);
    expect(rings.length).toBe(1);
    expect(isSimple(rings[0])).toBe(true);
    const a = ringsArea(rings);
    // ideal 120×120 = 14400; round-join corners trim a little — allow a modest band.
    expect(a).toBeGreaterThan(13500);
    expect(a).toBeLessThanOrEqual(14450);
  });

  it("area shrinks monotonically as the offset grows", () => {
    const s = square(200);
    let prev = Infinity;
    for (const d of [10, 20, 40, 70, 95]) {
      const a = ringsArea(offsetInward(s, d));
      expect(a).toBeLessThan(prev);
      prev = a;
    }
  });

  it("ACUTE-CORNER repro: every ring stays simple (no spikes), area decreases, deep offset pinches to []", () => {
    let prev = Infinity;
    for (const d of [2, 5, 10, 18]) {
      const rings = offsetInward(acuteTriangle, d);
      for (const r of rings) expect(isSimple(r)).toBe(true); // the old offsetPolygon spiked here
      const a = ringsArea(rings);
      if (rings.length) { expect(a).toBeLessThan(prev); prev = a; }
    }
    // A big enough offset must pinch the wedge off entirely — clean empty, not garbage.
    expect(offsetInward(acuteTriangle, 200)).toEqual([]);
  });

  it("a dumbbell footprint SPLITS into two rings when the neck pinches off", () => {
    // two 80-wide bulbs joined by a 20-tall neck; offsetting >10 ft severs the neck.
    const bone = [
      { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 200, y: 30 },
      { x: 200, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 80 }, { x: 200, y: 80 },
      { x: 200, y: 50 }, { x: 80, y: 50 }, { x: 80, y: 80 }, { x: 0, y: 80 },
    ];
    expect(offsetInward(bone, 6).length).toBe(1);   // neck (20 tall) still connected
    expect(offsetInward(bone, 14).length).toBe(2);  // neck severed → two pools
    for (const r of offsetInward(bone, 14)) expect(isSimple(r)).toBe(true);
  });

  it("dist <= 0 returns a copy of the ring; degenerate input returns []", () => {
    const s = square(100);
    const copy = offsetInward(s, 0);
    expect(copy.length).toBe(1);
    expect(copy[0]).not.toBe(s); // a copy, not the same array
    expect(ringsArea(copy)).toBeCloseTo(10000, 0);
    expect(offsetInward([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5)).toEqual([]); // < 3 pts
  });

  it("never throws on a self-intersecting (bowtie) footprint", () => {
    const bowtie = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(() => offsetInward(bowtie, 10)).not.toThrow();
    for (const r of offsetInward(bowtie, 10)) expect(isSimple(r)).toBe(true);
  });
});

describe("maxInwardOffset — max inscribed reach (drives feasibility)", () => {
  it("equals ~half the short side of a rectangle", () => {
    expect(maxInwardOffset(rect(200, 40))).toBeCloseTo(20, 0); // inscribed reach = 20
    expect(maxInwardOffset(square(100))).toBeCloseTo(50, 0);
  });
  it("the offset is empty just past maxInwardOffset and non-empty just before", () => {
    const r = rect(200, 40), m = maxInwardOffset(r);
    expect(offsetInward(r, m - 1).length).toBeGreaterThan(0);
    expect(offsetInward(r, m + 1).length).toBe(0);
  });
});
