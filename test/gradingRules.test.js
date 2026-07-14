// B825 — grading-standards registry: surface-class slope limits with provenance,
// the override merge, the percent/ratio validation seam, and the short-cite chip.
import { describe, it, expect } from "vitest";
import {
  GRADING_RULES,
  JURISDICTION_OVERRIDES,
  gradingRuleFor,
  mergeGradeOverride,
  validateSlopeAgainstRule,
  chipLabel,
} from "../src/workspaces/site-planner/lib/gradingRules.js";

const IDS = [
  "buildingPad", "dockApron", "trailerParking", "carParkingAccessible",
  "carParkingGeneral", "driveAisles", "pavedMinimum", "landscapeTieDown", "swales",
];

describe("GRADING_RULES — registry integrity", () => {
  it("holds exactly the 9 expected surface classes", () => {
    expect(Object.keys(GRADING_RULES).sort()).toEqual([...IDS].sort());
  });
  it("every record carries the full schema with an allowed basis", () => {
    for (const [key, r] of Object.entries(GRADING_RULES)) {
      expect(r.id, key).toBe(key);
      expect(typeof r.label, key).toBe("string");
      expect(typeof r.appliesTo, key).toBe("string");
      expect(typeof r.note, key).toBe("string");
      expect(["published", "planyr-screening-convention"], key).toContain(r.basis);
    }
  });
  it("convention records are never implied-published (verified:false)", () => {
    for (const [key, r] of Object.entries(GRADING_RULES)) {
      if (r.basis === "planyr-screening-convention") expect(r.verified, key).toBe(false);
    }
  });
  it("published records carry a real source url", () => {
    for (const [key, r] of Object.entries(GRADING_RULES)) {
      if (r.basis === "published") expect(r.source?.url, key).toMatch(/^https:\/\//);
    }
  });
  it("only the ADA/TAS accessible-parking record is a legal requirement", () => {
    for (const [key, r] of Object.entries(GRADING_RULES)) {
      expect(r.legalClass, key).toBe(key === "carParkingAccessible");
    }
  });
  it("scope boundary: no record double-covers pond-interior keys (B709)", () => {
    for (const [key, r] of Object.entries(GRADING_RULES)) {
      expect(r.maxSideSlope, key).toBeUndefined();
      expect(r.minFreeboardFt, key).toBeUndefined();
      expect(r.maintBermWidthFt, key).toBeUndefined();
    }
  });
});

describe("ADA/TAS accessible-parking record", () => {
  const r = GRADING_RULES.carParkingAccessible;
  it("is published, verified, max 2% in all directions with no minimum", () => {
    expect(r.verified).toBe(true);
    expect(r.basis).toBe("published");
    expect(r.maxSlopePct).toBe(2);
    expect(r.minSlopePct).toBeUndefined();
  });
  it("cites both primaries (DOJ ADA + TDLR TAS) with the 1:48 wording noted", () => {
    expect(r.source.url).toContain("ada.gov");
    expect(r.source.url2).toContain("tdlr.texas.gov");
    expect(r.source.shortCite).toBe("ADA/TAS §502.4");
    expect(r.note).toMatch(/1:48/);
    expect(r.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("gradingRuleFor", () => {
  it("returns the registry record for a known class", () => {
    expect(gradingRuleFor("driveAisles")).toBe(GRADING_RULES.driveAisles);
  });
  it("unknown class → honest null, even with an override (LOUD-FAILURE)", () => {
    expect(gradingRuleFor("bogus")).toBeNull();
    expect(gradingRuleFor("bogus", { maxSlopePct: 5 })).toBeNull();
  });
  it("applies an override when given", () => {
    const r = gradingRuleFor("driveAisles", { maxSlopePct: 6 });
    expect(r.maxSlopePct).toBe(6);
    expect(r.overridden).toBe(true);
  });
});

describe("mergeGradeOverride", () => {
  const base = GRADING_RULES.driveAisles;
  it("the override wins on numeric limits and stamps overridden/overrideKeys", () => {
    const m = mergeGradeOverride(base, { maxSlopePct: 6 });
    expect(m.maxSlopePct).toBe(6);
    expect(m.minSlopePct).toBe(base.minSlopePct);
    expect(m.overridden).toBe(true);
    expect(m.overrideKeys).toEqual(["maxSlopePct"]);
  });
  it("null/undefined override values are ignored", () => {
    expect(mergeGradeOverride(base, { maxSlopePct: null, minSlopePct: undefined })).toBe(base);
  });
  it("provenance can never be overridden (an owner nudge doesn't mint authority)", () => {
    const ada = GRADING_RULES.carParkingAccessible;
    const m = mergeGradeOverride(ada, { maxSlopePct: 2.5, legalClass: false, verified: false, basis: "x", source: null });
    expect(m.maxSlopePct).toBe(2.5);
    expect(m.legalClass).toBe(true);
    expect(m.verified).toBe(true);
    expect(m.basis).toBe("published");
    expect(m.source).toBe(ada.source);
  });
  it("does not mutate the base record", () => {
    const before = JSON.stringify(base);
    mergeGradeOverride(base, { maxSlopePct: 9 });
    expect(JSON.stringify(base)).toBe(before);
  });
  it("a no-op override returns the SAME object (memoization-friendly)", () => {
    expect(mergeGradeOverride(base, {})).toBe(base);
    expect(mergeGradeOverride(base, null)).toBe(base);
  });
});

describe("validateSlopeAgainstRule", () => {
  it("accessible: 2.0 passes; 2.5 is a LEGAL max violation", () => {
    const r = GRADING_RULES.carParkingAccessible;
    expect(validateSlopeAgainstRule(2.0, r).ok).toBe(true);
    expect(validateSlopeAgainstRule(2.5, r)).toEqual({ ok: false, violation: "legal", bound: "max", limitPct: 2 });
  });
  it("aisles: in-range ok; over max / under min are screening violations", () => {
    const r = GRADING_RULES.driveAisles;
    expect(validateSlopeAgainstRule(3, r).ok).toBe(true);
    expect(validateSlopeAgainstRule(6, r)).toEqual({ ok: false, violation: "screening", bound: "max", limitPct: 5 });
    expect(validateSlopeAgainstRule(0.5, r)).toEqual({ ok: false, violation: "screening", bound: "min", limitPct: 1 });
  });
  it("landscape ratio converts at the seam: 25% (4:1) ok, 40% (2.5:1) breaches 3:1", () => {
    const r = GRADING_RULES.landscapeTieDown;
    expect(validateSlopeAgainstRule(25, r).ok).toBe(true);
    const v = validateSlopeAgainstRule(40, r);
    expect(v.ok).toBe(false);
    expect(v.violation).toBe("screening");
    expect(v.bound).toBe("max");
    expect(v.limitPct).toBeCloseTo(100 / 3, 9);
  });
  it("building pad is a flat plane: 0 ok, 0.5 violates", () => {
    const r = GRADING_RULES.buildingPad;
    expect(validateSlopeAgainstRule(0, r).ok).toBe(true);
    const v = validateSlopeAgainstRule(0.5, r);
    expect(v.ok).toBe(false);
    expect(v.violation).toBe("screening");
    expect(v.bound).toBe("max");
  });
  it("null rule / non-finite slope → honest unknown, never a silent pass", () => {
    const u = { ok: null, violation: null, bound: null, limitPct: null, unknown: true };
    expect(validateSlopeAgainstRule(2, null)).toEqual(u);
    expect(validateSlopeAgainstRule(NaN, GRADING_RULES.driveAisles)).toEqual(u);
  });
  it("legal class survives an override: raised cap moves the line, violations stay LEGAL", () => {
    const r = gradingRuleFor("carParkingAccessible", { maxSlopePct: 2.5 });
    expect(validateSlopeAgainstRule(2.4, r).ok).toBe(true);
    expect(validateSlopeAgainstRule(3, r).violation).toBe("legal");
  });
});

describe("chipLabel", () => {
  it("published max-only: ≤2.0% — ADA/TAS §502.4", () => {
    expect(chipLabel(GRADING_RULES.carParkingAccessible)).toBe("≤2.0% — ADA/TAS §502.4");
  });
  it("convention min+max: 1.0–2.0% — Planyr convention", () => {
    expect(chipLabel(GRADING_RULES.trailerParking)).toBe("1.0–2.0% — Planyr convention");
  });
  it("ratio: ≤3:1 (4:1 preferred) — Planyr convention", () => {
    expect(chipLabel(GRADING_RULES.landscapeTieDown)).toBe("≤3:1 (4:1 preferred) — Planyr convention");
  });
  it("min-only: ≥0.5% — Planyr convention", () => {
    expect(chipLabel(GRADING_RULES.swales)).toBe("≥0.5% — Planyr convention");
  });
  it("flat plane: flat (0%) — Planyr convention", () => {
    expect(chipLabel(GRADING_RULES.buildingPad)).toBe("flat (0%) — Planyr convention");
  });
  it("an overridden rule reads owner override", () => {
    const r = gradingRuleFor("driveAisles", { maxSlopePct: 6 });
    expect(chipLabel(r)).toBe("1.0–6.0% — owner override");
  });
  it("null rule → empty string", () => {
    expect(chipLabel(null)).toBe("");
  });
});

describe("JURISDICTION_OVERRIDES seam", () => {
  it("is exported and empty (per-authority records land here without reshaping)", () => {
    expect(JURISDICTION_OVERRIDES).toEqual({});
  });
});
