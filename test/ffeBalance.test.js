// Grading milestone (PR-N DECISION 3) — the finished-floor / earthwork balance layer.
// Pure module; synthetic monotone net functions (no engine, no DOM). The net earthwork
// residual is reported in CY (owner preference 2026-07-24), not truckloads.
import { describe, it, expect } from "vitest";
import { solveBalanceFfe, ffeDualDisplay } from "../src/workspaces/site-planner/lib/ffeBalance.js";

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
