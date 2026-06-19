import { describe, it, expect } from "vitest";
import {
  ANALYSIS_SOURCES, simplifyRing, ringsBBox, ringCentroid, representativeRing,
  ringsSignature, buildAnalysisParams, buildQueryUrl, normalizeAttrs, zoneSummary, wetlandSummary,
  pipelineSummary, classifyStatus, analyzeSource, runSiteAnalysis,
  buildJurisdictionFinding, buildRoadFinding, deriveZoning,
} from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

// A square parcel ring near Katy, TX (lon/lat). ~tiny.
const SQUARE = [[-95.80, 29.78], [-95.79, 29.78], [-95.79, 29.79], [-95.80, 29.79]];

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}
const makeClock = (start = 1_000_000) => { let t = start; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };
const freshCache = () => createGisCache({ store: makeStore(), now: makeClock() });

// Fake ArcGIS fetch routed by URL substring → features array (or throws).
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) { fn.calls++; const r = respond(url); if (r instanceof Error) throw r; return { features: r }; }
    }
    throw new Error("no route for " + url);
  };
  fn.calls = 0;
  return fn;
}

// ---------------------------------------------------------------------------
describe("geometry helpers", () => {
  it("simplifyRing decimates only above the cap, keeping endpoints", () => {
    const big = Array.from({ length: 200 }, (_, i) => [i, i]);
    const out = simplifyRing(big, 60);
    expect(out.length).toBe(60);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([199, 199]);
    expect(simplifyRing(SQUARE, 60)).toBe(SQUARE); // small ring untouched
  });
  it("ringsBBox spans every ring in the set", () => {
    const b = ringsBBox([SQUARE, [[-96, 30], [-95.5, 30], [-95.5, 30.5]]]);
    expect(b).toEqual([-96, 29.78, -95.5, 30.5]);
  });
  it("ringCentroid is the bbox centre", () => {
    expect(ringCentroid(SQUARE)).toEqual({ lng: -95.795, lat: 29.785 });
  });
  it("representativeRing returns the largest-area ring", () => {
    const small = [[-95.80, 29.78], [-95.799, 29.78], [-95.799, 29.781]];
    expect(representativeRing([small, SQUARE])).toBe(SQUARE);
  });
  it("ringsSignature is stable + bbox-based", () => {
    expect(ringsSignature([SQUARE])).toBe(ringsSignature([SQUARE]));
    expect(ringsSignature([SQUARE])).toContain("1_");
  });
});

describe("query building", () => {
  it("buildAnalysisParams emits a multipolygon intersect, attrs only", () => {
    const src = ANALYSIS_SOURCES.find((s) => s.id === "flood");
    const p = buildAnalysisParams(src, [SQUARE]);
    expect(p.geometryType).toBe("esriGeometryPolygon");
    expect(p.spatialRel).toBe("esriSpatialRelIntersects");
    expect(p.returnGeometry).toBe("false");
    expect(p.inSR).toBe(4326);
    expect(p.outFields).toContain("FLD_ZONE");
    const g = JSON.parse(p.geometry);
    expect(g.rings.length).toBe(1);
    // ring auto-closed
    expect(g.rings[0][0]).toEqual(g.rings[0][g.rings[0].length - 1]);
  });
  it("buildQueryUrl inserts the sublayer path", () => {
    const url = buildQueryUrl("https://x/MapServer", 28, { f: "json" });
    expect(url).toContain("/MapServer/28/query");
    const url2 = buildQueryUrl("https://x/MapServer", null, { f: "json" });
    expect(url2).toContain("/MapServer/query");
  });
});

describe("summarizers", () => {
  it("zoneSummary lists distinct FEMA zones", () => {
    expect(zoneSummary([{ FLD_ZONE: "AE" }, { FLD_ZONE: "AE" }, { FLD_ZONE: "X" }])).toBe("Zone AE, X");
  });
  it("wetlandSummary lists distinct NWI types", () => {
    expect(wetlandSummary([{ WETLAND_TYPE: "Freshwater Forested/Shrub Wetland" }])).toContain("Freshwater");
  });
  it("pipelineSummary counts + names operators (real RRC field OPER_NM, B189)", () => {
    expect(pipelineSummary([{ OPER_NM: "Kinder Morgan" }, { OPER_NM: "Kinder Morgan" }])).toMatch(/2 pipeline segments.*Kinder/);
  });
});

