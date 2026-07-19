import { describe, it, expect } from "vitest";
import {
  pointInRing, addedAreaLabelPoint,
  excavationVolume, incrementalExcavationCf, estimateFootprintSf, detentionLandTakeEstimate,
} from "../src/workspaces/site-planner/lib/pondGeom.js";

// Helper: a rectangle ring from corner (x0,y0) to (x1,y1).
const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

describe("pondGeom — added-detention label placement (B157)", () => {
  it("pointInRing: even-odd inside/outside", () => {
    const r = rect(0, 0, 100, 100);
    expect(pointInRing({ x: 50, y: 50 }, r)).toBe(true);
    expect(pointInRing({ x: 150, y: 50 }, r)).toBe(false);
    expect(pointInRing({ x: -1, y: 50 }, r)).toBe(false);
  });

  it("one-sided expansion: label lands ON the new strip, not in the old pond", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(0, 0, 160, 100); // pushed the right bank out 60 ft
    const p = addedAreaLabelPoint(expanded, baseline);
    expect(p).not.toBeNull();
    // Inside the new ground, never inside the existing basin.
    expect(pointInRing(p, expanded)).toBe(true);
    expect(pointInRing(p, baseline)).toBe(false);
    // The strip is x∈[100,160]; the deepest point sits near its middle.
    expect(p.x).toBeGreaterThan(100);
    expect(p.x).toBeLessThan(160);
  });

  it("uniform all-sides expansion: label sits in the new RING, NOT the old pond's centroid", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(-40, -40, 140, 140); // banks pushed out ~40 ft all around
    const p = addedAreaLabelPoint(expanded, baseline);
    expect(p).not.toBeNull();
    // The whole-pond centroid (50,50) is inside the OLD pond — the bug we are avoiding.
    expect(pointInRing({ x: 50, y: 50 }, baseline)).toBe(true);
    // Our point must instead be in the added ring band: outside baseline, inside expanded.
    expect(pointInRing(p, baseline)).toBe(false);
    expect(pointInRing(p, expanded)).toBe(true);
  });

  it("no expansion (expanded == baseline) → null", () => {
    const r = rect(0, 0, 100, 100);
    expect(addedAreaLabelPoint(r, r)).toBeNull();
  });

  it("pure shrink (expanded smaller, fully inside baseline) → null", () => {
    const baseline = rect(0, 0, 100, 100);
    const expanded = rect(20, 20, 80, 80);
    expect(addedAreaLabelPoint(expanded, baseline)).toBeNull();
  });

  it("degenerate / too-few-point rings → null", () => {
    expect(addedAreaLabelPoint([{ x: 0, y: 0 }, { x: 1, y: 1 }], rect(0, 0, 9, 9))).toBeNull();
    expect(addedAreaLabelPoint(rect(0, 0, 9, 9), null)).toBeNull();
  });
});

// B907 — tie detention sizing to land take + earthwork $.
describe("incrementalExcavationCf — nets an ENLARGED pond's cut against its pre-expansion baseline", () => {
  const DET = { depth: 10, freeboard: 1, slope: 3 };

  it("no baseline (a from-scratch pond) → the FULL basin cut, same as excavationVolume directly", () => {
    const ring = rect(0, 0, 200, 200);
    const r = incrementalExcavationCf(ring, DET);
    expect(r.incremental).toBe(false);
    expect(r.baselineCf).toBe(0);
    expect(r.cf).toBeCloseTo(excavationVolume(ring, DET), 3);
    expect(r.totalCf).toBeCloseTo(r.cf, 3);
  });

  it("a baseline (an ENLARGED pond) prices only the ADDED cut, less than the full re-dig", () => {
    const baselineRing = rect(0, 0, 150, 150);
    const expandedRing = rect(0, 0, 200, 200);
    const det = { ...DET, baseline: { ring: baselineRing, depth: DET.depth, freeboard: DET.freeboard, slope: DET.slope } };
    const r = incrementalExcavationCf(expandedRing, det);
    expect(r.incremental).toBe(true);
    const fullCf = excavationVolume(expandedRing, DET);
    const baselineCf = excavationVolume(baselineRing, DET);
    expect(r.totalCf).toBeCloseTo(fullCf, 3);
    expect(r.baselineCf).toBeCloseTo(baselineCf, 3);
    expect(r.cf).toBeCloseTo(fullCf - baselineCf, 3);
    expect(r.cf).toBeLessThan(fullCf); // the whole point — never re-prices the original dig
  });

  it("never goes negative even if the 'expansion' actually shrank the basin", () => {
    const baselineRing = rect(0, 0, 200, 200);
    const shrunkRing = rect(0, 0, 150, 150);
    const det = { ...DET, baseline: { ring: baselineRing, depth: DET.depth, freeboard: DET.freeboard, slope: DET.slope } };
    const r = incrementalExcavationCf(shrunkRing, det);
    expect(r.cf).toBeGreaterThanOrEqual(0);
  });

  it("a malformed baseline (too few points) is ignored — falls back to the full cut", () => {
    const ring = rect(0, 0, 200, 200);
    const det = { ...DET, baseline: { ring: [{ x: 0, y: 0 }] } };
    const r = incrementalExcavationCf(ring, det);
    expect(r.incremental).toBe(false);
    expect(r.cf).toBeCloseTo(excavationVolume(ring, DET), 3);
  });
});

