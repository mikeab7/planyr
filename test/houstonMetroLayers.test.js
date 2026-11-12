/* Houston-metro sweep (NEW-1 MTFP · NEW-2 airport tiers · NEW-3 evacuation Zip-Zones, 2026-11-12) — the pure rules of lib/houstonMetroLayers.js, the registry rows behind them, and the
 * region rule that keeps them off a Dallas / Georgia site. Every attribute value used below is a REAL value read from the live service on 2026-11-12. */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  MTFP_CLASSES, MTFP_ORDER, mtfpClassKey, mtfpStatusKey, mtfpStyle, mtfpLegend, mtfpOwner, decodePlanCode, planCodeWords, mtfpCard,
  AIRPORTS, parseTier, tierStyle, tierLegend, tierCard, evacZoneKey, evacStyle, evacCard, evacLegend, EVAC_ZONE_COLORS, HOUSTON_METRO_LAYERS, HOUSTON_METRO_VINTAGE,
} from "../src/workspaces/site-planner/lib/houstonMetroLayers.js";
import { HOUSTON, HOUSTON_ROW_STANDARDS } from "../src/shared/thoroughfare/houston.js";
import { ALL_LAYERS, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { GIS_SOURCES, auditRegistry, SOURCE_FIXTURE_REACH } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { REGION_ZONES, layerAvailableHere, inRegion } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { LAYER_TIER as LAYER_WEIGHT } from "../src/workspaces/site-planner/lib/layerWeight.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = ["harris_mtfp", "has_airport_tiers", "tx_evac_zones"];
const P = {
  aldine: { lat: 29.88597, lng: -95.36890 }, iah: { lat: 29.99, lng: -95.34 }, hobby: { lat: 29.645, lng: -95.277 }, katy: { lat: 29.79, lng: -95.82 },
  anahuac: { lat: 29.5857, lng: -94.4188 }, grandPort: { lat: 29.807276, lng: -94.877079 }, galveston: { lat: 29.3, lng: -94.8 },
  dallas: { lat: 32.78, lng: -96.8 }, austin: { lat: 30.27, lng: -97.74 }, atlanta: { lat: 33.75, lng: -84.39 },
};
const shows = (id, st, pt) => layerAvailableHere(ALL_LAYERS[id], { state: st, loc: pt });
const textOf = (card) => [card.title, ...card.rows.flatMap((r) => [r.label, r.text])].join(" | ");

describe("the registry rows", () => {
  it("all three layers are in the registry, Texas-only, with a declared region and a registry-owned URL", () => {
    for (const id of IDS) {
      const c = ALL_LAYERS[id];
      expect(c, id).toBeTruthy();
      expect(c.states, id).toEqual(["TX"]);
      expect(c.regions.length, id).toBeGreaterThan(0);
      for (const r of c.regions) expect(REGION_ZONES[r] || SERVICE_AREAS[r], `${id}: region ${r}`).toBeTruthy();
      expect(typeof c.identifyCard, id).toBe("function");
      expect(c.styleFn && c.legend.length, id).toBeTruthy();
    }
    expect(ALL_LAYERS.harris_mtfp.url).toBe(GIS_SOURCES.harrisMtfp.serviceUrl);
    expect(ALL_LAYERS.has_airport_tiers.url).toBe(GIS_SOURCES.hasAirspaceTiers.serviceUrl);
    expect(ALL_LAYERS.tx_evac_zones.url).toBe(GIS_SOURCES.txEvacZones.serviceUrl);
    expect(ALL_LAYERS.harris_mtfp.where).toBe(GIS_SOURCES.harrisMtfp.where);
  });
  it("each row reads its endpoint from a host measured CORS-open — none is routed through the relay", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].url, id).toMatch(/^https:\/\/(www\.gis\.hctx\.net|geogimsms\.houstontx\.gov|services\.arcgis\.com)\//);
    expect(GIS_SOURCES.harrisMtfp.serviceUrl).toMatch(/\/Transportation\/MTFP\/MapServer\/0$/);
    expect(GIS_SOURCES.hasAirspaceTiers.serviceUrl).toMatch(/\/HPC\/Houston_Airport_System\/MapServer\/7$/);
    expect(GIS_SOURCES.hasAirspaceTiers.serviceUrl).not.toMatch(/mycity2/); // "Service not started" — the sweep's note
    expect(GIS_SOURCES.txEvacZones.serviceUrl).toMatch(/HurricaneEvac_Zones\/FeatureServer\/0$/);
  });
  it("the registry audit is clean with these rows in it (shape, tier, state scope, fixtures with real reach)", () => {
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems.filter((p) => /harrisMtfp|hasAirspaceTiers|txEvacZones/.test(p))).toEqual([]);
    for (const k of ["harrisMtfp", "hasAirspaceTiers", "txEvacZones"]) {
      expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(3);
      expect(SOURCE_FIXTURE_REACH[k][0], k).toBe("regional");
    }
  });
  it("every layer carries a weight tier and a vintage string (the panel's honest 'vintage unknown' is never shown)", () => {
    for (const id of IDS) { expect(LAYER_WEIGHT[id], id).toBeTruthy(); expect(HOUSTON_METRO_VINTAGE[id], id).toBeTruthy(); expect(layerVintage(id, ALL_LAYERS[id]), id).toBe(HOUSTON_METRO_VINTAGE[id]); }
  });
});

