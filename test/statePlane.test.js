/* NEW-3 / NEW-4 — multi-zone state plane + the grid/ground scale factor.
 *
 * The load-bearing test in this file is the FIRST one: the generic Lambert engine reproduces the
 * hardcoded EPSG:2278 implementation BIT-FOR-BIT (Object.is on the raw doubles, not toBeCloseTo).
 * That is what makes "Colorado is additive, Texas is unchanged" a proof rather than a claim — and
 * it is why statePlane.js repeats the formulas in the same operation order instead of index.js
 * being refactored to call it.
 */
import { describe, it, expect } from "vitest";
import { projectToGrid, gridToProject } from "../src/shared/coordinates/index.js";
import {
  SP_ZONES, COUNTY_ZONE, projectToZone, zoneToProject, zoneForCounty, zoneForPoint,
  resolveZone, gridScaleFactor, zoneById,
} from "../src/shared/coordinates/statePlane.js";
import {
  combinedScaleFactor, elevationFactor, earthRadiusFt, detectSurveyFrame, MATERIAL_THRESHOLD,
} from "../src/shared/coordinates/scaleFactor.js";

const TX = [
  [29.7604, -95.3698],   // downtown Houston
  [29.5994, -95.6142],   // Sugar Land
  [29.7355, -94.6816],   // Anahuac
  [30.0000, -95.8600],   // Waller
  [27.9000, -97.1000],   // Corpus-ish — near the zone's south edge
  [31.0000, -94.0000],   // deep east, well off the central meridian
];

describe("NEW-3 · the generic engine reproduces EPSG:2278 exactly", () => {
  it("projectToZone(tx_sc) === projectToGrid, bit for bit", () => {
    for (const [lat, lon] of TX) {
      const a = projectToGrid(lat, lon);
      const b = projectToZone("tx_sc", lat, lon);
      expect(Object.is(a.x, b.x), `x moved at ${lat},${lon}: ${a.x} vs ${b.x}`).toBe(true);
      expect(Object.is(a.y, b.y), `y moved at ${lat},${lon}: ${a.y} vs ${b.y}`).toBe(true);
    }
  });

  it("zoneToProject(tx_sc) === gridToProject, bit for bit", () => {
    for (const [lat, lon] of TX) {
      const g = projectToGrid(lat, lon);
      const a = gridToProject(g);
      const b = zoneToProject("tx_sc", g);
      expect(Object.is(a.lat, b.lat)).toBe(true);
      expect(Object.is(a.lon, b.lon)).toBe(true);
    }
  });
});

describe("NEW-3 · Colorado zones", () => {
  // Round-trip accuracy is the honest correctness check for a projection we cannot diff against
  // a reference implementation offline.
  const CO = [
    [39.7392, -104.9903], // Denver
    [40.5853, -105.0844], // Fort Collins (Larimer)
    [40.4233, -104.7091], // Greeley (Weld)
    [38.8339, -104.8214], // Colorado Springs (El Paso)
    [39.9205, -105.0867], // Broomfield
    [40.0150, -105.2705], // Boulder
  ];
  it("round-trips to better than a hundredth of a foot", () => {
    for (const zone of ["co_north", "co_central"]) {
      for (const [lat, lon] of CO) {
        const g = projectToZone(zone, lat, lon);
        const back = zoneToProject(zone, g);
        const g2 = projectToZone(zone, back.lat, back.lon);
        expect(Math.abs(g2.x - g.x)).toBeLessThan(0.01);
        expect(Math.abs(g2.y - g.y)).toBeLessThan(0.01);
      }
    }
  });

  it("lands Denver inside the published Colorado Central coordinate range", () => {
    // Colorado Central's false origin is 3,000,000 E / 1,000,000 N ftUS, and Denver sits east of
    // the 105°30' central meridian and well north of the 37°50' origin latitude. A coordinate
    // outside these bounds means the zone constants are wrong, which a round trip cannot catch.
    const d = projectToZone("co_central", 39.7392, -104.9903);
    expect(d.x).toBeGreaterThan(3_100_000);
    expect(d.x).toBeLessThan(3_200_000);
    expect(d.y).toBeGreaterThan(1_650_000);
    expect(d.y).toBeLessThan(1_720_000);
  });

  it("puts the standard parallels at exactly unit grid scale", () => {
    for (const id of ["tx_sc", "co_north", "co_central"]) {
      const z = SP_ZONES[id];
      expect(gridScaleFactor(id, z.lat1)).toBeCloseTo(1, 12);
      expect(gridScaleFactor(id, z.lat2)).toBeCloseTo(1, 12);
      // Between the parallels the cone cuts inside the ellipsoid → scale below 1.
      expect(gridScaleFactor(id, (z.lat1 + z.lat2) / 2)).toBeLessThan(1);
    }
  });
});

