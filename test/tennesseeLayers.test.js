/* B2521584 — the Tennessee industrial due-diligence layers.
 *
 * What this pins (each was a way an earlier state's set shipped wrong):
 *   · every row is Tennessee-only and offered at Tennessee points — and at NO Texas / Georgia / Mississippi / Kentucky point;
 *   · every row reads a registered GIS_SOURCES endpoint (the agency's own, probed with a date) — no inline third-party copy;
 *   · the two vector rows have their VECTOR_SOURCES entry (a vector row without one draws nothing);
 *   · the click cards are CLEAN (owner constraint #45): plain labels, no raw field names, no empty or null rows, a link is a short label;
 *   · the cards are fed REAL attribute bags recorded from the live services on 2026-10-29. */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { TN_LAYERS, TN_LAYER_IDS, wqaStyle } from "../src/workspaces/site-planner/lib/tennesseeLayers.js";
import { VECTOR_SOURCES, buildQueryUrl } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { LAYER_TIER } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";
import { SOURCE_FIXTURES } from "../src/shared/gis/sourceFixtures.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { PANEL_GROUPS, groupEntriesFor, availableEntries } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { pillsFor } from "../src/workspaces/site-planner/lib/siteLayerPills.js";
import * as cards from "../src/workspaces/site-planner/lib/tennesseeCards.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const groups = PANEL_GROUPS.filter((g) => g.key !== "base").map((g) => g.key);
const offeredAt = (lat, lng) => {
  const scope = { state: siteState({ lat, lng }), loc: { lat, lng } };
  return new Set(groups.flatMap((g) => availableEntries(groupEntriesFor(ALL_LAYERS, g), scope).map(([id]) => id)));
};

/* Christiana / Epps Mill Rd (Rutherford) and Nashville (Davidson) are the owner's real Tennessee sites. */
const TN_POINTS = { christiana: [35.7425, -86.3436], nashville: [36.1627, -86.7816], memphis: [35.1495, -90.049], knoxville: [35.9606, -83.9207], chattanooga: [35.0456, -85.3097] };
const NOT_TN = { houston: [29.7604, -95.3698], dallas: [32.7767, -96.797], atlanta: [33.749, -84.388], oliveBranch: [34.9618, -89.8295], louisville: [38.2527, -85.7585], birmingham: [33.5186, -86.8104] };