describe("normalizeAttrs — joined-layer field qualifier (B189)", () => {
  it("strips the ArcGIS table prefix so summarizers read plain names", () => {
    expect(normalizeAttrs({ "Wetlands_CONUS_West.WETLAND_TYPE": "Lake", "NWI_Wetland_Codes.ATTRIBUTE": "L1UBH" }))
      .toEqual({ WETLAND_TYPE: "Lake", ATTRIBUTE: "L1UBH" });
  });
  it("leaves unqualified attributes untouched, keeps first non-empty on collision", () => {
    expect(normalizeAttrs({ FLD_ZONE: "AE" })).toEqual({ FLD_ZONE: "AE" });
    expect(normalizeAttrs({ "A.X": "", "B.X": "kept" })).toEqual({ X: "kept" });
  });
  it("null/undefined → empty object (never throws)", () => {
    expect(normalizeAttrs(null)).toEqual({});
  });
});

describe("classifyStatus — the silent-error guard", () => {
  it("present when features intersect", () => {
    expect(classifyStatus([{}], { error: null, verified: true })).toBe("present");
  });
  it("absent only for a VERIFIED source returning empty", () => {
    expect(classifyStatus([], { error: null, verified: true })).toBe("absent");
  });
  it("UNKNOWN for an unverified source returning empty (never a fabricated all-clear)", () => {
    expect(classifyStatus([], { error: null, verified: false })).toBe("unknown");
  });
  it("UNKNOWN on any error, even verified", () => {
    expect(classifyStatus(null, { error: "boom", verified: true })).toBe("unknown");
  });
});

describe("analyzeSource — rides the cache, honest on failure", () => {
  const flood = ANALYSIS_SOURCES.find((s) => s.id === "flood");
  it("present + summary when the SFHA layer returns a zone", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "AE", STATIC_BFE: 92 } }] });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("present");
    expect(f.summary).toBe("Zone AE");
    expect(f.detail[0]).toMatch(/Zone AE/);
    expect(f.caveat).toMatch(/FEMA/);
  });
  it("absent (verified) → confident none-found with the absent label", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => [] });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("absent");
    expect(f.summary).toMatch(/No mapped Special Flood Hazard/);
  });
  it("error → unknown, surfaced not thrown", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => new Error("Failed to fetch") });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("unknown");
    expect(f.error).toMatch(/network|reach/i);
  });
  it("empty from a now-VERIFIED wetlands query → absent (none found), post-B189 fix", async () => {
    const cache = freshCache();
    const wet = ANALYSIS_SOURCES.find((s) => s.id === "wetlands");
    expect(wet.verified).toBe(true);
    const fetchJson = fakeFetch({ "Wetlands_gdb_split": () => [] });
    const f = await analyzeSource(wet, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("absent");
    expect(f.summary).toMatch(/No NWI-mapped wetlands/);
  });
  it("empty from an UNVERIFIED source → unknown, not absent (silent-error guard intact)", async () => {
    const cache = freshCache();
    const synthetic = { id: "synthx", category: "X", label: "x", kind: "polygon", url: "https://x/MapServer", layer: 0, fields: { a: "A" }, verified: false, summarize: () => "", detail: () => [] };
    const fetchJson = fakeFetch({ "/MapServer/0/query": () => [] });
    const f = await analyzeSource(synthetic, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("unknown");
  });
  it("queries every sublayer of a multi-layer source", async () => {
    const cache = freshCache();
    const wet = ANALYSIS_SOURCES.find((s) => s.id === "wetlands");
    const fetchJson = fakeFetch({
      "/MapServer/1/query": () => [{ attributes: { WETLAND_TYPE: "Freshwater Pond" } }],
      "/MapServer/2/query": () => [],
    });
    const f = await analyzeSource(wet, [SQUARE], { cache, fetchJson });
    expect(fetchJson.calls).toBe(2);
    expect(f.status).toBe("present");
  });
  it("reads table-QUALIFIED wetland fields via normalization → present (the B189 root cause)", async () => {
    const cache = freshCache();
    const wet = ANALYSIS_SOURCES.find((s) => s.id === "wetlands");
    const fetchJson = fakeFetch({
      "/MapServer/2/query": () => [{ attributes: { "Wetlands_CONUS_West.WETLAND_TYPE": "Freshwater Emergent Wetland" } }],
      "/MapServer/1/query": () => [],
    });
    const f = await analyzeSource(wet, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("present");
    expect(f.summary).toMatch(/Freshwater Emergent/);
  });
  it("pipelines query asks for the REAL fields, not the 400-ing OPERATOR/COMMODITY (B189)", async () => {
    const pipe = ANALYSIS_SOURCES.find((s) => s.id === "pipelines");
    const params = buildAnalysisParams(pipe, [SQUARE]);
    expect(params.outFields).toBe("OPER_NM,CMDTY_DESC,DIAMETER");
    expect(params.outFields).not.toMatch(/OPERATOR|COMMODITY\b/);
  });
  it("oil & gas wells query drops the non-existent LEASE_NAME field (B189)", async () => {
    const wells = ANALYSIS_SOURCES.find((s) => s.id === "oilgas");
    expect(buildAnalysisParams(wells, [SQUARE]).outFields).not.toMatch(/LEASE_NAME/);
  });
  it("findings carry their map-overlay layer id for the show-on-map toggle (B190)", async () => {
    const cache = freshCache();
    const flood = ANALYSIS_SOURCES.find((s) => s.id === "flood");
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "AE" } }] });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.mapLayer).toBe("fema");
  });
  it("pending source reads as pending (source not connected), never absent", async () => {
    const contam = ANALYSIS_SOURCES.find((s) => s.id === "contamination");
    const f = await analyzeSource(contam, [SQUARE], {});
    expect(f.status).toBe("pending");
  });
});

