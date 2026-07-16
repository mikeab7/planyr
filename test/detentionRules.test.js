// B629/B630 — the detention rules engine: versioned records, the rate method,
// the greater-of conflict rule, band discipline, overlays. Pure — no fetch.
import { describe, it, expect } from "vitest";
import {
  DETENTION_RULES,
  MUNICIPAL_OVERLAYS,
  WATERSHED_OVERLAYS,
  ruleFor,
  interpolateCurve,
  governingRequirement,
  computeRequiredDetention,
  TIER_THRESHOLDS,
  ruleBadge,
  pondDefaultsFor,
  runoffCoefficient,
  DESIGN_STORMS,
  stormIntensity,
  computeRateBasedDetention,
  computePumpedCredit,
  effectiveChannelDischarge,
  effectiveReviewer,
  DETENTION_AUTHORITY_CHOICES,
  slimDrainageContext,
  hydrateDrainageContext,
  BKDD_OVERLAY_SHORT,
  BKDD_OVERLAY_DETAIL,
} from "../src/workspaces/site-planner/lib/detentionRules.js";

describe("rule records — integrity sweep", () => {
  it("every record carries id / authority / ruleType / dates / source{name,url} / params", () => {
    for (const [auth, recs] of Object.entries(DETENTION_RULES)) {
      for (const r of recs) {
        expect(r.id, auth).toBeTruthy();
        expect(r.authority).toBe(auth);
        expect(["rate", "tiered", "table-band", "policy-band", "overlay", "rate-match"]).toContain(r.ruleType);
        expect(r.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.source?.name).toBeTruthy();
        expect(r.source?.url).toMatch(/^https:\/\//);
        expect(r.params).toBeTruthy();
      }
    }
    for (const r of Object.values(MUNICIPAL_OVERLAYS)) {
      expect(r.ruleType).toBe("overlay");
      expect(r.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.source?.name).toBeTruthy();
    }
    for (const r of WATERSHED_OVERLAYS) {
      expect(r.id).toBeTruthy();
      expect(r.match).toBeInstanceOf(RegExp);
      expect(r.params.transcribed).toBe(false); // flag-and-band until transcribed exactly
      expect(r.note).toMatch(/verify/i);
    }
  });

  it("per-authority arrays are newest-first (the ruleFor scan depends on it)", () => {
    for (const recs of Object.values(DETENTION_RULES)) {
      for (let i = 0; i + 1 < recs.length; i++) {
        expect(recs[i].effectiveDate >= recs[i + 1].effectiveDate).toBe(true);
      }
    }
  });
});

describe("ruleFor — the versioning seam", () => {
  it("Houston: today picks the June-2026 rewrite; a 2024 date picks the 2019 IDM", () => {
    expect(ruleFor("coh").id).toBe("coh-idm9-2026");
    expect(ruleFor("coh", "2024-01-01").id).toBe("coh-idm9-2019");
    expect(ruleFor("coh", "2026-06-01").id).toBe("coh-idm9-2026"); // effective ON the date
  });
  it("a date before the oldest record → honest null (no guess), unknown authority → null", () => {
    expect(ruleFor("coh", "2019-06-01")).toBeNull();
    expect(ruleFor("kendall")).toBeNull();
  });
});

describe("computeRequiredDetention — HCFCD (the Goose Creek merge gate)", () => {
  it("276 ac × 0.65 ac-ft/ac (PCPM methods baseline) = 179.4 ac-ft — matches the DIA", () => {
    // Source check (owner-verified): the Goose Creek drainage impact analysis states a
    // MINIMUM REQUIRED detention of 179.38 ac-ft for the ~276-ac tract under the HCFCD
    // Atlas-14 PCPM rate; 276 × 0.65 = 179.40. The 0.02 delta is the DIA's exact surveyed
    // acreage vs the rounded 276. B761: 0.65 is the HCFCD PCPM METHODS BASELINE (a full
    // impact analysis / DIA), reached via hcfcdMethod:"pcpm" — it is NO LONGER the silent
    // unincorporated default (that default is the HCED outfall-type minimum / band below).
    const r = computeRequiredDetention({ acres: 276, authorityId: "hcfcd", hcfcdMethod: "pcpm" });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(179.4, 1);
    expect(r.rateAcFtPerAc).toBe(0.65);
    // The carrier invariant: no volume ever travels without its rule record.
    expect(r.rule.id).toBe("hcfcd-pcpm-atlas14-2021");
    expect(r.rule.source.name).toMatch(/HCFCD/);
    expect(r.rule.effectiveDate).toBe("2019-07-09"); // B761: corrected from the mis-attributed 2021-03-31 (COH IDM) date
    expect(r.rule.verifiedOn).toBe("2026-07-11");
    expect(r.flags).toContain("hcfcd-pcpm-baseline");
    expect(r.caveat).toMatch(/screening/i);
  });
});

describe("computeRequiredDetention — HCFCD outfall-type minimum (B761, unincorporated Harris)", () => {
  it("storm-sewer outfall → 0.75 ac-ft/ac point (HCED Infra Regs)", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", outfallType: "stormSewer" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBe(0.75);
    expect(r.requiredAcFt).toBeCloseTo(7.5, 4);
    expect(r.flags).toContain("hced-infra-outfall-min");
    expect(r.rule.id).toBe("hcfcd-pcpm-atlas14-2021");
    expect(r.rule.effectiveDate).toBe("2019-07-09");
  });
  it("roadside-ditch outfall → 1.0 ac-ft/ac point", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", outfallType: "roadsideDitch" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBe(1.0);
    expect(r.requiredAcFt).toBeCloseTo(10, 4);
    expect(r.flags).toContain("hced-infra-outfall-min");
  });
  it("outfall type 'unknown' → BAND [0.75, 1.0] × acres + flags, never a silent 0.65 point", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", outfallType: "unknown" });
    expect(r.kind).toBe("band");
    expect(r.requiredAcFt).toBeNull();
    expect(r.rateAcFtPerAc).toBeNull();
    expect(r.bandAcFt[0]).toBeCloseTo(7.5, 4); // 0.75 × 10
    expect(r.bandAcFt[1]).toBeCloseTo(10, 4);  // 1.0 × 10
    expect(r.flags).toContain("outfall-type-unknown");
    expect(r.flags).toContain("hced-infra-outfall-min");
    // The governing per-acre band rides the result so the UI badge can show it
    // (V277 live-check nit: the badge under the band read the 0.65 PCPM baseline).
    expect(r.rateBandAcFtPerAc).toEqual([0.75, 1]);
    expect(r.rateBandLabel).toBe("by outfall");
  });
  it("the rule badge for an unset-outfall band shows the governing band, never the 0.65 baseline", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", outfallType: "unknown" });
    const b = ruleBadge(r.rule, r.rateBandAcFtPerAc, r.rateBandLabel);
    expect(b).toMatch(/0\.75–1\.0 ac-ft\/ac by outfall/);
    expect(b).not.toMatch(/0\.65/);
    // a point result's badge is unchanged (explicit rate still wins)
    const pt = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", outfallType: "stormSewer" });
    expect(ruleBadge(pt.rule, pt.rateAcFtPerAc)).toMatch(/0\.75 ac-ft\/ac/);
  });
  it("no outfallType at all (default) → the SAME honest band, not a quiet 0.65", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd" });
    expect(r.kind).toBe("band");
    expect(r.requiredAcFt).toBeNull();
    expect(r.bandAcFt).toEqual([7.5, 10]);
    expect(r.flags).toContain("outfall-type-unknown");
    expect(r.rateAcFtPerAc).not.toBe(0.65); // 0.65 must NOT leak as the default rate
  });
  it("the 0.65 PCPM baseline stays reachable via hcfcdMethod:'pcpm'", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "hcfcd", hcfcdMethod: "pcpm" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBe(0.65);
    expect(r.requiredAcFt).toBeCloseTo(6.5, 4);
    expect(r.flags).toContain("hcfcd-pcpm-baseline");
  });
});

