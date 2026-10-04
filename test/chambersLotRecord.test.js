/* B2024626 — a joined Chambers CAD row (table-prefixed fields, no situs) must still yield
 * owner, legal, the real CAD account and a name before "Parcel N". Attribute set is the live row
 * measured 2026-10-03 for lot 15835. */
import { describe, it, expect } from "vitest";
import { ownerName, apprRows, situsAddress, parcelFallbackName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { parcelDisplayInfo } from "../src/workspaces/site-planner/lib/siteModel.js";

const A = "ChambersCADWeb.DBO.Accounts.";
const T = "ChambersCADWeb.DBO.TaxParcels.";
const ATTRS = {
  [T + "OBJECTID"]: 41,
  [T + "Name"]: "15835",
  [A + "OBJECTID"]: 2933785,
  [A + "Account"]: "00321-02000-00100-100001",
  [A + "Owner_Name"]: "BARBERS HILL EDUCATION FOUNDATION",
  [A + "Legal1"]: "321 TR 20-1 C C SCHOOL",
  [A + "Acres"]: 10.6945,
  [A + "Prop_City"]: "MONT BELVIEU",
};

describe("Chambers joined-layer record, no situs", () => {
  it("has no situs (premise)", () => expect(situsAddress(ATTRS)).toBeNull());
  it("owner resolves from the table-prefixed column, not the lot-number Name", () => {
    expect(ownerName(ATTRS)).toBe("BARBERS HILL EDUCATION FOUNDATION");
  });
  it("Account / ID is the CAD account, not the Accounts.OBJECTID row id", () => {
    const row = apprRows(ATTRS).find((r) => r.label === "Account / ID");
    expect(row.value).toBe("00321-02000-00100-100001");
  });
  it("legal + acreage resolve", () => {
    const rows = apprRows(ATTRS);
    expect(rows.find((r) => r.label === "Legal").value).toBe("321 TR 20-1 C C SCHOOL");
    expect(rows.find((r) => r.label === "Acreage").value).toBe(10.6945);
  });
  it("the stored parcel is named for its owner before 'Parcel N'", () => {
    const info = parcelDisplayInfo([{ id: "p1", points: [[0, 0], [1, 0], [1, 1]], addr: null, attrs: ATTRS }]);
    expect(info.get("p1").name).toBe("BARBERS HILL EDUCATION FOUNDATION");
  });
  it("falls back to legal, then to a number", () => {
    const { [A + "Owner_Name"]: _o, ...noOwner } = ATTRS;
    expect(parcelFallbackName(noOwner)).toBe("321 TR 20-1 C C SCHOOL");
    expect(parcelDisplayInfo([{ id: "p1", points: [[0, 0], [1, 0], [1, 1]], addr: null, attrs: null }]).get("p1").name).toMatch(/^Parcel \d/);
  });
  it("a bare un-prefixed schema is untouched", () => {
    expect(ownerName({ OWNER_NAME: "ACME", NAME: "7" })).toBe("ACME");
  });
});
