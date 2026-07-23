// PR-I — computed screening defaults so the pond panel never shows a blank demanding expertise.
import { describe, it, expect } from "vitest";
import {
  estDepthToWaterFt,
  estTailwaterElevFt,
  estMaxExcavDepthFt,
  poolRelevantForRole,
  REGIONAL_SEASONAL_HIGH_DTW_FT,
  DEFAULT_MAX_EXCAV_DEPTH_FT,
} from "../src/workspaces/site-planner/lib/pondScreeningDefaults.js";

describe("estDepthToWaterFt — a measured value wins, else the regional screening constant (never null)", () => {
  it("uses the measured value when present (not estimated)", () => {
    const r = estDepthToWaterFt({ measuredFt: 8 });
    expect(r.valueFt).toBe(8);
    expect(r.estimated).toBe(false);
    expect(r.source).toBe("measured");
  });
  it("falls back to the regional constant when unknown — never blank", () => {
    const r = estDepthToWaterFt({});
    expect(r.valueFt).toBe(REGIONAL_SEASONAL_HIGH_DTW_FT);
    expect(r.estimated).toBe(true);
    expect(r.source).toBe("regional-est");
  });
});

describe("estTailwaterElevFt — the flood WSE is the screening tailwater, else grade proxy", () => {
  it("uses the flood WSE when known", () => {
    const r = estTailwaterElevFt({ wseFt: 153.1, gradeFt: 150 });
    expect(r.valueFt).toBe(153.1);
    expect(r.source).toBe("flood-wse");
    expect(r.estimated).toBe(true);
  });
  it("falls back to existing grade when there's no flood WSE", () => {
    const r = estTailwaterElevFt({ wseFt: null, gradeFt: 150 });
    expect(r.valueFt).toBe(150);
    expect(r.source).toBe("grade-proxy");
  });
  it("returns null only when nothing at all is known (caller shows a labeled default)", () => {
    expect(estTailwaterElevFt({}).valueFt).toBeNull();
  });
});

describe("estMaxExcavDepthFt — default to don't-dig-below-groundwater, else the fallback screen", () => {
  it("uses the depth to water when known", () => {
    expect(estMaxExcavDepthFt({ depthToWaterFt: 6 }).valueFt).toBe(6);
  });
  it("falls back to the 12-ft screen when groundwater is unknown", () => {
    const r = estMaxExcavDepthFt({});
    expect(r.valueFt).toBe(DEFAULT_MAX_EXCAV_DEPTH_FT);
    expect(r.source).toBe("fallback");
  });
});

describe("poolRelevantForRole — permanent pool only for a WET pond (I3)", () => {
  it("is FALSE for a dry Detention pond", () => {
    expect(poolRelevantForRole("detention")).toBe(false);
  });
  it("is TRUE for a wet Mitigation / Hybrid pond", () => {
    expect(poolRelevantForRole("mitigation")).toBe(true);
    expect(poolRelevantForRole("dual")).toBe(true);
  });
});
