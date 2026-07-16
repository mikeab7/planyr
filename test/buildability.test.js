// B710 — the buildability pathway: required-FFE compare paths, foundation-pathway
// flags per seed, the LOMR-F trigger, the wetlands-404 cross-flag. Pure.
// B759 — multi-basis MAX()-of-bases FFE (Fort Bend §3.02(b)); B760 — Fort Bend
// FFE base set + the Harris verified flip.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUILDABILITY_RULES,
  loadBuildabilityRules,
  requiredFfe,
  assessBuildability,
  suggestedFfe,
  siteBasisFfe,
  OUTSIDE_FLOODPLAIN_FFE_NOTE,
  SITE_BASED_FFE_NOTE,
  LOMR_NOTE,
  WETLANDS_404_NOTE,
} from "../src/workspaces/site-planner/lib/buildability.js";

const coh = DEFAULT_BUILDABILITY_RULES.coh;
const harris = DEFAULT_BUILDABILITY_RULES.harris;
const fortbend = DEFAULT_BUILDABILITY_RULES.fortbend;

describe("rule seeds", () => {
  it("COH & Harris measure the FFE from the 0.2% WSE + 2 ft", () => {
    for (const r of [coh, harris]) {
      expect(r.ffeRule).toEqual({ basis: "wse02pct", plusFt: 2 });
      expect(r.note).toMatch(/dry-floodproofing/i); // NFIP alternative noted, not modeled
    }
    expect(coh.fillToElevate).toBe("allowed_with_mitigation");
    expect(harris.fillToElevate).toBe("restricted");
    expect(harris.pathwayNote).toMatch(/LOMR/);
  });
  it("COH stays UNVERIFIED (placeholder); Harris is now verified (B760)", () => {
    expect(coh.verified).toBe(false);
    expect(harris.verified).toBe(true);
    expect(harris.pathwayNote).toMatch(/No fill may be used to elevate/); // §4.07(b)(9) verbatim
    expect(harris.note).toMatch(/street crown/); // crown-alternate copy
    expect(harris.note).toMatch(/critical facilities/i); // zone-specials copy
    expect(harris.sourceDate).toBe("2019-07-09");
  });
  it("generic still models NOTHING (honest, not fabricated)", () => {
    expect(DEFAULT_BUILDABILITY_RULES.generic.ffeRule).toBeNull();
    expect(loadBuildabilityRules().generic.ffeRule).toBeNull();
  });
});

describe("requiredFfe + the compare paths (single-basis)", () => {
  it("pass: pad at/above the 0.2% WSE + 2 ft", () => {
    expect(requiredFfe(coh, { wse02Ft: 98 }).requiredFfeFt).toBe(100);
    const a = assessBuildability({ rule: coh, padFfeFt: 100, wse02Ft: 98 });
    expect(a.ffe.status).toBe("pass");
    expect(a.ffe.shortByFt).toBeNull();
  });
  it("short-by-X-ft: pad below the requirement", () => {
    const a = assessBuildability({ rule: coh, padFfeFt: 98.5, wse02Ft: 98 });
    expect(a.ffe.status).toBe("short");
    expect(a.ffe.shortByFt).toBeCloseTo(1.5, 6);
  });
  it("unknown-WSE: the 0.2% elevation isn't entered — never a fabricated pass", () => {
    const a = assessBuildability({ rule: coh, padFfeFt: 100 });
    expect(a.ffe.status).toBe("unknown");
    expect(a.ffe.unknownReason).toMatch(/0\.2%/);
  });
  it("unknown-pad: rule + WSE known but no pad FFE entered", () => {
    const a = assessBuildability({ rule: coh, wse02Ft: 98 });
    expect(a.ffe.status).toBe("unknown");
    expect(a.ffe.unknownReason).toMatch(/pad/);
  });
  it("no modeled rule → no_rule with the verify-locally reason", () => {
    const a = assessBuildability({ rule: DEFAULT_BUILDABILITY_RULES.generic, padFfeFt: 100, wse02Ft: 98 });
    expect(a.ffe.status).toBe("no_rule");
    expect(a.ffe.unknownReason).toMatch(/verify locally/);
  });
});

