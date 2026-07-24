// v3 CRITERIA-TRUTH milestone, PR-R5 (R1 — dead storage vs the WRONG tailwater). The owner's fix:
// the permanent DEAD-storage floor is the NORMAL (dry-weather) tailwater the pond recovers to between
// storms, NOT the 100-yr flood WSE. The 100-yr flood WSE only floors usable detention under a
// jurisdiction's COINCIDENT-storm policy (does the design storm coincide with the flood?), which is an
// ASSUMED registry entry (default non-coincident, verified:false) until the governing code text lands.
// Verdicts driven by the assumed policy carry the assumption on the verdict line (R-PRINCIPLE).
//
// Pure behavior lives in pondGeom / tailwaterSource / detentionCriteria / yieldVerdicts; the SitePlanner
// wiring is guarded by source scan (vitest is DOM-free). Fixture-driven — never pins live-project values.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bandedStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { TAILWATER_SOURCES, deriveTailwater } from "../src/workspaces/site-planner/lib/tailwaterSource.js";
import { DETENTION_CRITERIA, criteriaFor, coincidentStormPolicy, problems } from "../src/workspaces/site-planner/lib/detentionCriteria.js";
import { yieldVerdictStrip } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const SQ = (s = 200) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC = 43560;
// A pond anchored with its floor at ~100, water surface at ~109, and a flood WSE mid-column (105).
const det = { depth: 10, freeboard: 1, slope: 3, tobElev: 110 };

describe("R1 — the flood WSE no longer permanently floors usable detention (non-coincident is the default)", () => {
  it("by default the whole recovered column is usable; a mid-column flood WSE does NOT floor it", () => {
    const nonCoincident = bandedStorage(SQ(), det, { wseFt: 105 });                     // default false
    const coincident = bandedStorage(SQ(), det, { wseFt: 105, coincidentStorm: true }); // storm floors usable
    // Non-coincident credits the below-flood band; coincident credits only above the flood.
    expect(nonCoincident.usableCf).toBeGreaterThan(coincident.usableCf + 1);
    // Non-coincident usable is the whole water column (== gross); coincident is materially less.
    expect(nonCoincident.usableCf).toBeCloseTo(nonCoincident.grossCf, 0);
    expect(coincident.usableCf).toBeLessThan(nonCoincident.grossCf);
  });

  it("aboveWseCf is a geometric flood-occupancy measure — IDENTICAL under either policy (never floats with it)", () => {
    const a = bandedStorage(SQ(), det, { wseFt: 105 });
    const b = bandedStorage(SQ(), det, { wseFt: 105, coincidentStorm: true });
    expect(a.aboveWseCf).toBeCloseTo(b.aboveWseCf, 6);
    // and the coincident usable IS that above-flood volume (the flood floors it exactly there)
    expect(b.usableCf).toBeCloseTo(b.aboveWseCf, 6);
  });

  it("the NORMAL-tailwater deadFloor DOES floor usable (dead storage below the dry-weather receiving level)", () => {
    const noFloor = bandedStorage(SQ(), det, { wseFt: 105 });
    const withFloor = bandedStorage(SQ(), det, { wseFt: 105, deadFloorFt: 103 }); // normal tailwater at 103
    expect(withFloor.usableCf).toBeLessThan(noFloor.usableCf - 1);
    // dead storage grew by exactly what the usable band lost (exclusive partition holds)
    expect(withFloor.grossCf).toBeCloseTo(noFloor.grossCf, 6);
  });

  it("fully-inundated follows the EFFECTIVE usable floor, not the raw flood WSE", () => {
    // Flood WSE ABOVE the design water surface (109): under a coincident policy the pond is inundated
    // (usable zero); by default it recovers to normal tailwater and is NOT permanently useless.
    const flood = { wseFt: 109.5 };
    const byDefault = bandedStorage(SQ(), det, flood);
    const coincident = bandedStorage(SQ(), det, { ...flood, coincidentStorm: true });
    expect(byDefault.fullyInundated).toBe(false);
    expect(byDefault.usableCf).toBeGreaterThan(0);
    expect(coincident.fullyInundated).toBe(true);
    expect(coincident.usableCf).toBe(0);
  });

  it("usablePondVolume threads the policy through to the same split", () => {
    const a = usablePondVolume(SQ(), det, { wseFt: 105 });
    const b = usablePondVolume(SQ(), det, { wseFt: 105, coincidentStorm: true });
    expect(a.mode).toBe("anchored");
    expect(a.usableCf).toBeGreaterThan(b.usableCf + 1);
  });
});