describe("NEW-3 · zone resolution is per site, not per app", () => {
  it("assigns the nine Colorado counties per C.R.S. 38-52-101", () => {
    const north = ["Larimer", "Weld", "Boulder", "Adams"];
    const central = ["Denver", "Arapahoe", "Jefferson", "El Paso"];
    for (const c of north) expect(zoneForCounty("CO", c).epsg, c).toBe(2231);
    for (const c of central) expect(zoneForCounty("CO", c).epsg, c).toBe(2232);
  });

  it("assigns Broomfield to North as a DECIDED assignment, carrying its reasoning", () => {
    const z = zoneForCounty("CO", "Broomfield");
    expect(z.epsg).toBe(2231);
    expect(z.decided).toBe(true);
    expect(z.decisionNote).toMatch(/38-52-101/);
    expect(z.decisionNote).toMatch(/2876/);        // the county's own service's SR — the evidence
    // Every other county is a statute read, never a decision.
    for (const c of ["Adams", "Denver", "Weld", "El Paso"]) expect(zoneForCounty("CO", c).decided).toBe(false);
  });

  it("keeps every Texas county on the app's original zone", () => {
    for (const c of ["Harris", "Fort Bend", "Chambers", "Waller", "Montgomery"]) {
      expect(zoneForCounty("TX", c).epsg, c).toBe(2278);
    }
  });

  it("normalises county spellings the app actually receives", () => {
    for (const s of ["El Paso", "el paso", "EL PASO COUNTY", "El Paso County"]) {
      expect(zoneForCounty("CO", s).id, s).toBe("co_central");
    }
    expect(zoneForCounty("CO", "City and County of Denver").id).toBe("co_central");
  });

  it("returns an honest null rather than a plausible wrong zone", () => {
    expect(zoneForCounty("CO", "Mesa")).toBeNull();          // real county, not assigned here
    expect(zoneForCounty("NM", "Bernalillo")).toBeNull();    // state we do not serve
    expect(zoneForPoint(45.5, -122.6)).toBeNull();           // Portland
    expect(resolveZone({ lat: NaN, lon: NaN })).toBeNull();
  });

  it("prefers the county answer over the coarse extent (zone lines follow county lines)", () => {
    // The interleave that no latitude split can resolve: Jefferson is CENTRAL but reaches north to
    // 39.91, so the coarse envelope answers "north" there and is wrong. Only the county answer is
    // right — and the coarse one is stamped `coarse:true` so a surface never presents it as settled.
    const coarse = zoneForPoint(39.85, -105.2);
    expect(coarse.id).toBe("co_north");
    expect(coarse.coarse).toBe(true);
    expect(resolveZone({ state: "CO", county: "Jefferson", lat: 39.85, lon: -105.2 }).id).toBe("co_central");
    expect(resolveZone({ state: "CO", county: "Broomfield", lat: 39.9205, lon: -105.0867 }).id).toBe("co_north");
    // Arapahoe sits in the Central envelope AND is a Central county — agreement, via county.
    const a = resolveZone({ state: "CO", county: "Arapahoe", lat: 39.65, lon: -104.8 });
    expect(a.id).toBe("co_central");
    expect(a.via).toBe("county");
  });

  it("falls back to the state envelope for an unassigned county, and flags it", () => {
    const r = resolveZone({ state: "CO", county: "Douglas", lat: 39.3, lon: -104.9 });
    expect(r.id).toBe("co_central");
    expect(r.unassignedCounty).toBe("Douglas");
  });

  it("exposes exactly the three zones the product serves", () => {
    expect(Object.keys(SP_ZONES).sort()).toEqual(["co_central", "co_north", "tx_sc"]);
    expect(zoneById("tx_sc").epsg).toBe(2278);
    expect(zoneById("nope")).toBeNull();
    // Every county assignment points at a real zone.
    for (const [k, v] of Object.entries(COUNTY_ZONE)) expect(SP_ZONES[v.zone], k).toBeTruthy();
  });
});

