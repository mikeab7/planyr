/* NEW-1 (Georgia due-diligence gaps, 2026-10-29) — the Georgia layer rows (georgiaLayers.js).
 *
 * What this pins, each a way the work could be wrong in front of a developer:
 *   · a row offered OUTSIDE its state / region (a Texas, Tennessee or Savannah site listing a metro-Atlanta-only layer);
 *   · a row whose URL or `where` is typed twice and drifts from the GIS source registry;
 *   · a regulatory number with no citation, or a card that prints a raw field name / "null" / "undefined";
 *   · a legend that disagrees with the colours the style function actually paints;
 *   · the protected-river 100 ft buffer tier (widest tier, wider rule governs).
 * The live arm (real services, real map) is ui-audit/verify-georgia-due-diligence-live.mjs. */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS, MERGE_GROUPS, LAYER_GROUP_ORDER, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import {
  GEORGIA_LAYERS, GEORGIA_MERGE_GROUPS, GEORGIA_VINTAGE, susceptibilityStyle, SUSCEPTIBILITY_COLORS, conservationStyle, conservationKind, CONSERVATION_COLORS,
  jtcStyle, JTC_COLORS, spaldingZoneClass, SPALDING_COLORS, spaldingStyle, impairedCategories, solidWasteType, sentence,
} from "../src/workspaces/site-planner/lib/georgiaLayers.js";
import { layerAvailableHere } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { streamBufferBands, GA_BUFFER_TIERS, bufferLegend } from "../src/workspaces/site-planner/lib/georgiaStreamBuffers.js";
import { VECTOR_SOURCES } from "../src/workspaces/site-planner/lib/vectorLayers.js";

const IDS = Object.keys(GEORGIA_LAYERS);
_setServiceAreas(SERVICE_AREAS);

const SAVANNAH = { lat: 32.08, lng: -81.10 }, ATLANTA = { lat: 33.75, lng: -84.39 }, ROSWELL = { lat: 33.9982, lng: -84.3348 };
const HOUSTON = { lat: 29.76, lng: -95.37 }, NASHVILLE = { lat: 36.16, lng: -86.78 }, GRIFFIN = { lat: 33.2468, lng: -84.2641 }, BUTTS = { lat: 33.29, lng: -83.97 };
const shown = (id, loc) => layerAvailableHere(ALL_LAYERS[id], { loc });