describe("where each layer is offered (constraint #3 — no Texas row on a non-Texas site)", () => {
  it("MTFP: Houston and Katy (Harris County) yes; Dallas and Atlanta no", () => {
    expect(shows("harris_mtfp", "TX", P.aldine)).toBe(true);
    expect(shows("harris_mtfp", "TX", P.katy)).toBe(true);
    expect(shows("harris_mtfp", "TX", P.dallas)).toBe(false);
    expect(shows("harris_mtfp", "GA", P.atlanta)).toBe(false);
  });
  it("airport tiers: the Houston metro yes (IAH, Hobby, Katy); Dallas and Atlanta no", () => {
    for (const pt of [P.iah, P.hobby, P.katy]) expect(shows("has_airport_tiers", "TX", pt)).toBe(true);
    expect(shows("has_airport_tiers", "TX", P.dallas)).toBe(false);
    expect(shows("has_airport_tiers", "GA", P.atlanta)).toBe(false);
  });
  it("evacuation zones: Anahuac, Grand Port (Chambers), Galveston and Houston yes; Dallas, Austin and Atlanta no", () => {
    for (const pt of [P.anahuac, P.grandPort, P.galveston, P.aldine]) expect(shows("tx_evac_zones", "TX", pt)).toBe(true);
    expect(shows("tx_evac_zones", "TX", P.dallas)).toBe(false);
    expect(shows("tx_evac_zones", "TX", P.austin)).toBe(false);
    expect(shows("tx_evac_zones", "GA", P.atlanta)).toBe(false);
  });
  it("the Zip-Zone region is a box over the layer's extent, and inRegion answers a box like any other region", () => {
    expect(REGION_ZONES.tx_gulf_evac.bbox).toHaveLength(4);
    expect(inRegion("tx_gulf_evac", P.anahuac)).toBe(true);
    expect(inRegion("tx_gulf_evac", P.dallas)).toBe(false);
    expect(inRegion("tx_gulf_evac", null)).toBeNull(); // no location: cannot tell, so it never hides a row
  });
});

