/* Cowork Yield-panel design review (Bain / Concept A) — NEW-1 … NEW-10.
 *
 * The Bain numbers are used as REGRESSION PINS throughout: Detention 150.9 of 76.7 "OK",
 * Mitigation 98.2 of 97.7 "OK", total physical pond storage 206.3 ac-ft, ~80.34 ac, FBCDD max
 * release 0.125 cfs/ac, pads assumed at 144.8' FFE. Pure — no browser.
 */
import { describe, it, expect } from "vitest";
import {
  pondElevations, stageTable, areaAtElev, dutySplit, outfallSplit, gravityTests,
  prismVsExtrusion, pondStageModel, DEFAULT_MIN_GRAVITY_SHARE,
} from "../src/workspaces/site-planner/lib/pondStageModel.js";
import { reconcileStorage, reconcilePond, OVERLAP_TOL_CF } from "../src/workspaces/site-planner/lib/storageReconcile.js";
import {
  allowableReleaseCfs, drawdownHours, drawdownTone, fmtDrawdown, assessDrawdown, DEFAULT_DRAWDOWN_MAX_HR,
} from "../src/workspaces/site-planner/lib/drawdownTime.js";
import { bandSpans, createdBands, bandLedger } from "../src/workspaces/site-planner/lib/mitigationBands.js";
import {
  mitigationOffsetBasis, offsetSurfaceBasis, DEFAULT_FLOODPLAIN_RULES,
} from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { marginFor, fmtMargin, yieldVerdictStrip, thinThresholdFor } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";
import {
  administratorCandidates, resolveAdministrator, impliedFloodElevation, ffeSummary, assessAdministrator,
} from "../src/workspaces/site-planner/lib/floodAdministrator.js";
import { apronElevFt, assessApron, apronFillIncluded, APRON_FILL_TYPES } from "../src/workspaces/site-planner/lib/apronElevation.js";
import { cutFillBalance, padFillDemandCf, classifyStorageSurplus, assessCutFill } from "../src/workspaces/site-planner/lib/cutFillBalance.js";
import { DEFAULT_BUILDABILITY_RULES } from "../src/workspaces/site-planner/lib/buildability.js";

const ACFT = 43560;
// A square pond, big enough that 3:1 side slopes don't pinch it off.
const sq = (side, cx = 0, cy = 0) => [
  { x: cx - side / 2, y: cy - side / 2 }, { x: cx + side / 2, y: cy - side / 2 },
  { x: cx + side / 2, y: cy + side / 2 }, { x: cx - side / 2, y: cy + side / 2 },
];
// An ACUTE-cornered triangle — the shape the review calls out as worst for slope loss.
const tri = (b, h) => [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b * 0.06, y: h }];
const det = (o = {}) => ({ depth: 10, freeboard: 1, slope: 3, tobElev: 150, ...o });

/* ---------------------------------------------------------------- NEW-1 + the shared stage model */
describe("NEW-1 / cross-cutting — the ONE per-pond stage-storage model", () => {
  it("resolves the pond's key elevations, and returns null when unanchored", () => {
    const el = pondElevations(sq(400), det());
    expect(el.tobElev).toBe(150);
    expect(el.waterSurfElev).toBe(149);
    expect(el.floorElev).toBe(140);
    expect(el.pinched).toBe(false);
    expect(pondElevations(sq(400), { depth: 10, freeboard: 1, slope: 3 })).toBeNull();
  });

  it("the stage table's cumulative volume equals the band-integrated total, and areas shrink with depth", () => {
    const t = stageTable(sq(400), det());
    expect(t.bands.length).toBe(9); // 140 → 149 in 1-ft bands
    const summed = t.bands.reduce((s, b) => s + b.volCf, 0);
    expect(t.totalCf).toBeCloseTo(summed, 6);
    expect(t.bands[t.bands.length - 1].cumCf).toBeCloseTo(t.totalCf, 6);
    // Sloped prism: the wetted area at the floor is smaller than at the water surface.
    expect(areaAtElev(sq(400), det(), 140)).toBeLessThan(areaAtElev(sq(400), det(), 149));
  });

  it("a pond serving BOTH duties splits into non-overlapping bands at ONE declared boundary", () => {
    const d = dutySplit(sq(400), det(), { floodElevFt: 145 });
    expect(d.declared).toBe(true);
    expect(d.boundaryElevFt).toBe(145);
    // The same acre-foot slice can never be credited twice — by construction.
    expect(d.overlapCf).toBe(0);
    expect(d.detentionCf + d.mitigationCf).toBeCloseTo(d.totalCf, 6);
    expect(d.mitigationCf).toBeGreaterThan(0);
    expect(d.detentionCf).toBeGreaterThan(0);
  });

  it("no flood at the pond → the whole column is detention and mitigation is a real zero", () => {
    const d = dutySplit(sq(400), det(), { floodElevFt: null });
    expect(d.declared).toBe(false);
    expect(d.mitigationCf).toBe(0);
    expect(d.detentionCf).toBeCloseTo(d.totalCf, 6);
  });

  it("a boundary above the water surface or below the floor still sums exactly to the total", () => {
    for (const f of [200, 100]) {
      const d = dutySplit(sq(400), det(), { floodElevFt: f });
      expect(d.boundaryClamped).toBe(true);
      expect(d.detentionCf + d.mitigationCf).toBeCloseTo(d.totalCf, 6);
      expect(d.overlapCf).toBe(0);
    }
  });
});