describe("every Georgia due-diligence row is declared complete and Georgia-only", () => {
  it("the module registers nineteen rows and every one reaches ALL_LAYERS", () => {
    expect(IDS.length).toBe(19);
    for (const id of IDS) expect(ALL_LAYERS[id], id).toBe(GEORGIA_LAYERS[id]);
  });
  it("each row is states:[GA], an esriFeature, in a real panel group, with a label, source, note, role and order", () => {
    for (const id of IDS) {
      const c = GEORGIA_LAYERS[id];
      expect(c.states, id).toEqual(["GA"]);
      expect(c.kind, id).toBe("esriFeature");
      expect(LAYER_GROUP_ORDER, id).toContain(c.group);
      expect(c.label.length, id).toBeGreaterThan(3);
      expect(c.source, id).toBeTruthy();
      expect(c.note.length, id).toBeGreaterThan(60);
      expect(["area", "line", "point"], id).toContain(c.role);
      expect(typeof c.order, id).toBe("number");
      expect(c.hoverIdentify && c.canvasIdentify, id).toBe(true);
    }
  });
  it("no row restricts `fields`: esri-leaflet keys features by object id, and an outFields list without it collapses a layer to ONE feature (seen live: 50 river segments drew as one)", () => {
    for (const id of IDS) expect(GEORGIA_LAYERS[id].fields, id).toBeUndefined();
  });
  it("the URL and any `where` are READ FROM the GIS source registry, never typed twice", () => {
    const KEY = {
      ga_recharge: "gaRecharge", ga_gw_susceptibility: "gaPollutionSusc", ga_protected_rivers: "gaProtectedRiver", ga_protected_mountains: "gaProtectedMountain", ga_swsw: "gaSwsw",
      ga_swsw_protected: "gaSwswProtected", ga_karst: "gaCarbonate", ga_solid_waste: "gaSolidWaste", ga_brownfields: "gaBrownfields", ga_dams: "gaDams", ga_impaired_streams: "gaImpaired",
      ga_conservation: "gaConservation", ga_mrpa_corridor: "gaMrpaCorridor", ga_mrpa_buffer_150: "gaMrpaImpBuffer", ga_mrpa_buffer_50: "gaMrpaVegBuffer", ga_mrpa_buffer_35: "gaMrpaTributaryBuffer",
      ga_opportunity_zones: "gaOpportunityZones", ga_jtc_tiers: "gaJobTaxCredit", ga_spalding_zoning: "gaSpaldingZoning",
    };
    expect(Object.keys(KEY).sort()).toEqual([...IDS].sort());
    for (const [id, key] of Object.entries(KEY)) {
      expect(GEORGIA_LAYERS[id].url, id).toBe(GIS_SOURCES[key].serviceUrl);
      expect(GEORGIA_LAYERS[id].where, id).toBe(GIS_SOURCES[key].where);
      expect(GIS_SOURCES[key].states, key).toEqual(["GA"]);
      expect(GIS_SOURCES[key].serviceUrl, key).toMatch(/^https:\/\/services\d*\.arcgis\.com\//); // an agency's ArcGIS Online org: hosted, https, CORS-open
    }
  });
  it("the three filtered rows keep their filter (an unfiltered carbonate / impaired / susceptibility layer would be a different, wrong map)", () => {
    expect(GEORGIA_LAYERS.ga_karst.where).toMatch(/STATE = 'GA'.*Sedimentary, carbonate/);
    expect(GEORGIA_LAYERS.ga_impaired_streams.where).toBe("Assessment = 'Not Supporting'");
    expect(GEORGIA_LAYERS.ga_gw_susceptibility.where).toBe("CLASS <> 'WATER'");
  });
  it("every row names its edition in the (i) — never 'vintage unknown'", () => {
    for (const id of IDS) { expect(GEORGIA_VINTAGE[id], id).toBeTruthy(); expect(layerVintage(id, ALL_LAYERS[id]), id).toBe(GEORGIA_VINTAGE[id]); }
  });
  it("the two merged rows have a MERGE_GROUPS record and keep their members in ONE panel group", () => {
    for (const g of Object.keys(GEORGIA_MERGE_GROUPS)) {
      expect(MERGE_GROUPS[g]).toBe(GEORGIA_MERGE_GROUPS[g]);
      const members = IDS.filter((id) => GEORGIA_LAYERS[id].mergeGroup === g);
      expect(members.length, g).toBeGreaterThan(1);
      expect(new Set(members.map((id) => GEORGIA_LAYERS[id].group)).size, g).toBe(1);
    }
    expect(IDS.filter((id) => GEORGIA_LAYERS[id].mergeGroup === "ga_mrpa").length).toBe(4);
  });
  it("a layer with a legend paints only the colours the legend shows", () => {
    expect(SUSCEPTIBILITY_COLORS.HIGH).toBe(GEORGIA_LAYERS.ga_gw_susceptibility.legend[0].color);
    expect(GEORGIA_LAYERS.ga_gw_susceptibility.legend.map((l) => l.color)).toEqual([SUSCEPTIBILITY_COLORS.HIGH, SUSCEPTIBILITY_COLORS.AVERAGE, SUSCEPTIBILITY_COLORS.LOW]);
    expect(new Set(GEORGIA_LAYERS.ga_conservation.legend.map((l) => l.color))).toEqual(new Set(Object.values(CONSERVATION_COLORS)));
    expect(GEORGIA_LAYERS.ga_jtc_tiers.legend.map((l) => l.label)).toEqual(Object.keys(JTC_COLORS));
    for (const [k, c] of Object.entries(SPALDING_COLORS)) expect(GEORGIA_LAYERS.ga_spalding_zoning.legend.map((l) => l.color), k).toContain(c);
  });
});

describe("a row is never offered where its source cannot answer", () => {
  it("no Georgia row is listed for a Houston or Nashville site", () => {
    for (const id of IDS) { expect(shown(id, HOUSTON), `${id} @ Houston`).toBe(false); expect(shown(id, NASHVILLE), `${id} @ Nashville`).toBe(false); }
  });
  it("every statewide row IS listed in Atlanta and Savannah", () => {
    const regional = IDS.filter((id) => GEORGIA_LAYERS[id].regions);
    for (const id of IDS.filter((x) => !regional.includes(x))) { expect(shown(id, ATLANTA), id).toBe(true); expect(shown(id, SAVANNAH), id).toBe(true); }
  });
  it("the metro-Atlanta rows (MRPA corridor, water-supply watersheds) are hidden at Savannah and Griffin, shown on the Chattahoochee", () => {
    const metro = IDS.filter((id) => (GEORGIA_LAYERS[id].regions || []).includes("mngwpd"));
    expect(metro.length).toBe(6);
    for (const id of metro) { expect(shown(id, SAVANNAH), `${id} @ Savannah`).toBe(false); expect(shown(id, GRIFFIN), `${id} @ Griffin`).toBe(false); expect(shown(id, ROSWELL), `${id} @ Roswell`).toBe(true); }
  });
  it("Spalding County zoning shows in Spalding, not in Butts (the neighbour) or Atlanta", () => {
    expect(shown("ga_spalding_zoning", GRIFFIN)).toBe(true);
    expect(shown("ga_spalding_zoning", BUTTS)).toBe(false);
    expect(shown("ga_spalding_zoning", ATLANTA)).toBe(false);
  });
  it("every declared region has real geometry in the bundled service areas", () => {
    for (const id of IDS) for (const r of GEORGIA_LAYERS[id].regions || []) expect(SERVICE_AREAS[r] && SERVICE_AREAS[r].polys.length, `${id}:${r}`).toBeGreaterThan(0);
  });
});

describe("regulatory numbers are cited to the rule that sets them", () => {
  const note = (id) => GEORGIA_LAYERS[id].note + " " + (GEORGIA_LAYERS[id].infoCaveat || "");
  it("protected rivers: 400 cfs, 100 ft, O.C.G.A. 12-2-8 and Rule 391-3-16-.04", () => { for (const t of ["400 cfs", "100-ft", "12-2-8", "391-3-16-.04"]) expect(note("ga_protected_rivers")).toContain(t); });
  it("protected mountains: 2,200 ft, 25%, 500 ft, Rule 391-3-16-.05", () => { for (const t of ["2,200 ft", "25%", "500 ft", "391-3-16-.05"]) expect(note("ga_protected_mountains")).toContain(t); });
  it("recharge and susceptibility name Rule 391-3-16-.02 and the Hydrologic Atlas", () => {
    expect(note("ga_recharge")).toContain("391-3-16-.02"); expect(GEORGIA_LAYERS.ga_recharge.source).toContain("Hydrologic Atlas 18");
    expect(note("ga_gw_susceptibility")).toContain("391-3-16-.02"); expect(GEORGIA_LAYERS.ga_gw_susceptibility.source).toContain("Hydrologic Atlas 20");
  });
  it("the watersheds say DISTRICT ONLY — a blank map elsewhere is not an all-clear — and cite Rule 391-3-16-.01(7)", () => {
    expect(note("ga_swsw")).toMatch(/DISTRICT COUNTIES ONLY/); expect(note("ga_swsw")).toContain("391-3-16-.01(7)");
  });
  it("the MRPA rows cite the Act and ARC, and the buffer widths are the corridor plan's 50 / 35 / 150 ft", () => {
    expect(note("ga_mrpa_corridor")).toContain("12-5-440");
    expect(GEORGIA_LAYERS.ga_mrpa_buffer_50.note).toContain("50-ft"); expect(GEORGIA_LAYERS.ga_mrpa_buffer_35.note).toContain("35-ft"); expect(GEORGIA_LAYERS.ga_mrpa_buffer_150.note).toContain("150-ft");
  });
  it("karst says it is a proxy and that absence is NOT an all-clear", () => { expect(note("ga_karst")).toMatch(/SCREEN FOR KARST/); expect(note("ga_karst")).toMatch(/NOT an all-clear/); });
  it("zoning shows the code only and says why district names are withheld", () => { expect(note("ga_spalding_zoning")).toMatch(/District names are not shown/); });
});

describe("the click cards print plain words — never a raw field, 'null' or 'undefined'", () => {
  const samples = {
    ga_recharge: { NAME: "FLORIDAN/JACKSONIAN" }, ga_gw_susceptibility: { CLASS: "HIGH", SCORE: 8 }, ga_protected_rivers: { FENAME: "Etowah River" }, ga_protected_mountains: { GRIDCODE: 1 },
    ga_swsw: { NAME: "Towaliga River", SYS_NAME: "Henry County", County: "Henry", areasqmi: 40 }, ga_swsw_protected: { DrH2Osrce: "Tussahaw Reservoir", Ownop: "Henry County", County: "Henry" },
    ga_karst: { UNIT_NAME: "Knox Group undifferentiated" }, ga_solid_waste: { Facility_Name: "RIVER BLUFF ROAD INERT LF", Interest_Type: "SW- Inert Landfill", Operating_Status: "Operating", Permit_Number: "PBR-024-02IL", County: "Charlton" },
    ga_brownfields: { PropertyName: "Reserve at Collier Hills", Address: "1185 Collier Rd.", City: "Atlanta", County: "Fulton", LOLIssueDate: 1347494400000, Acreage: 18.66 },
    ga_dams: { Dam_Name: "Pumpkinvine Creek W/S Str. #01 Dam", County: "Paulding", Classification: "I", Dam_Height: 43, State_ID: "110-001-01279" },
    ga_impaired_streams: { Name: "Intrenchment Creek", Location: "Headwaters to South River, Atlanta", Category: "4a, 5", Cause: "Bio F, E Coli", Uses: "Fishing" },
    ga_conservation: { Unit_Nm: "Wormsloe Easement", Own_Name: "Private with Easement or Covenant", Category: "Easement", EsmtHldr: "Georgia Department of Natural Resources", Pub_Access: "Closed" },
    ga_mrpa_corridor: {}, ga_mrpa_buffer_150: {}, ga_mrpa_buffer_50: {}, ga_mrpa_buffer_35: {},
    ga_opportunity_zones: { NAMELSAD10: "Census Tract 78.05", County: "Fulton" }, ga_jtc_tiers: { fullName: "Spalding County", Tier26: "Tier 2", Rank26: 72, Tier25: "Tier 1" }, ga_spalding_zoning: { LABEL: "C2", DESCRIPTION: "MANUFACTURING--LIGHT" },
  };
  it("every row has a sample and a card", () => { expect(Object.keys(samples).sort()).toEqual([...IDS].sort()); for (const id of IDS) expect(typeof GEORGIA_LAYERS[id].identifyCard, id).toBe("function"); });
  it("no card prints a raw field name, a null, or an undefined — and every card has a title", () => {
    const RAW = /\b(OBJECTID|FENAME|GRIDCODE|CLASS|NAMELSAD10|LOLIssueDate|Dam_Height|Facility_Name|Interest_Type|Tier26|Rank26|SYS_NAME|DrH2Osrce|UNIT_NAME|Unit_Nm|EsmtHldr|Pub_Access)\b/;
    for (const id of IDS) {
      const c = GEORGIA_LAYERS[id].identifyCard(samples[id], { lat: 33, lng: -84 });
      const all = [c.title, ...c.rows.map((r) => `${r.label}: ${r.text}`), c.note || ""].join(" | ");
      expect(c.title, id).toBeTruthy();
      expect(all, id).not.toMatch(/null|undefined|NaN/);
      expect(all, id).not.toMatch(RAW);
      for (const r of c.rows) { expect(r.label, id).toBeTruthy(); expect(r.text, id).toBeTruthy(); }
    }
  });
  it("an empty-attribute feature still produces a card with a title and no blank rows (a withheld value is omitted, not shown)", () => {
    for (const id of IDS) {
      const c = GEORGIA_LAYERS[id].identifyCard({}, {});
      expect(c.title, id).toBeTruthy();
      for (const r of c.rows) expect(r.text, id).toBeTruthy();
    }
  });
  it("EPD's shouted facility names are sentence-cased; mixed-case values are left as published", () => {
    expect(sentence("RIVER BLUFF ROAD INERT LF")).toBe("River Bluff Road Inert Lf");
    expect(sentence("Etowah River")).toBe("Etowah River");
    expect(sentence("  ")).toBe("");
  });
  it("solid waste type drops EPD's 'SW-' prefix; impaired categories explain themselves and an unknown code is kept, not invented", () => {
    expect(solidWasteType("SW- Municipal Solid Waste Landfill")).toBe("Municipal Solid Waste Landfill");
    expect(impairedCategories("4a, 5").map((c) => c.meaning)).toEqual([expect.stringMatching(/TMDL\) is in place/), expect.stringMatching(/needs a cleanup plan/)]);
    expect(impairedCategories("9z")).toEqual([{ code: "9z", meaning: null }]);
  });
  it("dams and brownfields format class, height, acreage and the liability date", () => {
    const dam = GEORGIA_LAYERS.ga_dams.identifyCard(samples.ga_dams);
    expect(dam.rows.find((r) => r.label === "Hazard class").text).toMatch(/^Class I — .*lives/);
    expect(dam.rows.find((r) => r.label === "Height").text).toBe("43 ft");
    const bf = GEORGIA_LAYERS.ga_brownfields.identifyCard(samples.ga_brownfields);
    expect(bf.rows.find((r) => r.label === "Liability limitation issued").text).toBe("Sep 13, 2012");
    expect(bf.rows.find((r) => r.label === "Acreage").text).toBe("18.7 AC");
  });
});