describe("R1 — the tailwater ladder tags a REGIME so the dead floor uses NORMAL, routing uses STORM", () => {
  it("every source carries a regime; the design-storm sources are storm, the dry-weather sources normal", () => {
    for (const s of TAILWATER_SOURCES) expect(["storm", "normal"]).toContain(s.regime);
    const byId = Object.fromEntries(TAILWATER_SOURCES.map((s) => [s.id, s.regime]));
    expect(byId.district).toBe("storm");
    expect(byId.femaFis).toBe("storm");
    expect(byId.usgs).toBe("storm");
    expect(byId.normalDepth).toBe("normal");
    expect(byId.channelTerrain).toBe("normal");
  });

  it("deriveTailwater(regime:'normal') skips the storm sources and picks the dry-weather level", () => {
    const candidates = { district: { valueFt: 153 }, channelTerrain: { valueFt: 141 } };
    const storm = deriveTailwater(candidates, { regime: "storm" });
    const normal = deriveTailwater(candidates, { regime: "normal" });
    expect(storm.source).toBe("district");
    expect(storm.valueFt).toBe(153);
    expect(normal.source).toBe("channelTerrain"); // the storm district source is filtered out
    expect(normal.valueFt).toBe(141);
    expect(normal.regime).toBe("normal");
  });
});

describe("R1 — the coincident-storm policy is an ASSUMED criteria-registry entry (default non-coincident)", () => {
  it("every jurisdiction carries a finite coincidentStorm flag, ASSUMED (value 0, verified:false)", () => {
    for (const [k, row] of Object.entries(DETENTION_CRITERIA)) {
      const car = row.criteria.coincidentStorm;
      expect(car, `${k} missing coincidentStorm carrier`).toBeTruthy();
      expect(car.value).toBe(0);        // 0 = non-coincident, the honest default
      expect(car.verified).toBe(false); // ASSUMED until the code text lands
    }
    // the finite-value audit still passes with the new flag
    expect(problems()).toEqual([]);
  });

  it("criteriaFor exposes it and coincidentStormPolicy resolves the default to non-coincident + assumed", () => {
    for (const k of ["waller", "bkdd", "generic"]) {
      const crit = criteriaFor(k);
      expect(crit.coincidentStorm.value).toBe(0);
      const pol = coincidentStormPolicy(crit);
      expect(pol.coincident).toBe(false);
      expect(pol.verified).toBe(false);
      expect(pol.source).toMatch(/coincident-storm/i);
    }
  });

  it("the Waller + BKDD citation target names BKDD Rules 22-01 + Waller Appendix E (owner's target)", () => {
    for (const k of ["waller", "bkdd"]) {
      const src2 = coincidentStormPolicy(criteriaFor(k)).source;
      expect(src2).toMatch(/BKDD Rules & Regulations 22-01/);
      expect(src2).toMatch(/Waller Appendix E/);
    }
  });

  it("a user override flips it to coincident (and the policy reads coincident:true)", () => {
    const crit = criteriaFor("waller", { overrides: { waller: { coincidentStorm: 1 } } });
    expect(crit.coincidentStorm.value).toBe(1);
    expect(coincidentStormPolicy(crit).coincident).toBe(true);
  });
});

