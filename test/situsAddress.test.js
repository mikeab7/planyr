import { describe, it, expect } from "vitest";
import {
  situsAddress, situsKey, siteNameFromParcel, mailingAddressValues, apprRows,
} from "../src/workspaces/site-planner/lib/appraisal.js";
import { detectField } from "../src/workspaces/site-planner/lib/counties.js";

/* NEW-2 — the situs address must never resolve to the OWNER'S MAILING address.
 *
 * The repro is a real saved plan: site `sms7v3ua7ksy`, a parcel in WELD COUNTY, COLORADO, named
 * "2221 E LAMAR BLVD STE 790" — FORESTAR (USA) REAL ESTATE GROUP INC's corporate mailing address in
 * Arlington, TEXAS. WELD below is that record's attribute bag, copied verbatim from the row (values
 * intact, only the unrelated columns trimmed), IN THE SERVICE'S OWN KEY ORDER — which matters,
 * because "whichever matching key comes first" is precisely what the old resolver did.
 *
 * Note what the defect was NOT: nothing in `ADDRESS1` says "mail", so excluding a mail/owner/billing
 * key family would not have caught it. The fix is the ordered LADDER — every key is tested against
 * "is this the situs?" before any key is tested against the generic catch-all.
 */
const WELD = {
  LOT: " ",
  CITY: "ARLINGTON",                                   // the MAILING city, on a Colorado parcel
  NAME: "FORESTAR (USA) REAL ESTATE GROUP INC",
  LEGAL: "W2NW4 2-4-68 EXC PT LYING WITHIN COMM N4 SEC COR TH S06D25E 30.118 TPOB…",
  SITUS: "4050 CR 50   JOHNSTOWN",                     // ← the land
  STATE: "TX",
  PARCEL: "106102200011",
  LOCCITY: "JOHNSTOWN",
  ZIPCODE: "760067458",
  ADDRESS1: "2221 E LAMAR BLVD STE 790",               // ← the owner's head office
  ADDRESS2: " ",
  STREETNO: "4050",
  ACCOUNTNO: "R8974495",
  GIS_Acres: 62.6569553033,
  STREETNAME: "CR 50",
};

/* The Texas shape this repo already carries: a county whose records hold BOTH a situs column and a
 * mailing one, under names that both contain "addr". */
const WALLER = {
  PROP_ID: 40594,
  OWNER_NAME: "ACME INDUSTRIAL LP",
  MAIL_ADDR: "PO BOX 1200",
  MAIL_CITY: "HEMPSTEAD",
  SITUS_ADDR: "1234 FM 359",
  LEGAL_DESC: "ABST 100 J SMITH TR 5",
};

describe("situsAddress — the LAND's address, never the owner's mailing address (NEW-2)", () => {
  it("Weld County: SITUS beats ADDRESS1 even though nothing in ADDRESS1 says 'mail'", () => {
    expect(situsKey(WELD)).toBe("SITUS");
    expect(situsAddress(WELD)).toBe("4050 CR 50 JOHNSTOWN"); // padding collapsed
    expect(situsAddress(WELD)).not.toBe("2221 E LAMAR BLVD STE 790");
  });

  it("key ORDER cannot change the answer — the ladder is applied rung by rung", () => {
    // Same record, mailing column listed first (some services do). The old "first matching key
    // wins" resolver flipped on exactly this.
    const reordered = Object.fromEntries(
      [["ADDRESS1", WELD.ADDRESS1], ["ADDRESS2", WELD.ADDRESS2], ...Object.entries(WELD)],
    );
    expect(Object.keys(reordered)[0]).toBe("ADDRESS1");     // the ordering the test depends on
    expect(situsAddress(reordered)).toBe("4050 CR 50 JOHNSTOWN");
  });

  it("Waller shape: SITUS_ADDR beats MAIL_ADDR", () => {
    expect(situsAddress(WALLER)).toBe("1234 FM 359");
  });

  it("a record with ONLY a mailing address yields NO address, not the mailing one", () => {
    expect(situsAddress({ OWNER_NAME: "ACME LP", MAIL_ADDR: "PO BOX 1200" })).toBeNull();
    expect(situsAddress({ OWNER_ADDRESS: "1 CORPORATE WAY", CARE_OF: "TAX DEPT" })).toBeNull();
    // …including the un-named mailing block: numbered address LINES are refused by the generic rung.
    expect(situsAddress({ NAME: "ACME LP", ADDRESS1: "2221 E LAMAR BLVD STE 790", ADDRESS2: " ", CITY: "ARLINGTON" })).toBeNull();
  });

  it("a county that names its situs column plainly still resolves (the generic rung survives)", () => {
    expect(situsAddress({ OWNER: "X", ADDRESS: "500 INDUSTRIAL BLVD" })).toBe("500 INDUSTRIAL BLVD");
    expect(situsAddress({ full_addr: "500 INDUSTRIAL BLVD" })).toBe("500 INDUSTRIAL BLVD");
    expect(situsAddress({ prop_addr: "500 INDUSTRIAL BLVD", MAIL_ADDRESS: "PO BOX 9" })).toBe("500 INDUSTRIAL BLVD");
  });

  it("an empty / whitespace-only situs column falls through instead of winning", () => {
    expect(situsAddress({ SITUS: "   ", PROP_ADDR: "9 REAL ST" })).toBe("9 REAL ST");
    expect(situsAddress({ SITUS: null, ADDRESS: "9 REAL ST" })).toBe("9 REAL ST");
  });

  it("no attrs at all is null, not a crash", () => {
    expect(situsAddress(null)).toBeNull();
    expect(situsAddress({})).toBeNull();
  });
});

