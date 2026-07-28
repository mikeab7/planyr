/* NEW-1 / B1032 — REGRESSION, seeded from the real Tsakiris / Concept A pond.
 *
 * The owner report (2026-07-28): the Yield panel showed Detention FAIL "63.4 of 33.8 ac-ft" AND
 * Mitigation FAIL "29.6 of 0.2 ac-ft" over a SINGLE pond, with "12.2 ac-ft counted twice".
 *
 * Every number below is the live record, not a hand-made fixture: the ring and `det` are the
 * element as saved (site smrjdgmlinea, element e1454684splyoj), the grade is the check's
 * `groundElevFt`, and the flood WSE is the check's persisted per-pond `detSplit` fact
 * (est-boundary-grade, unstudied Zone A). The mitigation requirement is the check's own
 * `volumeAcFt` — which on this site is ENTIRELY the berm-as-fill contribution.
 *
 * WHAT THIS PINS:
 *   • the geometry that produced the bug (usable 63.41 · below-flood void 29.65 · drawn 80.82),
 *   • that the two ledgers no longer claim the same acre-foot,
 *   • that the reconciliation is run against the storage the BERMED model actually holds (63.41),
 *     not the drawn-ring gross (80.82) — reconciling against 80.82 is what masked a 29.65 ac-ft
 *     overlap as a 12.24 ac-ft one.
 *
 * AGAINST THE PRE-FIX CODE this file fails on its central assertions: the ledger credited the full
 * 29.65 ac-ft below-flood band while the detention ledger was also counting it (claimed 93.06 vs
 * 63.41 that exists), and `reconcileStorage` was fed the drawn 80.82 as "physical".
 */