describe("NEW-3 — auto pad defaults to the code-minimum FFE (status 'assumed')", () => {
  it("padIsAuto flips a would-be pass into an 'assumed' verdict, keeping the required FFE + basis", () => {
    // Caller defaults the pad to the code minimum (= requiredFfeFt) and flags it auto.
    const a = assessBuildability({ rule: coh, padFfeFt: 100, padIsAuto: true, wse02Ft: 98 });
    expect(a.ffe.status).toBe("assumed");
    expect(a.ffe.requiredFfeFt).toBe(100);
    expect(a.ffe.basis).toBe("wse02pct");
    expect(a.ffe.shortByFt).toBeNull();
  });
  it("a REAL (typed) pad is unaffected — padIsAuto:false still passes / falls short", () => {
    expect(assessBuildability({ rule: coh, padFfeFt: 100, padIsAuto: false, wse02Ft: 98 }).ffe.status).toBe("pass");
    expect(assessBuildability({ rule: coh, padFfeFt: 98.5, padIsAuto: false, wse02Ft: 98 }).ffe.status).toBe("short");
    // default padIsAuto (omitted) is false — unchanged behavior
    expect(assessBuildability({ rule: coh, padFfeFt: 100, wse02Ft: 98 }).ffe.status).toBe("pass");
  });
  it("no computable WSE → still unknown even with padIsAuto (nothing to assume from)", () => {
    const a = assessBuildability({ rule: coh, padFfeFt: null, padIsAuto: false });
    expect(a.ffe.status).toBe("unknown");
    expect(a.ffe.requiredFfeFt).toBeNull();
  });
  it("Fort Bend multi-basis: the assumed pad reflects the MAX-of governing basis", () => {
    // wse1pct 110+2=112 governs over wse02pct 100+2=102; auto pad = 112 → assumed
    const a = assessBuildability({ rule: fortbend, padFfeFt: 112, padIsAuto: true, wse02Ft: 100, wse1pctFt: 110 });
    expect(a.ffe.status).toBe("assumed");
    expect(a.ffe.requiredFfeFt).toBeCloseTo(112, 6);
    expect(a.ffe.governingBasis.basis).toBe("wse1pct");
  });
});

describe("single-basis back-compat (B759 additive)", () => {
  it("the COH single-basis path is unchanged, plus governingBasis:null / pendingBases:[]", () => {
    const r = requiredFfe(coh, { wse02Ft: 98 });
    expect(r.requiredFfeFt).toBe(100);
    expect(r.basis).toBe("wse02pct");
    expect(r.plusFt).toBe(2);
    expect(r.governingBasis).toBeNull();
    expect(r.pendingBases).toEqual([]);
    expect(r.unknownReason).toBeNull();
  });
  it("a single wse1pct basis reads from wse1pctFt (extended input map)", () => {
    const rule = { ffeRule: { basis: "wse1pct", plusFt: 1 } };
    expect(requiredFfe(rule, { wse1pctFt: 50 }).requiredFfeFt).toBe(51);
    // null input → honest unknown, never a fabricated number
    const miss = requiredFfe(rule, {});
    expect(miss.requiredFfeFt).toBeNull();
    expect(miss.unknownReason).toMatch(/1%/);
  });
});

