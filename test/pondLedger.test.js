// NEW-9 (pond-roles branch) — the site-level pond-ledger accumulator: the
// "unknown facts poison the usable total" honesty rule, and the slim-record
// round-trip that lets a restored check replay the exact live split. Pure.
import { describe, it, expect } from "vitest";
import { detentionStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { accumulatePondLedger, suggestPondRole, effectivePondRole, ROLE_SHARE, POND_ROLES, POND_ROLE_LABEL, pondDisplayName, pondDisplayNameFor } from "../src/workspaces/site-planner/lib/pondLedger.js";

describe("D4 — the on-screen pond NOUN follows the resolved purpose", () => {
  it("maps each role to its display noun", () => {
    expect(pondDisplayName("detention")).toBe("Detention Pond");
    expect(pondDisplayName("mitigation")).toBe("Mitigation Pond");
    expect(pondDisplayName("dual")).toBe("Detention + Mitigation Pond");
    expect(pondDisplayName(undefined)).toBe("Detention Pond"); // safe fallback
  });

  it("an owner's explicit purpose wins — a pond set to Mitigation reads 'Mitigation Pond'", () => {
    expect(pondDisplayNameFor({ role: "mitigation" }, { mode: "gross" })).toBe("Mitigation Pond");
    expect(pondDisplayNameFor({ role: "dual" }, { mode: "gross" })).toBe("Detention + Mitigation Pond");
  });

  it("Auto (no explicit role) resolves from the elevation split: a mostly-below-WSE pond reads 'Mitigation Pond'", () => {
    // grossCf 100, usable 5 → belowShare 0.95 ≥ ROLE_SHARE → mitigation
    const split = { mode: "anchored", bands: {}, wseFt: 95, grossCf: 100, usableCf: 5 };
    expect(pondDisplayNameFor({}, split)).toBe("Mitigation Pond");
  });

  it("Auto with no elevation evidence defaults to 'Detention Pond'", () => {
    expect(pondDisplayNameFor({}, { mode: "gross" })).toBe("Detention Pond");
  });
});

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

// ---- NEW-8 — pond roles + the credited mitigation-provided gate --------------------

// A WSE that puts the below share right where we want it: with the SQ/DET fixture the
// share is monotonic in wseFt, so probe for threshold behavior via computed shares.
const splitAt = (wseFt) => liveEntry("p", DET, { wseFt, inTrigger: true });

describe("suggestPondRole — elevation auto-suggestion (NEW-8)", () => {
  it("no WSE evidence → detention default with a null share (never a fabricated %)", () => {
    expect(suggestPondRole(liveEntry("p", DET, {}))).toEqual({ role: "detention", belowShare: null });
    expect(suggestPondRole(liveEntry("p", { depth: 4, freeboard: 1, slope: 3 }, { estPool: 2 }))).toEqual({ role: "detention", belowShare: null });
  });
  it("mostly flood-occupied (share ≥ 80%) → mitigation; mostly above (≤ 20%) → detention; else dual", () => {
    const deep = suggestPondRole(splitAt(100.5)); // fully inundated → share 1
    expect(deep).toMatchObject({ role: "mitigation", belowShare: 1 });
    const shallow = suggestPondRole(splitAt(96.05)); // WSE barely above the floor
    expect(shallow.role).toBe("detention");
    expect(shallow.belowShare).toBeLessThan(1 - ROLE_SHARE);
    const mid = suggestPondRole(splitAt(97.8));
    expect(mid.belowShare).toBeGreaterThan(1 - ROLE_SHARE);
    expect(mid.belowShare).toBeLessThan(ROLE_SHARE);
    expect(mid.role).toBe("dual");
  });
});

describe("effectivePondRole — the owner's pick wins; absent = auto (NEW-8)", () => {
  it("owner override beats the suggestion; junk/absent role falls back to auto", () => {
    const split = splitAt(100.5); // suggests mitigation
    expect(effectivePondRole({ role: "detention" }, split)).toMatchObject({ role: "detention", source: "owner" });
    expect(effectivePondRole({}, split)).toMatchObject({ role: "mitigation", source: "auto" });
    expect(effectivePondRole({ role: "auto" }, split).source).toBe("auto"); // "auto" is not a stored role
    expect(effectivePondRole({ role: "banana" }, split).source).toBe("auto");
    expect(POND_ROLES).not.toContain("auto");
  });
});

describe("accumulatePondLedger — the role credit gate (NEW-8)", () => {
  const candOf = (e) => e.bands.mitigationCandidateCf;
  it("mitigation/dual roles credit the candidate band; detention role leaves it uncredited", () => {
    const mitPond = { ...splitAt(97.5), id: "m", role: "mitigation" };
    const dualPond = { ...splitAt(97.5), id: "d", role: "dual" };
    const detPond = { ...splitAt(97.5), id: "det", role: "detention" };
    const led = accumulatePondLedger([mitPond, dualPond, detPond]);
    expect(led.creditedMitCf).toBeCloseTo(candOf(mitPond) + candOf(dualPond), 6);
    expect(led.uncreditedMitCf).toBeCloseTo(candOf(detPond), 6);
    expect(led.mitCandidateCf).toBeCloseTo(led.creditedMitCf + led.uncreditedMitCf, 6);
    expect(led.creditedPondCount).toBe(2);
  });
  it("auto role credits a mostly-inundated pond (suggested mitigation) without an owner pick", () => {
    const led = accumulatePondLedger([{ ...splitAt(100.5), role: null }]);
    expect(led.creditedMitCf).toBeGreaterThan(0);
    expect(led.uncreditedMitCf).toBe(0);
  });
  it("role NEVER moves usable/dead — only which ledger the candidate band credits (no double-count)", () => {
    for (const role of ["detention", "mitigation", "dual", null]) {
      const e = { ...splitAt(97.5), role };
      const led = accumulatePondLedger([e]);
      expect(led.usableCf).toBeCloseTo(e.usableCf, 6);
      expect(led.deadCf).toBeCloseTo(e.deadCf, 6);
      // Exclusive bands: usable + candidate + poolDead ≈ gross, and the candidate lands
      // in exactly ONE of credited/uncredited.
      expect(led.usableCf + led.mitCandidateCf + (e.bands.poolDeadCf || 0)).toBeCloseTo(e.grossCf, -3);
      expect((led.creditedMitCf || 0) + (led.uncreditedMitCf || 0)).toBeCloseTo(led.mitCandidateCf, 6);
    }
  });
  it("unknown facts poison the credited/uncredited gates too (NEW-9 discipline)", () => {
    const led = accumulatePondLedger([{ ...splitAt(97.5), role: "mitigation" }, unknownEntry("x", DET)]);
    expect(led.creditedMitCf).toBeNull();
    expect(led.uncreditedMitCf).toBeNull();
  });
});

// NEW-4 — the user-facing purpose label: "dual" stays the stored enum (renaming it
// would orphan saved ponds); the label users see is "Hybrid".
describe("NEW-4 — purpose labels", () => {
  it("dual renders as Hybrid; the stored enum is unchanged", () => {
    expect(POND_ROLES).toEqual(["detention", "mitigation", "dual"]);
    expect(POND_ROLE_LABEL.dual).toBe("Hybrid");
    expect(POND_ROLE_LABEL.detention).toBe("Detention");
    expect(POND_ROLE_LABEL.mitigation).toBe("Mitigation");
  });
});
