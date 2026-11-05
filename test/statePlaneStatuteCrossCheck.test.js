/* B2494337 (statute cross-check of the county→zone tables, owner read of the statutes 2026-10-29). Pins the corrections that read produced
 * and the bookkeeping that follows from it. Every assertion here FAILS on the commit before this change (red-proofed: see the audit §10).
 *
 *  · Lanier County, GA is WEST (O.C.G.A. 44-4-20(b)(2)) — EPSG/NGS says East; the statute wins.
 *  · Pulaski County, AR (Little Rock) is NORTH — the Arkansas Cadastral Mapping Standard and the owner's epsg.io read; the EPSG database inside
 *    pyproj 3.8.0 (v12.029) still says South, so this is a generator STATUTE_OVERRIDES row, never a hand edit.
 *  · Billings County, ND is in neither list of NDCC 47-20.2-01(1): kept South, but now a `decided` row whose note names the gap.
 *  · Carson City, NV is NAMED in NRS 327.010(2) West Zone, and the 23 Virginia independent cities in Va. Code 1-601: plain rows, not decided.
 *  · Every spelling of Lake of the Woods (MN) resolves to North; SD's renamed Oglala Lakota County (EPSG still says Shannon) resolves to South.
 *  · California's offshore islands (Pub. Res. Code 8802) are Zone 6 by position while their counties stay Zone 5. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { setCountyPolygons, resolveCounty } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import {
  COUNTY_ZONE, zoneForCounty, zoneForPoint, resolveZone, setPointZoneLocator, caIslandOf, CA_ISLAND_ZONE6,
} from "../src/shared/coordinates/statePlane.js";
import { COUNTY_TABLE, DECIDED_COUNTIES, STATUTE_OVERRIDES } from "../src/shared/coordinates/statePlaneCounties.js";

const POLYS = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
const zid = (st, c) => zoneForCounty(st, c)?.id;

describe("NEW-1 · Lanier County, GA is Georgia West (statute wins over EPSG)", () => {
  it("resolves to ga_west by county key, in every spelling, and is no longer in the East list", () => {
    for (const c of ["Lanier", "lanier", "Lanier County", "ga_lanier"]) expect(zid("GA", c), c).toBe("ga_west");
    expect(COUNTY_TABLE.GA.ga_east.split(",")).not.toContain("lanier");
    expect(COUNTY_TABLE.GA.ga_west.split(",")).toContain("lanier");
  });
  it("its neighbours either side of the O.C.G.A. 44-4-20 line did not move", () => {
    expect(zid("GA", "Lowndes")).toBe("ga_west");
    expect(zid("GA", "Clinch")).toBe("ga_east");
    expect(zid("GA", "Berrien")).toBe("ga_west");
    expect(zid("GA", "Atkinson")).toBe("ga_east");
  });
  it("is recorded as a statute override (generator row), not a decision", () => {
    expect(STATUTE_OVERRIDES["GA:lanier"]).toMatchObject({ from: "ga_east", to: "ga_west" });
    expect(zoneForCounty("GA", "Lanier").decided).toBe(false);
  });
});

describe("NEW-2 · Pulaski County, AR (Little Rock) is Arkansas North", () => {
  it("resolves to ar_north by county key and is no longer in the South list", () => {
    for (const c of ["Pulaski", "Pulaski County", "ar_pulaski"]) expect(zid("AR", c), c).toBe("ar_north");
    expect(COUNTY_TABLE.AR.ar_south.split(",")).not.toContain("pulaski");
    expect(COUNTY_TABLE.AR.ar_north.split(",")).toContain("pulaski");
  });
  it("leaves the North/South county counts at the Cadastral Standard's 41 / 34", () => {
    expect(COUNTY_TABLE.AR.ar_north.split(",").length).toBe(41);
    expect(COUNTY_TABLE.AR.ar_south.split(",").length).toBe(34);
  });
  it("is a generator STATUTE_OVERRIDES row that says why — the generator did not move it (EPSG itself lists it South)", () => {
    const o = STATUTE_OVERRIDES["AR:pulaski"];
    expect(o).toMatchObject({ from: "ar_south", to: "ar_north" });
    expect(o.why).toMatch(/Cadastral/);
    expect(o.why).toMatch(/did not move/);
  });
  it("NO other county differs from what the generator reads out of EPSG, except the declared overrides", () => {
    expect(Object.keys(STATUTE_OVERRIDES).sort()).toEqual(["AR:pulaski", "GA:lanier"]);
  });
});

describe("NEW-3 · bookkeeping from the statute read", () => {
  it("Billings County, ND stays South and is decided:true with a note naming the statutory gap", () => {
    const z = zoneForCounty("ND", "Billings");
    expect(z.id).toBe("nd_south");
    expect(z.decided).toBe(true);
    expect(z.decisionNote).toMatch(/47-20\.2-01/);
    expect(z.decisionNote).toMatch(/silent/);
    expect(z.decisionNote).toMatch(/Golden Valley/);
    expect(DECIDED_COUNTIES["ND:billings"]).toBeTruthy();
  });
  it("Carson City, NV is a plain nv_west row — NOT decided (NRS 327.010(2) names it)", () => {
    for (const c of ["Carson City", "Carson", "carson city", "CARSON CITY"]) {
      const z = zoneForCounty("NV", c);
      expect(z.id, c).toBe("nv_west");
      expect(z.decided, c).toBe(false);
      expect(z.decisionNote, c).toBeNull();
    }
    expect(DECIDED_COUNTIES["NV:carson"]).toBeUndefined();
  });
  it("every Virginia independent city resolves to the zone it had, with decided:false", () => {
    const want = {
      alexandria: "va_north", buenavista: "va_south", charlottesville: "va_south", covington: "va_south", danville: "va_south",
      emporia: "va_south", fallschurch: "va_north", fredericksburg: "va_north", galax: "va_south", harrisonburg: "va_north",
      hopewell: "va_south", lexington: "va_south", manassas: "va_north", manassaspark: "va_north", martinsville: "va_south",
      poquoson: "va_south", radford: "va_south", salem: "va_south", staunton: "va_north", virginiabeach: "va_south",
      waynesboro: "va_north", williamsburg: "va_south", winchester: "va_north",
    };
    expect(Object.keys(want).length).toBe(23);
    for (const [c, zone] of Object.entries(want)) {
      const z = zoneForCounty("VA", c);
      expect(z.id, c).toBe(zone);
      expect(z.decided, c).toBe(false);
    }
    expect(Object.keys(DECIDED_COUNTIES).filter((k) => k.startsWith("VA:"))).toEqual([]);
  });
  it("Lake of the Woods, MN resolves to mn_north in every spelling (slug lakethewoods)", () => {
    for (const c of ["Lake of the Woods", "LAKE OF THE WOODS COUNTY", "Lake of the Woods County", "lake of the woods", "mn_lakethewoods", "mn_lakeofthewoods", "lakeofthewoods"]) {
      expect(zid("MN", c), c).toBe("mn_north");
    }
    expect(COUNTY_TABLE.MN.mn_north.split(",")).toContain("lakethewoods");
  });
  it("SD's Oglala Lakota County (EPSG: Shannon) resolves to sd_south, under both names", () => {
    for (const c of ["Oglala Lakota", "Oglala Lakota County", "Shannon", "Shannon County", "sd_shannon"]) expect(zid("SD", c), c).toBe("sd_south");
  });
});

describe("NEW-3 · California's offshore islands are Zone 6 by statute (Pub. Res. Code 8802)", () => {
  const ISLANDS = [
    ["Avalon, Santa Catalina Island (Los Angeles Co.)", 33.3428, -118.3278, "Los Angeles", "Santa Catalina Island"],
    ["Two Harbors, Santa Catalina Island", 33.4430, -118.5000, "Los Angeles", "Santa Catalina Island"],
    ["San Clemente Island (Los Angeles Co.)", 32.9, -118.5, "Los Angeles", "San Clemente Island"],
    ["San Nicolas Island (Ventura Co.)", 33.2500, -119.5000, "Ventura", "San Nicolas Island"],
    ["Santa Barbara Island", 33.4755, -119.0343, "Ventura", "Santa Barbara Island"],
  ];
  const MAINLAND = [
    ["Long Beach (Los Angeles Co.)", 33.7701, -118.1937, "Los Angeles"],
    ["Palos Verdes / San Pedro", 33.7360, -118.2923, "Los Angeles"],
    ["Port Hueneme (Ventura Co.)", 34.1478, -119.1951, "Ventura"],
    ["Anacapa Island (not named by the statute)", 34.0100, -119.4000, "Ventura"],
    ["Santa Cruz Island (not named by the statute)", 34.0, -119.75, "Santa Barbara"],
    ["downtown Los Angeles", 34.0522, -118.2437, "Los Angeles"],
  ];
  it("the island list is exactly the four the statute names", () => {
    expect(CA_ISLAND_ZONE6.map((i) => i.name).sort()).toEqual(["San Clemente Island", "San Nicolas Island", "Santa Barbara Island", "Santa Catalina Island"]);
  });
  for (const [label, lat, lon, county, island] of ISLANDS) {
    it(`${label}: a county + point → Zone 6, but the county alone stays Zone 5`, () => {
      expect(caIslandOf(lat, lon)?.name).toBe(island);
      expect(zoneForCounty("CA", county, { lat, lon }).id).toBe("ca_6");
      expect(zoneForCounty("CA", county, { lat, lon }).decided).toBe(false);   // the statute names it; nothing was decided
      expect(resolveZone({ state: "CA", county, lat, lon }).id).toBe("ca_6");
      expect(zoneForCounty("CA", county).id).toBe("ca_5");
      expect(zoneForCounty("CA", county, { lat }).id).toBe("ca_5");            // a latitude alone cannot place an island
    });
    it(`${label}: a BARE point (no county, no polygons loaded) → Zone 6`, () => {
      const z = zoneForPoint(lat, lon);
      expect(z.id).toBe("ca_6");
      expect(z.via).toBe("island-point");
      expect(z.coarse).toBeUndefined();
      expect(resolveZone({ lat, lon }).id).toBe("ca_6");
    });
  }
  for (const [label, lat, lon, county] of MAINLAND) {
    it(`${label}: stays Zone 5, never an island`, () => {
      expect(caIslandOf(lat, lon)).toBeNull();
      expect(zoneForCounty("CA", county, { lat, lon }).id).toBe("ca_5");
    });
  }
  it("an island point is not Zone 6 when the call is restricted to another state", () => {
    expect(zoneForPoint(33.3428, -118.3278, "NV")?.state).not.toBe("CA");
  });
});

describe("a bare point resolves by county once polygons are loaded — and Catalina still wins", () => {
  beforeAll(async () => { await setCountyPolygons(POLYS); });
  afterAll(() => setPointZoneLocator(null));

  it("Little Rock (34.7465, -92.2896) → ar_north via the county the point is in (known-good arm: polygons answered)", () => {
    expect(resolveCounty(34.7465, -92.2896).status, "VOID: county polygons did not answer").toBe("ok");
    const z = zoneForPoint(34.7465, -92.2896);
    expect(z.via, "VOID: not a county answer").toBe("county-point");
    expect(z.id).toBe("ar_north");
  });
  it("Avalon (33.3428, -118.3278) → ca_6 even though a county polygon covers it; Long Beach → ca_5 by county", () => {
    expect(resolveCounty(33.7701, -118.1937).status, "VOID: county polygons did not answer").toBe("ok");
    expect(zoneForPoint(33.7701, -118.1937).via).toBe("county-point");
    expect(zoneForPoint(33.7701, -118.1937).id).toBe("ca_5");
    const z = zoneForPoint(33.3428, -118.3278);
    expect(z.id).toBe("ca_6");
    expect(z.via).toBe("island-point");
  });
  it("Lanier County's seat, Lakeland (31.0402, -83.0757) → ga_west by county", () => {
    expect(resolveCounty(31.0402, -83.0757).status, "VOID: county polygons did not answer").toBe("ok");
    expect(zoneForPoint(31.0402, -83.0757).id).toBe("ga_west");
  });
});

it("no hand-written COUNTY_ZONE row changed (Texas bit-for-bit golden master is the statePlane suite)", () => {
  expect(Object.keys(COUNTY_ZONE).filter((k) => k.startsWith("TX:")).sort()).toEqual(["TX:chambers", "TX:fortbend", "TX:harris", "TX:waller"]);
});