describe("Fort Bend multi-basis FFE — MAX over computable bases (B759/B760)", () => {
  it("Fort Bend now models a MULTI-basis rule and is verified", () => {
    expect(Array.isArray(fortbend.ffeRule.bases)).toBe(true);
    expect(fortbend.verified).toBe(true);
    expect(fortbend.fillToElevate).toBe("allowed_with_mitigation");
    expect(fortbend.pathwayNote).toMatch(/1:1/); // NEW-2 offset pathway
    expect(fortbend.pathwayNote).toMatch(/\$150/); // County-Engineer floodplain permit fee
    // the resolved freeboards land exactly where the spec pins them
    const byBasis = Object.fromEntries(fortbend.ffeRule.bases.map((b) => [b.basis, b.plusFt]));
    expect(byBasis.atlas14_100yr).toBe(2);        // RESOLVED +2.0 (not +2.5)
    expect(byBasis.pre_atlas14_100yr).toBe(2.5);  // the +2.5 lives HERE
    expect(byBasis.wse02pct).toBe(2);             // pre-Atlas-14 500-yr +2.0
    expect(byBasis.wse1pct).toBe(2);              // FEMA FIRM BFE +2.0 — §5.02(c)(1), signed 10-08-2024 (was +1.5 per the superseded 2023-09 18-in rule)
    expect(byBasis.zone_a_est_bfe).toBe(4);       // Zone-A no-data +4.0
    expect(byBasis.site).toBe(2);                 // outside-SFHA §5.01 +2.0
  });

  it("the §5.02(c)(1)/§5.01(c)(3) provenance rides the record (owner-confirmed 2026-07-12)", () => {
    expect(fortbend.source).toMatch(/§5\.02\(c\)/);
    expect(fortbend.note).toMatch(/§5\.02\(c\)\(1\)/);                 // FIRM BFE +2.0 pinned to its subsection
    expect(fortbend.note).toMatch(/down-gradient roadway/i);           // §5.01(c)(3) +1 ft basis (copy, not modeled)
    expect(fortbend.note).toMatch(/confirmed against the primary/i);   // lettering caveat resolved, not dropped silently
    expect(fortbend.note).not.toMatch(/confirm subsection lettering/i);
    expect(harris.note).not.toMatch(/confirm subsection lettering/i);
  });

  it("MAX governs: the larger of two computable bases wins, with the correct governingBasis", () => {
    // wse1pct 110 + 2 = 112 ; wse02pct 100 + 2 = 102 → 112 governs (wse1pct)
    const r = requiredFfe(fortbend, { wse02Ft: 100, wse1pctFt: 110 });
    expect(r.requiredFfeFt).toBeCloseTo(112, 6);
    expect(r.governingBasis.basis).toBe("wse1pct");
    expect(r.unknownReason).toBeNull();
    // and the other direction: bump wse02pct so IT governs
    const r2 = requiredFfe(fortbend, { wse02Ft: 130, wse1pctFt: 110 });
    expect(r2.requiredFfeFt).toBeCloseTo(132, 6);
    expect(r2.governingBasis.basis).toBe("wse02pct");
  });

  it("pendingBases surfaces every null-input basis as copy, never fabricated", () => {
    const r = requiredFfe(fortbend, { wse02Ft: 105 }); // only the 500-yr basis computable
    expect(r.requiredFfeFt).toBeCloseTo(107, 6);
    expect(r.governingBasis.basis).toBe("wse02pct");
    const pending = r.pendingBases.map((p) => p.basis);
    expect(pending).toContain("atlas14_100yr");
    expect(pending).toContain("pre_atlas14_100yr");
    expect(pending).toContain("wse1pct");
    expect(pending).toContain("zone_a_est_bfe");
    expect(pending).toContain("site");
    expect(pending).not.toContain("wse02pct"); // the one that computed is NOT pending
    // every pending row carries usable copy (label + freeboard), no fabricated FFE
    expect(r.pendingBases.every((p) => typeof p.label === "string" && p.label.length > 0 && isFinite(p.plusFt))).toBe(true);
  });

  it("honest-null when NO basis is computable — lists what's needed, never a fabricated FFE", () => {
    const r = requiredFfe(fortbend, {}); // nothing supplied
    expect(r.requiredFfeFt).toBeNull();
    expect(r.governingBasis).toBeNull();
    expect(r.pendingBases).toHaveLength(6);
    expect(r.unknownReason).toMatch(/need one of/i);
    // and assessBuildability reports "unknown" (a rule exists) — not a pass
    const a = assessBuildability({ rule: fortbend, padFfeFt: 100 });
    expect(a.ffe.status).toBe("unknown");
    expect(a.ffe.requiredFfeFt).toBeNull();
    expect(a.ffe.governingBasis).toBeNull();
    expect(a.ffe.pendingBases).toHaveLength(6);
  });

  it("assessBuildability threads the extended inputs bag and compares the pad to the MAX", () => {
    // 500-yr 100+2 = 102 ; Atlas-14 100-yr 103+2 = 105 → 105 governs; pad 104 is 1 ft short
    const a = assessBuildability({ rule: fortbend, padFfeFt: 104, wse02Ft: 100, atlas14Wse100Ft: 103 });
    expect(a.ffe.status).toBe("short");
    expect(a.ffe.requiredFfeFt).toBeCloseTo(105, 6);
    expect(a.ffe.basis).toBe("atlas14_100yr");
    expect(a.ffe.shortByFt).toBeCloseTo(1, 6);
    // a pad clearing the MAX passes
    const pass = assessBuildability({ rule: fortbend, padFfeFt: 106, wse02Ft: 100, atlas14Wse100Ft: 103 });
    expect(pass.ffe.status).toBe("pass");
  });
});

