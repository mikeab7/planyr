import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { identifyJurisdiction, formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { buildGovernsModel } from "../src/workspaces/site-planner/lib/siteGoverns.js";
import { governingCityOf } from "../src/workspaces/site-planner/lib/jurisdictionLabel.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CONCEPT A (owner, 2026-10-28) — "it says Houston ETJ but then also says City of Sugar Land, and it can't be both."
 *
 * An ETJ is the ground OUTSIDE every city's limits (Local Gov't Code ch. 42), so a site a city holds has no ETJ. The header printed
 * both because the ETJ dedupe only removed the SAME city's ETJ; Houston's ETJ polygon over ground inside Sugar Land's limits survived
 * it. Measured live 2026-10-28, four sources: TxGIO and Fort Bend CAD agree on Sugar Land's limits; H-GAC and Houston's own planning
 * layer agree on Houston's ETJ; and the two cover the same ground over ~8% of the area around the site (a band north of the airport).
 *
 * The fixture is the REAL published polygons cut to a window around the site (see its `note`). The sites are three small boxes whose
 * ground truth was measured on the live layers: one wholly inside the overlap band, one that genuinely straddles the limits, one in
 * the ETJ only. ⛔ DO NOT "fix" an expectation to make a change pass — they are the measured truth.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const FIX = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/etjCityOverlapSugarLand.json"), "utf8"));
const box = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const BAND = [-95.6700, 29.6235, -95.6640, 29.6275];      // 100% Sugar Land limits AND 100% Houston ETJ polygon (measured)
const STRADDLE = [-95.6760, 29.6160, -95.6690, 29.6205];  // 74% limits; ~24% Houston ETJ outside the limits (measured)
const ETJ_ONLY = [-95.6900, 29.6200, -95.6830, 29.6240];  // Houston ETJ only
const ORIGIN = [-95.6693177, 29.6122132];                 // Concept A's origin: inside the limits, in no ETJ polygon

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });

/* `etj`/`city` say which polygons the (fake) services return for the query — a real service filters by geometry, so a case that is
 * outside a polygon simply does not serve it. `cityDown` makes the city layer fail the way an outage does. */
function fakeFetch({ city = true, etj = true, cityDown = false }) {
  const fn = async (url) => {
    fn.urls.push(url);
    if (url.includes("Texas_City_Boundaries")) {
      if (cityDown) throw new Error("city layer down");
      return { features: city ? [FIX.city] : [] };
    }
    if (url.includes("HGAC_City_ETJ")) return { features: etj ? [FIX.etjHouston] : [] };
    if (url.includes("Texas_County_Boundaries")) return { features: [{ attributes: { CNTY_NM: "Fort Bend" } }] };
    throw new Error("no route for " + url);
  };
  fn.urls = [];
  return fn;
}

