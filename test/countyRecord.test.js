/* The county record on the parcel page (B2191xxx / NEW-2): owner, account, address and deed acres are read
 * from the county's own attribute bag through the shared appraisal resolvers — never from the copies stamped
 * on the parcel at identify time (on HCAD's schema those were the internal OBJECTID and the bare street name).
 *
 * Two layers: (1) the owner's real SCHIEL row (Harris, 2026-10-08), the exact case that read
 * "Owner —, Account 634440, Address SCHIEL, Deed acres —"; (2) one REAL row from every wired county service
 * (test/fixtures/countyRecordRows.json, harvested by ui-audit/harvest-county-record-rows.mjs), asserted
 * against an oracle that does not use the resolvers: if the county's DECLARED id / address column (or any
 * plainly owner-named column) carries a real value, the record must show one. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { countyRecord, streetFromParts, isPlaceholderValue } from "../src/workspaces/site-planner/lib/appraisal.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const schiel = JSON.parse(fs.readFileSync(new URL("./fixtures/silvestriParcels.json", import.meta.url))).schielAttrs;
const harvest = JSON.parse(fs.readFileSync(new URL("./fixtures/countyRecordRows.json", import.meta.url)));

describe("county record — the owner's SCHIEL lot (Harris)", () => {
  const rec = countyRecord(schiel, { acct: "634440", addr: "SCHIEL", idField: "HCAD_NUM", addrField: "LocAddr" });
  it("owner is the first listed owner, not a dash", () => expect(rec.owner).toBe("BAUER HOCKLEY 550 LP"));
  it("account is the HCAD account, not the OBJECTID the identify stamped", () => expect(rec.account).toBe("0421030000123"));
  it("address is the street with its suffix, built from the decomposed columns", () => expect(rec.address).toBe("SCHIEL RD"));
  it("deed acres come from the county's acreage column", () => expect(rec.deedAcres).toBeCloseTo(63.8457, 4));
  it("tax year rides along", () => expect(rec.taxYear).toBe("2025"));
  it("a record with no attribute bag falls back to what the parcel carries, and says nothing else", () => {
    expect(countyRecord(null, { acct: "A1", addr: "1 MAIN ST" })).toEqual({ owner: null, account: "A1", address: "1 MAIN ST", deedAcres: null, taxYear: null });
  });
  it("placeholder text is absent, never a value", () => {
    expect(countyRecord({ OWNERNAME: "Null", ACCOUNT: "None" }).owner).toBeNull();
    expect(countyRecord({ OWNERNAME: "Null", ACCOUNT: "None" }).account).toBeNull();
  });
});

describe("streetFromParts", () => {
  it("drops a zero house number and joins prefix / name / suffix", () => {
    expect(streetFromParts({ site_str_num: 0, site_str_pfx: "N", site_str_name: "GRAND", site_str_sfx: "PKY" })).toBe("N GRAND PKY");
    expect(streetFromParts({ site_str_num: 1200, site_str_name: "GRAND", site_str_sfx: "PKY" })).toBe("1200 GRAND PKY");
  });
  it("is null without a street name", () => expect(streetFromParts({ site_str_num: 12 })).toBeNull());
});

describe("county record — one real row from every wired county service", () => {
  const rows = Object.entries(harvest.rows);
  it("covers a real breadth of counties (a harvest that quietly shrank is a vacuous test)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(rows.some(([k]) => k === "harris")).toBe(true); // the known-good arm
  });
  it("the unreachable hosts are named in the fixture, not silently missing", () => {
    expect(typeof harvest.unreachable).toBe("object");
    for (const k of Object.keys(harvest.unreachable)) expect(harvest.rows[k]).toBeUndefined();
  });
  const real = (v) => !isPlaceholderValue(v) && String(v).trim() !== "0";
  const find = (a, name) => (name ? Object.keys(a).find((k) => k.toLowerCase() === String(name).toLowerCase() && real(a[k])) : null);
  for (const [key, r] of rows) {
    it(`${key}: shows the account / address / owner its row carries`, () => {
      const cfg = COUNTIES[key] || {};
      const rec = countyRecord(r.attrs, { idField: cfg.idField, addrField: cfg.addrField });
      if (find(r.attrs, cfg.idField)) expect(rec.account, `${key} id column ${cfg.idField}`).toBeTruthy();
      if (find(r.attrs, cfg.addrField)) expect(rec.address, `${key} address column ${cfg.addrField}`).toBeTruthy();
      const ownerCol = Object.keys(r.attrs).find((x) => /^(owner|own_?name|owner_?name\w*|name|taxpayer)$/i.test(x.replace(/^.*\./, "")) && real(r.attrs[x]));
      if (ownerCol) expect(rec.owner, `${key} owner column ${ownerCol}`).toBeTruthy();
    });
  }
});