describe("NEW-1 — site reconciliation: claimed service vs storage that physically exists", () => {
  // The exact Bain shape: two ledgers each fine on their own, together over-committing.
  const bain = [
    { id: "p1", name: "Pond 1", physicalCf: 61.8 * ACFT, detentionCountedCf: 61.8 * ACFT, mitigationCountedCf: 0, boundaryElevFt: 140 },
    { id: "p2", name: "Pond 2", physicalCf: 115.4 * ACFT, detentionCountedCf: 60.0 * ACFT, mitigationCountedCf: 98.2 * ACFT, boundaryElevFt: 142 },
    { id: "p3", name: "Pond 3", physicalCf: 6.6 * ACFT, detentionCountedCf: 6.6 * ACFT, mitigationCountedCf: 0, boundaryElevFt: 140 },
    { id: "p4", name: "Pond 4", physicalCf: 22.5 * ACFT, detentionCountedCf: 22.5 * ACFT, mitigationCountedCf: 0, boundaryElevFt: 140 },
  ];

  it("FAILS the Bain case, naming the overlap volume and the pond involved", () => {
    const r = reconcileStorage(bain);
    expect(r.state).toBe("fail");
    expect(r.physicalCf / ACFT).toBeCloseTo(206.3, 1);
    expect(r.claimedCf / ACFT).toBeCloseTo(249.1, 1);
    expect(r.overlapCf / ACFT).toBeCloseTo(42.8, 1);
    expect(r.offenders.map((p) => p.name)).toContain("Pond 2");
    expect(r.message).toContain("42.8");
    expect(r.message).toContain("Pond 2");
  });

  it("passes when each pond's duties fit inside its own storage", () => {
    const ok = reconcileStorage([
      { id: "p1", name: "Pond 1", physicalCf: 100 * ACFT, detentionCountedCf: 60 * ACFT, mitigationCountedCf: 40 * ACFT, boundaryElevFt: 141 },
    ]);
    expect(ok.state).toBe("ok");
    expect(ok.overlapCf).toBe(0);
    expect(ok.message).toBeNull();
  });

  it("a dual-duty pond with NO declared vertical split is itself a failure", () => {
    const r = reconcileStorage([
      { id: "p1", name: "Pond 1", physicalCf: 100 * ACFT, detentionCountedCf: 50 * ACFT, mitigationCountedCf: 40 * ACFT, boundaryElevFt: null },
    ]);
    expect(r.state).toBe("fail");
    expect(r.undeclared).toHaveLength(1);
    expect(r.message).toMatch(/declared vertical split/);
  });

  it("an UNKNOWN pond poisons the verdict — never a silent pass", () => {
    const r = reconcileStorage([...bain.slice(0, 3), { id: "p4", name: "Pond 4", known: false }]);
    expect(r.state).toBe("unknown");
    expect(r.physicalCf).toBeNull();
    expect(r.unknownIds).toEqual(["p4"]);
  });

  it("an acre-foot residue inside display precision is not an overlap", () => {
    const p = reconcilePond({ id: "x", physicalCf: 100 * ACFT, detentionCountedCf: 100 * ACFT + OVERLAP_TOL_CF / 2, mitigationCountedCf: 0 });
    expect(p.state).toBe("ok");
  });
});

/* --------------------------------------------------------------------------------------- NEW-2 */
describe("NEW-2 — drawdown time at the allowable release rate", () => {
  it("reproduces the Bain worked example: 10.04 cfs, 150.9 ac-ft → 7.6 days", () => {
    const rel = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34 });
    expect(rel.cfs).toBeCloseTo(10.0425, 3);
    const hrs = drawdownHours({ volumeCf: 150.9 * ACFT, releaseCfs: rel.cfs });
    expect(hrs / 24).toBeCloseTo(7.6, 1);
    expect(fmtDrawdown(hrs)).toBe("7.6 days");
  });

  it("the FULL physical storage takes 10.4 days at the same rate", () => {
    const rel = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34 });
    const hrs = drawdownHours({ volumeCf: 206.3 * ACFT, releaseCfs: rel.cfs });
    expect(hrs / 24).toBeCloseTo(10.4, 1);
  });

  it("flags anything past the 72-hour default: amber over it, red at twice it", () => {
    expect(DEFAULT_DRAWDOWN_MAX_HR).toBe(72);
    expect(drawdownTone(48)).toBe("ok");
    expect(drawdownTone(100)).toBe("amber");
    expect(drawdownTone(200)).toBe("red");
    expect(drawdownTone(null)).toBeNull();
  });

  it("assesses per pond AND site-wide, prorating one capped outfall across the ponds", () => {
    const rel = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34 });
    const a = assessDrawdown({
      ponds: [{ id: "p1", name: "Pond 1", volumeCf: 61.8 * ACFT }, { id: "p2", name: "Pond 2", volumeCf: 115.4 * ACFT }],
      siteVolumeCf: 150.9 * ACFT, release: rel,
    });
    expect(a.known).toBe(true);
    expect(a.optimistic).toBe(true);
    expect(a.site.tone).toBe("red"); // 7.6 days is well past twice 72 hr
    expect(a.ponds).toHaveLength(2);
    // Prorated share sums back to the capped site release.
    expect(a.ponds.reduce((s, p) => s + p.releaseCfs, 0)).toBeCloseTo(rel.cfs, 6);
    expect(a.worstTone).toBe("red");
    expect(a.note).toMatch(/longer than this constant-rate figure/);
  });

  it("no release rate → known:false with a reason, never a zero that reads as 'drains instantly'", () => {
    expect(allowableReleaseCfs({ rateCfsPerAc: null, acres: 80 })).toBeNull();
    expect(drawdownHours({ volumeCf: 100, releaseCfs: 0 })).toBeNull();
    const a = assessDrawdown({ ponds: [], release: null });
    expect(a.known).toBe(false);
    expect(a.reason).toMatch(/release rate not set/);
  });

  it("an explicit outlet capacity overrides the per-acre rate", () => {
    const rel = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34, overrideCfs: 25 });
    expect(rel.cfs).toBe(25);
    expect(rel.basis).toBe("outlet");
  });
});