async function run({ b, pt, ...serve }) {
  const ring = b ? box(b) : null;
  const [lng, lat] = pt || [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const j = await identifyJurisdiction(lng, lat, ring
    ? { ring, rings: [ring], roles: ["county", "city", "etj"], cache: freshCache(), fetchJson: fakeFetch(serve) }
    : { roles: ["county", "city", "etj"], cache: freshCache(), fetchJson: fakeFetch(serve) });
  return { j, b: formatJurisdictionBadge(j) };
}

describe("Concept A — city limits outrank another city's ETJ", () => {
  it("RED PROOF · a site wholly inside Sugar Land's limits AND under Houston's ETJ polygon reads City of Sugar Land only", async () => {
    const { j, b } = await run({ b: BAND });
    expect(j.cityAll).toEqual(["Sugar Land"]);
    // On main this read "City of Sugar Land · Houston ETJ · Fort Bend County" (shape in-city-etj).
    expect(b.text).toBe("City of Sugar Land · Fort Bend County");
    expect(b.shape).toBe("in-city");
    expect(b.etjLabels).toEqual([]);
    expect(j.etj).toEqual([]);
  });

  it("…and the overlap is DISCLOSED, not silently resolved — named, with the measured share", async () => {
    const { j, b } = await run({ b: BAND });
    expect(j.etjNetted).toBe(true);                       // the area pass netted the ETJ against the limits
    expect(j.etjCityOverlap).toHaveLength(1);
    expect(j.etjCityOverlap[0].name).toBe("Houston");
    expect(j.etjCityOverlap[0].share).toBeGreaterThan(0.99);   // ~all of the site is ground both layers claim
    expect(b.etjOverlap).toEqual(["Houston"]);
    expect(b.etjOverlapNote).toMatch(/Houston's ETJ layer also covers part of this ground/);
    expect(b.etjOverlapNote).toMatch(/limits govern/);
  });

  it("a bare POINT (no ring to measure) in the overlap band gets the same answer, by the whole-site-in-a-city floor", async () => {
    const { j, b } = await run({ pt: [-95.667, 29.6255] });
    expect(j.cityContainment).toBe("in");
    expect(b.text).toBe("City of Sugar Land · Fort Bend County");
    expect(b.etjLabels).toEqual([]);
    expect(b.etjOverlap).toEqual(["Houston"]);
  });

  it("Concept A's own origin: inside the limits, in no ETJ polygon — nothing to disclose", async () => {
    const { b } = await run({ pt: ORIGIN, etj: false });
    expect(b.text).toBe("City of Sugar Land · Fort Bend County");
    expect(b.etjOverlap).toEqual([]);
    expect(b.etjOverlapNote).toBe(null);
  });

  it("when the city layer is DOWN the ring still reads city-only (the floor), never the contradiction", async () => {
    // City-limits answer unavailable → no area share for the city, so containment is unknown → the lead is the honest "couldn't check".
    const { b } = await run({ b: BAND, cityDown: true });
    expect(b.text).not.toMatch(/Sugar Land.*Houston ETJ/);
    expect(b.shape).toBe("unknown");
  });

  it("a site that GENUINELY straddles the limits keeps the Houston ETJ for the part outside them", async () => {
    const { j, b } = await run({ b: STRADDLE });
    expect(b.shape).toBe("split");
    expect(b.partialCities).toEqual(["Sugar Land"]);
    expect(b.citySharePct).toBeGreaterThan(0.70);
    expect(b.citySharePct).toBeLessThan(0.78);
    expect(b.text).toContain("rest in Houston ETJ");
    expect(b.etjLabels).toEqual(["Houston"]);               // the floodplain administrator still sees the ETJ that governs the rest
    expect(j.etjNetted).toBe(true);
  });

  it("a site in Houston's ETJ only is unchanged", async () => {
    const { b } = await run({ b: ETJ_ONLY, city: false });
    expect(b.text).toBe("City of Houston ETJ · Fort Bend County");
    expect(b.shape).toBe("etj");
    expect(b.etjOverlap).toEqual([]);
  });
});

describe("Concept A — every consumer reads the one answer", () => {
  it("Site Analysis 'Who governs' says Sugar Land, no ETJ, and carries the overlap note", async () => {
    const { b } = await run({ b: BAND });
    const gov = buildGovernsModel(b, null);
    expect(gov.city.text).toBe("Sugar Land");
    expect(gov.city.text).not.toMatch(/ETJ/);
    expect(gov.city.note).toMatch(/Houston ETJ layer overlaps these limits/);
    expect(gov.county).toBe("Fort Bend County");
  });

  it("the floodplain administrator's inputs: Sugar Land is the city, and NO Houston ETJ candidate is raised", async () => {
    const { b } = await run({ b: BAND });
    expect(governingCityOf(b)).toBe("Sugar Land");
    expect(b.etjLabels).toEqual([]);                        // SitePlanner hands etjLabels[0] to assessAdministrator
  });
});

describe("generic — not a Sugar Land special case", () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];   // clockwise = an ESRI outer ring
  async function synthetic({ cityName, etjCity, ring, cityServed = true }) {
    const big = { rings: [sq(-95.30, 29.30, -95.10, 29.50)] };
    const cityPoly = { rings: [sq(-95.22, 29.38, -95.18, 29.42)] };      // a small city sitting under the big city's ETJ polygon
    const fetchJson = async (url) => {
      if (url.includes("Texas_City_Boundaries")) return { features: cityServed ? [{ attributes: { city_name: cityName }, geometry: cityPoly }] : [] };
      if (url.includes("HGAC_City_ETJ")) return { features: [{ attributes: { CITY: etjCity }, geometry: big }] };
      if (url.includes("Texas_County_Boundaries")) return { features: [{ attributes: { CNTY_NM: "Harris" } }] };
      throw new Error("no route " + url);
    };
    const j = await identifyJurisdiction(-95.20, 29.40, { ring, rings: [ring], roles: ["county", "city", "etj"], cache: freshCache(), fetchJson });
    return { j, b: formatJurisdictionBadge(j) };
  }

  it("any city wholly inside any other city's ETJ polygon reads that city alone (Humble-in-Houston shape)", async () => {
    const { b } = await synthetic({ cityName: "Humble", etjCity: "HOUSTON", ring: sq(-95.21, 29.39, -95.19, 29.41) });
    expect(b.text).toBe("City of Humble · Harris County");
    expect(b.etjOverlap).toEqual(["Houston"]);
  });

  it("the same ETJ polygon with a site OUTSIDE the small city's limits is still that city's ETJ", async () => {
    const { b } = await synthetic({ cityName: "Humble", etjCity: "HOUSTON", ring: sq(-95.28, 29.32, -95.26, 29.34), cityServed: false });   // a real service filters by geometry
    expect(b.text).toBe("City of Houston ETJ · Harris County");
  });

  it("a city that merely shares its own name with the ETJ polygon is still deduped, not reported as an overlap", async () => {
    const { b } = await synthetic({ cityName: "Houston", etjCity: "HOUSTON", ring: sq(-95.21, 29.39, -95.19, 29.41) });
    expect(b.text).toBe("City of Houston · Harris County");
    expect(b.etjOverlap).toEqual([]);
  });
});
