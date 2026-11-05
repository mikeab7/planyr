/* B2478961 / NEW-1–NEW-3 (STATE-PLANE-STATUTE, owner decision 2026-10-29): EVERY COUNTY SITS IN THE ZONE ITS STATE'S STATUTE ASSIGNS.
 *
 * Standing rule: in Texas and every other state that splits into zones, a county is in the zone the statute puts it in — no legacy
 * exceptions. A `decided:true` row is allowed ONLY where the statute is genuinely silent (Broomfield, CO is the model) and must say so.
 *
 * What is pinned here, and the red-proof of each (each of these FAILS on the commit before this change):
 *  1. Montgomery County, TX → Texas Central (2277), by county key. (main: tx_sc — a hand-written legacy override.)
 *  2. A BARE point resolves by the COUNTY it is in before any coarse box: Conroe and Liberty (Texas Central counties the old Houston
 *     box swallowed) → tx_central; downtown Houston and Katy stay tx_sc. (main: all four tx_sc.)
 *  3. Adjacent counties either side of a zone line in other split states, by county key AND by bare point — including three the old
 *     boxes got wrong outright (Yonkers, Anaheim, Memphis).
 *  4. No `decided:true` row anywhere without a note that names the statutory gap that justifies it.
 * The point tests carry a KNOWN-GOOD ARM (the county polygons really did load: a point-in-county answer says `via:"county-point"`), so a
 * run whose locator never installed reports VOID instead of a vacuous pass. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { setCountyPolygons, resolveCounty } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import {
  COUNTY_ZONE, zoneForCounty, zoneForPoint, resolveZone, setPointZoneLocator, hasPointZoneLocator,
} from "../src/shared/coordinates/statePlane.js";
import { DECIDED_COUNTIES, SPLIT_COUNTIES } from "../src/shared/coordinates/statePlaneCounties.js";
import { placementZone } from "../src/shared/overlay/overlayPlacement.js";

const POLYS = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));

describe("1 · Montgomery County, TX is Texas Central (Tex. Nat. Res. Code §21.074(c))", () => {
  it("resolves to tx_central / EPSG 2277 by county key, name, routing prefix and state+county", () => {
    for (const c of ["Montgomery", "montgomery", "Montgomery County", "MONTGOMERY COUNTY"]) {
      const z = zoneForCounty("TX", c);
      expect(z.id, c).toBe("tx_central");
      expect(z.epsg, c).toBe(2277);
      expect(z.decided, c).toBe(false);          // the statute decides, not this project
    }
    expect(resolveZone({ state: "TX", county: "montgomery", lat: 30.3119, lon: -95.4561 }).id).toBe("tx_central");
    expect(COUNTY_ZONE["TX:montgomery"]).toBeUndefined();
  });

  it("the rest of §21.074(c) is Central and §21.074(d) is South Central — Houston-area counties unchanged", () => {
    for (const c of ["Montgomery", "Liberty", "Walker", "San Jacinto", "Grimes", "Hardin", "Polk", "Orange", "Jasper", "Newton", "Tyler"]) {
      expect(zoneForCounty("TX", c).id, `§21.074(c) ${c}`).toBe("tx_central");
    }
    for (const c of ["Harris", "Fort Bend", "Waller", "Austin", "Chambers", "Jefferson", "Galveston", "Brazoria"]) {
      expect(zoneForCounty("TX", c).id, `§21.074(d) ${c}`).toBe("tx_sc");
    }
  });
});

describe("2 · a bare point resolves by the county it is in, never by a box that covers several zones' counties", () => {
  beforeAll(async () => {
    // No locator yet: the legacy boxes are all a bare point has, and the result SAYS it is coarse.
    expect(hasPointZoneLocator()).toBe(false);
    expect(zoneForPoint(29.7604, -95.3698).coarse).toBe(true);
    await setCountyPolygons(POLYS);
  });
  afterAll(() => setPointZoneLocator(null));

  const at = (lat, lon) => {
    const county = resolveCounty(lat, lon);
    expect(county.status, `VOID: county polygons did not answer at ${lat},${lon}`).toBe("ok");   // the known-good arm
    const z = zoneForPoint(lat, lon);
    expect(z.via, `VOID: ${lat},${lon} was not answered by county`).toBe("county-point");
    expect(z.coarse).toBeUndefined();
    return z.id;
  };

  it("Conroe (Montgomery) and Liberty (Liberty County) are Texas Central", () => {
    expect(at(30.3119, -95.4561)).toBe("tx_central");
    expect(at(30.0580, -94.7955)).toBe("tx_central");
  });
  it("downtown Houston and Katy stay Texas South Central", () => {
    expect(at(29.7604, -95.3698)).toBe("tx_sc");
    expect(at(29.7858, -95.8245)).toBe("tx_sc");
  });
  it("the overlay placement zone (shared/overlay) takes the same county answer", () => {
    expect(placementZone(30.3119, -95.4561).id).toBe("tx_central");
    expect(placementZone(29.7604, -95.3698).id).toBe("tx_sc");
  });
  it("resolveZone with only a point (no state, no county) agrees", () => {
    expect(resolveZone({ lat: 30.3119, lon: -95.4561 }).id).toBe("tx_central");
    expect(resolveZone({ lat: 30.3119, lon: -95.4561, state: "TX" }).id).toBe("tx_central");
  });
  it("a state in the call that disagrees with the county found does not take the county's zone", () => {
    // Conroe is in TX; asked for "LA" the locator must not answer with a Texas zone.
    const z = zoneForPoint(30.3119, -95.4561, "LA");
    expect(z == null || z.state === "LA").toBe(true);
  });

  /* One county either side of a zone line, in 8 other split states: [label, lat, lon, county key (state, name), expected zone]. */
  const PAIRS = [
    ["Atlanta (Fulton)", 33.749, -84.388, "GA", "Fulton", "ga_west"],
    ["Savannah (Chatham)", 32.0809, -81.0912, "GA", "Chatham", "ga_east"],
    ["Birmingham (Jefferson)", 33.5186, -86.8104, "AL", "Jefferson", "al_west"],
    ["Montgomery, AL", 32.3668, -86.3, "AL", "Montgomery", "al_east"],
    ["Jackson, MS (Hinds)", 32.2988, -90.1848, "MS", "Hinds", "ms_west"],
    ["Tupelo, MS (Lee)", 34.2576, -88.7034, "MS", "Lee", "ms_east"],
    ["Southaven, MS (DeSoto) — beside Tennessee", 34.9889, -90.0126, "MS", "DeSoto", "ms_west"],
    ["Memphis, TN (Shelby) — beside Mississippi/Arkansas", 35.1495, -90.049, "TN", "Shelby", "tn"],
    ["Yonkers, NY (Westchester)", 40.9312, -73.8988, "NY", "Westchester", "ny_east"],
    ["the Bronx, NY", 40.8448, -73.8648, "NY", "Bronx", "ny_long_island"],
    ["Manhattan, NY", 40.7831, -73.9712, "NY", "New York", "ny_long_island"],
    ["Los Angeles, CA", 34.05, -118.24, "CA", "Los Angeles", "ca_5"],
    ["Anaheim, CA (Orange)", 33.8366, -117.9143, "CA", "Orange", "ca_6"],
    ["San Francisco, CA", 37.7749, -122.4194, "CA", "San Francisco", "ca_3"],
    ["Sacramento, CA", 38.5816, -121.4944, "CA", "Sacramento", "ca_2"],
    ["Tampa, FL (Hillsborough)", 27.9506, -82.4572, "FL", "Hillsborough", "fl_west"],
    ["Miami, FL (Miami-Dade)", 25.7617, -80.1918, "FL", "Miami-Dade", "fl_east"],
    ["Tallahassee, FL (Leon)", 30.4383, -84.2807, "FL", "Leon", "fl_north"],
  ];
  for (const [label, lat, lon, st, county, want] of PAIRS) {
    it(`${label}: by county key AND by bare point → ${want}`, () => {
      expect(zoneForCounty(st, county).id, "county key").toBe(want);
      expect(at(lat, lon), "bare point").toBe(want);
    });
  }
  it("Yonkers (Westchester) and the Bronx are one block apart and in different zones — the case the old boxes got wrong", () => {
    expect(at(40.9312, -73.8988)).not.toBe(at(40.8448, -73.8648));
  });
});

