import { describe, it, expect } from "vitest";
import {
  queryParamsFor, stampCounty, SOURCES, pageProvider,
  attrValue, quarterSplit, boundsOfRings, layerMaxRecordCount, identifyTileCounty,
} from "../scripts/build-parcel-snapshot.mjs";

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

// B1657600 — the dead AGO StratMap mirror (B1639584/B1639698) is GONE; Chambers/Waller now ride
// the same government TxGIO service the live app uses, with a self-healing plain /query attempt
// first (costs one fast-failing request if it's still dark) and identify-tile as the reliable path.
describe("SOURCES — Chambers/Waller are off the dead AGO StratMap mirror (B1639698 amendment)", () => {
  it("no source anywhere still points at the dead third-party AGOL mirror", () => {
    const allUrls = Object.values(SOURCES).flatMap((c) => c.sources.map((s) => s.url));
    expect(allUrls.some((u) => /services1\.arcgis\.com.*StratMap/i.test(u))).toBe(false);
    expect(Object.values(SOURCES).flatMap((c) => c.sources.map((s) => s.kind))).not.toContain("county-poly");
  });
  it("Chambers + Waller both carry a TxGIO /query attempt first (self-heals for free) and identify-tile as the reliable fallback", () => {
    for (const c of ["chambers", "waller"]) {
      const [first, second] = SOURCES[c].sources;
      expect(first.kind).toBe("query");
      expect(first.url).toMatch(/geographic\.texas\.gov/i);
      expect(first.where).toMatch(new RegExp(c, "i"));
      expect(second.kind).toBe("identify-tile");
      expect(second.url).toMatch(/geographic\.texas\.gov/i);
      expect(second.county).toMatch(new RegExp(c, "i"));
    }
  });
  it("Fort Bend stays on FBCAD via a plain query", () => {
    expect(SOURCES.fortbend.sources[0].kind).toBe("query");
    expect(SOURCES.fortbend.sources[0].url).toMatch(/FBCAD/i);
  });
});

describe("attrValue — case-insensitive attribute lookup (B1657600)", () => {
  it("matches regardless of case, both directions", () => {
    expect(attrValue({ PROP_ID: "1" }, "prop_id")).toBe("1");
    expect(attrValue({ prop_id: "1" }, "PROP_ID")).toBe("1");
    expect(attrValue({ County: "CHAMBERS" }, "county")).toBe("CHAMBERS");
  });
  it("returns undefined when absent, and tolerates a null/undefined attrs object", () => {
    expect(attrValue({}, "county")).toBeUndefined();
    expect(attrValue(null, "county")).toBeUndefined();
    expect(attrValue(undefined, "county")).toBeUndefined();
  });
});

describe("stampCounty — recognizes an UPPERCASE identify-style COUNTY as already present (B1657600)", () => {
  it("does not double-stamp a feature whose county came back as COUNTY (uppercase)", () => {
    const fc = { features: [{ properties: { PROP_ID: "1", COUNTY: "CHAMBERS" } }] };
    stampCounty(fc, "chambers");
    expect(fc.features[0].properties.COUNTY).toBe("CHAMBERS");
    expect(fc.features[0].properties.county).toBeUndefined(); // no redundant lowercase copy added
  });
});

describe("quarterSplit — an envelope's four quadrants (B1657600)", () => {
  it("splits into four non-overlapping quadrants that reassemble the original box", () => {
    const [a, b, c, d] = quarterSplit([0, 0, 10, 10]);
    expect(a).toEqual([0, 0, 5, 5]);
    expect(b).toEqual([5, 0, 10, 5]);
    expect(c).toEqual([0, 5, 5, 10]);
    expect(d).toEqual([5, 5, 10, 10]);
  });
});

describe("boundsOfRings — bounding box of a set of rings (B1657600)", () => {
  it("finds the min/max across every ring and vertex", () => {
    expect(boundsOfRings([[[-95, 29], [-94, 30]], [[-96, 28]]])).toEqual([-96, 28, -94, 30]);
  });
});

describe("layerMaxRecordCount — reads the layer's own declared per-request ceiling (B1657600)", () => {
  it("returns the layer's maxRecordCount when metadata answers cleanly", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ maxRecordCount: 500 }) });
    expect(await layerMaxRecordCount("https://example.test/MapServer/0", { fetchImpl })).toBe(500);
  });
  it("falls back to a conservative default on a bad response, never throwing", async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    expect(await layerMaxRecordCount("https://example.test/MapServer/0", { fetchImpl })).toBeGreaterThan(0);
  });
  it("falls back on a network throw too", async () => {
    const fetchImpl = async () => { throw new Error("network"); };
    expect(await layerMaxRecordCount("https://example.test/MapServer/0", { fetchImpl })).toBeGreaterThan(0);
  });
});

