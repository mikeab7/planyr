import { describe, it, expect } from "vitest";
import { tnTaxTableFor, TN_TAX_COUNTIES, TN_RATES, TN_RATE_YEAR, leadCode } from "../src/workspaces/site-planner/lib/tnTaxUnits.js";
import { taxTableFor, taxTableForCombined, TAX_COVERAGE } from "../src/workspaces/site-planner/lib/taxRates.js";

/* NEW-1 / NEW-2 / NEW-3 (2026-11-15) — Tennessee taxing units + 2025 certified rates (Rutherford, Nashville / Davidson).
 * The "TOTAL TAX RATE" figures below are read straight off the TN Comptroller's 2025 Tax Aggregate Report, Table VI
 * (county + city columns) — an independent source for the sums the module computes from its per-unit rates. */

const R = (DistrictGroup, AccountType, TotalAssessedValue, TAXYEAR = "2026") => ({ attrs: { DistrictGroup, AccountType, TotalAssessedValue, TAXYEAR } });
const D = (TaxDist) => ({ attrs: { TaxDist } });
const rut = (p) => tnTaxTableFor(p, "tn_rutherford");
const dav = (p) => tnTaxTableFor(p, "tn_davidson");

describe("Rutherford — membership from DistrictGroup", () => {
  it("156-027.00-000: county only, industrial 40% → $7,056 (376,080 × 1.8762 / 100)", () => {
    const t = rut(R("000 - Rutherford", "09 - Industrial", 376080));
    expect(t.rows.map((r) => r.unit)).toEqual(["Rutherford County"]);
    expect(t.total).toBe(1.8762);
    expect(t.estimate.dollars).toBe(7056);
    expect(t.estimate.ratio).toBe(0.4);
    expect(t.estimate.text).toContain("$7,056");
    expect(t.caption).toBe("2025 rates");
  });
  it("126-050.12-000: county + Murfreesboro 2.8288, 4,395,720 → $124,346", () => {
    const t = rut(R("515 - Murfreesboro", "09 - Industrial", 4395720));
    expect(t.rows.map((r) => r.unit)).toEqual(["Rutherford County", "City of Murfreesboro"]);
    expect(t.total).toBe(2.8288);
    expect(t.estimate.dollars).toBe(124346);
  });
  it("every district sums to the Comptroller's printed TOTAL TAX RATE (independent check)", () => {
    const printed = { "000 - Rutherford": 1.8762, "227 - Eagleville": 2.2813, "400 - La Vergne": 2.4125, "515 - Murfreesboro": 2.8288, "674 - Smyrna": 2.4019 };
    for (const [g, total] of Object.entries(printed)) expect(rut(R(g, "00 - Residential", 100000)).total).toBe(total);
  });
  it("the dispatch's 0.41 for Eagleville is NOT used — the Comptroller's table says 0.4051", () => {
    expect(TN_RATES.eagleville.rate).toBe(0.4051);
  });
  it("residential / farm are 25%; commercial (08, Comm) 40%", () => {
    expect(rut(R("674 - Smyrna", "00 - Residential", 200000)).estimate.ratio).toBe(0.25);
    expect(rut(R("674 - Smyrna", "10 - Farm", 200000)).estimate.ratio).toBe(0.25);
    expect(rut(R("674 - Smyrna", "08 - Commercial", 200000)).estimate.ratio).toBe(0.4);
    expect(rut(R("674 - Smyrna", "Comm - Commercial - STR", 200000)).estimate.ratio).toBe(0.4);
  });
  it("an IDB / expired-IDB account shows the PILOT line, no rows, no total, no estimate", () => {
    for (const cls of ["IDB - Industrial Devel Board", "EXIDB - Expired IDB Account"]) {
      const t = rut(R("515 - Murfreesboro", cls, 3746000));
      expect(t.pilot).toBe(true);
      expect(t.rows).toEqual([]);
      expect(t.total).toBeNull();
      expect(t.estimate).toBeNull();
      expect(t.notes[0]).toMatch(/Industrial Development Board/);
      expect(t.notes[0]).toMatch(/ask the IDB/i);
    }
  });
  it("a tax-freeze account gets the rates but NO estimate (the bill is frozen at a base year)", () => {
    const t = rut(R("000 - Rutherford", "0 - Tax Freeze", 169950));
    expect(t.total).toBe(1.8762);
    expect(t.estimate).toBeNull();
    expect(t.notes.join(" ")).toMatch(/freeze/i);
  });
  it("an unmapped class (Homebelt, exempt) keeps the rate table but shows no estimate", () => {
    for (const cls of ["14 - Homebelt", "01 - Exempt", "05 - Religious", null]) {
      const t = rut(R("515 - Murfreesboro", cls, 500000));
      expect(t.total).toBe(2.8288);
      expect(t.estimate).toBeNull();
    }
  });
  it("no estimate without a positive assessed value (never a $0 bill)", () => {
    expect(rut(R("000 - Rutherford", "09 - Industrial", 0)).estimate).toBeNull();
    expect(rut(R("000 - Rutherford", "09 - Industrial", null)).estimate).toBeNull();
  });
  it("the estimate says it uses 2025 rates against 2026 values — a screen, not a bill", () => {
    const e = rut(R("000 - Rutherford", "09 - Industrial", 376080)).estimate.text;
    expect(e).toMatch(/2026 assessed value/);
    expect(e).toMatch(/2025 rates/);
    expect(e).toMatch(/2026 rates are not certified/);
    expect(e).toMatch(/not a bill/);
  });
  it("unknown / null / postal-city district → hidden (complete-or-hidden)", () => {
    for (const g of [null, "", "999 - Somewhere", "Murfreesboro", "Rutherford"]) expect(rut(R(g, "09 - Industrial", 1))).toBeNull();
    expect(rut({ attrs: null })).toBeNull();
    expect(rut(null)).toBeNull();
    expect(rut({ attrs: { CITY: "MURFREESBORO", CITYCODE: "515" } })).toBeNull(); // CITY / CITYCODE are postal — never read
  });
});

