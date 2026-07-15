// NEW-4 — the pond sizing assistant: two banded targets (below-WSE mitigation,
// above-WSE usable detention) solved on an anchored pond through the SAME
// pondGeom bands the audit rows read. Pure — no fetch, no DOM.
import { describe, it, expect } from "vitest";
import {
  sizePondForTargets,
  solveMitigationDepth,
  solveMitigationGrow,
  solveTobRaise,
  scaleRing,
} from "../src/workspaces/site-planner/lib/pondSizing.js";
import { bandedStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";

// The B708 fixture family: axis-aligned squares → exact stage areas at slope 3.
const SQ = (s = 200) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC_FT = 43560;

// A 200×200 pond anchored at TOB 100, depth 8, freeboard 1, slope 3.
// WSE 95 sits mid-column: real usable above it, real candidate below it.
const det0 = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 };

describe("solveMitigationDepth — deepen the floor for the below-WSE band", () => {
  it("already sufficient → ok at the current depth, zero added", () => {
    const b = bandedStorage(SQ(), det0, { wseFt: 95 });
    const r = solveMitigationDepth({ ring: SQ(), det: det0, wseFt: 95, targetCf: b.mitigationCandidateCf * 0.5 });
    expect(r.ok).toBe(true);
    expect(r.depthFt).toBe(8);
    expect(r.addCf).toBe(0);
  });
  it("solves a deeper floor that meets the target, half-foot convention, and verifies", () => {
    const now = bandedStorage(SQ(), det0, { wseFt: 95 }).mitigationCandidateCf;
    const target = now + 0.5 * AC_FT; // half an acre-foot more below the WSE
    const r = solveMitigationDepth({ ring: SQ(), det: det0, wseFt: 95, targetCf: target });
    expect(r.ok).toBe(true);
    expect(r.depthFt).toBeGreaterThan(8);
    expect(r.depthFt * 2).toBeCloseTo(Math.round(r.depthFt * 2), 6); // half-foot steps
    const got = bandedStorage(SQ(), { ...det0, depth: r.depthFt }, { wseFt: 95 }).mitigationCandidateCf;
    expect(got).toBeGreaterThanOrEqual(target - 1);
  });
  it("pinch-off ceiling reported honestly — never an impossible depth", () => {
    // A 60-ft square at 3:1 pinches off at 30/3 = 10 ft; ask for far more than it holds.
    const small = SQ(60);
    const d = { ...det0, depth: 8 };
    const r = solveMitigationDepth({ ring: small, det: d, wseFt: 95, targetCf: 5 * AC_FT });
    expect(r.ok).toBe(false);
    expect(r.depthFt).toBeNull();
    expect(r.maxDepthFt).toBeCloseTo(10, 1);
    expect(r.ceilingCf).toBeLessThan(5 * AC_FT);
  });
});

describe("solveMitigationGrow — footprint growth fallback", () => {
  it("scaleRing grows area by factor² about the centroid", () => {
    const g = scaleRing(SQ(100), 2);
    const w = Math.max(...g.map((p) => p.x)) - Math.min(...g.map((p) => p.x));
    expect(w).toBeCloseTo(200, 6);
  });
  it("finds the factor whose grown footprint meets the target", () => {
    const now = bandedStorage(SQ(), det0, { wseFt: 95 }).mitigationCandidateCf;
    const r = solveMitigationGrow({ ring: SQ(), det: det0, wseFt: 95, targetCf: now * 2 });
    expect(r.ok).toBe(true);
    expect(r.factor).toBeGreaterThan(1);
    expect(r.addAcres).toBeGreaterThan(0);
  });
});

describe("solveTobRaise — the above-WSE usable band", () => {
  it("solves the smallest raise (0.1-ft convention, floor held) that meets the target", () => {
    const now = bandedStorage(SQ(), det0, { wseFt: 95 }).usableCf;
    const target = now + 0.5 * AC_FT;
    const r = solveTobRaise({ ring: SQ(), det: det0, wseFt: 95, targetCf: target });
    expect(r.ok).toBe(true);
    expect(r.hFt).toBeGreaterThan(0);
    expect(Math.round(r.hFt * 10)).toBeCloseTo(r.hFt * 10, 6); // 0.1-ft build convention
    const raised = bandedStorage(SQ(), { ...det0, depth: det0.depth + r.hFt, tobElev: det0.tobElev + r.hFt }, { wseFt: 95 });
    expect(raised.usableCf).toBeGreaterThanOrEqual(target - 1);
    // floor HELD: raising TOB with depth keeps the floor elevation fixed
    expect(raised.elevations.floorElev).toBeCloseTo(92, 6);
  });
  it("clamps at the screening max and reports partial honestly", () => {
    const r = solveTobRaise({ ring: SQ(100), det: det0, wseFt: 95, targetCf: 100 * AC_FT });
    expect(r.ok).toBe(false);
    expect(r.hFt).toBe(4); // BERM_MAX_RAISE_FT
    expect(r.partial).toBe(true);
  });
});

