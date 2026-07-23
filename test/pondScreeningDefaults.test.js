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

describe("estTailwaterElevFt — PR-N/O5: the channel receiving-water level, NEVER site grade", () => {
  it("accepts a below-grade channel value", () => {
    const r = estTailwaterElevFt({ channelWseFt: 145.9, gradeFt: 153.1 });
    expect(r.valueFt).toBe(145.9);
    expect(r.source).toBe("channel");
    expect(r.estimated).toBe(true);
  });
  it("NEVER returns site grade — a value at/above grade is rejected as a placeholder (UNKNOWN)", () => {
    expect(estTailwaterElevFt({ channelWseFt: 153.1, gradeFt: 153.1 }).valueFt).toBeNull();
    expect(estTailwaterElevFt({ channelWseFt: 155, gradeFt: 153.1 }).valueFt).toBeNull();
    // no channel value at all → UNKNOWN, never the grade proxy the old version fabricated
    expect(estTailwaterElevFt({ gradeFt: 153.1 }).valueFt).toBeNull();
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