describe("computeRequiredDetention — COH tiers (2026 record, IDMS-2025-01 primary)", () => {
  it("≤20 ac: flat 0.8 ac-ft/ac × PROPOSED IMPERVIOUS AREA (Table 9.5), not the gross tract", () => {
    // 10 ac at 80% impervious → 8 ac impervious → 0.8 × 8 = 6.4 ac-ft.
    const r = computeRequiredDetention({ acres: 10, impPct: 80, authorityId: "coh" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBe(0.8);
    expect(r.requiredAcFt).toBeCloseTo(6.4, 2);
    expect(r.rule.id).toBe("coh-idm9-2026");
    expect(r.basis).toMatch(/impervious/);
    // Primary-sourced now — the secondary-source flag is gone.
    expect(r.flags).not.toContain("secondary-source");
  });
  it("impervious % unknown → conservative full-tract upper bound, flagged", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "coh" });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(8.0, 2); // 0.8 × 10 ac (tract, conservative upper bound)
    expect(r.flags).toContain("impervious-unknown");
  });
  it("redevelopment credit: Detention = (Ap × 0.8) − (Ae × 0.4)", () => {
    // 10 ac at 100% impervious (Ap = 10 ac) with 5 ac existing impervious removed (Ae = 5).
    const r = computeRequiredDetention({ acres: 10, impPct: 100, authorityId: "coh", removedImperviousAcres: 5 });
    expect(r.requiredAcFt).toBeCloseTo(0.8 * 10 - 0.4 * 5, 2); // 8.0 − 2.0 = 6.0
    expect(r.basis).toMatch(/removed impervious/);
  });
  it("single-family lot <15,000 sf: exempt at ≤65% impervious, else 0.75 × impervious IN EXCESS of 65%", () => {
    const acres = 6000 / 43560;
    const exempt = computeRequiredDetention({ acres, impPct: 60, authorityId: "coh", singleFamily: true, lotSf: 6000 });
    expect(exempt.kind).toBe("none");
    expect(exempt.requiredAcFt).toBe(0);
    expect(exempt.rule.id).toBe("coh-idm9-2026"); // even "none" carries its rule
    const above = computeRequiredDetention({ acres, impPct: 70, authorityId: "coh", singleFamily: true, lotSf: 6000 });
    expect(above.kind).toBe("point");
    // excess impervious = acres × (70% − 65%) = acres × 0.05; × 0.75 ac-ft/ac.
    expect(above.requiredAcFt).toBeCloseTo(0.75 * acres * 0.05, 4);
  });
});

