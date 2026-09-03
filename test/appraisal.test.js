import { describe, it, expect } from "vitest";
import { apprRows, apprVal, findAttr, apprAll, situsAddress, situsKey, isPlaceholderValue } from "../src/workspaces/site-planner/lib/appraisal.js";

// A parcel answered by the statewide TxGIO backup must surface the SAME curated
// appraisal rows as one from its home county — otherwise the backup looks broken even
// though the data is there. TxGIO's column names differ from the CADs', so the field
// map covers both (B244 field normalization).
const TXGIO = {
  prop_id: 40594,
  geo_id: "0001-00-000-0010-901",
  owner_name: "ACME INDUSTRIAL LP",
  situs_addr: "1234 INDUSTRIAL PKWY",
  legal_desc: "ABST 100 J SMITH TR 5",
  legal_area: 12.34,
  gis_area: 12.31,
  land_value: 250000,
  imp_value: 100000,
  mkt_value: 350000,
  stat_land_use: "F1 - COMMERCIAL",
  year_built: 1998,
  county: "FORT BEND",
  OBJECTID: 7,
  Shape_Area: 537293.1, // a system field — must be ignored
};

describe("apprRows — TxGIO statewide-backup field mapping (B244)", () => {
  const rows = apprRows(TXGIO);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, String(r.value)]));

  it("maps owner / situs / account from the TxGIO column names", () => {
    expect(byLabel["Owner"]).toBe("ACME INDUSTRIAL LP");
    expect(byLabel["Situs address"]).toBe("1234 INDUSTRIAL PKWY");
    expect(byLabel["Account / ID"]).toBe("40594");
  });

  it("maps legal_area → Acreage (TxGIO has no *_acre column)", () => {
    expect(byLabel["Acreage"]).toBe("12.34");
  });

  it("maps land_value / imp_value / mkt_value to the money rows", () => {
    expect(byLabel["Land value"]).toBe("250000");
    expect(byLabel["Improvement value"]).toBe("100000");
    expect(byLabel["Total value"]).toBe("350000"); // mkt_value — previously unmapped
  });

  it("maps stat_land_use → Land use and year_built → Year built", () => {
    expect(byLabel["Land use"]).toBe("F1 - COMMERCIAL");
    expect(byLabel["Year built"]).toBe("1998");
  });

  it("formats money fields with $ and thousands separators", () => {
    expect(apprVal("Total value", TXGIO.mkt_value)).toBe("$350,000");
  });

  it("findAttr reads the county attribute (drives the honest backup badge)", () => {
    expect(findAttr(TXGIO, /^county$/i)).toBe("FORT BEND");
  });
});

// B787 — Chambers now rides CCAD's own live service (ChambersCADPublic), whose column
// names differ from both the other CADs and TxGIO. The curated appraisal panel must
// surface the same rows from CCAD's schema, or the repoint would look broken. Field
// names + the sample parcel (53773, Angel Brothers Properties LLC @ Grand Port) are from
// the live-verified CCAD discovery.
const CCAD = {
  Parcel_Id: 53773,
  Account: "R000053773",
  Owner_Name: "ANGEL BROTHERS PROPERTIES LLC",
  Prop_Street_Number: "1000",
  Prop_Street: "GRAND PORT",
  Prop_Street_Suffix: "BLVD",
  Acres: 12.5,
  StatedArea: 544500,
  Market_Value: 875000,
  Legal1: "ABST 100 J SMITH",
  Legal2: "TRACT 5",
  Primary_Category_Code: "F1",
  OBJECTID: 12,
  Shape__Area: 544500.0, // a system field — must be ignored
};

describe("apprRows — CCAD (ChambersCADPublic) field mapping (B787)", () => {
  const rows = apprRows(CCAD);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, String(r.value)]));

  it("maps Owner_Name → Owner", () => {
    expect(byLabel["Owner"]).toBe("ANGEL BROTHERS PROPERTIES LLC");
  });

  it("maps Prop_Street → Situs address (the street NAME, not the number sub-column)", () => {
    expect(byLabel["Situs address"]).toBe("GRAND PORT");
  });

  it("surfaces the Account / ID row from CCAD's Parcel_Id or Account", () => {
    expect(["53773", "R000053773"]).toContain(byLabel["Account / ID"]);
  });

  it("maps Acres → Acreage", () => {
    expect(byLabel["Acreage"]).toBe("12.5");
  });

  it("maps Market_Value → Total value", () => {
    expect(byLabel["Total value"]).toBe("875000");
    expect(apprVal("Total value", CCAD.Market_Value)).toBe("$875,000");
  });

  it("maps Primary_Category_Code → Land use", () => {
    expect(byLabel["Land use"]).toBe("F1");
  });

  it("maps Legal1 → Legal (first legal line wins)", () => {
    expect(byLabel["Legal"]).toBe("ABST 100 J SMITH");
  });
});