describe("styles", () => {
  it("susceptibility: three distinct classes, an unknown class is neutral grey (never a guessed class)", () => {
    const c = (k) => susceptibilityStyle({ CLASS: k }, 1).fillColor;
    expect(new Set([c("HIGH"), c("AVERAGE"), c("LOW")]).size).toBe(3);
    expect(c("MYSTERY")).toBe("#94a3b8");
  });
  it("fills are proportional to the slider (the print path multiplies the same base — PDF-PARITY)", () => {
    expect(susceptibilityStyle({ CLASS: "HIGH" }, 1).fillOpacity).toBeCloseTo(0.4); expect(susceptibilityStyle({ CLASS: "HIGH" }, 0.5).fillOpacity).toBeCloseTo(0.2);
    expect(GEORGIA_LAYERS.ga_recharge.styleFn({}, 0.5).fillOpacity).toBeCloseTo(0.175);
  });
  it("conservation: an easement over private land has its own colour", () => {
    expect(conservationKind({ Category: "Easement" })).toBe("Easement"); expect(conservationKind({ Category: " " })).toBe("Other"); expect(conservationKind({})).toBe("Other");
    expect(conservationStyle({ Category: "Easement" }, 1).fillColor).not.toBe(conservationStyle({ Category: "Fee" }, 1).fillColor);
  });
  it("job-tax-credit tiers: five distinct fills, darker = less developed", () => {
    expect(new Set(Object.values(JTC_COLORS)).size).toBe(5);
    expect(jtcStyle({ Tier26: "Bottom 40" }, 1).fillColor).toBe(JTC_COLORS["Bottom 40"]);
    expect(jtcStyle({ Tier26: "Tier 9" }, 1).fillColor).toBe("#94a3b8");
  });
  it("Spalding zoning colours by code class; an unrecognised code is 'other', never guessed", () => {
    expect(spaldingZoneClass("C2")).toBe("manufacturing"); expect(spaldingZoneClass("C-1C")).toBe("manufacturing"); expect(spaldingZoneClass("C1")).toBe("commercial");
    expect(spaldingZoneClass("R1")).toBe("residential"); expect(spaldingZoneClass("AR1")).toBe("agricultural"); expect(spaldingZoneClass("PDD")).toBe("planned");
    expect(spaldingZoneClass("ZZ")).toBe("other"); expect(spaldingZoneClass("")).toBe("other"); expect(spaldingZoneClass(null)).toBe("other");
    expect(spaldingStyle({ LABEL: "C2" }, 1).fillColor).toBe(SPALDING_COLORS.manufacturing);
  });
});

