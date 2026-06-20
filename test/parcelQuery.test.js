import { describe, it, expect } from "vitest";
import { buildParcelWhere, okField, isDefaultLookupUrl } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const COUNTIES_HARRIS_URL = COUNTIES.harris.layerUrl;

// buildParcelWhere is the ONE place a parcel-search where-clause is built, so the
// primary CAD query and the statewide-backup (TxGIO) query construct it identically —
// same numeric/LIKE choice, same county scoping, same injection guard (B47/B239/B240).
const META = { fields: [
  { name: "prop_id", type: "esriFieldTypeInteger" },
  { name: "situs_addr", type: "esriFieldTypeString" },
  { name: "county", type: "esriFieldTypeString" },
] };

describe("buildParcelWhere — shared, scoped, injection-safe where builder", () => {
  it("a numeric id on a numeric field → an equality clause", () => {
    expect(buildParcelWhere({ meta: META, mode: "id", value: "40594", idField: "prop_id", addrField: "situs_addr" }))
      .toBe("prop_id = 40594");
  });

  it("a non-numeric id → a case-insensitive LIKE", () => {
    expect(buildParcelWhere({ meta: META, mode: "id", value: "R12A", idField: "prop_id", addrField: "situs_addr" }))
      .toBe("UPPER(prop_id) LIKE UPPER('%R12A%')");
  });

  it("an address search → LIKE on the address field", () => {
    expect(buildParcelWhere({ meta: META, mode: "address", value: "MAIN ST", addrField: "situs_addr" }))
      .toBe("UPPER(situs_addr) LIKE UPPER('%MAIN ST%')");
  });

  it("ANDs the county scope when the scope field exists (no cross-county leak)", () => {
    expect(buildParcelWhere({ meta: META, mode: "id", value: "40594", idField: "prop_id", scopeWhere: "county='FORT BEND'" }))
      .toBe("(county='FORT BEND') AND (prop_id = 40594)");
  });

  it("skips the scope when the field is absent (self-healing for a single-county URL)", () => {
    const meta2 = { fields: [{ name: "prop_id", type: "esriFieldTypeInteger" }] }; // no `county` column
    expect(buildParcelWhere({ meta: meta2, mode: "id", value: "40594", idField: "prop_id", scopeWhere: "county='FORT BEND'" }))
      .toBe("prop_id = 40594");
  });

  it("escapes single quotes in the search value", () => {
    expect(buildParcelWhere({ meta: META, mode: "address", value: "O'NEIL", addrField: "situs_addr" }))
      .toContain("O''NEIL");
  });

  it("rejects a field name that isn't a plain identifier (B47 SQL-injection guard)", () => {
    expect(() => buildParcelWhere({ meta: META, mode: "id", value: "x", idField: "prop_id; DROP TABLE", addrField: "situs_addr" }))
      .toThrow(/field name/i);
  });

  it("throws a plain (non-outage) error when the layer has no id field", () => {
    const e = (() => { try { buildParcelWhere({ meta: { fields: [] }, mode: "id", value: "1", idField: null, addrField: "a" }); } catch (err) { return err; } })();
    expect(e).toBeInstanceOf(Error);
    expect(e.unavailable).toBeUndefined(); // a config problem, NOT a server outage
  });
});

describe("okField / isDefaultLookupUrl", () => {
  it("okField accepts identifiers and rejects punctuation", () => {
    expect(okField("prop_id")).toBe(true);
    expect(okField("a.b_c")).toBe(true);
    expect(okField("x'; DROP")).toBe(false);
    expect(okField("a b")).toBe(false);
  });

  it("isDefaultLookupUrl recognizes a county's own default URL (trailing slash ignored)", () => {
    expect(isDefaultLookupUrl("harris", COUNTIES_HARRIS_URL)).toBe(true);
    expect(isDefaultLookupUrl("harris", COUNTIES_HARRIS_URL + "/")).toBe(true);
    expect(isDefaultLookupUrl("harris", "https://example.com/Other/MapServer/0")).toBe(false); // a user override
  });
});
