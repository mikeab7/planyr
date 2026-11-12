/* NEW-1..4 (2026-11, the weekly parcels sweep) — ONE declared per-county situs composer (`addrParts`) read by BOTH the parcel card
 * (`countyRecord` → `composeSitus`) and the typed search (`buildParcelWhere` → `addressWhereFromParts`), plus the registry health check.
 * Fixture: test/fixtures/splitSitusRecords.json (Harris / Bartow / Rutherford are verbatim live answers; the two Chambers bags are
 * RECONSTRUCTED from the sweep's measurement — see the fixture's `note`). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { buildParcelWhere, resolveSearchField, idAttrFor, situsFor, addressWhereFromParts } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { countyRecord, composeSitus, apprRows, acreageKey, situsAddress } from "../src/workspaces/site-planner/lib/appraisal.js";
import { declaredColumns, missingDeclaredColumns, findColumn, ADDR_PART_ROLES } from "../src/workspaces/site-planner/lib/addrParts.js";

const FX = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/splitSitusRecords.json", import.meta.url)), "utf8"));
const TN = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/tnNonStateParcels.json", import.meta.url)), "utf8"));

const fieldsOf = (types) => Object.entries(types).map(([name, type]) => ({ name, type }));
const HARRIS_META = { fields: fieldsOf(FX.harris.fieldTypes) };
const CH_META = { fields: FX.chambersFields };

describe("NEW-1 — Harris: HCAD dropped LocAddr; situs is split, the id is HCAD_NUM", () => {
  const c = COUNTIES.harris;
  const where = (value) => buildParcelWhere({ meta: HARRIS_META, mode: "address", value, idField: c.idField, addrField: resolveSearchField(HARRIS_META.fields, "address", c.addrField, false), addrParts: c.addrParts });

  it("the live layer has no LocAddr, and the registry no longer names it anywhere", () => {
    expect(HARRIS_META.fields.some((f) => f.name === "LocAddr")).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/LocAddr/);
  });

  it('"12801 American Petroleum" → number = AND street LIKE (red on main: UPPER(LocAddr) LIKE …)', () => {
    const w = where("12801 American Petroleum");
    expect(w).toBe("site_str_num = 12801 AND UPPER(site_str_name) LIKE UPPER('%AMERICAN PETROLEUM%')");
    expect(w).not.toMatch(/LocAddr/);
  });

  it("a typed street TYPE is dropped when the type has its own column (it is not in the name column)", () => {
    expect(where("12801 American Petroleum Rd")).toBe("site_str_num = 12801 AND UPPER(site_str_name) LIKE UPPER('%AMERICAN PETROLEUM%')");
  });

  it('a bare street ("Schiel Rd") searches the name only; a bare number searches the number only', () => {
    expect(where("Schiel Rd")).toBe("UPPER(site_str_name) LIKE UPPER('%SCHIEL%')");
    expect(where("12801")).toBe("site_str_num = 12801");
  });

  it("a leading directional is dropped (it lives in site_str_pfx), an apostrophe is escaped", () => {
    expect(where("100 N Main")).toBe("site_str_num = 100 AND UPPER(site_str_name) LIKE UPPER('%MAIN%')");
    expect(where("5 O'Brien")).toBe("site_str_num = 5 AND UPPER(site_str_name) LIKE UPPER('%O''BRIEN%')");
  });

  it("the ID search runs on HCAD_NUM, never LOWPARCELID (77,003 stacked rows differ)", () => {
    expect(c.pinIdField).toBe(true);
    expect(resolveSearchField(HARRIS_META.fields, "id", c.idField, !!c.pinIdField)).toBe("HCAD_NUM");
    // …and without the pin, detection DOES land on the wrong column — the reason for the pin:
    expect(resolveSearchField(HARRIS_META.fields, "id", c.idField, false)).toBe("LOWPARCELID");
  });

  it("the card is unchanged: the composed line is the same street the old stitcher produced, and the account is HCAD_NUM", () => {
    const bag = FX.harrisChevron;
    const rec = countyRecord(bag, { idField: c.idField, addrField: c.addrField, addrParts: c.addrParts });
    expect(rec.address).toBe("12801 AMERICAN PETROLEUM RD");
    expect(idAttrFor("harris", bag)).toBe("0402460000044");
  });
});

describe("NEW-2 — Rutherford TN: FormattedLocation is the situs line", () => {
  const bag = FX.rutherfordStag;
  it("the record the weekly sweep measured (STREETADDRESS null) now reads its address (red on main)", () => {
    expect(bag.STREETADDRESS).toBeNull();
    expect(countyRecord(bag, { idField: "ParcelID", addrField: COUNTIES.tn_rutherford.addrField }).address).toBe("1975 JOE B JACKSON PKWY");
    expect(situsAddress(bag)).toBe("1975 JOE B JACKSON PKWY");
  });
  it("the existing non-state-counties fixture record carries the same shape and now reads its address", () => {
    const rec = JSON.stringify(TN);
    expect(rec).toContain("5595 EPPS MILL RD");
    const find = (o) => { if (o && typeof o === "object") { if (o.FormattedLocation === "5595 EPPS MILL RD") return o; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } } return null; };
    const epps = find(TN);
    expect(epps.STREETADDRESS).toBeNull();
    expect(countyRecord(epps, { addrField: "FormattedLocation" }).address).toBe("5595 EPPS MILL RD");
  });
  it("the search runs on FormattedLocation, not the 48-row column", () => {
    const meta = { fields: [{ name: "FormattedLocation", type: "esriFieldTypeString" }, { name: "STREETADDRESS", type: "esriFieldTypeString" }] };
    const c = COUNTIES.tn_rutherford;
    const addrField = resolveSearchField(meta.fields, "address", c.addrField, !!c.pinAddrField);
    expect(buildParcelWhere({ meta, mode: "address", value: "1975 Joe B Jackson", addrField, addrParts: c.addrParts })).toBe("UPPER(FormattedLocation) LIKE UPPER('%1975 Joe B Jackson%')");
  });
  it("LocationCity / LocationZip are never mistaken for the situs line", () => {
    expect(situsAddress({ LocationCity: "MURFREESBORO", LocationZip: "37127" })).toBeNull();
  });
});

describe("NEW-3 — Bartow GA: the card has an address, acres, and honest labels", () => {
  const c = COUNTIES.ga_bartow;
  it("Gerdau (0080-0202-001): address '384 OLD GRASSDALE RD', 267.91 acres", () => {
    const rec = countyRecord(FX.bartowGerdau, { idField: c.idField, addrField: c.addrField, addrParts: c.addrParts });
    expect(rec.address).toBe("384 OLD GRASSDALE RD");
    expect(rec.deedAcres).toBeCloseTo(267.91, 2);
    expect(rec.owner).toBe("GERDAU AMERISTEEL US INC");
    expect(acreageKey(FX.bartowGerdau)).toBe("TOTALACRES");
  });
  it("AL7 (0041-0198-013): the county's own 25-character cut is passed through, not invented", () => {
    const rec = countyRecord(FX.bartowAl7, { addrParts: c.addrParts });
    expect(rec.address).toBe("1030 ADAIRSVILLE PLEASANT VALL");
    expect(rec.deedAcres).toBe(10);
  });
  it("a house number of 0 is omitted ('0' is a filler)", () => {
    expect(composeSitus({ ...FX.bartowGerdau, HOUSE_NO: 0 }, c.addrParts)).toBe("OLD GRASSDALE RD");
  });
  it("Subdivision_Name is titled for what it is; the tax district is named; a year built of 0 is not shown", () => {
    const rows = Object.fromEntries(apprRows(FX.bartowGerdau).map((r) => [r.label, String(r.value).trim()]));
    expect(rows["Subdivision / neighbourhood"]).toBe("COM - CASS WHITE CORRIDOR");
    expect(rows["Tax district"]).toBe("Bartow County");
    expect(rows["Legal"]).toBeUndefined();
    expect("Year built" in rows).toBe(false);
  });
  it("the county's other SUBDIVISION column (Rutherford, a real legal line) is not relabelled", () => {
    const rows = Object.fromEntries(apprRows(FX.rutherfordStag).map((r) => [r.label, String(r.value)]));
    expect(rows["Subdivision / neighbourhood"]).toBeUndefined();
  });
  it("search: '384 Old Grassdale' → HOUSE_NO = 384 AND street LIKE (the house number is an integer column)", () => {
    const meta = { fields: [{ name: "HOUSE_NO", type: "esriFieldTypeInteger" }, { name: "STREET_NAM", type: "esriFieldTypeString" }] };
    expect(buildParcelWhere({ meta, mode: "address", value: "384 Old Grassdale", addrField: "STREET_NAM", addrParts: c.addrParts }))
      .toBe("HOUSE_NO = 384 AND UPPER(STREET_NAM) LIKE UPPER('%OLD GRASSDALE%')");
    // no type / direction column is declared here, so the typed type stays in the LIKE
    expect(buildParcelWhere({ meta, mode: "address", value: "384 Old Grassdale Rd", addrField: "STREET_NAM", addrParts: c.addrParts }))
      .toBe("HOUSE_NO = 384 AND UPPER(STREET_NAM) LIKE UPPER('%OLD GRASSDALE RD%')");
  });
});

describe("NEW-4 — Chambers: number + suffix + city composed; a house-number search is a number AND a street", () => {
  const c = COUNTIES.chambers;
  it("Ameriport reads '3525 FM 565, BAYTOWN' (the street name alone was the old title)", () => {
    expect(situsAddress(FX.chambersAmeriport)).toBe("FM 565"); // the generic ladder's rung-2 match is the street NAME — the reason the composer goes first
    expect(countyRecord(FX.chambersAmeriport, { idField: c.idField, addrField: c.addrField, addrParts: c.addrParts }).address).toBe("3525 FM 565, BAYTOWN");
  });
  it("a suffix already baked into the street name is not appended twice", () => {
    expect(composeSitus(FX.chambersBakedSuffix, c.addrParts)).toBe("3525 FM 565 RD, BAYTOWN");
  });
  it("an industrial tract with no situs shows nothing — never '0'", () => {
    expect(composeSitus(FX.chambersNoSitus, c.addrParts)).toBeNull();
    expect(countyRecord(FX.chambersNoSitus, { addrParts: c.addrParts }).address).toBeNull();
  });
  it("a table-prefixed column is matched on its leaf name", () => {
    expect(findColumn(Object.keys(FX.chambersAmeriport), "Prop_Street_Number")).toBe("ChambersCADWeb.DBO.Accounts.Prop_Street_Number");
  });
  it("'3525 FM 565' → Prop_Street_Number = '3525' AND Prop_Street LIKE (the number column is a string here)", () => {
    expect(buildParcelWhere({ meta: CH_META, mode: "address", value: "3525 FM 565", idField: c.idField, addrField: c.addrField, addrParts: c.addrParts }))
      .toBe("Prop_Street_Number = '3525' AND UPPER(Prop_Street) LIKE UPPER('%FM 565%')");
  });
  it("the street LIKE is a contains-match, so a row with the type baked in ('FM 565 RD') is still found", () => {
    const w = buildParcelWhere({ meta: CH_META, mode: "address", value: "3525 FM 565 Rd", addrField: c.addrField, addrParts: c.addrParts });
    expect(w).toBe("Prop_Street_Number = '3525' AND UPPER(Prop_Street) LIKE UPPER('%FM 565%')");
  });
  it("the street-only and number-only forms", () => {
    expect(buildParcelWhere({ meta: CH_META, mode: "address", value: "FM 565", addrField: c.addrField, addrParts: c.addrParts })).toBe("UPPER(Prop_Street) LIKE UPPER('%FM 565%')");
    expect(buildParcelWhere({ meta: CH_META, mode: "address", value: "3525", addrField: c.addrField, addrParts: c.addrParts })).toBe("Prop_Street_Number = '3525'");
  });
  it("situsFor (the Add-parcel stamp and the address snap) composes for a split county and falls back to the ladder elsewhere", () => {
    expect(situsFor("chambers", FX.chambersAmeriport)).toBe("3525 FM 565, BAYTOWN");
    expect(situsFor("tn_rutherford", FX.rutherfordStag)).toBe("1975 JOE B JACKSON PKWY");
  });
  it("countiesProvenance no longer calls Chambers 'blocked / unverified'", async () => {
    const { COUNTY_PROVENANCE } = await import("../src/workspaces/site-planner/lib/countiesProvenance.js");
    const row = COUNTY_PROVENANCE ? COUNTY_PROVENANCE.chambers : null;
    if (row) { expect(row.verifiedOn).toBe("2026-11-01"); expect(row.verifiedNote).not.toMatch(/blocked by this build environment's egress policy — a sandbox/); }
  });
});

describe("the one where-builder — fallbacks and safety", () => {
  const parts = { num: "HOUSE_NO", name: "STREET_NAM" };
  const meta = { fields: [{ name: "HOUSE_NO", type: "esriFieldTypeInteger" }, { name: "STREET_NAM", type: "esriFieldTypeString" }] };
  it("a layer that no longer carries the declared NAME column falls back to the single address column", () => {
    const m = { fields: [{ name: "SITUS", type: "esriFieldTypeString" }] };
    expect(buildParcelWhere({ meta: m, mode: "address", value: "12 Main", addrField: "SITUS", addrParts: parts })).toBe("UPPER(SITUS) LIKE UPPER('%12 Main%')");
  });
  it("a layer missing only the NUMBER column searches by street alone", () => {
    const m = { fields: [{ name: "STREET_NAM", type: "esriFieldTypeString" }] };
    expect(buildParcelWhere({ meta: m, mode: "address", value: "12 Main", addrField: "STREET_NAM", addrParts: parts })).toBe("UPPER(STREET_NAM) LIKE UPPER('%MAIN%')");
  });
  it("a hostile column name in a declaration is never interpolated", () => {
    expect(addressWhereFromParts({ fields: [], parts: { name: "x) OR 1=1 --" }, value: "a" })).toBeNull();
  });
  it("no declaration → the single-column behaviour is byte-for-byte what it was", () => {
    expect(buildParcelWhere({ meta, mode: "address", value: "MAIN ST", addrField: "STREET_NAM" })).toBe("UPPER(STREET_NAM) LIKE UPPER('%MAIN ST%')");
  });
  it("the typed quote is escaped in the single-column path as before", () => {
    expect(buildParcelWhere({ meta, mode: "address", value: "O'Brien", addrField: "STREET_NAM" })).toBe("UPPER(STREET_NAM) LIKE UPPER('%O''Brien%')");
  });
});

describe("registry health — every declared column exists on the live layer", () => {
  it("declaredColumns lists the id column, the address column and every addrParts role", () => {
    const names = declaredColumns(COUNTIES.harris).map((d) => d.kind);
    expect(names).toEqual(expect.arrayContaining(["idField", "addrField", "addrParts.num", "addrParts.name", "addrParts.sfx"]));
  });
  it("Harris as recorded: nothing missing; with the OLD LocAddr hint it is caught (red on main)", () => {
    const live = fieldsOf(FX.harris.fieldTypes).map((f) => f.name);
    expect(missingDeclaredColumns(COUNTIES.harris, live)).toEqual([]);
    expect(missingDeclaredColumns({ ...COUNTIES.harris, addrField: "LocAddr", addrParts: undefined }, live)).toEqual([{ kind: "addrField", name: "LocAddr" }]);
  });
  it("Chambers (prefixed live names) and Bartow: nothing missing", () => {
    expect(missingDeclaredColumns(COUNTIES.chambers, Object.keys(FX.chambersAmeriport).concat(["ChambersCADWeb.DBO.Accounts.Parcel_Id", "Parcel_Id"]))).toEqual([]);
    expect(missingDeclaredColumns(COUNTIES.ga_bartow, Object.keys(FX.bartowGerdau))).toEqual([]);
  });
  it("a renamed column is named; an unreadable field list is not this check's business", () => {
    expect(missingDeclaredColumns(COUNTIES.ga_bartow, ["PARCELID", "HOUSE_NUMBER", "STREET_NAM"])).toEqual([{ kind: "addrParts.num", name: "HOUSE_NO" }]);
    expect(missingDeclaredColumns(COUNTIES.ga_bartow, [])).toEqual([]);
  });
  it("every county row that declares addrParts names a `name` role and only known roles", () => {
    for (const [k, v] of Object.entries(COUNTIES)) {
      if (!v || !v.addrParts) continue;
      expect(v.addrParts.name, k).toBeTruthy();
      for (const role of Object.keys(v.addrParts)) expect(ADDR_PART_ROLES, `${k}.${role}`).toContain(role);
    }
  });
});
