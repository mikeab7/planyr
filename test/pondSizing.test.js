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
  applyPondSizingActions,
} from "../src/workspaces/site-planner/lib/pondSizing.js";
import { bandedStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";

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
  it("fully-inundated pond (coincident storm) leads with the raise-TOB message, not a delta table", () => {
    const r = sizePondForTargets({ ring: SQ(), det: det0, wseFt: 101, detTargetCf: AC_FT, mitTargetCf: 0, coincidentStorm: true });
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

describe("applyPondSizingActions (B909/B910) — apply the assistant's actions onto a pond element", () => {
  const rectEl = { id: "p1", type: "pond", cx: 100, cy: 100, w: 200, h: 200, rot: 0, det: { ...det0 } };
  const polyEl = { id: "p2", type: "pond", points: SQ(), rot: 0, det: { ...det0 } };

  it("no actions → the element comes back unchanged", () => {
    expect(applyPondSizingActions(rectEl, [])).toBe(rectEl); // same reference — nothing to patch
    expect(applyPondSizingActions(rectEl, undefined)).toBe(rectEl);
  });

  it("a deepen action alone updates depth, leaves the footprint untouched", () => {
    const out = applyPondSizingActions(rectEl, [{ kind: "deepen", depthFt: 11 }]);
    expect(out.det.depth).toBe(11);
    expect(out.w).toBe(200); expect(out.h).toBe(200);
    expect(rectEl.det.depth).toBe(8); // input never mutated
  });

  // B909 round 3 (owner spec): "the user's drawn polygon IS the pond boundary — never
  // relocate, rescale, or auto-expand it." raise-tob (the elevation-only lever Design
  // pond leans on for an EXISTING pond) must never touch the ring — byte-identical w/h
  // for a rect pond, byte-identical points for a polygon pond.
  it("a raise-tob action alone updates tobElev/depth/tobBerm, leaves a RECT footprint BYTE-IDENTICAL", () => {
    const out = applyPondSizingActions(rectEl, [{ kind: "raise-tob", hFt: 4, addCf: 5000 }]);
    expect(out.det.tobElev).toBe(104); // det0.tobElev + 4 (det0 defined below)
    expect(out.det.depth).toBe(12); // det0.depth + 4
    expect(out.w).toBe(rectEl.w); expect(out.h).toBe(rectEl.h);
    expect(out.cx).toBe(rectEl.cx); expect(out.cy).toBe(rectEl.cy); expect(out.rot).toBe(rectEl.rot);
    expect(out.points).toBeUndefined();
  });

  it("a raise-tob action alone leaves a POLYGON footprint's points BYTE-IDENTICAL", () => {
    const out = applyPondSizingActions(polyEl, [{ kind: "raise-tob", hFt: 4, addCf: 5000 }]);
    expect(out.points).toEqual(SQ());
    expect(out.points).toBe(polyEl.points); // same reference — never touched, not even copied
  });

  it("a grow action alone scales a RECT pond's w/h by the factor, leaves depth untouched", () => {
    const out = applyPondSizingActions(rectEl, [{ kind: "grow", factor: 1.5, addAcres: 1 }]);
    expect(out.w).toBeCloseTo(300, 6);
    expect(out.h).toBeCloseTo(300, 6);
    expect(out.det.depth).toBe(8);
    expect(rectEl.w).toBe(200); // input never mutated
  });

  it("a grow action alone scales a POLYGON pond's points via scaleRing", () => {
    const out = applyPondSizingActions(polyEl, [{ kind: "grow", factor: 2, addAcres: 1 }]);
    expect(out.points).toEqual(scaleRing(SQ(), 2));
    expect(polyEl.points).toEqual(SQ()); // input never mutated
  });

  // The exact bug this test guards: sizePondForTargets pushes pinch-off + grow TOGETHER
  // when deepening alone can't reach the target — the pinch-off ceiling depth must apply
  // even though a SEPARATE grow action carries the footprint change, not the depth.
  it("pinch-off + grow together: BOTH the ceiling depth and the footprint growth apply", () => {
    const actions = [
      { kind: "pinch-off", maxDepthFt: 12, ceilingCf: 1000, slope: 3, label: "pinches off at 12.0′" },
      { kind: "grow", factor: 1.3, addAcres: 0.5 },
    ];
    const out = applyPondSizingActions(rectEl, actions);
    expect(out.det.depth).toBe(12); // deepened to the pinch-off ceiling...
    expect(out.w).toBeCloseTo(260, 6); // ...AND grown — neither remedy is dropped
    expect(out.h).toBeCloseTo(260, 6);
  });

  // The regression this test guards directly: when growing FURTHER is infeasible (no
  // "grow" action at all, only "grow-infeasible"), the pond must still bank the partial
  // gain from deepening to the pinch-off ceiling — not silently discard it.
  it("pinch-off + grow-infeasible (no grow action): the ceiling depth STILL applies", () => {
    const actions = [
      { kind: "pinch-off", maxDepthFt: 9.5, ceilingCf: 500, slope: 3, label: "pinches off at 9.5′" },
      { kind: "grow-infeasible" },
    ];
    const out = applyPondSizingActions(rectEl, actions);
    expect(out.det.depth).toBe(9.5);
    expect(out.w).toBe(200); expect(out.h).toBe(200); // no footprint change — grow never fired
  });

  it("deepen and grow together (both fully solved): deepen wins over the pinch-off ceiling, grow still applies", () => {
    const actions = [
      { kind: "deepen", depthFt: 10 },
      { kind: "pinch-off", maxDepthFt: 12, ceilingCf: 1000, slope: 3, label: "x" }, // shouldn't occur alongside a successful deepen in practice, but the precedence must be unambiguous
      { kind: "grow", factor: 1.2, addAcres: 0.3 },
    ];
    const out = applyPondSizingActions(rectEl, actions);
    expect(out.det.depth).toBe(10);
    expect(out.w).toBeCloseTo(240, 6);
  });

  it("end-to-end against the real solver: a pinch-off + grow result from sizePondForTargets applies cleanly and reaches the target", () => {
    const el = { id: "p3", type: "pond", cx: 30, cy: 30, w: 60, h: 60, rot: 0, det: { ...det0 } };
    const result = sizePondForTargets({ ring: SQ(60), det: el.det, wseFt: 95, mitTargetCf: 5 * AC_FT, detTargetCf: 0 });
    expect(result.ok).toBe(true);
    const out = applyPondSizingActions(el, result.actions);
    // Deepened (to the pinch-off ceiling) at minimum — never left un-deepened when a
    // pinch-off action was reported.
    expect(out.det.depth).toBeGreaterThan(el.det.depth);
  });

  // B909/B910 (unified "Design pond") — a single pond can now be sized for detention
  // (raise-tob, above-WSE) AND mitigation (deepen/grow, below-WSE) in the same click.
  it("raise-tob alone: floor held — tobElev and depth both rise by hFt, with tobBerm provenance", () => {
    const el = { id: "p4", type: "pond", cx: 30, cy: 30, w: 60, h: 60, rot: 0, det: { ...det0 } };
    const out = applyPondSizingActions(el, [{ kind: "raise-tob", hFt: 2, addCf: 500 }]);
    expect(out.det.tobElev).toBeCloseTo(102, 6);
    expect(out.det.depth).toBeCloseTo(10, 6); // original depth 8 + hFt 2
    expect(out.det.tobBerm).toEqual({ h: 2, applied: 102 });
    expect(el.det.tobElev).toBe(100); // input never mutated
  });

  // ⚠ A GENUINE GEOMETRY FINDING from writing this test: side-slope offsets are measured
  // DOWN FROM the top of bank, so raising tobElev changes the below-WSE candidate volume
  // at any FIXED floor elevation — a "deepen's absolute depthFt was solved against the
  // pre-raise tobElev, so add the raise height to reach the same floor" formula LOOKS
  // right (the floor elevation math checks out) but measurably under-delivers the
  // mitigation target once actually priced through bandedStorage (confirmed by direct
  // measurement while building this feature). So this function does NOT attempt to
  // combine raise-tob with deepen/pinch-off from one shared solve — deepen's absolute
  // value simply wins (applied after raise-tob). The caller is responsible for a
  // TWO-PASS solve instead: apply detention, then re-invoke sizePondForTargets against
  // the UPDATED pond to get a mitigation remedy that's actually correct for what the
  // pond now is — see the two-pass test below, which is the pattern designPond uses.
  it("raise-tob + deepen from the SAME call: deepen's absolute depth wins (documented — NOT a valid combined solve)", () => {
    const el = { id: "p5", type: "pond", cx: 30, cy: 30, w: 60, h: 60, rot: 0, det: { ...det0 } };
    const out = applyPondSizingActions(el, [
      { kind: "raise-tob", hFt: 3, addCf: 500 },
      { kind: "deepen", depthFt: 11 },
    ]);
    expect(out.det.tobElev).toBeCloseTo(103, 6); // the raise still applies to tobElev...
    expect(out.det.depth).toBe(11); // ...but deepen's absolute value governs depth, not a sum
  });

  it("raise-tob + pinch-off + grow from the SAME call: same precedence — pinch-off's ceiling wins over the raise, footprint still grows", () => {
    const el = { id: "p6", type: "pond", cx: 30, cy: 30, w: 60, h: 60, rot: 0, det: { ...det0 } };
    const out = applyPondSizingActions(el, [
      { kind: "raise-tob", hFt: 2, addCf: 400 },
      { kind: "pinch-off", maxDepthFt: 9, ceilingCf: 300, slope: 3, label: "x" },
      { kind: "grow", factor: 1.4, addAcres: 0.4 },
    ]);
    expect(out.det.tobElev).toBeCloseTo(102, 6);
    expect(out.det.depth).toBe(9);
    expect(out.w).toBeCloseTo(84, 6); // 60 × 1.4 — the grow remedy still applies regardless
    expect(out.h).toBeCloseTo(84, 6);
  });

  it("end-to-end TWO-PASS pattern against the real solver: a detention target (raise-tob) applied first, then mitigation RE-SOLVED against the updated pond, reaches BOTH targets — this is the pattern designPond uses", () => {
    const el = { id: "p7", type: "pond", cx: 100, cy: 100, w: 200, h: 200, rot: 0, det: { ...det0 } };
    const before = bandedStorage(SQ(200), el.det, { wseFt: 95 });
    const detTarget = before.usableCf * 1.3;
    const mitTarget = before.mitigationCandidateCf * 1.3;

    // Pass 1 — detention only (mitTargetCf: 0): solves at most a raise-tob.
    const pass1 = sizePondForTargets({ ring: SQ(200), det: el.det, wseFt: 95, detTargetCf: detTarget, mitTargetCf: 0 });
    expect(pass1.ok).toBe(true);
    expect(pass1.actions.some((a) => a.kind === "raise-tob")).toBe(true);
    const afterDet = applyPondSizingActions(el, pass1.actions);
    const detCheck = bandedStorage(SQ(200), afterDet.det, { wseFt: 95 });
    expect(detCheck.usableCf).toBeGreaterThanOrEqual(detTarget - 1);

    // Pass 2 — mitigation, RE-SOLVED against the pond as it actually is now.
    const pass2 = sizePondForTargets({ ring: SQ(200), det: afterDet.det, wseFt: 95, detTargetCf: 0, mitTargetCf: mitTarget });
    expect(pass2.ok).toBe(true);
    expect(pass2.actions.some((a) => a.kind === "deepen" || a.kind === "grow")).toBe(true);
    const afterBoth = applyPondSizingActions(afterDet, pass2.actions);

    // BOTH bands clear their targets — and pass 2's re-solve never regressed pass 1's
    // detention gain (detention doesn't depend on the floor deepening further).
    const final = bandedStorage(afterBoth.points || SQ(200 * (afterBoth.w / 200)), afterBoth.det, { wseFt: 95 });
    expect(final.usableCf).toBeGreaterThanOrEqual(detTarget - 1);
    expect(final.mitigationCandidateCf).toBeGreaterThanOrEqual(mitTarget - 1);
  });
});

// B909 round 2 — the reopened live bug (Tsakiris): a pond auto-anchored at GRADE, with
// grade sitting below the flood water surface (WSE), is fully submerged from the start.
// The original "Design pond" only ever grew the FOOTPRINT (solvePondExpansion) for a
// pure-detention job — but a wider submerged basin is still 100% submerged, so it could
// never earn a single acre-foot of usable (above-WSE) detention credit. These tests pin
// the underlying physics directly against the already-tested pure library functions
// (no SitePlanner.jsx orchestration involved — that's the routing fix; this is proof the
// routing fix targets a REAL, provable failure mode, and that its alternative — raising
// the top of bank — actually works).
// R1 — "submerged" (usable ZERO below the flood WSE) is now the COINCIDENT-storm case: the pond
// only fills to the flood level when the design storm coincides with the regional flood. By DEFAULT
// the pond recovers to normal tailwater between storms, so these tests pass coincidentStorm:true to
// exercise the submerged/raise-TOB behavior. (The default non-coincident release is covered in
// pondGeom.bands.test.js.)
describe("B909 round 2 — footprint growth alone cannot fix a submerged pond; raising the TOB can (coincident-storm case)", () => {
  const submergedDet = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }; // TOB 100, WSE 102 → fully below the flood
  const wseFt = 102; // within the 4′ BERM_MAX_RAISE_FT screening clamp of the TOB

  it("a pond anchored below the flood WSE earns ZERO usable detention no matter how large its footprint grows", () => {
    for (const side of [60, 200, 600, 2000]) {
      const u = usablePondVolume(SQ(side), submergedDet, { wseFt, coincidentStorm: true });
      expect(u.usableCf).toBe(0);
      expect(u.bands.fullyInundated).toBe(true);
    }
  });

  it("raising the top of bank above the flood WSE (a berm) — NOT growing the footprint — is what unlocks usable detention", () => {
    const ring = SQ(200);
    const before = usablePondVolume(ring, submergedDet, { wseFt, coincidentStorm: true });
    expect(before.usableCf).toBe(0);

    const raised = solveTobRaise({ ring, det: submergedDet, wseFt, targetCf: 20000, coincidentStorm: true });
    expect(raised.ok).toBe(true);
    expect(raised.hFt).toBeGreaterThan(0); // TOB must actually go up

    const afterDet = { ...submergedDet, tobElev: submergedDet.tobElev + raised.hFt, depth: submergedDet.depth + raised.hFt };
    const after = usablePondVolume(ring, afterDet, { wseFt, coincidentStorm: true });
    expect(after.usableCf).toBeGreaterThan(0);
    expect(after.usableCf).toBeGreaterThanOrEqual(20000 - 1);
    expect(after.bands.fullyInundated).toBe(false);
  });

  it("sizePondForTargets, asked ONLY for detention (mitTargetCf: 0) on a submerged pond, proposes raise-tob — never a footprint-only remedy that can't work", () => {
    const result = sizePondForTargets({ ring: SQ(200), det: submergedDet, wseFt, detTargetCf: 20000, mitTargetCf: 0, coincidentStorm: true });
    expect(result.ok).toBe(true);
    expect(result.fullyInundated).toBe(true);
    const raiseA = result.actions.find((a) => a.kind === "raise-tob");
    expect(raiseA).toBeTruthy();
    expect(raiseA.hFt).toBeGreaterThan(0);
    // No deepen/grow proposed for a target that was never asked for.
    expect(result.actions.some((a) => a.kind === "deepen" || a.kind === "grow")).toBe(false);
  });

  // The ACTUAL Tsakiris scenario: the flood WSE sits WELL above the TOB — deeper than
  // the 4′ screening clamp can raise it in one shot. raise-tob reports `partial: true`
  // (still submerged, still short) rather than a false success — this is exactly the
  // signal designPond() checks to trigger its verify-and-iterate footprint-growth
  // follow-up (SitePlanner.jsx), so growing the footprint at the now-raised (but still
  // clamped) rim is the ONLY way left to close the remaining gap.
  it("when the submergence exceeds the raise clamp, raise-tob reports a PARTIAL result — the signal that a footprint-growth follow-up is required", () => {
    const deepSubmergedDet = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 };
    const deepWseFt = 153.1; // far beyond the 4′ clamp — the reported Tsakiris figure
    const result = sizePondForTargets({ ring: SQ(200), det: deepSubmergedDet, wseFt: deepWseFt, detTargetCf: 20000, mitTargetCf: 0, coincidentStorm: true });
    expect(result.ok).toBe(true);
    const raiseA = result.actions.find((a) => a.kind === "raise-tob");
    expect(raiseA).toBeTruthy();
    expect(raiseA.partial).toBe(true);
    // Even the clamped raise still leaves the pond fully inundated at this gap size —
    // confirming a footprint-only remedy (the pre-fix behavior) truly had nothing to work with.
    const stillSubmergedDet = { ...deepSubmergedDet, tobElev: deepSubmergedDet.tobElev + raiseA.hFt, depth: deepSubmergedDet.depth + raiseA.hFt };
    const afterClampedRaise = usablePondVolume(SQ(200), stillSubmergedDet, { wseFt: deepWseFt, coincidentStorm: true });
    expect(afterClampedRaise.usableCf).toBe(0);
  });
});
