// Grading milestone (PR-N DECISION 2 + 3) — the finished-floor / earthwork balance layer.
// Pure module; synthetic monotone net functions (no engine, no DOM).
import { describe, it, expect } from "vitest";
import {
  TRUCK_CY_MIN, TRUCK_CY_MAX, truckloads, truckloadLabel,
  solveBalanceFfe, ffeDualDisplay,
} from "../src/workspaces/site-planner/lib/ffeBalance.js";

describe("DECISION 2 — the net residual in truckloads", () => {
  it("bigger loads (max CY/truck) need FEWER trucks: lo = ceil(cy/max), hi = ceil(cy/min)", () => {
    // 1400 CY: 1400/14 = 100 (lo), 1400/12 = 116.7 → 117 (hi)
    expect(truckloads(1400)).toEqual({ lo: 100, hi: 117 });
  });
  it("sign is ignored — import and export both take trucks", () => {
    expect(truckloads(-1400)).toEqual(truckloads(1400));
  });
  it("zero / non-finite volume → no trucks", () => {
    expect(truckloads(0)).toEqual({ lo: 0, hi: 0 });
    expect(truckloads(NaN)).toEqual({ lo: 0, hi: 0 });
    expect(truckloads(null)).toEqual({ lo: 0, hi: 0 });
  });
  it("a tiny non-zero volume is at least one truckload", () => {
    expect(truckloads(3)).toEqual({ lo: 1, hi: 1 });
  });
  it("the label collapses to a single count when lo === hi, else a range", () => {
    expect(truckloadLabel(3)).toBe("≈ 1 truckload");
    expect(truckloadLabel(1400)).toBe("≈ 100–117 truckloads");
    expect(truckloadLabel(0)).toBe("");
  });
  it("the CY/truck range is the documented 12–14", () => {
    expect(TRUCK_CY_MIN).toBe(12);
    expect(TRUCK_CY_MAX).toBe(14);
  });
});

describe("DECISION 3 — solveBalanceFfe never drops below the regulatory floor", () => {
  // A linear net model: 1 ft of pad raise adds `perFtCy` of fill (net rises by perFtCy).
  //   net(ffe) = netAtFloor + perFtCy * (ffe - regMin)
  const linearNet = (netAtFloor, perFtCy, regMin) => (ffe) => netAtFloor + perFtCy * (ffe - regMin);

  it("a site EXPORTING at the floor raises the pad to soak up the spoil (net → ~0)", () => {
    const regMin = 150;
    // Exports 1000 CY at the floor; each foot of raise adds 500 CY of fill → balance at +2 ft.
    const sol = solveBalanceFfe({ netAtFfe: linearNet(-1000, 500, regMin), regMinFfeFt: regMin });
    expect(sol.balanceRaiseFt).toBeCloseTo(2, 1);
    expect(sol.ffeFt).toBeCloseTo(152, 1);
    expect(sol.achieved).toBe(true);
    expect(sol.clamped).toBe(null);
    expect(sol.ffeFt).toBeGreaterThanOrEqual(regMin); // NEVER below the floor
  });

  it("a site that already IMPORTS at the floor makes NO raise (raising only imports more)", () => {
    const regMin = 150;
    const sol = solveBalanceFfe({ netAtFfe: linearNet(+800, 500, regMin), regMinFfeFt: regMin });
    expect(sol.balanceRaiseFt).toBe(0);
    expect(sol.ffeFt).toBe(150);
    expect(sol.clamped).toBe("imports-at-floor");
    expect(sol.achieved).toBe(false);
  });

  it("a site already BALANCED at the floor makes no raise and reports achieved", () => {
    const regMin = 150;
    const sol = solveBalanceFfe({ netAtFfe: linearNet(0, 500, regMin), regMinFfeFt: regMin });
    expect(sol.balanceRaiseFt).toBe(0);
    expect(sol.achieved).toBe(true);
    expect(sol.clamped).toBe(null);
  });

  it("when even the max raise can't close the export, it clamps at the cap and reports partial", () => {
    const regMin = 150;
    // Exports 100000 CY, only 500 CY/ft of raise, cap 8 ft → 4000 CY closed, still exports.
    const sol = solveBalanceFfe({ netAtFfe: linearNet(-100000, 500, regMin), regMinFfeFt: regMin, maxRaiseFt: 8 });
    expect(sol.balanceRaiseFt).toBe(8);
    expect(sol.ffeFt).toBe(158);
    expect(sol.clamped).toBe("capped");
    expect(sol.achieved).toBe(false);
    expect(sol.netCy).toBeLessThan(0); // still exporting after the capped raise
  });

  it("the raise rounds to the 0.1-ft grading convention", () => {
    const regMin = 150;
    const sol = solveBalanceFfe({ netAtFfe: linearNet(-777, 500, regMin), regMinFfeFt: regMin });
    expect(sol.balanceRaiseFt).toBe(Math.round(sol.balanceRaiseFt * 10) / 10);
  });

  it("returns null on a non-priceable surface (net function yields null)", () => {
    expect(solveBalanceFfe({ netAtFfe: () => null, regMinFfeFt: 150 })).toBe(null);
    expect(solveBalanceFfe({ netAtFfe: () => 0, regMinFfeFt: NaN })).toBe(null);
    expect(solveBalanceFfe({ regMinFfeFt: 150 })).toBe(null);
  });

  it("carries the net at the floor so the UI can explain what the raise reused", () => {
    const sol = solveBalanceFfe({ netAtFfe: linearNet(-1000, 500, 150), regMinFfeFt: 150 });
    expect(sol.netAtFloorCy).toBe(-1000);
  });
});

describe("DECISION 3 — ffeDualDisplay composes the 'reg min + balance' sentence in one place", () => {
  it("with a balance raise it decomposes the floor and the uplift", () => {
    const d = ffeDualDisplay({ ffeFt: 155.6, regMinFfeFt: 154.1 });
    expect(d.hasRaise).toBe(true);
    expect(d.floorFt).toBe(154.1);
    expect(d.raiseFt).toBe(1.5);
    expect(d.full).toBe("FFE 155.6′ (code floor 154.1′ + 1.5′ for earthwork balance)");
  });
  it("at the code floor it says so, with no phantom raise", () => {
    const d = ffeDualDisplay({ ffeFt: 154.1, regMinFfeFt: 154.1 });
    expect(d.hasRaise).toBe(false);
    expect(d.raiseText).toBe("");
    expect(d.full).toBe("FFE 154.1′ (at the code floor)");
  });
  it("the dual display carries NO em dash (the panel copy rule)", () => {
    expect(ffeDualDisplay({ ffeFt: 155.6, regMinFfeFt: 154.1 }).full).not.toContain("—");
    expect(ffeDualDisplay({ ffeFt: 154.1, regMinFfeFt: 154.1 }).full).not.toContain("—");
  });
  it("a sub-0.1-ft difference is not a raise (rounding noise, not an uplift)", () => {
    const d = ffeDualDisplay({ ffeFt: 154.13, regMinFfeFt: 154.1 });
    expect(d.hasRaise).toBe(false);
  });
  it("no regulatory floor → null (nothing to decompose)", () => {
    expect(ffeDualDisplay({ ffeFt: 155, regMinFfeFt: null })).toBe(null);
    expect(ffeDualDisplay({})).toBe(null);
  });
  it("a missing effective FFE falls back to the floor (no raise)", () => {
    const d = ffeDualDisplay({ regMinFfeFt: 154.1 });
    expect(d.ffeFt).toBe(154.1);
    expect(d.hasRaise).toBe(false);
  });
});
