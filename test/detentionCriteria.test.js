// NEW-A1 — the jurisdiction detention-criteria registry: the audit CI guard, the
// reference-don't-duplicate composition against DETENTION_RULES, required-storm
// resolution, and the override merge. Pure — no browser.
import { describe, it, expect } from "vitest";
import {
  DETENTION_CRITERIA,
  criteriaFor,
  requiredStormsFor,
  problems,
  loadCriteriaOverrides,
  saveCriteriaOverrides,
  jurKeyForAuthority,
  CRITERIA_JUR_KEYS,
} from "../src/workspaces/site-planner/lib/detentionCriteria.js";
import { ruleFor } from "../src/workspaces/site-planner/lib/detentionRules.js";

describe("registry audit (the CI guard)", () => {
  it("has no problems", () => {
    expect(problems()).toEqual([]);
  });
  it("every advertised jurisdiction key exists in the registry", () => {
    for (const k of CRITERIA_JUR_KEYS) expect(DETENTION_CRITERIA[k]).toBeTruthy();
  });
  it("catches a broken row (missing url / bad carrier)", () => {
    const bad = { generic: { ...DETENTION_CRITERIA.generic }, x: { key: "x", label: "X", provider: "p", authorityRuleId: "nope", lastVerified: "2026", governingManual: { name: "M" }, criteria: { freeboardFt: { value: "oops", verified: false } } } };
    const p = problems(bad);
    expect(p.some((s) => s.includes("authorityRuleId"))).toBe(true);
    expect(p.some((s) => s.includes("lastVerified"))).toBe(true);
    expect(p.some((s) => s.includes("freeboardFt"))).toBe(true);
  });
});

describe("reference, don't duplicate — DETENTION_RULES is the single source of truth", () => {
  it("Fort Bend release rate comes from the rule record (0.125 cfs/ac), not a re-typed copy", () => {
    const c = criteriaFor("fortbend");
    const ruleVal = ruleFor("fortbend").params.maxReleaseCfsPerAc;
    expect(ruleVal).toBe(0.125);
    expect(c.allowableReleaseCfsPerAc.value).toBe(ruleVal);
    expect(c.allowableReleaseCfsPerAc.verified).toBe(true);
  });
  it("Fort Bend freeboard references the DCM §6.4.7 rule value (1 ft)", () => {
    const c = criteriaFor("fortbend");
    expect(c.freeboardFt.value).toBe(ruleFor("fortbend").params.pondFreeboardFt);
  });
  it("Harris links to the hcfcd authority rule; orifice C ≈ 0.8 is HCED (unverified pending primary)", () => {
    expect(DETENTION_CRITERIA.harris.authorityRuleId).toBe("hcfcd");
    const c = criteriaFor("harris");
    expect(c.orificeC.value).toBe(0.8);
    expect(c.orificeC.verified).toBe(false);
    expect(c.drawdownMaxHr.value).toBe(96);
  });
});

describe("requiredStormsFor — references the rule record's storm list", () => {
  it("Brookshire–Katy DD = 2/10/100 (rate-match)", () => {
    expect(requiredStormsFor("bkdd")).toEqual([2, 10, 100]);
  });
  it("Fort Bend = 10/100 (Interim §4.a Post ≤ Pre events)", () => {
    expect(requiredStormsFor("fortbend")).toEqual([10, 100]);
  });
  it("unknown jurisdiction → generic screening default, sorted ascending", () => {
    expect(requiredStormsFor("nope")).toEqual([10, 100]);
  });
});

describe("criteriaFor — composition + overrides", () => {
  it("BKDD is rate-control (postLePre) with no volumetric release rate", () => {
    const c = criteriaFor("bkdd");
    expect(c.postLePre).toBe(true);
    expect(c.allowableReleaseCfsPerAc).toBeNull();
    expect(c.secondarySource).toBe(true);
  });
  it("standard weir/orifice coefficients are verified physics", () => {
    const c = criteriaFor("waller");
    expect(c.weirC.value).toBeCloseTo(3.33, 2);
    expect(c.weirC.verified).toBe(true);
    expect(c.orificeC.verified).toBe(true);
  });
  it("a user override wins and is marked overridden (verified:false)", () => {
    const c = criteriaFor("fortbend", { overrides: { fortbend: { freeboardFt: 2, orificeC: 0.65 } } });
    expect(c.freeboardFt.value).toBe(2);
    expect(c.freeboardFt.overridden).toBe(true);
    expect(c.freeboardFt.verified).toBe(false);
    expect(c.orificeC.value).toBe(0.65);
  });
  it("an override of requiredStorms is honored", () => {
    const c = criteriaFor("fortbend", { overrides: { fortbend: { requiredStorms: [100] } } });
    expect(c.requiredStorms).toEqual([100]);
  });
  it("unknown jurisdiction falls back to generic, never throws", () => {
    expect(criteriaFor("atlantis").jurKey).toBe("generic");
  });
});

describe("overrides persistence (deep-merge, injected store)", () => {
  it("round-trips through a mock store", () => {
    const mem = {};
    const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
    saveCriteriaOverrides({ fortbend: { freeboardFt: 2 } }, store);
    expect(loadCriteriaOverrides(store)).toEqual({ fortbend: { freeboardFt: 2 } });
  });
  it("bad JSON → empty overrides, never throws", () => {
    const store = { getItem: () => "{bad", setItem: () => {} };
    expect(loadCriteriaOverrides(store)).toEqual({});
  });
});

describe("jurKeyForAuthority — jurisdiction detection auto-selects a row", () => {
  it("maps authority ids back to criteria jurisdiction keys", () => {
    expect(jurKeyForAuthority("hcfcd")).toBe("harris");
    expect(jurKeyForAuthority("fortbend")).toBe("fortbend");
    expect(jurKeyForAuthority("bkdd")).toBe("bkdd");
    expect(jurKeyForAuthority("nope")).toBe("generic");
  });
});