describe("NEW-1 · Houston MTFP", () => {
  it("the street-class crosswalk is the B721 ingest's own (one crosswalk, not two) and every class it yields has ink", () => {
    for (const [raw, canon] of Object.entries(HOUSTON.classificationCrosswalk)) {
      expect(MTFP_CLASSES[canon], `${raw} → ${canon}`).toBeTruthy();
      expect(mtfpClassKey({ ST_TYPE: raw })).toBe(canon);
    }
    expect(MTFP_ORDER).toHaveLength(5);
  });
  it("every live ST_TYPE value maps as the City's own legend draws it; 'N/A' and blank are not on the map", () => {
    const live = { "Thoroughfare": "major_thoroughfare", "Principal Thoroughfare": "major_thoroughfare", "Major Thoroughfare": "major_thoroughfare", "Freeway": "freeway", "Tollway": "freeway", "Frontage": "freeway", "Major Collector": "collector_major", "Minor Collector": "collector_minor", "Transit Corridor Street": "transit_corridor" };
    for (const [raw, canon] of Object.entries(live)) expect(mtfpClassKey({ ST_TYPE: raw }), raw).toBe(canon);
    expect(mtfpClassKey({ ST_TYPE: "N/A" })).toBeNull();
    expect(mtfpClassKey({ ST_TYPE: null })).toBeNull();
    expect(GIS_SOURCES.harrisMtfp.where).toBe("ROW_STATUS >= 1 AND ROW_STATUS <= 15");
  });
  it("status: the three states, and the layer's one typo ('Suffiicent width') reads as sufficient like the City's map", () => {
    expect(mtfpStatusKey({ ST_STATUS: "Sufficient width" })).toBe("sufficient");
    expect(mtfpStatusKey({ ST_STATUS: "Suffiicent width" })).toBe("sufficient");
    expect(mtfpStatusKey({ ST_STATUS: "To be widened" })).toBe("widen");
    expect(mtfpStatusKey({ ST_STATUS: "Proposed" })).toBe("proposed");
    expect(mtfpStatusKey({ ST_STATUS: "N/A" })).toBeNull();
  });
  it("style: class colour from the City's renderer; proposed is dashed, to-be-widened is thinner, sufficient is plain", () => {
    const base = mtfpStyle({ ST_TYPE: "Thoroughfare", ST_STATUS: "Sufficient width" }, 0.6);
    expect(base.color).toBe("#db0000");
    expect(base.dashArray).toBeUndefined();
    expect(mtfpStyle({ ST_TYPE: "Thoroughfare", ST_STATUS: "Proposed" }, 0.6).dashArray).toBeTruthy();
    expect(mtfpStyle({ ST_TYPE: "Thoroughfare", ST_STATUS: "To be widened" }, 0.6).weight).toBeLessThan(base.weight);
    expect(mtfpStyle({ ST_TYPE: "Tollway", ST_STATUS: "Sufficient width" }, 0.6).color).toBe("#018100");
    expect(mtfpLegend().map((l) => l.label)).toContain("Freeway / tollway");
  });
  it("owner words: the abbreviations the layer holds, including its truncated 'Harris County Toll Road Autho*'", () => {
    expect(mtfpOwner("COH")).toBe("City of Houston");
    expect(mtfpOwner("HCTRA")).toBe("Harris County Toll Road Authority");
    expect(mtfpOwner("Harris County Toll Road Autho*")).toBe("Harris County Toll Road Authority");
    expect(mtfpOwner("TxDOT")).toBe("TxDOT");
    expect(mtfpOwner("FORT BEND")).toBe("Fort Bend County");
    expect(mtfpOwner(" ")).toBe("");
    expect(mtfpOwner(null)).toBe("");
  });
  it("the plan code decodes ONLY when it is exactly class-lanes-width; everything else shows no width (never a guess)", () => {
    expect(decodePlanCode("T-4-100")).toEqual({ prefix: "T", lanes: 4, rowFt: 100, rowFt2: null });
    expect(decodePlanCode("MN-2-60")).toMatchObject({ lanes: 2, rowFt: 60 });
    expect(decodePlanCode("P-6-120/180")).toMatchObject({ lanes: 6, rowFt: 120, rowFt2: 180 });
    expect(decodePlanCode("TCS-4-100")).toMatchObject({ prefix: "TCS", rowFt: 100 });
    for (const bad of [" ", "", null, "MJ", "MJ-4", "MJ-4-", "TCS", "MN", "TCS-2-varies(80-90)", "X-4-100"]) expect(decodePlanCode(bad), String(bad)).toBeNull();
    expect(planCodeWords("T-4-100")).toBe("4 lanes · 100 ft right-of-way");
    expect(planCodeWords("P-6-120/180")).toContain("120 / 180 ft");
    expect(planCodeWords("MJ-4-")).toBeNull();
  });
  it("the decode agrees with the City's own minimum right-of-way table (houston.js, verified V274): T=100, MJ=80, MN=60", () => {
    const rowOf = (cls) => HOUSTON_ROW_STANDARDS.find((r) => r.classification === cls).ultimate_row_ft;
    expect(decodePlanCode("T-4-100").rowFt).toBe(rowOf("major_thoroughfare"));
    expect(decodePlanCode("MJ-4-80").rowFt).toBe(rowOf("collector_major"));
    expect(decodePlanCode("MN-2-60").rowFt).toBe(rowOf("collector_minor"));
  });
  it("the Aldine card (Hardy Toll Rd): name, class, status, owner in words, no invented width — a freeway says who sets it", () => {
    const c = mtfpCard({ FULL_NAME: "HARDY TOLL RD", ST_TYPE: "Tollway", ST_STATUS: "Sufficient width", OWNERSHIP: "HCTRA", HIER_TABLE: " ", JDT: "ETJ", LastMTFPA: " " });
    expect(c.title).toBe("Hardy Toll Rd");
    const t = textOf(c);
    expect(t).toContain("Tollway");
    expect(t).toContain("Sufficient width");
    expect(t).toContain("Harris County Toll Road Authority");
    expect(t).toContain("Set by the highway or toll agency");
    expect(t).not.toMatch(/lanes|\d+ ft/);
    expect(c.rows.find((r) => r.href).href).toBe(HOUSTON.sourceUrl);
  });
  it("a clean card (#45): decoded section on a thoroughfare, no blank/null/raw-field rows, no raw field names", () => {
    const c = mtfpCard({ FULL_NAME: "Westheimer Rd", ST_TYPE: "Thoroughfare", ST_STATUS: "To be widened", OWNERSHIP: "COH", HIER_TABLE: "T-4-70", JDT: "Limit", LastMTFPA: "2022-AA" });
    expect(c.title).toBe("Westheimer Rd");
    expect(c.rows.find((r) => r.label === "Planned section").text).toBe("4 lanes · 70 ft right-of-way");
    expect(c.rows.find((r) => r.label === "Where").text).toBe("Inside Houston city limits");
    expect(c.rows.find((r) => r.label === "Last plan amendment").text).toBe("2022-AA");
    for (const r of c.rows) { expect(r.text).toBeTruthy(); expect(r.label + r.text).not.toMatch(/HIER_TABLE|ST_TYPE|ST_STATUS|OWNERSHIP|OBJECTID|null/i); }
    const blank = mtfpCard({ FULL_NAME: "X", ST_TYPE: "Minor Collector", ST_STATUS: "Sufficient width", OWNERSHIP: " ", HIER_TABLE: " ", JDT: " ", LastMTFPA: " " });
    expect(blank.rows.map((r) => r.label)).toEqual(["Class", "Status", "Plan"]);
  });
  it("the layer row follows the owner rules: 100% starts are the registry's; labels print on the road; info on click only", () => {
    const c = ALL_LAYERS.harris_mtfp;
    expect(c.minZoom).toBeGreaterThanOrEqual(10);
    expect(c.lineLabel.field).toBe("FULL_NAME");
    /* MEASURED 2026-11-12 (verify-houston-metro-live, Westheimer Rd at z15, 1,738 roads in view): street names bound from z14 stalled the page 3,543 ms (budget 2,500); from z16 the same view is 81 ms and the labelled z16 view 422 ms. */
    expect(c.lineLabel.minZoom).toBeGreaterThanOrEqual(16);
    expect(c.role).toBe("line");
    expect(c.hoverFields).toBeUndefined();
  });
});

