/* NEW-1 (B2384880, 2026-10-20) — a click on a lot in ANY of New Jersey's 564 municipalities reaches the NJ parcel composite.
 *
 * RED-PROOF: on main eccb06e the fixture's 87 shoreline / barrier-island samples (Atlantic City, Cape May, Long Beach Island, Seaside Heights, Sea Bright …) fall outside
 * the bundled county polygons, so `candidateCountiesForPoint` returned [] and the click never queried anything. The coastal-gap fallback in counties.js fixes them; removing it
 * turns this suite red (87 samples). The sample points are real composite parcels, one set per municipality, never hand-picked. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, candidateCountiesForPoint, lineNeighbourKeysForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/njMunicipalities.json", import.meta.url), "utf8")).munis;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

describe("the NJ source", () => {
  it("is NJOGIS's own AGOL copy of the composite, statewide", () => {
    const c = COUNTIES_MAP.nj_statewide;
    expect(c.statewide).toBe(true);
    expect(c.layerUrl).toBe("https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0");
    expect(c.idField).toBe("PAMS_PIN");
  });
  it("the sample covers all 564 municipalities in 21 counties", () => {
    expect(FX).toHaveLength(564);
    expect(new Set(FX.map((m) => m.county)).size).toBe(21);
  });
});

describe("every municipality's parcels route to nj_statewide", () => {
  const cases = FX.flatMap((m) => m.pts.map((p, i) => [`${m.name} (${m.county}) #${i + 1}`, p]));
  it.each(cases)("%s", (_n, [la, ln]) => {
    const direct = candidateCountiesForPoint(la, ln);
    // a lot within the line band may be asked of the neighbour's source first; the second pass (identifyWithFallback) then reaches NJ
    expect(direct.includes("nj_statewide") || lineNeighbourKeysForPoint(la, ln).includes("nj_statewide")).toBe(true);
  });
  it("shoreline lots (Cape May, Atlantic City, Sea Bright) get a candidate at all", () => {
    for (const nm of ["CAPE MAY CITY", "ATLANTIC CITY CITY", "SEA BRIGHT BORO", "LONG BEACH TWP"]) {
      const m = FX.find((x) => x.name === nm);
      expect(m, nm).toBeTruthy();
      expect(candidateCountiesForPoint(...m.pts[0]), nm).toContain("nj_statewide");
    }
  });
});

describe("state lines", () => {
  it("a Delaware River NJ-side point (Phillipsburg) asks the NJ source, not Pennsylvania's alone", () => {
    const c = candidateCountiesForPoint(40.6937, -75.191);
    expect(c).toContain("nj_statewide");
    expect(c[0]).not.toBe("pa_northampton");
  });
  it("a Hudson NJ-side point (Palisades Interstate corridor) asks the NJ source", () => {
    expect(candidateCountiesForPoint(40.8509, -73.9712)).toContain("nj_statewide");
  });
});

import { situsAddress, ownerName, countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
describe("the parcel card reads a real NJOGIS row (Jersey City, 280 Grove St)", () => {
  const row = { OBJECTID: 5, PAMS_PIN: "0906_12904_1", PCL_MUN: "0906", COUNTY: "HUDSON", MUN_NAME: "JERSEY CITY CITY", PROP_LOC: "280 GROVE STREET", OWNER_NAME: "", ST_ADDRESS: "1 OWNER MAIL RD", CITY_STATE: "NEWARK NJ", CALC_ACRE: 1.9295 };
  it("id = PAMS_PIN, address = the property location (never the owner's mailing line), acreage present, blank owner stays blank", () => {
    expect(idAttrFor("nj_statewide", row)).toBe("0906_12904_1");
    expect(situsAddress(row)).toBe("280 GROVE STREET");
    expect(situsAddress({ ...row, PROP_LOC: "" })).toBeNull(); // mailing address is never the situs
    expect(ownerName(row)).toBeNull();
    expect(countyRecord(row, { idField: "PAMS_PIN" }).deedAcres).toBeCloseTo(1.9295, 3);
  });
});
