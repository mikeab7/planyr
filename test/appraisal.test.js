import { describe, it, expect } from "vitest";
import { apprRows, apprVal, findAttr } from "../src/workspaces/site-planner/lib/appraisal.js";

// A parcel answered by the statewide TxGIO backup must surface the SAME curated
// appraisal rows as one from its home county — otherwise the backup looks broken even
// though the data is there. TxGIO's column names differ from the CADs', so the field
// map covers both (B239 field normalization).
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

describe("apprRows — TxGIO statewide-backup field mapping (B239)", () => {
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
