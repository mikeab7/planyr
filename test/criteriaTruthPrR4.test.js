// v3 CRITERIA-TRUTH milestone, PR-R4 (B986) — the confirmed cowork research is encoded with
// citations, and the still-assumed entries name their citation TARGET document (so anyone can
// confirm later). Waller FFE = 500-yr WSE + 2/+1 (VERIFIED, current 2023 Subdivision Regs); the
// pond-detention criteria stay ASSUMED but point at their code.
import { describe, it, expect } from "vitest";
import { DEFAULT_BUILDABILITY_RULES, requiredFfe } from "../src/workspaces/site-planner/lib/buildability.js";
import { DETENTION_CRITERIA, problems } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

describe("B986 — Waller FFE keys to the 500-yr WSE (VERIFIED, confirmed 2023 Subdivision Regs)", () => {
  const waller = DEFAULT_BUILDABILITY_RULES.waller;
  it("is VERIFIED and cites Appendix B Item 8 of the current 12-06-2023 regulations", () => {
    expect(waller.verified).toBe(true);
    expect(waller.source).toMatch(/12-06-2023/);
    expect(waller.source).toMatch(/Appendix B Item 8/);
    expect(waller.sourceDate).toBe("2026-07-24");
  });
  it("FFE in the 1% floodplain = 500-yr WSE + 2 ft (not BFE + freeboard)", () => {
    const r = requiredFfe(waller, { wse02Ft: 150 }, { in1pct: true, in02pct: true });
    expect(r.requiredFfeFt).toBe(152);
    expect(r.governingBasis.plusFt).toBe(2);
  });
  it("FFE in the 500-yr band only = 500-yr WSE + 1 ft", () => {
    const r = requiredFfe(waller, { wse02Ft: 150 }, { in1pct: false, in02pct: true });
    expect(r.requiredFfeFt).toBe(151);
  });
});

describe("B986 — assumed detention entries name their citation TARGET (never a bare 'verify')", () => {
  it("Waller detention points at Appendix E DCM Sec 5 (industrial, not the rural exemption), still ASSUMED", () => {
    const w = DETENTION_CRITERIA.waller;
    expect(w.criteria.freeboardFt.verified).toBe(false);         // still assumed
    expect(w.criteria.freeboardFt.section).toMatch(/Appendix E DCM Sec 5/);
    expect(w.governingManual.section).toMatch(/rural.*exemption.*does NOT apply/i);
  });
  it("BKDD detention names the target docs (Rules 22-01 + Order 3-27-23 + MDP 6-20-23), still ASSUMED", () => {
    const b = DETENTION_CRITERIA.bkdd;
    expect(b.criteria.freeboardFt.verified).toBe(false);         // still assumed
    expect(b.criteria.freeboardFt.section).toMatch(/BKDD Rules & Regulations 22-01/);
    expect(b.governingManual.name).toMatch(/Order Amending 2023-03-27/);
    expect(b.governingManual.name).toMatch(/Master Drainage Plan \(2023-06-20\)/);
  });
  it("the registry audit still passes (no provenance shape broken)", () => {
    expect(problems()).toEqual([]);
  });
});
