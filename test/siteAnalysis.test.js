import { describe, it, expect } from "vitest";
import {
  ANALYSIS_SOURCES, simplifyRing, ringsBBox, ringCentroid, representativeRing,
  ringsSignature, buildAnalysisParams, buildQueryUrl, normalizeAttrs, zoneSummary, wetlandSummary,
  pipelineSummary, classifyStatus, classifyFlood, isSFHA, analyzeSource, runSiteAnalysis,
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
  it("pipelineSummary counts + names operators (RRC layer-13 field OPERATOR, B368)", () => {
    expect(pipelineSummary([{ OPERATOR: "Kinder Morgan" }, { OPERATOR: "Kinder Morgan" }])).toMatch(/2 pipeline segments.*Kinder/);
  });
  it("pipelineSummary uses the EXACT total when given, not the capped sample length", () => {
    const sample = Array.from({ length: 30 }, () => ({ OPERATOR: "Kinder Morgan" }));
    expect(pipelineSummary(sample, 3207)).toMatch(/3207 pipeline segments/);
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
  it("UNAVAILABLE on any error, even verified (retryable; never read as clear — B366)", () => {
    expect(classifyStatus(null, { error: "boom", verified: true })).toBe("unavailable");
    expect(classifyStatus(null, { error: "503", verified: false })).toBe("unavailable");
  });
});

describe("classifyFlood — Zone X is the all-clear, not a constraint (B147 false-positive fix)", () => {
  it("isSFHA: A*/V* are SFHA; X / D / blank / open-water are not", () => {
    for (const z of ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "A12", "V30"]) expect(isSFHA(z)).toBe(true);
    for (const z of ["X", "x", "D", "", null, "OPEN WATER", "AREA NOT INCLUDED"]) expect(isSFHA(z)).toBe(false);
  });
  it("an SFHA zone (AE) is PRESENT with a zone summary", () => {
    const c = classifyFlood([{ FLD_ZONE: "AE", STATIC_BFE: 92 }]);
    expect(c.status).toBe("present");
    expect(c.summary).toBe("Zone AE");
  });
  it("only unshaded Zone X (minimal) → ABSENT, never present (the live bug)", () => {
    const c = classifyFlood([{ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }],
      { absentLabel: "No mapped Special Flood Hazard Area (Zone X / minimal risk)" });
    expect(c.status).toBe("absent");
    expect(c.summary).toMatch(/No mapped Special Flood Hazard/);
  });
  it("shaded Zone X (0.2% / 500-yr) → INFO (moderate), not present and not a green all-clear", () => {
    const c = classifyFlood([{ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }]);
    expect(c.status).toBe("info");
    expect(c.summary).toMatch(/0\.2%|500-yr/);
  });
  it("a mix of SFHA + X reports PRESENT and summarizes only the SFHA zone", () => {
    const c = classifyFlood([{ FLD_ZONE: "X" }, { FLD_ZONE: "AE" }]);
    expect(c.status).toBe("present");
    expect(c.summary).toBe("Zone AE");
  });
  it("Zone D (undetermined) → UNKNOWN, never absent (not an all-clear)", () => {
    expect(classifyFlood([{ FLD_ZONE: "D" }]).status).toBe("unknown");
  });
  it("empty result → ABSENT with the source's none-found label", () => {
    const c = classifyFlood([], { absentLabel: "none here" });
    expect(c.status).toBe("absent");
    expect(c.summary).toBe("none here");
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
  it("flood: an intersecting Zone X reads ABSENT, not present (B147 live false-positive)", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" } }] });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("absent");
    expect(f.summary).toMatch(/No mapped Special Flood Hazard/);
  });
  it("flood: shaded Zone X (0.2%) reads INFO (moderate) and keeps its map layer", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" } }] });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("info");
    expect(f.mapLayer).toBe("fema");
  });
  it("error → unavailable, surfaced not thrown (honest, not 'CORS' — B366)", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({ "/NFHL/MapServer/28/query": () => new Error("Failed to fetch") });
    const f = await analyzeSource(flood, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("unavailable");
    expect(f.error).toMatch(/reach|unavailable/i);
    expect(f.error).not.toMatch(/CORS/);
  });
  it("a failed REFRESH keeps the last-good copy (stale, not blanked — B367)", async () => {
    const cache = freshCache();
    // First, a good read populates the cache (ttl 0 ⇒ always revalidate next time).
    const src0 = { ...flood, ttl: 0 };
    const ok = fakeFetch({ "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "AE" } }] });
    const good = await analyzeSource(src0, [SQUARE], { cache, fetchJson: ok });
    expect(good.status).toBe("present");
    // Now the refresh fails — the last-good "present" must survive, flagged stale.
    const boom = fakeFetch({ "/NFHL/MapServer/28/query": () => new Error("Failed to fetch") });
    const f = await analyzeSource(src0, [SQUARE], { cache, fetchJson: boom });
    expect(f.status).toBe("present");           // NOT downgraded to unavailable
    expect(f.stale).toBe(true);
    expect(f.refreshError).toMatch(/reach|unavailable/i);
    expect(f.summary).toBe("Zone AE");
  });
  it("falls back to a mirror endpoint when the primary errors (B369 #6)", async () => {
    const cache = freshCache();
    const src = {
      id: "fb", category: "X", label: "x", kind: "polygon",
      url: "https://primary/MapServer", layer: 0, fields: { a: "A" }, verified: true,
      fallbacks: [{ url: "https://mirror/MapServer", layer: 0, fields: { a: "A" } }],
      summarize: () => "from mirror", detail: () => [], absentLabel: "none",
    };
    const fetchJson = fakeFetch({
      "https://primary/MapServer/0/query": () => new Error("Failed to fetch"),
      "https://mirror/MapServer/0/query": () => [{ attributes: { A: 1 } }],
    });
    const f = await analyzeSource(src, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("present");
    expect(f.summary).toBe("from mirror");
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
  it("pipelines query asks for the RRC layer-13 fields (authoritative source, B368)", async () => {
    const pipe = ANALYSIS_SOURCES.find((s) => s.id === "pipelines");
    const params = buildAnalysisParams(pipe, [SQUARE]);
    expect(params.outFields).toBe("OPERATOR,COMMODITY_DESCRIPTION,DIAMETER,STATUS,SYSTEM_NAME,COUNTY_NAME");
    expect(params.outFields).not.toMatch(/OPER_NM|CMDTY_DESC/); // not the retired Harris-GIS columns
  });
  it("wells/pipelines now point at the authoritative statewide RRC service, not Harris-County GIS (B368)", () => {
    const wells = ANALYSIS_SOURCES.find((s) => s.id === "oilgas");
    const pipe = ANALYSIS_SOURCES.find((s) => s.id === "pipelines");
    for (const s of [wells, pipe]) {
      expect(s.url).toMatch(/gis\.rrc\.texas\.gov/);
      expect(s.url).not.toMatch(/gis\.hctx\.net/); // the retired ~99.8%-incomplete republication
    }
    expect(wells.layer).toBe(1);
    expect(pipe.layer).toBe(13);
    expect(buildAnalysisParams(wells, [SQUARE]).outFields).toBe("API,SYMNUM,GIS_SYMBOL_DESCRIPTION,GIS_WELL_NUMBER");
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

describe("exact counts — returnCountOnly bypasses the page cap (count-mode sources)", () => {
  it("pipelines is a count-mode source", () => {
    expect(ANALYSIS_SOURCES.find((s) => s.id === "pipelines").countMode).toBe(true);
  });
  it("shows the EXACT pipeline count from returnCountOnly, not the capped feature sample", async () => {
    const cache = freshCache();
    const pipe = ANALYSIS_SOURCES.find((s) => s.id === "pipelines");
    const sample = Array.from({ length: 30 }, () => ({ attributes: { OPERATOR: "Kinder Morgan" } }));
    const fetchJson = async (url) => {
      if (/returnCountOnly=true/i.test(url)) return { count: 3207 };       // exact total
      return { features: sample, exceededTransferLimit: true };            // capped page
    };
    const f = await analyzeSource(pipe, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("present");
    expect(f.summary).toMatch(/3207 pipeline segments/);
    expect(f.summary).toMatch(/Kinder Morgan/);
  });
  it("shows the EXACT well count from returnCountOnly", async () => {
    const cache = freshCache();
    const wells = ANALYSIS_SOURCES.find((s) => s.id === "oilgas");
    const fetchJson = async (url) => {
      if (/returnCountOnly=true/i.test(url)) return { count: 7291 };
      return { features: [{ attributes: { API: "42-000" } }] };
    };
    const f = await analyzeSource(wells, [SQUARE], { cache, fetchJson });
    expect(f.summary).toMatch(/7291 wells/);
  });
  it("falls back to the fetched sample size when the count query fails (never throws)", async () => {
    const cache = freshCache();
    const wells = ANALYSIS_SOURCES.find((s) => s.id === "oilgas");
    const fetchJson = async (url) => {
      if (/returnCountOnly=true/i.test(url)) throw new Error("count failed");
      return { features: [{ attributes: { API: "1" } }, { attributes: { API: "2" } }] };
    };
    const f = await analyzeSource(wells, [SQUARE], { cache, fetchJson });
    expect(f.status).toBe("present");
    expect(f.summary).toMatch(/2 wells/);
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
  it("buildRoadFinding: unknown + honest note when no roads matched", () => {
    expect(buildRoadFinding({ roads: [] }).status).toBe("unknown");
    expect(buildRoadFinding({ roads: [], note: "No roads matched within 40 m — screening only." }).summary).toMatch(/no roads matched/i);
    expect(buildRoadFinding({ roads: [] }).rows).toBeNull();
  });
  it("buildRoadFinding: per-road rows, mixed roll-up, map toggle (B94 + B571)", () => {
    const f = buildRoadFinding({ ageMs: 500, roads: [
      { name: "IH 45", route: "h1", authority: { label: "State (TxDOT)" }, funcClass: 1 },
      { name: "Greens Rd", route: "g1", authority: { label: "City" }, funcClass: 4 },
    ] });
    expect(f.status).toBe("info");
    expect(f.mapLayer).toBe("jur_road_authority"); // lifts B190 suppression → the card gets a "◍ Map" toggle
    expect(f.rows[0]).toEqual(["Maintained by", "Mixed — 2 roads", 500]);
    expect(f.rows[1][0]).toBe("IH 45");
    expect(f.rows[1][1]).toBe("State (TxDOT)");
    expect(f.detail[0]).toMatch(/IH 45.*State \(TxDOT\).*Interstate.*route h1/);
  });
  it("buildRoadFinding: one authority across every road rolls up to 'all roads'", () => {
    const f = buildRoadFinding({ roads: [
      { name: "IH 45", authority: { label: "State (TxDOT)" } },
      { name: "Frontage Rd", authority: { label: "State (TxDOT)" } },
    ] });
    expect(f.rows[0][1]).toBe("State (TxDOT) (all roads)");
  });
  it("buildRoadFinding: an unclassified road shows explicit Unknown, never a guess", () => {
    const f = buildRoadFinding({ roads: [{ name: "Mystery Ln", authority: { label: "Unknown" } }] });
    expect(f.rows[1]).toEqual(["Mystery Ln", "Unknown", null]);
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
      "/NFHL/MapServer/28/query": () => [{ attributes: { FLD_ZONE: "AE" } }], // SFHA → a real present constraint
      "Wetlands_gdb_split": () => [],
      "RRC_Public_Viewer_Srvs/MapServer/1/query": () => [],
      "RRC_Public_Viewer_Srvs/MapServer/13/query": () => [],
    });
    const identifyJurisdiction = async () => ({
      county: ["Harris"], city: ["Houston"], etj: [], unincorporated: false, straddle: false,
      ages: { county: 1000 }, sources: [],
    });
    const identifyRoadAuthority = async () => ({ roads: [{ name: "IH 10", route: "h1", authority: { label: "State (TxDOT)" }, funcClass: 1 }], authorities: ["State (TxDOT)"], ageMs: 500, note: "ok" });
    const { findings } = await runSiteAnalysis([SQUARE], { cache, fetchJson, identifyJurisdiction, identifyRoadAuthority });
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(["flood", "wetlands", "pipelines", "oilgas", "contamination", "jurisdiction", "road", "zoning"]);
    expect(findings.find((f) => f.id === "flood").status).toBe("present");
    expect(findings.find((f) => f.id === "zoning").summary).toMatch(/NO zoning/i);
    const road = findings.find((f) => f.id === "road");
    expect(road.rows[0][1]).toMatch(/TxDOT.*all roads/); // single-authority roll-up
    expect(road.rows[1]).toEqual(["IH 10", "State (TxDOT)", null]); // per-road row
  });
  it("survives a jurisdiction-engine throw (keeps arcgis findings, no zoning crash)", async () => {
    const cache = freshCache();
    const fetchJson = fakeFetch({
      "/NFHL/MapServer/28/query": () => [],
      "Wetlands_gdb_split": () => [],
      "RRC_Public_Viewer_Srvs/MapServer/1/query": () => [],
      "RRC_Public_Viewer_Srvs/MapServer/13/query": () => [],
    });
    const identifyJurisdiction = async () => { throw new Error("down"); };
    const identifyRoadAuthority = async () => { throw new Error("down"); };
    const { findings } = await runSiteAnalysis([SQUARE], { cache, fetchJson, identifyJurisdiction, identifyRoadAuthority });
    expect(findings.find((f) => f.id === "flood").status).toBe("absent");
    // jurisdiction/road/zoning fall back to their pending/placeholder rows, not a crash
    expect(findings.find((f) => f.id === "jurisdiction")).toBeTruthy();
  });
});