describe("3 · a `decided:true` assignment is allowed only where the statute is genuinely silent, and must say so", () => {
  // The statutory-gap vocabulary a decision note must use — it has to NAME why the statute does not settle the county.
  // Hawaii's zones are defined by ISLAND, not county, so a county can only be mapped through its island (the note says so).
  const GAP = /(not named|is not listed|does not (name|list)|predates|not in EPSG|silent|split by)/i;
  const HI_ISLAND = /(island|molokai|lanai|oahu|niihau|zone \d)/i;   // Hawaii's gap is structural: the zones are islands, so each county's note names its islands

  it("every hand-written decided row carries a note that names the statutory gap", () => {
    const decided = Object.entries(COUNTY_ZONE).filter(([, v]) => v.decided === true);
    expect(decided.length).toBeGreaterThan(0);       // Broomfield — a vacuous empty list would pass the loop below
    for (const [k, v] of decided) {
      expect(v.decisionNote, `${k} is decided:true with no decisionNote`).toBeTruthy();
      expect(v.decisionNote, `${k}'s note does not name the statutory gap`).toMatch(GAP);
    }
    expect(COUNTY_ZONE["CO:broomfield"].decided).toBe(true);
  });

  it("no non-decided hand-written row contradicts the generated table (a legacy override is a decision in disguise)", () => {
    for (const [k, v] of Object.entries(COUNTY_ZONE)) {
      if (v.decided) continue;
      const [st, slug] = k.split(":");
      const generated = zoneForCountyFromTable(st, slug);
      expect(generated, `${k} is hand-written as ${v.zone} but the generated table says ${generated}`).toBe(v.zone);
    }
  });

  it("every generated decided county (independent cities, Carson City) and split county names its reason", () => {
    for (const [k, d] of Object.entries(DECIDED_COUNTIES)) {
      expect(d.note || d.surroundedBy, `${k} has no stated reason`).toBeTruthy();
      // …and the note a USER sees (zoneForCounty's) names the gap, not merely exists.
      const [st, slug] = k.split(":");
      const z = zoneForCounty(st, slug, { lat: 47 });
      expect(z.decided, k).toBe(true);
      expect(z.decisionNote, `${k}'s decisionNote does not name the statutory gap`).toMatch(st === "HI" ? HI_ISLAND : GAP);
    }
    for (const k of Object.keys(SPLIT_COUNTIES)) {
      expect(k).toBe("WA:grant");
      const [st, slug] = k.split(":");
      for (const lat of [47.0, 48.0]) {
        const z = zoneForCounty(st, slug, { lat });
        expect(z.decided, `${k}@${lat}`).toBe(true);
        expect(z.decisionNote, `${k}@${lat}`).toMatch(GAP);
      }
    }
  });

  it("the ONLY decided rows are the ones the audit lists (a new decision is a deliberate, documented act)", () => {
    const decided = new Set([...Object.entries(COUNTY_ZONE).filter(([, v]) => v.decided).map(([k]) => k), ...Object.keys(DECIDED_COUNTIES), ...Object.keys(SPLIT_COUNTIES)]);
    // Carson City (NRS 327.010(2)) and the 23 Virginia independent cities (Va. Code 1-601) are NAMED by their statutes, so they are plain table
    // rows now (B2494337 NEW-3); Billings County, ND is the one statute-silent county the generator carries.
    expect([...decided].sort()).toEqual(["CO:broomfield", "ND:billings", "WA:grant", ...Object.keys(DECIDED_COUNTIES).filter((k) => /^HI:/.test(k))].sort());
    expect(decided.has("TX:montgomery")).toBe(false);
  });
});

import { COUNTY_TABLE } from "../src/shared/coordinates/statePlaneCounties.js";
function zoneForCountyFromTable(st, slug) {
  for (const [zid, list] of Object.entries(COUNTY_TABLE[st] || {})) if (list.split(",").includes(slug)) return zid;
  return null;
}
