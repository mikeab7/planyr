/* NEW-2 (California parcels) — a California view routes Select-parcels to the California source ONLY, the outline
 * floor is high enough that a dense cell fits inside the service's record cap, and a click at a named California
 * point resolves APN + county + address (not the database row number).
 *
 * The attribute bag is the LIVE one: CAL FIRE `CA_Statewide_Parcels_Public_view`, queried from the build sandbox
 * 2026-10-02 at (-117.6030, 34.0260) with the app's own point query (inSR 4326, outSR 4326) — a parcel on E Riverside
 * Dr in Ontario, San Bernardino County. Family of test/parcelDisplaySourcesForView.test.js. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, displaySourcesForView, displayMinZoomOf, displayMinZoomForUrl, displayFloorForView, displayFloorForPoint, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { idAttrFor, resolveSearchField } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { apprRows, parcelPanelRows, parcelCardRows, situsAddress } from "../src/workspaces/site-planner/lib/appraisal.js";
import { PARCEL_MINZOOM, PARCEL_VECTOR_MINZOOM, parcelDisplayRegimeForZoom } from "../src/workspaces/site-planner/lib/parcelDisplayZoom.js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const view = (south, west, north, east) => ({ south, west, north, east });
const stateOf = (k) => COUNTIES_MAP[k].state;

// Live attribute bag (OBJECTID deliberately FIRST, as the service lists it — the field the unpinned detector grabbed).
const ONTARIO_ATTRS = {
  OBJECTID: 7421733, PARCEL_APN: "011328215", FIPS_CODE: "06071", PARCEL_DMP_ID: "SBD-011328215", COUNTYNAME: "SAN BERNARDINO",
  SITE_ADDR: "2525 E RIVERSIDE DR", SITE_CITY: "ONTARIO", SITE_STATE: "CA", SITE_ZIP: "91761", SITE_PLUS_4: null,
  FullStreetAddress: "2525 E RIVERSIDE DR, ONTARIO, CA 91761", Search_PARCELAPN: "011328215", Shape__Area: 28000.5, Shape__Length: 700.2,
};

describe("a California view queries ONLY the California source", () => {
  const cases = {
    "Ontario industrial": view(34.04, -117.62, 34.08, -117.56),
    "downtown Los Angeles": view(34.03, -118.27, 34.07, -118.21),
    "San Francisco": view(37.76, -122.45, 37.80, -122.39),
    "Stockton": view(37.93, -121.33, 37.99, -121.25),
    "Bloomington (unincorporated Inland Empire)": view(34.05, -117.42, 34.09, -117.37),
  };
  for (const [name, v] of Object.entries(cases)) {
    it(`${name} → ca_statewide and nothing else (no Texas/Colorado/Georgia/Nevada source, no nationwide fan-out)`, () => {
      expect(displaySourcesForView(v)).toEqual(["ca_statewide"]);
    });
  }
  it("a whole-state California view stays California + the genuinely neighbouring Nevada source — never a country-wide list", () => {
    const got = displaySourcesForView(view(32.5, -124.5, 42.0, -114.1));
    expect(got).toContain("ca_statewide");
    expect(got.every((k) => ["CA", "NV"].includes(stateOf(k)))).toBe(true);
    expect(got.length).toBeLessThanOrEqual(3);
    for (const bad of ["txgio_statewide", "harris", "fortbend", "co_statewide", "ak_statewide", "ct_statewide", "ga_bartow", "or_multnomah"]) expect(got).not.toContain(bad);
  });
  it("Lake Tahoe straddle → California + Nevada only", () => {
    const got = displaySourcesForView(view(38.9, -120.1, 39.3, -119.8));
    expect(got).toContain("ca_statewide");
    expect(got.every((k) => ["CA", "NV"].includes(stateOf(k)))).toBe(true);
  });
  it("Reno (Nevada) draws no California source", () => {
    expect(displaySourcesForView(view(39.45, -119.9, 39.6, -119.7))).not.toContain("ca_statewide");
  });
  it("the California source carries no Texas attribution or layer", () => {
    const c = COUNTIES_MAP.ca_statewide;
    expect(c.state).toBe("CA");
    expect(c.layerUrl).toMatch(/CA_Statewide_Parcels_Public_view\/FeatureServer\/0$/);
    expect(JSON.stringify(c)).not.toMatch(/txgio|Texas|TxGIO|geographic\.texas/i);
  });
});

describe("the outline draw is bounded: the floor sits where a dense cell fits the service's record cap", () => {
  it("ca_statewide declares the higher floor; ordinary sources declare none", () => {
    expect(displayMinZoomOf("ca_statewide")).toBe(17);
    // NEW-1 (2026-10-04): a queryable MapServer CAD (Harris) no longer draws the county /export picture in the
    // wide band, so its vector outline starts at the vector floor; a FeatureServer (Fort Bend) declares none.
    expect(displayMinZoomOf("harris")).toBe(PARCEL_VECTOR_MINZOOM);
    expect(displayMinZoomOf("fortbend")).toBe(0);
    expect(displayMinZoomOf("nv_statewide")).toBe(/\/MapServer\/\d+$/i.test(COUNTIES_MAP.nv_statewide.layerUrl) ? PARCEL_VECTOR_MINZOOM : 0); // NEW-1 (2026-10-04): a queryable MapServer starts at the vector floor
    expect(displayMinZoomOf("no_such_key")).toBe(0);
  });
  it("the floor is found by the display layer's own handle — the service URL", () => {
    expect(displayMinZoomForUrl(COUNTIES_MAP.ca_statewide.layerUrl)).toBe(17);
    expect(displayMinZoomForUrl(COUNTIES_MAP.ca_statewide.layerUrl + "/")).toBe(17);
    expect(displayMinZoomForUrl(COUNTIES_MAP.harris.layerUrl || COUNTIES_MAP.harris.mapServer)).toBe(PARCEL_VECTOR_MINZOOM); // NEW-1 (2026-10-04)
    expect(displayMinZoomForUrl(COUNTIES_MAP.fortbend.layerUrl)).toBe(0);
    expect(displayMinZoomForUrl(null)).toBe(0);
  });
  it("the 'zoom in to see the lines' hint follows the source: California views want 17, Texas views stay at the generic floor", () => {
    expect(Math.max(PARCEL_MINZOOM, displayFloorForView(view(34.04, -117.62, 34.08, -117.56)))).toBe(17);
    expect(Math.max(PARCEL_MINZOOM, displayFloorForPoint(34.0260, -117.6030))).toBe(17);
    // Fort Bend (a FeatureServer) keeps the generic floor; Harris (a MapServer) draws vectors only from the vector floor (NEW-1, 2026-10-04).
    expect(Math.max(PARCEL_MINZOOM, displayFloorForView(view(29.52, -95.80, 29.58, -95.72)))).toBe(PARCEL_MINZOOM);
    expect(Math.max(PARCEL_MINZOOM, displayFloorForPoint(29.55, -95.76))).toBe(PARCEL_MINZOOM);
    expect(Math.max(PARCEL_MINZOOM, displayFloorForView(view(29.72, -95.42, 29.78, -95.34)))).toBe(PARCEL_VECTOR_MINZOOM);
    expect(Math.max(PARCEL_MINZOOM, displayFloorForPoint(29.75, -95.37))).toBe(PARCEL_VECTOR_MINZOOM);
  });
  /* Measured live 2026-10-02 (returnCountOnly, 512-px cells — esri-leaflet's default cell size — over the densest
   * blocks sampled). The cap is the service's maxRecordCount (2,000, from layer metadata). Zoom 16 still overflows
   * somewhere in a city CAL FIRE covers; zoom 17 fits every cell sampled. If a re-measure ever moves these, update
   * the floor in counties.js and this table together. */
  const MAX_CELL = { 16: { "SF Mission": 3410, "Oakland": 2271, "LA Koreatown": 1757, "LA Boyle Heights": 1343 }, 17: { "SF Mission": 1018, "Oakland": 1124, "LA Koreatown": 765, "LA Boyle Heights": 340 } };
  const CAP = 2000;
  it("zoom 16 would overflow the 2,000-feature cap in at least one sampled dense cell (so it is NOT a safe floor)", () => {
    expect(Math.max(...Object.values(MAX_CELL[16]))).toBeGreaterThan(CAP);
  });
  it("zoom 17 fits every sampled dense cell under the cap — and the declared floor is exactly that zoom", () => {
    expect(Math.max(...Object.values(MAX_CELL[17]))).toBeLessThan(CAP);
    expect(displayMinZoomOf("ca_statewide")).toBe(17);
  });
  it("at the floor the regime is the vector outline layer; the floor never lowers the generic gate", () => {
    expect(parcelDisplayRegimeForZoom(17)).toBe("close");
    expect(Math.max(PARCEL_MINZOOM, displayMinZoomOf("ca_statewide"))).toBeGreaterThanOrEqual(PARCEL_MINZOOM);
  });
});

