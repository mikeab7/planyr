// v3 D1 — INWARD berm geometry (outer-toe model). The drawn polygon is the FIXED outer toe;
// raising the rim builds the berm INWARD so the water surface + storage shrink (diminishing
// returns) up to a geometric ceiling where the footprint pinches closed. Pure; no browser.
import { describe, it, expect } from "vitest";
import {
  geometricMaxBermFt, crestRingForBerm, crestTopRing, bermPinched,
  bermWaterAreaSf, bermRingAreaSf, inwardBermSplit, EXT_BERM_SLOPE,
  drainageBermCapFt, bindingBermCap, INFLOW_HEAD_ALLOWANCE_FT,
} from "../src/workspaces/site-planner/lib/inwardBerm.js";
import { usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { polyArea } from "../src/workspaces/site-planner/lib/polygonSplit.js";
import { offsetInward, ringsArea } from "../src/workspaces/site-planner/lib/pondOffset.js";

const AF = 43560;
const square = (s) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
// An irregular (L-ish) polygon to prove the invariants aren't square-only.
const irregular = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 120 }, { x: 140, y: 120 }, { x: 140, y: 260 }, { x: 0, y: 260 }];

describe("D1 — water surface SHRINKS as the berm rises (fixed footprint)", () => {
  for (const [name, ring] of [["square 400 ft", square(400)], ["irregular polygon", irregular]]) {
    it(`${name}: water area strictly decreases with berm height`, () => {
      const a0 = bermWaterAreaSf(ring, 0);
      const a2 = bermWaterAreaSf(ring, 2);
      const a5 = bermWaterAreaSf(ring, 5);
      expect(a0).toBeCloseTo(polyArea(ring), 0); // no berm → the full drawn footprint
      expect(a2).toBeLessThan(a0);
      expect(a5).toBeLessThan(a2);
    });

    it(`${name}: water + berm ring always sum to the fixed drawn footprint`, () => {
      const foot = polyArea(ring);
      for (const h of [0, 1, 3, 6]) {
        const split = inwardBermSplit(ring, h);
        expect(split.footprintSf).toBeCloseTo(foot, 0);
        expect(split.waterSf + split.bermRingSf).toBeCloseTo(foot, 0);
      }
    });

    it(`${name}: the berm ring GROWS as the water shrinks`, () => {
      expect(bermRingAreaSf(ring, 4)).toBeGreaterThan(bermRingAreaSf(ring, 1));
    });
  }
});

describe("D1 — geometric ceiling: the footprint pinches closed", () => {
  it("the ceiling equals the toe's max inward offset over the exterior slope", () => {
    const ring = square(400);
    const hmax = geometricMaxBermFt(ring, EXT_BERM_SLOPE);
    // a 400-ft square inscribes ~200 ft; /3 exterior slope ≈ 66 ft
    expect(hmax).toBeGreaterThan(50);
    expect(hmax).toBeLessThan(80);
  });

  it("just below the ceiling the crest ring exists; just above it, it has pinched to nothing", () => {
    const ring = square(400);
    const hmax = geometricMaxBermFt(ring);
    expect(crestRingForBerm(ring, hmax * 0.9).length).toBeGreaterThan(0);
    expect(bermPinched(ring, hmax * 0.9)).toBe(false);
    expect(crestRingForBerm(ring, hmax * 1.1).length).toBe(0);
    expect(bermPinched(ring, hmax * 1.1)).toBe(true);
    expect(crestTopRing(ring, hmax * 1.1)).toBeNull();
  });
});

