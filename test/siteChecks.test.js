import { describe, it, expect } from "vitest";
import {
  TRUSTED_CHECKS, CHECK_THRESHOLDS, NEAR_RADIUS_MI, siteRegions, isTrustedFor, inTexas, trustRegionOf,
  measureFlood, measureWetlands, measureProximity, measureWells, measurePipelines,
  severityFlood100, severityFlood500, severityWetlands, severityPipelines, severityWells,
  buildFlood100Row, buildFlood500Row, buildWetlandsRow, buildPipelinesRow, buildWellsRow,
  titleCaseName, fmtApproxFt, freshnessOf, ageWords, rowFromMeasurement,
} from "../src/workspaces/site-planner/lib/siteChecks.js";
import { statesFor } from "../src/shared/gis/sources.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

/* ── fixtures: a 1000 ft × 1000 ft site near Baytown, TX, built in lng/lat ─────────────────────────
 * 1° lat ≈ 364,567 ft; 1° lng ≈ 364,567·cos(lat). Areas are read back through the real EPSG:2278 grid,
 * so fractions are asserted to a tolerance, never to the digit. */
const LAT0 = 29.80, LNG0 = -95.00;
const FT_LAT = 364567, FT_LNG = 364567 * Math.cos((LAT0 * Math.PI) / 180);
// a rectangle at (x0,y0)…(x1,y1) feet from the site's SW corner, as a lng/lat ring (CCW)
const rect = (x0, y0, x1, y1, lng = LNG0, lat = LAT0) => {
  const p = (x, y) => [lng + x / FT_LNG, lat + y / FT_LAT];
  return [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];
};
const SITE = [rect(0, 0, 1000, 1000)];
const SITE_SQFT = 1_000_000;
const near = (a, b, tol = 0.012) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const flood = (ring, zone, subtype = "") => ({ rings: [ring], zone, subtype });

describe("region gate — trust by LOCATION, strictest reading on a straddle", () => {
  const rrc = TRUSTED_CHECKS.filter((c) => c.regions !== "all");
  it("FEMA + NWI are trusted everywhere; RRC wells + pipelines are Texas-only", () => {
    expect(TRUSTED_CHECKS.filter((c) => c.regions === "all").map((c) => c.id).sort()).toEqual(["flood100", "flood500", "wetlands"]);
    expect(rrc.map((c) => c.id).sort()).toEqual(["pipelines", "wells"]);
    for (const c of rrc) expect(c.regions).toEqual(["TX"]);
  });
  it("agrees with the GIS registry's own state scope (one fact, two homes, cannot drift)", () => {
    for (const c of TRUSTED_CHECKS) {
      const scope = statesFor(GIS_SOURCES[c.source]);
      if (c.regions === "all") expect(scope).toBeNull();
      else expect(scope).toEqual(c.regions);
    }
  });
  it("a Houston-area site is Texas; Denver is Colorado; Atlanta is Georgia", () => {
    expect(siteRegions(SITE).single).toBe("TX");
    expect(siteRegions([rect(0, 0, 500, 500, -104.99, 39.74)]).single).toBe("CO");
    expect(siteRegions([rect(0, 0, 500, 500, -84.39, 33.75)]).single).toBe("GA");
  });
  it("RRC checks are NOT trusted in Colorado or Georgia, FEMA/NWI still are", () => {
    for (const lngLat of [[-104.99, 39.74], [-84.39, 33.75]]) {
      const reg = siteRegions([rect(0, 0, 500, 500, ...lngLat)]).regions;
      for (const c of TRUSTED_CHECKS) expect(isTrustedFor(c, reg)).toBe(c.regions === "all");
    }
  });
  it("the Texas BOX is not trusted for the RRC: Shreveport, Roswell and Lawton fall inside the box but outside Texas", () => {
    for (const [lng, lat] of [[-93.75, 32.5], [-104.5, 33.4], [-98.4, 34.62], [-103.1, 32.7]]) {
      expect(inTexas(lat, lng), `${lng},${lat}`).toBe(false);
      expect(trustRegionOf(lat, lng), `${lng},${lat}`).toBeNull();
      const reg = siteRegions([rect(0, 0, 500, 500, lng, lat)]).regions;
      expect(isTrustedFor(rrc[0], reg)).toBe(false);
    }
  });
  it("real Texas ground reads Texas: Houston, Dallas, Austin, San Antonio, Lubbock, Corpus Christi, Orange, Galveston", () => {
    for (const [lng, lat] of [[-95.37, 29.76], [-96.8, 32.78], [-97.74, 30.27], [-98.49, 29.42], [-101.85, 33.58], [-97.4, 27.8], [-93.7366, 30.0927], [-94.8, 29.3]]) {
      expect(inTexas(lat, lng), `${lng},${lat}`).toBe(true);
    }
  });
  it("a site that STRADDLES Texas and Colorado gets no RRC verdict (strictest reading)", () => {
    const straddle = [rect(0, 0, 500, 500), rect(0, 0, 500, 500, -104.99, 39.74)];
    const reg = siteRegions(straddle);
    expect(reg.single).toBeNull();
    expect(reg.regions.sort()).toEqual(["CO", "TX"]);
    for (const c of rrc) expect(isTrustedFor(c, reg.regions)).toBe(false);
    expect(isTrustedFor(TRUSTED_CHECKS[0], reg.regions)).toBe(true);
  });
  it("a Texas parcel that touches Louisiana loses the RRC verdict too", () => {
    const edge = [[-93.9, 31.0], [-93.5, 31.0], [-93.5, 31.2], [-93.9, 31.2]]; // spans the Sabine
    const reg = siteRegions([edge]);
    expect(rrc.every((c) => !isTrustedFor(c, reg.regions))).toBe(true);
  });
  it("an empty site is never trusted", () => {
    expect(isTrustedFor(TRUSTED_CHECKS[0], [])).toBe(false);
    expect(isTrustedFor(rrc[0], [])).toBe(false);
  });
});

