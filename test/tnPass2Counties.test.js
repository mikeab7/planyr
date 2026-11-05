/* NEW-1..NEW-3 (Tennessee pass 2, B2408834, 2026-10-22) — the second, harder search for a public parcel source in the Tennessee counties pass 1 left as gaps.
 *
 * RED-PROOF: on main before this work Williamson and Hickman resolved to `status: "no-source"` ("<County> — no parcel data wired here yet") and had no `tn_williamson` /
 * `tn_hickman` row, so a click anywhere in either county found nothing. Real recorded answers from both layers live in test/fixtures/tnPass2Parcels.json. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, countyIdentity, noParcelSourceNote, candidateCountiesForPoint, statewideExcludesCounty, displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { interiorPointOf } from "../src/workspaces/site-planner/lib/parcelIdSearch.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const REC = json("./fixtures/tnPass2Parcels.json");
beforeAll(async () => { await setCountyPolygons(json("../public/geo/county-polygons.json")); });

describe("Williamson County — the county's own ArcGIS Online org", () => {
  const cases = Object.entries(REC.williamson);
  it("five recorded lots across the county, each with an owner and a situs address", () => {
    expect(cases).toHaveLength(5);
    for (const [, [f]] of cases) {
      expect(f.attributes.COUNTY).toBe("094");
      expect(String(f.attributes.OWNER_1).trim()).not.toBe("");
      expect(String(f.attributes.ADDRESS).trim()).not.toBe("");
    }
  });
  it.each(cases.map(([n, [f]]) => [n, f]))("%s resolves to Williamson's own source, never the empty statewide composite", (_n, f) => {
    const p = interiorPointOf(f);
    const id = countyIdentity(p.lat, p.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("tn_williamson");
    expect(id.statewideKey).toBeUndefined();
    const c = candidateCountiesForPoint(p.lat, p.lng);
    expect(c).toContain("tn_williamson");
    expect(c, "the statewide layer holds zero Williamson rows").not.toContain("tn_statewide");
    expect(noParcelSourceNote(id)).toBeNull();
    expect(statewideExcludesCounty("tn_statewide", "Williamson County")).toBe(true);
  });
  it("the card reads the real attributes: the control-map id, the owner, the situs address", () => {
    const f = REC.williamson.franklinSquare[0];
    expect(idAttrFor("tn_williamson", f.attributes)).toBe("078    11000 00009078");
    const rec = countyRecord(f.attributes, { idField: "PARCEL_ID", addrField: "ADDRESS" });
    expect(rec.owner).toBe("CITY OF FRANKLIN");
    expect(rec.address).toBe("PUBLIC SQ");
  });
  it("is the county's own org layer (token-free AGOL, no relay), pinned to PARCEL_ID / ADDRESS, outline floor 16", () => {
    const c = COUNTIES.tn_williamson;
    expect(c.layerUrl).toBe("https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0");
    expect(c.idField).toBe("PARCEL_ID"); expect(c.pinIdField).toBe(true);
    expect(c.addrField).toBe("ADDRESS"); expect(c.pinAddrField).toBe(true);
    expect(displayMinZoomOf("tn_williamson")).toBe(16);
  });
  it("Brentwood, Franklin and Cool Springs points (the metro edge) route to Williamson too", () => {
    for (const [lat, lng] of [[36.0331, -86.7828], [35.9251, -86.8689], [35.99, -86.8]]) expect(countyIdentity(lat, lng).key, `${lat},${lng}`).toBe("tn_williamson");
  });
});

describe("Hickman County — the assessor's CaptureCAMA publish on the maps. host", () => {
  const f = REC.hickman[0];
  it("the recorded lot is the Hickman County courthouse square in Centerville", () => {
    expect(f.attributes.COUNTY_ID).toBe(41);
    expect(f.attributes.OWNER).toBe("HICKMAN COUNTY");
    expect(f.attributes.PROPADDR).toBe("PUBLIC SQUARE");
  });
  it("resolves to Hickman's own source, never the empty statewide composite", () => {
    const p = interiorPointOf(f);
    const id = countyIdentity(p.lat, p.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("tn_hickman");
    expect(candidateCountiesForPoint(p.lat, p.lng)).not.toContain("tn_statewide");
    expect(noParcelSourceNote(id)).toBeNull();
    expect(statewideExcludesCounty("tn_statewide", "Hickman County")).toBe(true);
  });
  it("the card reads the real attributes", () => {
    expect(idAttrFor("tn_hickman", f.attributes)).toBe("107L B 00100 00001107L");
    const rec = countyRecord(f.attributes, { idField: "PARCELID", addrField: "PROPADDR" });
    expect(rec.owner).toBe("HICKMAN COUNTY");
    expect(rec.address).toBe("PUBLIC SQUARE");
  });
  it("rides the relay to an allow-listed host, pinned to PARCELID / PROPADDR, floor 16 (a MapServer's own floor; zoom 14 holds 1,002 lots against the 1,000 cap)", () => {
    const c = COUNTIES.tn_hickman;
    expect(c.layerUrl).toBe("/gis-proxy/maps.capturecama.com/arcgis/rest/services/Hickman/HickmanTN05182023/MapServer/9");
    expect(ALLOWED_HOSTS.has("maps.capturecama.com")).toBe(true);
    expect(c.idField).toBe("PARCELID"); expect(c.pinIdField).toBe(true);
    expect(displayMinZoomOf("tn_hickman")).toBe(16);
  });
});

describe("Hamilton County — the county's own ArcGIS Server (Live_Parcels)", () => {
  const cases = Object.entries(REC.hamilton);
  it("four recorded lots across the county, each with an owner, a tax-map number and a situs address", () => {
    expect(cases).toHaveLength(4);
    for (const [, [f]] of cases) {
      expect(String(f.attributes.OWNERNAME1).trim()).not.toBe("");
      expect(String(f.attributes.TAX_MAP_NO).trim()).not.toBe("");
      expect(String(f.attributes.ADDRESS).trim()).not.toBe("");
    }
  });
  it.each(cases.map(([n, [f]]) => [n, f]))("%s resolves to Hamilton's own source, never the empty statewide composite", (_n, f) => {
    const p = interiorPointOf(f);
    const id = countyIdentity(p.lat, p.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("tn_hamilton");
    expect(id.statewideKey).toBeUndefined();
    const c = candidateCountiesForPoint(p.lat, p.lng);
    expect(c).toContain("tn_hamilton");
    expect(c, "the statewide layer holds zero Hamilton rows").not.toContain("tn_statewide");
    expect(noParcelSourceNote(id)).toBeNull();
    expect(statewideExcludesCounty("tn_statewide", "Hamilton County")).toBe(true);
  });
  it("the card reads the tax-map number, the owner and the situs from the real attributes", () => {
    const f = REC.hamilton.soddyDaisy[0];
    expect(idAttrFor("tn_hamilton", f.attributes)).toBe("057F B 003");
    const rec = countyRecord(f.attributes, { idField: "TAX_MAP_NO", addrField: "ADDRESS" });
    expect(rec.owner).toBe("VANESSAS COTTAGE LLC");
    expect(rec.address).toBe("10406 DAYTON PIKE");
  });
  it("rides the relay to the county's allow-listed host, pinned to TAX_MAP_NO / ADDRESS, outline floor 17 (one zoom-16 cell holds 1,066 lots against the 1,000 cap)", () => {
    const c = COUNTIES.tn_hamilton;
    expect(c.layerUrl).toBe("/gis-proxy/mapsdev.hamiltontn.gov/hcwa03/rest/services/Live_Parcels/MapServer/0");
    expect(ALLOWED_HOSTS.has("mapsdev.hamiltontn.gov")).toBe(true);
    expect(c.idField).toBe("TAX_MAP_NO"); expect(c.pinIdField).toBe(true);
    expect(c.addrField).toBe("ADDRESS"); expect(c.pinAddrField).toBe(true);
    expect(displayMinZoomOf("tn_hamilton")).toBe(17);
  });
  it("probe hosts that were measured and not used are not on the allow-list", () => {
    expect(ALLOWED_HOSTS.has("pwgis.chattanooga.gov")).toBe(false);
    expect(ALLOWED_HOSTS.has("gis.mcgtn.org")).toBe(false);
  });
  it("Chattanooga's downtown and the far north of the county (Soddy-Daisy) both route here", () => {
    for (const [lat, lng] of [[35.0456, -85.3097], [35.2587, -85.1744], [35.045, -85.31]]) expect(countyIdentity(lat, lng).key, `${lat},${lng}`).toBe("tn_hamilton");
  });
});

describe("Montgomery County — the City of Clarksville's republication of the Assessor's parcels", () => {
  const cases = Object.entries(REC.montgomery);
  it("four recorded lots, one polygon each (the county server's one-row-per-building-card duplicates are why this copy is used)", () => {
    expect(cases).toHaveLength(4);
    for (const [, fs] of cases) expect(fs, "one row per parcel").toHaveLength(1);
  });
  it.each(cases.map(([n, [f]]) => [n, f]))("%s resolves to Montgomery's source, never the empty statewide composite", (_n, f) => {
    const p = interiorPointOf(f);
    const id = countyIdentity(p.lat, p.lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("tn_montgomery");
    expect(id.statewideKey).toBeUndefined();
    const c = candidateCountiesForPoint(p.lat, p.lng);
    expect(c).toContain("tn_montgomery");
    expect(c).not.toContain("tn_statewide");
    expect(noParcelSourceNote(id)).toBeNull();
    expect(statewideExcludesCounty("tn_statewide", "Montgomery County")).toBe(true);
  });
  it("the card reads the assessor's parcel number, the owner and the situs from the real (lower-case) attributes", () => {
    const f = REC.montgomery.riverside[0];
    expect(idAttrFor("tn_montgomery", f.attributes)).toBe("066F K 00100 000");
    const rec = countyRecord(f.attributes, { idField: "parcelno", addrField: "propertyaddress" });
    expect(rec.owner).toBe("IMMACULATE CONCEPTION CATHOLIC CHURCH");
    expect(rec.address).toBe("709 FRANKLIN ST");
  });
  it("is token-free AGOL (no relay), pinned to parcelno (not the numeric parcelid) and propertyaddress, floor 16 — and never the licence-restricted APSU mirror", () => {
    const c = COUNTIES.tn_montgomery;
    expect(c.layerUrl).toBe("https://services6.arcgis.com/H9ihyy27OU16MQR3/arcgis/rest/services/Parcels_Test/FeatureServer/0");
    expect(c.layerUrl).not.toMatch(/apsu\.edu/);
    expect(c.idField).toBe("parcelno"); expect(c.pinIdField).toBe(true);
    expect(c.addrField).toBe("propertyaddress"); expect(c.pinAddrField).toBe(true);
    expect(displayMinZoomOf("tn_montgomery")).toBe(16);
  });
  it("Clarksville's downtown and Fort Campbell's edge both route here", () => {
    for (const [lat, lng] of [[36.5298, -87.3595], [36.6, -87.41], [36.53, -87.36]]) expect(countyIdentity(lat, lng).key, `${lat},${lng}`).toBe("tn_montgomery");
  });
});

describe("what must not move", () => {
  it("Davidson, Rutherford, Shelby and Chester keep their own sources; an 86-county composite county still rides the composite", () => {
    expect(countyIdentity(36.137653, -86.75516).key).toBe("tn_davidson");
    expect(countyIdentity(35.84, -86.42).key).toBe("tn_rutherford");
    expect(countyIdentity(35.1495, -90.049).key).toBe("tn_shelby");
    expect(countyIdentity(35.4398, -88.6414).key).toBe("tn_chester");
    expect(candidateCountiesForPoint(36.2, -86.52)).toContain("tn_statewide"); // Wilson
  });
  it("Knox stays a named, locked gap and never borrows the composite", () => {
    const id = countyIdentity(35.96, -83.92);
    expect(id.status).toBe("no-source");
    expect(noParcelSourceNote(id)).toBe("Knox County has a parcel map, but it isn't open to the public, so Planyr can't show lots here yet."); // locked: KGIS REST answers 401 (NEW-1, 2026-10-22)
  });
  it("Texas is untouched", () => {
    expect(countyIdentity(29.7604, -95.3698).key).toBe("harris");
    expect(candidateCountiesForPoint(32.7767, -96.797).join()).not.toMatch(/tn_/);
  });
});