// The recursive envelope-tile extraction that replaces bulk /query for TXGIO_PARCELS. All network
// calls are injected — no live host is ever reached from a unit test.
describe("identifyTileCounty — bulk extraction via /identify over tiles, never a total feature count (B1657600)", () => {
  const LAYER = "https://example.test/MapServer/0";
  const sq = (x, y, h) => [[x - h, y - h], [x - h, y + h], [x + h, y + h], [x + h, y - h], [x - h, y - h]];
  const feat = (id, x, y, county = "CHAMBERS") => ({ geometry: { rings: [sq(x, y, 0.01)] }, attributes: { PROP_ID: id, COUNTY: county } });

  it("a tile below the cap is trusted whole — one call, no split", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes("/identify")) return { ok: true, json: async () => ({ results: [feat("1", 0, 0), feat("2", 1, 1)] }) };
      return { ok: true, json: async () => ({ maxRecordCount: 1000 }) };
    };
    const feats = await identifyTileCounty(LAYER, "Chambers", { fetchImpl, bbox: "-10,-10,10,10" });
    expect(feats).toHaveLength(2);
    expect(calls.filter((u) => u.includes("/identify"))).toHaveLength(1); // no subdivision needed
  });

  it("a tile AT the cap is discarded and split into four — its own contents are never trusted", async () => {
    const cap = 2;
    let identifyCalls = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes("/identify")) {
        identifyCalls++;
        // The ROOT tile (first call) reports exactly `cap` results (must be re-split); every
        // child tile reports fewer (trusted), each returning a DISTINCT parcel.
        if (identifyCalls === 1) return { ok: true, json: async () => ({ results: [feat("root-a", 0, 0), feat("root-b", 0, 0)] }) };
        return { ok: true, json: async () => ({ results: [feat(`child-${identifyCalls}`, identifyCalls, identifyCalls)] }) };
      }
      return { ok: true, json: async () => ({ maxRecordCount: cap }) };
    };
    const feats = await identifyTileCounty(LAYER, "Chambers", { fetchImpl, bbox: "-10,-10,10,10" });
    expect(identifyCalls).toBe(5); // 1 root + 4 children
    // the root tile's own (capped, untrustworthy) results are NOT in the output
    expect(feats.some((f) => f.properties.PROP_ID === "root-a")).toBe(false);
    expect(feats).toHaveLength(4); // only the four children's distinct parcels
  });

  it("dedupes a parcel returned by two adjacent tiles (a straddling parcel), by PROP_ID", () => {
    // (covered structurally by the Map-keyed-by-id design; a direct unit check:)
    return identifyTileCounty(LAYER, "Chambers", {
      bbox: "-10,-10,10,10",
      fetchImpl: async (url) => {
        if (String(url).includes("/identify")) return { ok: true, json: async () => ({ results: [feat("dupe", 0, 0), feat("dupe", 0, 0)] }) };
        return { ok: true, json: async () => ({ maxRecordCount: 1000 }) };
      },
    }).then((feats) => expect(feats).toHaveLength(1));
  });

  it("drops a result whose COUNTY attribute names a different county (a corner tile reaching a neighbor)", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/identify")) return { ok: true, json: async () => ({ results: [feat("mine", 0, 0, "CHAMBERS"), feat("theirs", 0, 0, "LIBERTY")] }) };
      return { ok: true, json: async () => ({ maxRecordCount: 1000 }) };
    };
    const feats = await identifyTileCounty(LAYER, "Chambers", { fetchImpl, bbox: "-10,-10,10,10" });
    expect(feats).toHaveLength(1);
    expect(feats[0].properties.PROP_ID).toBe("mine");
  });

  it("converts Esri rings into real GeoJSON geometry on the way out", async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes("/identify")) return { ok: true, json: async () => ({ results: [feat("1", 0, 0)] }) };
      return { ok: true, json: async () => ({ maxRecordCount: 1000 }) };
    };
    const feats = await identifyTileCounty(LAYER, "Chambers", { fetchImpl, bbox: "-10,-10,10,10" });
    expect(feats[0].type).toBe("Feature");
    expect(feats[0].geometry.type).toBe("Polygon");
  });

  it("throws for a non-MapServer/<id> url rather than silently returning nothing", async () => {
    await expect(identifyTileCounty("https://example.test/FeatureServer/0", "Chambers", {
      bbox: "-10,-10,10,10",
      fetchImpl: async () => ({ ok: true, json: async () => ({ maxRecordCount: 1000 }) }),
    })).rejects.toThrow(/MapServer/);
  });
});
