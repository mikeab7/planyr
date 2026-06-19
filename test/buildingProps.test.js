import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUILDING_RULES,
  evalTier,
  normalizeRules,
  autoClearHeight,
  autoSlab,
  effectiveBuildingProps,
  fmtClearHeight,
  fmtSlab,
} from "../src/workspaces/site-planner/lib/buildingProps.js";

describe("auto clear height by sf — upper tier inclusive at each boundary (B192)", () => {
  it("under 140k → 32'", () => {
    expect(autoClearHeight(0)).toBe(32);
    expect(autoClearHeight(100000)).toBe(32);
    expect(autoClearHeight(139999)).toBe(32);
  });
  it("140k inclusive → 36'; up to <600k stays 36'", () => {
    expect(autoClearHeight(140000)).toBe(36); // boundary belongs to the UPPER tier
    expect(autoClearHeight(250000)).toBe(36); // the spec's worked example
    expect(autoClearHeight(599999)).toBe(36);
  });
  it("600k inclusive → 40'", () => {
    expect(autoClearHeight(600000)).toBe(40);
    expect(autoClearHeight(1500000)).toBe(40);
  });
});

describe("auto slab by sf (B192)", () => {
  it("under 140k → 6\"", () => {
    expect(autoSlab(0)).toBe(6);
    expect(autoSlab(139999)).toBe(6);
  });
  it("140k inclusive and above → 7\"", () => {
    expect(autoSlab(140000)).toBe(7);
    expect(autoSlab(250000)).toBe(7); // worked example
    expect(autoSlab(900000)).toBe(7);
  });
});

describe("effectiveBuildingProps — auto default + optional override (override wins)", () => {
  it("a 250,000 sf building with no override defaults to 36' / 7\"", () => {
    const p = effectiveBuildingProps({}, 250000);
    expect(p.clearHeight.value).toBe(36);
    expect(p.clearHeight.auto).toBe(36);
    expect(p.clearHeight.overridden).toBe(false);
    expect(p.slab.value).toBe(7);
    expect(p.slab.overridden).toBe(false);
  });
  it("a manual override wins and is flagged overridden", () => {
    const p = effectiveBuildingProps({ clearHeightOverride: 28, slabThicknessOverride: 8 }, 250000);
    expect(p.clearHeight.value).toBe(28);
    expect(p.clearHeight.auto).toBe(36); // auto still reported alongside
    expect(p.clearHeight.overridden).toBe(true);
    expect(p.slab.value).toBe(8);
    expect(p.slab.overridden).toBe(true);
  });
  it("with no override, auto recomputes when sf changes (the building was resized)", () => {
    const small = effectiveBuildingProps({}, 120000);
    const big = effectiveBuildingProps({}, 700000);
    expect(small.clearHeight.value).toBe(32);
    expect(big.clearHeight.value).toBe(40);
  });
  it("a non-finite/empty override reads as 'not set' (falls back to auto)", () => {
    expect(effectiveBuildingProps({ clearHeightOverride: null }, 100000).clearHeight.value).toBe(32);
    expect(effectiveBuildingProps({ clearHeightOverride: "" }, 100000).clearHeight.overridden).toBe(false);
    expect(effectiveBuildingProps({ slabThicknessOverride: NaN }, 100000).slab.overridden).toBe(false);
  });
});

describe("normalizeRules — tolerant of partial/edited input, always resolvable", () => {
  it("fills missing keys from defaults and guarantees a terminal 'and above' tier", () => {
    const r = normalizeRules({ clearHeight: [{ upTo: 200000, value: 30 }] });
    // terminal tier appended so every sf resolves
    expect(r.clearHeight[r.clearHeight.length - 1].upTo).toBe(null);
    expect(evalTier(r.clearHeight, 1e6)).toBe(30); // top echoes the last value
    expect(r.slab.length).toBe(DEFAULT_BUILDING_RULES.slab.length); // slab from defaults
  });
  it("custom thresholds drive evaluation", () => {
    const rules = { clearHeight: [{ upTo: 50000, value: 24 }, { upTo: null, value: 50 }], slab: [{ upTo: null, value: 9 }] };
    expect(autoClearHeight(40000, rules)).toBe(24);
    expect(autoClearHeight(60000, rules)).toBe(50);
    expect(autoSlab(10, rules)).toBe(9);
  });
});

describe("display formatters", () => {
  it("clear height in feet, slab in inches; null → em dash", () => {
    expect(fmtClearHeight(36)).toBe("36'");
    expect(fmtSlab(7)).toBe('7"');
    expect(fmtClearHeight(null)).toBe("—");
    expect(fmtSlab(null)).toBe("—");
  });
});
