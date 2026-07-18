// B881 (scope note 2) — the pluggable estimated-WSE provider registry: per-county precedence
// (local district → FEMA InFRM EBFE → grade), the winning-source provenance, the 0.2% fill,
// and cross-provider disagreement. Pure.
import { describe, it, expect } from "vitest";
import { resolveEstimatedWse, WSE_PROVIDERS, wseProviderMeta } from "../src/workspaces/site-planner/lib/wseProviders.js";

const HARRIS = ["Harris County"];
const FORT_BEND = ["Fort Bend County"];
const OTHER = ["Montgomery County"];

describe("precedence order", () => {
  it("declares district → ebfe → grade in that order", () => {
    expect(WSE_PROVIDERS.map((p) => p.id)).toEqual(["maapnext", "fbcdd", "fema-ebfe", "grade"]);
    expect(wseProviderMeta("fema-ebfe").tier).toBe("ebfe");
  });
});

describe("resolveEstimatedWse — winning 1% (estimated BFE) by county", () => {
  it("Harris: MAAPnext OUTRANKS EBFE and grade", () => {
    const r = resolveEstimatedWse({
      county: HARRIS,
      candidates: {
        maapnext: { wse1pctFt: 55, wse02Ft: 57 },
        ebfe: { wse1pctFt: 52, wse02Ft: 54 },
        grade: { wseFt: 50 },
      },
    });
    expect(r.wse1pctFt).toBe(55);
    expect(r.wse1pctProviderId).toBe("maapnext");
    expect(r.wse1pctSrc).toBe("est-maapnext");
    expect(r.wse1pctLabel).toMatch(/MAAPnext/);
  });
  it("Fort Bend: FBCDD outranks EBFE and grade", () => {
    const r = resolveEstimatedWse({
      county: FORT_BEND,
      candidates: { fbcdd: { wse1pctFt: 80, wse02Ft: 82 }, ebfe: { wse1pctFt: 78 }, grade: { wseFt: 76 } },
    });
    expect(r.wse1pctProviderId).toBe("fbcdd");
    expect(r.wse1pctSrc).toBe("est-fbcdd");
  });
  it("elsewhere: EBFE wins over grade (district providers are county-gated out)", () => {
    const r = resolveEstimatedWse({
      county: OTHER,
      candidates: { maapnext: { wse1pctFt: 99 }, fbcdd: { wse1pctFt: 98 }, ebfe: { wse1pctFt: 60 }, grade: { wseFt: 58 } },
    });
    // the district candidates don't apply outside their county
    expect(r.wse1pctProviderId).toBe("fema-ebfe");
    expect(r.wse1pctSrc).toBe("est-ebfe");
  });
  it("grade is the last-resort fallback", () => {
    const r = resolveEstimatedWse({ county: OTHER, candidates: { grade: { wseFt: 44 } } });
    expect(r.wse1pctProviderId).toBe("grade");
    expect(r.wse1pctSrc).toBe("est-boundary-grade");
    expect(r.wse1pctFt).toBe(44);
  });
  it("null when no candidate is available", () => {
    expect(resolveEstimatedWse({ county: HARRIS, candidates: {} })).toBeNull();
    expect(resolveEstimatedWse({ county: HARRIS, candidates: { maapnext: null, ebfe: null, grade: null } })).toBeNull();
  });
});

describe("resolveEstimatedWse — 0.2% fill (independent of the 1% winner)", () => {
  it("fills the 0.2% from the highest-precedence provider that has one", () => {
    const r = resolveEstimatedWse({
      county: FORT_BEND,
      candidates: { fbcdd: { wse1pctFt: 80, wse02Ft: null }, ebfe: { wse1pctFt: null, wse02Ft: 83 } },
    });
    expect(r.wse1pctProviderId).toBe("fbcdd"); // 1% winner
    expect(r.wse02Ft).toBe(83);                // 0.2% falls to EBFE (FBCDD had none)
    expect(r.wse02Src).toBe("ebfe-wse02");
  });
  it("grade never contributes a 0.2% value", () => {
    const r = resolveEstimatedWse({ county: OTHER, candidates: { grade: { wseFt: 44 } } });
    expect(r.wse02Ft).toBeNull();
  });
});

describe("resolveEstimatedWse — cross-provider disagreement (challenge c)", () => {
  it("reports winner vs runner-up when the two disagree beyond the threshold", () => {
    const r = resolveEstimatedWse({
      county: HARRIS,
      candidates: { maapnext: { wse1pctFt: 55 }, ebfe: { wse1pctFt: 51 }, grade: { wseFt: 50 } },
    });
    expect(r.disagreement).toBeTruthy();
    expect(r.disagreement.disagree).toBe(true);
    expect(r.disagreement.winner.id).toBe("maapnext");
    expect(r.disagreement.other.id).toBe("fema-ebfe");
    expect(r.disagreement.absDeltaFt).toBe(4);
  });
  it("no disagreement flag when the top two agree within the threshold", () => {
    const r = resolveEstimatedWse({
      county: HARRIS,
      candidates: { maapnext: { wse1pctFt: 55 }, ebfe: { wse1pctFt: 54.6 } },
    });
    expect(r.disagreement.disagree).toBe(false);
  });
  it("no disagreement when only one provider offers a 1% value", () => {
    const r = resolveEstimatedWse({ county: OTHER, candidates: { ebfe: { wse1pctFt: 60 } } });
    expect(r.disagreement).toBeNull();
  });
  it("ordered list carries every applicable candidate in precedence order", () => {
    const r = resolveEstimatedWse({
      county: HARRIS,
      candidates: { maapnext: { wse1pctFt: 55 }, ebfe: { wse1pctFt: 51 }, grade: { wseFt: 50 } },
    });
    expect(r.ordered.map((e) => e.id)).toEqual(["maapnext", "fema-ebfe", "grade"]);
  });
});