describe("every Tennessee row is Tennessee-only and registered whole", () => {
  it("has rows, all scoped to exactly TN", () => {
    expect(TN_LAYER_IDS.length).toBeGreaterThanOrEqual(9);
    for (const id of TN_LAYER_IDS) { expect(ALL_LAYERS[id], id).toBe(TN_LAYERS[id]); expect(ALL_LAYERS[id].states, id).toEqual(["TN"]); }
  });
  it("carries the full row the panel and the stacking model read (capitalised label, source, note, role, group, order, minZoom)", () => {
    for (const id of TN_LAYER_IDS) {
      const c = ALL_LAYERS[id];
      expect(c.label, id).toMatch(/^[A-Z]/);
      expect(c.source, id).toBeTruthy();
      expect(c.note, id).toBeTruthy();
      expect(["line", "point", "area"], id).toContain(c.role);
      expect(["jurisdiction", "flood", "utilities", "environmental", "access", "topography"], id).toContain(c.group);
      expect(Number.isFinite(c.order), id).toBe(true);
      expect(Number.isFinite(c.minZoom), id).toBe(true);
    }
  });
  /* a row's url → the registry's canonical endpoint: a relayed row ("/gis-proxy/<host>/…") names the same server the registry records */
  const canonical = (u) => (String(u).startsWith("/gis-proxy/") ? "https://" + String(u).slice("/gis-proxy/".length) : u);
  const readsRegistry = (id) => ALL_LAYERS[id].kind !== "pipelineCorridor"; // the computed buffer row has no endpoint of its own — its sources are asserted below
  it("reads a registry endpoint — every url IS a GIS_SOURCES serviceUrl (the agency's own, probed with a date)", () => {
    const urls = new Set(Object.values(GIS_SOURCES).map((s) => s.serviceUrl));
    for (const id of TN_LAYER_IDS.filter(readsRegistry)) expect(urls.has(canonical(ALL_LAYERS[id].url)), `${id}: ${ALL_LAYERS[id].url}`).toBe(true);
  });
  it("every registry row it reads is Tennessee-scoped and verified", () => {
    for (const id of TN_LAYER_IDS.filter(readsRegistry)) {
      const src = Object.values(GIS_SOURCES).find((s) => s.serviceUrl === canonical(ALL_LAYERS[id].url));
      expect(src.states, id).toEqual(["TN"]);
      expect(src.tier, id).toBe("production");
      expect(src.lastVerified, id).toMatch(/^2026-10-/);
    }
  });
  it("the computed buffer row's source is registered (USGS NHD) and its status line carries what it does NOT draw", () => {
    expect(ALL_LAYERS.tn_stream_buffers.bufferRule).toBe("tn_streams");
    expect(VECTOR_SOURCES.nhd_flowlines).toBeTruthy();
    expect(ALL_LAYERS.tn_stream_buffers.note).toMatch(/NOT drawn: the permit asks 60 ft/);
    expect(ALL_LAYERS.tn_stream_buffers.note).toMatch(/CENTRELINE/);
    expect(ALL_LAYERS.tn_stream_buffers.infoCaveat).toMatch(/2026-10-01/); // the 2021 rule text vs the reissued permit is said, not hidden
  });
  it("the rows on the State's servers ride the relay (the registry records the server's own address)", () => {
    for (const id of ["tn_landfills", "tn_thc_sites", "tn_nrhp_bounds"]) {
      expect(ALL_LAYERS[id].url, id).toMatch(/^\/gis-proxy\/(maps\.tdec|tnmap)\.tn\.gov\//);
      expect(ALLOWED_HOSTS.has(ALL_LAYERS[id].url.split("/")[2]), id).toBe(true);
    }
  });
  it("NO row reads tdeconline.tn.gov — it refuses the relay (HTTP 403), so a row on it would ship dead", () => {
    for (const id of TN_LAYER_IDS) expect(String(ALL_LAYERS[id].url || ""), id).not.toMatch(/tdeconline/);
  });
  it("sits in a weight tier (reference recedes; county / city lines are context)", () => {
    for (const id of TN_LAYER_IDS) expect(LAYER_TIER[id], id).toBeTruthy();
  });
  it("every polygon row that the service returns WHOLE asks the server to simplify (the draw budget declines a 500k-vertex batch, and zooming in cannot help)", () => {
    for (const id of ["tn_crit_habitat", "tn_nrhp_bounds", "tn_ms4", "tn_pws", "tn_wqa"]) expect(ALL_LAYERS[id].simplifyFactor, id).toBeGreaterThanOrEqual(3);
  });
  it("the 186,000-record THC layer asks only for the fields its card reads", () => {
    expect(ALL_LAYERS.tn_thc_sites.fields).toEqual(expect.arrayContaining(["COMNAME", "PROPADDR", "DATECONST"]));
    // ⛔ without the object id the service sends no feature id, esri-leaflet keys every point under "undefined", and ONE point draws (reproduced against esri-leaflet 3.0.19)
    expect(ALL_LAYERS.tn_thc_sites.fields).toContain("OBJECTID");
    expect(ALL_LAYERS.tn_thc_sites.fields.length).toBeLessThan(15);
  });
  it("no coverage fixture of a Tennessee row sits outside Tennessee (a North Carolina polygon once passed as one)", () => {
    for (const [k, fx] of Object.entries(SOURCE_FIXTURES)) {
      if (!/Tn$/.test(k) && !["countyTn", "cityTn", "roadTn"].includes(k)) continue;
      for (const f of fx.fixtures || []) {
        const pt = f.point || (f.bbox && [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2]);
        expect(siteState({ lat: pt[1], lng: pt[0] }), `${k}: ${f.label}`).toBe("TN");
      }
    }
  });
  it("never offers a hover-only popup it cannot click (constraint #43): a row that identifies also opts into the click card", () => {
    for (const id of TN_LAYER_IDS) { const c = ALL_LAYERS[id]; if (c.hoverIdentify) expect(c.canvasIdentify, id).toBe(true); }
  });
});

describe("the vector rows have their VECTOR_SOURCES entry (a vector row without one draws nothing)", () => {
  for (const id of ["tn_city"]) {
    it(id, () => {
      expect(ALL_LAYERS[id].kind).toBe("vector");
      const v = VECTOR_SOURCES[id];
      expect(v, id).toBeTruthy();
      expect(v.query.url).toBe(`${ALL_LAYERS[id].url}/query`);
    });
  }
  it("Counties & Cities shares the merged row with the other states (county lines are main's tn_county row, B2507065)", () => {
    expect(ALL_LAYERS.tn_county.mergeGroup).toBe("counties_cities");
    expect(ALL_LAYERS.tn_county.states).toContain("TN");
    expect(ALL_LAYERS.tn_city.mergeGroup).toBe("counties_cities");
  });
});

describe("location scope — offered at Tennessee points, nowhere else", () => {
  for (const [name, [lat, lng]] of Object.entries(TN_POINTS)) {
    it(`${name} is Tennessee and is offered every Tennessee row`, () => {
      expect(siteState({ lat, lng })).toBe("TN");
      const offered = offeredAt(lat, lng);
      for (const id of TN_LAYER_IDS) expect(offered.has(id), id).toBe(true);
    });
  }
  for (const [name, [lat, lng]] of Object.entries(NOT_TN)) {
    it(`${name} is offered NO Tennessee row`, () => {
      const offered = offeredAt(lat, lng);
      for (const id of TN_LAYER_IDS) expect(offered.has(id), id).toBe(false);
    });
  }
});

/* ---- the click cards, fed the REAL attribute bags recorded 2026-10-29 ---- */
const RAW_FIELD = /\b(OBJECTID|FACILITY_N|COUNTY_NAM|DCERP_ID|PERMIT_NUM|MA_NAME|PWSID|TINWSYS|SNA_NAME|DESIGNATIO|GISMILES|ASSESSMENT_UNIT|NAME8|CALC_ACRES|GlobalID|Shape__)\b/;
const flat = (card) => JSON.stringify(card);
const noJunk = (card) => {
  expect(card.title).toBeTruthy();
  for (const r of card.rows) {
    expect(r.label, flat(r)).toMatch(/^[A-Z]/);
    expect(r.text, flat(r)).toBeTruthy();
    expect(r.text, flat(r)).not.toMatch(/^(null|undefined|none|nan)$/i);
    if (r.href) expect(r.text, "a link is a short label, never the raw URL").not.toMatch(/^https?:/i);
  }
  expect(flat(card)).not.toMatch(RAW_FIELD);
  expect(flat(card)).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
};

describe("click cards are clean (constraint #45)", () => {
  it("drycleaner — real DCERP rows, response site and registration-only", () => {
    const response = cards.drycleanerCard({ OBJECTID: 12877, DCERP_ID: "D-75-102", FACILITY_N: "Dodge Cleaners", FACILITY_A: "1632 Memorial Blvd", CITY: "Murfreesboro", STATE: "TN", ZIP: "37130", COUNTY_NAM: "Rutherford", COMMENTS: "DCERP Response Site", POINT_X: "-86.387", POINT_Y: "35.865", GlobalID: "06d5c9fa" });
    noJunk(response);
    expect(response.rows.find((r) => r.label === "Status").text).toMatch(/worked a release/i);
    const reg = cards.drycleanerCard({ FACILITY_N: "Galaxy Cleaners", FACILITY_A: "911 Memorial Blvd", CITY: "Murfreesboro", COUNTY_NAM: "Rutherford", COMMENTS: "Registration only facility. DCERP has not conducted any environmental" });
    noJunk(reg);
    expect(reg.rows.find((r) => r.label === "Status").text).toMatch(/registration only/i);
  });
  it("drycleaner — a bare feature with no comments still gets a card with no empty row", () => {
    noJunk(cards.drycleanerCard({ FACILITY_N: "SHOUTING CLEANERS", FACILITY_A: null, CITY: " ", COMMENTS: null }));
    expect(cards.drycleanerCard({ FACILITY_N: "SHOUTING CLEANERS" }).title).toMatch(/Shouting Cleaners/);
  });
  it("MS4 permit area", () => {
    const c = cards.ms4Card({ OBJECTID: 71, NAME: "MURFREESBORO", PERMIT_NUM: "TNS075469", VERIFIED: "YES", LASTUPDATE: 1410998400000, CREATED_USER: "BG17261@tn.gov_TDEC" });
    noJunk(c);
    expect(c.title).toBe("Murfreesboro — stormwater permit area");
    expect(c.rows).toEqual([{ label: "Permit", text: "TNS075469" }]);
  });
  it("water quality assessment — impaired, threatened, fully supporting, not assessed all read in plain words", () => {
    for (const a of ["Not Supporting", "Not Supporting (Evaluated)", "Threatened", "Fully Supporting", "Fully Supporting (Evaluated)", "Not Assessed"]) {
      const c = cards.wqaCard({ ASSESSMENT_UNIT_NAME: "Christmas Creek", LOCATION_DESCRIPTION: "Christmas Creek from Lytle Creek to headwaters.   Ecoregion 71i ", ATTAINMENT: a, NAME8: "Stones River" });
      noJunk(c);
      expect(c.rows[0].label).toBe("Status (2026)");
      expect(c.rows[0].text).not.toBe(a === "Not Supporting" ? a : "");
    }
    expect(cards.wqaCard({ ATTAINMENT: "Not Supporting" }).rows[0].text).toMatch(/^Impaired/);
  });
  it("wqaStyle — impaired is the loud class, threatened next, and the rest recede (weights within the reference ceiling)", () => {
    const imp = wqaStyle({ ATTAINMENT: "Not Supporting" }, 0.5), thr = wqaStyle({ ATTAINMENT: "Threatened" }, 0.5), ok = wqaStyle({ ATTAINMENT: "Fully Supporting" }, 0.5), na = wqaStyle({ ATTAINMENT: "Not Assessed" }, 0.5);
    expect(new Set([imp.color, thr.color, ok.color, na.color]).size).toBe(4);
    expect(imp.weight).toBeGreaterThan(ok.weight);
    for (const s of [imp, thr, ok, na]) { expect(s.weight).toBeLessThanOrEqual(2); expect(s.fill).toBe(false); }
  });
  it("public water system — the real Christiana and Nashville records", () => {
    const chris = cards.pwsCard({ OBJECTID_1: 403, PWSID: "TN0000791", fieldOffic: "Nashville", PL_TYPE: "C", PL_POPL: 208497, PL_PSRC: "SW", OW_TYPE: "L", MA_NAME: "CONSOLIDATED U.D. OF RUTHERFO", TINWSYS_IS_NUMBER: 583, DWW_Link: "https://dataviewers.tdec.tn.gov/DWW/JSP/WaterSystemDetail.jsp?tinwsys_is_number=583&tinwsys_st_code=TN&wsnumber=TN0000791", Shape__Area: 1983928261.1 });
    expect(chris.title).toBe("Consolidated U.D. of Rutherfo — water service area");
    expect(chris.rows.find((r) => r.label === "Population served").text).toBe("208,497");
    expect(chris.rows.find((r) => r.label === "Water source").text).toBe("Surface water");
    const link = chris.rows.find((r) => r.href);
    expect(link.text).toBe("Drinking Water Watch");
    expect(link.href).toMatch(/^https:\/\/dataviewers\.tdec\.tn\.gov\//);
    // the record's PWSID is shown as its own row (TN0000791), not in the title; the cleaner scrubs the rest
    expect(chris.rows.find((r) => r.label === "System ID").text).toBe("TN0000791");
    const nash = cards.pwsCard({ PWSID: "TN0000494", PL_POPL: 692094, PL_PSRC: "SW", OW_TYPE: "L", MA_NAME: "METRO WATER SERVICES", DWW_Link: "not a url" });
    expect(nash.title).toBe("Metro Water Services — water service area");
    expect(nash.rows.some((r) => r.href), "a non-http link is dropped, never shown").toBe(false);
  });
  it("State Natural Area and Scenic River", () => {
    const sna = cards.snaCard({ FID: 12, SNA_NAME: "Vine Cedar Glade State Natural Area", URL: "https://www.tn.gov/content/tn/environment/natural-areas/what", CALC_ACRES: 20 });
    noJunk(sna);
    expect(sna.title).toBe("Vine Cedar Glade State Natural Area");
    expect(sna.rows[0]).toEqual({ label: "Area", text: "20 acres" });
    const sc = cards.scenicCard({ Site_name: "HARPETH SCENIC RIVER", DESIGNATIO: "Class II Pastoral River Area", GISMILES: 6.5, DESCRIPTIO: "The entire river except that segment lying north of Highway 70", BUFF_DIST: null, ORIG_FID: null, PHOTO: "https://i.ibb.co/x.jpg" });
    noJunk(sc);
    expect(sc.title).toBe("Harpeth Scenic River");
    expect(sc.rows.map((r) => r.label)).toEqual(["River class", "Length", "Reach"]);
    expect(JSON.stringify(sc), "a photo host link is not part of the card").not.toMatch(/ibb\.co/);
  });
  it("critical habitat", () => {
    const c = cards.critHabitatCard({ comname: "Slabside Pearlymussel", sciname: "Pleuronaia dolabelloides", listing_status: "Endangered", unitname: "Please check current species specific shapefile" });
    noJunk(c);
    expect(c.rows).toEqual([{ label: "Species", text: "Pleuronaia dolabelloides" }, { label: "Federal status", text: "Endangered" }]);
  });
  it("landfill — the real TDEC record, class written as a Roman numeral", () => {
    const c = cards.landfillCard({ PRIMARY_NAME: "Milan Army Ammunition Plant Class Ii Landfill", LANDFILL_CLASS: "Class Ii", STATUS: "Operating", COUNTY: "Gibson", CITY: "Milan", ADDRESS: null, TDEC_SITE_ID: "27-0105", LATITUDE: 35.896768, LONGITUDE: -88.713215, GIS_ID: 1, FACILITY_ID: 9, EFO_NAME: "Jackson" });
    noJunk(c);
    expect(c.rows.find((r) => r.label === "Class").text).toBe("Class II");
    expect(c.rows.find((r) => r.label === "Address").text).toBe("Milan");
    expect(cards.landfillCard({ LANDFILL_CLASS: "Class Iv" }).rows[0].text).toBe("Class IV");
    expect(cards.landfillCard({ LANDFILL_CLASS: "Class I" }).rows[0].text).toBe("Class I");
  });
  it("THC survey site — fixed-width padded text is trimmed and shouted names are title-cased", () => {
    const c = cards.thcSiteCard({ OBJECTID: 5, COUNTY: "Davidson", HISTNAME: " ", COMNAME: "JOY'S FLOWERS", PROPADDR: "6TH AVE N 211", CITY: " ", DATECONST: "1925", ORIGUSE: "Other Commercial building", PRESUSE: "", DOCLINK: "", SURVEYDATE: 506304000000, SHAPE: null });
    noJunk(c);
    expect(c.title).toBe("Joy's Flowers — recorded historic site");
    expect(c.rows.map((r) => r.label)).toEqual(["Address", "County", "Built", "Original use"]);
  });
  it("National Register boundary — padded strings trimmed, YYYYMMDD read as a date, no empty rows", () => {
    const pad = (v, n) => v + " ".repeat(n);
    const c = cards.nrhpBoundaryCard({ OBJECTID: 3, REFNUM: "98000330", Resource_Name: pad("Acme Farm Supply Building", 80), Address: pad("101 Broadway", 90), County: pad("Davidson", 16), City: pad("Nashville", 26), Listed_Date: "19980402", Multiple_Name: null, NHL_Date: null, FILENET: null, Shape_Area: 1.2 });
    noJunk(c);
    expect(c.title).toBe("Acme Farm Supply Building — National Register");
    expect(c.rows).toEqual([{ label: "Address", text: "101 Broadway" }, { label: "Location", text: "Nashville, Davidson County" }, { label: "Listed", text: "April 2, 1998" }]);
    expect(cards.ymd("20021345")).toBe("20021345"); // an impossible month is shown as published, not invented
    expect(cards.ymd("")).toBe("");
  });
  it("remediation site — the real DOR record: program in plain words, no raw field names, the edit date said", () => {
    const c = cards.dorSiteCard({ ObjectId: 78, DOR_Site_Id: "19567A", DOR_Site_Name: "FRM OLD NASHVILLE GAS CO.", Program: "STATE (HWRA FUNDED)", Status: "OPEN", TDEC_Field_Office: "NASHVILLE", Development_District: "GREATER NASHVILLE REGIONAL COUNCIL", Address: "800 2ND AVENUE NORTH", City: "NASHVILLE", County: "DAVIDSON", Acres: 4.49, Promulgated: 485654400000, Delisted: null, Latitude: 36.17, Longitude: -86.78 });
    noJunk(c);
    expect(c.title).toBe("Frm Old Nashville Gas Co. — remediation site");
    expect(c.rows.find((r) => r.label === "Program").text).toMatch(/^State Superfund — state-funded/);
    expect(c.rows.find((r) => r.label === "Site area").text).toBe("4.49 acres");
    expect(c.rows.find((r) => r.label === "Listed").text).toBe("1985");
    expect(c.note).toMatch(/June 2024/);
    for (const prog of ["VOLUNTARY", "LIABLE PARTY FUNDED", "PRE-REMEDIAL", "DCERP", "EPA NON-NPL", "EPA NPL", "DOD"]) expect(cards.dorProgramWords(prog), prog).not.toBe(prog);
    expect(cards.dorProgramWords("TN CLEAN")).toBe("TN Clean"); // an unmapped program is shown as published, never invented
  });
  it("drycleaner — a TDEC note that is neither standard status is shown as written, not dropped", () => {
    const c = cards.drycleanerCard({ FACILITY_N: "X CLEANERS", COMMENTS: "Site ID Issued in Error" });
    noJunk(c);
    expect(c.rows.find((r) => r.label === "TDEC note").text).toBe("Site ID Issued in Error");
    expect(cards.drycleanerCard({ FACILITY_N: "X", COMMENTS: "DCERP Response Site" }).rows.some((r) => r.label === "TDEC note")).toBe(false);
  });
  it("the State's padded and double-spaced text reads cleanly; the landfill class is Roman in the title too; Mc names and agencies keep their form", () => {
    expect(cards.landfillCard({ PRIMARY_NAME: "Bi-County Solid Waste Class Iii Landfill", LANDFILL_CLASS: "Class Iii", ADDRESS: "1921  1/2 Brookside Lane", CITY: "Scepter,  Inc." }).title).toBe("Bi-County Solid Waste Class III Landfill — permitted landfill");
    expect(cards.landfillCard({ PRIMARY_NAME: "X", ADDRESS: "Andersonville Highway  3454", CITY: "Y" }).rows.find((r) => r.label === "Address").text).toBe("Andersonville Highway 3454, Y");
    expect(cards.titleCase("MCMINNVILLE WATER AND SEWER")).toBe("McMinnville Water and Sewer");
    expect(cards.titleCase("DEKALB UTILITY DISTRICT")).toBe("DeKalb Utility District");
    expect(cards.titleCase("TVA - SEQUOYAH")).toBe("TVA - Sequoyah");
    expect(cards.titleCase("OAK RIDGE (DOE)")).toBe("Oak Ridge (DOE)");
    expect(cards.wqaCard({ ASSESSMENT_UNIT_NAME: "Lytle Creek", ATTAINMENT: "Fully Supporting", LOCATION_DESCRIPTION: "Lytle Creek from Dilton Road to headwaters.   Ecoregion 71i " }).rows.find((r) => r.label === "Reach").text).toBe("Lytle Creek from Dilton Road to headwaters.");
    expect(cards.pwsCard({ MA_NAME: "X", PL_PSRC: "GUP" }).rows.find((r) => r.label === "Water source").text).toMatch(/^Purchased groundwater/);
  });
  it("a blank-named THC site gets a plain title (not 'recorded historic site — recorded historic site'); stream length is rounded", () => {
    expect(cards.thcSiteCard({ COMNAME: " ", HISTNAME: " ", PROPADDR: "6TH AVE N 211" }).title).toBe("Recorded historic site");
    expect(cards.scenicCard({ Site_name: "X", GISMILES: 13.200000000000001 }).rows.find((r) => r.label === "Length").text).toBe("13.2 miles");
  });
  it("the Counties & Cities key and Site Analysis know the Tennessee city layer", async () => {
    const { boundaryKey } = await import("../src/workspaces/site-planner/lib/layerPanelModel.js");
    const key = boundaryKey([["tn_county", ALL_LAYERS.tn_county], ["tn_city", ALL_LAYERS.tn_city]]);
    expect(key.map((k) => k.label)).toEqual(["County", "City Limits"]);
    const { LINE_LAYERS } = await import("../src/workspaces/site-planner/lib/siteScreen.js");
    expect(LINE_LAYERS.TN).toEqual(["tn_city"]);
  });
  it("titleCase leaves mixed-case text alone and keeps acronyms", () => {
    expect(cards.titleCase("Harpeth River")).toBe("Harpeth River");
    expect(cards.titleCase("MEMPHIS LIGHT GAS & WATER")).toBe("Memphis Light Gas & Water");
    expect(cards.titleCase("NASHVILLE LLC")).toBe("Nashville LLC");
    expect(cards.titleCase(null)).toBe("");
  });
});

describe("a state server rides the same-origin relay — the vector query builder resolves a root-relative base against the page origin", () => {
  it("buildQueryUrl on /gis-proxy/<host>/… keeps its path + query; an absolute base is unchanged", () => {
    const rel = new URL(buildQueryUrl("/gis-proxy/tdeconline.tn.gov/arcgis/rest/services/DWR_CGP/MapServer/0/query", { where: "1=1", f: "json", outFields: "A,B", skip: null }));
    expect(rel.pathname + rel.search).toBe("/gis-proxy/tdeconline.tn.gov/arcgis/rest/services/DWR_CGP/MapServer/0/query?where=1%3D1&f=json&outFields=A%2CB");
    expect(buildQueryUrl("https://services5.arcgis.com/x/query", { f: "json" })).toBe("https://services5.arcgis.com/x/query?f=json");
  });
});

describe("Site Analysis stays trusted-only: Tennessee gets a map pill, never a verdict card", () => {
  it("the Contamination pill on a Tennessee site turns on the EPA layer AND TDEC remediation sites, drycleaners and permitted landfills", () => {
    const p = pillsFor({ regions: ["TN"], untrusted: [], layers: ALL_LAYERS }).find((x) => x.id === "contamination");
    expect(p.layers).toEqual(["env_cleanups", "tn_remediation", "tn_drycleaners", "tn_landfills"]);
  });
});