describe("pathway, LOMR-F, and the wetlands cross-flag", () => {
  it("the foundation-pathway flag mirrors each seed", () => {
    expect(assessBuildability({ rule: coh }).pathway.fillToElevate).toBe("allowed_with_mitigation");
    expect(assessBuildability({ rule: harris }).pathway.fillToElevate).toBe("restricted");
    expect(assessBuildability({ rule: fortbend }).pathway.fillToElevate).toBe("allowed_with_mitigation");
    expect(assessBuildability({ rule: DEFAULT_BUILDABILITY_RULES.generic }).pathway).toBeNull();
  });
  it("LOMR-F fires ONLY when a building footprint intersects the 1% floodplain", () => {
    expect(assessBuildability({ rule: coh, buildingIn1pct: true }).lomr.note).toBe(LOMR_NOTE);
    expect(assessBuildability({ rule: coh, buildingIn1pct: false }).lomr).toBeNull();
  });
  it("the Section-404 cross-flag needs BOTH findings present", () => {
    expect(assessBuildability({ floodplainPresent: true, wetlandsPresent: true }).wetlands404.note).toBe(WETLANDS_404_NOTE);
    expect(assessBuildability({ floodplainPresent: true, wetlandsPresent: false }).wetlands404).toBeNull();
    expect(assessBuildability({ floodplainPresent: false, wetlandsPresent: true }).wetlands404).toBeNull();
  });
  it("an unverified rule stamps the output", () => {
    expect(assessBuildability({ rule: coh }).flags).toContain("rule_unverified");
    // a verified rule (Fort Bend / Harris) does NOT stamp it
    expect(assessBuildability({ rule: fortbend }).flags).not.toContain("rule_unverified");
    expect(assessBuildability({ rule: harris }).flags).not.toContain("rule_unverified");
  });
});

