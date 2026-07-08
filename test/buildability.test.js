// B710 — the buildability pathway: required-FFE compare paths, foundation-pathway
// flags per seed, the LOMR-F trigger, the wetlands-404 cross-flag. Pure.
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

describe("rule seeds", () => {
  it("COH & Harris measure the FFE from the 0.2% WSE + 2 ft; both UNVERIFIED", () => {
    for (const r of [coh, harris]) {
      expect(r.ffeRule).toEqual({ basis: "wse02pct", plusFt: 2 });
      expect(r.verified).toBe(false);
      expect(r.note).toMatch(/dry-floodproofing/i); // NFIP alternative noted, not modeled
    }
    expect(coh.fillToElevate).toBe("allowed_with_mitigation");
    expect(harris.fillToElevate).toBe("restricted");
    expect(harris.pathwayNote).toMatch(/LOMR/);
  });
  it("counties without a transcribed rule model NOTHING (honest, not fabricated)", () => {
    expect(DEFAULT_BUILDABILITY_RULES.fortbend.ffeRule).toBeNull();
    expect(loadBuildabilityRules().generic.ffeRule).toBeNull();
  });
});

describe("requiredFfe + the compare paths", () => {
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

describe("pathway, LOMR-F, and the wetlands cross-flag", () => {
  it("the foundation-pathway flag mirrors each seed", () => {
    expect(assessBuildability({ rule: coh }).pathway.fillToElevate).toBe("allowed_with_mitigation");
    expect(assessBuildability({ rule: harris }).pathway.fillToElevate).toBe("restricted");
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
  });
});
