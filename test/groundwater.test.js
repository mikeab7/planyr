// NEW-B3 — depth-to-water combine + wet/dry pond feasibility screen. Pure.
import { describe, it, expect } from "vitest";
import { combineDepthToWater, pondGroundwaterScreen } from "../src/workspaces/site-planner/lib/groundwater.js";

describe("combineDepthToWater — two provenanced signals", () => {
  it("governing is the shallower (conservative wet case)", () => {
    const c = combineDepthToWater({ ssurgoFt: 5, twdbFt: 2, twdbWellId: "AB-01", twdbDistFt: 900 });
    expect(c.depthToWaterFt).toBe(2);
    expect(c.governing.kind).toBe("twdb");
    expect(c.signals).toHaveLength(2);
  });
  it("one signal → that one; none → null", () => {
    expect(combineDepthToWater({ ssurgoFt: 4 }).depthToWaterFt).toBe(4);
    expect(combineDepthToWater({}).depthToWaterFt).toBeNull();
  });
});

describe("pondGroundwaterScreen — wet vs dry", () => {
  it("water table above the basin floor → WET pond, pool depth + suggestion", () => {
    // grade 100, dtw 3 → water table elev 97; tob 100, depth 8 → floor 92; pool = 97-92 = 5 ft
    const s = pondGroundwaterScreen({ depthToWaterFt: 3, gradeElevFt: 100, tobElevFt: 100, pondDepthFt: 8 });
    expect(s.known).toBe(true);
    expect(s.wetPond).toBe(true);
    expect(s.poolDepthFt).toBeCloseTo(5, 1);
    expect(s.suggestedPoolElevFt).toBeCloseTo(97, 1);
    expect(s.severity).toBe("warn");
  });
  it("water table below the floor → dry pond feasible", () => {
    const s = pondGroundwaterScreen({ depthToWaterFt: 12, gradeElevFt: 100, tobElevFt: 100, pondDepthFt: 8 });
    expect(s.wetPond).toBe(false);
    expect(s.poolDepthFt).toBe(0);
    expect(s.severity).toBe("ok");
  });
  it("unknown depth → known:false, never a fabricated verdict", () => {
    expect(pondGroundwaterScreen({ depthToWaterFt: null, gradeElevFt: 100, tobElevFt: 100 }).known).toBe(false);
  });
  it("depth known but pond not anchored → known:false with the depth noted", () => {
    const s = pondGroundwaterScreen({ depthToWaterFt: 3, gradeElevFt: null, tobElevFt: null });
    expect(s.known).toBe(false);
    expect(s.waterTableDepthFt).toBe(3);
  });
});
