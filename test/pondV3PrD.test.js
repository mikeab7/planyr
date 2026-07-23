// v3 PR-D — inward berm geometry (outer-toe) + function-based pond label + computed berm cap.
// Behavior lives in the pure modules (inwardBerm.test.js, pondLedger.test.js, pondChangeSummary.test.js);
// this guards the SitePlanner wiring by source scan (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("D1 — the storage recompute threads the inward model (gradeFt) into the canonical split + solver", () => {
  it("pondSplitFor passes gradeFt into usablePondVolume", () => {
    expect(src).toContain("const gradeFt = Number.isFinite(fmElev.existGradeFt) ? fmElev.existGradeFt : null;");
    expect(src).toContain("estimatePoolDepthFt: estPool, gradeFt, deadFloorFt: twDeadFloorFt })");
  });
  it("the solver is threaded gradeFt so it sizes against the same inward geometry", () => {
    // sizePondForTargets + solveTobRaise both receive gradeFt in designPond
    expect(src).toContain("targetCf: detTargetCf, maxRaiseFt, gradeFt })");
    expect(src.match(/gradeFt, detTargetCf/g) || []).not.toHaveLength(0);
  });
});

describe("D2 — rows/land-use flip to the fixed-footprint model", () => {
  it("the inspector computes the inward split (fixed footprint, shrinking water, interior berm ring)", () => {
    expect(src).toContain("const g_inward = inwardBermSplit(ring, g_bermH, { extSlope: EXT_BERM_SLOPE });");
    expect(src).toContain("const g_footprintSf = g_inward.footprintSf;");
    expect(src).toContain("const g_waterSf = g_bermH > 0 ? g_inward.waterSf : g_footprintSf;");
    expect(src).toContain("const g_bermRingSf = g_inward.bermRingSf;");
  });
  it("Land take reads the FIXED drawn footprint, not an outward ring, and drops 'incl. berm ring'", () => {
    expect(src).toContain('the fixed outer limit of disturbance. It never changes; the berm builds inward.');
    expect(src.includes("Land take <span")).toBe(false); // the old "incl. berm ring" span is gone
    expect(src.includes('g_glanceRow("Land take"')).toBe(true);
  });
  it("a Berm ring row appears when a berm exists", () => {
    expect(src).toContain('g_bermH > 0 && g_bermRingSf > 0 && g_glanceRow("Berm ring"');
  });
  it("the site-wide berm-ring area is the INWARD ring area, and the legend names water + berm inside footprint", () => {
    expect(src).toContain("const pondBermRingSf = els.reduce((s, e) => {");
    expect(src).toContain("inwardBermSplit(ring, det.tobElev - fmElev.existGradeFt, { extSlope: EXT_BERM_SLOPE }).bermRingSf");
    expect(src).toContain("ac berm (inside ${f2(pondArea / SQFT_PER_ACRE)} ac footprint)");
  });
});

describe("D3 — the berm ring is drawn INWARD, over the pond, inside the outline", () => {
  it("the layer builds the annulus from the drawn toe minus the inset crest ring", () => {
    expect(src).toContain('data-testid="pond-berm-ring-layer"');
    expect(src).toContain("const crestRings = crestRingForBerm(toe, bermH, EXT_BERM_SLOPE);");
    expect(src).toContain("const annulus = [ringPath(toe), ...crestRings.map(ringPath)].join(\" \");");
    expect(src).toContain("berm {(Math.round(bermH * 10) / 10).toFixed(1)} ft");
  });
  it("it renders AFTER the ground-surface elements pass (so it sits on top of the pond water, not under it)", () => {
    // The element pass is split at the building layer (B959); the berm ring follows the ground pass.
    const groundPass = src.indexOf("zOrder(el) < BUILDING_Z).map((el) => renderElPx(");
    const bermLayer = src.indexOf('data-testid="pond-berm-ring-layer"');
    const buildingPass = src.indexOf("zOrder(el) >= BUILDING_Z).map((el) => renderElPx(");
    expect(groundPass).toBeGreaterThan(-1);
    expect(bermLayer).toBeGreaterThan(groundPass); // over the pond (a ground surface)
    expect(buildingPass).toBeGreaterThan(bermLayer); // buildings still paint on top of it
  });
});

describe("D4 — the on-screen pond noun follows the resolved purpose at every render site", () => {
  it("the property-panel chrome header uses pondDisplayNameFor for a pond", () => {
    expect(src).toContain('selEl.type === "pond" ? pondDisplayNameFor(detWithAuto(selEl.det), pondSplitFor(selEl))');
  });
  it("the map/canvas label uses the resolved pond noun (never a hardcoded 'Detention Pond')", () => {
    expect(src).toContain("const pondName = pondDisplayNameFor(detWithAuto(el.det), pondSplitFor(el));");
    expect(src).toContain("lines = [pondName];");
    expect(src).toContain("lines = [`Existing ${pondName}`];");
    expect(src.includes('lines = ["Detention Pond"]')).toBe(false);
    expect(src.includes('lines = ["Existing Detention Pond"]')).toBe(false);
  });
  it("the Yield per-pond row label resolves the lone pond's purpose", () => {
    expect(src).toContain("label: pondCount === 1 ? pondDisplayNameFor(p.det, p) : (p.name || `Pond ${i + 1}`)");
    expect(src.includes('pondCount === 1 ? "Detention Pond"')).toBe(false);
  });
});

describe("D5 — the Max berm input is REMOVED; the cap is computed and names the binding constraint", () => {
  it("the 'Max berm (ft)' input and its user-setting plumbing are gone", () => {
    expect(src.includes('<Field label="Max berm (ft)">')).toBe(false);
    expect(src.includes("setDet({ maxBermFt:")).toBe(false);
    expect(src.includes("baseEl.det?.maxBermFt")).toBe(false);
  });
  it("designPond computes the cap as the smaller of the drainage cap and the geometric ceiling", () => {
    expect(src).toContain("const geomCapFt = geometricMaxBermFt(ringOf(baseEl), EXT_BERM_SLOPE);");
    expect(src).toContain("const drainCapFt = drainageBermCapFt({ controllingInflowElevFt, gradeAtPondFt: gradeFt, freeboardFt: bermFbFt });");
    expect(src).toContain("const { capFt: bermCapFt, binding: bermBinding } = bindingBermCap({ drainageCapFt: drainCapFt, geometricCapFt: geomCapFt });");
    // PR-K removed the FLOODWAY zero-raise cap (a floodway berm is allowed with a no-rise cert), so
    // the D5 drainage/geometric cap alone governs the rim (else the screening clamp with no grade).
    expect(src).toContain("const maxRaiseFt = gradeFt == null ? BERM_MAX_RAISE_FT");
    expect(src).toContain("(Number.isFinite(bermCapFt) ? bermCapFt : BERM_MAX_RAISE_FT);");
  });
  it("the controlling inflow grade is sampled from real per-point terrain (else the drainage cap is null)", () => {
    expect(src).toContain("if (typeof fmGradeAt !== \"function\") return null;");
    expect(src).toContain("for (const p of ringOf(baseEl)) { const g = fmGradeAt(p);");
  });
  it("a cap-bound solve routes to bermCapProposalNote with the binding constraint", () => {
    expect(src).toContain("detGapNote = bermCapProposalNote({");
    expect(src).toContain('binding: bermBinding === "drainage" ? "drainage" : "geometry",');
  });
});
