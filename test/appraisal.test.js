import { describe, it, expect } from "vitest";
import { apprRows, apprVal, findAttr } from "../src/workspaces/site-planner/lib/appraisal.js";

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

// B784 — Chambers now rides CCAD's own live service (ChambersCADPublic), whose column
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

describe("apprRows — CCAD (ChambersCADPublic) field mapping (B784)", () => {
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
