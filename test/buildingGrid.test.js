import { describe, it, expect } from "vitest";
import {
  GRID_DEFAULTS,
  resolveGridSettings,
  divideSpan,
  computeBuildingGrid,
  placeDockDoors,
} from "../src/workspaces/site-planner/lib/buildingGrid.js";

const sum = (a) => a.reduce((x, y) => x + y, 0);
const DEF = { ...GRID_DEFAULTS }; // 60 / 56 / 50 / band 50–58 / door 9 @ 12

describe("divideSpan — flex-to-band primary (uniform, in-band, nearest target)", () => {
  it("336 at target 56 → six uniform 56′ bays, no residual", () => {
    const r = divideSpan(336, { target: 56, min: 50, max: 58, residual: "ends" });
    expect(r.sizes).toHaveLength(6);
    r.sizes.forEach((s) => expect(s).toBeCloseTo(56, 6));
    expect(r.roles.every((x) => x === "std")).toBe(true);
    expect(sum(r.sizes)).toBeCloseTo(336, 6);
  });

  it("200 at target 50 → four uniform 50′ bays", () => {
    const r = divideSpan(200, { target: 50, min: 50, max: 58, residual: "rear" });
    expect(r.sizes).toHaveLength(4);
    r.sizes.forEach((s) => expect(s).toBeCloseTo(50, 6));
    expect(sum(r.sizes)).toBeCloseTo(200, 6);
  });

  it("picks the count whose uniform size is nearest the target when several are in-band", () => {
    // 520: n=9 → 57.8 (dev 1.8) beats n=10 → 52 (dev 4) for target 56; n=8 → 65 is out of band.
    const r = divideSpan(520, { target: 56, min: 50, max: 58, residual: "ends" });
    expect(r.sizes).toHaveLength(9);
    r.sizes.forEach((s) => expect(s).toBeCloseTo(57.78, 1));
  });

  it("every uniform bay lands inside the band", () => {
    for (const S of [300, 336, 412, 540, 777, 1000]) {
      const r = divideSpan(S, { target: 56, min: 50, max: 58, residual: "ends" });
      // primary results are uniform & in-band; only genuine fallbacks carry a flex role
      if (r.roles.every((x) => x === "std")) {
        r.sizes.forEach((s) => { expect(s).toBeGreaterThanOrEqual(50 - 1e-6); expect(s).toBeLessThanOrEqual(58 + 1e-6); });
      }
      expect(sum(r.sizes)).toBeCloseTo(S, 6);
    }
  });
});

describe("divideSpan — fallback when no in-band uniform division exists", () => {
  it("120 (no in-band division) → two flex bays, residual at the ends, sum preserved", () => {
    const r = divideSpan(120, { target: 56, min: 50, max: 58, residual: "ends" });
    expect(sum(r.sizes)).toBeCloseTo(120, 6);
    expect(r.roles[0]).toBe("flex");
    expect(r.roles[r.roles.length - 1]).toBe("flex");
  });

  it("rear residual lands in the LAST bay only", () => {
    // 120 has no in-band uniform division (2→60 over, 3→40 under) → fallback with a rear bay.
    const r = divideSpan(120, { target: 50, min: 50, max: 58, residual: "rear" });
    expect(sum(r.sizes)).toBeCloseTo(120, 6);
    expect(r.roles[r.roles.length - 1]).toBe("flex");
    expect(r.roles.slice(0, -1).every((x) => x === "std")).toBe(true);
  });

  it("center residual lands in a MIDDLE bay (cross-dock symmetry helper)", () => {
    const r = divideSpan(130, { target: 50, min: 50, max: 58, residual: "center" });
    expect(sum(r.sizes)).toBeCloseTo(130, 6);
    const flexIdx = r.roles.indexOf("flex");
    expect(flexIdx).toBeGreaterThan(-1);
    expect(flexIdx).toBeLessThan(r.roles.length); // somewhere in the middle, not forced to an end
  });

  it("short span → a single bay, no interior line", () => {
    const r = divideSpan(40, { target: 56, min: 50, max: 58, residual: "ends" });
    expect(r.sizes).toEqual([40]);
    expect(r.roles).toEqual(["std"]);
  });

  it("zero / negative → empty", () => {
    expect(divideSpan(0, { target: 56, min: 50, max: 58 }).sizes).toEqual([]);
    expect(divideSpan(-10, { target: 56, min: 50, max: 58 }).sizes).toEqual([]);
  });
});

