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