// ---------------------------------------------------------------------------------
// NEW-1 (Waller) — `when`-conditioned bases + the hag basis + fillToElevate "prohibited".
describe("NEW-1 — Waller record: conditioned bases, HAG, prohibited pathway", () => {
  const waller = DEFAULT_BUILDABILITY_RULES.waller;
  it("ships verified with the Art. 5 provenance and the prohibited pathway", () => {
    expect(waller.verified).toBe(true);
    expect(waller.sourceDate).toBe("2026-07-15");
    expect(waller.fillToElevate).toBe("prohibited");
    expect(waller.pathwayNote).toMatch(/open foundations/i);
    expect(waller.pathwayNote).toMatch(/non-starter/i);
    expect(waller.note).toMatch(/§C\(3\)/);           // Atlas-14 study threshold
    expect(waller.note).toMatch(/§D\(5\)/);           // HAG placement note (AO/AH section, A-Zone catch-all)
    expect(waller.note).toMatch(/Brookshire–Katy|BKDD/);
  });
  it("in the 1% floodplain: 500-yr WSE + 2 governs (the +1 row is redundant there)", () => {
    const r = requiredFfe(waller, { wse02Ft: 100 }, { in1pct: true, in02pct: true });
    expect(r.requiredFfeFt).toBe(102);
    expect(r.governingBasis.plusFt).toBe(2);
  });
  it("500-yr band ONLY: the +1 row governs (the in_1pct row doesn't bind)", () => {
    const r = requiredFfe(waller, { wse02Ft: 100 }, { in1pct: false, in02pct: true });
    expect(r.requiredFfeFt).toBe(101);
    expect(r.governingBasis.plusFt).toBe(1);
  });
  it("unknown location stays conservative: both WSE rows apply → +2 governs", () => {
    const r = requiredFfe(waller, { wse02Ft: 100 }, {});
    expect(r.requiredFfeFt).toBe(102);
  });
  it("Zone A no BFE: HAG + 4 applies ONLY on explicit evidence, and can govern", () => {
    // No evidence → the hag row is skipped entirely (not pending).
    const noEv = requiredFfe(waller, { wse02Ft: 100, hagFt: 103 }, { in1pct: true });
    expect(noEv.requiredFfeFt).toBe(102);
    expect(noEv.pendingBases.map((b) => b.basis)).not.toContain("hag");
    // Explicit unstudied-A evidence → HAG 103 + 4 = 107 outgoverns 500-yr + 2.
    const ev = requiredFfe(waller, { wse02Ft: 100, hagFt: 103 }, { in1pct: true, zoneANoBfe: true });
    expect(ev.requiredFfeFt).toBe(107);
    expect(ev.governingBasis.basis).toBe("hag");
    expect(ev.losingBases.map((b) => b.basis)).toContain("wse02pct"); // NEW-3 tooltip payload
    // Evidence but NO DEM → the hag row surfaces as pending, never fabricated.
    const pend = requiredFfe(waller, { wse02Ft: 100 }, { in1pct: true, zoneANoBfe: true });
    expect(pend.requiredFfeFt).toBe(102);
    expect(pend.pendingBases.map((b) => b.basis)).toContain("hag");
  });
  it("assessBuildability threads the ctx + hag input through (the Tsakiris shape)", () => {
    const a = assessBuildability({ rule: waller, padFfeFt: 157.1, hagFt: 153.1, wse02Ft: null, buildingIn1pct: true, zoneANoBfe: true });
    expect(a.ffe.status).toBe("pass");
    expect(a.ffe.requiredFfeFt).toBeCloseTo(157.1, 6);
    expect(a.ffe.governingBasis.basis).toBe("hag");
    expect(a.pathway.fillToElevate).toBe("prohibited");
  });
  it("pre-NEW-1 records are untouched by the ctx machinery (unconditioned bases)", () => {
    const r = requiredFfe(fortbend, { wse02Ft: 98, wse1pctFt: 96 }, { in1pct: false, in02pct: false, zoneANoBfe: false });
    expect(r.requiredFfeFt).toBe(100); // Fort Bend max-of unchanged under any ctx
  });
});