describe("resolveGridSettings — plan defaults + per-building overrides", () => {
  it("no element / no settings → the house defaults", () => {
    const g = resolveGridSettings(null, {});
    expect(g.speedBay).toBe(60);
    expect(g.bayLengthTarget).toBe(56);
    expect(g.bayDepthTarget).toBe(50);
    expect(g.bayMin).toBe(50);
    expect(g.bayMax).toBe(58);
    expect(g.doorWidth).toBe(9);
    expect(g.doorOC).toBe(12);
  });

  it("plan settings override the defaults", () => {
    const g = resolveGridSettings(null, { speedBay: 70, bayLengthTarget: 52 });
    expect(g.speedBay).toBe(70);
    expect(g.bayLengthTarget).toBe(52);
    expect(g.overrides.speedBay).toBe(false); // a PLAN value is not a per-building pin
  });

  it("per-building override wins over the plan default and flags overridden", () => {
    const g = resolveGridSettings({ speedBayOverride: 65, doorOCOverride: 14 }, { speedBay: 60, doorOC: 12 });
    expect(g.speedBay).toBe(65);
    expect(g.doorOC).toBe(14);
    expect(g.overrides.speedBay).toBe(true);
    expect(g.overrides.doorOC).toBe(true);
    expect(g.overrides.bayLengthTarget).toBe(false);
  });

  it("tolerates a swapped band (min > max)", () => {
    const g = resolveGridSettings(null, { bayMin: 58, bayMax: 50 });
    expect(g.bayMin).toBe(50);
    expect(g.bayMax).toBe(58);
  });
});

describe("computeBuildingGrid — single-load", () => {
  const grid = resolveGridSettings(null, {});
  const r = computeBuildingGrid({ length: 336, depth: 260, dock: "single", grid });

  it("places the speed-bay line 60′ off the dock face", () => {
    const speed = r.depthLines.filter((l) => l.role === "speed");
    expect(speed).toHaveLength(1);
    expect(speed[0].at).toBeCloseTo(60, 6);
  });

  it("interior depth bays flex toward the depth target (50′ here, exact)", () => {
    expect(r.depthBays[0]).toBeCloseTo(60, 6); // speed bay
    r.depthBays.slice(1).forEach((s) => expect(s).toBeCloseTo(50, 6));
    expect(sum(r.depthBays)).toBeCloseTo(260, 6);
  });

  it("length bays flex toward the length target (56′ here, exact) — independent of depth", () => {
    expect(r.lengthBays).toHaveLength(6);
    r.lengthBays.forEach((s) => expect(s).toBeCloseTo(56, 6));
    expect(r.summary.lengthTyp).toBe(56);
    expect(r.summary.depthTyp).toBe(50); // different target → different result, as intended
  });

  it("summary reports the bay counts + speed bay", () => {
    expect(r.summary.lengthCount).toBe(6);
    expect(r.summary.depthCount).toBe(5);
    expect(r.summary.speedBay).toBe(60);
  });
});

describe("computeBuildingGrid — cross-dock symmetry", () => {
  const grid = resolveGridSettings(null, {});
  const r = computeBuildingGrid({ length: 336, depth: 320, dock: "cross", grid });

  it("mirrors a speed bay to BOTH dock walls", () => {
    const speed = r.depthLines.filter((l) => l.role === "speed").map((l) => l.at);
    expect(speed).toHaveLength(2);
    expect(speed[0]).toBeCloseTo(60, 6);
    expect(speed[1]).toBeCloseTo(320 - 60, 6); // symmetric about the centre
  });

  it("first and last depth bays are the speed bays; middle flexes to target", () => {
    expect(r.depthBays[0]).toBeCloseTo(60, 6);
    expect(r.depthBays[r.depthBays.length - 1]).toBeCloseTo(60, 6);
    expect(sum(r.depthBays)).toBeCloseTo(320, 6);
  });

  it("degrades to a single speed bay when too shallow for two (D < 2·speedBay + band)", () => {
    const shallow = computeBuildingGrid({ length: 336, depth: 150, dock: "cross", grid });
    const speed = shallow.depthLines.filter((l) => l.role === "speed").map((l) => l.at);
    expect(speed).toHaveLength(1); // guard fell back to one speed bay
    expect(speed[0]).toBeCloseTo(60, 6);
  });
});

describe("computeBuildingGrid — no docks & degenerate guards", () => {
  const grid = resolveGridSettings(null, {});

  it("dock 'none' → uniform grid both directions, NO speed bay", () => {
    const r = computeBuildingGrid({ length: 150, depth: 100, dock: "none", grid });
    expect(r.depthLines.some((l) => l.role === "speed")).toBe(false);
    expect(r.summary.speedBay).toBe(null);
    expect(sum(r.lengthBays)).toBeCloseTo(150, 6);
    expect(sum(r.depthBays)).toBeCloseTo(100, 6);
  });

  it("depth shallower than the speed bay → no interior depth lines", () => {
    const r = computeBuildingGrid({ length: 200, depth: 50, dock: "single", grid });
    expect(r.depthLines).toHaveLength(0);
    expect(r.depthBays).toEqual([50]);
  });

  it("empty / invalid footprint → empty grid", () => {
    expect(computeBuildingGrid({ length: 0, depth: 100, dock: "single", grid }).summary).toBe(null);
    expect(computeBuildingGrid({ length: null, depth: 100, dock: "single", grid }).lengthLines).toEqual([]);
  });
});