describe("R1 — a verdict driven by the assumed policy CARRIES the assumption (never silent)", () => {
  const base = { req: { kind: "point", requiredAcFt: 5 }, providedUsableCf: 3 * AC, pondFullyInundated: false };
  const detRow = (d) => yieldVerdictStrip(d).find((r) => r.key === "det");

  it("no assumption present → the detention verdict carries none", () => {
    const r = detRow(base);
    expect(r.assumption).toBeUndefined();
  });

  it("the DEFAULT (non-coincident) assumption reads 'recovers to normal tailwater' + carries the source", () => {
    const source = "coincident-storm design policy (Waller Appendix E DCM Sec 5 + BKDD Rules & Regulations 22-01 pending).";
    const r = detRow({ ...base, coincidentAssumption: { coincident: false, source } });
    expect(r.assumption).toMatch(/recovers to normal tailwater/);
    expect(r.assumption).toMatch(/not coincident with the flood/);
    expect(r.assumptionSource).toBe(source);
    expect(r.text).toContain(r.assumption); // stated on the verdict line
  });

  it("an override to coincident reads the OTHER way (usable only above the flood level)", () => {
    const r = detRow({ ...base, coincidentAssumption: { coincident: true, source: "x" } });
    expect(r.assumption).toMatch(/coincides with the flood/);
    expect(r.assumption).toMatch(/only above the flood level/);
  });

  it("both assumption strings are em-dash-free (panel-copy discipline)", () => {
    const r1 = detRow({ ...base, coincidentAssumption: { coincident: false, source: "x" } });
    const r2 = detRow({ ...base, coincidentAssumption: { coincident: true, source: "x" } });
    expect(r1.assumption.includes("—")).toBe(false);
    expect(r2.assumption.includes("—")).toBe(false);
  });
});

describe("R1 — SitePlanner wires the policy into the split, the solvers, and the verdict line", () => {
  it("imports the policy resolver and computes it from the jurisdiction criteria", () => {
    expect(src).toContain('import { criteriaFor, loadCriteriaOverrides, coincidentStormPolicy } from "./lib/detentionCriteria.js";');
    expect(src).toContain("const coincidentPolicy = coincidentStormPolicy(criteriaFor(floodJurKey, { overrides: criteriaOverrides }));");
    expect(src).toContain("const coincidentStorm = coincidentPolicy.coincident;");
    expect(src).toContain("const coincidentAssumed = !coincidentPolicy.verified;");
  });

  it("pondSplitFor passes coincidentStorm (and the NORMAL-tailwater deadFloor) into every usable split", () => {
    expect(src).toContain("deadFloorFt: twDeadFloorFt, coincidentStorm })");
    // the dead floor is the receiving flowline (a NORMAL / dry-weather tailwater), not the flood WSE
    expect(src).toContain("const twDeadFloorFt = Number.isFinite(e.det?.receivingFlowlineElev) ? e.det.receivingFlowlineElev : null;");
  });

  it("the sizing solvers honor the same policy (split and solver can never disagree)", () => {
    // the two designPond passes + the inspector Sizing assistant all thread coincidentStorm
    expect(src.split("coincidentStorm }").length - 1 + src.split("coincidentStorm });").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain("coincidentStorm, // R1 — solver honors the same coincident-storm policy as the split");
  });

  it("the drainage object carries coincidentAssumption ONLY when it materially drives the number", () => {
    expect(src).toContain("const coincidentMaterial = pondLedgerEntries.some((p) => {");
    expect(src).toContain("const coincidentAssumption = coincidentAssumed && coincidentMaterial");
    expect(src).toContain("coincidentAssumption,");
  });

  it("the verdict strip renders the assumption sub-line (amber, with the citation target on hover)", () => {
    expect(src).toContain("data-testid={`yield-verdict-assumption-${v.key}`}");
    expect(src).toContain("Assumed: {v.assumption}.");
    expect(src).toContain('title={v.assumptionSource || undefined}');
  });
});