describe("computeRequiredDetention — COH 2019 record (grandfathered dates)", () => {
  const onDate = "2024-01-01";
  it("<1 ac non-single-family: 0.75 ac-ft/ac", () => {
    const r = computeRequiredDetention({ acres: 0.5, impPct: 90, authorityId: "coh", onDate });
    expect(r.requiredAcFt).toBeCloseTo(0.375, 3);
    expect(r.rule.id).toBe("coh-idm9-2019");
  });
  it("1–20 ac: Table 9.3 / Fig 9.2 curve interpolation (now transcribed — no approximate flag)", () => {
    // Real Table 9.3: 85% → 0.93, 90% → 0.95, so 87.5% interpolates to 0.94 ac-ft/ac.
    const r = computeRequiredDetention({ acres: 10, impPct: 87.5, authorityId: "coh", onDate });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(9.4, 2);
    expect(r.flags).not.toContain("curve-approximate");
  });
  it("published Table 9.3 anchors: ≤51% → 0.75 (flat floor), 100% → 0.98", () => {
    const lo = computeRequiredDetention({ acres: 10, impPct: 40, authorityId: "coh", onDate });
    expect(lo.rateAcFtPerAc).toBeCloseTo(0.75, 2); // clamped flat floor
    const hi = computeRequiredDetention({ acres: 10, impPct: 100, authorityId: "coh", onDate });
    expect(hi.rateAcFtPerAc).toBeCloseTo(0.98, 2);
  });
  it("curve clamps at both ends; missing impervious → conservative top + flag", () => {
    expect(interpolateCurve([[20, 0.55], [100, 1.0]], 5)).toBe(0.55);
    expect(interpolateCurve([[20, 0.55], [100, 1.0]], 100)).toBe(1.0);
    const r = computeRequiredDetention({ acres: 10, authorityId: "coh", onDate });
    expect(r.rateAcFtPerAc).toBe(0.98); // top of the real Table 9.3 curve
    expect(r.flags).toContain("impervious-unknown");
  });
});

describe("computeRequiredDetention — boundary + rate-purity fixes (review)", () => {
  it("exactly 20.00 ac under the 2026 flat-rate record defers to HCFCD, not 'unknown'", () => {
    const r = computeRequiredDetention({ acres: 20, impPct: 85, authorityId: "coh" });
    expect(r.kind).toBe("point");
    expect(r.rule.id).toBe("hcfcd-pcpm-atlas14-2021"); // >20 defers; == threshold with no mid-tract → large tract
    expect(r.requiredAcFt).toBeCloseTo(0.65 * 20, 2);
  });
  it("exactly 20.00 ac under the 2019 record still uses the mid-tract curve (inclusive band)", () => {
    const r = computeRequiredDetention({ acres: 20, impPct: 85, authorityId: "coh", onDate: "2024-01-01" });
    expect(r.rule.id).toBe("coh-idm9-2019");
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBeCloseTo(0.93, 2); // Table 9.3 at 85% impervious
    expect(r.flags).not.toContain("curve-approximate");
  });
  it("greater-of emits the PUBLISHED rate, never a back-computed fraction", () => {
    const r = computeRequiredDetention({ acres: 25.5, impPct: 83, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: true });
    // Whichever governs, the rate is a clean published value (0.65 or 0.75), not 0.7501960…
    expect([0.65, 0.75]).toContain(r.rateAcFtPerAc);
  });
});

describe("computeRequiredDetention — the >20-ac greater-of conflict rule", () => {
  it("in city limits, draining to an HCFCD channel: max(0.65×tract, 0.75×impervious) — HCFCD wins at low impervious", () => {
    // 30 ac at 85% impervious → HCFCD 0.65×30 = 19.5 vs COH 0.75×25.5 = 19.125.
    const r = computeRequiredDetention({ acres: 30, impPct: 85, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: true });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(19.5, 2);
    expect(r.governing.picked).toBe("hcfcd");
    expect(r.governing.reason).toMatch(/restrictive/);
    expect(r.governing.candidates).toHaveLength(2);
  });
  it("…and COH wins when impervious is high enough (both directions of the max)", () => {
    // 30 ac at 90% → COH 0.75×27 = 20.25 > HCFCD 19.5.
    const r = computeRequiredDetention({ acres: 30, impPct: 90, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: true });
    expect(r.requiredAcFt).toBeCloseTo(20.25, 2);
    expect(r.governing.picked).toBe("coh");
  });
  it("channel adjacency UNKNOWN → still both candidates, flagged — never silently resolved", () => {
    const r = computeRequiredDetention({ acres: 30, impPct: 90, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: null });
    expect(r.flags).toContain("channel-adjacency-unknown");
    expect(r.governing.candidates).toHaveLength(2);
  });
  it("NOT draining to an HCFCD channel → plain HCFCD PCPM deferral (no greater-of)", () => {
    const r = computeRequiredDetention({ acres: 30, impPct: 90, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: false });
    expect(r.requiredAcFt).toBeCloseTo(19.5, 2);
    expect(r.governing).toBeNull();
    expect(r.rule.id).toBe("hcfcd-pcpm-atlas14-2021"); // the governing record travels
  });
});

describe("computeRequiredDetention — rate-less band authorities can NEVER emit a point", () => {
  it.each(["chambers", "waller"])("%s → band + flags, requiredAcFt null (even with impervious known)", (auth) => {
    for (const acres of [0.5, 5, 45, 150, 500]) {
      const r = computeRequiredDetention({ acres, impPct: 85, authorityId: auth });
      expect(r.kind, `${auth} @ ${acres} ac`).toBe("band");
      expect(r.requiredAcFt).toBeNull();
      expect(r.bandAcFt[0]).toBeLessThan(r.bandAcFt[1]);
      expect(r.flags).toContain("screening-band");
      expect(r.rule.authority).toBe(auth);
    }
  });
  it("Chambers & Waller carry the mandatory verify-with-county-engineer flag", () => {
    for (const auth of ["chambers", "waller"]) {
      const r = computeRequiredDetention({ acres: 20, authorityId: auth });
      expect(r.flags).toContain("verify-with-county-engineer");
    }
  });
  it("Chambers band basis names WHY (no published flat rate)", () => {
    const r = computeRequiredDetention({ acres: 20, authorityId: "chambers" });
    expect(r.basis).toMatch(/no published flat rate/i);
    expect(r.flags).toContain("verify-with-county-engineer");
  });
  it("Waller: published 0.55–0.65 band (Appendix E), verify flag, basis names the floor + coefficient", () => {
    const r = computeRequiredDetention({ acres: 10, impPct: 85, authorityId: "waller" });
    expect(r.kind).toBe("band");
    expect(r.bandAcFt[0]).toBeCloseTo(5.5, 2); // 0.55 × 10
    expect(r.bandAcFt[1]).toBeCloseTo(6.5, 2); // 0.65 × 10
    expect(r.flags).toContain("verify-with-county-engineer");
    expect(r.basis).toMatch(/0\.55/);
    expect(r.basis).toMatch(/0\.65/);
  });
});