// NEW-2 (2026-09-02) — a real Harris parcel record served through the TxGIO statewide fallback
// (site_planner/lib/counties.js — every county's own CAD is tried first; a point can still land
// on this schema when the county's own service has no match at that spot). Field order matches
// production exactly — SITUS_NUM precedes SITUS_ADDR, and GEO_ID precedes PROP_ID — because the
// two defects this record exposed BOTH depend on object key order: "Account / ID" showed the
// literal four-character string "Null" (GEO_ID) instead of the real PROP_ID, and "Situs address"
// showed the bare house number "0" (SITUS_NUM) instead of the full address (SITUS_ADDR).
const TXGIO_RICHFIELD = {
  FIPS: "48201",
  shape: "Polygon",
  COUNTY: "HARRIS",
  GEO_ID: "Null",
  SOURCE: "HARRIS APPRAISAL DISTRICT",
  PROP_ID: "0430680000001",
  DATE_ACQ: "20250801",
  GIS_AREA: "6113.823835462",
  MAIL_ZIP: "77042-3140",
  TAX_YEAR: "2025",
  objectid: "7272174",
  IMP_VALUE: "0",
  MAIL_ADDR: "10001 WESTHEIMER RD STE 2888 , HOUSTON, TX 77042-3140",
  MAIL_CITY: "HOUSTON",
  MAIL_STAT: "TX",
  MKT_VALUE: "8918152",
  NAME_CARE: "RICHFIELD RANCH",
  SITUS_NUM: "0",
  SITUS_ZIP: "77447",
  LAND_VALUE: "8918152",
  LEGAL_AREA: "568.9304 AC",
  LEGAL_DESC: "Null",
  MAIL_LINE1: "10001 WESTHEIMER RD STE 2888",
  MAIL_LINE2: "Null",
  OWNER_NAME: "RICHFIELD RANCH",
  SITUS_ADDR: "0 GRAND PKY, HOCKLEY, TX 77447",
  SITUS_CITY: "HOCKLEY",
  SITUS_STAT: "TX",
  SITUS_STRE: "Null",
  SITUS_ST_1: "GRAND",
  SITUS_ST_2: "PKY",
  YEAR_BUILT: "0",
  LOC_LAND_USE: "Null",
  GIS_AREA_UNIT: "Acres",
  LGL_AREA_UNIT: "Acres",
  STAT_LAND_USE: "1D1",
  "st_area(shape)": "3074061.923948",
  "st_perimeter(shape)": "7854.323667",
};

describe("isPlaceholderValue — the county's own null-sentinel text (NEW-2)", () => {
  it("treats the literal string \"Null\" (and case/whitespace variants) as absent", () => {
    expect(isPlaceholderValue("Null")).toBe(true);
    expect(isPlaceholderValue("NULL")).toBe(true);
    expect(isPlaceholderValue(" null ")).toBe(true);
    expect(isPlaceholderValue("None")).toBe(true);
    expect(isPlaceholderValue("N/A")).toBe(true);
    expect(isPlaceholderValue("--")).toBe(true);
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue("")).toBe(true);
  });
  it("does not flag real data, including a bare \"0\" (a legitimate value in many fields)", () => {
    expect(isPlaceholderValue("0")).toBe(false);
    expect(isPlaceholderValue("RICHFIELD RANCH")).toBe(false);
    expect(isPlaceholderValue(0)).toBe(false);
  });
});

describe("apprRows / situsAddress — the Richfield Ranch TxGIO record (NEW-2)", () => {
  const rows = apprRows(TXGIO_RICHFIELD);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, String(r.value)]));

  it("never surfaces the literal \"Null\" text as a fact", () => {
    for (const r of rows) expect(String(r.value)).not.toMatch(/^null$/i);
  });

  it("Account / ID skips GEO_ID's \"Null\" and resolves to the real PROP_ID", () => {
    expect(byLabel["Account / ID"]).toBe("0430680000001");
  });

  it("Situs address resolves to the composed SITUS_ADDR, not the bare SITUS_NUM house number", () => {
    expect(situsAddress(TXGIO_RICHFIELD)).toBe("0 GRAND PKY, HOCKLEY, TX 77447");
    expect(byLabel["Situs address"]).toBe("0 GRAND PKY, HOCKLEY, TX 77447");
    expect(situsKey(TXGIO_RICHFIELD)).toBe("SITUS_ADDR");
  });

  it("apprAll drops every placeholder-text field (GEO_ID, LEGAL_DESC, MAIL_LINE2, SITUS_STRE, LOC_LAND_USE)", () => {
    const all = apprAll(TXGIO_RICHFIELD);
    const labels = all.map((r) => r.label);
    for (const dropped of ["GEO ID", "LEGAL DESC", "MAIL LINE2", "SITUS STRE", "LOC LAND USE"]) {
      expect(labels).not.toContain(dropped);
    }
    // and the ones that ARE real still come through
    expect(all.find((r) => r.label === "OWNER NAME")?.value).toBe("RICHFIELD RANCH");
  });

  it("findAttr also skips a placeholder-text match", () => {
    expect(findAttr(TXGIO_RICHFIELD, /geo_?id/i)).toBeNull();
    expect(findAttr(TXGIO_RICHFIELD, /prop_?id/i)).toBe("0430680000001");
  });
});

// A plain single-field CAD (the common case — one "SITUS" column, no decomposed siblings) must
// keep working exactly as before: the composed/decomposed split only matters when more than one
// situs-flavored key exists.
describe("situsAddress — single-field CAD schemas are unaffected by the composed-field rung", () => {
  it("Fort Bend / Montgomery style: one plain SITUS column", () => {
    expect(situsAddress({ SITUS: "4050 CR 50, JOHNSTOWN" })).toBe("4050 CR 50, JOHNSTOWN");
  });
});
