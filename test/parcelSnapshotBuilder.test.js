import { describe, it, expect } from "vitest";
import { queryParamsFor, stampCounty, SOURCES, pageProvider } from "../scripts/build-parcel-snapshot.mjs";

// A fake ArcGIS /query page: `n` GeoJSON features + an optional "there's more" flag. `flagAt`
// picks whether the flag rides at top level or under `properties` (ArcGIS geojson does both).
const fakePage = (n, more, flagAt = "top") => {
  const features = Array.from({ length: n }, (_, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [i, i] }, properties: { i } }));
  const j = { type: "FeatureCollection", features };
  if (more) (flagAt === "properties" ? (j.properties = { exceededTransferLimit: true }) : (j.exceededTransferLimit = true));
  return { ok: true, json: async () => j };
};

describe("pageProvider — pages by exceededTransferLimit, not by page size (the Waller 26k-vs-49k bug)", () => {
  it("keeps paging through a SHORT mid-pull page and advances offset by rows actually returned", async () => {
    // The exact bug repro: page 1 comes back < PAGE (1200 rows) but the server still says "more".
    // The old `batch.length < PAGE` break stopped here, losing ~half the county. The fix pages on
    // the server's own flag and advances offset by the real row count.
    const pages = [fakePage(2000, true), fakePage(1200, true, "properties"), fakePage(800, false)];
    const offsets = [];
    const fetchImpl = async (url) => {
      offsets.push(Number(new URL(url).searchParams.get("resultOffset")));
      return pages[offsets.length - 1];
    };
    const feats = await pageProvider({ kind: "query", url: "https://example.test/svc/0", where: "1=1" }, { fetchImpl });
    expect(feats).toHaveLength(2000 + 1200 + 800); // nothing dropped by the short page
    expect(offsets).toEqual([0, 2000, 3200]); // offset advanced by ACTUAL rows, not a fixed 2000
  });

  it("stops when the server reports no more (flag absent), even on a full-size final page", async () => {
    const pages = [fakePage(2000, true), fakePage(2000, false)];
    let call = 0;
    const fetchImpl = async () => pages[call++];
    const feats = await pageProvider({ kind: "query", url: "https://example.test/svc/0", where: "1=1" }, { fetchImpl });
    expect(feats).toHaveLength(4000);
    expect(call).toBe(2); // did not page a third time
  });

  it("drops features with no geometry (defensive) but keeps paging", async () => {
    const withNulls = { ok: true, json: async () => ({ features: [{ geometry: { type: "Point", coordinates: [0, 0] } }, { geometry: null }, {}] }) };
    const fetchImpl = async () => withNulls;
    const feats = await pageProvider({ kind: "query", url: "https://example.test/svc/0", where: "1=1" }, { fetchImpl });
    expect(feats).toHaveLength(1); // only the one real geometry survives; no-more-flag ends it
  });
});

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
