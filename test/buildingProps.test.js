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
  addTier,
  removeTier,
  moveTier,
  maxFiniteUpTo,
} from "../src/workspaces/site-planner/lib/buildingProps.js";

describe("auto clear height by sf — upper tier inclusive at each boundary (B198)", () => {
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

describe("auto slab by sf (B198)", () => {
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
  it("a 250,000 SF building with no override defaults to 36' / 7\"", () => {
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

describe("evalTier is order-independent (NEW-1) — a Standards-panel row reorder never re-answers a size", () => {
  it("an out-of-order tier list resolves identically to its ascending equivalent", () => {
    const ascending = [{ upTo: 140000, value: 32 }, { upTo: 600000, value: 36 }, { upTo: null, value: 40 }];
    const shuffled = [{ upTo: null, value: 40 }, { upTo: 600000, value: 36 }, { upTo: 140000, value: 32 }];
    for (const sf of [0, 139999, 140000, 250000, 599999, 600000, 1500000]) {
      expect(evalTier(shuffled, sf)).toBe(evalTier(ascending, sf));
    }
  });
});

describe("Standards-panel tier CRUD — add / remove / move (NEW-1, pure)", () => {
  it("addTier appends a new tier above every existing finite boundary, carrying the terminal's value", () => {
    const next = addTier(DEFAULT_BUILDING_RULES.clearHeight);
    expect(next.length).toBe(DEFAULT_BUILDING_RULES.clearHeight.length + 1);
    const added = next[next.length - 1];
    expect(added.upTo).toBeGreaterThan(600000);
    expect(added.value).toBe(40); // the terminal's current value
    // every sf still resolves
    expect(evalTier(next, 1e9)).not.toBeNull();
  });
  it("addTier never collides with an existing boundary", () => {
    const tiers = [{ upTo: 100000, value: 10 }, { upTo: null, value: 20 }];
    const next = addTier(tiers);
    const upTos = next.map((t) => t.upTo);
    expect(new Set(upTos).size).toBe(upTos.length);
  });
  it("removeTier never drops below one tier", () => {
    const one = [{ upTo: null, value: 5 }];
    expect(removeTier(one, 0)).toEqual(one);
  });
  it("removeTier promotes the highest remaining boundary to terminal when the terminal itself is removed", () => {
    const tiers = [{ upTo: 100000, value: 10 }, { upTo: 200000, value: 20 }, { upTo: null, value: 30 }];
    const next = removeTier(tiers, 2); // remove the terminal
    expect(next.some((t) => t.upTo == null)).toBe(true);
    expect(next.find((t) => t.upTo == null).value).toBe(20); // the 200k tier was promoted
    expect(evalTier(next, 1e9)).toBe(20); // every sf still resolves
  });
  it("removeTier on a middle tier leaves the terminal alone", () => {
    const tiers = [{ upTo: 100000, value: 10 }, { upTo: 200000, value: 20 }, { upTo: null, value: 30 }];
    const next = removeTier(tiers, 0);
    expect(next).toEqual([{ upTo: 200000, value: 20 }, { upTo: null, value: 30 }]);
  });
  it("moveTier swaps adjacent rows and never changes evaluated results (order-independent)", () => {
    const tiers = DEFAULT_BUILDING_RULES.clearHeight;
    const moved = moveTier(tiers, 0, 1);
    expect(moved[0]).toEqual(tiers[1]);
    expect(moved[1]).toEqual(tiers[0]);
    for (const sf of [0, 140000, 250000, 600000, 900000]) expect(evalTier(moved, sf)).toBe(evalTier(tiers, sf));
  });
  it("moveTier is a no-op past either end", () => {
    const tiers = DEFAULT_BUILDING_RULES.clearHeight;
    expect(moveTier(tiers, 0, -1)).toEqual(normalizeRules({ clearHeight: tiers }).clearHeight);
    expect(moveTier(tiers, tiers.length - 1, 1)).toEqual(normalizeRules({ clearHeight: tiers }).clearHeight);
  });
});

describe("maxFiniteUpTo — the terminal row's own label reads this, not array position (NEW-1)", () => {
  it("finds the largest finite boundary regardless of order", () => {
    expect(maxFiniteUpTo(DEFAULT_BUILDING_RULES.clearHeight)).toBe(600000);
    expect(maxFiniteUpTo([{ upTo: null, value: 1 }, { upTo: 50, value: 2 }, { upTo: 900, value: 3 }])).toBe(900);
  });
  it("null when there is no finite tier", () => {
    expect(maxFiniteUpTo([{ upTo: null, value: 1 }])).toBeNull();
    expect(maxFiniteUpTo([])).toBeNull();
  });
});