describe("flood — AREA fractions on the real rings", () => {
  it("a 500 ft strip across a 1000 ft site is ~50% and red; the right ring reads the west side", () => {
    const m = measureFlood(SITE, [], [flood(rect(-100, -100, 500, 1100), "AE")]);
    near(m.siteSqft / SITE_SQFT, 1, 0.01);
    near(m.sfhaFrac, 0.5);
    expect(m.sfhaSide).toBe("west side");
    expect(severityFlood100(m)).toBe("red");
    const row = buildFlood100Row(m);
    expect(row.figure).toBe("50%");
    expect(row.line).toContain("Zone AE");
    expect(row.link.id).toBe("drainage");
  });
  it("honours the SITE's holes: a 200×200 save-and-except inside the floodplain comes out of the denominator and the numerator", () => {
    const hole = rect(100, 400, 300, 600);
    const m = measureFlood(SITE, [hole], [flood(rect(-100, -100, 500, 1100), "AE")]);
    near(m.siteSqft / SITE_SQFT, 0.96, 0.01);
    near(m.sfhaFrac, (500_000 - 40_000) / (1_000_000 - 40_000)); // 0.4792, NOT 0.5 and not 0.46
  });
  it("honours the FEMA polygon's own interior ring (a hole in the floodplain is not floodplain)", () => {
    const outer = rect(0, 0, 1000, 1000), inner = rect(250, 250, 750, 750).reverse(); // opposite winding = hole
    const m = measureFlood(SITE, [], [{ rings: [outer, inner], zone: "AE", subtype: "" }]);
    near(m.sfhaFrac, 0.75); // 1 − 0.25
  });
  it("0.2% shaded X is amber, measured on its own: and an AE area that shaded X also covers is NOT double-counted", () => {
    const features = [
      flood(rect(-100, -100, 500, 1100), "AE"),                       // 100-yr over the west 500 ft
      flood(rect(-100, -100, 1100, 1100), "X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"), // shaded X over the WHOLE site, overlapping the AE
    ];
    const m = measureFlood(SITE, [], features);
    near(m.sfhaFrac, 0.5);
    near(m.shadedFrac, 0.5); // only the east half is 500-yr-ONLY; 0.5 + 0.5 = 1.0, never 1.5
    expect(m.sfhaFrac + m.shadedFrac).toBeLessThanOrEqual(1.0 + 0.01);
    expect(severityFlood100(m)).toBe("red");
    expect(severityFlood500(m)).toBe("amber");
  });
  it("shaded X alone: 500-year amber, 100-year GREEN (it is not an SFHA)", () => {
    const m = measureFlood(SITE, [], [flood(rect(-10, -10, 1010, 1010), "X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD")]);
    expect(severityFlood100(m)).toBe("green");
    expect(severityFlood500(m)).toBe("amber");
    near(m.shadedFrac, 1);
    expect(buildFlood500Row(m).sentences.join(" ")).toMatch(/Harris County counts it for 1:1 fill mitigation/);
  });
  it("unshaded Zone X over the whole site is a real all-clear: both rows green, 'None'", () => {
    const m = measureFlood(SITE, [], [flood(rect(-10, -10, 1010, 1010), "X", "")]);
    expect(severityFlood100(m)).toBe("green");
    expect(severityFlood500(m)).toBe("green");
    expect(buildFlood100Row(m).figure).toBe("None");
  });
  it("NO polygon over the site is an unmapped area, never a green 'None' (FEMA publishes the all-clear as polygons)", () => {
    const m = measureFlood(SITE, [], []);
    expect(m.mappedFrac).toBe(0);
    expect(severityFlood100(m)).toBe("amber");
    expect(severityFlood500(m)).toBe("amber");
    expect(buildFlood100Row(m).figure).toBe("Not fully mapped");
  });
  it("a Zone D (undetermined) strip blocks the green too", () => {
    const m = measureFlood(SITE, [], [flood(rect(-10, -10, 1010, 1010), "X", ""), flood(rect(-10, -10, 400, 1010), "D")]);
    expect(severityFlood100(m)).toBe("amber");
  });
  it("polygon dust that merely shares the site's own edge is not floodplain", () => {
    const m = measureFlood(SITE, [], [flood(rect(1000, 0, 1500, 1000), "AE"), flood(rect(-10, -10, 1010, 1010), "X", "")]);
    expect(m.sfhaSqft).toBe(0);
    expect(severityFlood100(m)).toBe("green");
  });
  it("only ONE parcel of a multi-parcel site is hit: the fraction is of the WHOLE site", () => {
    const two = [rect(0, 0, 500, 500), rect(2000, 0, 2500, 500)]; // two 250,000 sqft parcels
    const m = measureFlood(two, [], [flood(rect(-50, -50, 600, 600), "AE"), flood(rect(1900, -50, 2600, 600), "X", "")]);
    near(m.siteSqft / 500_000, 1, 0.01);
    near(m.sfhaFrac, 0.5); // all of parcel A, none of parcel B
    expect(severityFlood100(m)).toBe("red");
  });
});