describe("estimateFootprintSf — footprint ≈ volume / typical depth", () => {
  it("a known volume and depth yield the expected footprint", () => {
    expect(estimateFootprintSf({ volumeCf: 43560 * 8, avgDepthFt: 8 })).toBeCloseTo(43560, 3); // 1 ac-ft at 8 ft deep = 1 ac
  });
  it("a deeper assumed pond takes LESS footprint for the same volume", () => {
    const shallow = estimateFootprintSf({ volumeCf: 100000, avgDepthFt: 5 });
    const deep = estimateFootprintSf({ volumeCf: 100000, avgDepthFt: 10 });
    expect(deep).toBeLessThan(shallow);
  });
  it("LOUD-FAILURE: bad inputs → null", () => {
    expect(estimateFootprintSf({ volumeCf: 0, avgDepthFt: 8 })).toBeNull();
    expect(estimateFootprintSf({ volumeCf: 100, avgDepthFt: 0 })).toBeNull();
    expect(estimateFootprintSf({ volumeCf: null, avgDepthFt: 8 })).toBeNull();
  });
});

describe("detentionLandTakeEstimate — the site-level forward-looking land-take advisory", () => {
  it("a real shortfall (required > provided) estimates the additional footprint at the assumed depth", () => {
    // Required 5 ac-ft, provided 2 ac-ft → 3 ac-ft (130680 cf) short, at 8-ft assumed depth.
    const r = detentionLandTakeEstimate({ requiredAcFt: 5, providedUsableCf: 2 * 43560, avgDepthFt: 8 });
    expect(r).not.toBeNull();
    expect(r.deficitAcFt).toBeCloseTo(3, 3);
    expect(r.footprintAc).toBeCloseTo(3 * 43560 / 8 / 43560, 3);
    expect(r.avgDepthFt).toBe(8);
  });

  it("no shortfall (provided already meets or exceeds required) → null, never a fabricated estimate", () => {
    expect(detentionLandTakeEstimate({ requiredAcFt: 2, providedUsableCf: 5 * 43560 })).toBeNull();
    expect(detentionLandTakeEstimate({ requiredAcFt: 2, providedUsableCf: 2 * 43560 })).toBeNull(); // exactly met
  });

  it("LOUD-FAILURE: missing required/provided → null", () => {
    expect(detentionLandTakeEstimate({ requiredAcFt: null, providedUsableCf: 1000 })).toBeNull();
    expect(detentionLandTakeEstimate({ requiredAcFt: 5, providedUsableCf: null })).toBeNull();
    expect(detentionLandTakeEstimate({ requiredAcFt: 0, providedUsableCf: 0 })).toBeNull();
  });

  it("a criteria-configurable assumed depth changes the estimated footprint", () => {
    const shallow = detentionLandTakeEstimate({ requiredAcFt: 5, providedUsableCf: 0, avgDepthFt: 4 });
    const deep = detentionLandTakeEstimate({ requiredAcFt: 5, providedUsableCf: 0, avgDepthFt: 8 });
    expect(shallow.footprintAc).toBeGreaterThan(deep.footprintAc);
  });
});