describe("the protected-river tier of the Stream Buffers layer", () => {
  const line = (x0) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[x0, 34.0], [x0 + 0.01, 34.0], [x0 + 0.02, 34.01]] } });
  it("a protected river is a 100 ft band — the widest tier, wider than the District's 75", () => {
    expect(GA_BUFFER_TIERS.river.eachSideFt).toBe(100);
    expect(GA_BUFFER_TIERS.river.eachSideFt).toBeGreaterThan(GA_BUFFER_TIERS.district.eachSideFt);
    const bands = streamBufferBands({ rivers: { type: "FeatureCollection", features: [line(-85.2)] } });
    expect(bands.length).toBe(1); expect(bands[0].tier.id).toBe("river"); expect(bands[0].from).toBe("river");
  });
  it("no river source → no river band (a failed source is named by the layer, never drawn as 25 ft)", () => {
    expect(streamBufferBands({ rivers: null }).length).toBe(0);
  });
  it("the legend names the 100 ft tier only when it is on the map", () => {
    const withRiver = streamBufferBands({ rivers: { features: [line(-85.2)] } });
    expect(bufferLegend(withRiver)).toEqual(["100 ft protected-river buffer"]);
    expect(bufferLegend([])).toEqual([]);
  });
  it("its vector source reads the registry row and the fields it asks for exist on that row", () => {
    expect(VECTOR_SOURCES.ga_protected_rivers.query.url).toBe(GIS_SOURCES.gaProtectedRiver.serviceUrl + "/query");
    expect(VECTOR_SOURCES.ga_protected_rivers.query.outFields).toEqual(["FENAME"]);
  });
});