describe("derived jurisdiction findings", () => {
  const baseJ = { county: ["Harris"], city: [], etj: [], unincorporated: true, straddle: false, ages: {}, sources: [] };
  it("buildJurisdictionFinding rows out county/city/ETJ", () => {
    const f = buildJurisdictionFinding({ ...baseJ, county: ["Harris"], city: ["Houston"], unincorporated: false });
    expect(f.status).toBe("info");
    expect(f.rows.find((r) => r[0] === "City")[1]).toBe("Houston");
  });
  it("deriveZoning: Houston city → no zoning", () => {
    const f = deriveZoning({ ...baseJ, city: ["Houston"], unincorporated: false });
    expect(f.summary).toMatch(/NO zoning/i);
  });
  it("deriveZoning: unincorporated → no county zoning", () => {
    expect(deriveZoning(baseJ).summary).toMatch(/Unincorporated/);
  });
  it("deriveZoning: other city → zoning likely applies", () => {
    const f = deriveZoning({ ...baseJ, city: ["Katy"], unincorporated: false });
    expect(f.summary).toMatch(/Katy/);
    expect(f.summary).toMatch(/zoning likely/i);
  });
  it("buildRoadFinding: unknown when no authority", () => {
    expect(buildRoadFinding({ authorities: [] }).status).toBe("unknown");
    expect(buildRoadFinding({ authorities: ["County"], nearest: { route: "CR 123" } }).rows[0][1]).toMatch(/County.*CR 123/);
  });
});

describe("runSiteAnalysis — orchestration", () => {
  it("empty rings → empty result, no network", async () => {
    const r = await runSiteAnalysis([], {});
    expect(r.empty).toBe(true);
    expect(r.findings).toEqual([]);
  });
  it("assembles every category in display order with injected sources", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({
      "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "X" } }],
      "Wetlands_gdb_split": () => [],
      "TXRRC/Wells": () => [],
      "TXRRC/Pipelines": () => [],
    });
    const identifyJurisdiction = async () => ({
      county: ["Harris"], city: ["Houston"], etj: [], unincorporated: false, straddle: false,
      ages: { county: 1000 }, sources: [],
    });
    const identifyRoadAuthority = async () => ({ authorities: ["State (TxDOT)"], nearest: { route: "IH 10" }, ageMs: 500, note: "ok" });
    const { findings } = await runSiteAnalysis([SQUARE], { cache, fetchJson, identifyJurisdiction, identifyRoadAuthority });
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(["flood", "wetlands", "pipelines", "oilgas", "contamination", "jurisdiction", "road", "zoning"]);
    expect(findings.find((f) => f.id === "flood").status).toBe("present");
    expect(findings.find((f) => f.id === "zoning").summary).toMatch(/NO zoning/i);
    expect(findings.find((f) => f.id === "road").rows[0][1]).toMatch(/TxDOT.*IH 10/);
  });
  it("survives a jurisdiction-engine throw (keeps arcgis findings, no zoning crash)", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({
      "/NFHL/MapServer/28/query": () => [],
      "Wetlands_gdb_split": () => [],
      "TXRRC/Wells": () => [],
      "TXRRC/Pipelines": () => [],
    });
    const identifyJurisdiction = async () => { throw new Error("down"); };
    const identifyRoadAuthority = async () => { throw new Error("down"); };
    const { findings } = await runSiteAnalysis([SQUARE], { cache, fetchJson, identifyJurisdiction, identifyRoadAuthority });
    expect(findings.find((f) => f.id === "flood").status).toBe("absent");
    // jurisdiction/road/zoning fall back to their pending/placeholder rows, not a crash
    expect(findings.find((f) => f.id === "jurisdiction")).toBeTruthy();
  });
});