describe("sizePondForTargets — the assistant", () => {
  it("refuses without a WSE (never designs off gross) and without an anchor", () => {
    const noWse = sizePondForTargets({ ring: SQ(), det: det0, wseFt: null, mitTargetCf: AC_FT, detTargetCf: AC_FT });
    expect(noWse.ok).toBe(false);
    expect(noWse.reason).toMatch(/WSE unknown/i);
    const noAnchor = sizePondForTargets({ ring: SQ(), det: { depth: 8 }, wseFt: 95, mitTargetCf: AC_FT });
    expect(noAnchor.ok).toBe(false);
    expect(noAnchor.reason).toMatch(/not anchored/i);
  });
  it("both bands covered → no actions, covered flags", () => {
    const r = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 95, mitTargetCf: 0.01 * AC_FT, detTargetCf: 0.01 * AC_FT });
    expect(r.ok).toBe(true);
    expect(r.mitigation.covered).toBe(true);
    expect(r.detention.covered).toBe(true);
    expect(r.actions.length).toBe(0);
  });
  it("detention short → a raise-tob action with the added volume", () => {
    const b = bandedStorage(SQ(), det0, { wseFt: 95 });
    const r = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 95, mitTargetCf: 0, detTargetCf: b.usableCf + 0.5 * AC_FT });
    expect(r.ok).toBe(true);
    expect(r.detention.covered).toBe(false);
    const tob = r.actions.find((a) => a.kind === "raise-tob");
    expect(tob).toBeTruthy();
    expect(tob.hFt).toBeGreaterThan(0);
    expect(tob.addCf).toBeGreaterThanOrEqual(0.5 * AC_FT - 1);
  });
  it("berm-as-fill feedback: an in-trigger raise folds the berm prism back into the mitigation target", () => {
    const b = bandedStorage(SQ(), det0, { wseFt: 95 });
    const args = { ring: SQ(), det: det0, wseFt: 95, detTargetCf: b.usableCf + 0.5 * AC_FT, mitTargetCf: b.mitigationCandidateCf, mitRatio: 1, gradeFt: 100 };
    const upland = sizePondForTargets({ ...args, inTrigger: false });
    const fringe = sizePondForTargets({ ...args, inTrigger: true });
    // Same berm solve, but the fringe pond's mitigation target GREW by the prism.
    const upTob = upland.actions.find((a) => a.kind === "raise-tob");
    const frTob = fringe.actions.find((a) => a.kind === "raise-tob");
    expect(upTob.bermFillBelowWseCf).toBeNull();
    // TOB 100 > WSE 95 with grade 100: the berm base sits ABOVE the WSE → no prism.
    expect(frTob.bermFillBelowWseCf).toBeNull();
    // Now sink the grade so the incremental berm truly starts below the WSE.
    const low = sizePondForTargets({ ...args, inTrigger: true, gradeFt: 93, det: { ...det0, tobElev: 94 }, wseFt: 96 });
    const lowTob = low.actions.find((a) => a.kind === "raise-tob");
    expect(lowTob).toBeTruthy();
    expect(lowTob.bermFillBelowWseCf).toBeGreaterThan(0);
    expect(low.mitigation.targetCf).toBeGreaterThan(b.mitigationCandidateCf); // folded back in
  });
  it("fully-inundated pond leads with the raise-TOB message, not a delta table", () => {
    const r = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 101, detTargetCf: AC_FT, mitTargetCf: 0 });
    expect(r.ok).toBe(true);
    expect(r.fullyInundated).toBe(true);
    expect(r.actions[0].kind).toBe("inundated");
  });
  it("mitigation target beyond the pinch-off reports the geometric ceiling + the grow fallback", () => {
    const r = sizePondForTargets({ ring: SQ(60), det: det0, wseFt: 95, mitTargetCf: 5 * AC_FT, detTargetCf: 0 });
    expect(r.ok).toBe(true);
    const pinch = r.actions.find((a) => a.kind === "pinch-off");
    expect(pinch).toBeTruthy();
    expect(pinch.label).toMatch(/can't reach the mitigation target at 3:1 slopes/);
    expect(r.actions.some((a) => a.kind === "grow" || a.kind === "grow-infeasible")).toBe(true);
  });
  it("the ESTIMATED stamp rides an est-boundary-grade WSE, and only that provider", () => {
    const est = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 95, wseProvider: "est-boundary-grade", mitTargetCf: AC_FT, detTargetCf: 0 });
    expect(est.ok).toBe(true);
    expect(est.estimated).toBe(true);
    const pub = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 95, wseProvider: "static-bfe", mitTargetCf: AC_FT, detTargetCf: 0 });
    expect(pub.estimated).toBe(false);
  });
  it("never mutates its inputs (the balancer's immutability discipline)", () => {
    const ring = Object.freeze(SQ().map((p) => Object.freeze({ ...p })));
    const det = Object.freeze({ ...det0 });
    expect(() => sizePondForTargets({ ring, det, wseFt: 95, mitTargetCf: AC_FT, detTargetCf: AC_FT, inTrigger: true, gradeFt: 99 })).not.toThrow();
  });
});