describe("wetlands — acres + count", () => {
  it("a 200×100 ft wetland on the site: ~0.46 ac, one wetland, red", () => {
    const m = measureWetlands(SITE, [], [{ rings: [rect(100, 100, 300, 200)], type: "Freshwater Forested/Shrub Wetland" }]);
    near(m.acres, 20_000 / 43560, 0.01);
    expect(m.count).toBe(1);
    expect(severityWetlands(m)).toBe("red");
    const row = buildWetlandsRow(m);
    expect(row.figure).toMatch(/^0\.5 AC · 1$/);
  });
  it("a wetland that only TOUCHES the ring is not on the site; none ⇒ green", () => {
    const m = measureWetlands(SITE, [], [{ rings: [rect(1000, 0, 1300, 300)], type: "x" }]);
    expect(m.count).toBe(0);
    expect(severityWetlands(m)).toBe("green");
  });
  it("two wetlands overlapping each other count twice but their ground once", () => {
    const m = measureWetlands(SITE, [], [{ rings: [rect(0, 0, 200, 100)], type: "a" }, { rings: [rect(100, 0, 300, 100)], type: "b" }]);
    expect(m.count).toBe(2);
    near(m.acres, 30_000 / 43560, 0.01); // 300×100, not 400×100
  });
  it("a wetland inside the site's save-and-except hole is not on the property", () => {
    const m = measureWetlands(SITE, [rect(0, 0, 400, 400)], [{ rings: [rect(100, 100, 300, 300)], type: "x" }]);
    expect(m.count).toBe(0);
  });
});