// ---------------------------------------------------------------------------------
// NEW-3 — suggestedFfe: the offered code minimum with the outside-floodplain honesty
// rule and the ESTIMATED stamp.
describe("NEW-3 — suggestedFfe", () => {
  const waller = DEFAULT_BUILDABILITY_RULES.waller;
  it("suggests the governing minimum with basis + losers", () => {
    const s = suggestedFfe({ rule: waller, inputs: { wse02Ft: 100, hagFt: 103 }, ctx: { in1pct: true, zoneANoBfe: true }, anyBuildingInTrigger: true });
    expect(s.applies).toBe(true);
    expect(s.requiredFfeFt).toBe(107);
    expect(s.governingBasis.basis).toBe("hag");
    expect(s.estimated).toBe(false);
  });
  it("buildings fully outside the trigger bands → applies:false with the honesty note, never a number", () => {
    const s = suggestedFfe({ rule: waller, inputs: { wse02Ft: 100 }, ctx: {}, anyBuildingInTrigger: false });
    expect(s.applies).toBe(false);
    expect(s.requiredFfeFt).toBeNull();
    expect(s.note).toBe(OUTSIDE_FLOODPLAIN_FFE_NOTE);
  });
  it("unknown building location (null) still suggests — conservative, not silent", () => {
    const s = suggestedFfe({ rule: waller, inputs: { wse02Ft: 100 }, ctx: {}, anyBuildingInTrigger: null });
    expect(s.applies).toBe(true);
    expect(s.requiredFfeFt).toBe(102);
  });
  it("the ESTIMATED stamp rides a suggestion whose governing basis fed off the estimate", () => {
    const hc = DEFAULT_BUILDABILITY_RULES.harris; // wse02pct single basis — not estimated
    const s1 = suggestedFfe({ rule: hc, inputs: { wse02Ft: 100 }, anyBuildingInTrigger: true, estimatedBases: ["wse1pct"] });
    expect(s1.estimated).toBe(false);
    const fb = DEFAULT_BUILDABILITY_RULES.fortbend; // wse1pct can govern
    const s2 = suggestedFfe({ rule: fb, inputs: { wse1pctFt: 200 }, anyBuildingInTrigger: true, estimatedBases: ["wse1pct"] });
    expect(s2.governingBasis.basis).toBe("wse1pct");
    expect(s2.estimated).toBe(true);
  });
});

describe("NEW-3 — assessBuildability outside-floodplain suppression", () => {
  const waller = DEFAULT_BUILDABILITY_RULES.waller;
  it("buildings OUTSIDE the mapped floodplain short-circuit to the quiet no-rule verdict (no SET BFE, no input demand)", () => {
    const b = assessBuildability({ rule: waller, padFfeFt: 153.1, anyBuildingInTrigger: false, floodplainPresent: false });
    expect(b.ffe.status).toBe("no_rule");
    expect(b.ffe.outsideFloodplain).toBe(true);
    expect(b.ffe.requiredFfeFt).toBeNull();
    expect(b.ffe.pendingBases).toEqual([]); // never demands an input outside the floodplain
    expect(b.ffe.unknownReason).toBeNull(); // no "need one of …" list
    expect(b.pathway).not.toBeNull(); // §A(9) hard-stop pathway copy is retained
    expect(b.lomr).toBeNull(); // no building in the 1% → no LOMR-F note
  });
  it("unknown location (null) still evaluates the rule — conservative, not suppressed", () => {
    const b = assessBuildability({ rule: waller, padFfeFt: null, wse02Ft: 100, buildingIn1pct: true, anyBuildingInTrigger: null });
    expect(b.ffe.status).not.toBe("no_rule"); // the rule still binds when location is unknown
  });
  it("the 'need one of' list dedupes bases that read the SAME input (Waller's two 500-yr WSE bases → one line)", () => {
    // Both wse02pct bases apply (in1pct null → conservative) but no wse02Ft supplied → pending; hag supplied only.
    const r = requiredFfe(waller, {}, { in1pct: null, in02pct: null, zoneANoBfe: true });
    expect(r.requiredFfeFt).toBeNull();
    // "500-yr WSE" (the wse02pct input) must appear ONCE, not twice.
    const count500 = (r.unknownReason.match(/500-yr/g) || []).length;
    expect(count500).toBe(1);
  });
});

