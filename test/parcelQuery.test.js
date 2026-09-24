import { describe, it, expect, vi, afterEach } from "vitest";
import { buildParcelWhere, okField, isDefaultLookupUrl, resolveSearchField, lookupParcels, idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const COUNTIES_HARRIS_URL = COUNTIES.harris.layerUrl;

// buildParcelWhere is the ONE place a parcel-search where-clause is built, so the
// primary CAD query and the statewide-backup (TxGIO) query construct it identically —
// same numeric/LIKE choice, same county scoping, same injection guard (B47/B244/B245).
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

/* resolveSearchField — detection wins by default; a pin (Jackson/Bibb's idField, Rockdale's
 * addrField) wins ONLY while the hinted column still exists on the layer, else it degrades back
 * to detection rather than failing the search (B1873776). */
describe("resolveSearchField — pin wins only while the hinted column exists (B1873776)", () => {
  const PIN_AHEAD_OF_FULL_ID = [
    { name: "PIN", type: "esriFieldTypeString" },     // detectField's ID_RE would match this first
    { name: "PARCEL_NO", type: "esriFieldTypeString" },
  ];

  it("with no pin, detection wins even when a hint names a different real column", () => {
    expect(resolveSearchField(PIN_AHEAD_OF_FULL_ID, "id", "PARCEL_NO", false)).toBe("PIN");
  });

  it("with a pin, the hinted column wins over whatever detection would have picked", () => {
    expect(resolveSearchField(PIN_AHEAD_OF_FULL_ID, "id", "PARCEL_NO", true)).toBe("PARCEL_NO");
  });

  it("a pin degrades to detection when the hinted column doesn't exist on this layer", () => {
    const fields = [{ name: "PIN", type: "esriFieldTypeString" }]; // no PARCEL_NO here
    expect(resolveSearchField(fields, "id", "PARCEL_NO", true)).toBe("PIN");
  });

  it("with no detectable field and no pin, falls back to the plain hint", () => {
    const fields = [{ name: "SOME_OTHER_COL", type: "esriFieldTypeString" }];
    expect(resolveSearchField(fields, "id", "PARCEL_NO", false)).toBe("PARCEL_NO");
  });

  it("an address pin behaves the same way (Rockdale's Address vs BOA_Addres)", () => {
    const fields = [
      { name: "Address", type: "esriFieldTypeString" },
      { name: "BOA_Addres", type: "esriFieldTypeString" },
    ];
    // detectField's situs ladder may or may not prefer "Address" — the point is the PIN wins outright.
    expect(resolveSearchField(fields, "address", "BOA_Addres", true)).toBe("BOA_Addres");
  });
});

describe("only Jackson/Bibb pin an id field, and only Rockdale pins an address field (B1873776)", () => {
  it("ga_jackson and ga_bibb pin idField; ga_rockdale does not", () => {
    expect(COUNTIES.ga_jackson.pinIdField).toBe(true);
    expect(COUNTIES.ga_bibb.pinIdField).toBe(true);
    expect(COUNTIES.ga_rockdale.pinIdField).toBeFalsy();
  });

  it("ga_rockdale pins addrField to BOA_Addres; ga_jackson/ga_bibb do not pin an address", () => {
    expect(COUNTIES.ga_rockdale.pinAddrField).toBe(true);
    expect(COUNTIES.ga_rockdale.addrField).toBe("BOA_Addres");
    expect(COUNTIES.ga_jackson.pinAddrField).toBeFalsy();
    expect(COUNTIES.ga_bibb.pinAddrField).toBeFalsy();
  });
});

/* End-to-end lookupParcels through a mocked ArcGIS server, proving the pin actually reaches the
 * query — not just that resolveSearchField is correct in isolation. */
describe("lookupParcels — end to end through the pin (B1873776)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  it("Jackson: an id search runs against the pinned PARCEL_NO, not the layer's PIN column", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/query")) return ok({ features: [{ geometry: { rings: [] }, attributes: { PARCEL_NO: "08 123A" } }] });
      // metadata probe (getLayerInfo)
      return ok({ name: "Tax_Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [
        { name: "PIN", alias: "PIN", type: "esriFieldTypeString" },
        { name: "PARCEL_NO", alias: "Parcel Number", type: "esriFieldTypeString" },
      ] });
    }));
    const r = await lookupParcels({ county: "ga_jackson", lookupUrl: COUNTIES.ga_jackson.layerUrl, mode: "id", value: "08 123A" });
    expect(r.idField).toBe("PARCEL_NO");
    expect(r.feats).toHaveLength(1);
    const queryCall = calls.find((u) => u.includes("/query"));
    expect(queryCall).toBeTruthy();
    expect(decodeURIComponent(queryCall)).toContain("PARCEL_NO");
    expect(decodeURIComponent(queryCall)).not.toMatch(/where=UPPER\(PIN\)/);
  });

  it("Rockdale: an address search runs against BOA_Addres, not the house-number-only Address column", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/query")) return ok({ features: [{ geometry: { rings: [] }, attributes: { BOA_Addres: "1620 WALNUT ST SE" } }] });
      return ok({ name: "Rockdale_County_Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [
        { name: "PARCEL_NO", alias: "Parcel Number", type: "esriFieldTypeString" },
        { name: "Address", alias: "Address", type: "esriFieldTypeString" },
        { name: "BOA_Addres", alias: "BOA Address", type: "esriFieldTypeString" },
      ] });
    }));
    const r = await lookupParcels({ county: "ga_rockdale", lookupUrl: COUNTIES.ga_rockdale.layerUrl, mode: "address", value: "WALNUT" });
    expect(r.addrField).toBe("BOA_Addres");
    expect(r.feats).toHaveLength(1);
    const queryCall = calls.find((u) => u.includes("/query"));
    expect(decodeURIComponent(queryCall)).toContain("BOA_Addres");
  });
});