describe("pipelines — nearest distance from the site LINE; crossing is red", () => {
  const line = (pts, attrs = { OPERATOR: "CHEVRON PIPE LINE COMPANY" }) => ({
    attrs, paths: [pts.map(([x, y]) => [LNG0 + x / FT_LNG, LAT0 + y / FT_LAT])],
  });
  it("a line that CROSSES the site is red", () => {
    const m = measurePipelines(SITE, [line([[-200, 500], [1200, 500]])]);
    expect(m.nearestFt).toBe(0);
    expect(severityPipelines(m)).toBe("red");
    expect(buildPipelinesRow(m).line).toContain("Chevron Pipe Line Company, 1 line");
  });
  it("a line that crosses only a SLIVER (a corner) is still red", () => {
    const m = measurePipelines(SITE, [line([[-50, 940], [60, 1050]])]);
    expect(m.nearestFt).toBeLessThanOrEqual(CHECK_THRESHOLDS.onSiteFt);
    expect(severityPipelines(m)).toBe("red");
  });
  it("a line that TOUCHES the ring exactly (along an edge, or at a vertex) is red", () => {
    const alongEdge = measurePipelines(SITE, [line([[0, -300], [0, 300]])]);
    const atVertex = measurePipelines(SITE, [line([[1000, 1000], [1500, 1400]])]);
    expect(severityPipelines(alongEdge)).toBe("red");
    expect(severityPipelines(atVertex)).toBe("red");
  });
  it("a line 100 ft outside is amber with a ~distance; 2000 ft outside is green 'None within a quarter mile'", () => {
    const close = measurePipelines(SITE, [line([[1100, -500], [1100, 1500]])]);
    expect(severityPipelines(close)).toBe("amber");
    expect(close.nearestFt).toBeGreaterThan(80); expect(close.nearestFt).toBeLessThan(120);
    const row = buildPipelinesRow(close);
    expect(row.figure).toMatch(/^~\d+ ft$/);
    expect(row.line).toContain("outside the site");
    const far = measurePipelines(SITE, [line([[3000, -500], [3000, 1500]])]);
    expect(severityPipelines(far)).toBe("green");
    expect(buildPipelinesRow(far).line).toBe("None within a quarter mile");
  });
  it("a line exactly AT the radius is inside it (amber), one a few feet past is green", () => {
    const m = measurePipelines(SITE, [line([[2200, -500], [2200, 1500]])]);
    const exact = { ...CHECK_THRESHOLDS, nearRadiusMi: m.nearestFt / 5280 };
    expect(severityPipelines(m, exact)).toBe("amber");
    expect(severityPipelines(m, { ...CHECK_THRESHOLDS, nearRadiusMi: (m.nearestFt - 5) / 5280 })).toBe("green");
  });
  it("only ONE of two parcels is crossed: still red", () => {
    const two = [rect(0, 0, 500, 500), rect(3000, 0, 3500, 500)];
    const m = measurePipelines(two, [line([[3200, -100], [3200, 700]])]);
    expect(severityPipelines(m)).toBe("red");
  });
  it("no pipelines at all is green", () => {
    expect(severityPipelines(measurePipelines(SITE, []))).toBe("green");
  });
});

describe("wells — on the site, within the radius, or none", () => {
  const pt = (x, y, desc = "Oil Well") => ({ attrs: { GIS_SYMBOL_DESCRIPTION: desc, SYMNUM: 4 }, lngLat: [LNG0 + x / FT_LNG, LAT0 + y / FT_LAT] });
  it("a well ON the site is red", () => {
    const m = measureWells(SITE, [pt(500, 500)]);
    expect(m.onSite).toBe(1);
    expect(severityWells(m)).toBe("red");
    expect(buildWellsRow(m).figure).toBe("1 on site");
  });
  it("a well within a quarter mile but off the site is amber", () => {
    const m = measureWells(SITE, [pt(1500, 500), pt(1700, 500)]);
    expect(m.onSite).toBe(0); expect(m.near).toBe(2);
    expect(severityWells(m)).toBe("amber");
    expect(buildWellsRow(m).figure).toBe("2 within ¼ mi");
  });
  it("a well past the radius is green 'None within a quarter mile'", () => {
    const m = measureWells(SITE, [pt(4000, 500)]);
    expect(severityWells(m)).toBe("green");
    expect(buildWellsRow(m).line).toBe("None within a quarter mile");
  });
  it("a well exactly AT the radius counts as inside it", () => {
    const base = measureWells(SITE, [pt(2400, 500)]);
    expect(base.near).toBe(0);
    const d = measureProximity(SITE, [pt(2400, 500)]).nearestFt;
    expect(measureWells(SITE, [pt(2400, 500)], { thresholds: { ...CHECK_THRESHOLDS, nearRadiusMi: d / 5280 } }).near).toBe(1);
  });
  it("a capped answer prints N+ rather than pretending to a total", () => {
    const m = measureWells(SITE, [pt(1500, 500)], { capped: true });
    expect(m.nearLabel).toBe("1+");
  });
  it("only one of two parcels hit still reads on-site", () => {
    const two = [rect(0, 0, 500, 500), rect(3000, 0, 3500, 500)];
    expect(measureWells(two, [pt(3200, 200)]).onSite).toBe(1);
  });
});