describe("computeRequiredDetention — Fort Bend Table 6-1 (transcribed → point)", () => {
  it("point from Table 6-1 when impervious is known: 50% → 0.78 ac-ft/ac × drainage area", () => {
    const r = computeRequiredDetention({ acres: 10, impPct: 50, authorityId: "fortbend" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBeCloseTo(0.78, 2);
    expect(r.requiredAcFt).toBeCloseTo(7.8, 2);
    expect(r.rule.id).toBe("fbcdd-dcm-atlas14-2020");
  });
  it("Table 6-1 endpoints: 10% → 0.62, 100% → 0.98", () => {
    expect(computeRequiredDetention({ acres: 1, impPct: 10, authorityId: "fortbend" }).rateAcFtPerAc).toBeCloseTo(0.62, 2);
    expect(computeRequiredDetention({ acres: 1, impPct: 100, authorityId: "fortbend" }).rateAcFtPerAc).toBeCloseTo(0.98, 2);
  });
  it("impervious unknown → honest band spanning 0.62–0.98 × acres, requiredAcFt null", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "fortbend" });
    expect(r.kind).toBe("band");
    expect(r.requiredAcFt).toBeNull();
    expect(r.bandAcFt[0]).toBeCloseTo(6.2, 2);
    expect(r.bandAcFt[1]).toBeCloseTo(9.8, 2);
    expect(r.flags).toContain("impervious-unknown");
    expect(r.basis).toMatch(/Table 6-1/);
  });
  it("≥640 ac (HEC-HMS range) → band even with impervious known", () => {
    const r = computeRequiredDetention({ acres: 700, impPct: 60, authorityId: "fortbend" });
    expect(r.kind).toBe("band");
    expect(r.flags).toContain("large-tract-modeling");
  });
});

describe("B764 — Fort Bend (fbcdd) record params + tier note", () => {
  const p = DETENTION_RULES.fortbend[0].params;
  it("keeps Table 6-1 (transcribed rows) intact — the point path is unchanged", () => {
    expect(p.table.transcribed).toBe(true);
    expect(p.table.rows[0]).toEqual([10, 0.62]);
    expect(p.table.rows[p.table.rows.length - 1]).toEqual([100, 0.98]);
    // the point path still resolves from Table 6-1
    expect(computeRequiredDetention({ acres: 10, impPct: 50, authorityId: "fortbend" }).rateAcFtPerAc).toBeCloseTo(0.78, 2);
  });
  it("reconciles the release rate (renamed, not duplicated) + adds the Interim-criteria params", () => {
    expect(p.maxReleaseCfsPerAc).toBe(0.125);
    expect(p.releaseRateCfsPerAc).toBeUndefined(); // renamed → maxReleaseCfsPerAc, no duplicate
    expect(p.pondFreeboardFt).toBe(1);
    expect(p.gravityDrainFraction).toBe(0.5);
    expect(p.postLePreEvents).toEqual(["atlas14-10yr", "atlas14-100yr"]);
    expect(p.offsiteSheetFlow).toMatch(/no adverse impact/i);
    expect(p.feeInLieu).toBe(false);
  });
  it("TIER_THRESHOLDS.fortbend: diaAcres 50 kept; note corrected (HMS ≥640, optional 50–640)", () => {
    expect(TIER_THRESHOLDS.fortbend.diaAcres).toBe(50);
    expect(TIER_THRESHOLDS.fortbend.note).toMatch(/640/);
    expect(TIER_THRESHOLDS.fortbend.note).toMatch(/optional 50/i);
    expect(TIER_THRESHOLDS.fortbend.note).not.toMatch(/above 50 ac/i); // the old (wrong) note is gone
  });
});


describe("computeRequiredDetention — Montgomery Eq. 6-2 (≤20 ac, transcribed → point)", () => {
  it("≤25% impervious → flat 0.35 ac-ft/ac", () => {
    const r = computeRequiredDetention({ acres: 5, impPct: 20, authorityId: "montgomery" });
    expect(r.kind).toBe("point");
    expect(r.rateAcFtPerAc).toBeCloseTo(0.35, 2);
    expect(r.requiredAcFt).toBeCloseTo(1.75, 2);
  });
  it(">25% impervious → 0.0073×%imp + 0.1667: 60% → 0.605 ac-ft/ac", () => {
    const r = computeRequiredDetention({ acres: 10, impPct: 60, authorityId: "montgomery" });
    expect(r.rateAcFtPerAc).toBeCloseTo(0.605, 3);
    expect(r.requiredAcFt).toBeCloseTo(6.05, 2);
    expect(r.rule.id).toBe("moco-dcm-2025");
  });
  it(">20 ac contributing area → simplified path doesn't apply → band, requiredAcFt null", () => {
    const r = computeRequiredDetention({ acres: 25, impPct: 60, authorityId: "montgomery" });
    expect(r.kind).toBe("band");
    expect(r.requiredAcFt).toBeNull();
    expect(r.flags).toContain("large-tract-modeling");
  });
  it("impervious unknown → band, requiredAcFt null", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "montgomery" });
    expect(r.kind).toBe("band");
    expect(r.requiredAcFt).toBeNull();
    expect(r.flags).toContain("impervious-unknown");
  });
});