/* --------------------------------------------------------------------------------------- NEW-3 */
describe("NEW-3 — mitigation by 1-ft elevation increment, not lump sum", () => {
  it("distributes a fill column across the bands it crosses, in proportion", () => {
    const r = bandSpans([{ loFt: 138.2, hiFt: 141.6, areaSf: 100 }], { bandFt: 1 });
    const at = (lo) => (r.bands.find((b) => b.loFt === lo) || { cf: 0 }).cf;
    expect(at(138)).toBeCloseTo(0.8 * 100, 6);
    expect(at(139)).toBeCloseTo(100, 6);
    expect(at(140)).toBeCloseTo(100, 6);
    expect(at(141)).toBeCloseTo(0.6 * 100, 6);
    expect(r.totalCf).toBeCloseTo(3.4 * 100, 6);
  });

  it("FAILS when a band is short even though the totals net positive — the Bain 98.2-vs-97.7 trap", () => {
    // 10 ac-ft lost high in the column; 10.2 ac-ft created low. Totals tie (and then some); the
    // elevations do not — no storage was replaced where it was taken.
    const lost = { bands: [{ loFt: 143, hiFt: 144, cf: 10 * ACFT }], totalCf: 10 * ACFT, bandFt: 1 };
    const created = { bands: [{ loFt: 138, hiFt: 139, cf: 10.2 * ACFT }], totalCf: 10.2 * ACFT, bandFt: 1, excludedBelowBottomCf: 0, unanchoredIds: [], known: true };
    const led = bandLedger({ lost, created, ratio: 1 });
    expect(led.known).toBe(true);
    expect(led.totalWouldPass).toBe(true);   // what the old lump-sum method concluded
    expect(led.overallPass).toBe(false);     // what hydraulic equivalence actually requires
    expect(led.shortBands.map((b) => b.loFt)).toEqual([143]);
    expect(led.totals.shortCf).toBeCloseTo(10 * ACFT, 3);
  });

  it("passes only when every band is covered", () => {
    const lost = { bands: [{ loFt: 143, hiFt: 144, cf: 5 * ACFT }, { loFt: 144, hiFt: 145, cf: 5 * ACFT }], totalCf: 10 * ACFT, bandFt: 1 };
    const created = { bands: [{ loFt: 143, hiFt: 144, cf: 5.5 * ACFT }, { loFt: 144, hiFt: 145, cf: 5.1 * ACFT }], totalCf: 10.6 * ACFT, bandFt: 1, excludedBelowBottomCf: 0, unanchoredIds: [], known: true };
    const led = bandLedger({ lost, created, ratio: 1 });
    expect(led.overallPass).toBe(true);
    expect(led.shortBands).toHaveLength(0);
  });

  it("excludes excavation below the floodplain bottom from credit, but still reports the dirt", () => {
    const ponds = [{ id: "p", ring: sq(400), det: det({ tobElev: 150, depth: 12 }) }];
    const withBottom = createdBands(ponds, { floodElevFt: 145, floodplainBottomFt: 141 });
    const noBottom = createdBands(ponds, { floodElevFt: 145, floodplainBottomFt: null });
    expect(withBottom.totalCf).toBeLessThan(noBottom.totalCf);
    expect(withBottom.excludedBelowBottomCf).toBeGreaterThan(0);
    // Nothing is credited below the bottom.
    expect(withBottom.bands.every((b) => b.loFt >= 141 - 1e-9)).toBe(true);
  });

  it("an unanchored pond contributes nothing and is named — never a silently-credited zero", () => {
    const c = createdBands([{ id: "p", ring: sq(400), det: { depth: 10, freeboard: 1, slope: 3 } }], { floodElevFt: 145 });
    expect(c.totalCf).toBe(0);
    expect(c.unanchoredIds).toEqual(["p"]);
  });

  it("a missing flood elevation makes the elevation-matched test UNKNOWN, not a pass", () => {
    const c = createdBands([{ id: "p", ring: sq(400), det: det() }], { floodElevFt: null });
    expect(c.known).toBe(false);
    const led = bandLedger({ lost: { bands: [], totalCf: 0, bandFt: 1 }, created: c });
    expect(led.known).toBe(false);
    expect(led.overallPass).toBeNull();
  });

  it("created bands tie out to the pond's own stage integral over the same range", () => {
    const ring = sq(400), d = det();
    const c = createdBands([{ id: "p", ring, det: d }], { floodElevFt: 145 });
    const duty = dutySplit(ring, d, { floodElevFt: 145 });
    expect(c.totalCf).toBeCloseTo(duty.mitigationCf, 3);
  });
});

/* --------------------------------------------------------------------------------------- NEW-4 */
describe("NEW-4 — the mitigation trigger elevation follows the jurisdiction", () => {
  it("Fort Bend owes the offset to the 500-yr line, not the 100-yr", () => {
    expect(mitigationOffsetBasis(DEFAULT_FLOODPLAIN_RULES.fortbend)).toBe("02pct");
    const b = offsetSurfaceBasis(DEFAULT_FLOODPLAIN_RULES.fortbend);
    expect(b.label).toMatch(/500-yr/);
    expect(b.note).toMatch(/Interim Atlas-14/);
    expect(b.authority).toBe("Fort Bend County");
  });

  it("a 1%-only jurisdiction stays on the 100-yr line", () => {
    expect(mitigationOffsetBasis(DEFAULT_FLOODPLAIN_RULES.montgomery)).toBe("1pct");
    expect(offsetSurfaceBasis(DEFAULT_FLOODPLAIN_RULES.montgomery).label).toMatch(/100-yr/);
  });

  it("an explicit rule override wins over the trigger inference", () => {
    expect(mitigationOffsetBasis({ trigger: "1pct_plus_02pct", offsetElevBasis: "1pct" })).toBe("1pct");
    expect(mitigationOffsetBasis({ trigger: "1pct", offsetElevBasis: "02pct" })).toBe("02pct");
  });

  it("changing jurisdiction changes the surface the requirement is computed from", () => {
    const surfaces = ["fortbend", "coh", "harris", "montgomery", "generic"]
      .map((k) => mitigationOffsetBasis(DEFAULT_FLOODPLAIN_RULES[k]));
    expect(surfaces).toEqual(["02pct", "02pct", "02pct", "1pct", "1pct"]);
  });
});