describe("NEW-4 — siteBasisFfe + the site-based suggestion tier", () => {
  it("takes the MAX of pond-design-WSE+freeboard and HAG+margin, labeled with its source", () => {
    const sb = siteBasisFfe({ pondDesignWseFt: 150, pondFreeboardFt: 1, freeboardSource: "BKDD 1-ft", hagFt: 148, hagMarginFt: 1 });
    expect(sb.requiredFfeFt).toBe(151); // max(150+1, 148+1) = 151 (pond governs)
    expect(sb.governingKey).toBe("pond");
    expect(sb.governingLabel).toMatch(/BKDD 1-ft/);
  });
  it("HAG governs when it is higher", () => {
    const sb = siteBasisFfe({ pondDesignWseFt: 150, pondFreeboardFt: 1, hagFt: 152, hagMarginFt: 1 });
    expect(sb.requiredFfeFt).toBe(153); // 152+1 beats 150+1
    expect(sb.governingKey).toBe("hag");
  });
  it("an unanchored pond (no design WSE) with no HAG → UNAVAILABLE with the resolving action, never a guess", () => {
    const sb = siteBasisFfe({ pondDesignWseFt: null, hagFt: null, pondAnchored: false });
    expect(sb.requiredFfeFt).toBeNull();
    expect(sb.unavailableReason).toMatch(/top-of-bank/);
  });
  it("an ESTIMATED pond WSE propagates the stamp onto the governing site basis", () => {
    const sb = siteBasisFfe({ pondDesignWseFt: 160, pondFreeboardFt: 1, hagFt: 150, hagMarginFt: 1, pondWseEstimated: true });
    expect(sb.governingKey).toBe("pond");
    expect(sb.estimated).toBe(true);
  });
  it("suggestedFfe returns the SITE-BASED tier when NO ordinance rule binds (outside floodplain)", () => {
    const waller = DEFAULT_BUILDABILITY_RULES.waller;
    const s = suggestedFfe({ rule: waller, inputs: {}, ctx: {}, anyBuildingInTrigger: false, site: { pondDesignWseFt: 150, pondFreeboardFt: 1, freeboardSource: "BKDD 1-ft", hagFt: 148, hagMarginFt: 1 } });
    expect(s.applies).toBe(true);
    expect(s.basisKind).toBe("site");
    expect(s.requiredFfeFt).toBe(151);
    expect(s.note).toBe(SITE_BASED_FFE_NOTE);
  });
  it("an ordinance rule SUPERSEDES the site basis (which demotes to the popover data)", () => {
    const waller = DEFAULT_BUILDABILITY_RULES.waller;
    const s = suggestedFfe({ rule: waller, inputs: { wse02Ft: 200 }, ctx: { in1pct: true }, anyBuildingInTrigger: true, site: { pondDesignWseFt: 150, pondFreeboardFt: 1, hagFt: 148, hagMarginFt: 1 } });
    expect(s.basisKind).toBe("ordinance");
    expect(s.requiredFfeFt).toBe(202); // 200 + 2 (Waller §B(2) in the 1%)
    expect(s.site).toBeTruthy(); // the site basis is still available, demoted
    expect(s.site.requiredFfeFt).toBe(151);
  });
  it("outside the floodplain with an unanchored pond → applies:false carrying the resolving action", () => {
    const waller = DEFAULT_BUILDABILITY_RULES.waller;
    const s = suggestedFfe({ rule: waller, inputs: {}, ctx: {}, anyBuildingInTrigger: false, site: { pondDesignWseFt: null, hagFt: null, pondAnchored: false } });
    expect(s.applies).toBe(false);
    expect(s.unknownReason).toMatch(/top-of-bank/);
  });
});
