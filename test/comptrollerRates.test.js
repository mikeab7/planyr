import { describe, it, expect } from "vitest";
import { findHeader, extractCountyRows, normalizeUnitName, findRateByName } from "../functions/api/lib/comptrollerRates.js";

// Row shapes measured live from the Texas Comptroller's real 2025 workbooks (2026-09-02) — the
// county file carries no per-unit NAME column (the row IS the county) and its rate column is
// literally named "TOTAL COUNTY TAX RATE"; the other three carry a "TAXING UNIT NAME" + "SPLIT"
// column and a "TOTAL TAX RATE" column, with the school file inserting one extra taxable-value
// column the others don't have. Fixtures mirror both shapes so the header-driven column lookup
// is proven against BOTH, not just one convenient layout.
const COUNTY_SHEET = [
  ["COUNTY RATES AND LEVIES"],
  ["2025 COUNTY REPORT OF PROPERTY VALUE"],
  ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "VERSION NAME", "VERSION DATE", "MARKET VALUE",
    "TAXABLE VALUE FOR GENERAL/ROAD AND BRIDGE FUNDS", "TAXABLE VALUE FOR FMFC FUND", "NO-NEW-REVENUE RATE",
    "VOTER-APPROVAL RATE", "GF M&O TAX RATE", "GF I&S TAX RATE", "GF TOTAL RATE", "R&B M&O TAX RATE", "R&B I&S TAX RATE",
    "R&B TOTAL RATE", "FMFC M&O RATE", "FMFC I&S RATE", "FMFC TOTAL  RATE", "TOTAL COUNTY TAX RATE", "CALCULATED LEVY"],
  [101, "Harris", "101", "Harris", "101-000-00-101-101", "Working", "01/28/2026", 939175677862, 692472657559, 828755354053,
    0.38096, 0.37742, 0.33696, 0.044, 0.38096, 0, 0, 0, 0, 0, 0, 0.38096, 2638043836],
  [102, "Harrison", "102", "Harrison", "102-000-00-102-102", "Working", "01/28/2026", 14618005927, 10355920970, 11274255845,
    0, 0, 0.3428, 0, 0.3428, 0, 0, 0, 0, 0, 0, 0.3428, 35500097],
];

const CITY_SHEET = [
  ["CITY RATES AND LEVIES"],
  ["2025 CITY REPORT OF PROPERTY VALUE"],
  ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT", "VERSION NAME",
    "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE", "NO-NEW-REVENUE RATE", "VOTER-APPROVAL RATE", "M&O RATE",
    "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
  [101, "Harris", "101", "Harris", "101-101-03-101-101", "Houston", "X", "Working", "01/28/2026", 1, 1, 0.15, 0.17, 0.1667, 0, 0.1667, 1],
];

const SCHOOL_SHEET = [
  ["ISD RATES AND LEVIES"],
  ["2025 ISD REPORT OF PROPERTY VALUE"],
  ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT", "VERSION NAME",
    "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE M&O", "TAXABLE VALUE I&S", "NO-NEW-REVENUE RATE",
    "VOTER-APPROVAL RATE", "M&O RATE", "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
  [101, "Harris", "101", "Harris", "101-902-02-101-101", "Waller ISD", "X", "Working", "01/28/2026", 1, 1, 1, 0.42, 0.44, 0.3, 0.14, 0.44, 1],
];

const SPECIAL_SHEET = [
  ["SPECIAL DISTRICT RATES AND LEVIES"],
  ["2025 SPECIAL DISTRICT REPORT OF PROPERTY VALUE"],
  ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT", "VERSION NAME",
    "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE", "NO-NEW-REVENUE RATE", "VOTER-APPROVAL RATE", "M&O RATE",
    "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
  [101, "Harris", "101", "Harris", "101-202-11-101-101", "Harris County Hospital District", "", "Working", "01/28/2026", 1, 1, 0.16086, 0.18761, 0.17876, 0.00885, 0.18761, 1272461401],
  [101, "Harris", "101", "Harris", "079-207-48-101-101", "Katy Management District #1", "X", "Working", "01/28/2026", 1, 1, 0, 0.8, 0.8, 0, 0.8, 1],
];

describe("findHeader — locates the real header row and column indices by TEXT, not position", () => {
  it("finds it past the two title rows every workbook carries", () => {
    const h = findHeader(COUNTY_SHEET);
    expect(h.headerRow).toBe(2);
    expect(COUNTY_SHEET[h.headerRow][h.cols.countyName]).toBe("COUNTY NAME");
    expect(COUNTY_SHEET[h.headerRow][h.cols.rate]).toBe("TOTAL COUNTY TAX RATE");
  });
  it("resolves the differently-shaped city/school/special headers too", () => {
    expect(findHeader(CITY_SHEET).cols.rate).toBe(15);
    expect(findHeader(SCHOOL_SHEET).cols.rate).toBe(16); // one extra taxable-value column shifts it
    expect(findHeader(SPECIAL_SHEET).cols.rate).toBe(15);
  });
  it("returns null for a sheet that doesn't look like a rates-and-levies workbook (LOUD-FAILURE)", () => {
    expect(findHeader([["not", "this"], [1, 2]])).toBeNull();
  });
});

describe("extractCountyRows — Harris rows only, real values", () => {
  it("county file: the county's own consolidated rate, with the version date", () => {
    const r = extractCountyRows(COUNTY_SHEET, "Harris");
    expect(r.versionDate).toBe("01/28/2026");
    expect(r.rows).toEqual([{ name: "Harris", rate: 0.38096, split: false }]);
  });
  it("is case-insensitive on county name and excludes other counties", () => {
    const r = extractCountyRows(COUNTY_SHEET, "harris");
    expect(r.rows).toHaveLength(1);
    expect(r.rows.find((row) => row.name === "Harrison")).toBeUndefined();
  });
  it("city file: taxing-unit name + rate + split flag", () => {
    const r = extractCountyRows(CITY_SHEET, "Harris");
    expect(r.rows).toEqual([{ name: "Houston", rate: 0.1667, split: true }]);
  });
  it("school file: same shape despite the different column layout", () => {
    const r = extractCountyRows(SCHOOL_SHEET, "Harris");
    expect(r.rows).toEqual([{ name: "Waller ISD", rate: 0.44, split: true }]);
  });
  it("special-district file: multiple rows, split flag distinguishes county-wide from area-specific", () => {
    const r = extractCountyRows(SPECIAL_SHEET, "Harris");
    expect(r.rows).toEqual([
      { name: "Harris County Hospital District", rate: 0.18761, split: false },
      { name: "Katy Management District #1", rate: 0.8, split: true },
    ]);
  });
  it("returns null (not an empty array) for an unrecognized sheet shape", () => {
    expect(extractCountyRows([["a", "b"]], "Harris")).toBeNull();
  });
});

describe("normalizeUnitName / findRateByName — matching against real naming variance", () => {
  it("'City of Houston' matches 'Houston'", () => {
    expect(normalizeUnitName("City of Houston")).toBe(normalizeUnitName("Houston"));
  });
  it("case/punctuation differences don't block a match", () => {
    expect(normalizeUnitName("WALLER ISD")).toBe(normalizeUnitName("Waller ISD"));
  });
  it("findRateByName finds the right row and ignores a near-miss it can't confirm", () => {
    const rows = [{ name: "Waller ISD", rate: 0.44 }, { name: "Katy ISD", rate: 0.39 }];
    expect(findRateByName(rows, "Waller ISD")).toBe(0.44);
    expect(findRateByName(rows, "Waller Independent School District")).toBeNull(); // not a guess
  });
});