describe("computeRequiredDetention — municipal overlays", () => {
  it("Missouri City <20 ac with known added impervious: 0.75 × ADDED impervious", () => {
    const r = computeRequiredDetention({ acres: 15, authorityId: "missouricity", addedImperviousAcres: 10 });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(7.5, 2);
    expect(r.flags).toContain("municipal-overlay");
  });
  it("Missouri City <20 ac, added impervious unknown → screening fallback, flagged", () => {
    const r = computeRequiredDetention({ acres: 15, impPct: 80, authorityId: "missouricity" });
    expect(r.kind).toBe("point");
    expect(r.flags).toContain("added-impervious-unknown");
  });
  it("Missouri City ≥20 ac: parent depends on watershed — surfaced, not guessed", () => {
    const r = computeRequiredDetention({ acres: 25, impPct: 85, authorityId: "missouricity" });
    expect(r.kind).toBe("unknown");
    expect(r.flags).toContain("overlay-parent-ambiguous");
    const ids = r.governing.candidates.map((c) => c.authorityId);
    expect(ids).toEqual(["hcfcd", "fortbend"]);
  });
  it("Magnolia dispatches through the Montgomery band + carries the 10% runoff-reduction note", () => {
    const r = computeRequiredDetention({ acres: 10, authorityId: "magnolia" });
    expect(r.kind).toBe("band");
    expect(r.rule.authority).toBe("montgomery");
    expect(r.flags).toContain("municipal-overlay");
    expect(r.basis).toMatch(/10% runoff-reduction/);
    expect(r.overlayRule.id).toBe("magnolia-adopt");
  });
});

describe("edges + helpers", () => {
  it("no area / unknown authority → none / unknown, never a number", () => {
    expect(computeRequiredDetention({ acres: 0, authorityId: "hcfcd" }).kind).toBe("none");
    const u = computeRequiredDetention({ acres: 10, authorityId: "galveston-nope" });
    expect(u.kind).toBe("unknown");
    expect(u.flags).toContain("no-criteria-modeled");
    expect(u.requiredAcFt).toBeNull();
  });
  it("governingRequirement picks the larger and says why", () => {
    const g = governingRequirement([
      { authorityId: "a", acFt: 10 },
      { authorityId: "b", acFt: 12 },
    ]);
    expect(g.picked).toBe("b");
    expect(g.reason).toBe("more restrictive governs");
  });
  it("ruleBadge formats authority · rate · eff · verified from the record", () => {
    const b = ruleBadge(ruleFor("hcfcd"));
    expect(b).toMatch(/Harris County Flood Control District/);
    expect(b).toMatch(/0\.65 ac-ft\/ac/);
    expect(b).toMatch(/eff\. Jul 2019/); // B761: corrected effectiveDate (was Mar 2021)
    expect(b).toMatch(/verified Jul 2026/);
  });
  it("pondDefaultsFor reads authority pond params (HCFCD 3:1, 1 ft freeboard), safe fallback", () => {
    expect(pondDefaultsFor("hcfcd").sideSlope).toBe(3);
    expect(pondDefaultsFor("nowhere").sideSlope).toBe(3);
    expect(pondDefaultsFor("nowhere").freeboardFt).toBe(1);
  });
});

