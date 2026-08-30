import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, countyIdentity, countyKeyForName, noParcelSourceNote,
  candidateCountiesForPoint, STATEWIDE_KEYS, STATEWIDE_PARCEL_LAYER,
} from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

/* B853712 — THE STATEWIDE-DERIVED TIER: all 254 Texas counties get a real parcel source (the
 * universal TxGIO statewide layer, exactly the shape Waller already uses) DERIVED at runtime from
 * the same `county-polygons.json` asset the geometry resolver already fetches — never 254
 * hand-typed literal rows. This suite runs against the REAL committed asset (not a fixture), which
 * is itself the honest test: if the asset's shape ever drifts, this is what would catch it, not a
 * synthetic stand-in that agrees with the code by construction.
 *
 * Isolated in its own file (rather than added to counties.test.js) because it deliberately WARMS
 * the county-polygons module singleton via `setCountyPolygons` — counties.test.js's own "reports
 * pending before the geometry is resident" test depends on that singleton staying cold, and vitest
 * gives each test FILE its own module registry, so the two suites can't interfere with each other. */

let payload;
beforeAll(async () => {
  payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
  await setCountyPolygons(payload);
});

describe("statewide derivation — a Texas county with no dialed-in row (B853712)", () => {
  // The 19 counties within 50 miles of downtown Dallas, plus a spread sample well outside that
  // radius (Panhandle / border / Piney Woods / Gulf coast) — proving the derivation is a property
  // of the mechanism, not something that only happens to work for the counties it was written for.
  const DFW_19 = [
    ["dallas", "Dallas", 32.693167, -96.766833],
    ["collin", "Collin", 33.249556, -96.505278],
    ["denton", "Denton", 33.301778, -97.046722],
    ["kaufman", "Kaufman", 32.469639, -96.4469],
    ["rockwall", "Rockwall", 32.9235, -96.371],
    ["tarrant", "Tarrant", 32.840875, -97.272312],
    ["ellis", "Ellis", 32.423037, -96.486407],
    ["johnson", "Johnson", 32.199984, -97.512859],
    ["hunt", "Hunt", 32.917808, -95.967205],
    ["henderson", "Henderson", 32.218865, -95.985276],
    ["wise", "Wise", 33.257083, -97.56575],
    ["hill", "Hill", 31.973128, -97.355061],
    ["navarro", "Navarro", 32.196171, -96.212512],
    ["vanzandt", "Van Zandt", 32.68039, -95.710936],
    ["grayson", "Grayson", 33.818807, -96.674836],
    ["parker", "Parker", 32.828, -97.801429],
    ["cooke", "Cooke", 33.6357, -97.1336],
    ["fannin", "Fannin", 33.805524, -96.096716],
    ["rains", "Rains", 32.788747, -95.819877],
  ];
  const SPREAD_SAMPLE = [
    ["hartley", "Hartley", 35.85, -102.55],   // Panhandle
    ["webb", "Webb", 27.55, -99.49],          // Border (Laredo)
    ["nacogdoches", "Nacogdoches", 31.60, -94.66], // Piney Woods
    ["calhoun", "Calhoun", 28.45, -96.60],    // Gulf coast
  ];

  it.each(DFW_19)("%s (%s) resolves to a real parcel source via geometry", (key, name, lat, lng) => {
    const id = countyIdentity(lat, lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe(key);
    expect(id.name).toBe(name);
    expect(id.state).toBe("TX");
    expect(noParcelSourceNote(id)).toBeNull(); // never the "no parcel data wired here yet" message
  });

  it.each(SPREAD_SAMPLE)("%s (%s), a county nowhere near Dallas, also derives", (key, name, lat, lng) => {
    const id = countyIdentity(lat, lng);
    expect(id.status).toBe("ok");
    expect(id.key).toBe(key);
    expect(noParcelSourceNote(id)).toBeNull();
  });

  it("a derived county's COUNTIES_MAP row rides the universal TxGIO layer, flagged as derived", () => {
    const m = COUNTIES_MAP.dallas;
    expect(m.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(m.state).toBe("TX");
    expect(m.statewideDerived).toBe(true);
    expect(m.bbox).toHaveLength(4);
    const [minLat, minLng, maxLat, maxLng] = m.bbox;
    expect(minLat).toBeLessThan(maxLat);
    expect(minLng).toBeLessThan(maxLng);
  });

  it("a derived county's COUNTIES row carries a scopeWhere naming ITS OWN county, not another's", () => {
    const c = COUNTIES.dallas;
    expect(c.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(c.scopeWhere).toBe("county='DALLAS'");
    expect(c.idField).toBe("prop_id");
    expect(c.addrField).toBe("situs_addr");
    expect(c.statewideDerived).toBe(true);
  });

  it("Van Zandt's scopeWhere carries the space TxGIO's own `county` column uses", () => {
    // Routing KEYS strip whitespace ("vanzandt"); the county's real name, used in the where-clause
    // and the display label, keeps it.
    expect(COUNTIES.vanzandt.scopeWhere).toBe("county='VAN ZANDT'");
    expect(COUNTIES.vanzandt.label).toBe("Van Zandt County");
  });

  it("countyKeyForName resolves a derived county's real name to its derived key", () => {
    expect(countyKeyForName("Dallas", "TX")).toBe("dallas");
    expect(countyKeyForName("Van Zandt", "TX")).toBe("vanzandt");
    expect(countyKeyForName("Hartley", "TX")).toBe("hartley");
  });
});

describe("the dialed-in tier is never shadowed by the derived tier (owner instruction, B853712)", () => {
  const DIALED_IN = ["harris", "fortbend", "chambers", "waller", "montgomery", "brazoria", "galveston", "liberty", "austintx"];

  it.each(DIALED_IN)("%s keeps its own literal row — never marked statewideDerived", (key) => {
    expect(COUNTIES_MAP[key].statewideDerived).toBeUndefined();
    expect(COUNTIES[key].statewideDerived).toBeUndefined();
  });

  it("Harris's own HCAD endpoint wins over the statewide layer — the derivation never overwrites it", () => {
    expect(COUNTIES_MAP.harris.layerUrl).not.toBe(STATEWIDE_PARCEL_LAYER);
    expect(COUNTIES_MAP.harris.layerUrl).toMatch(/gis\.hctx\.net/);
  });

  it("a promoted county's geometry resolution returns its DIALED-IN key, not a re-derived one", () => {
    const id = countyIdentity(29.76, -95.37); // inside Harris
    expect(id.status).toBe("ok");
    expect(id.key).toBe("harris");
  });

  it("Austin COUNTY's real name aliases to the existing `austintx` key, never a colliding `austin` key", () => {
    expect(countyKeyForName("Austin", "TX")).toBe("austintx");
    expect(COUNTIES_MAP.austin).toBeUndefined(); // the derivation must not mint a shadow key here
    expect(COUNTIES_MAP.austintx.statewideDerived).toBeUndefined();
  });
});

describe("the derivation changes nothing about enumeration or the statewide pseudo-keys", () => {
  it("STATEWIDE_KEYS is still just the two universal pseudo-keys — derived counties are real counties, not fallback keys", () => {
    expect(STATEWIDE_KEYS).toEqual(["txgio_statewide", "co_statewide"]);
  });

  it("Object.keys(COUNTIES_MAP) still enumerates only the literal, dialed-in rows", () => {
    const keys = Object.keys(COUNTIES_MAP);
    expect(keys).not.toContain("dallas");
    expect(keys.length).toBeLessThan(25); // the ~18 dialed-in TX+CO rows + the 2 pseudo-keys, not 254
  });

  it("candidateCountiesForPoint still answers via the existing txgio_statewide fallback for a derived county — unchanged, not doubled", () => {
    const cand = candidateCountiesForPoint(32.693167, -96.766833); // Dallas
    expect(cand).toContain("txgio_statewide");
    // The derived key itself is never inserted into the candidate list — it would just re-query the
    // identical TxGIO endpoint under a second name. Click routing already reaches Dallas parcels
    // through the unscoped statewide entry (proven live in ui-audit/verify-dallas-metro-parcels.mjs).
    expect(cand).not.toContain("dallas");
  });
});

describe("a point genuinely outside Texas and Colorado still reports honestly", () => {
  it("New York City resolves to `outside`, never a guessed derivation", () => {
    expect(countyIdentity(40.7128, -74.006).status).toBe("outside");
  });
});
