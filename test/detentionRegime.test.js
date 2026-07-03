// B632 — hydraulic regime detection (flowline- vs floodplain/tailwater-governed)
// + the B634 tier-2 outfall screen + Regime-B dead storage. Pure.
import { describe, it, expect } from "vitest";
import {
  assessHydraulicRegime,
  screenOutfall,
  deadStoragePoolDepthFt,
} from "../src/workspaces/site-planner/lib/detentionRules.js";

describe("assessHydraulicRegime", () => {
  it("no SFHA → Regime A (flowline-governed), with the coverage-consequence sentence", () => {
    const r = assessHydraulicRegime({ floodZones: [{ zone: "X" }], groundElevFt: 100, pondDepthFt: 8 });
    expect(r.regime).toBe("A");
    expect(r.consequence).toMatch(/deep outfall could reduce/i);
  });

  it("BFE within pond depth of grade → Regime B, datum-tagged reasons + wet-bottom warning", () => {
    // Grade 100, depth 8 → basin floor 92; BFE 95 sits 3 ft ABOVE the floor.
    const r = assessHydraulicRegime({
      floodZones: [{ zone: "AE", staticBfeFt: 95, vdatum: "NAVD88" }],
      groundElevFt: 100,
      pondDepthFt: 8,
    });
    expect(r.regime).toBe("B");
    expect(r.reasons.join(" ")).toMatch(/NAVD88/); // every elevation datum-tagged
    expect(r.consequence).toMatch(/will not reduce detention/i);
    expect(r.wetBottomWarning).toBe(true); // permanent pool below static WS stores nothing
    expect(r.elevations).toMatchObject({ bfeFt: 95, bfeDatum: "NAVD88", groundFt: 100, marginFt: -3 });
  });

  it("BFE safely below the basin floor → Regime A with the margin stated", () => {
    const r = assessHydraulicRegime({
      floodZones: [{ zone: "AE", staticBfeFt: 88, vdatum: "NAVD88" }],
      groundElevFt: 100,
      pondDepthFt: 8,
    });
    expect(r.regime).toBe("A");
    expect(r.elevations.marginFt).toBeCloseTo(4, 1);
    expect(r.reasons.join(" ")).toMatch(/4\.0 ft below/);
  });

  it("Zone A (floodplain, no published BFE) → the exact honest-unknown string — never a guess", () => {
    const r = assessHydraulicRegime({ floodZones: [{ zone: "A", staticBfeFt: null }], groundElevFt: 100 });
    expect(r.regime).toBe("unknown");
    expect(r.reasons).toContain("regime unknown — floodplain present but no published BFE");
    expect(r.flags).toContain("no-published-bfe");
  });

  it("the NFHL -9999 sentinel is treated as no-BFE, not an elevation", () => {
    const r = assessHydraulicRegime({ floodZones: [{ zone: "A", staticBfeFt: -9999 }], groundElevFt: 100 });
    expect(r.regime).toBe("unknown");
    expect(r.flags).toContain("no-published-bfe");
  });

  it("a BFE WITHOUT a vertical datum is rejected (flagged), not compared", () => {
    const r = assessHydraulicRegime({
      floodZones: [{ zone: "AE", staticBfeFt: 95, vdatum: null }],
      groundElevFt: 100,
      pondDepthFt: 8,
    });
    expect(r.regime).toBe("unknown");
    expect(r.flags).toContain("bfe-datum-unpublished");
  });

  it("BFE published but ground not sampled yet → honest unknown with the next step", () => {
    const r = assessHydraulicRegime({ floodZones: [{ zone: "AE", staticBfeFt: 95, vdatum: "NAVD88" }], groundElevFt: null });
    expect(r.regime).toBe("unknown");
    expect(r.flags).toContain("ground-elevation-missing");
    expect(r.elevations.bfeFt).toBe(95);
  });

  it("the WORST (highest) BFE on a multi-zone site governs", () => {
    const r = assessHydraulicRegime({
      floodZones: [
        { zone: "AE", staticBfeFt: 90, vdatum: "NAVD88" },
        { zone: "AE", staticBfeFt: 96, vdatum: "NAVD88" },
      ],
      groundElevFt: 100,
      pondDepthFt: 8,
    });
    expect(r.regime).toBe("B");
    expect(r.elevations.bfeFt).toBe(96);
  });
});

describe("screenOutfall — the B634 tier-2 LiDAR slice (value-of-information, never auto-credited)", () => {
  const channel = { near: true, unitNo: "K100-00-00", name: "CYPRESS CREEK", distFt: 120 };
  it("no channel adjacency → nothing to screen", () => {
    expect(screenOutfall({ channel: { near: false } })).toBeNull();
    expect(screenOutfall({ channel: null })).toBeNull();
  });
  it("adjacent channel, unsourced depth → names what to pull, flagged outfall-unsourced", () => {
    const s = screenOutfall({ channel });
    expect(s.headline).toMatch(/K100-00-00/);
    expect(s.detail).toMatch(/HEC-RAS|LiDAR/);
    expect(s.flags).toContain("outfall-unsourced");
  });
  it("with a LiDAR ditch profile → sourced screening line, still demands the WSEL confirm", () => {
    const s = screenOutfall({ channel, ditch: { invertFt: 88.2, bankFt: 96.5, depthFt: 8.3 }, siteGradeFt: 100 });
    expect(s.headline).toMatch(/88\.2 ft NAVD88/);
    expect(s.headline).toMatch(/11\.8 ft below site grade/);
    expect(s.detail).toMatch(/not the design-storm water surface/i);
    expect(s.flags).toContain("lidar-screening");
  });
});

describe("deadStoragePoolDepthFt — Regime-B permanent pool", () => {
  it("pool depth = BFE above basin floor, clamped to the usable column", () => {
    // Grade 100, depth 8 → floor 92; BFE 95 → 3 ft of dead pool.
    expect(deadStoragePoolDepthFt({ bfeFt: 95, groundElevFt: 100, depthFt: 8, freeboardFt: 1 })).toBe(3);
    // BFE at grade → pool 8, clamped to depth − freeboard = 7.
    expect(deadStoragePoolDepthFt({ bfeFt: 100, groundElevFt: 100, depthFt: 8, freeboardFt: 1 })).toBe(7);
    // BFE below the floor → no dead pool.
    expect(deadStoragePoolDepthFt({ bfeFt: 88, groundElevFt: 100, depthFt: 8, freeboardFt: 1 })).toBe(0);
  });
  it("missing elevations → null — the caller must REFUSE to solve, never fabricate", () => {
    expect(deadStoragePoolDepthFt({ bfeFt: null, groundElevFt: 100 })).toBeNull();
    expect(deadStoragePoolDepthFt({ bfeFt: 95, groundElevFt: null })).toBeNull();
  });
});