describe("thresholds live in one place and the radius is the screen's existing quarter mile", () => {
  it("NEAR_RADIUS_MI is the oil & gas screen's own buffer", async () => {
    const { ANALYSIS_SOURCES } = await import("../src/workspaces/site-planner/lib/siteAnalysis.js");
    expect(ANALYSIS_SOURCES.find((s) => s.id === "oilgas").bufferMi).toBe(NEAR_RADIUS_MI);
    expect(NEAR_RADIUS_MI).toBe(0.25);
    expect(CHECK_THRESHOLDS.nearRadiusMi).toBe(NEAR_RADIUS_MI);
  });
});

describe("copy helpers", () => {
  it("title-cases operators, keeps entity suffixes", () => {
    expect(titleCaseName("CHEVRON PIPE LINE COMPANY")).toBe("Chevron Pipe Line Company");
    expect(titleCaseName("ENTERPRISE CRUDE PIPELINE LLC")).toBe("Enterprise Crude Pipeline LLC");
  });
  it("approximate distances carry a ~ and never read 'on the site'", () => {
    expect(fmtApproxFt(12)).toBe("~10 ft");
    expect(fmtApproxFt(300)).toBe("~300 ft");
    expect(fmtApproxFt(2640)).toBe("~2650 ft");
    expect(fmtApproxFt(7920)).toBe("~1.5 mi");
  });
  it("no jargon in the visible verdict copy", () => {
    const m = measureFlood(SITE, [], [flood(rect(-100, -100, 500, 1100), "AE")]);
    const text = JSON.stringify([buildFlood100Row(m), buildFlood500Row(m), buildWetlandsRow(measureWetlands(SITE, [], [])),
      buildPipelinesRow(measurePipelines(SITE, [])), buildWellsRow(measureWells(SITE, []))]);
    for (const banned of ["SFHA", "CCN", "AADT", "INFO", "Part 77", "NWI", "LOMA", "FIRM"]) expect(text).not.toContain(banned);
  });
  it("freshness: one line (the median age); only a materially staler row gets its own age", () => {
    const D = 86_400_000;
    const f = freshnessOf([{ id: "a", severity: "green", ageMs: 2 * D }, { id: "b", severity: "green", ageMs: 2 * D }, { id: "c", severity: "red", ageMs: 9 * D }, { id: "d", severity: "failed", ageMs: null }]);
    expect(f.line).toBe("Checked 2 days ago");
    expect(f.stale).toEqual({ c: "9 days ago" });
    expect(freshnessOf([{ id: "a", severity: "green", ageMs: 2 * D }, { id: "b", severity: "green", ageMs: 2.5 * D }]).stale).toEqual({});
    expect(ageWords(1000)).toBe("just now");
  });
  it("a stored MEASUREMENT is re-classified with today's thresholds (the cache can never hold a verdict)", () => {
    const meas = { ranked: [{ attrs: { OPERATOR: "X" }, distFt: 800 }], count: 1, nearestFt: 800, nearestDir: "east" };
    expect(rowFromMeasurement("pipelines", meas).severity).toBe("amber");
    expect(rowFromMeasurement("pipelines", meas, { ...CHECK_THRESHOLDS, nearRadiusMi: 0.1 }).severity).toBe("green");
  });
});