// B655 — rate-based (Modified Rational) screening + pumped-outfall credit.
describe("runoffCoefficient — Schaake composite", () => {
  it("clamps at the ends and is monotonic", () => {
    expect(runoffCoefficient(0)).toBeCloseTo(0.05, 5);
    expect(runoffCoefficient(100)).toBeCloseTo(0.95, 5);
    expect(runoffCoefficient(50)).toBeCloseTo(0.5, 5);
    let prev = -1;
    for (let p = 0; p <= 100; p += 5) {
      const c = runoffCoefficient(p);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
  it("returns null on unknown impervious (never a fabricated C)", () => {
    expect(runoffCoefficient(null)).toBe(null);
    expect(runoffCoefficient(undefined)).toBe(null);
    expect(runoffCoefficient(NaN)).toBe(null);
  });
});

describe("DESIGN_STORMS + stormIntensity", () => {
  it("the record carries a cited source and ascending-duration rows per period", () => {
    expect(DESIGN_STORMS.source?.name).toBeTruthy();
    expect(DESIGN_STORMS.source?.url).toMatch(/^https:\/\//);
    for (const rows of Object.values(DESIGN_STORMS.periods)) {
      for (let i = 0; i + 1 < rows.length; i++) expect(rows[i + 1][0]).toBeGreaterThan(rows[i][0]);
    }
  });
  it("returns an exact table hit, interpolates between, and nulls an unmodeled period", () => {
    expect(stormIntensity(100, 60).inPerHr).toBe(3.9); // exact row
    const mid = stormIntensity(100, 45).inPerHr; // between 30(5.6) and 60(3.9)
    expect(mid).toBeLessThan(5.6);
    expect(mid).toBeGreaterThan(3.9);
    expect(stormIntensity(500, 60)).toBe(null); // not a modeled return period
    expect(stormIntensity(100, 60).secondarySource).toBe(true);
  });
});

describe("computeRateBasedDetention — Modified Rational", () => {
  it("hand-checked C·i·A case picks the critical duration and volume", () => {
    // acres 10, impPct 75 → C=0.725; 100-yr; release 10 cfs.
    // The 60-min storm governs: Q=0.725*3.9*10=28.275, Vs=(28.275-10)*3600=65790 cf → 1.5103 ac-ft.
    const r = computeRateBasedDetention({ acres: 10, impPct: 75, allowableReleaseCfs: 10, returnPeriodYr: 100 });
    expect(r.kind).toBe("rate-based");
    expect(r.method).toBe("modified-rational");
    expect(r.inputs.criticalDurationMin).toBe(60);
    expect(r.requiredAcFt).toBeCloseTo(1.51, 1);
    expect(r.inputs.peakInflowCfs).toBeCloseTo(28.28, 1);
    expect(r.caveat).toBeTruthy();
  });
  it("a bigger allowable release lowers the required volume (monotonic)", () => {
    const tight = computeRateBasedDetention({ acres: 10, impPct: 75, allowableReleaseCfs: 5, returnPeriodYr: 100 });
    const loose = computeRateBasedDetention({ acres: 10, impPct: 75, allowableReleaseCfs: 20, returnPeriodYr: 100 });
    expect(loose.requiredAcFt).toBeLessThan(tight.requiredAcFt);
  });
  it("missing input flags rather than fabricates a number", () => {
    const noRel = computeRateBasedDetention({ acres: 10, impPct: 75, returnPeriodYr: 100 });
    expect(noRel.kind).toBe("unknown");
    expect(noRel.requiredAcFt).toBe(null);
    expect(noRel.flags).toContain("release-rate-missing");
    const noImp = computeRateBasedDetention({ acres: 10, allowableReleaseCfs: 10, returnPeriodYr: 100 });
    expect(noImp.requiredAcFt).toBe(null);
    expect(noImp.flags).toContain("impervious-unknown");
    const badStorm = computeRateBasedDetention({ acres: 10, impPct: 75, allowableReleaseCfs: 10, returnPeriodYr: 500 });
    expect(badStorm.flags).toContain("design-storm-unmodeled");
  });
});

describe("computePumpedCredit", () => {
  it("a pump reduces required volume and carries the regime-B suppression flag", () => {
    const c = computePumpedCredit({ acres: 10, impPct: 75, gravityReleaseCfs: 0, pumpRateCfs: 15, returnPeriodYr: 100 });
    expect(c.creditedAcFt).toBeGreaterThan(0);
    expect(c.requiredWithPumpAcFt).toBeLessThan(c.requiredGravityAcFt);
    expect(c.flags).toContain("regime-b-tailwater-suppressed-by-pump");
    expect(c.assumption).toMatch(/not.+gravity-drowned|not applied/i);
  });
  it("a pump at or above peak inflow zeroes required and never over-credits", () => {
    const c = computePumpedCredit({ acres: 10, impPct: 75, gravityReleaseCfs: 0, pumpRateCfs: 100000, returnPeriodYr: 100 });
    expect(c.requiredWithPumpAcFt).toBe(0);
    expect(c.creditedAcFt).toBeCloseTo(c.requiredGravityAcFt, 5); // credit === full gravity requirement, no more
  });
  it("a missing pump rate flags, never fabricates a credit", () => {
    const c = computePumpedCredit({ acres: 10, impPct: 75, returnPeriodYr: 100 });
    expect(c.creditedAcFt).toBe(null);
    expect(c.flags).toContain("pump-rate-missing");
  });
});

// ---------------------------------------------------------------------------
// B750 — user overrides + a remembered result for the Stormwater readout.
// ---------------------------------------------------------------------------
describe("B750 — effectiveChannelDischarge", () => {
  it("an explicit override (true/false) wins over detection", () => {
    expect(effectiveChannelDischarge(true, false)).toEqual({ value: true, source: "override" });
    expect(effectiveChannelDischarge(false, true)).toEqual({ value: false, source: "override" });
  });
  it("no override falls back to detection; null stays unknown", () => {
    expect(effectiveChannelDischarge(null, true)).toEqual({ value: true, source: "auto" });
    expect(effectiveChannelDischarge(undefined, false)).toEqual({ value: false, source: "auto" });
    expect(effectiveChannelDischarge(null, null)).toEqual({ value: null, source: "auto" });
    expect(effectiveChannelDischarge(undefined, undefined)).toEqual({ value: null, source: "auto" });
  });
});

describe("B750 — effectiveReviewer", () => {
  it("a non-empty override id wins over the detected reviewer", () => {
    expect(effectiveReviewer("coh", "hcfcd")).toEqual({ authorityId: "coh", source: "override" });
  });
  it("an empty override falls back to the detected reviewer (both may be null)", () => {
    expect(effectiveReviewer(null, "hcfcd")).toEqual({ authorityId: "hcfcd", source: "auto" });
    expect(effectiveReviewer("", "coh")).toEqual({ authorityId: "coh", source: "auto" });
    expect(effectiveReviewer(null, null)).toEqual({ authorityId: null, source: "auto" });
  });
});

describe("B750 — DETENTION_AUTHORITY_CHOICES", () => {
  it("carries HCFCD + City of Houston with plain labels, plus the municipal overlays", () => {
    const byId = Object.fromEntries(DETENTION_AUTHORITY_CHOICES.map((c) => [c.id, c.label]));
    expect(byId.hcfcd).toBe("Harris County Flood Control District");
    expect(byId.coh).toBe("City of Houston");
    expect(byId.fortbend).toBeTruthy();
    expect(byId.missouricity).toBeTruthy(); // a municipal overlay is present
    for (const c of DETENTION_AUTHORITY_CHOICES) expect(c.label).toBeTruthy();
  });
});

describe("B750 — slim / hydrate drainage context", () => {
  const ctx = {
    authority: {
      primaryReviewer: { authorityId: "coh", rule: ruleFor("coh") },
      channelAuthority: "hcfcd",
      overlays: [{ kind: "mud", name: "Harris County MUD 1", type: "MUD" }],
      ambiguous: [],
      flags: ["secondary-source"],
      mud: { state: "loaded", districts: [{ name: "Harris County MUD 1" }] },
      jurisdiction: { city: ["Houston"], county: ["Harris"], etj: [] },
      sources: [{ id: "county", state: "loaded" }],
      note: "x",
    },
    flood: { zones: [{ zone: "AE", subtype: null, staticBfeFt: 52.1, vdatum: "NAVD88" }], state: "loaded", ageMs: 1000 },
    channel: { near: true, unitNo: "W100-00-00", name: "Buffalo Bayou", type: "Natural", distFt: 45, geometry: { paths: [[[0, 0], [1, 1]]] }, state: "loaded" },
    watershed: { names: ["CYPRESS CREEK"], state: "loaded", ageMs: 2000 },
    watershedOverlays: WATERSHED_OVERLAYS.filter((o) => o.match.test("CYPRESS CREEK")),
    groundElevFt: 60.2,
    groundDatum: "NAVD88",
    floodGeo: { zones: [], state: "loaded" },
  };
  it("slim drops the bulky geometry + floodGeo but keeps the re-render facts and is JSON-safe", () => {
    const slim = slimDrainageContext(ctx);
    expect(slim.channel.geometry).toBeUndefined();
    expect(slim.channel.unitNo).toBe("W100-00-00");
    expect(slim.floodGeo).toBeUndefined();
    expect(slim.authority.primaryReviewerId).toBe("coh");
    expect(slim.authority.jurisdiction.city).toEqual(["Houston"]);
    expect(slim.flood.zones).toHaveLength(1);
    expect(slim.watershed.names).toEqual(["CYPRESS CREEK"]);
    expect(() => JSON.parse(JSON.stringify(slim))).not.toThrow(); // no regex / functions survive
  });
  it("hydrate rebuilds the read-context shape: rule + watershed overlays re-derived, geometry null, restored flag", () => {
    const slim = JSON.parse(JSON.stringify(slimDrainageContext(ctx)));
    const h = hydrateDrainageContext(slim);
    expect(h.restored).toBe(true);
    expect(h.authority.primaryReviewer.authorityId).toBe("coh");
    expect(h.authority.primaryReviewer.rule.id).toBe(ruleFor("coh").id); // rule re-derived, not stored
    expect(h.channel.near).toBe(true);
    expect(h.channel.geometry).toBeNull();
    expect(h.floodGeo).toBeNull();
    expect(h.watershedOverlays.length).toBeGreaterThan(0); // re-matched from watershed.names
    expect(h.watershedOverlays[0].match).toBeInstanceOf(RegExp); // full overlay object restored
    expect(h.flood.zones).toHaveLength(1);
    expect(h.authority.jurisdiction.city).toEqual(["Houston"]);
  });
  it("null / empty inputs are safe", () => {
    expect(slimDrainageContext(null)).toBeNull();
    expect(hydrateDrainageContext(null)).toBeNull();
    const hEmpty = hydrateDrainageContext({});
    expect(hEmpty.authority.primaryReviewer).toBeNull();
    expect(hEmpty.channel.near).toBeNull();
    expect(hEmpty.flood.zones).toEqual([]);
  });
});

describe("B788 — hydrate RE-DERIVES the authority verdict from the stored raw facts", () => {
  // The Bain repro: a check remembered 38 min before the B754 ETJ fix merged stored the
  // old wrong verdict (coh) next to CORRECT raw facts (Katy / Houston-ETJ / Fort Bend).
  // Hydrate must re-run the resolver on the facts so rule fixes self-heal remembered checks.
  const bainSlim = () => ({
    authority: {
      primaryReviewerId: "coh", // frozen pre-B754 verdict
      channelAuthority: null,
      overlays: [],
      ambiguous: [],
      flags: [],
      mudState: "loaded",
      jurisdiction: { city: ["Katy"], county: ["Fort Bend"], etj: ["Houston"] },
    },
    flood: { zones: [], state: "loaded", ageMs: 0 },
    channel: { near: null, state: "not-applicable" },
    watershed: null,
    groundElevFt: 135.5,
    groundDatum: "NAVD88",
  });
  it("a stale stored 'coh' verdict on Houston-ETJ Fort Bend facts self-heals to fortbend", () => {
    const h = hydrateDrainageContext(bainSlim());
    expect(h.authority.primaryReviewer.authorityId).toBe("fortbend");
    expect(h.authority.channelAuthority).toBeNull(); // no Harris → no HCFCD
    expect(h.authority.flags).toContain("houston-etj");
    expect(h.authority.overlays.find((o) => o.kind === "etj")).toMatchObject({ city: "Houston" });
  });
  it("stored authority-derived flags/overlays are REPLACED by the re-derivation; query-outcome ones are preserved", () => {
    const slim = bainSlim();
    // a stale derived flag + a query-outcome flag + a mud overlay ride in from storage
    slim.authority.flags = ["city-criteria-unverified", "jurisdiction-partial"];
    slim.authority.overlays = [
      { kind: "etj", city: "Houston", note: "STALE pre-fix wording" },
      { kind: "mud", name: "FB MUD 1", type: "MUD" },
    ];
    const h = hydrateDrainageContext(slim);
    // fresh derivation on these facts DOES produce city-criteria-unverified (Katy unmodeled)
    // + houston-etj; the stored stale copies must not double up.
    expect(h.authority.flags.filter((f) => f === "city-criteria-unverified")).toHaveLength(1);
    expect(h.authority.flags).toContain("jurisdiction-partial"); // check-time outcome, kept
    const etjOverlays = h.authority.overlays.filter((o) => o.kind === "etj");
    expect(etjOverlays).toHaveLength(1);
    expect(etjOverlays[0].note).not.toMatch(/STALE/); // fresh wording, not the stored copy
    expect(h.authority.overlays.find((o) => o.kind === "mud")).toMatchObject({ name: "FB MUD 1" });
  });
  it("a factless legacy slim keeps the stored verdict (no facts to re-derive from)", () => {
    const slim = bainSlim();
    slim.authority.jurisdiction = { city: [], county: [], etj: [] };
    const h = hydrateDrainageContext(slim);
    expect(h.authority.primaryReviewer.authorityId).toBe("coh");
  });
  it("a stored straddle re-derives from the facts (stored ambiguous is stale)", () => {
    const slim = bainSlim();
    slim.authority.jurisdiction = { city: [], county: ["Harris", "Fort Bend"], etj: [] };
    slim.authority.ambiguous = [];
    const h = hydrateDrainageContext(slim);
    expect(h.authority.primaryReviewer).toBeNull();
    expect(h.authority.ambiguous[0]?.kind).toBe("straddle");
  });
});

describe("B789 — the COH >20-ac branch county-gates its HCFCD compare", () => {
  const base = { acres: 109, impPct: 20, authorityId: "coh", inCityLimits: true, drainsToHcfcdChannel: true };
  it("hcfcdApplicable:false prices COH's own impervious rate — no HCFCD candidate, no PCPM deferral", () => {
    const r = computeRequiredDetention({ ...base, hcfcdApplicable: false });
    expect(r.kind).toBe("point");
    expect(r.governing).toBeNull();
    expect(r.flags).toContain("hcfcd-not-applicable");
    expect(r.basis).toMatch(/outside Harris County/);
    expect(r.requiredAcFt).toBeCloseTo(0.75 * 109 * 0.2, 1); // COH impervious rate only
  });
  it("hcfcdApplicable omitted (default true) keeps the greater-of compare", () => {
    const r = computeRequiredDetention(base);
    expect(r.governing?.candidates?.length).toBe(2);
  });
  it("hcfcdApplicable:false with impervious unknown falls back to the conservative full tract, flagged", () => {
    const r = computeRequiredDetention({ ...base, impPct: null, hcfcdApplicable: false });
    expect(r.flags).toContain("hcfcd-not-applicable");
    expect(r.flags).toContain("impervious-unknown");
    expect(r.requiredAcFt).toBeCloseTo(0.75 * 109, 1);
  });
});

describe("B861 (chat NEW-2) — Brookshire–Katy Drainage District (rate-match, additive)", () => {
  it("the BKDD record is a rate-match kind with NO fabricated volumetric rate", () => {
    const rule = ruleFor("bkdd");
    expect(rule).toBeTruthy();
    expect(rule.ruleType).toBe("rate-match");
    expect(rule.params.criterion).toBe("post-le-pre");
    expect(rule.params.noPublishedVolumetricRate).toBe(true);
    // never invents an ac-ft/ac number anywhere in the record
    expect(rule.params.rateAcFtPerAc).toBeUndefined();
    expect(rule.params.bandAcFtPerAc).toBeUndefined();
    expect(rule.params.designStorms).toEqual([2, 10, 100]);
    expect(rule.params.permitValidDays).toBe(365);
    expect(rule.secondarySource).toBe(true); // storm list + freeboard not verbatim-quoted
  });
  it("computeRequiredDetention(bkdd) returns rate-control unknown — never a number", () => {
    const r = computeRequiredDetention({ acres: 40, impPct: 70, authorityId: "bkdd" });
    expect(r.kind).toBe("unknown");
    expect(r.requiredAcFt).toBeNull();
    expect(r.bandAcFt).toBeNull();
    expect(r.rateAcFtPerAc).toBeNull();
    expect(r.flags).toContain("rate-match");
    expect(r.basis).toMatch(/rate control/i);
    expect(r.basis).toMatch(/HEC-HMS|hydrograph/i);
  });
  it("BKDD is EXCLUDED from the reviewing-authority picker (additive, not a county reviewer)", () => {
    expect(DETENTION_AUTHORITY_CHOICES.some((c) => c.id === "bkdd")).toBe(false);
    // but the real county reviewers are still there
    expect(DETENTION_AUTHORITY_CHOICES.some((c) => c.id === "waller")).toBe(true);
    expect(DETENTION_AUTHORITY_CHOICES.some((c) => c.id === "hcfcd")).toBe(true);
  });
  it("the overlay short is a one-line badge (≤110 chars); the detail carries the datum trap", () => {
    expect(BKDD_OVERLAY_SHORT.length).toBeLessThanOrEqual(110);
    expect(BKDD_OVERLAY_SHORT).toMatch(/rate-control/i);
    expect(BKDD_OVERLAY_DETAIL).toMatch(/1988 NGVD/);
    expect(BKDD_OVERLAY_DETAIL).toMatch(/additive/i);
    expect(BKDD_OVERLAY_DETAIL).toMatch(/HEC-HMS/);
  });
});
