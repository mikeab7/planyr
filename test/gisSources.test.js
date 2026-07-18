/* GIS Source Registry guard (B369). Fails CI if a source row is mis-tiered (a /Test/ or
 * other non-production endpoint without an acknowledged exception), if an endpoint is
 * inlined in the analysis connectors instead of the registry, or if the wells/pipelines
 * coverage fixtures (the 14-vs-8,014 guard) go missing. */
import { describe, it, expect } from "vitest";
import {
  GIS_SOURCES, ANALYSIS_KEYS, JURISDICTION_KEYS, auditRegistry, tierProblems,
  looksNonProduction, outFieldsFor, gisSource,
} from "../src/shared/gis/sources.js";
import { auditSources, scanInlineUrls } from "../ui-audit/gis-source-audit.mjs";

const audit = auditSources();

describe("registry tier integrity", () => {
  it("the whole registry passes the shape + tier audit (no problems)", () => {
    const { problems } = auditRegistry(GIS_SOURCES);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });

  it("every source is production OR an acknowledged monitored-exception with a reason", () => {
    for (const [key, s] of Object.entries(GIS_SOURCES)) {
      expect(["production", "monitored-exception"]).toContain(s.tier);
      if (s.tier === "monitored-exception") expect(s.tierReason, key).toBeTruthy();
    }
  });

  it("the only acknowledged exceptions are wetlands + growthFaults (no live authoritative endpoint)", () => {
    const exceptions = Object.values(GIS_SOURCES).filter((s) => s.tier !== "production").map((s) => s.key);
    // wetlands: USFWS publishes polygon-query only on its Test folder. growthFaults: USGS SIM 2874
    // is download-only, so we depend on the UH GIS republication until we self-host the shapefile.
    expect(exceptions).toEqual(["wetlands", "growthFaults"]);
    for (const key of exceptions) expect(gisSource(key).tierReason, key).toBeTruthy();
  });

  it("flags a non-production URL that isn't acknowledged (the NWI-Test / geogimstest class)", () => {
    expect(looksNonProduction("https://h/server/rest/services/Test/Foo/MapServer")).toBe(true);
    expect(looksNonProduction("https://geogimstest.houstontx.gov/arcgis/rest")).toBe(true);
    expect(looksNonProduction("https://gis.rrc.texas.gov/server/rest/services/rrc_public/x/MapServer")).toBe(false);
    // a production row sitting on a /Test/ URL must be caught
    const bad = { key: "x", serviceUrl: "https://h/services/Test/x/MapServer", tier: "production" };
    expect(tierProblems(bad).some((p) => /non-production/.test(p))).toBe(true);
  });
});

describe("authoritative sources (B368 — no more silent false-clean)", () => {
  it("wells + pipelines point at the statewide RRC service, never the Harris-County republication", () => {
    for (const key of ["oilgas", "pipelines"]) {
      const s = gisSource(key);
      expect(s.serviceUrl).toMatch(/gis\.rrc\.texas\.gov/);
      expect(s.serviceUrl).not.toMatch(/gis\.hctx\.net/);
      expect(s.provider).toMatch(/Railroad Commission/i);
      expect(s.tier).toBe("production");
    }
    expect(gisSource("oilgas").layerId).toBe(1);
    expect(gisSource("pipelines").layerId).toBe(13);
  });

  it("carries the coverage fixtures that would have caught Chambers 14-vs-8,014", () => {
    const wells = gisSource("oilgas");
    const chambers = wells.fixtures.find((f) => /Chambers/.test(f.label));
    expect(chambers).toBeTruthy();
    expect(chambers.bbox).toEqual([-94.92, 29.40, -94.40, 29.95]);
    expect(chambers.expectMinCount).toBeGreaterThanOrEqual(1000); // a county-clipped source fails this
    // the Mont Belvieu (Grand Port) point — must find at least one well
    expect(wells.fixtures.some((f) => f.point && f.expectMinCount >= 1)).toBe(true);
    // pipelines too
    expect(gisSource("pipelines").fixtures.some((f) => /Chambers/.test(f.label) && f.expectMinCount >= 1000)).toBe(true);
  });

  it("outFieldsFor derives the request fields; wetlands stays '*' (joined layers)", () => {
    expect(outFieldsFor(gisSource("wetlands"))).toBe("*");
    expect(outFieldsFor(gisSource("oilgas"))).toBe("API,SYMNUM,GIS_SYMBOL_DESCRIPTION,GIS_WELL_NUMBER");
    expect(outFieldsFor(gisSource("pipelines"))).toBe("OPERATOR,COMMODITY_DESCRIPTION,DIAMETER,STATUS,SYSTEM_NAME,COUNTY_NAME");
  });

  it("the TEA ISD source (B764) is a production statewide polygon with verified coverage fixtures", () => {
    const isd = gisSource("isd");
    expect(isd.provider).toMatch(/Texas Education Agency/);
    expect(isd.tier).toBe("production");
    expect(isd.geometryType).toBe("polygon");
    expect(isd.fields.name).toBe("NAME");
    expect(isd.fields.number).toBe("DISTRICT_N");
    expect(outFieldsFor(isd)).toBe("NAME,DISTRICT_N");
    // Coverage fixtures verified live 2026-07-11 — a county-clipped/wrong source fails these.
    expect(isd.fixtures.some((f) => /Goose Creek/.test(f.label) && f.point && f.expectMinCount >= 1)).toBe(true);
    expect(isd.fixtures.some((f) => /Houston ISD/.test(f.label))).toBe(true);
  });
});

describe("no inline endpoints in the analysis path", () => {
  it("siteAnalysis.js + jurisdiction.js read every URL from the registry (no inline literals)", () => {
    const problems = scanInlineUrls();
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });
  it("the combined audit is clean", () => {
    expect(audit.ok, JSON.stringify(audit, null, 2)).toBe(true);
  });
});

describe("registry covers both consuming surfaces", () => {
  it("analysis + jurisdiction keys all resolve to real rows", () => {
    for (const key of [...ANALYSIS_KEYS, ...JURISDICTION_KEYS]) expect(GIS_SOURCES[key]).toBeTruthy();
    expect(gisSource("oilgas").key).toBe("oilgas");
    expect(() => gisSource("nope")).toThrow();
  });
});