describe("mailingAddressValues", () => {
  it("collects the owner-mailing values a name can identify", () => {
    expect(mailingAddressValues(WALLER).has("PO BOX 1200")).toBe(true);
    expect(mailingAddressValues(WALLER).has("1234 FM 359")).toBe(false);
    expect(mailingAddressValues(WELD).has("2221 E LAMAR BLVD STE 790")).toBe(true); // ADDRESS1 = a line
  });
});

describe("siteNameFromParcel — what 'Plan this site' names the plan (NEW-2)", () => {
  it("the Weld plan is named after the LAND, not Forestar's head office", () => {
    const name = siteNameFromParcel(WELD, { searched: "4050 COUNTY ROAD 50", acct: "R8974495" });
    expect(name).toBe("4050 CR 50 JOHNSTOWN");
    expect(name).not.toBe("2221 E LAMAR BLVD STE 790");
  });

  it("falls back to what the user SEARCHED when the record carries no situs", () => {
    const attrs = { NAME: "ACME LP", MAIL_ADDR: "PO BOX 1200" };
    expect(siteNameFromParcel(attrs, { searched: "4050 County Road 50", acct: "R1" })).toBe("4050 County Road 50");
  });

  it("falls back to the account id when there is no situs and nothing was searched", () => {
    expect(siteNameFromParcel({ MAIL_ADDR: "PO BOX 1" }, { acct: "R8974495" })).toBe("R8974495");
    expect(siteNameFromParcel({ MAIL_ADDR: "PO BOX 1" }, {})).toBe("Untitled site");
  });

  it("REFUSES any candidate that equals a mailing value, whatever supplied it", () => {
    // The belt-and-braces guard: even handed the mailing address as a resolved `addr`, the seeded
    // name must not become it.
    const name = siteNameFromParcel(WELD, { addr: "2221 E LAMAR BLVD STE 790", searched: "4050 COUNTY ROAD 50" });
    expect(name).toBe("4050 COUNTY ROAD 50");
  });

  it("never returns the owner's mailing address on any shape in this file", () => {
    for (const attrs of [WELD, WALLER]) {
      const mailed = mailingAddressValues(attrs);
      const name = siteNameFromParcel(attrs, { searched: "123 ANY ST", acct: "R1" });
      expect(mailed.has(name.toUpperCase())).toBe(false);
    }
  });
});

describe("the curated rows + the search field use the same ladder", () => {
  it("apprRows' Situs address row is the situs, not the mailing line", () => {
    const byLabel = Object.fromEntries(apprRows(WELD).map((r) => [r.label, String(r.value)]));
    expect(byLabel["Situs address"]).toBe("4050 CR 50 JOHNSTOWN");
    expect(byLabel.Owner).toBe("FORESTAR (USA) REAL ESTATE GROUP INC");
  });

  it("detectField picks the situs column even when the mailing column is listed first", () => {
    const fields = [{ name: "OBJECTID" }, { name: "ADDRESS1" }, { name: "MAIL_ADDR" }, { name: "SITUS" }];
    expect(detectField(fields, "addr")).toBe("SITUS");
    // …and still answers for a service that only publishes a plain address column.
    expect(detectField([{ name: "OBJECTID" }, { name: "ADDRESS" }], "addr")).toBe("ADDRESS");
    // A service with nothing but a mailing column has no address field to search.
    expect(detectField([{ name: "OBJECTID" }, { name: "MAIL_ADDR" }], "addr")).toBeNull();
    // The id side is untouched.
    expect(detectField([{ name: "prop_id" }, { name: "SITUS" }], "id")).toBe("prop_id");
  });
});