describe("D1 — the storage integrates on the inward solid, not a straight prism", () => {
  const ring = square(400); // 160,000 sf toe
  const gradeFt = 100, wseFt = 100;
  const det = { depth: 8, freeboard: 1, slope: 3, tobElev: 104 }; // rim 4 ft above grade

  it("a bermed pond holds LESS usable than the same rim computed as an outward/straight prism", () => {
    const inward = usablePondVolume(ring, det, { wseFt, gradeFt });     // crest ring (inset)
    const prism = usablePondVolume(ring, det, { wseFt, gradeFt: null }); // drawn ring (no inset)
    expect(inward.usableCf).toBeGreaterThan(0);
    expect(inward.usableCf).toBeLessThan(prism.usableCf); // the inward taper removes storage
  });

  it("above-flood volume is within tolerance of a hand-computed frustum on the crest", () => {
    const crest = crestTopRing(ring, det.tobElev - gradeFt); // effective top-of-bank
    const waterSurfElev = det.tobElev - det.freeboard; // 103
    // average-end-area frustum between the flood WSE (100) and the design water surface (103),
    // areas taken with the SAME inward-offset primitive the integrator uses.
    const areaAtElev = (e) => ringsArea(offsetInward(crest, det.slope * (det.tobElev - e)));
    const aTop = areaAtElev(waterSurfElev), aBot = areaAtElev(wseFt);
    const handFrustumCf = ((aTop + aBot) / 2) * (waterSurfElev - wseFt);
    const inward = usablePondVolume(ring, det, { wseFt, gradeFt });
    expect(inward.usableCf).toBeGreaterThan(0);
    expect(Math.abs(inward.usableCf - handFrustumCf) / handFrustumCf).toBeLessThan(0.12);
  });

  it("a rim at or below grade is unchanged from the classic (drawn-ring) model", () => {
    const atGrade = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }; // rim == grade
    const withGrade = usablePondVolume(ring, atGrade, { wseFt: 98, gradeFt });
    const noGrade = usablePondVolume(ring, atGrade, { wseFt: 98, gradeFt: null });
    expect(withGrade.usableCf).toBeCloseTo(noGrade.usableCf, 5);
  });

  it("a berm past the geometric ceiling closes the pond → zero usable, never negative", () => {
    const hmax = geometricMaxBermFt(ring);
    const closed = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: gradeFt + hmax * 1.2 }, { wseFt, gradeFt });
    expect(closed.usableCf).toBe(0);
    expect(closed.closed).toBe(true);
  });
});

describe("D5 — the COMPUTED berm cap (drainage cap vs geometric ceiling)", () => {
  it("the drainage cap = (controlling grade − inflow head + freeboard) − pond grade", () => {
    // controlling grade 105, head 0.5, freeboard 1, pond grade 100 → max rim 105.5, cap 5.5
    const cap = drainageBermCapFt({ controllingInflowElevFt: 105, gradeAtPondFt: 100, freeboardFt: 1 });
    expect(cap).toBeCloseTo(105 - INFLOW_HEAD_ALLOWANCE_FT + 1 - 100, 6);
    expect(cap).toBeCloseTo(5.5, 6);
  });

  it("an unknown controlling grade (no terrain) → null (drainage cap not binding)", () => {
    expect(drainageBermCapFt({ controllingInflowElevFt: null, gradeAtPondFt: 100 })).toBeNull();
    expect(drainageBermCapFt({ controllingInflowElevFt: 105, gradeAtPondFt: null })).toBeNull();
  });

  it("bindingBermCap picks the SMALLER of drainage cap and geometric ceiling and names the binding one", () => {
    expect(bindingBermCap({ drainageCapFt: 3, geometricCapFt: 6 })).toEqual({ capFt: 3, binding: "drainage" });
    expect(bindingBermCap({ drainageCapFt: 8, geometricCapFt: 5 })).toEqual({ capFt: 5, binding: "geometry" });
  });

  it("no drainage cap (no terrain) → geometry alone binds", () => {
    expect(bindingBermCap({ drainageCapFt: null, geometricCapFt: 6.4 })).toEqual({ capFt: 6.4, binding: "geometry" });
  });

  it("the solver never exceeds min(drainage cap, geometric ceiling)", () => {
    const ring = square(400);
    const geo = geometricMaxBermFt(ring);
    const drain = drainageBermCapFt({ controllingInflowElevFt: 102, gradeAtPondFt: 100, freeboardFt: 1 }); // 102−0.5+1−100 = 2.5
    const { capFt } = bindingBermCap({ drainageCapFt: drain, geometricCapFt: geo });
    expect(capFt).toBeLessThanOrEqual(geo);
    expect(capFt).toBeLessThanOrEqual(drain);
    expect(capFt).toBeCloseTo(2.5, 6); // drainage binds well below the ~66 ft geometric ceiling
  });
});
