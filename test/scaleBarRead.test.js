import { describe, it, expect } from "vitest";
import { readScaleBar, clusterBars, ticksNearBar, tickLinearity } from "../src/shared/files/scaleBarRead.js";

// A canonical engineer's scale bar 200 px long representing 40 ft: ticks 0/20/40 with a FEET unit.
// (Two 100px boxes = a filled + open box, the common alternating pattern.)
function scaleBarFixture({ x0 = 100, y = 500, len = 200, real = 40, unit = "FEET" } = {}) {
  const segments = [
    { x1: x0, y1: y, x2: x0 + len / 2, y2: y },            // filled box top edge
    { x1: x0 + len / 2, y1: y, x2: x0 + len, y2: y },      // open box top edge
  ];
  const labels = [
    { str: "0", x: x0 - 4, y: y + 8, w: 8, h: 10 },
    { str: String(real / 2), x: x0 + len / 2 - 8, y: y + 8, w: 16, h: 10 },
    { str: String(real), x: x0 + len - 10, y: y + 8, w: 20, h: 10 },
    { str: unit, x: x0 + len + 12, y: y + 8, w: 40, h: 10 },
  ];
  return { segments, labels };
}

describe("readScaleBar — feet-per-unit from a drawn scale bar (B340 tail #1)", () => {
  it("reads a clean 200px = 40ft feet ruler → 0.2 ft/unit", () => {
    const r = readScaleBar(scaleBarFixture());
    expect(r.present).toBe(true);
    expect(r.drawnLenPx).toBeCloseTo(200, 5);
    expect(r.realLenFt).toBe(40);
    expect(r.feetPerUnit).toBeCloseTo(0.2, 6); // 40 / 200
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("rejects a metric bar (we calibrate in feet only) — fail open", () => {
    const r = readScaleBar(scaleBarFixture({ unit: "METERS" }));
    expect(r.present).toBe(false);
  });

  it("returns present:false when there's no bar-like geometry", () => {
    // A few short, scattered, non-collinear marks — nothing that spans a bar.
    const segments = [{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 200, y1: 400, x2: 205, y2: 400 }];
    expect(readScaleBar({ segments, labels: [] }).present).toBe(false);
  });

  it("rejects a bar with numbers but no feet keyword AND too few ticks (not confident)", () => {
    const { segments } = scaleBarFixture();
    const labels = [{ str: "40", x: 290, y: 508, w: 20, h: 10 }]; // one lone number, no unit
    expect(readScaleBar({ segments, labels }).present).toBe(false);
  });

  it("still reads a bar with ≥3 linear numeric ticks even without an explicit unit word", () => {
    const { segments } = scaleBarFixture();
    const labels = [
      { str: "0", x: 96, y: 508, w: 8, h: 10 },
      { str: "20", x: 192, y: 508, w: 16, h: 10 },
      { str: "40", x: 290, y: 508, w: 20, h: 10 },
    ];
    const r = readScaleBar({ segments, labels }, { requireFeet: true });
    expect(r.present).toBe(true);
    expect(r.feetPerUnit).toBeCloseTo(0.2, 6);
  });
});

describe("clusterBars / ticksNearBar / tickLinearity — the engine's parts", () => {
  it("merges alternating bar boxes into one contiguous span", () => {
    const { segments } = scaleBarFixture({ x0: 0, len: 200 });
    const bars = clusterBars(segments);
    expect(bars[0].len).toBeCloseTo(200, 5);
    expect(bars[0].count).toBe(2);
  });

  it("ignores vertical linework and short stray marks", () => {
    const segments = [
      { x1: 0, y1: 0, x2: 0, y2: 300 },     // vertical
      { x1: 10, y1: 10, x2: 13, y2: 10 },   // tiny
    ];
    expect(clusterBars(segments)).toHaveLength(0);
  });

  it("scores a uniform ruler as highly linear and a jumbled one as not", () => {
    const uniform = [{ value: 0, x: 0 }, { value: 20, x: 100 }, { value: 40, x: 200 }];
    const jumbled = [{ value: 0, x: 0 }, { value: 20, x: 30 }, { value: 40, x: 200 }];
    expect(tickLinearity(uniform)).toBeGreaterThan(0.9);
    expect(tickLinearity(jumbled)).toBeLessThan(0.6);
  });

  it("flags a feet unit keyword near the bar and a metric one", () => {
    const bar = { x0: 100, x1: 300, y: 500, len: 200 };
    expect(ticksNearBar([{ str: "FEET", x: 315, y: 508, w: 40, h: 10 }], bar).feet).toBe(true);
    expect(ticksNearBar([{ str: "METERS", x: 315, y: 508, w: 40, h: 10 }], bar).metric).toBe(true);
  });
});