/* --------------------------------------------------------------------------------------- NEW-5 */
describe("NEW-5 — sloped prism, not footprint × depth", () => {
  it("surfaces the delta a straight-down extrusion would have over-stated", () => {
    const p = prismVsExtrusion(sq(400), det());
    expect(p.prismCf).toBeLessThan(p.extrudedCf);
    expect(p.deltaCf).toBeCloseTo(p.extrudedCf - p.prismCf, 6);
    expect(p.deltaPct).toBeGreaterThan(0);
    // Average depth over the drawn footprint — the reader's sanity check.
    expect(p.avgDepthFt).toBeLessThan(p.designDepthFt);
  });

  it("the over-statement is WORST on an acute-cornered triangle (the review's case)", () => {
    const d = det({ depth: 12 });
    const t = prismVsExtrusion(tri(900, 700), d);
    const s = prismVsExtrusion(sq(760), d);
    expect(t.deltaPct).toBeGreaterThan(s.deltaPct);
  });

  it("freeboard is taken off the top — the water column never includes it", () => {
    const noFb = prismVsExtrusion(sq(400), det({ freeboard: 0 }));
    const withFb = prismVsExtrusion(sq(400), det({ freeboard: 1 }));
    expect(withFb.prismCf).toBeLessThan(noFb.prismCf);
    expect(withFb.freeboardFt).toBe(1);
  });

  it("flags a pond whose design depth its footprint cannot actually grade to", () => {
    const p = prismVsExtrusion(tri(300, 200), det({ depth: 40, slope: 3 }));
    expect(p.pinched).toBe(true);
    expect(p.achievableDepthFt).toBeLessThan(p.designDepthFt);
  });
});

/* --------------------------------------------------------------------------------------- NEW-6 */
describe("NEW-6 — above/below outfall invert, and the two gravity-drain tests", () => {
  const ring = sq(400), d = det();

  it("splits storage at the invert and marks below-invert volume as dead", () => {
    const s = outfallSplit(ring, d, { outletInvertFt: 144 });
    expect(s.known).toBe(true);
    expect(s.aboveInvertCf + s.belowInvertCf).toBeCloseTo(s.totalCf, 6);
    expect(s.deadCf).toBe(s.belowInvertCf);
    expect(s.gravityShare).toBeGreaterThan(0);
    expect(s.gravityShare).toBeLessThan(1);
  });

  it("an unset invert is UNKNOWN — never an assumed pass", () => {
    const s = outfallSplit(ring, d, { outletInvertFt: null });
    expect(s.known).toBe(false);
    expect(s.gravityShare).toBeNull();
    const g = gravityTests({ split: s, duty: dutySplit(ring, d, { floodElevFt: 145 }) });
    expect(g.known).toBe(false);
    expect(g.detention.pass).toBeNull();
    expect(g.mitigation.pass).toBeNull();
    expect(g.reason).toMatch(/invert not set/);
  });

  it("detention passes the 50% gravity test with a low invert and fails with a high one", () => {
    const duty = dutySplit(ring, d, { floodElevFt: 141 }); // detention band 141 → 149
    expect(DEFAULT_MIN_GRAVITY_SHARE).toBe(0.5);
    const low = gravityTests({ split: outfallSplit(ring, d, { outletInvertFt: 141 }), duty });
    expect(low.detention.pass).toBe(true);
    expect(low.detention.share).toBeCloseTo(1, 3);
    const high = gravityTests({ split: outfallSplit(ring, d, { outletInvertFt: 148 }), duty });
    expect(high.detention.pass).toBe(false);
    expect(high.detention.share).toBeLessThan(0.5);
    expect(high.detention.basis).toMatch(/Interim Atlas-14/);
  });

  it("mitigation must FULLY gravity-drain: any dead mitigation volume fails, pumps not allowed", () => {
    const duty = dutySplit(ring, d, { floodElevFt: 145 }); // mitigation band 140 → 145
    const bad = gravityTests({ split: outfallSplit(ring, d, { outletInvertFt: 143 }), duty });
    expect(bad.mitigation.pass).toBe(false);
    expect(bad.mitigation.deadCf).toBeGreaterThan(0);
    expect(bad.mitigation.creditableCf).toBeLessThan(bad.mitigation.bandCf);
    expect(bad.mitigation.basis).toMatch(/pumps are not allowed/);
    const good = gravityTests({ split: outfallSplit(ring, d, { outletInvertFt: 140 }), duty });
    expect(good.mitigation.pass).toBe(true);
    expect(good.mitigation.deadCf).toBeCloseTo(0, 3);
  });

  it("an invert ABOVE the whole mitigation band kills all of its credit", () => {
    const duty = dutySplit(ring, d, { floodElevFt: 143 });
    const g = gravityTests({ split: outfallSplit(ring, d, { outletInvertFt: 146 }), duty });
    expect(g.mitigation.deadCf).toBeCloseTo(duty.mitigationCf, 3);
    expect(g.mitigation.creditableCf).toBeCloseTo(0, 3);
  });

  it("pondStageModel assembles stage + duty + outfall + gravity + prism in one read", () => {
    const m = pondStageModel(ring, d, { floodElevFt: 145, outletInvertFt: 143, id: "p2", name: "Pond 2" });
    expect(m.id).toBe("p2");
    expect(m.stage.bands.length).toBeGreaterThan(0);
    expect(m.duty.overlapCf).toBe(0);
    expect(m.outfall.known).toBe(true);
    expect(m.gravity.known).toBe(true);
    expect(m.prism.deltaCf).toBeGreaterThan(0);
    // Everything reads ONE integral: duty bands sum to the stage total.
    expect(m.duty.detentionCf + m.duty.mitigationCf).toBeCloseTo(m.stage.totalCf, 3);
  });
});

