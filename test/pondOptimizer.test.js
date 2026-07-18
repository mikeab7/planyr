// NEW-D1 — pond economics optimizer: scale-for-volume solve, candidate evaluation,
// constraint filtering (groundwater ceiling, pipeline corridors), ranking. Pure.
import { describe, it, expect } from "vitest";
import { solveScaleForVolume, evaluateCandidate, optimizePond } from "../src/workspaces/site-planner/lib/pondOptimizer.js";
import { detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";

const SQ = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
const DET = { depth: 8, freeboard: 1, slope: 3 };
const BASE_VOL = detentionStorage(SQ, 8, 1, 3).vol;
const REQ = BASE_VOL * 0.8; // holdable by the base at depth 8; deeper→smaller, shallower→bigger

describe("solveScaleForVolume", () => {
  it("finds a scale whose volume meets the target", () => {
    const s = solveScaleForVolume(SQ, DET, 8, REQ);
    expect(s).not.toBeNull();
    expect(s.achievedCf).toBeGreaterThanOrEqual(REQ - 1);
    expect(s.scale).toBeLessThanOrEqual(1.01); // 80% of base volume → footprint ≤ base
  });
  it("a very deep basin needs a smaller footprint than a shallow one for the same volume", () => {
    const deep = solveScaleForVolume(SQ, DET, 14, REQ);
    const shallow = solveScaleForVolume(SQ, DET, 6, REQ);
    expect(deep.scale).toBeLessThan(shallow.scale);
  });
  it("an unreachable target (huge volume) → null, never a fudged scale", () => {
    expect(solveScaleForVolume(SQ, DET, 8, BASE_VOL * 1000)).toBeNull();
  });
});

describe("evaluateCandidate — constraints", () => {
  it("feasible under the depth cap", () => {
    const c = evaluateCandidate({ ring: SQ, det: DET, depthFt: 8, requiredCf: REQ, maxDepthFt: 20 });
    expect(c.feasible).toBe(true);
    expect(c.landTakeAc).toBeGreaterThan(0);
    expect(c.excavationCy).toBeGreaterThan(0);
  });
  it("groundwater ceiling kills a too-deep candidate", () => {
    const c = evaluateCandidate({ ring: SQ, det: DET, depthFt: 12, requiredCf: REQ, groundwaterMaxDepthFt: 8 });
    expect(c.feasible).toBe(false);
    expect(c.reason).toMatch(/groundwater/);
  });
  it("a pipeline-corridor overlap rejects the footprint", () => {
    // a forbidden ring at the shared centroid overlaps every centroid-scaled footprint
    const corridor = [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }];
    const c = evaluateCandidate({ ring: SQ, det: DET, depthFt: 8, requiredCf: REQ, forbiddenRings: [corridor] });
    expect(c.feasible).toBe(false);
    expect(c.reason).toMatch(/pipeline|setback/);
  });
  it("prices earthwork when a unit cost is supplied", () => {
    const c = evaluateCandidate({ ring: SQ, det: DET, depthFt: 8, requiredCf: REQ, earthworkPerCy: 12 });
    expect(c.earthworkCost).toBe(Math.round(c.excavationCy * 12));
  });
});

describe("optimizePond — ranking + tags", () => {
  it("ranks alternatives; the top one recovers the most buildable SF (least land-take)", () => {
    const r = optimizePond({ baseRing: SQ, det: DET, requiredCf: REQ, costs: { earthworkPerCy: 12 }, padFillNeedCf: 50000 });
    expect(r.ok).toBe(true);
    expect(r.alternatives.length).toBeGreaterThan(1);
    // sorted by buildableSfDelta desc
    for (let i = 1; i < r.alternatives.length; i++) {
      expect(r.alternatives[i - 1].buildableSfDelta).toBeGreaterThanOrEqual(r.alternatives[i].buildableSfDelta);
    }
    expect(r.tags.bestBuildable).toBe(`${r.best.placement}:${r.best.depthFt}`);
    expect(r.tags.cheapest).not.toBeNull();
    expect(r.tags.bestBalance).not.toBeNull();
  });
  it("the deepest feasible alternative recovers buildable SF vs the base", () => {
    const r = optimizePond({ baseRing: SQ, det: DET, requiredCf: REQ });
    const deepest = r.alternatives.reduce((a, c) => (c.depthFt > a.depthFt ? c : a), r.alternatives[0]);
    expect(deepest.buildableSfDelta).toBeGreaterThan(0); // smaller land-take than the base → recovered land
  });
  it("the groundwater ceiling bounds every alternative's depth", () => {
    const r = optimizePond({ baseRing: SQ, det: DET, requiredCf: REQ, groundwaterMaxDepthFt: 8 });
    expect(r.ok).toBe(true);
    for (const a of r.alternatives) expect(a.depthFt).toBeLessThanOrEqual(8);
  });
  it("LOUD-FAILURE: no footprint / no volume / all-forbidden → ok:false with reasons", () => {
    expect(optimizePond({ baseRing: null, det: DET, requiredCf: REQ }).ok).toBe(false);
    expect(optimizePond({ baseRing: SQ, det: DET, requiredCf: 0 }).ok).toBe(false);
    const bigCorridor = [{ x: -500, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 700 }, { x: -500, y: 700 }];
    const blocked = optimizePond({ baseRing: SQ, det: DET, requiredCf: REQ, forbiddenRings: [bigCorridor] });
    expect(blocked.ok).toBe(false);
    expect(blocked.rejected.length).toBeGreaterThan(0);
  });
});
