// B904 — the Rational-vs-NRCS method-by-area guardrail. Pure — no browser.
import { describe, it, expect } from "vitest";
import { selectDetentionMethod, DEFAULT_RATIONAL_METHOD_MAX_ACRES } from "../src/workspaces/site-planner/lib/detentionMethod.js";
import { criteriaFor } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

describe("selectDetentionMethod — Rational vs NRCS by tributary area", () => {
  it("an area just under the default ceiling picks Rational, routing not flagged as a proxy", () => {
    const r = selectDetentionMethod({ areaAcres: DEFAULT_RATIONAL_METHOD_MAX_ACRES - 1 });
    expect(r.method).toBe("rational");
    expect(r.overThreshold).toBe(false);
    expect(r.routingIsProxy).toBe(false);
  });

  it("an area just over the default ceiling picks NRCS and flags the routing as still a Rational proxy", () => {
    const r = selectDetentionMethod({ areaAcres: DEFAULT_RATIONAL_METHOD_MAX_ACRES + 1 });
    expect(r.method).toBe("nrcs");
    expect(r.overThreshold).toBe(true);
    expect(r.routingIsProxy).toBe(true);
  });

  it("exactly at the ceiling is NOT over threshold (the ceiling itself is still Rational range)", () => {
    const r = selectDetentionMethod({ areaAcres: DEFAULT_RATIONAL_METHOD_MAX_ACRES });
    expect(r.method).toBe("rational");
    expect(r.overThreshold).toBe(false);
  });

  it("the ceiling is CRITERIA-CONFIGURABLE, not a hardcoded magic number — a jurisdiction override changes the pick", () => {
    const criteria = criteriaFor("waller", { overrides: { waller: { rationalMethodMaxAcres: 50 } } });
    expect(criteria.rationalMethodMaxAcres.value).toBe(50);
    const under = selectDetentionMethod({ areaAcres: 40, criteria });
    const over = selectDetentionMethod({ areaAcres: 60, criteria });
    expect(under.method).toBe("rational");
    expect(over.method).toBe("nrcs");
    expect(over.ceilingAcres).toBe(50);
  });

  it("every shipped jurisdiction carries a rationalMethodMaxAcres criterion (the registry audit surface)", () => {
    for (const jurKey of ["waller", "bkdd", "fortbend", "harris", "coh", "montgomery", "chambers", "generic"]) {
      const criteria = criteriaFor(jurKey);
      expect(criteria.rationalMethodMaxAcres).toBeTruthy();
      expect(criteria.rationalMethodMaxAcres.value).toBeGreaterThan(0);
    }
  });

  it("LOUD-FAILURE: no contributing area → method null, never a fabricated pick", () => {
    expect(selectDetentionMethod({ areaAcres: null }).method).toBeNull();
    expect(selectDetentionMethod({ areaAcres: 0 }).method).toBeNull();
    expect(selectDetentionMethod({}).method).toBeNull();
  });
});