/* --------------------------------------------------------------------------------------- NEW-7 */
describe("NEW-7 — signed margin replaces the flat OK/FAIL chip", () => {
  it("a +97% surplus and a +0.5% surplus do NOT render the same chip", () => {
    const fat = marginFor(150.9, 76.7, { key: "det" });
    const thin = marginFor(98.2, 97.7, { key: "mit" });
    expect(fat.band).toBe("ok");
    expect(thin.band).toBe("thin");
    expect(thin.pct).toBeCloseTo(0.00512, 4);
    expect(fmtMargin(thin)).toBe("+0.5 ac-ft (+0.5%)");
    expect(fmtMargin(fat)).toBe("+74.2 ac-ft (+97%)");
  });

  it("a shortfall bands as short and reports the signed absolute", () => {
    const m = marginFor(60, 76.7, { key: "det" });
    expect(m.band).toBe("short");
    expect(m.absAcFt).toBeCloseTo(-16.7, 6);
    expect(fmtMargin(m)).toMatch(/^−16\.7 ac-ft \(−22%\)$/);
  });

  it("thresholds are configurable per check type", () => {
    expect(thinThresholdFor("det")).toBe(0.05);
    expect(thinThresholdFor("mit", { mit: 0.2 })).toBe(0.2);
    expect(marginFor(98.2, 97.7, { key: "mit", overrides: { mit: 0.001 } }).band).toBe("ok");
    expect(marginFor(150.9, 76.7, { key: "det", overrides: { det: 2 } }).band).toBe("thin");
  });

  it("the verdict strip renders THIN, not green OK, on a razor-thin mitigation surplus", () => {
    const strip = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 76.7 },
      providedUsableCf: 150.9 * ACFT,
      mitigation: { intersectAcres: 12, volumeCf: 97.7 * ACFT, volumeAcFt: 97.7, flags: [] },
      mitProvided: { creditedCf: 98.2 * ACFT },
    });
    const det_ = strip.find((r) => r.key === "det");
    const mit = strip.find((r) => r.key === "mit");
    expect(det_.pill).toBe("OK");
    expect(mit.pill).toBe("THIN");
    expect(mit.marginText).toBe("+0.5 ac-ft (+0.5%)");
  });
});

/* ------------------------------------------------------------------------- NEW-1 in the verdict */
describe("NEW-1 in the strip — a reconciliation failure forces a hard FAIL", () => {
  it("turns two green OKs into FAILs naming the double-counted volume", () => {
    const strip = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 76.7 },
      providedUsableCf: 150.9 * ACFT,
      mitigation: { intersectAcres: 12, volumeCf: 97.7 * ACFT, volumeAcFt: 97.7, flags: [] },
      mitProvided: { creditedCf: 98.2 * ACFT },
      reconcile: {
        state: "fail", overlapCf: 42.8 * ACFT, physicalCf: 206.3 * ACFT, claimedCf: 249.1 * ACFT,
        offenders: [{ id: "p2", name: "Pond 2" }], undeclared: [], message: "…",
      },
    });
    for (const key of ["det", "mit"]) {
      const row = strip.find((r) => r.key === key);
      expect(row.pill).toBe("FAIL");
      expect(row.tone).toBe("danger");
      expect(row.reconcileFail.overlapAcFt).toBeCloseTo(42.8, 1);
      expect(row.reconcileFail.ponds).toContain("Pond 2");
      expect(row.sentence).toMatch(/counted twice/);
    }
  });

  it("a failing band ledger demotes a numerically-OK mitigation row to SHORT", () => {
    const strip = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 10 },
      providedUsableCf: 20 * ACFT,
      mitigation: { intersectAcres: 12, volumeCf: 97.7 * ACFT, volumeAcFt: 97.7, flags: [] },
      mitProvided: { creditedCf: 98.2 * ACFT },
      mitBands: { known: true, overallPass: false, shortBands: [{ loFt: 143 }, { loFt: 144 }], totalWouldPass: true, totals: { shortCf: 8 * ACFT } },
    });
    const mit = strip.find((r) => r.key === "mit");
    expect(mit.pill).toBe("SHORT");
    expect(mit.bandFail.shortBands).toBe(2);
    expect(mit.bandFail.totalWouldPass).toBe(true);
    expect(mit.sentence).toMatch(/2 elevation bands short/);
  });

  it("an unresolvable offset surface never reads as a clean pass", () => {
    const strip = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 10 },
      providedUsableCf: 20 * ACFT,
      mitigation: { intersectAcres: 12, volumeCf: 50 * ACFT, volumeAcFt: 50, flags: ["offset-basis-unresolved"] },
      mitProvided: { creditedCf: 200 * ACFT },
    });
    const mit = strip.find((r) => r.key === "mit");
    expect(mit.understated).toBe(true);
    expect(mit.pill).toBe("THIN");
  });
});

