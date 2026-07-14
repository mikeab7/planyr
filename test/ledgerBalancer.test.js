// NEW-10/B830 (pond-roles branch) — the ledger balancer: the berm joint-solve
// (NEW-13 amendment), the five screening move kinds, ranking, honesty gates,
// label budget, and immutability. Pure — no browser.
import { describe, it, expect } from "vitest";
import { detentionStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { rankLedgerMoves, solveBermRaise, BERM_MAX_RAISE_FT, overdugAcFt } from "../src/workspaces/site-planner/lib/ledgerBalancer.js";

const SQ = (s) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC_FT = 43560;

// A pond entry shaped like SitePlanner's pondLedgerEntries (flattened split + extras).
const pondEntry = (id, ring, det, { wseFt = null, estPool = null, inTrigger = false, role = null, name } = {}) => ({
  id, name: name || id, ring, det,
  ...usablePondVolume(ring, det, { wseFt, estimatePoolDepthFt: estPool }),
  wseFt, inTrigger, estPoolDepthFt: estPool, factsKnown: true, role,
});

const UPLAND = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 };

describe("solveBermRaise — the NEW-13 joint solve", () => {
  it("solves the smallest 0.1-ft H that closes the deficit on one upland pond", () => {
    const p = pondEntry("p1", SQ(400), UPLAND);
    // one foot of berm on a 400-ft square adds roughly a top-band prism (~3.6 ac-ft)
    const oneFt = usablePondVolume(SQ(400), { ...UPLAND, depth: 9, tobElev: 101 }, {}).usableCf - p.usableCf;
    const s = solveBermRaise({ ponds: [p], deficitCf: oneFt * 0.55 });
    expect(s.ok).toBe(true);
    expect(s.hFt).toBeGreaterThan(0.3);
    expect(s.hFt).toBeLessThan(1.0);
    expect(s.gainCf).toBeGreaterThanOrEqual(oneFt * 0.55);
    expect(s.hFt * 10).toBeCloseTo(Math.round(s.hFt * 10), 8); // 0.1-ft convention
    expect(s.perPond[0].tobTargetFt).toBeCloseTo(100 + s.hFt, 6);
    expect(s.perPond[0].depthTargetFt).toBeCloseTo(8 + s.hFt, 6);
  });
  it("one shared H across ponds — added volume proportional to area (the distribution rule)", () => {
    const small = pondEntry("small", SQ(200), UPLAND);
    const big = pondEntry("big", SQ(400), UPLAND);
    const s = solveBermRaise({ ponds: [small, big], deficitCf: 2 * AC_FT });
    expect(s.ok).toBe(true);
    const add = Object.fromEntries(s.perPond.map((x) => [x.id, x.addCf]));
    expect(add.big).toBeGreaterThan(add.small * 2.5); // ~4× area → ~4× volume per foot
  });
  it("excludes floodplain-fringe and mitigation-role ponds, with reasons", () => {
    const fringe = pondEntry("fringe", SQ(300), UPLAND, { wseFt: 98, inTrigger: true });
    const mitP = pondEntry("mitp", SQ(300), UPLAND, { role: "mitigation" });
    const ok = pondEntry("ok", SQ(300), UPLAND);
    const s = solveBermRaise({ ponds: [fringe, mitP, ok], deficitCf: 0.5 * AC_FT });
    expect(s.eligible.map((p) => p.id)).toEqual(["ok"]);
    expect(s.excluded.map((x) => [x.id, x.reason]).sort()).toEqual([["fringe", "floodplain-fringe"], ["mitp", "mitigation-role"]]);
  });
  it("reports an honest partial when the 4-ft screening cap can't close the site", () => {
    const p = pondEntry("p1", SQ(120), UPLAND); // tiny pond
    const s = solveBermRaise({ ponds: [p], deficitCf: 100 * AC_FT });
    expect(s.ok).toBe(false);
    expect(s.partial).toBe(true);
    expect(s.hFt).toBe(BERM_MAX_RAISE_FT);
    expect(s.gainCf).toBeGreaterThan(0);
    expect(s.gainCf).toBeLessThan(100 * AC_FT);
  });
});