describe("NEW-4 · combined scale factor", () => {
  it("reproduces the Front Range figure the owner verified: ~1.3 ft per mile at Denver", () => {
    const r = combinedScaleFactor({ state: "CO", county: "Denver", lat: 39.7392, lon: -104.9903, elevationFt: 5280 });
    expect(r.known).toBe(true);
    expect(r.combined).toBeGreaterThan(0.9997);
    expect(r.combined).toBeLessThan(0.99985);
    expect(r.perMileFt).toBeGreaterThan(1.0);
    expect(r.perMileFt).toBeLessThan(1.7);
    // Nine inches across a 3,000-ft site.
    expect(r.deltaOver(3000)).toBeGreaterThan(0.5);
    expect(r.deltaOver(3000)).toBeLessThan(1.1);
    expect(r.material).toBe(true);
  });

  it("shows why Texas never noticed: Houston's elevation factor is effectively 1", () => {
    const r = combinedScaleFactor({ state: "TX", county: "Harris", lat: 29.7604, lon: -95.3698, elevationFt: 50 });
    expect(r.known).toBe(true);
    expect(r.elevationFactor).toBeGreaterThan(0.999997);
    expect(Math.abs(r.perMileFt)).toBeLessThan(0.6);   // dominated by grid scale, not elevation
    expect(Math.abs(1 - r.elevationFactor)).toBeLessThan(MATERIAL_THRESHOLD);
  });

  it("says what is missing instead of returning a plausible 1.0", () => {
    const r = combinedScaleFactor({ state: "CO", county: "Denver", lat: 39.74, lon: -104.99 });
    expect(r.known).toBe(false);
    expect(r.combined).toBeNull();
    expect(r.missing).toContain("site elevation");
    const noZone = combinedScaleFactor({ lat: 45.5, lon: -122.6, elevationFt: 50 });
    expect(noZone.known).toBe(false);
    expect(noZone.missing).toContain("state plane zone");
  });

  it("applies geoid separation when given, and says when it was not", () => {
    const withSep = elevationFactor({ elevationFt: 5280, lat: 39.74, geoidSeparationFt: -56 });
    const without = elevationFactor({ elevationFt: 5280, lat: 39.74 });
    expect(withSep.geoidApplied).toBe(true);
    expect(without.geoidApplied).toBe(false);
    expect(withSep.factor).toBeGreaterThan(without.factor);   // lower ellipsoid height → less reduction
    expect(earthRadiusFt(39.74)).toBeGreaterThan(20_000_000);
    expect(earthRadiusFt(39.74)).toBeLessThan(21_500_000);
  });
});

describe("NEW-4 · ground-vs-grid survey detection", () => {
  const denver = combinedScaleFactor({ state: "CO", county: "Denver", lat: 39.7392, lon: -104.9903, elevationFt: 5280 });

  it("calls a grid survey grid", () => {
    const r = detectSurveyFrame({ pairs: [{ surveyFt: 2000, gridFt: 2000 }, { surveyFt: 3500.02, gridFt: 3500 }], expectedCombined: denver.combined });
    expect(r.verdict).toBe("grid");
  });

  it("calls a ground survey ground", () => {
    const k = denver.combined;
    const r = detectSurveyFrame({
      pairs: [{ surveyFt: 2000 / k, gridFt: 2000 }, { surveyFt: 3500 / k, gridFt: 3500 }],
      expectedCombined: k,
    });
    expect(r.verdict).toBe("ground");
    expect(r.perMileFt).toBeGreaterThan(1);
    expect(r.consistent).toBe(true);
  });

  it("refuses to force an odd project factor into either bucket", () => {
    const r = detectSurveyFrame({ pairs: [{ surveyFt: 2000 * 1.0004, gridFt: 2000 }], expectedCombined: denver.combined });
    expect(r.verdict).toBe("other-scale");
    expect(r.reason).toMatch(/survey sheet/);
  });

  it("reports unknown with no pairs rather than guessing", () => {
    const r = detectSurveyFrame({ pairs: [], expectedCombined: denver.combined });
    expect(r.verdict).toBe("unknown");
    expect(r.samples).toBe(0);
  });
});