/* --------------------------------------------------------------------------------------- NEW-8 */
describe("NEW-8 — name the governing floodplain administrator and the FFE rule it implies", () => {
  const rules = DEFAULT_BUILDABILITY_RULES;

  it("collects every candidate the header names — county, ETJ, and edge-only city", () => {
    const c = administratorCandidates({
      floodJurKey: "fortbend", county: "Fort Bend", etjLabel: "City of Houston", edgeLabels: ["City of Katy"], rules,
    });
    const keys = c.map((x) => `${x.key}:${x.kind}`);
    expect(keys).toContain("fortbend:primary");
    expect(keys).toContain("coh:etj"); // "City of Houston" resolves to the coh rule record
    expect(c.find((x) => x.kind === "etj").label).toMatch(/ETJ/);
    // Katy has no modeled floodplain rule — it is FLAGGED, not silently dropped.
    const katy = c.find((x) => x.kind === "edge");
    expect(katy.ruleModeled).toBe(false);
    expect(katy.label).toMatch(/edge only/);
  });

  it("back-solves the implied BFE from the assumed FFE — 144.8 implies ≤ 142.8 under +2 ft", () => {
    const i = impliedFloodElevation({ ffeFt: 144.8, plusFt: 2 });
    expect(i.impliedFloodElevFt).toBeCloseTo(142.8, 6);
    expect(i.relation).toBe("at-or-below");
    expect(i.note).toMatch(/142\.8/);
  });

  it("flags more than one candidate and picks the STRICTER deliberately", () => {
    const c = administratorCandidates({ floodJurKey: "fortbend", county: "Fort Bend", etjLabel: "City of Houston", rules });
    const r = resolveAdministrator(c, { requiredFfeAt: (x) => (x.key === "fortbend" ? 144.8 : x.key === "coh" ? 146.5 : null) });
    expect(r.ambiguous).toBe(true);
    expect(r.selectionReason).toMatch(/stricter standard was chosen deliberately/);
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it("summarises a max-of rule and a single-basis rule comparably", () => {
    const fb = ffeSummary(rules.fortbend);
    expect(fb.kind).toBe("max-of");
    expect(fb.plusFt).toBe(4);
    const coh = ffeSummary(rules.coh);
    expect(coh.kind).toBe("single");
    expect(coh.plusFt).toBe(2);
    expect(coh.rule).toBe("wse02pct + 2 ft");
  });

  it("the one panel call returns the governing name, its rule text, and the implied BFE", () => {
    const a = assessAdministrator({
      signals: { floodJurKey: "fortbend", county: "Fort Bend", etjLabel: "City of Houston", edgeLabels: ["City of Katy"] },
      rules, ffeFt: 144.8,
    });
    expect(a.governingLabel).toBeTruthy();
    expect(a.governingRuleText).toBeTruthy();
    expect(a.impliedFlood.impliedFloodElevFt).toBeLessThan(144.8);
    expect(a.ambiguous).toBe(true);
  });

  it("no administrator resolved is stated, not guessed", () => {
    const r = resolveAdministrator([]);
    expect(r.governing).toBeNull();
    expect(r.selectionReason).toMatch(/no floodplain administrator resolved/);
  });
});

/* --------------------------------------------------------------------------------------- NEW-9 */
describe("NEW-9 — the dock apron is checked separately from the building pad", () => {
  it("puts Bain's apron near 140.8 from a 144.8 FFE", () => {
    expect(apronElevFt({ ffeFt: 144.8 })).toBeCloseTo(140.8, 6);
  });

  it("reports EXPOSURE (not a code failure) when the apron sits below the flood elevation", () => {
    const a = assessApron({ ffeFt: 144.8, floodElevFt: 142.8, floodLabel: "BFE", trailerStalls: 70 });
    expect(a.status).toBe("exposed");
    expect(a.belowByFt).toBeCloseTo(2, 6);
    expect(a.note).toMatch(/may be code-legal/);
    expect(a.note).toMatch(/70 trailer stalls/);
  });

  it("calls out a clearance an as-built survey would erase", () => {
    const a = assessApron({ ffeFt: 144.8, floodElevFt: 140.4 });
    expect(a.status).toBe("thin");
    expect(a.clearByFt).toBeCloseTo(0.4, 6);
  });

  it("clears cleanly when it clears", () => {
    expect(assessApron({ ffeFt: 148, floodElevFt: 140 }).status).toBe("clear");
  });

  it("an unknown flood elevation is never a pass", () => {
    const a = assessApron({ ffeFt: 144.8, floodElevFt: null });
    expect(a.status).toBe("unknown");
    expect(a.note).toMatch(/nothing to check it against/);
  });

  it("pavement and truck courts belong in the mitigation fill set, and it says when they're missing", () => {
    expect(APRON_FILL_TYPES.has("dockzone")).toBe(true);
    const partial = apronFillIncluded(new Set(["building", "dockzone"]));
    expect(partial.included).toBe(true);
    expect(partial.complete).toBe(false);
    expect(partial.missing).toContain("paving");
    expect(apronFillIncluded(null).included).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------- NEW-10 */
describe("NEW-10 — cut/fill balance, and labelling a borrow-driven surplus", () => {
  it("reproduces the Bain balance: ~333,000 CY of pond cut vs ~290,000 CY of pad fill", () => {
    const cutCf = 206.3 * ACFT;
    expect(cutCf / 27).toBeCloseTo(332_842, -3);
    const fillCf = padFillDemandCf({ padAcres: 60, raiseFt: 3 });
    expect(fillCf / 27).toBeCloseTo(290_400, -2);
    const b = cutFillBalance({ cutCf, fillCf });
    expect(b.state).toBe("balanced");
    expect(b.netCy).toBeGreaterThan(0);
  });

  it("labels the 197% detention overbuild BORROW-DRIVEN, not slack", () => {
    const r = assessCutFill({
      cutCf: 206.3 * ACFT, fillCf: padFillDemandCf({ padAcres: 60, raiseFt: 3 }),
      requiredCf: 76.7 * ACFT, providedCf: 150.9 * ACFT,
    });
    expect(r.surplus.driver).toBe("borrow");
    expect(r.surplus.slack).toBe(false);
    expect(r.surplus.surplusPct).toBeCloseTo(0.967, 2);
    expect(r.surplus.importIfShrunkCy).toBeGreaterThan(100_000);
    expect(r.surplus.note).toMatch(/BORROW-DRIVEN/);
    expect(r.surplus.note).toMatch(/imported fill/);
  });

  it("calls a genuine surplus slack when the cut far exceeds the fill demand", () => {
    const r = assessCutFill({ cutCf: 400 * ACFT, fillCf: 40 * ACFT, requiredCf: 76.7 * ACFT, providedCf: 150.9 * ACFT });
    expect(r.balance.state).toBe("surplus");
    expect(r.surplus.driver).toBe("hydraulic");
    expect(r.surplus.slack).toBe(true);
  });

  it("applies a shrink factor visibly and reports an import when the cut falls short", () => {
    // A modest shrink still reads as balanced (within the tolerance) — but the net turns negative.
    const modest = cutFillBalance({ cutCf: 100 * ACFT, fillCf: 100 * ACFT, shrinkFactor: 0.85 });
    expect(modest.shrinkFactor).toBe(0.85);
    expect(modest.netCy).toBeLessThan(0);
    expect(modest.state).toBe("balanced");
    // A heavy shrink puts the site genuinely into import.
    const heavy = cutFillBalance({ cutCf: 100 * ACFT, fillCf: 100 * ACFT, shrinkFactor: 0.6 });
    expect(heavy.state).toBe("import");
    expect(heavy.netCy).toBeLessThan(modest.netCy);
  });

  it("an unknown input returns known:false, never a zero balance", () => {
    const b = cutFillBalance({ cutCf: null, fillCf: 100 });
    expect(b.known).toBe(false);
    expect(b.reason).toMatch(/excavation volume unknown/);
    expect(classifyStorageSurplus({ requiredCf: 10, providedCf: 5 })).toBeNull();
    expect(classifyStorageSurplus({ requiredCf: 10, providedCf: 20, balance: b }).driver).toBe("unknown");
  });
});

/* ═══ B209508 — the floodplain administrator refuses to settle on an incomplete jurisdiction ═══
 *
 * The stakes, from this module's own header: Fort Bend County requires BFE + 2 ft, while City of
 * Houston Ch. 19 requires the 500-yr WSE + 2 ft — which in flat Fort Bend floodplain commonly lands
 * 1–2 ft HIGHER. At the Bain site the City of Houston ETJ is what raises the Houston candidate, and
 * that ETJ lookup is measurably flaky (0 at three of six points in the owner's Houston sweep). When
 * it fails, silence used to read as "no ETJ" and the county's laxer rule was reported as settled. */
/* ═══ NEW-1c — AN AUTHORITY WITH NO TRANSCRIBED RULE MUST SAY SO ════════════════════════════════
 *
 * The owner's Goose Creek is part inside the City of Baytown's limits and 100% inside Baytown's ETJ.
 * `RULE_KEY_ALIAS` had no `baytown` entry, so Baytown resolved to nothing and — by this module's own
 * contract — could never govern. The site took its finished floors from Harris County with NOTHING
 * anywhere recording that a city ordinance had been skipped.
 *
 * `administratorCandidates` had always stamped `ruleModeled` with a comment promising an unmodelled
 * candidate "is flagged, never dropped". The flag was real and **nothing read it** — it appears
 * nowhere else in the tree. That is the defect these cases pin, and it is not Baytown-only:
 * `montgomery` and `chambers` carry `ffeRule: null` too.
 *
 * ⛔ AND THE NUMBERS ARE DELIBERATELY ABSENT. The owner's recollection is "~2 ft above the 500-year"
 * and he asked for that to be CHECKED against the adopted ordinance, not confirmed. Municode and
 * baytown.org are both refused by this environment's egress allowlist, so the rule is recorded as
 * NOT TRANSCRIBED. The last case guards that: if someone fills the numbers in from memory, it goes
 * red. */
describe("NEW-1c — an authority we have no rule for blocks a settled FFE and is named", () => {
  const rules = DEFAULT_BUILDABILITY_RULES;
  // Goose Creek's real shape: Harris County, partly inside Baytown's limits, wholly in its ETJ.
  const gooseCreek = (over = {}) => assessAdministrator({
    signals: {
      floodJurKey: "harris", county: "Harris",
      cityLabel: "Baytown", etjLabel: "Baytown", edgeLabels: [],
      jurisdictionSplit: { city: "Baytown", inCity: 6, tested: 14 }, ...over,
    },
    rules,
  });

  it("Baytown is RAISED as a candidate at all — before this it resolved to nothing", () => {
    const a = gooseCreek();
    expect(a.candidates.some((c) => c.key === "baytown" && c.kind === "primary")).toBe(true);
    expect(a.candidates.some((c) => c.key === "baytown" && c.kind === "etj")).toBe(true);
  });

  it("an unmodelled PRIMARY/ETJ candidate blocks `settled` and is named", () => {
    const a = gooseCreek();
    expect(a.unmodelledCandidates.map((u) => u.key)).toContain("baytown");
    expect(a.settled).toBe(false);
    expect(a.unmodelledNote).toMatch(/No floodplain rule is modeled for/);
    expect(a.unmodelledNote).toMatch(/floor, not the answer/);
    // The provisional answer is still computed — the reader needs what we DID find.
    expect(a.governingLabel).toBe("Harris County (unincorporated)");
  });

  it("the same site with Baytown invisible settles — this is the regression, stated", () => {
    const before = assessAdministrator({ signals: { floodJurKey: "harris", county: "Harris" }, rules });
    expect(before.settled).toBe(true);
    expect(before.candidates.some((c) => c.key === "baytown")).toBe(false);
  });

  it("an EDGE-only candidate with no rule does NOT block settling — Bain must not regress", () => {
    /* Bain touches Katy at an edge and Katy has no modelled rule. An edge sliver is explicitly not
     * expected to govern (B793/B209506), so demanding its ordinance would fire on nearly every site
     * and train the reader to ignore the warning. */
    const bainSite = assessAdministrator({
      signals: { floodJurKey: "fortbend", county: "Fort Bend", cityLabel: null, etjLabel: "Houston", edgeLabels: ["Katy"] },
      rules,
    });
    expect(bainSite.candidates.some((c) => c.key === "katy" && c.kind === "edge")).toBe(true);
    expect(bainSite.unmodelledCandidates).toEqual([]);
    expect(bainSite.settled).toBe(true);
    expect(bainSite.governingLabel).toBe("Fort Bend County");
  });

  it("⛔ Baytown's rule is NOT transcribed, and must not be filled in from recollection", () => {
    expect(rules.baytown).toBeTruthy();
    expect(rules.baytown.ffeRule).toBe(null);
    expect(rules.baytown.verified).toBe(false);
    expect(rules.baytown.source).toMatch(/NOT TRANSCRIBED/);
  });

  /* ⛔ NEW-1d — THE RENDER GATES ARE PART OF THE CONTRACT, and getting them wrong hid this item's
   * whole point on the one plan it was built for. `split` and `unmodelled` are INDEPENDENT facts —
   * how many authorities govern, versus whether we hold their rules — and the panel had them
   * mutually exclusive. Goose Creek is both, so the "no rule on file for Baytown" line never
   * rendered there. These cases assert the gate CONDITIONS the panel evaluates. */
  it("split and unmodelled are independent — Goose Creek is BOTH and must show both", () => {
    const a = gooseCreek();
    expect(a.split).toBe(true);
    expect(a.unmodelledCandidates.length).toBeGreaterThan(0);
    // The panel gate for the unmodelled line must not exclude a split site.
    const unmodelledLineShows = !a.unresolved && a.unmodelledCandidates.length > 0;
    expect(unmodelledLineShows).toBe(true);
  });

  it("the DEFAULT while unanswered is the authority we DO have, named — never a blank", () => {
    /* A blank reads as "no requirement", which is the one answer that is certainly wrong. The
     * governing authority, its rule and its elevation stay available so the panel can state them. */
    const a = gooseCreek();
    expect(a.governingLabel).toBe("Harris County (unincorporated)");
    expect(a.governingRuleText).toBe("wse02pct + 2 ft");
    expect(a.settled).toBe(false);          // not settled…
    expect(a.governing).toBeTruthy();       // …but never empty
  });

  it("an UNMODELLED-but-not-split site still refuses a settled floor", () => {
    /* The gap this closes: not split, nothing failed, so the verdict row fell through to
     * "pads pass at X′ FFE" — a settled claim with a governing city's rule missing from the
     * comparison behind it. */
    const whollyInBaytown = assessAdministrator({
      signals: { floodJurKey: "harris", county: "Harris", cityLabel: "Baytown", etjLabel: null },
      rules,
    });
    expect(whollyInBaytown.split).toBe(false);
    expect(whollyInBaytown.unresolved).toBe(false);
    expect(whollyInBaytown.unmodelledCandidates.map((u) => u.key)).toContain("baytown");
    expect(whollyInBaytown.settled).toBe(false);
  });

  it("the comparison that answers 'how many feet do the pads move': Harris is ALREADY 500-yr + 2 ft", () => {
    /* This is the fact that reframes the owner's concern. He expected Baytown (~500-yr + 2 ft) to be
     * materially STRICTER than the basis in use. Harris County's modelled rule — verified, cited at
     * §4.07(b)(1) — is the SAME datum and the SAME freeboard, so if his recollection is right the
     * required floor does not move at all. The exposure is only if Baytown differs from that. */
    expect(rules.harris.ffeRule).toEqual({ basis: "wse02pct", plusFt: 2 });
    expect(rules.harris.verified).toBe(true);
  });
});

describe("B209508 — an unknown jurisdiction input is a first-class state", () => {
  const rules = DEFAULT_BUILDABILITY_RULES;
  const bain = (unresolvedRoles, etjLabel) => assessAdministrator({
    signals: { county: "Fort Bend", etjLabel, edgeLabels: ["Katy"], unresolvedRoles },
    rules, ffeFt: 144.8,
  });

  it("with the Houston ETJ present, the Ch. 19 candidate is RAISED and the answer is settled", () => {
    const a = bain([], "Houston");
    // The ETJ resolves through RULE_KEY_ALIAS to the `coh` record — not silently dropped.
    const coh = a.candidates.find((c) => c.key === "coh");
    expect(coh).toBeTruthy();
    expect(coh.kind).toBe("etj");
    expect(coh.ffe.rule).toBe("wse02pct + 2 ft");   // Ch. 19's 500-yr basis
    expect(a.settled).toBe(true);
    expect(a.unresolved).toBe(false);
    // More than one authority is genuinely in play, so the panel must still flag it.
    expect(a.ambiguous).toBe(true);
  });

  it("with the ETJ lookup FAILED, the result refuses to settle", () => {
    const a = bain(["etj"], null);
    expect(a.unresolved).toBe(true);
    expect(a.unresolvedRoles).toEqual(["etj"]);
    expect(a.settled).toBe(false);
    expect(a.unresolvedNote).toMatch(/NOT settled/);
    expect(a.unresolvedNote).toMatch(/stricter authority may apply/);
    // The provisional answer is still computed — the reader needs to know what WAS found.
    expect(a.governingLabel).toBeTruthy();
  });

  it("the ONLY difference between the two is the failed role — the county candidate is identical", () => {
    // Proves the refusal is driven by the unknown input, not by a changed candidate set.
    const withEtjFailed = bain(["etj"], null);
    const withNothing = bain([], null);
    expect(withEtjFailed.governingLabel).toBe(withNothing.governingLabel);
    expect(withNothing.settled).toBe(true);
    expect(withEtjFailed.settled).toBe(false);
  });

  it("flags a freeboard-only comparison when the candidates rest on DIFFERENT flood surfaces", () => {
    // Fort Bend's rule is a max-of over 100-yr bases; Houston Ch. 19 is a 500-yr basis. Without a
    // requiredFfeAt resolver only their FREEBOARD is compared, so "the stricter rule was used"
    // cannot stand unqualified — a smaller freeboard on a higher surface can still govern.
    const a = bain([], "Houston");
    expect(a.comparedBy).toBe("declared freeboard");
    expect(a.basisMismatch).toBe(true);
    expect(a.basisNote).toMatch(/different flood surfaces/i);
  });

  it("a single-authority site with one basis is NOT flagged as a mismatch", () => {
    const a = assessAdministrator({ signals: { county: "Waller", unresolvedRoles: [] }, rules, ffeFt: 140 });
    expect(a.basisMismatch).toBe(false);
    expect(a.basisNote).toBeNull();
  });
});
