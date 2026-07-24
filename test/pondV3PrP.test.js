// v3 grading milestone (PR-P) — the balance-optimal FFE float (DECISION 3) + the net
// residual in truckloads (DECISION 2). Behavior lives in the pure module
// (ffeBalance.test.js); this guards the SitePlanner wiring by source scan (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("DECISION 3 — the finished floor floats off the regulatory code minimum, never below", () => {
  it("imports the pure ffeBalance layer", () => {
    expect(src).toContain('import { solveBalanceFfe, truckloadLabel, ffeDualDisplay } from "./lib/ffeBalance.js";');
  });
  it("fmEffectivePadFt folds the balance uplift onto the AUTO code floor (manual pad still wins)", () => {
    expect(src).toContain("const fmBalanceRaiseFt = fmManualPadFt == null && Number.isFinite(gradingSettings.ffeBalanceRaiseFt) && gradingSettings.ffeBalanceRaiseFt > 0");
    expect(src).toContain("const fmEffectivePadFt = fmManualPadFt != null");
    expect(src).toContain("(fmAutoFfeFt != null ? Math.round((fmAutoFfeFt + fmBalanceRaiseFt) * 100) / 100 : null)");
    // the regulatory floor (fmAutoFfeFt) itself is NOT inflated — the code verdict measures the true min
    expect(src).toContain("const fmAutoFfeFt = fmAutoFfe && Number.isFinite(fmAutoFfe.requiredFfeFt) ? fmAutoFfe.requiredFfeFt : null;");
  });
  it("a dedicated grid rebuild sweeps the FLOOR (not the paving field) for the solver", () => {
    expect(src).toContain("const gsBuildAtFfe = (ffe) => {");
    expect(src).toContain("buildProposedSurface({ ...gsInputs, ffeFt: ffe })");
  });
  it("⚖ Raise FFE to balance solves against the regulatory floor and stores the uplift", () => {
    expect(src).toContain("const sol = solveBalanceFfe({ netAtFfe, regMinFfeFt: fmAutoFfeFt });");
    expect(src).toContain("setGrading({ ffeBalanceRaiseFt: sol.balanceRaiseFt })");
    expect(src).toContain(">⚖ Raise FFE to balance</button>");
    // reset returns the pad to the code minimum
    expect(src).toContain("setGrading({ ffeBalanceRaiseFt: null })");
    expect(src).toContain(">× Reset floor to code min</button>");
  });
  it("the dual FFE readout (floor + balance uplift) renders from ffeDualDisplay", () => {
    expect(src).toContain("const ffeDual = ffeDualDisplay({ ffeFt: fmEffectivePadFt, regMinFfeFt: fmAutoFfeFt });");
    expect(src).toContain("{ffeDual.full}");
  });
});

describe("DECISION 2 — the net earthwork residual is reported in truckloads", () => {
  it("the net-dirt row carries a truckload haul count off the residual CY", () => {
    expect(src).toContain("const netHaulLabel = netCy != null ? truckloadLabel(Math.round(netCy)) : \"\";");
    expect(src).toContain("${netHaulLabel ? netHaulLabel + \" · \" : \"\"}");
  });
});
