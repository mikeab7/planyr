// B822 — the ONE auto-values seam for pond engineering: criteria records drive
// freeboard/side slope with provenance, terrain drives top-of-bank; manual always
// wins at the det layer (the seam only supplies autos, it never overrides).
import { describe, it, expect } from "vitest";
import { pondAutoValues } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { DEFAULT_POND_CRITERIA } from "../src/workspaces/site-planner/lib/pondCriteriaRules.js";

describe("pondAutoValues — provenance-carrying pond autos", () => {
  it("FBCDD: the VERIFIED rule param wins with its per-param cite (freeboard 1′ — FBCDD DCM §6.4.7)", () => {
    const a = pondAutoValues({ authorityId: "fortbend", criteriaRule: DEFAULT_POND_CRITERIA.fortbend, groundElevFt: 96.2 });
    expect(a.freeboard.value).toBe(1);
    expect(a.freeboard.source).toBe("FBCDD DCM §6.4.7");
    expect(a.freeboard.verified).toBe(true);
  });
  it("side slope falls back to the B709 criteria record, honestly labeled unverified", () => {
    const a = pondAutoValues({ authorityId: "fortbend", criteriaRule: DEFAULT_POND_CRITERIA.fortbend });
    expect(a.slope.value).toBe(3);
    expect(a.slope.source).toMatch(/Fort Bend County criteria \(unverified\)/);
    expect(a.slope.verified).toBe(false);
  });
  it("Harris: criteria record supplies both (rule has no pondFreeboardFt param)", () => {
    const a = pondAutoValues({ authorityId: "hcfcd", criteriaRule: DEFAULT_POND_CRITERIA.harris });
    expect(a.freeboard.value).toBe(1);
    expect(a.freeboard.source).toMatch(/Harris County .* criteria \(unverified\)/);
    expect(a.slope.value).toBe(3);
  });
  it("no authority + no criteria → the Planyr screening convention, never implied-published", () => {
    const a = pondAutoValues({});
    expect(a.freeboard).toEqual({ value: 1, source: "Planyr screening convention", verified: false });
    expect(a.slope).toEqual({ value: 3, source: "Planyr screening convention", verified: false });
  });
  it("top-of-bank auto = the 3DEP site median when known; null (never 0) when unknown", () => {
    expect(pondAutoValues({ groundElevFt: 96.2 }).tobElev).toEqual({ value: 96.2, source: "3DEP site median", verified: false });
    expect(pondAutoValues({}).tobElev).toBeNull();
    expect(pondAutoValues({ groundElevFt: NaN }).tobElev).toBeNull();
  });
});

describe("Harris outlet-hydraulics seeds (B822)", () => {
  it("drawdown ≤4 days (96 h) + orifice C=0.8 ride the Harris record, verified:false", () => {
    const h = DEFAULT_POND_CRITERIA.harris;
    expect(h.drawdownMaxHr).toBe(96);
    expect(h.orificeC).toBe(0.8);
    expect(h.verified).toBe(false);
  });
  it("no other jurisdiction silently inherits the Harris-only values", () => {
    expect(DEFAULT_POND_CRITERIA.fortbend.drawdownMaxHr).toBeUndefined();
    expect(DEFAULT_POND_CRITERIA.generic.orificeC).toBeUndefined();
  });
});
