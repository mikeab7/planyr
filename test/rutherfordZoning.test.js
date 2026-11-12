/* Rutherford County TN zoning (NEW-1, 2026-11-12) — four governments' own layers, one panel row.
 * Property bags below are RECORDED from the live services on 2026-11-12 (Capital Way / 1975 Joe B Jackson Pkwy / -86.52,35.98 / La Vergne I-1), not invented.
 * Owner rules pinned here: #41 (a result is labelled by the government the SITE falls in — never the county's older shape inside a city), #42 (100%), #43 (click only), #45 (clean card),
 * #46 (names from each government's own source, bare code otherwise), #50 (legend headed by the government, one code per row), #3 (nothing Texas-derived on a Tennessee site). */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));
import {
  COUNTY, MURFREESBORO, SMYRNA, LAVERGNE, MEMBERS, JURISDICTION, UNINCORPORATED, DEDUPE_KEY,
  isCountyHole, COUNTY_WHERE, MURFREESBORO_WHERE, COUNTY_NAMES, MURFREESBORO_NAMES, SMYRNA_DISTRICTS, SMYRNA_ZONE_ID_CODES, LAVERGNE_NAMES,
  murfreesboroOrdinanceHref, titleName, readZone, labelOf, zoneText, zoneClass, ZONE_COLORS, zoningStyleFor, zoningCard, memberLegend,
} from "../src/workspaces/site-planner/lib/rutherfordZoning.js";
import { jurisdictionFrom } from "../src/workspaces/site-planner/lib/rutherfordJurisdiction.js";
import { ALL_LAYERS, MERGE_GROUPS, layerVintage } from "../src/workspaces/site-planner/lib/layers.js";
import { LAYER_TIER } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { GIS_SOURCES, SOURCE_FIXTURE_REACH } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES } from "../src/shared/gis/sourceFixtures.js";
import { cleanCard } from "../src/workspaces/site-planner/lib/identifyCard.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { PANEL_GROUPS, groupEntriesFor, availableEntries } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

/* ── recorded property bags ── */
const EAC = { OBJECTID: 3208, ZONE: 12, ZONEABBRV: "EAC", CHECKED: "Y", ACRES: 164.19448356, EFF_DATE: 1356998400000, ZONING: "SPECIAL CHARACTER", ZONE_DIST: "EMPLOYMENT & ACTIVITY CENTER", CASE_NO: " ", CASE_NO_2: " ", COMMENT: " ", COMMENT_2: " ", SE: " " };
const PUD = { ZONEABBRV: "PUD", ZONING: "RESIDENTIAL", ZONE_DIST: "PLANNED UNIT DEVELOPMENT", CASE_NO: "19-A024", CASE_NO_2: " ", COMMENT: "RM to PUD", COMMENT_2: "SYCAMORE GROVE", SE: "N:\\RicohScans\\Stormwater\\Subdivisions\\Pattern_Book", EFF_DATE: 1579564800000 };
const CG_ODD = { ZONEABBRV: "CG", ZONING: "RESIDENTIAL", ZONE_DIST: "LOW DENSITY RESIDENTIAL" }; // the one county polygon whose text names another district
const CITY_FILL = { ZONEABBRV: "CITY", ZONING: "ANNEXED", ZONE_DIST: "CITY", CASE_NO: "21-21", COMMENT: "Town of Smyrna" };
const MB_LI = { OBJECTID: 11228, ACRES: 141.52595356, URL: "https://www.murfreesborotn.gov/DocumentCenter/View/7181/Appendix-A---Zoning-Ordinance-20190718?bidI*", SubZoning: "L-I", ParcelType: "p", GenZoning: "IND", Layer_Name: "Zoning" };
const SM_R1 = { OBJECTID: 481, ZONING_DIST: 11, ZONE_ID: 11, LastUpdate: 1245196800000 };
const LV_I1 = { OBJECTID: 7, Zoning_Typ: "I-1" };

