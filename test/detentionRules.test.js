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
  ruleBadge,
  pondDefaultsFor,
} from "../src/workspaces/site-planner/lib/detentionRules.js";

describe("rule records — integrity sweep", () => {
  it("every record carries id / authority / ruleType / dates / source{name,url} / params", () => {
    for (const [auth, recs] of Object.entries(DETENTION_RULES)) {
      for (const r of recs) {
        expect(r.id, auth).toBeTruthy();
        expect(r.authority).toBe(auth);
        expect(["rate", "tiered", "table-band", "policy-band", "overlay"]).toContain(r.ruleType);
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
  it("276 ac × 0.65 ac-ft/ac (entire tract) = 179.4 ac-ft — matches the DIA", () => {
    // Source check (owner-verified 2026-07-03): the Goose Creek drainage impact
    // analysis states a MINIMUM REQUIRED detention of 179.38 ac-ft for the
    // ~276-ac tract under the HCFCD Atlas-14 rate; 276 × 0.65 = 179.40. The
    // 0.02 delta is the DIA's exact surveyed acreage vs the rounded 276.
    const r = computeRequiredDetention({ acres: 276, authorityId: "hcfcd" });
    expect(r.kind).toBe("point");
    expect(r.requiredAcFt).toBeCloseTo(179.4, 1);
    expect(r.rateAcFtPerAc).toBe(0.65);
    // The carrier invariant: no volume ever travels without its rule record.
    expect(r.rule.id).toBe("hcfcd-pcpm-atlas14-2021");
    expect(r.rule.source.name).toMatch(/HCFCD/);
    expect(r.rule.effectiveDate).toBe("2021-03-31");
    expect(r.rule.verifiedOn).toBe("2026-07-03");
    expect(r.caveat).toMatch(/screening/i);
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
    expect(b).toMatch(/eff\. Mar 2021/);
    expect(b).toMatch(/verified Jul 2026/);
  });
  it("pondDefaultsFor reads authority pond params (HCFCD 3:1, 1 ft freeboard), safe fallback", () => {
    expect(pondDefaultsFor("hcfcd").sideSlope).toBe(3);
    expect(pondDefaultsFor("nowhere").sideSlope).toBe(3);
    expect(pondDefaultsFor("nowhere").freeboardFt).toBe(1);
  });
});
