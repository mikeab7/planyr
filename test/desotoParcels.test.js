/* DeSoto County MS parcels (B2507056) — the county's OWN server is the primary; Mississippi's statewide MARIS layer, then the June 2024 copy, stand in when it is silent;
 * and the county record reads owner / PIN / acreage / address and the county's own document links from a REAL row of the county service (recorded 2026-10-29 through planyr.io/gis-proxy). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { PARCEL_COPIES } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { fallbackSpecsFor, fallbackNoticeText, countiesWithFallback } from "../src/workspaces/site-planner/lib/parcelFallbacks.js";
import { countyRecord, parcelCardRows } from "../src/workspaces/site-planner/lib/appraisal.js";

const row = JSON.parse(fs.readFileSync(new URL("./fixtures/countyRecordRows.json", import.meta.url))).rows.ms_desoto;

describe("the row", () => {
  it("points at the county's own server through the relay, not the 2024 Esri-hosted copy", () => {
    expect(COUNTIES.ms_desoto.layerUrl).toBe("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer/1");
    expect(COUNTIES_MAP.ms_desoto.layerUrl).toBe(COUNTIES.ms_desoto.layerUrl);
    expect(COUNTIES.ms_desoto.idField).toBe("PIN");
    expect(COUNTIES.ms_desoto.addrField).toBe("FULL_ADDR");
  });
  it("is the county's own data in the provenance record, not a third-party copy (so no 'copy' note is owed)", () => {
    expect(COUNTY_VERIFICATION.ms_desoto.publisher).toBe("own");
    expect(COUNTY_VERIFICATION.ms_desoto.verifiedOn).toBe("2026-10-29");
    expect(PARCEL_COPIES.ms_desoto).toBeUndefined();
  });
  it("a click in DeSoto County asks the DeSoto row first (and only the Mississippi/DeSoto rows are candidates at Olive Branch)", () => {
    const c = candidateCountiesForPoint(34.9618, -89.8295);
    expect(c[0]).toBe("ms_desoto");
  });
});

describe("a Texas site never asks DeSoto", () => {
  it("no Harris, Dallas or Atlanta click lists the DeSoto row", () => {
    for (const [lat, lng] of [[29.7604, -95.3698], [32.7767, -96.797], [33.749, -84.388], [36.1627, -86.7816]]) expect(candidateCountiesForPoint(lat, lng), `${lat},${lng}`).not.toContain("ms_desoto");
  });
});

describe("when the county server is silent: MARIS, then the 2024 copy — said in words", () => {
  it("fallbacks inside the county, in that order, none outside it", () => {
    const specs = fallbackSpecsFor({ failed: ["ms_desoto"], lat: 34.9618, lng: -89.8295 });
    expect(specs.map((s) => s.key)).toEqual(["ms_desoto_maris", "ms_desoto_etr"]);
    expect(specs[0].directUrl).toBe("/gis-proxy/gis.mississippi.edu/server/rest/services/Cadastral/MS_Parcels_August_2024/MapServer/1");
    expect(specs.every((s) => s.asCounty === "ms_desoto")).toBe(true);
    expect(fallbackSpecsFor({ failed: ["ms_desoto"], lat: 29.76, lng: -95.37 })).toEqual([]);
  });
  it("the notice says the county's own server did not answer and names where the lot came from", () => {
    const t = fallbackNoticeText({ failedKey: "ms_desoto", label: "Mississippi statewide layer (MARIS)" });
    expect(t).toMatch(/DeSoto County’s own parcel server didn’t answer/);
    expect(t).toMatch(/Mississippi statewide layer \(MARIS\)/);
  });
  it("is in the pinned list of counties that have a fallback", () => {
    expect(countiesWithFallback().find((r) => r.county === "ms_desoto").fallbacks).toHaveLength(2);
  });
});

describe("the county record, from a REAL row of the county service", () => {
  it("owner, PIN, address and deed acres read through the shared resolvers", () => {
    const rec = countyRecord(row.attrs, { idField: COUNTIES.ms_desoto.idField, addrField: COUNTIES.ms_desoto.addrField });
    expect(rec.owner).toBe("GIANT OIL CO");
    expect(rec.account).toBe("106834002 0003800"); // the county pads the PIN with spaces; the card collapses them
    expect(rec.address).toBe("6973 HWY 305");
    expect(rec.deedAcres).toBeCloseTo(0.8569, 3);
  });
  it("the card carries the county's five document links as labelled rows, each an http(s) link", () => {
    const { primary, more } = parcelCardRows(row.attrs, {});
    const all = [...primary, ...more];
    const byLabel = Object.fromEntries(all.map((r) => [r.label, r.value]));
    for (const [label, re] of [["Warranty deed", /landrecords\.desotocountyms\.gov/], ["Tax info", /records\.desotocountyms\.gov/], ["Tax map", /\.pdf$/], ["FEMA map", /msc\.fema\.gov/]]) {
      expect(byLabel[label], label).toMatch(/^https?:\/\//);
      expect(byLabel[label], label).toMatch(re);
    }
  });
});