describe("a parcel click at a named California point returns APN, county and address", () => {
  it("the 'Account / ID' is the APN — NOT the OBJECTID row number the unpinned detector returned", () => {
    expect(COUNTIES_MAP.ca_statewide.pinIdField).toBe(true);
    expect(idAttrFor("ca_statewide", ONTARIO_ATTRS)).toBe("011328215");
    // control: with no pin the generic detector grabs the row number — this is the defect the pin closes.
    const fields = Object.keys(ONTARIO_ATTRS).map((name) => ({ name }));
    expect(resolveSearchField(fields, "id", undefined, false)).toBe("OBJECTID");
  });
  it("the planner parcel panel shows situs address + APN up front, and the county in the details", () => {
    expect(situsAddress(ONTARIO_ATTRS)).toBe("2525 E RIVERSIDE DR");
    const rows = parcelPanelRows(ONTARIO_ATTRS, { acct: idAttrFor("ca_statewide", ONTARIO_ATTRS) });
    expect(rows.primary).toEqual([
      { label: "Situs address", value: "2525 E RIVERSIDE DR" },
      { label: "Account / ID", value: "011328215" },
    ]);
    expect(rows.more).toEqual([{ label: "County", value: "SAN BERNARDINO" }]);
  });
  it("even with no identify-supplied account id, the curated 'Account / ID' row resolves PARCEL_APN (not Search_PARCELAPN twice, not OBJECTID)", () => {
    const acct = apprRows(ONTARIO_ATTRS).filter((r) => r.label === "Account / ID");
    expect(acct).toEqual([{ label: "Account / ID", value: "011328215" }]);
    expect(parcelCardRows(ONTARIO_ATTRS).primary.find((r) => r.label === "Account / ID").value).toBe("011328215");
  });
  it("no owner and no appraised value are invented — the thin schema stays thin (absent, never zero)", () => {
    const labels = apprRows(ONTARIO_ATTRS).map((r) => r.label);
    expect(labels).not.toContain("Owner");
    expect(labels).not.toContain("Total value");
    expect(labels).not.toContain("Land value");
  });
  it("a Texas-shaped county bag is unchanged by the new rows (no stray 'County' row from a county CODE column)", () => {
    const tx = apprRows({ prop_id: "12345", owner_name: "ACME LP", situs_addr: "1 MAIN ST", county: "48201", legal_area: 4.2 });
    expect(tx.map((r) => r.label)).toEqual(["Owner", "Situs address", "Account / ID", "Acreage"]);
  });
  it("the click resolves to the California source at the Ontario point and at downtown Los Angeles", () => {
    expect(candidateCountiesForPoint(34.0260, -117.6030)).toEqual(["ca_statewide"]);
    expect(candidateCountiesForPoint(34.0522, -118.2437)).toEqual(["ca_statewide"]);
  });
});