describe("Nashville / Davidson — TaxDist (trimmed)", () => {
  it("USD with the layer's trailing space → GSD + the USD add-on = 2.814", () => {
    const t = dav(D("USD "));
    expect(t.total).toBe(2.814);
    expect(t.rows.map((r) => r.rate)).toEqual([2.782, 0.032]);
    expect(t.estimate).toBeNull(); // no class field → no dollar estimate
    expect(t.caption).toBe("2025 rates");
  });
  it("GSD (trailing space) → 2.782; also works trimmed", () => {
    expect(dav(D("GSD ")).total).toBe(2.782);
    expect(dav(D("GSD")).total).toBe(2.782);
    expect(dav(D("  usd")).total).toBe(2.814);
  });
  it("satellite cities add their own levy on top of the GSD (Comptroller's printed totals)", () => {
    expect(dav(D("BM")).total).toBe(3.0831);
    expect(dav(D("GO")).total).toBe(3.2888);
    expect(dav(D("RT")).total).toBe(3.131);
    expect(dav(D("BM")).rows.map((r) => r.unit)).toEqual(["Metro Nashville · General Services District", "City of Belle Meade"]);
  });
  it("Oak Hill and Forest Hills levy no city property tax → GSD alone, and the page says so", () => {
    for (const c of ["OH", "FH"]) {
      const t = dav(D(c));
      expect(t.total).toBe(2.782);
      expect(t.notes.join(" ")).toMatch(/levies no city property tax/);
    }
  });
  it("Berry Hill, improvement districts, null and UNASSIGNED are hidden", () => {
    for (const c of ["BH", "CBID", "GBID", "MBID", "SNDG", "SNDU", "UNASSIGNED", "", null, undefined, "ZZ"]) expect(dav(D(c))).toBeNull();
  });
  it("every declared code yields complete rows (each unit has a sourced numeric rate) or null", () => {
    for (const c of ["USD", "GSD", "BM", "GO", "RT", "OH", "FH", "BH", "CBID", "GBID", "MBID", "SNDG", "SNDU", "UNASSIGNED"]) {
      const t = dav(D(c));
      if (t == null) continue;
      expect(t.rows.length).toBeGreaterThan(0);
      for (const r of t.rows) { expect(r.unit).toBeTruthy(); expect(Number.isFinite(r.rate)).toBe(true); }
      expect(t.year).toBe(TN_RATE_YEAR);
      expect(t.sourceUrl).toMatch(/comptroller\.tn\.gov/);
    }
  });
});

describe("wiring through taxTableFor / taxTableForCombined", () => {
  it("taxTableFor routes the two TN counties and covers them in TAX_COVERAGE", () => {
    expect(TN_TAX_COUNTIES).toEqual(["tn_rutherford", "tn_davidson"]);
    expect(taxTableFor(R("515 - Murfreesboro", "09 - Industrial", 1000), { county: "tn_rutherford" }).total).toBe(2.8288);
    expect(taxTableFor(D("GSD "), { county: "tn_davidson" }).total).toBe(2.782);
    expect(TAX_COVERAGE.tn_rutherford.covered).toBe(true);
    expect(TAX_COVERAGE.tn_davidson.covered).toBe(true);
  });
  it("another Tennessee county / a Texas county never gets a number from here (owner constraint #3)", () => {
    expect(taxTableFor(R("515 - Murfreesboro", "09 - Industrial", 1000), { county: "tn_shelby" })).toBeNull();
    expect(taxTableFor(R("515 - Murfreesboro", "09 - Industrial", 1000), { county: "harris" })).toBeNull();
  });
  it("combined: lots in the same districts share a total; a PILOT / hidden lot hides the combined line", () => {
    const o = { county: "tn_rutherford" };
    expect(taxTableForCombined([R("515 - Murfreesboro", "09 - Industrial", 1), R("515 - Murfreesboro", "08 - Commercial", 2)], o)).toMatchObject({ allShare: true, total: 2.8288 });
    expect(taxTableForCombined([R("515 - Murfreesboro", "09 - Industrial", 1), R("000 - Rutherford", "09 - Industrial", 2)], o)).toMatchObject({ allShare: false, total: null });
    expect(taxTableForCombined([R("515 - Murfreesboro", "09 - Industrial", 1), R("515 - Murfreesboro", "IDB - Industrial Devel Board", 0)], o)).toBeNull();
    expect(taxTableForCombined([R("515 - Murfreesboro", "09 - Industrial", 1), R(null, "09 - Industrial", 2)], o)).toBeNull();
  });
});

describe("leadCode", () => {
  it("reads the code before the dash", () => {
    expect(leadCode("515 - Murfreesboro")).toBe("515");
    expect(leadCode("09 - Industrial")).toBe("09");
    expect(leadCode("Comm - Commercial - STR")).toBe("COMM");
    expect(leadCode("EXIDB - Expired IDB Account")).toBe("EXIDB");
    expect(leadCode("0 - Tax Freeze")).toBe("0");
    expect(leadCode("")).toBeNull();
    expect(leadCode(null)).toBeNull();
  });
});