describe("NEW-2 · Houston Airport System tiers", () => {
  it("the nine live tier names parse to an airport and a tier number", () => {
    const live = { "GBIA Tier 1": ["gbia", 1], "GBIA Tier 2": ["gbia", 2], "GBIA Tier 3": ["gbia", 3], "Hobby Tier 1": ["hobby", 1], "Hobby Tier 2": ["hobby", 2], "Hobby Tier 3": ["hobby", 3], "Ellington-Tier 1": ["ellington", 1], "Ellington-Tier 2": ["ellington", 2], "Ellington-Tier 3": ["ellington", 3] };
    for (const [raw, [airport, tier]] of Object.entries(live)) expect(parseTier(raw), raw).toEqual({ airport, tier });
    expect(parseTier("Tier 9")).toBeNull();
    expect(parseTier(null)).toBeNull();
  });
  it("every tier has its own City colour and a legend row, grouped under its airport (#50 shape: heading then one row each)", () => {
    const colors = Object.values(AIRPORTS).flatMap((a) => a.colors);
    expect(new Set(colors).size).toBe(9);
    const lg = tierLegend();
    expect(lg.filter((l) => l.heading).map((l) => l.label)).toEqual(["Bush Intercontinental", "Hobby", "Ellington Field"]);
    expect(lg.filter((l) => l.row)).toHaveLength(9);
    expect(tierStyle({ Tier: "GBIA Tier 1" }, 1).fillColor).toBe("#2bad24");
    expect(tierStyle({ Tier: "nonsense" }, 1).fillColor).toBe("#9ca3af");
  });
  it("the IAH card: tier + airport + the ordinance cite — and NO height number anywhere (#4)", () => {
    const c = tierCard({ Tier: "GBIA Tier 1" });
    expect(c.title).toBe("Bush Intercontinental · Tier 1");
    const t = textOf(c);
    expect(t).toContain("Bush Intercontinental (IAH)");
    expect(t).toContain("Tier 1 of 3");
    expect(t).toContain("Chapter 9");
    expect(t).toContain("Articles VI");
    expect(t).not.toMatch(/\bArticle V\b(?!I)/); // the sweep said "Art. V"; the City's own zoning letters say VI and VII
    expect(t).not.toMatch(/\d+\s*(ft|feet|foot|')/i);
    expect(c.rows.find((r) => r.href)).toBeTruthy();
    expect(tierCard({ Tier: "Hobby Tier 2" }).title).toBe("Hobby · Tier 2");
    expect(tierCard({ Tier: "Ellington-Tier 3" }).rows.find((r) => r.label === "Airport").text).toContain("Ellington");
  });
  it("only the sourced meaning is claimed: Tier 1 is closest to the runways, nothing about Tier 2 or 3 beyond 'one of three'", () => {
    for (const tier of ["GBIA Tier 1", "GBIA Tier 2", "GBIA Tier 3"]) expect(textOf(tierCard({ Tier: tier }))).toContain("Tier 1 is the area closest to the airport's runways");
    expect(textOf(tierCard({ Tier: "GBIA Tier 3" }))).not.toMatch(/outermost|middle|inner/i);
  });
  it("the layer is a constraint-tier row in the Jurisdictions group (the City regulates height by tier)", () => {
    expect(ALL_LAYERS.has_airport_tiers.group).toBe("jurisdiction");
    expect(LAYER_WEIGHT.has_airport_tiers).toBe("constraint");
  });
});

describe("NEW-3 · hurricane evacuation Zip-Zones", () => {
  it("the four live zone values (A, B, C, Coastal) key to a colour; unknown values do not", () => {
    for (const z of ["Zip-Zone A", "Zip-Zone B", "Zip-Zone C", "Zip-Zone Coastal"]) expect(evacZoneKey(z), z).toBeTruthy();
    expect(evacZoneKey("Zip-Zone A")).toBe("A");
    expect(evacZoneKey("Zip-Zone Coastal")).toBe("COASTAL");
    expect(evacZoneKey("Zone D")).toBeNull();
    expect(evacLegend().map((l) => l.label)).toEqual(["Zip-Zone A", "Zip-Zone B", "Zip-Zone C", "Zip-Zone Coastal"]);
    expect(new Set(Object.values(EVAC_ZONE_COLORS)).size).toBe(4);
    expect(evacStyle({ Zone: "Zip-Zone B" }, 1).fillColor).toBe(EVAC_ZONE_COLORS.B);
  });
  it("the Anahuac card (Chambers, Zip-Zone A, '77514 S'): zone, place + ZIP, county, 'not a flood zone'", () => {
    const c = evacCard({ Zone: "Zip-Zone A", Zip5digit: "77514 S", Name: "ANAHUAC", County: "CHAMBERS", ZIP_Evac: " ", Direction: "S" });
    expect(c.title).toBe("Zip-Zone A");
    const t = textOf(c);
    expect(t).toContain("Anahuac · ZIP 77514 S");
    expect(t).toContain("Chambers");
    expect(t).toContain("not a flood zone");
    expect(t).toContain("Evacuation is ordered by zone");
  });
  it("a Zone B polygon with no ZIP (Winnie) and a blank-county row print cleanly — no blank rows", () => {
    const c = evacCard({ Zone: "Zip-Zone B", Zip5digit: " ", Name: "WINNIE", County: "CHAMBERS", ZIP_Evac: " " });
    expect(c.rows.find((r) => r.label === "Area").text).toBe("Winnie");
    const blank = evacCard({ Zone: "Zip-Zone Coastal", Zip5digit: " ", Name: " ", County: " " });
    expect(blank.title).toBe("Zip-Zone Coastal");
    expect(blank.rows.map((r) => r.label)).toEqual(["What it is"]);
  });
  it("the row sits in Flood & Drainage as an advisory 'reference' flag, and its note says the five counties it covers", () => {
    const c = ALL_LAYERS.tx_evac_zones;
    expect(c.group).toBe("flood");
    expect(c.floodTier).toBe("advisory");
    expect(LAYER_WEIGHT.tx_evac_zones).toBe("reference");
    for (const county of ["Brazoria", "Chambers", "Galveston", "Harris", "Matagorda"]) expect(c.note + c.infoCaveat).toContain(county);
  });
});

describe("the layers table as a whole", () => {
  it("exports exactly the three rows the registry spreads", () => {
    expect(Object.keys(HOUSTON_METRO_LAYERS).sort()).toEqual([...IDS].sort());
  });
});
