import { describe, it, expect } from "vitest";
import { elRingFeet, elToRingFeet } from "../src/workspaces/site-planner/lib/planStyle.js";

const polyArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; a += ring[i].x * ring[j].y - ring[j].x * ring[i].y; }
  return Math.abs(a) / 2;
};

// B834581 — a real production road shape (measured, read-only SELECT against production
// site_elements): travelW 40ft, curb present, ~2,000ft centreline, whose stored w/h bounding box
// is 4974.38 x 262.92 ft (the box a road's OWN vertices happen to span, not its pavement).
const productionRoad = {
  id: "roadTest1", type: "road",
  pts: [
    { x: 0, y: 0 }, { x: 500, y: 40 }, { x: 1000, y: -20 }, { x: 1500, y: 60 }, { x: 2000, y: 0 },
  ],
  vtx: [],
  travelW: 40, curb: 1,
  // The bbox a road's own vertices happen to span — NOT its pavement footprint.
  cx: 1000, cy: 20, w: 4974.38, h: 262.92, rot: 0,
};

describe("elRingFeet — the box/points fallback (unchanged, still used by every non-road element)", () => {
  it("falls back to the w/h/rot BOUNDING BOX for anything with no `points` — including a road", () => {
    // This is the defect itself, pinned as a mutation check: elRingFeet alone has no idea a road
    // is a ~40ft-wide ribbon, not a box, because it never looks at `pts`/`travelW`.
    const ring = elRingFeet(productionRoad);
    const area = polyArea(ring);
    expect(area).toBeCloseTo(productionRoad.w * productionRoad.h, 0);
  });
});

describe("elToRingFeet — B834581: a road's TRUE pavement+curb strip, not its bounding box", () => {
  it("a road with pts + travelW returns a buffered-centreline ring, not the w/h box", () => {
    const ring = elToRingFeet(productionRoad);
    expect(Array.isArray(ring)).toBe(true);
    expect(ring.length).toBeGreaterThanOrEqual(3);
    const area = polyArea(ring);
    const bboxArea = productionRoad.w * productionRoad.h;
    // The true pavement strip must be dramatically smaller than the bounding box the old code drew
    // (measured in production: roughly 15x too much area) — assert it's at least 5x smaller as a
    // conservative floor that still fails hard against the old bbox behaviour.
    expect(area).toBeLessThan(bboxArea / 5);
    // And it should be in the right ballpark of (centreline length x pavement width), not some
    // other arbitrary small number — sanity-bound it within a generous factor for corner buffering.
    const centrelineLenFt = productionRoad.pts.reduce((sum, p, i, arr) => i === 0 ? 0 : sum + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y), 0);
    const expectedWidth = productionRoad.travelW + 2 * productionRoad.curb;
    const expectedArea = centrelineLenFt * expectedWidth;
    expect(area).toBeGreaterThan(expectedArea * 0.5);
    expect(area).toBeLessThan(expectedArea * 2);
  });

  it("a legacy 2-point road with no travelW/curb still returns a sane ring (no crash, no NaN)", () => {
    const ring = elToRingFeet({ id: "legacy", type: "road", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    expect(Array.isArray(ring)).toBe(true);
    expect(ring.length).toBeGreaterThanOrEqual(3);
    ring.forEach((p) => { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); });
  });

  it("a road with fewer than 2 pts falls back to elRingFeet (the pre-fix behaviour, untouched)", () => {
    const el = { id: "noPts", type: "road", cx: 0, cy: 0, w: 10, h: 5, rot: 0 };
    expect(elToRingFeet(el)).toEqual(elRingFeet(el));
  });

  it("every non-road element is BYTE-IDENTICAL to elRingFeet — this only changes roads", () => {
    const building = { id: "b1", type: "building", cx: 10, cy: 20, w: 40, h: 25, rot: 15 };
    expect(elToRingFeet(building)).toEqual(elRingFeet(building));
    const parcel = { id: "p1", type: "parcel", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    expect(elToRingFeet(parcel)).toEqual(elRingFeet(parcel));
  });
});