/* ⛔ B1875248 — `idAttrFor` is the DISPLAYED "Account / ID" value (the map-search card, the plan
 * hand-off's `acct`), and it must resolve the SAME column an ID search would run on. Before this
 * fix, MapFinder.jsx kept its own separate id-shaped-column regex (which additionally matched a
 * bare "objectid") purely to compute this value — so on the affected GA counties the card showed
 * the WinGAP layer's own row number while a search on the same county already queried the right
 * column. These are the exact attribute bags measured in the live repro. */
describe("idAttrFor — the parcel card's Account/ID resolves the pinned column, not the layer's row id (B1875248)", () => {
  it("Effingham: reads PARCEL_NO, not the OBJECTID_1 row number (was showing '0')", () => {
    const attrs = { FID: 412, OBJECTID_1: 0, PARCEL_NO: "S1010010", PIN: "0101 001", WPIN: "W0101" };
    expect(idAttrFor("ga_effingham", attrs)).toBe("S1010010");
  });

  it("Barrow: reads Parcel_no, not FID (was showing '-1')", () => {
    const attrs = { FID: -1, Parcel_no: "WN12   217" };
    expect(idAttrFor("ga_barrow", attrs)).toBe("WN12   217");
  });

  it("Hall: reads PIN, not OBJECTID (was showing the raw OBJECTID '64810')", () => {
    const attrs = { OBJECTID: 64810, PIN: "08021 001131", ADDR_ID: 552 };
    expect(idAttrFor("ga_hall", attrs)).toBe("08021 001131");
  });

  it("degrades to the pinned field's absence gracefully when the layer genuinely lacks it (self-healing, same as resolveSearchField)", () => {
    // No PARCEL_NO on this bag at all — falls back to whatever else looks id-shaped.
    const attrs = { FID: 3, PIN: "006A" };
    expect(idAttrFor("ga_effingham", attrs)).toBe("006A");
  });

  it("returns null (never a placeholder string) when the resolved field's value is a placeholder", () => {
    const attrs = { PARCEL_NO: "Null" };
    expect(idAttrFor("ga_effingham", attrs)).toBeNull();
  });

  it("returns null for a county with no idField and nothing else id-shaped in the bag", () => {
    expect(idAttrFor("ga_baldwin", { Shape_Area: 4200 })).toBeNull();
  });

  it("returns null for null/undefined attrs without throwing", () => {
    expect(idAttrFor("ga_effingham", null)).toBeNull();
    expect(idAttrFor("ga_effingham", undefined)).toBeNull();
  });
});
