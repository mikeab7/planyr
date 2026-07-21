import { describe, it, expect } from "vitest";
import {
  pointInRing, addedAreaLabelPoint,
  excavationVolume, incrementalExcavationCf, estimateFootprintSf, detentionLandTakeEstimate,
  pondPlacementCandidates, bermAsFillHeight, bermFillVolume,
} from "../src/workspaces/site-planner/lib/pondGeom.js";
import { offsetOutward } from "../src/workspaces/site-planner/lib/pondOffset.js";

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

describe("pondPlacementCandidates (B909) — screening grid for auto-placing a pond", () => {
  it("returns divisions² candidate points, all inside the bounding box", () => {
    const pts = pondPlacementCandidates({ minX: 0, minY: 0, maxX: 1000, maxY: 500, divisions: 4 });
    expect(pts.length).toBe(16);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(1000);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(500);
    }
  });

  it("orders candidates nearest-to-center first", () => {
    const pts = pondPlacementCandidates({ minX: 0, minY: 0, maxX: 1000, maxY: 1000, divisions: 5 });
    const cx = 500, cy = 500;
    const distances = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] - 1e-9);
  });

  it("defaults to a 5×5 grid when divisions is omitted", () => {
    expect(pondPlacementCandidates({ minX: 0, minY: 0, maxX: 100, maxY: 100 }).length).toBe(25);
  });

  it("degenerate / inverted bounding boxes return no candidates rather than throwing", () => {
    expect(pondPlacementCandidates({ minX: 100, minY: 0, maxX: 0, maxY: 100 })).toEqual([]);
    expect(pondPlacementCandidates({ minX: 0, minY: 0, maxX: 0, maxY: 100 })).toEqual([]);
    expect(pondPlacementCandidates({})).toEqual([]);
    expect(pondPlacementCandidates({ minX: 0, minY: 0, maxX: 100, maxY: 100, divisions: 0 })).toEqual([]);
  });
});

// B833's berm-as-fill ring — load-bearing for B909 round 3/4 (owner spec): "a berm is NOT
// a footprint expansion — it's a derived ring around the drawn boundary computed from
// berm height and configured side slopes. Example: berm up 3 ft at 3:1 slopes both sides
// -> roughly an extra ~6-12 ft apron around the pond edge." These functions predate this
// session but had no direct unit coverage — closing that gap since Design pond's
// elevation-only solve now leans on them more heavily.
describe("Berm ring geometry (B833) — ring width = berm height × outer side slope", () => {
  it("bermAsFillHeight: TOB above grade is the fill height; at/below grade (within the 0.25ft survey tolerance) is null — no berm", () => {
    expect(bermAsFillHeight({ tobElev: 104 }, 100)).toBe(4);
    expect(bermAsFillHeight({ tobElev: 100 }, 100)).toBeNull();
    expect(bermAsFillHeight({ tobElev: 99 }, 100)).toBeNull();
    expect(bermAsFillHeight({ tobElev: 100.1 }, 100)).toBeNull();
    expect(bermAsFillHeight({ tobElev: 100.3 }, 100)).toBeCloseTo(0.3, 6);
  });

  it("offsetOutward by height×slope reproduces the owner's own worked example (3ft @ 3:1 -> a 9ft-wide ring)", () => {
    const ring = rect(0, 0, 100, 100);
    const heightFt = 3, slope = 3;
    const toeReach = heightFt * slope; // 9 ft
    const [toeRing] = offsetOutward(ring, toeReach);
    expect(Math.min(...toeRing.map((p) => p.x))).toBeCloseTo(-toeReach, 3);
    expect(Math.max(...toeRing.map((p) => p.x))).toBeCloseTo(100 + toeReach, 3);
    expect(Math.min(...toeRing.map((p) => p.y))).toBeCloseTo(-toeReach, 3);
    expect(Math.max(...toeRing.map((p) => p.y))).toBeCloseTo(100 + toeReach, 3);
  });

  it("a steeper (4:1) slope widens the ring proportionally — the same height, more apron", () => {
    const ring = rect(0, 0, 100, 100);
    const heightFt = 3;
    const [ring3] = offsetOutward(ring, heightFt * 3);
    const [ring4] = offsetOutward(ring, heightFt * 4);
    const widthAt = (r) => Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x));
    expect(widthAt(ring4)).toBeGreaterThan(widthAt(ring3));
    expect(widthAt(ring4) - widthAt(ring3)).toBeCloseTo(2 * heightFt * (4 - 3), 3); // both sides widen
  });

  it("bermFillVolume: perimeter × height² × slope / 2 — the triangular-cross-section screening formula", () => {
    const ring = rect(0, 0, 100, 200); // perimeter 600
    const vol = bermFillVolume(ring, 4, 3);
    expect(vol).toBeCloseTo(600 * 4 * 4 * 3 / 2, 6);
  });

  it("no height / no ring / no slope -> null, never a fabricated volume", () => {
    expect(bermFillVolume(null, 4, 3)).toBeNull();
    expect(bermFillVolume(rect(0, 0, 10, 10), 0, 3)).toBeNull();
    expect(bermFillVolume(rect(0, 0, 10, 10), 4, 0)).toBeNull();
  });
});
