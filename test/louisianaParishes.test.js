/* NEW-1 (Louisiana parishes, 2026-09-30) — every wired `la_*` row, against the REAL committed county
 * geometry, plus the shared parcel-card resolvers the parish schemas forced a change in.
 *
 * WHY THE ROUTING HALF IS NOT REDUNDANT WITH counties.test.js. LOUISIANA HAS PARISHES, NOT COUNTIES,
 * and that is load-bearing: the nationwide geometry asset names these rows "Orleans Parish", the
 * routing keys drop the designation (`la_orleans`), and until B1574257 `countyKeyForName` stripped only
 * "County" — so a wired parish could be UNREACHABLE BY NAME, silently, with the parish's own service
 * configured and working (East Baton Rouge was exactly that for a year). Multi-word names squish with
 * no underscore (`la_stjohnthebaptist`). So every wired key is
 * driven through the same name → key → point path production uses, not just checked for shape.
 *
 * Isolated in its own file because it WARMS the county-polygons singleton (counties.test.js's own
 * "reports pending before the geometry is resident" test needs it cold; vitest gives each file its
 * own module registry). */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyIdentity, countyKeyForName, sharedLayerUrlConflicts,
} from "../src/workspaces/site-planner/lib/counties.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { buildIndex, pointInRing } from "../src/workspaces/site-planner/lib/countyPolygonsCore.js";
import { situsKey, situsAddress, ownerKey, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";

const LA_KEYS = Object.keys(COUNTIES).filter((k) => k.startsWith("la_"));
// Louisiana's bounding box, with a little slack for the coastal marsh and the Sabine/Pearl borders.
const LA_BOUNDS = { latMin: 28.85, latMax: 33.05, lonMin: -94.05, lonMax: -88.75 };

let payload, index;
beforeAll(async () => {
  payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
  await setCountyPolygons(payload);
  index = buildIndex(payload);
});

const nameOf = (key) => COUNTIES[key].label.replace(/ Parish, LA$/, "");

describe("every wired Louisiana row is a PARISH row (NEW-1)", () => {
  it("has the rows this batch wired — a deleted row must fail here, not vanish", () => {
    expect(LA_KEYS.length).toBeGreaterThanOrEqual(26);
    for (const k of ["la_eastbatonrouge", "la_orleans", "la_ascension", "la_stjohnthebaptist", "la_sttammany", "la_tangipahoa", "la_livingston"])
      expect(LA_KEYS).toContain(k);
  });

  it.each(LA_KEYS)("%s — key drops the designation, label keeps it", (key) => {
    expect(key).toMatch(/^la_[a-z]+$/);            // no underscore inside a multi-word name
    expect(key.endsWith("parish")).toBe(false);    // `la_calcasieu`, never `la_calcasieuparish`
    expect(COUNTIES[key].state).toBe("LA");
    expect(COUNTIES[key].label).toMatch(/^[A-Za-z. ]+ Parish, LA$/);
  });

  it.each(LA_KEYS)("%s — map bbox and centre sit inside Louisiana", (key) => {
    const m = COUNTIES_MAP[key];
    expect(m).toBeTruthy();
    expect(m.state).toBe("LA");
    const [latMin, lonMin, latMax, lonMax] = m.bbox;
    expect(latMin).toBeGreaterThanOrEqual(LA_BOUNDS.latMin);
    expect(latMax).toBeLessThanOrEqual(LA_BOUNDS.latMax);
    expect(lonMin).toBeGreaterThanOrEqual(LA_BOUNDS.lonMin);
    expect(lonMax).toBeLessThanOrEqual(LA_BOUNDS.lonMax);
    expect(latMin).toBeLessThan(latMax);
    expect(lonMin).toBeLessThan(lonMax);
    expect(m.center[0]).toBeGreaterThan(latMin);
    expect(m.center[0]).toBeLessThan(latMax);
    expect(m.center[1]).toBeGreaterThan(lonMin);
    expect(m.center[1]).toBeLessThan(lonMax);
  });

  it.each(LA_KEYS)("%s — the parish NAME resolves back to the key", (key) => {
    const name = nameOf(key);
    expect(countyKeyForName(`${name} Parish`, "LA")).toBe(key);
    expect(countyKeyForName(name, "LA")).toBe(key);
    // A Louisiana key never answers an unqualified (Texas-only) lookup by accident.
    expect(countyKeyForName(`${name} Parish`)).not.toBe(key);
  });

  it("the geometry asset's OWN name for each parish routes to exactly its key", () => {
    // Drives the real asset strings ("St. Tammany Parish", "De Soto Parish"…), not our labels.
    const hitBy = {};
    for (const c of index.counties.filter((r) => r.state === "LA")) {
      const key = countyKeyForName(c.name, "LA");
      if (key && LA_KEYS.includes(key)) (hitBy[key] = hitBy[key] || []).push(c.name);
    }
    for (const k of LA_KEYS) expect(hitBy[k], `${k} unreachable by the asset's own parish name`).toHaveLength(1);
  });

  it("shares no service URL between two rows unless a scopeWhere separates them", () => {
    expect(sharedLayerUrlConflicts()).toEqual([]);
  });

  it.each(LA_KEYS)("%s — carries an id hint, a help line and a verification record", (key) => {
    const c = COUNTIES[key];
    expect(c.idField).toBeTruthy();
    expect(c.help).toMatch(/Parish/);
    expect(c.layerUrl).toMatch(/^https:\/\//);
    const v = COUNTY_VERIFICATION[key];
    expect(v && (v.verifiedOn || v.verifiedNote), `${key} has no provenance row`).toBeTruthy();
  });
});

/* A point INSIDE each parish must resolve to that parish's source — not a neighbour's, and not "no
 * parcel data wired here yet". The point is found by scanning the parish's own polygon, so it is a
 * property of the shipped geometry, never of a hand-typed coordinate. */
describe("a point inside each wired parish resolves to THAT parish's source (NEW-1)", () => {
  function interiorPoints(rec, n = 3) {
    const [x0, y0, x1, y1] = rec.bbox;
    const G = 24, ins = [];
    for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
      const x = x0 + ((x1 - x0) * i) / G, y = y0 + ((y1 - y0) * j) / G;
      if (rec.rings.some((r) => pointInRing(r, x, y))) ins.push([x, y]);
    }
    const out = [ins[Math.floor(ins.length / 2)]];
    while (out.length < n && out.length < ins.length) {
      let best = null, bd = -1;
      for (const p of ins) {
        const d = Math.min(...out.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
        if (d > bd) { bd = d; best = p; }
      }
      out.push(best);
    }
    return out.map(([x, y]) => [y / index.scale, x / index.scale]);
  }

  it.each(LA_KEYS)("%s", (key) => {
    const rec = index.counties.find((r) => r.state === "LA" && countyKeyForName(r.name, "LA") === key);
    expect(rec).toBeTruthy();
    for (const [lat, lng] of interiorPoints(rec)) {
      const id = countyIdentity(lat, lng);
      expect(id.status, `${key} @ ${lat},${lng}`).toBe("ok");
      expect(id.key).toBe(key);
      expect(id.state).toBe("LA");
    }
  });

  it("a parish with nothing wired says so by name instead of borrowing a neighbour", () => {
    // Pointe Coupee (New Roads) is on the 2026-09-30 NOT-FOUND list — no source was reachable by any
    // route (docs/STATEWIDE-PARCELS.md "Louisiana parishes"). When one is wired, move this to another
    // parish still on that list; the rule (name it, never borrow a neighbour) is what is guarded.
    const id = countyIdentity(30.6996, -91.4368);
    expect(id.status).toBe("no-source");
    expect(id.name).toBe("Pointe Coupee Parish");
    expect(id.key).toBeNull();
  });
});

/* The parcel card resolves owner and situs from raw attributes through ONE shared ladder, and four
 * parish schemas broke it in four different ways. Every row below is a REAL attribute bag recorded
 * from the live service on 2026-09-30 (values trimmed), so each case is the shape production returns. */
describe("parcel-card resolvers on the real Louisiana schemas (NEW-1)", () => {
  it("Cameron — `ADDRESS_SO` reads 'county' (the source flag) and precedes the real ADDRESS: never the situs", () => {
    const a = { GEOID: "22023", OWNER: "DIXIE RICE AGRICULTURAL LLC", ADDRESS_SO: "county", MAIL_ADDRE: "PO BOX 12", ADDRESS: "415 VETERANS MEMORIAL DR", SADDNO: "415" };
    expect(situsKey(a)).toBe("ADDRESS");
    expect(situsAddress(a)).toBe("415 VETERANS MEMORIAL DR");
    // With no real address at all the answer is NULL — never the flag.
    expect(situsAddress({ OWNER: "X", ADDRESS_SO: "county" })).toBeNull();
  });

  it("Natchitoches — the `M_ADDRESSN`/`M_STREETNM` columns are the owner's MAILING address, not situs", () => {
    const a = { PARCEL_ID: "0100008550", OWNER: "BROSSETTE ALVIN D. REVOCABLE", MAIL_ADDRE: "3401 MARCO RD.", M_ADDRESSN: "3401", M_STREETNM: "MARCO", M_ZIPCODE: "71457", SITUS: "" };
    expect(situsAddress(a)).toBeNull();
    expect(situsAddress({ ...a, SITUS: "327 SHAMROCK LOOP" })).toBe("327 SHAMROCK LOOP");
  });

  it("Lafayette/Vermilion (Regrid schema) — a serialised-JSON `original_address` is never a street address", () => {
    const vermilion = { owner: "BROUSSARD LAND COMPANY", address: null, original_address: '{"scity":"Parish"}', ll_address_count: "1", address_source: "county" };
    expect(situsAddress(vermilion)).toBeNull();
    expect(situsAddress({ ...vermilion, address: "100 BLK N DEARBORNE" })).toBe("100 BLK N DEARBORNE");
  });

  it("Livingston — '~' is the source's own null, and the whole line `Par_Address` beats the bare house number", () => {
    const a = { ParcelNumber: "0011338", Address_Number: "9913", Par_Address: "9913 CROWS LN", Owner_Name: "HENSON, WAYMON A & PEGGY M", Owner_Address: "991 X RD" };
    expect(situsAddress(a)).toBe("9913 CROWS LN");
    expect(situsAddress({ Address_Number: "~", Par_Address: "~" })).toBeNull();
  });

  it("the parish rolls' own 'no address' sentinels are placeholders, never a card title", () => {
    expect(situsAddress({ Address: "NONE AVAILABLE" })).toBeNull();        // Tangipahoa
    expect(situsAddress({ Physical_A: "0 NO ADDRESS" })).toBeNull();       // St. Tammany
    expect(situsAddress({ Physical_A: "Not Available" })).toBeNull();      // St. James
    expect(situsAddress({ Physical_A: "1859 VIOLA ST" })).toBe("1859 VIOLA ST");
  });

  it("St. James — the truncated `Physical_A` is the situs and `TAXPAYER` is the owner", () => {
    const a = { PIN: "0100102200", TAXPAYER: "MCCARROLL, LAURA FREDERIC", Owner_Addr: "554 N. AIRLINE AVE.", Owner_City: "GRAMERCY, LA, 70052", Physical_A: "554  AIRLINE AVENUE  GRAMERCY 70052" };
    expect(situsAddress(a)).toBe("554 AIRLINE AVENUE GRAMERCY 70052");
    expect(ownerKey(a)).toBe("TAXPAYER");
    expect(ownerName(a)).toBe("MCCARROLL, LAURA FREDERIC");
  });

  it("a bare house NUMBER on the generic rung is half of a split address, not a situs (Lafourche, St. Mary, St. John…)", () => {
    expect(situsAddress({ parcelnumb: "0010062300", owner_name: "ROUSE LAND COMPANY", address_nu: "1653", street_nam: "" })).toBeNull();
    expect(situsAddress({ PIN: "1634924015.00", ADDRESS_NU: "240", STREET_NAM: "KILGORE PLANTATION RD" })).toBeNull();
    // A whole line that merely STARTS with a number is untouched, and so is a number on the situs-named rung.
    expect(situsAddress({ Address: "245 PIONEER DR" })).toBe("245 PIONEER DR");
    expect(situsAddress({ SITUS_NUM: "1620" })).toBe("1620");
  });

  it("owner spellings only Louisiana uses: OWNERNAME_ (Ascension), OWNERS (Acadia), Taxpayer (Assumption)", () => {
    expect(ownerKey({ PARCEL_NO: 1, OWNERNAME_: "JOHNSON, TRAVIS RANDALL", OWNERMAILI: "P.O BOX 51" })).toBe("OWNERNAME_");
    expect(ownerKey({ PARCEL_NO: "0500066800A", OWNERS: "MELANIE E LEGROS FAMILY TRUST" })).toBe("OWNERS");
    expect(ownerKey({ PIN: "900051434", Taxpayer: "LANDRY, JACOB A. & LYNDSI G" })).toBe("Taxpayer");
  });

  it("the fallback is STRICTLY a fallback — a layer with a real Owner column resolves exactly as before", () => {
    expect(ownerKey({ TAXPAYER: "THE FIRST", Owner_Name: "THE SECOND" })).toBe("Owner_Name");
    expect(ownerKey({ owner: "A", OWNERS: "B" })).toBe("owner");
    // No owner column and no fallback spelling → still null, not a guess.
    expect(ownerKey({ PIN: "1", CALC_ACRE: 4 })).toBeNull();
  });

  it("Lafayette (LED copy) — `Name` is the PARCEL NUMBER there; the wired ES2 layer has a real `owner`", () => {
    // Documents why the LED layer was rejected: the shared resolver WOULD show a parcel number as the owner.
    expect(ownerKey({ Name: "6158073", Ownership: "Trs B-1, B-3 & C" })).toBe("Name");
    expect(ownerKey({ parcelnumb: "6158073", owner: "THIBODEAUX STEVEN M / THIBODEAUX", address: "500 BLK CHAMBERLAIN" })).toBe("owner");
    expect(COUNTIES.la_lafayette.layerUrl).not.toMatch(/2023_Parcels_Lafayette_Parish/);
  });
});

describe("pinned id/address columns (NEW-1)", () => {
  it("a pinned column is never one that detectField would have chosen wrongly — the pins are declared", () => {
    // detectField picks the parish FIPS `geoid` for Lafayette, the row id FID for St. Charles and
    // OBJECTID for East Feliciana/Tangipahoa: each of those rows must pin its real id column.
    expect(COUNTIES.la_lafayette).toMatchObject({ idField: "parcelnumb", pinIdField: true, scopeWhere: "geoid='22055'" });
    expect(COUNTIES.la_stcharles).toMatchObject({ idField: "PI_CODE", pinIdField: true });
    expect(COUNTIES.la_eastfeliciana).toMatchObject({ idField: "PIN_Number", pinIdField: true });
    expect(COUNTIES.la_tangipahoa).toMatchObject({ idField: "Assessment", pinIdField: true });
    expect(COUNTIES.la_cameron).toMatchObject({ idField: "PARCELNUMB", pinIdField: true });
  });

  it("only the shared service is scoped, and its scope names the parish's own FIPS code", () => {
    const scoped = LA_KEYS.filter((k) => COUNTIES[k].scopeWhere);
    expect(scoped).toEqual(["la_lafayette"]);
    expect(COUNTIES.la_lafayette.scopeWhere).toBe("geoid='22055'"); // Lafayette Parish FIPS 22055
  });
});