describe("what is NOT a district", () => {
  it("the county's CITY / ANNEXED fill polygons are holes, a real district is not", () => {
    expect(isCountyHole(CITY_FILL)).toBe(true);
    expect(isCountyHole({ ZONEABBRV: "CITY", ZONING: "CITY" })).toBe(true);
    expect(isCountyHole({ ZONEABBRV: "RM", ZONING: "ANNEXED" })).toBe(true);
    for (const p of [EAC, PUD, CG_ODD, { ZONEABBRV: "RM", ZONING: null }]) expect(isCountyHole(p)).toBe(false);
  });
  it("the server filters say the same thing in SQL (null ZONING must stay drawn — 3 live RM polygons carry none)", () => {
    expect(COUNTY_WHERE).toContain("ZONEABBRV <> 'CITY'");
    expect(COUNTY_WHERE).toMatch(/ZONING IS NULL OR ZONING NOT IN \('CITY','ANNEXED'\)/);
    expect(MURFREESBORO_WHERE).toBe("ParcelType <> 'r' OR ParcelType IS NULL");
  });
});

describe("district names come from each government's own list (#46) — and a code outside it stays bare", () => {
  it("the tables have exactly the entries the live layer definitions carry (domain sizes counted 2026-11-12)", () => {
    expect(Object.keys(MURFREESBORO_NAMES)).toHaveLength(34);
    expect(Object.keys(SMYRNA_DISTRICTS)).toHaveLength(24);
    expect(Object.keys(SMYRNA_ZONE_ID_CODES)).toHaveLength(24);
    expect(Object.keys(LAVERGNE_NAMES)).toHaveLength(17);
    expect(Object.keys(COUNTY_NAMES)).toHaveLength(14);
  });
  it("county: code · the layer's own district name", () => {
    expect(zoneText(readZone(COUNTY, EAC))).toBe("EAC · Employment & Activity Center");
    expect(zoneText(readZone(COUNTY, { ZONEABBRV: "LI" }))).toBe("LI · Light Industrial");
  });
  it("a county code the layer's own list has no name for shows the code as written, never a guess", () => {
    expect(zoneText(readZone(COUNTY, { ZONEABBRV: "XQ" }))).toBe("XQ");
  });
  it("the county polygon whose text names a different district shows BOTH, resolved by neither", () => {
    const z = readZone(COUNTY, CG_ODD);
    expect(z.code).toBe("CG");
    expect(z.alsoReads).toBe("Low Density Residential");
    expect(readZone(COUNTY, EAC).alsoReads).toBeNull(); // same text modulo case and "&" → "and"
  });
  it("Murfreesboro: SubZoning code and its domain name; the ordinance URL is cleaned to a real link", () => {
    expect(zoneText(readZone(MURFREESBORO, MB_LI))).toBe("L-I · Light Industrial");
    expect(readZone(MURFREESBORO, MB_LI).classWord).toBe("Industrial");
    expect(murfreesboroOrdinanceHref(MB_LI.URL)).toBe("https://www.murfreesborotn.gov/DocumentCenter/View/7181/Appendix-A---Zoning-Ordinance-20190718");
    expect(murfreesboroOrdinanceHref(" https://www.murfreesborotn.gov/DocumentCenter/View/7181/Appendix-A---Zoning-Ordinance-20190718?bidI")).toMatch(/Ordinance-20190718$/);
    expect(murfreesboroOrdinanceHref("https://www.murfreesborotn.gov/DocumentCenter/View/7181/Zoning-Ordinance--2023-Appendix-A-PDF?bidId=")).toMatch(/PDF$/);
  });
  it("Murfreesboro's junk URL values (a REST address, local file paths, nothing) are never links", () => {
    for (const u of ["https://maps3.murfreesborotn.gov/mboro/rest/services", "\\\\file2\\planning\\Web Submittals\\PlanningApplications2023\\230914", "Z:\\GIS\\ANNEXATION_AND_ZONING_UPDATES\\Annexations and Zoning Complete\\2017", "", null, "javascript:alert(1)", "https://evil.example/DocumentCenter/View/1/x"]) {
      expect(murfreesboroOrdinanceHref(u), String(u)).toBeNull();
    }
  });
  it("Smyrna: the integer is decoded through the town's own domain, spelling corrected", () => {
    expect(zoneText(readZone(SMYRNA, SM_R1))).toBe("R-1 · Low Density Residential");
    expect(zoneText(readZone(SMYRNA, { ZONING_DIST: 7, ZONE_ID: 7 }))).toBe("I-1 · Light Industrial");
    expect(zoneText(readZone(SMYRNA, { ZONING_DIST: 24, ZONE_ID: 23 }))).toBe("PID · Planned Industrial District");
    expect(zoneText(readZone(SMYRNA, { ZONING_DIST: 18, ZONE_ID: 18 }))).toBe("PUD · Planned Unit Development");
    expect(JSON.stringify(SMYRNA_DISTRICTS)).not.toMatch(/DEVELPMENT|RESIDENTAIL|PLANNIED/i);
  });
  it("Smyrna: a code the town's domain does not define is 'Unlisted', never a guessed district (codes 26–30 occur in the data)", () => {
    for (const n of [25, 26, 27, 28, 29, 30]) {
      const z = readZone(SMYRNA, { ZONING_DIST: n });
      expect(z.listed, String(n)).toBe(false);
      expect(zoneText(z)).toBe(`Unlisted district (code ${n})`);
      expect(labelOf(SMYRNA, n)).toBeNull();
    }
    expect(readZone(SMYRNA, {}).listed).toBe(false);
    expect(readZone(SMYRNA, { ZONING_DIST: null }).unlistedCode).toBeNull();
  });
  it("Smyrna: where ZONE_ID names a different district than ZONING_DIST, the card shows both (measured: 13 polygons)", () => {
    expect(readZone(SMYRNA, { ZONING_DIST: 23, ZONE_ID: 19 })).toMatchObject({ code: "", name: "Height", alsoReads: "H-2" });
    expect(readZone(SMYRNA, { ZONING_DIST: 18, ZONE_ID: 21 })).toMatchObject({ code: "PUD", alsoReads: "PCD" });
    expect(readZone(SMYRNA, { ZONING_DIST: 24, ZONE_ID: 23 }).alsoReads).toBeNull(); // PID is PID in both domains
    expect(readZone(SMYRNA, SM_R1).alsoReads).toBeNull();
    expect(readZone(SMYRNA, { ZONING_DIST: 20, ZONE_ID: 20 }).alsoReads).toBeNull(); // the same district under two domains is not a disagreement
  });
  it("Smyrna: a district the town's domain gives a NAME and no code is shown by name alone — no code is invented", () => {
    for (const [n, name, word] of [[19, "Proposed", "PROPOSED"], [20, "Historic Overlay District", "HISTORIC"], [23, "Height", "HEIGHT"]]) {
      const z = readZone(SMYRNA, { ZONING_DIST: n });
      expect(z.listed).toBe(true);
      expect(z.code).toBe("");
      expect(zoneText(z), String(n)).toBe(name);
      expect(labelOf(SMYRNA, n)).toBe(word);
    }
    const l = memberLegend(SMYRNA, [{ ZONING_DIST: 20 }, { ZONING_DIST: 11 }]);
    expect(l.slice(1).map((x) => x.label)).toEqual(["R-1 · Low Density Residential", "Historic Overlay District"]);
  });
  it("La Vergne: the layer's domain names, and a code outside it stays bare", () => {
    expect(zoneText(readZone(LAVERGNE, LV_I1))).toBe("I-1 · Light Industrial");
    expect(zoneText(readZone(LAVERGNE, { Zoning_Typ: "I-3" }))).toBe("I-3 · Industrial District (Special)");
    expect(zoneText(readZone(LAVERGNE, { Zoning_Typ: "Z-9" }))).toBe("Z-9");
  });
  it("the same code is NOT borrowed across governments (I-1 is Light Industrial in two, C-1 means three different things)", () => {
    expect(LAVERGNE_NAMES["C-1"]).toBe("Government and Public Use");
    expect(SMYRNA_DISTRICTS[3][1]).toBe("Central Business");
    expect(zoneText(readZone(MURFREESBORO, { SubZoning: "C-1" }))).toBe("C-1"); // Murfreesboro has no C-1: bare
  });
  it("titleName fixes ALL-CAPS text and the town's spelling slips", () => {
    expect(titleName("EMPLOYMENT & ACTIVITY CENTER")).toBe("Employment & Activity Center");
    expect(titleName("PROFESSIONAL AND OFFICE")).toBe("Professional and Office");
    expect(titleName("LOW DENSITY RESIDENTAIL")).toBe("Low Density Residential");
    expect(titleName("PLANNED UNIT DEVELPMENT")).toBe("Planned Unit Development");
  });
});

