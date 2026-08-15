// BKDD criteria-truth (owner-supplied full-text payload, 2026-07-24) — Michael read the signed BKDD
// Rules & Regulations 22-01 PDFs and extracted the technical criteria. This flips the registry's BKDD
// row from ASSUMED to VERIFIED with exact section citations, adds the rows the registry didn't carry
// (0.65 AC-FT/ac floor, emergency spillway required, sediment/WQ not required), reconciles orifice C to
// 0.8 (§5.D.2), the pumped share to a VERIFIED 50% (§5.B.7.g, TxDOT-ditch exception 75%), and the
// coincident-storm policy to a VERIFIED non-coincident 25-yr receiving tailwater (§5.D.2/§5.D.3).
// Pure registry assertions + the Table C maintenance-berm helper.
import { describe, it, expect } from "vitest";
import {
  criteriaFor, problems, DETENTION_CRITERIA, coincidentStormPolicy, pumpAllowance, bkddMaintBermWidthFt,
} from "../src/workspaces/site-planner/lib/detentionCriteria.js";

describe("BKDD Rules 22-01 — VERIFIED criteria (owner full-text read)", () => {
  const c = criteriaFor("bkdd");

  it("freeboard is 1 ft VERIFIED, cited to §5.B.4.f / §5.B.5.e (12 inches above max WSE)", () => {
    expect(c.freeboardFt.value).toBe(1);
    expect(c.freeboardFt.verified).toBe(true);
    expect(c.freeboardFt.source).toMatch(/5\.B\.4\.f/);
  });

  it("orifice C reconciled to 0.8 VERIFIED (§5.D.2), not the 0.6 standard", () => {
    expect(c.orificeC.value).toBe(0.8);
    expect(c.orificeC.verified).toBe(true);
    expect(c.orificeC.source).toMatch(/5\.D\.2/);
  });

  it("storms 2/10/100 VERIFIED (§3.B, Atlas 14 mandatory §1.A)", () => {
    expect(c.requiredStorms).toEqual([2, 10, 100]);
  });

  it("the pumped share is a VERIFIED 50% (§5.B.7.g), and pumpAllowance now reads it as verified", () => {
    expect(c.pumpedShareOfReleasePct.value).toBe(50);
    expect(c.pumpedShareOfReleasePct.verified).toBe(true);
    expect(c.pumpedShareOfReleasePct.source).toMatch(/5\.B\.7\.g/);
    expect(c.pumpedShareOfReleasePct.source).toMatch(/75%/); // TxDOT-ditch exception named
    const pa = pumpAllowance(c, { releaseRateCfs: 10 });
    expect(pa.verified).toBe(true); // NEW-27's pump block now shows VERIFIED, not ASSUMED
    expect(pa.derivedCfs).toBeCloseTo(5, 6);
  });

  it("coincident-storm policy is VERIFIED non-coincident (25-yr receiving tailwater, §5.D.2/§5.D.3)", () => {
    const pol = coincidentStormPolicy(c);
    expect(pol.coincident).toBe(false); // NOT designed coincident with the 100-yr receiving flood
    expect(pol.verified).toBe(true);    // VERIFIED — drops the "Assumed" caveat on the verdict line
    expect(pol.source).toMatch(/25-YR receiving/);
  });

  it("the 0.65 AC-FT/ac detention floor is carried + VERIFIED (§5.C.2/§5.C.3)", () => {
    expect(c.minDetentionRateAcFtPerAc.value).toBe(0.65);
    expect(c.minDetentionRateAcFtPerAc.verified).toBe(true);
    expect(c.minDetentionRateAcFtPerAc.source).toMatch(/5\.C\.[23]/);
  });

  it("an emergency spillway is REQUIRED + VERIFIED (§5.B.4.e / §5.B.5.d / §5.B.7.d)", () => {
    expect(c.emergencySpillwayRequired.value).toBe(1);
    expect(c.emergencySpillwayRequired.verified).toBe(true);
    expect(c.emergencySpillwayRequired.source).toMatch(/spillway/i);
  });

  it("sediment / water-quality volume is NOT required (code-searched), recorded VERIFIED at 0", () => {
    expect(c.sedimentWqRequired.value).toBe(0);
    expect(c.sedimentWqRequired.verified).toBe(true);
    expect(c.sedimentWqRequired.source).toMatch(/NOT required|no sediment/i);
  });

  it("maintenance berm is 20 ft VERIFIED for a deep single-owner basin (Table C §5.B.2), not the 30 ft public value", () => {
    expect(c.maintBermFt.value).toBe(20);
    expect(c.maintBermFt.verified).toBe(true);
    expect(c.maintBermFt.source).toMatch(/Table C/);
  });

  it("BKDD is no longer a secondary source (VERIFIED against the primary signed document)", () => {
    expect(DETENTION_CRITERIA.bkdd.secondarySource).toBe(false);
  });

  it("the registry audit still passes with the new VERIFIED rows (finite carriers)", () => {
    expect(problems()).toEqual([]);
  });
});

describe("bkddMaintBermWidthFt — §5.B.2 Table C (single owner) / §5.B.3 Table D (public)", () => {
  it("single-owner Table C: depth tiers by slope", () => {
    expect(bkddMaintBermWidthFt(2.5, 3)).toBe(10);   // <3.0 ft
    expect(bkddMaintBermWidthFt(5, 3)).toBe(15);     // 3.1–6.0 ft
    expect(bkddMaintBermWidthFt(8, 3)).toBe(20);     // 6.1–9.0 ft, 3:1
    expect(bkddMaintBermWidthFt(8, 4)).toBe(15);     // 6.1–9.0 ft, 4:1
    expect(bkddMaintBermWidthFt(12, 3)).toBe(20);    // >9.0 ft (Tsakiris: >9' at 3:1 → 20)
    expect(bkddMaintBermWidthFt(12, 4)).toBe(20);    // >9.0 ft, 4:1
  });
  it("public / multi-owner Table D: up to 30 ft for a deep 3:1 basin", () => {
    expect(bkddMaintBermWidthFt(12, 3, { multiOwner: true })).toBe(30);
    expect(bkddMaintBermWidthFt(8, 3, { multiOwner: true })).toBe(20);
    expect(bkddMaintBermWidthFt(4, 3, { multiOwner: true })).toBe(15);
    expect(bkddMaintBermWidthFt(12, 4, { multiOwner: true })).toBe(20); // 4:1 not the deep-3:1 case
  });
});
