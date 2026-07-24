// NEW-27 (owner directive 2026-07-24) — pumped detention is CRITERIA-DRIVEN: the developer is
// never asked to type a pump discharge he doesn't know ("that's not something I need to be
// calculating"). The allowed pump rate is DERIVED as the jurisdiction's pumped share of the
// allowable release; an OPTIONAL advanced override is honored + flagged; the gravity-vs-pump
// feasibility verdict consumes the derived value. Pure engine + a SitePlanner source-scan for the
// wiring (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criteriaFor, pumpAllowance, problems, DETENTION_CRITERIA, CRITERIA_JUR_KEYS } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

describe("pumpAllowance — the DERIVED pump rate (no user CFS required)", () => {
  it("derives allowedPumpCfs = pumpedShare% × the allowable release", () => {
    const crit = criteriaFor("harris");
    const pa = pumpAllowance(crit, { releaseRateCfs: 10 });
    expect(pa.sharePct).toBe(50); // Harris ~50% (owner recollection, ASSUMED)
    expect(pa.derivedCfs).toBeCloseTo(5, 6);
    expect(pa.allowedPumpCfs).toBeCloseTo(5, 6);
    expect(pa.overridden).toBe(false);
    expect(pa.verified).toBe(false); // ASSUMED until the code text lands
    expect(pa.source).toMatch(/HCFCD/);
  });

  it("the derived rate CHANGES with jurisdiction (share differs)", () => {
    const harris = pumpAllowance(criteriaFor("harris"), { releaseRateCfs: 10 }); // 50%
    const coh = pumpAllowance(criteriaFor("coh"), { releaseRateCfs: 10 });       // 25% (IDM Ch 9, stricter)
    expect(harris.sharePct).not.toBe(coh.sharePct);
    expect(harris.derivedCfs).not.toBeCloseTo(coh.derivedCfs, 3);
    expect(coh.derivedCfs).toBeCloseTo(2.5, 6);
  });

  it("an OPTIONAL override wins and is flagged (never required)", () => {
    const crit = criteriaFor("harris");
    const pa = pumpAllowance(crit, { releaseRateCfs: 10, overrideCfs: 3.2 });
    expect(pa.overridden).toBe(true);
    expect(pa.overrideCfs).toBe(3.2);
    expect(pa.allowedPumpCfs).toBe(3.2);   // the override, not the 5.0 derived
    expect(pa.derivedCfs).toBeCloseTo(5, 6); // derived still exposed (the ≈ placeholder)
  });

  it("no override / no release → graceful nulls, never a throw", () => {
    const crit = criteriaFor("waller");
    expect(pumpAllowance(crit, {}).derivedCfs).toBe(null);
    expect(pumpAllowance(crit, { releaseRateCfs: null }).allowedPumpCfs).toBe(null);
    const neg = pumpAllowance(crit, { releaseRateCfs: 10, overrideCfs: -4 });
    expect(neg.overridden).toBe(false); // a negative override is ignored
    expect(neg.allowedPumpCfs).toBeCloseTo(5, 6);
  });

  it("every jurisdiction carries a pumped-share row (so the derivation is never dead)", () => {
    for (const jur of CRITERIA_JUR_KEYS) {
      const crit = criteriaFor(jur);
      expect(crit.pumpedShareOfReleasePct, jur).toBeTruthy();
      expect(Number.isFinite(crit.pumpedShareOfReleasePct.value), jur).toBe(true);
      const pa = pumpAllowance(crit, { releaseRateCfs: 8 });
      expect(pa.sharePct, jur).toBeGreaterThan(0);
      expect(pa.derivedCfs, jur).toBeGreaterThan(0);
    }
  });

  it("a user override on the criteria row flows through criteriaFor → pumpAllowance", () => {
    const crit = criteriaFor("harris", { overrides: { harris: { pumpedShareOfReleasePct: 40 } } });
    expect(crit.pumpedShareOfReleasePct.value).toBe(40);
    expect(crit.pumpedShareOfReleasePct.overridden).toBe(true);
    expect(pumpAllowance(crit, { releaseRateCfs: 10 }).derivedCfs).toBeCloseTo(4, 6);
  });

  it("the registry stays audit-clean with the new criterion (finite carriers)", () => {
    expect(problems(DETENTION_CRITERIA)).toEqual([]);
  });
});

describe("NEW-27 — SitePlanner wiring (source scan)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("imports pumpAllowance and computes it from the criteria + allowable release", () => {
    expect(src).toContain("pumpAllowance");
    expect(src).toContain("const pumpAllow = pumpAllowance(criteria, {");
    expect(src).toContain("releaseRateCfs: relCap,");
  });

  it("the pump override is OPTIONAL (allowClear, never a required blank)", () => {
    // The override field clears to null and is labeled optional — no required CFS anywhere on the pump path.
    expect(src).toContain('label="Override pump rate (cfs, optional)"');
    expect(src).toContain("onCommit={(n) => setDet({ pumpRateCfs: Number.isFinite(n) && n >= 0 ? n : null })}");
  });

  it("surfaces the derived rate + provenance + the gravity-vs-pump feasibility verdict", () => {
    expect(src).toContain("Pumped outfall (screening)");
    expect(src).toContain("can be pumped");
    expect(src).toContain("const gravityImpaired = Number.isFinite(tailwaterElevFt) && floorApprox < tailwaterElevFt;");
    expect(src).toContain("You don't calculate this; it comes from the criteria.");
  });
});