describe("families and paint", () => {
  it.each([
    [COUNTY, { ZONEABBRV: "LI" }, "industrial"], [COUNTY, { ZONEABBRV: "CG" }, "commercial"], [COUNTY, { ZONEABBRV: "OP" }, "office"], [COUNTY, { ZONEABBRV: "IN" }, "civic"],
    [COUNTY, EAC, "mixed"], [COUNTY, { ZONEABBRV: "RM" }, "residential"], [COUNTY, { ZONEABBRV: "AR" }, "agricultural"], [COUNTY, PUD, "pud"],
    [MURFREESBORO, MB_LI, "industrial"], [MURFREESBORO, { SubZoning: "CBD" }, "mixed"], [MURFREESBORO, { SubZoning: "CH" }, "commercial"], [MURFREESBORO, { SubZoning: "RS-15" }, "residential"],
    [MURFREESBORO, { SubZoning: "OG-R" }, "office"], [MURFREESBORO, { SubZoning: "P" }, "civic"], [MURFREESBORO, { SubZoning: "PID" }, "pud"], [MURFREESBORO, { SubZoning: "CM-R" }, "commercial"],
    [SMYRNA, SM_R1, "residential"], [SMYRNA, { ZONING_DIST: 9 }, "industrial"], [SMYRNA, { ZONING_DIST: 23 }, "overlay"], [SMYRNA, { ZONING_DIST: 1 }, "overlay"], [SMYRNA, { ZONING_DIST: 21 }, "pud"],
    [SMYRNA, { ZONING_DIST: 27 }, "other"], [SMYRNA, { ZONING_DIST: 2 }, "civic"],
    [LAVERGNE, LV_I1, "industrial"], [LAVERGNE, { Zoning_Typ: "C-4" }, "commercial"], [LAVERGNE, { Zoning_Typ: "R-4" }, "residential"], [LAVERGNE, { Zoning_Typ: "PDR" }, "pud"], [LAVERGNE, { Zoning_Typ: "A" }, "agricultural"],
    [LAVERGNE, { Zoning_Typ: "F-1" }, "overlay"], [LAVERGNE, { Zoning_Typ: "C-1" }, "civic"],
  ])("%s %j → %s", (member, props, klass) => {
    const z = readZone(member, props);
    expect(z.listed ? zoneClass(z.code, z.name) : "other").toBe(klass);
  });
  it("the style paints the family colour, quiet and scaled by the row opacity; overlays are dashed; unknown is neutral", () => {
    const s = zoningStyleFor(COUNTY)({ ZONEABBRV: "LI" }, 0.5);
    expect(s).toMatchObject({ color: ZONE_COLORS.industrial, fillColor: ZONE_COLORS.industrial, opacity: 0.5, fill: true });
    expect(zoningStyleFor(MURFREESBORO)(MB_LI, 1).fillOpacity).toBe(0.45);
    expect(zoningStyleFor(SMYRNA)({ ZONING_DIST: 23 }, 1).dashArray).toBeTruthy();
    expect(zoningStyleFor(SMYRNA)({ ZONING_DIST: 27 }, 1).color).toBe(ZONE_COLORS.other);
    expect(zoningStyleFor(COUNTY)(undefined, 1).color).toBe(ZONE_COLORS.other);
  });
});