describe("placeDockDoors — doors fall BETWEEN columns, count tracks o.c.", () => {
  const grid = resolveGridSettings(null, {});
  const r = computeBuildingGrid({ length: 336, depth: 260, dock: "single", grid });
  const lines = r.lengthLines.map((l) => l.at);

  it("no door leaf straddles a column line", () => {
    const doors = placeDockDoors(0, 336, lines, { doorOC: 12, doorWidth: 9 });
    expect(doors.length).toBeGreaterThan(0);
    for (const c of doors) {
      for (const L of lines) {
        // the leaf is doorWidth wide centred on c; its edge must not cross the column line
        expect(Math.abs(c - L)).toBeGreaterThanOrEqual(9 / 2 - 1e-6);
      }
    }
  });

  it("every door sits within the wall span", () => {
    const doors = placeDockDoors(0, 336, lines, { doorOC: 12, doorWidth: 9 });
    for (const c of doors) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(336); }
  });

  it("wider o.c. yields fewer doors in the same bay", () => {
    const at12 = placeDockDoors(0, 60, [], { doorOC: 12, doorWidth: 9 });
    const at14 = placeDockDoors(0, 60, [], { doorOC: 14, doorWidth: 9 });
    expect(at14.length).toBeLessThan(at12.length);
  });

  it("a stretch with no room for a leaf places no doors", () => {
    expect(placeDockDoors(0, 5, [], { doorOC: 12, doorWidth: 9 })).toEqual([]);
  });
});

describe("robustness — review-found edge cases (B568/B569)", () => {
  it("an out-of-band bay target never produces a negative or off-building bay", () => {
    // The reported repro: a per-building target BELOW the band (20 with band 50–58).
    for (const target of [10, 20, 200]) {
      for (const residual of ["ends", "rear", "center"]) {
        for (const S of [90, 120, 150, 300, 777]) {
          const r = divideSpan(S, { target, min: 50, max: 58, residual });
          expect(sum(r.sizes)).toBeCloseTo(S, 6);
          r.sizes.forEach((s) => expect(s).toBeGreaterThan(-1e-6)); // no negative bays
          // interior column lines all land strictly inside (0, S)
          let acc = 0;
          for (let i = 0; i < r.sizes.length - 1; i++) { acc += r.sizes[i]; expect(acc).toBeGreaterThan(0); expect(acc).toBeLessThan(S); }
        }
      }
    }
  });

  it("resolveGridSettings clamps the bay targets into the flex band", () => {
    const lo = resolveGridSettings({ bayLengthOverride: 20, bayDepthOverride: 5 }, { bayMin: 50, bayMax: 58 });
    expect(lo.bayLengthTarget).toBe(50);
    expect(lo.bayDepthTarget).toBe(50);
    const hi = resolveGridSettings({ bayLengthOverride: 90 }, { bayMin: 50, bayMax: 58 });
    expect(hi.bayLengthTarget).toBe(58);
    const inBand = resolveGridSettings(null, { bayLengthTarget: 54, bayMin: 50, bayMax: 58 });
    expect(inBand.bayLengthTarget).toBe(54); // untouched when already in band
  });

  it("computeBuildingGrid with an out-of-band override yields only valid on-building lines", () => {
    const grid = resolveGridSettings({ bayDepthOverride: 20 }, { bayMin: 50, bayMax: 58 });
    const r = computeBuildingGrid({ length: 300, depth: 150, dock: "single", grid });
    r.depthBays.forEach((s) => expect(s).toBeGreaterThan(-1e-6));
    r.depthLines.forEach((l) => { expect(l.at).toBeGreaterThan(0); expect(l.at).toBeLessThan(150); });
    r.lengthLines.forEach((l) => { expect(l.at).toBeGreaterThan(0); expect(l.at).toBeLessThan(300); });
    expect(sum(r.depthBays)).toBeCloseTo(150, 6);
  });

  it("divideSpan never throws or emits NaN when the band is omitted (exported-API safety)", () => {
    expect(() => divideSpan(300)).not.toThrow();
    expect(() => divideSpan(300, { target: 56 })).not.toThrow();
    for (const r of [divideSpan(300), divideSpan(300, { target: 56 }), divideSpan(1000, {})]) {
      expect(r.sizes.length).toBeGreaterThan(0);
      r.sizes.forEach((s) => expect(Number.isFinite(s)).toBe(true));
    }
  });

  it("tolerates a swapped band passed directly to divideSpan", () => {
    const r = divideSpan(336, { target: 56, min: 58, max: 50 });
    expect(sum(r.sizes)).toBeCloseTo(336, 6);
    r.sizes.forEach((s) => expect(Number.isFinite(s)).toBe(true));
  });
});