import { describe, it, expect } from "vitest";
import { detentionStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { accumulatePondLedger, allocatePondDuty } from "../src/workspaces/site-planner/lib/pondLedger.js";
import { reconcileStorage } from "../src/workspaces/site-planner/lib/storageReconcile.js";

const AC_FT = 43560;
const RING = [
  { x: 503.72, y: -421.41 }, { x: 502.54, y: 412.42 }, { x: 365.47, y: 415.41 },
  { x: 290.22, y: 285.88 }, { x: 211.36, y: 240.72 }, { x: 108.25, y: -10.5 },
  { x: 74.88, y: -82.45 }, { x: 60.32, y: -187.32 }, { x: 116.51, y: -327.18 },
  { x: 194.52, y: -423.79 },
];
const DET = { role: "detention", depth: 16.2, slope: 3, freeboard: 1, tobElev: 161.3, poolElev: null };
const GRADE_FT = 152.8603582845775;   // check record groundElevFt (3DEP grid)
const WSE_FT = 153.1;                 // check record detSplit.wseFt (est-boundary-grade, Zone A)
const DET_REQUIRED_ACFT = 33.8;       // panel's required detention
const MIT_REQUIRED_CF = 6972.810732143457; // check record mitigation volumeCf (0.16 ac-ft)

const splitOf = () => usablePondVolume(RING, DET, { wseFt: WSE_FT, gradeFt: GRADE_FT, coincidentStorm: false });
const entryOf = () => {
  const split = splitOf();
  return {
    id: "e1454684splyoj", name: "Pond 1", displayName: "Detention Pond",
    ...split, wseFt: WSE_FT, inTrigger: true, factsKnown: true, role: DET.role, det: DET, ring: RING,
    drawnGrossCf: detentionStorage(RING, DET.depth, DET.freeboard, DET.slope).vol,
  };
};

describe("Tsakiris / Concept A — the 12.2 ac-ft double-count (NEW-1 / B1032)", () => {
  it("reproduces the reported geometry exactly", () => {
    const e = entryOf();
    expect(e.drawnGrossCf / AC_FT).toBeCloseTo(80.82, 1);   // panel "holds 80.8"
    expect(e.usableCf / AC_FT).toBeCloseTo(63.41, 1);       // panel "63.4 counts"
    expect(e.grossCf / AC_FT).toBeCloseTo(63.41, 1);        // the bermed model holds 63.4, NOT 80.8
    expect(e.bands.mitigationCandidateCf / AC_FT).toBeCloseTo(29.65, 1); // panel "29.6" provided
    expect(e.bands.aboveWseCf / AC_FT).toBeCloseTo(33.77, 1);
    // The pond has ZERO dead storage: the 17.4 ac-ft the panel used to call "below the flood
    // level" is the volume the INWARD BERM RING takes out of the drawn footprint.
    expect(e.deadCf).toBeCloseTo(0, 6);
    expect((e.drawnGrossCf - e.grossCf) / AC_FT).toBeCloseTo(17.41, 1);
  });

  it("the below-flood band lands in exactly ONE ledger — 29.65 ac-ft is no longer credited twice", () => {
    const led = accumulatePondLedger([entryOf()], { mitigationRequiredCf: MIT_REQUIRED_CF });
    const e = entryOf();
    // Mitigation gets exactly what the requirement needs; detention keeps the rest.
    expect(led.creditedMitCf).toBeCloseTo(MIT_REQUIRED_CF, 6);
    expect(led.usableCf).toBeCloseTo(e.usableCf - MIT_REQUIRED_CF, 6);
    // THE INVARIANT: the two ledgers together never claim more than the pond holds.
    expect(led.usableCf + led.creditedMitCf).toBeLessThanOrEqual(e.grossCf + 1e-6);
    // Pre-fix this sum was 93.06 ac-ft against 63.41 ac-ft of storage.
    expect((led.usableCf + led.creditedMitCf) / AC_FT).toBeCloseTo(63.41, 1);
    // Detention still clears its requirement — dedicating 0.16 ac-ft does not break it.
    expect(led.usableCf / AC_FT).toBeGreaterThan(DET_REQUIRED_ACFT);
  });

  it("the site reconciliation ties out against the storage the BERMED model holds", () => {
    const led = accumulatePondLedger([entryOf()], { mitigationRequiredCf: MIT_REQUIRED_CF });
    const p = led.perPond[0];
    const rec = reconcileStorage([{
      id: p.id, name: p.displayName, known: true,
      physicalCf: p.grossCf,                      // the crest column the ledgers count from
      detentionCountedCf: p.duty.detentionCf,
      mitigationCountedCf: p.duty.mitigationCf,
      boundaryElevFt: p.duty.boundaryElevFt,
    }]);
    expect(rec.state).toBe("ok");
    expect(rec.overlapCf).toBeCloseTo(0, 1);
    expect(rec.message).toBeNull();
    // The split is DECLARED at the governing flood WSE — an undeclared dual-duty pond is itself a
    // reconciliation finding, and the allocation states its boundary rather than leaving it blank.
    expect(p.duty.boundaryElevFt).toBeCloseTo(WSE_FT, 6);
  });

  it("reconciling against the DRAWN gross is what masked the overlap (the 12.2 vs 29.6 gap)", () => {
    const e = entryOf();
    // The pre-fix inputs: detention counted the whole recovered column AND mitigation credited the
    // whole below-flood band, reconciled against the drawn-ring gross.
    const masked = reconcileStorage([{
      id: e.id, name: e.displayName, known: true,
      physicalCf: e.drawnGrossCf, detentionCountedCf: e.usableCf,
      mitigationCountedCf: e.bands.mitigationCandidateCf, boundaryElevFt: null,
    }]);
    expect(masked.state).toBe("fail");
    expect(masked.overlapCf / AC_FT).toBeCloseTo(12.24, 1);   // what the panel reported
    const honest = reconcileStorage([{
      id: e.id, name: e.displayName, known: true,
      physicalCf: e.grossCf, detentionCountedCf: e.usableCf,
      mitigationCountedCf: e.bands.mitigationCandidateCf, boundaryElevFt: null,
    }]);
    expect(honest.overlapCf / AC_FT).toBeCloseTo(29.65, 1);   // the real overlap
    // NEW-4 (B1035) — the message names the pond the way the map does, never "Pond 1".
    expect(honest.message).toContain("Detention Pond");
    expect(honest.message).not.toContain("Pond 1");
  });

  it("with NO mitigation requirement nothing is dedicated and detention is untouched", () => {
    const e = entryOf();
    const alloc = allocatePondDuty({ role: "detention" }, e, { needCf: 0 });
    expect(alloc.mitigationCf).toBe(0);
    expect(alloc.detentionCf).toBeCloseTo(e.usableCf, 6);
    expect(alloc.reason).toBe("counted-as-detention");
    expect(alloc.deadCf + alloc.detentionCf + alloc.mitigationCf + alloc.unusedCf).toBeCloseTo(e.grossCf, -3);
  });
});