describe("the click card — labelled by the government the SITE falls in (#41), clean (#45)", () => {
  const RAW = /\b(OBJECTID|ZONEABBRV|ZONE_DIST|ZONING_DIST|ZONE_ID|SubZoning|GenZoning|ParcelType|Zoning_Typ|EFF_DATE|CASE_NO|CASE_NO_2|COMMENT|GlobalID|Shape__|LastUpdate|SE)\b/;
  it("county, unincorporated: zone, effective date, case and the county's own notes — never the file path in the SE column", () => {
    const c = zoningCard(COUNTY, PUD, UNINCORPORATED);
    expect(c.title).toBe("Zoning · Unincorporated Rutherford County");
    expect(c.rows).toEqual(expect.arrayContaining([{ label: "Zone", text: "PUD · Planned Unit Development" }, { label: "Effective", text: "Jan 21, 2020" }, { label: "Case", text: "19-A024" }, { label: "Note", text: "RM to PUD · SYCAMORE GROVE" }]));
    expect(JSON.stringify(c)).not.toMatch(/RicohScans|N:\\/);
    expect(c.dedupeKey).toBe(DEDUPE_KEY);
  });
  it("county, limits not loaded yet: says so instead of guessing a government", () => {
    const c = zoningCard(COUNTY, EAC, null);
    expect(c.title).toBe("Zoning · Rutherford County");
    expect(c.rows).toContainEqual({ label: "Jurisdiction", text: "Checking city limits…" });
    expect(c.rows.find((r) => r.label === "Effective").text).toBe("Jan 1, 2013");
  });
  it("county polygon clicked INSIDE a city's limits is the CITY'S card: it never states the county's district as the city's, and shows it only attributed to the county's older layer", () => {
    for (const city of ["Murfreesboro", "Smyrna", "La Vergne", "Eagleville"]) {
      const c = zoningCard(COUNTY, EAC, city);
      expect(c.title).toBe(`Zoning · ${city}`);
      expect(c.rows).toHaveLength(2);
      expect(c.rows[0].label).toBe("Zoning");
      expect(c.rows[0].text).not.toMatch(/EAC|Employment/);
      expect(c.rows[1]).toEqual({ label: "County's older layer shows", text: "EAC · Employment & Activity Center" });
    }
    expect(zoningCard(COUNTY, EAC, "Eagleville").rows[0].text).toMatch(/Eagleville has no zoning layer in Planyr yet/);
    expect(zoningCard(COUNTY, EAC, "Murfreesboro").rows[0].text).toMatch(/Murfreesboro's own zoning layer shows no district at this point/);
  });
  it("city layers: the city in the title, the zone, class and ordinance link", () => {
    const m = zoningCard(MURFREESBORO, MB_LI, "Murfreesboro");
    expect(m.title).toBe("Zoning · Murfreesboro");
    expect(m.rows).toEqual(expect.arrayContaining([{ label: "Zone", text: "L-I · Light Industrial" }, { label: "Class", text: "Industrial" }]));
    expect(m.rows.find((r) => r.label === "Ordinance").href).toMatch(/^https:\/\/www\.murfreesborotn\.gov\/DocumentCenter\/View\/7181\//);
    expect(zoningCard(SMYRNA, SM_R1, "Smyrna").rows.find((r) => r.label === "Record updated").text).toBe("Jun 17, 2009");
    expect(zoningCard(SMYRNA, SM_R1, "Smyrna").rows.find((r) => r.label === "Ordinance").href).toMatch(/^https:\/\/cms3\.revize\.com\/.*Public%20Works/);
    expect(zoningCard(LAVERGNE, LV_I1, "La Vergne").rows.find((r) => r.label === "Ordinance").href).toBe("https://www.lavergnetn.gov/630/Zoning-Ordinance");
  });
  it("a city polygon whose point the State's map puts in another government says so (the layers disagree at the edges)", () => {
    const out = zoningCard(MURFREESBORO, MB_LI, UNINCORPORATED).rows.find((r) => r.label === "City limits").text;
    expect(out).toMatch(/Outside Murfreesboro's limits on the state's city map/);
    expect(zoningCard(SMYRNA, SM_R1, "La Vergne").rows.find((r) => r.label === "City limits").text).toMatch(/Inside La Vergne's limits/);
    expect(zoningCard(SMYRNA, SM_R1, "Smyrna").rows.find((r) => r.label === "City limits")).toBeUndefined();
    expect(zoningCard(SMYRNA, SM_R1, null).rows.find((r) => r.label === "City limits")).toBeUndefined();
  });
  it("Smyrna unlisted code and ZONE_ID disagreement are visible on the card", () => {
    expect(zoningCard(SMYRNA, { ZONING_DIST: 27 }, "Smyrna").rows[0]).toEqual({ label: "Zone", text: "Unlisted district (code 27)" });
    expect(zoningCard(SMYRNA, { ZONING_DIST: 23, ZONE_ID: 19 }, "Smyrna").rows).toContainEqual({ label: "City record also reads", text: "H-2" });
  });
  it("every card survives the shared clean-up with no raw field name, no empty row and no raw URL", () => {
    const cards = [zoningCard(COUNTY, PUD, UNINCORPORATED), zoningCard(COUNTY, CG_ODD, UNINCORPORATED), zoningCard(MURFREESBORO, MB_LI, "Murfreesboro"), zoningCard(SMYRNA, { ZONING_DIST: 23, ZONE_ID: 19, LastUpdate: 1245196800000 }, "Smyrna"), zoningCard(LAVERGNE, LV_I1, "La Vergne"), zoningCard(COUNTY, EAC, "Murfreesboro")];
    for (const card of cards) {
      const c = cleanCard({ ...card, sourceName: "x" });
      expect(c.rows.length).toBeGreaterThan(0);
      for (const r of c.rows) { expect(r.label).not.toMatch(RAW); expect(r.text).not.toMatch(/^https?:/); expect(r.text).not.toMatch(/null|undefined|NaN/); }
    }
  });
});

describe("the legend — headed by the government, one code per row, no suffix (#50)", () => {
  it("one heading then one row per code, in family colour, deduplicated", () => {
    const l = memberLegend(SMYRNA, [SM_R1, SM_R1, { ZONING_DIST: 7 }, { ZONING_DIST: 27 }, { ZONING_DIST: 27 }, { ZONING_DIST: 9 }]);
    expect(l[0]).toEqual({ heading: true, label: "Smyrna" });
    expect(l.filter((x) => x.heading)).toHaveLength(1);
    expect(l.slice(1).map((x) => x.label)).toEqual(["R-1 · Low Density Residential", "I-1 · Light Industrial", "I-3 · Heavy Industrial", "Unlisted · code 27"]);
    for (const row of l.slice(1)) { expect(row.row).toBe(true); expect(row.label).not.toMatch(/\(Smyrna\)|Smyrna$/); expect(row.color).toMatch(/^#/); }
  });
  it("each member's heading is its government (the county's is 'Unincorporated Rutherford County')", () => {
    expect(memberLegend(COUNTY, [EAC])[0].label).toBe("Unincorporated Rutherford County");
    expect(memberLegend(MURFREESBORO, [MB_LI])[0].label).toBe("Murfreesboro");
    expect(memberLegend(LAVERGNE, [LV_I1])[0].label).toBe("La Vergne");
  });
  it("nothing in view → no legend at all (never a bare heading)", () => {
    expect(memberLegend(COUNTY, [])).toEqual([]);
    expect(memberLegend(SMYRNA, [{}])).toEqual([]);
  });
  it("on-map labels are codes", () => {
    expect(labelOf(COUNTY, " eac ")).toBe("EAC");
    expect(labelOf(SMYRNA, 11)).toBe("R-1");
    expect(labelOf(LAVERGNE, "")).toBeNull();
  });
});

describe("jurisdictionFrom — the State's city limits decide who governs a point", () => {
  const sq = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const fc = { type: "FeatureCollection", features: [{ properties: { NAME: "Murfreesboro" }, geometry: sq(-86.45, 35.80, -86.30, 35.90) }, { properties: { NAME: "LaVergne" }, geometry: sq(-86.60, 36.00, -86.50, 36.05) }] };
  it("inside a city → the city (State spelling LaVergne → La Vergne); outside every limit → unincorporated county; no limits yet → null", () => {
    expect(jurisdictionFrom(fc, 35.85, -86.38)).toBe("Murfreesboro");
    expect(jurisdictionFrom(fc, 36.02, -86.55)).toBe("La Vergne");
    expect(jurisdictionFrom(fc, 35.72, -86.33)).toBe(UNINCORPORATED);
    expect(jurisdictionFrom(null, 35.72, -86.33)).toBeNull();
    expect(jurisdictionFrom({ features: [] }, 35.72, -86.33)).toBeNull();
  });
  it("a point nowhere near the county is unknown, never 'unincorporated Rutherford County'", () => {
    expect(jurisdictionFrom(fc, 36.16, -86.78)).toBeNull(); // Nashville
    expect(jurisdictionFrom(fc, 29.76, -95.37)).toBeNull(); // Houston
    expect(jurisdictionFrom(fc, NaN, -86.3)).toBeNull();
  });
});

describe("the registry rows", () => {
  const ids = ["tn_rz_murfreesboro", "tn_rz_smyrna", "tn_rz_lavergne", "tn_rz_county"];
  const srcOf = { tn_rz_murfreesboro: "murfreesboroZoning", tn_rz_smyrna: "smyrnaZoning", tn_rz_lavergne: "lavergneZoning", tn_rz_county: "rutherfordCountyZoning" };
  it("four members of ONE merged 'Zoning' row, Tennessee + Rutherford only, cities first and the county LAST (a click keeps the first answer)", () => {
    expect(MERGE_GROUPS.tn_rutherford_zoning.label).toBe("Zoning");
    const order = Object.keys(ALL_LAYERS).filter((k) => ALL_LAYERS[k].mergeGroup === "tn_rutherford_zoning");
    expect(order).toEqual(ids);
    expect(order.at(-1)).toBe("tn_rz_county");
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      expect(c.states, id).toEqual(["TN"]);
      expect(c.regions, id).toEqual(["rutherford"]);
      expect(c.kind, id).toBe("esriFeature");
      expect([c.role, c.group], id).toEqual(["area", "jurisdiction"]);
    }
  });
  it("each reads its registry source's URL and filter (one place decides), and the filters keep out right-of-way and the county's city fill", () => {
    for (const id of ids) {
      const s = GIS_SOURCES[srcOf[id]];
      expect(ALL_LAYERS[id].url, id).toBe(s.serviceUrl);
      expect(ALL_LAYERS[id].where, id).toBe(s.where);
      expect([s.states, s.tier, s.coverage], id).toEqual([["TN"], "production", "rutherford"]);
    }
    expect(GIS_SOURCES.rutherfordCountyZoning.where).toBe(COUNTY_WHERE);
    expect(GIS_SOURCES.murfreesboroZoning.where).toBe(MURFREESBORO_WHERE);
    expect(ALL_LAYERS.tn_rz_smyrna.where).toBeUndefined();
  });
  it("the Murfreesboro row reads layer 45 (the current one — 0–43 are dated snapshots), not a snapshot", () => {
    expect(GIS_SOURCES.murfreesboroZoning.serviceUrl).toMatch(/City_Zoning_inc_Historic_Zoning_WFL1\/FeatureServer\/45$/);
  });
  it("click only, never hover (#43): the cards are the canvas identify, and no row asks for a tooltip", () => {
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      expect(c.canvasIdentify, id).toBe(true);
      expect(typeof c.identifyCard, id).toBe("function");
      expect(typeof c.viewLegend, id).toBe("function");
      expect(typeof c.warm, id).toBe("function");
      expect(c.lineLabel.field, id).toBeTruthy();
      expect(c.lineLabel.declutter, id).toBe(true);
    }
  });
  it("100% opacity on first turn-on (#42): the registry normalises every row's default to 1", () => {
    for (const id of ids) expect(ALL_LAYERS[id].opacity, id).toBe(1);
  });
  it("the draw budget is respected: simplified server-side with every page followed (the county view holds > 2,000 polygons), no row asks for more than the default budget", () => {
    for (const id of ids) { expect(ALL_LAYERS[id].simplifyFactor, id).toBe(1.5); expect(ALL_LAYERS[id].fetchAll, id).toBe(true); expect(ALL_LAYERS[id].vertexBudget, id).toBeUndefined(); }
  });
  it("layer weight tier is declared; the vintage says each layer's edit date and that a newer rezoning is not on it", () => {
    for (const id of ids) expect(LAYER_TIER[id], id).toBe("reference");
    expect(layerVintage("tn_rz_county", ALL_LAYERS.tn_rz_county)).toMatch(/2026-10-28/);
    for (const id of ["tn_rz_murfreesboro", "tn_rz_smyrna", "tn_rz_lavergne"]) expect(layerVintage(id, ALL_LAYERS[id]), id).toMatch(/2024-0[34]-\d\d; a rezoning since then is not on it/);
  });
  it("the source rows carry fixtures at separated points and the reach class their coverage implies", () => {
    for (const k of Object.values(srcOf)) {
      expect(SOURCE_FIXTURES[k].fixtures.length, k).toBeGreaterThanOrEqual(2);
      expect(SOURCE_FIXTURE_REACH[k][0], k).toMatch(/^(regional|local)$/);
    }
    const capital = SOURCE_FIXTURES.rutherfordCountyZoning.fixtures.find((f) => /Capital Way/.test(f.label));
    expect(capital.point).toEqual([-86.3254, 35.7208]);
    expect(SOURCE_FIXTURES.murfreesboroZoning.fixtures.some((f) => /Joe B Jackson/.test(f.label))).toBe(true);
  });

  /* ── where it is offered (#3: nothing Rutherford-derived on a Texas, Mississippi, Georgia or Nashville-side site) ── */
  const groups = PANEL_GROUPS.filter((g) => g.key !== "base").map((g) => g.key);
  const offeredAt = (lat, lng) => {
    const scope = { state: siteState({ lat, lng }), loc: { lat, lng } };
    return new Set(groups.flatMap((g) => availableEntries(groupEntriesFor(ALL_LAYERS, g), scope).map(([id]) => id)));
  };
  it.each([
    ["Capital Way, Christiana", 35.7208, -86.3254], ["downtown Murfreesboro", 35.8477, -86.3923], ["Smyrna", 35.98, -86.52], ["La Vergne", 36.0018, -86.5383],
  ])("%s is offered the whole Zoning row", (_n, lat, lng) => { const o = offeredAt(lat, lng); for (const id of ids) expect(o.has(id), id).toBe(true); });
  it.each([
    ["Nashville", 36.1627, -86.7816], ["Memphis", 35.1495, -90.049], ["Knoxville", 35.9606, -83.9207], ["Olive Branch MS", 34.9618, -89.8295], ["Houston", 29.7604, -95.3698], ["Atlanta", 33.749, -84.388],
  ])("%s is offered none of it", (_n, lat, lng) => { const o = offeredAt(lat, lng); for (const id of ids) expect(o.has(id), id).toBe(false); });
});