describe("rankLedgerMoves — the five screening kinds", () => {
  const bainish = () => ({
    detention: { requiredAcFt: 76.54, providedUsableAcFt: 21.81, rateAcFtPerAc: null, acres: 108.8 },
    mitigation: { requiredAcFt: 23.2, providedAcFt: 90.3 },
    ponds: [
      pondEntry("creek", SQ(500), { ...UPLAND, tobElev: 94 }, { wseFt: 95, inTrigger: true, name: "Creek pond" }), // fully inundated → auto mitigation role
      pondEntry("upland", SQ(400), UPLAND, { name: "Upland pond" }),
    ],
    parcels: [
      { id: "pa", name: "Main tract", acres: 79.09, active: true },
      { id: "pb", name: "North 29.71", acres: 29.71, active: true },
    ],
    buildings: [{ id: "b1", name: "Building 1", areaSf: 200000, courtSf: 60000, ring: SQ(450) }],
    criteriaRule: { label: "test", maxSideSlope: 3, minFreeboardFt: 1, maintBermWidthFt: 30 },
    detRule: { params: { gravityDrainFraction: 0.5, gravityDrainNote: "Interim §5." } },
    reqInputs: { acres: 108.8, impPct: 55, inCityLimits: false, drainsToHcfcdChannel: null, outfallType: null, hcfcdApplicable: false, authorityId: "fortbend" },
    earthPerCy: 6,
  });

  it("Bain-shaped: parcel deactivation prices at the effective rate (29.71 ac ≈ −20.9)", () => {
    const r = rankLedgerMoves(bainish());
    const mv = r.moves.find((m) => m.kind === "deactivate-parcel" && m.id === "pb");
    expect(mv).toBeTruthy();
    // effRate = 76.54 / 108.8 ≈ 0.7035 → 29.71 ac ≈ 20.9 ac-ft
    expect(mv.deltas.detAcFt).toBeGreaterThan(20.5);
    expect(mv.deltas.detAcFt).toBeLessThan(21.3);
    expect(mv.destructive).toBe(true);
  });
  it("over-dug mitigation yields a shrink move with 1:1 cy math and dirt cost", () => {
    const r = rankLedgerMoves(bainish());
    const mv = r.moves.find((m) => m.kind === "shrink-overdug");
    expect(mv).toBeTruthy();
    expect(r.mitOverAcFt).toBeCloseTo(overdugAcFt(90.3, 23.2), 6);
    expect(mv.deltas.mitAcFt).toBeLessThan(0);
    expect(mv.deltas.dirtCy).toBeLessThan(0);
    // cy = shrinkCf/27; cost at $6/cy (both independently rounded to whole units)
    expect(Math.abs(mv.deltas.costUsd)).toBeCloseTo(Math.abs(mv.deltas.dirtCy) * 6, -1);
  });
  it("the berm move is present with an apply payload and clamps/flags", () => {
    const r = rankLedgerMoves(bainish());
    const mv = r.moves.find((m) => m.kind === "berm-raise");
    expect(mv).toBeTruthy();
    expect(mv.apply.hFt).toBeGreaterThan(0);
    expect(mv.apply.hFt).toBeLessThanOrEqual(BERM_MAX_RAISE_FT);
    expect(mv.apply.perPond.map((p) => p.id)).toEqual(["upland"]); // fringe pond excluded
    expect(mv.confirmFlags).toContain("berm-is-fill");
    expect(r.bermExcluded.map((x) => x.id)).toContain("creek");
  });
  it("convert-building gains usable volume, loses sf, and is ranked destructive-last", () => {
    const r = rankLedgerMoves(bainish());
    const mv = r.moves.find((m) => m.kind === "convert-building");
    expect(mv).toBeTruthy();
    expect(mv.deltas.buildingSf).toBe(-260000);
    expect(mv.destructive).toBe(true);
    expect(mv.deltas.detAcFt).toBeGreaterThan(0);
  });
  it("pumped what-if converges and respects the FBCDD gravity clamp + flags", () => {
    const r = rankLedgerMoves(bainish());
    const mv = r.moves.find((m) => m.kind === "pumped-system");
    expect(mv).toBeTruthy();
    // gdf 0.5 → pumped share caps at 0.5 × 76.54 = 38.27; the gap (54.73) exceeds it
    expect(mv.deltas.detAcFt).toBeLessThanOrEqual(0.5 * 76.54 + 0.05);
    expect(mv.confirmFlags).toContain("engineer-confirm");
    expect(mv.confirmFlags).toContain("fbcdd-gravity-rule");
  });
  it("every label stays inside the one-line budget (≤110 chars)", () => {
    const r = rankLedgerMoves(bainish());
    expect(r.moves.length).toBeGreaterThan(0);
    for (const m of r.moves) expect(m.label.length, m.label).toBeLessThanOrEqual(110);
  });
  it("balanced ledgers rank nothing", () => {
    const r = rankLedgerMoves({
      detention: { requiredAcFt: 10, providedUsableAcFt: 12, acres: 40 },
      mitigation: { requiredAcFt: 5, providedAcFt: 5.5 },
      ponds: [pondEntry("p", SQ(300), UPLAND)],
      parcels: [{ id: "a", name: "A", acres: 20, active: true }, { id: "b", name: "B", acres: 20, active: true }],
      buildings: [{ id: "b1", name: "B1", areaSf: 100000, courtSf: 0, ring: SQ(300) }],
      reqInputs: { acres: 40, impPct: 50, authorityId: "fortbend" },
    });
    expect(r.moves).toEqual([]);
    expect(r.detGapAcFt).toBe(0);
  });
  it("never mutates its inputs (frozen fixtures)", () => {
    const inputs = bainish();
    const freeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
    freeze(inputs);
    expect(() => rankLedgerMoves(inputs)).not.toThrow();
  });
  it("an unknown usable split ranks nothing against detention (the NEW-9 gate lives upstream, but the math is null-safe)", () => {
    const r = rankLedgerMoves({
      detention: { requiredAcFt: 10, providedUsableAcFt: null, acres: 40 },
      mitigation: { requiredAcFt: null, providedAcFt: null },
      ponds: [], parcels: [], buildings: [],
    });
    expect(r.detGapAcFt).toBe(0);
    expect(r.moves).toEqual([]);
  });
});
