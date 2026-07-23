// v3 PR-O — pond-buildability correctness pair:
//   O1 garbled warning copy (covered by test/pondCopyLint.test.js — the copy-lint guard).
//   O2 the gravity-inflow / berm rule is UNIFIED: one shared advisory (inlets through the berm) used
//      by BOTH the design evaluator and the optimizer, so they can never disagree (was: a hard
//      "berm capped at 0.0 ft" from Optimize while the design showed only an advisory chip).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assessBuildability } from "../src/workspaces/site-planner/lib/buildableEnvelope.js";
import { bindingBermCap, bermNeedsInlets, drainageBermCapFt } from "../src/workspaces/site-planner/lib/inwardBerm.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("O2 — the design evaluator and the optimizer agree on the berm/gravity-inflow rule", () => {
  // one geometry: grade 100, drainage cap at +2.5 ft (rim 102.5), a design that berms to rim 106.
  const gradeFt = 100;
  const drainCapHFt = drainageBermCapFt({ controllingInflowElevFt: 102, gradeAtPondFt: gradeFt, freeboardFt: 1 }); // 2.5
  const drainageCapElevFt = gradeFt + drainCapHFt; // 102.5
  const rimElevFt = 106; // a 6-ft berm, above the drainage cap
  const bermHFt = rimElevFt - gradeFt;

  it("the EVALUATOR: a rim above the drainage cap is BUILDABLE with a soft inlets advisory (not a hard block)", () => {
    const r = assessBuildability({ tobElev: rimElevFt, gradeFt, drainageCapElevFt });
    expect(r.buildable).toBe(true);
    expect(r.hard.some((h) => h.code === "drainage-cap")).toBe(false);
    expect(r.soft.map((s) => s.code)).toContain("drainage-inlets");
  });

  it("the OPTIMIZER: the drainage cap does NOT bind the berm (geometry binds) and the inlet rule fires", () => {
    const { capFt, binding, drainageAdvisoryFt } = bindingBermCap({ drainageCapFt: drainCapHFt, geometricCapFt: 20 });
    expect(binding).toBe("geometry");        // the geometric ceiling binds, NOT the drainage cap
    expect(capFt).toBe(20);                   // the optimizer may berm well above the drainage cap
    expect(drainageAdvisoryFt).toBeCloseTo(drainCapHFt, 6);
    expect(bermNeedsInlets({ bermHFt, drainageCapHFt: drainageAdvisoryFt })).toBe(true);
  });

  it("AGREEMENT: for the SAME geometry both say 'berm permitted + inlets through the berm', never a hard cap", () => {
    const evalSoft = assessBuildability({ tobElev: rimElevFt, gradeFt, drainageCapElevFt }).soft.some((s) => s.code === "drainage-inlets");
    const optInlets = bermNeedsInlets({ bermHFt, drainageCapHFt: drainCapHFt });
    expect(evalSoft).toBe(optInlets); // same condition, same conclusion
    expect(evalSoft).toBe(true);
  });
});

describe("O2 — the optimizer wiring uses the shared advisory (guards against a silent revert)", () => {
  it("designPond destructures drainageAdvisoryFt and states the inlets assumption instead of a 0.0 cap", () => {
    expect(src).toContain("drainageAdvisoryFt } = bindingBermCap({ drainageCapFt: drainCapFt, geometricCapFt: geomCapFt });");
    expect(src).toContain("bermNeedsInlets({ bermHFt: finalBermH, drainageCapHFt: drainageAdvisoryFt })");
    expect(src).toContain("${INLETS_THROUGH_BERM_NOTE}");
  });
  it("the maxRaiseFt clamp is the geometric cap, NOT a drainage zero-cap", () => {
    expect(src).toContain("const maxRaiseFt = gradeFt == null ? BERM_MAX_RAISE_FT");
    expect(src.includes('binding: "drainage"')).toBe(false); // the drainage-binding path is gone
  });
});
