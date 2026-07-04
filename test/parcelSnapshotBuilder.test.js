import { describe, it, expect } from "vitest";
import { queryParamsFor, stampCounty, SOURCES } from "../scripts/build-parcel-snapshot.mjs";

describe("queryParamsFor — request shaping per provider kind (B629 NEW-1)", () => {
  const rings = [[[0, 0], [1, 0], [1, 1], [0, 0]]];

  it("county-poly → POST-able polygon spatial filter, where 1=1, geojson", () => {
    const p = queryParamsFor({ kind: "county-poly", url: "x", county: "Chambers" }, rings);
    expect(p.geometryType).toBe("esriGeometryPolygon");
    expect(p.spatialRel).toBe("esriSpatialRelIntersects");
    expect(JSON.parse(p.geometry).rings).toEqual(rings);
    expect(p.where).toBe("1=1");
    expect(p.f).toBe("geojson");
    expect(p.outSR).toBe("4326");
  });

  it("query → a where-clause, NO geometry", () => {
    const p = queryParamsFor({ kind: "query", url: "x", where: "county='CHAMBERS'" }, null);
    expect(p.where).toBe("county='CHAMBERS'");
    expect(p.geometry).toBeUndefined();
    expect(p.geometryType).toBeUndefined();
  });

  it("query + bbox → an envelope spatial filter (dry-run limiter)", () => {
    const p = queryParamsFor({ kind: "query", url: "x", where: "1=1" }, null, "-95,29,-94,30");
    expect(p.geometryType).toBe("esriGeometryEnvelope");
    expect(p.geometry).toBe("-95,29,-94,30");
  });
});

describe("stampCounty — inject the county the AGO layer lacks", () => {
  it("stamps UPPERCASE county on features missing it; never overrides an existing value", () => {
    const fc = { features: [{ properties: { Prop_ID: "1" } }, { properties: { county: "HARRIS" } }] };
    stampCounty(fc, "chambers");
    expect(fc.features[0].properties.county).toBe("CHAMBERS");
    expect(fc.features[1].properties.county).toBe("HARRIS"); // untouched
  });
});

describe("SOURCES — Chambers/Waller are off the dark state /query", () => {
  it("Chambers + Waller PRIMARY source is the AGO StratMap FeatureServer, county-poly scoped", () => {
    for (const c of ["chambers", "waller"]) {
      const primary = SOURCES[c].sources[0];
      expect(primary.kind).toBe("county-poly");
      expect(primary.url).toMatch(/services1\.arcgis\.com.*StratMap/i);
      expect(primary.county).toMatch(new RegExp(c, "i"));
    }
  });
  it("keeps the TxGIO /query as a documented fallback (preferred when healthy again)", () => {
    expect(SOURCES.chambers.sources.some((s) => /geographic\.texas\.gov/.test(s.url))).toBe(true);
  });
  it("Fort Bend stays on FBCAD via a plain query", () => {
    expect(SOURCES.fortbend.sources[0].kind).toBe("query");
    expect(SOURCES.fortbend.sources[0].url).toMatch(/FBCAD/i);
  });
});
