// NEW-9 (pond-roles branch) — the site-level pond-ledger accumulator: the
// "unknown facts poison the usable total" honesty rule, and the slim-record
// round-trip that lets a restored check replay the exact live split. Pure.
import { describe, it, expect } from "vitest";
import { detentionStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { accumulatePondLedger } from "../src/workspaces/site-planner/lib/pondLedger.js";

// The B708 fixture: 100×100 ft square, slope 3 → stage areas are exact.
const SQ = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const DET = { depth: 4, freeboard: 1, slope: 3, tobElev: 100 }; // water surf 99, floor 96
const GROSS = detentionStorage(SQ, 4, 1, 3).vol;

// Mirror of SitePlanner's pondSplitFor entry construction (the component owns the
// flood context; the entry is what reaches the accumulator).
const liveEntry = (id, det, { wseFt = null, estPool = null, inTrigger = false } = {}) => ({
  id,
  ...usablePondVolume(SQ, det, { wseFt, estimatePoolDepthFt: estPool }),
  wseFt, inTrigger, estPoolDepthFt: estPool, factsKnown: true,
  anchoredTob: det.tobElev != null, autoAnchored: false, excavationCf: 0, role: null,
});
const unknownEntry = (id, det) => ({
  id,
  mode: "unknown", usableCf: null, deadCf: null, grossCf: usablePondVolume(SQ, det, {}).grossCf, bands: null,
  wseFt: null, inTrigger: false, estPoolDepthFt: null, factsKnown: false,
  anchoredTob: det.tobElev != null, autoAnchored: false, excavationCf: 0, role: null,
});
// Mirror of the persisted slim record (wseFt/estPool rounded to 0.01) and its restore.
const slimFacts = (e) => ({
  wseFt: Number.isFinite(e.wseFt) ? Math.round(e.wseFt * 100) / 100 : null,
  inTrigger: !!e.inTrigger,
  estPoolDepthFt: Number.isFinite(e.estPoolDepthFt) ? Math.round(e.estPoolDepthFt * 100) / 100 : null,
});
const restoredEntry = (id, det, rf) => liveEntry(id, det, { wseFt: rf.wseFt, estPool: rf.estPoolDepthFt, inTrigger: rf.inTrigger });

describe("accumulatePondLedger — slim-record round-trip (NEW-9)", () => {
  it("a restored check replays the exact live usable/dead split across the WSE sweep", () => {
    for (const wseFt of [90, 96.5, 97.5, 98.9, 100.5]) {
      const live = accumulatePondLedger([liveEntry("p1", DET, { wseFt, inTrigger: true })]);
      // Persist → JSON → restore (the settings autosave path is JSON).
      const rf = JSON.parse(JSON.stringify(slimFacts(liveEntry("p1", DET, { wseFt, inTrigger: true }))));
      const restored = accumulatePondLedger([restoredEntry("p1", DET, rf)]);
      expect(restored.usableCf).toBeCloseTo(live.usableCf, 6);
      expect(restored.deadCf).toBeCloseTo(live.deadCf, 6);
      expect(restored.mitCandidateCf).toBeCloseTo(live.mitCandidateCf, 6);
    }
  });
  it("the estimate mode round-trips through the persisted pool depth", () => {
    const det = { depth: 4, freeboard: 1, slope: 3 }; // unanchored → estimate path
    const live = accumulatePondLedger([liveEntry("p1", det, { estPool: 2 })]);
    const rf = slimFacts(liveEntry("p1", det, { estPool: 2 }));
    const restored = accumulatePondLedger([restoredEntry("p1", det, rf)]);
    expect(live.deadCf).toBeGreaterThan(0);
    expect(restored.usableCf).toBeCloseTo(live.usableCf, 6);
    expect(restored.deadCf).toBeCloseTo(live.deadCf, 6);
  });
});

describe("accumulatePondLedger — unknown facts poison the usable total (LOUD-FAILURE)", () => {
  it("one unknown pond among known ones → usable/dead/mitCandidate are null, never numbers", () => {
    const led = accumulatePondLedger([
      liveEntry("known", DET, { wseFt: 97.5, inTrigger: true }),
      unknownEntry("mystery", DET),
    ]);
    expect(led.usableCf).toBeNull();
    expect(led.deadCf).toBeNull();
    expect(led.mitCandidateCf).toBeNull();
    expect(led.unknownIds).toEqual(["mystery"]);
  });
  it("restored usable is NEVER a number greater than the live usable (the flipped-verdict bug)", () => {
    // Live: anchored split at a mid-basin WSE — most of the column is flood-occupied.
    const live = accumulatePondLedger([liveEntry("p1", DET, { wseFt: 98.9, inTrigger: true })]);
    expect(live.usableCf).toBeGreaterThan(0);
    expect(live.usableCf).toBeLessThan(GROSS);
    // Restored WITHOUT the facts: the old code credited GROSS here (usable > live). The
    // accumulator must return null — an honest unknown — not any number at all.
    const restored = accumulatePondLedger([unknownEntry("p1", DET)]);
    expect(restored.usableCf).toBeNull();
    // And with the facts persisted, restored usable equals live exactly (never exceeds it).
    const rf = slimFacts(liveEntry("p1", DET, { wseFt: 98.9, inTrigger: true }));
    const replay = accumulatePondLedger([restoredEntry("p1", DET, rf)]);
    expect(replay.usableCf).toBeLessThanOrEqual(live.usableCf + 1e-6);
  });
  it("gross keeps summing regardless of demotion — it is a geometric fact", () => {
    const led = accumulatePondLedger([unknownEntry("a", DET), unknownEntry("b", DET)]);
    expect(led.grossCf).toBeCloseTo(2 * GROSS, 6);
    expect(led.pondCount).toBe(2);
  });
});

describe("accumulatePondLedger — counters fold through unchanged (the B822 honesty states)", () => {
  it("anchored-no-WSE vs unanchored in-trigger counters", () => {
    const anchoredNoWse = { ...liveEntry("a", DET, { inTrigger: true }), anchoredTob: true };
    const unanchored = { ...liveEntry("b", { depth: 4, freeboard: 1, slope: 3 }, { inTrigger: true }), anchoredTob: false };
    const led = accumulatePondLedger([anchoredNoWse, unanchored]);
    expect(led.anchoredNoWseInTrigger).toBe(1);
    expect(led.unanchoredInTrigger).toBe(1);
  });
  it("fully-inundated and mitigation-candidate ride the anchored bands", () => {
    const led = accumulatePondLedger([liveEntry("a", DET, { wseFt: 100.5, inTrigger: true })]);
    expect(led.pondFullyInundated).toBe(true);
    const led2 = accumulatePondLedger([liveEntry("b", DET, { wseFt: 97.5, inTrigger: true })]);
    expect(led2.mitCandidateCf).toBeGreaterThan(0);
  });
  it("auto-anchor and excavation sums pass through", () => {
    const e = { ...liveEntry("a", DET, { wseFt: 97 }), autoAnchored: true, excavationCf: 1234 };
    const led = accumulatePondLedger([e, { ...liveEntry("b", DET, { wseFt: 97 }), excavationCf: 766 }]);
    expect(led.autoAnchored).toBe(1);
    expect(led.excavationCf).toBe(2000);
  });
});
