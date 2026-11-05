/* NEW-1 (Tennessee) — city, county and road authority in the header chip and Site Analysis, and the "no Texas number on a Tennessee site" guard.
 *
 * RED-PROOF: every identify / badge assertion below fails on the pre-change main — there was no `countyTn` / `cityTn` / `roadTn` row, so a Nashville
 * point routed NO county or city source (the header read "Unincorporated" with no county), a Chattanooga point read "GA" (it sat inside Georgia's
 * routing box), and a Clarksville (Montgomery County) point would have matched Montgomery County, TEXAS by bare name. The Texas, Colorado, Georgia and
 * New Jersey arms assert those resolve EXACTLY as before.
 *
 * The fixtures' answers are the LIVE ones, measured from the build sandbox 2026-10-28 against the State of Tennessee's TN_Cities_view /
 * TN_Counties_view (State of Tennessee STS, services1.arcgis.com/YuVBSS7Y1of2Qud1) and TDOT's Road_Segment (services2.arcgis.com/nf3p7v7Zy4fTOh6M). */
import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — same stubs as test/njnyJurisdiction.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  JURISDICTION_SOURCES, countySourcesForPoint, citySourcesForPoint, etjSourcesForPoint,
  identifyJurisdiction, formatJurisdictionBadge, countyAtPoint, identifyRoadAuthority, tnFuncClassNumber,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { siteState, STATE_POLYGONS } from "../src/workspaces/site-planner/lib/siteRegion.js";
import {
  TN_OUTLINE, TN_CONSOLIDATED, inTennesseeEnvelope, inTennesseeOutline, tennesseeConsolidatedFor, tnRoadAuthority, shelbyUdcApplies,
  TN_JURISDICTION_SOURCE_NAME,
} from "../src/workspaces/site-planner/lib/tennesseeJurisdiction.js";
import { computeRequiredDetention, authorityForJurisdiction } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { deriveZoning, buildJurisdictionFinding, buildRoadFinding } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { roadsLineOf, buildGovernsModel, cityLineOf } from "../src/workspaces/site-planner/lib/siteGoverns.js";
import { jurisdictionRungs, governingIdentity } from "../src/workspaces/site-planner/lib/jurisdictionBadgeFit.js";
import { GIS_SOURCES, auditRegistry, sourceCoversState } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { jurisdictionSourceName } from "../src/workspaces/site-planner/lib/georgiaJurisdiction.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => map.delete(k),
    get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) { fn.log.push(needle); return { features: respond(url) }; }
    throw new Error("no route for " + url);
  };
  fn.log = [];
  return fn;
}
const TN_COUNTY = "TN_Counties_view", TN_CITY = "TN_Cities_view";
const GA_COUNTY = "Counties_2018", GA_CITY = "Georgia/Municipal_Boundaries"; // GA city service path is .../Municipal_Boundaries/FeatureServer
const one = (attributes) => (attributes ? [{ attributes }] : []);
/* A Tennessee answer. The Georgia layers are always routed (Chattanooga's box overlap asks them) and answer empty. */
const tn = (county, city) => ({
  [TN_COUNTY]: () => one(county && { NAME: county, GEOID: "47000" }),
  [TN_CITY]: () => one(city && { NAME: city }),
  [GA_COUNTY]: () => [],
  "Municipal_Boundaries": () => [],
});
const run = (pt, routes) => identifyJurisdiction(pt[0], pt[1], { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ["county", "city", "etj"] });
const badge = async (pt, routes) => formatJurisdictionBadge(await run(pt, routes));

/* [lng, lat] */
const CULVERT = [-86.75516, 36.137653], BELLE_MEADE = [-86.85, 36.1], MEMPHIS = [-90.049, 35.1495], UNINC_SHELBY = [-89.9, 35.3],
  GERMANTOWN = [-89.8101, 35.0868], COLLIERVILLE = [-89.6645, 35.042], MURFREESBORO = [-86.3903, 35.8456], EPPS_MILL = [-86.3194, 35.7299],
  CHATTANOOGA = [-85.3097, 35.0456], CLARKSVILLE = [-87.3595, 36.5298], KNOXVILLE = [-83.9207, 35.9606], UNINC_KNOX = [-84.0, 36.05],
  GOODLETTSVILLE_SUMNER = [-86.7, 36.345], GOODLETTSVILLE_DAVIDSON = [-86.71, 36.305], RURAL_LAUDERDALE = [-89.6, 35.7], LYNCHBURG = [-86.3719, 35.2845],
  MOORE_RURAL = [-86.4, 35.3], HARTSVILLE = [-86.1594, 36.3987];
const ATLANTA = [-84.388, 33.749], DALTON_GA = [-84.97, 34.77], HOUSTON = [-95.37, 29.76], DENVER = [-104.99, 39.74], NEWARK = [-74.1724, 40.7357];
const PADUCAH_KY = [-88.6, 37.08], SOUTHAVEN_MS = [-90.0, 34.97], HUNTSVILLE_AL = [-86.59, 34.73], WEST_MEMPHIS_AR = [-90.18, 35.15], BRISTOL_VA = [-82.19, 36.62], TUPELO_MS = [-88.7, 34.26];

describe("routing — the box routes, the state's own layers decide, and Georgia / Texas / Colorado / NJ are untouched", () => {
  it("a Tennessee point routes to the State of Tennessee county + city rows", () => {
    expect(countySourcesForPoint(CULVERT[1], CULVERT[0])).toEqual([JURISDICTION_SOURCES.countyTn]);
    expect(citySourcesForPoint(CULVERT[1], CULVERT[0])).toEqual([JURISDICTION_SOURCES.cityTn]);
    expect(countySourcesForPoint(MEMPHIS[1], MEMPHIS[0])).toEqual([JURISDICTION_SOURCES.countyTn]);
  });
  it("where Tennessee's box and Georgia's overlap (Chattanooga), BOTH states' layers are asked, Tennessee first", () => {
    expect(countySourcesForPoint(CHATTANOOGA[1], CHATTANOOGA[0])).toEqual([JURISDICTION_SOURCES.countyTn, JURISDICTION_SOURCES.countyGa]);
    expect(citySourcesForPoint(CHATTANOOGA[1], CHATTANOOGA[0])).toEqual([JURISDICTION_SOURCES.cityTn, JURISDICTION_SOURCES.cityGa]);
  });
  it("Georgia (Atlanta, Dalton), Texas (Houston), Colorado (Denver) and NJ (Newark) resolve to the SAME sources as before", () => {
    expect(countySourcesForPoint(ATLANTA[1], ATLANTA[0])).toEqual([JURISDICTION_SOURCES.countyGa]);
    expect(countySourcesForPoint(DALTON_GA[1], DALTON_GA[0])).toEqual([JURISDICTION_SOURCES.countyGa]);
    expect(countySourcesForPoint(HOUSTON[1], HOUSTON[0])).toEqual([JURISDICTION_SOURCES.county]);
    expect(countySourcesForPoint(DENVER[1], DENVER[0])).toEqual([JURISDICTION_SOURCES.countyCo]);
    expect(countySourcesForPoint(NEWARK[1], NEWARK[0])).toEqual([JURISDICTION_SOURCES.countyNj]);
    const tnRows = [JURISDICTION_SOURCES.countyTn, JURISDICTION_SOURCES.cityTn, JURISDICTION_SOURCES.roadTn];
    for (const p of [ATLANTA, DALTON_GA, HOUSTON, DENVER, NEWARK]) {
      for (const s of [...countySourcesForPoint(p[1], p[0]), ...citySourcesForPoint(p[1], p[0])]) expect(tnRows).not.toContain(s);
    }
  });
  it("Tennessee has no ETJ source anywhere, and says nothing about one", async () => {
    for (const p of [CULVERT, MEMPHIS, EPPS_MILL, CHATTANOOGA, KNOXVILLE]) expect(etjSourcesForPoint(p[1], p[0])).toEqual([]);
    const j = await run(EPPS_MILL, tn("Rutherford", null));
    expect(j.sources.find((x) => x.id === "etj").msg).toBeNull(); // not "No ETJ layer for this area yet." — that promises a coming feature
  });
  it("siteState: Chattanooga and the whole state are TN (Chattanooga used to read GA), and Georgia keeps its own", () => {
    const tnPts = [["Culvert St", CULVERT], ["Memphis", MEMPHIS], ["Chattanooga", CHATTANOOGA], ["Knoxville", KNOXVILLE], ["Clarksville", CLARKSVILLE],
      ["Murfreesboro", MURFREESBORO], ["Goodlettsville", GOODLETTSVILLE_SUMNER], ["Cleveland TN", [-84.88, 35.16]], ["Johnson City", [-82.35, 36.31]],
      ["Chattanooga south side", [-85.3, 35.0]]];
    for (const [n, p] of tnPts) expect(siteState({ lat: p[1], lng: p[0] }), n).toBe("TN");
    for (const [n, p] of [["Atlanta", ATLANTA], ["Dalton", DALTON_GA], ["Rossville GA", [-85.29, 34.98]], ["Fort Oglethorpe GA", [-85.25, 34.95]]]) expect(siteState({ lat: p[1], lng: p[0] }), n).toBe("GA");
    expect(siteState({ lat: HOUSTON[1], lng: HOUSTON[0] })).toBe("TX");
    expect(siteState({ lat: DENVER[1], lng: DENVER[0] })).toBe("CO");
    expect(siteState({ lat: NEWARK[1], lng: NEWARK[0] })).toBe("NJ");
    expect(Object.keys(STATE_POLYGONS)).toContain("TN");
  });
  it("the Tennessee outline holds every Tennessee fixture and none of the neighbours' cities", () => {
    expect(TN_OUTLINE.length).toBeGreaterThan(20);
    for (const p of [CULVERT, MEMPHIS, CHATTANOOGA, KNOXVILLE, CLARKSVILLE, EPPS_MILL, LYNCHBURG, HARTSVILLE]) expect(inTennesseeOutline(p[1], p[0])).toBe(true);
    for (const p of [ATLANTA, DALTON_GA, HUNTSVILLE_AL, TUPELO_MS, PADUCAH_KY, WEST_MEMPHIS_AR, HOUSTON]) expect(inTennesseeOutline(p[1], p[0]), JSON.stringify(p)).toBe(false);
    expect(inTennesseeEnvelope(BRISTOL_VA[1], BRISTOL_VA[0])).toBe(true); // the box is only a pre-filter; the county layer decides
  });
});

describe("the header — city, county, and never ETJ", () => {
  it("20 Culvert St, Nashville: the Metro government, not 'unincorporated Davidson'", async () => {
    const b = await badge(CULVERT, tn("Davidson", "Nashville"));
    expect(b.text).toBe("Metro Nashville-Davidson County, TN");
    expect(b.state).toBe("TN");
    expect(b.shape).toBe("in-city");
    expect(b.consolidated.label).toBe("Metro Nashville-Davidson County");
  });
  it("a satellite city inside Davidson (Belle Meade) is a city INSIDE the Metro government", async () => {
    const b = await badge(BELLE_MEADE, tn("Davidson", "Belle Meade"));
    expect(b.text).toBe("City of Belle Meade, TN · Metro Nashville-Davidson County");
    expect(b.governingCities).toEqual(["Belle Meade"]);
  });
  it("a Davidson point that no city polygon names is STILL inside the Metro government — never unincorporated", async () => {
    const j = await run(CULVERT, tn("Davidson", null));
    expect(j.unincorporated).toBe(false);
    expect(j.consolidated.county).toBe("Davidson");
    expect(formatJurisdictionBadge(j).text).toBe("Metro Nashville-Davidson County, TN");
  });
  it("Lynchburg-Moore County and Hartsville-Trousdale County are consolidated too, inside or outside their town polygon", async () => {
    expect((await badge(LYNCHBURG, tn("Moore", "Lynchburg"))).text).toBe("Metro Lynchburg-Moore County, TN");
    expect((await badge(MOORE_RURAL, tn("Moore", null))).text).toBe("Metro Lynchburg-Moore County, TN");
    expect((await badge(HARTSVILLE, tn("Trousdale", "Hartsville"))).text).toBe("Metro Hartsville-Trousdale County, TN");
    expect((await badge([-86.2, 36.38], tn("Trousdale", null))).text).toBe("Metro Hartsville-Trousdale County, TN");
  });
  it("Memphis, Germantown, Collierville: the city, then the county", async () => {
    expect((await badge(MEMPHIS, tn("Shelby", "Memphis"))).text).toBe("City of Memphis, TN · Shelby County");
    expect((await badge(GERMANTOWN, tn("Shelby", "Germantown"))).text).toBe("City of Germantown, TN · Shelby County");
    expect((await badge(COLLIERVILLE, tn("Shelby", "Collierville"))).text).toBe("City of Collierville, TN · Shelby County");
  });
  it("unincorporated Shelby, Rutherford (Epps Mill Rd at I-24), Knox and a rural Lauderdale point: 'Unincorporated <County> County, TN'", async () => {
    expect((await badge(UNINC_SHELBY, tn("Shelby", null))).text).toBe("Unincorporated Shelby County, TN");
    expect((await badge(EPPS_MILL, tn("Rutherford", null))).text).toBe("Unincorporated Rutherford County, TN");
    expect((await badge(UNINC_KNOX, tn("Knox", null))).text).toBe("Unincorporated Knox County, TN");
    expect((await badge(RURAL_LAUDERDALE, tn("Lauderdale", null))).text).toBe("Unincorporated Lauderdale County, TN");
  });
  it("Murfreesboro, Chattanooga (asked in Georgia's box too), Clarksville, Knoxville", async () => {
    expect((await badge(MURFREESBORO, tn("Rutherford", "Murfreesboro"))).text).toBe("City of Murfreesboro, TN · Rutherford County");
    expect((await badge(CHATTANOOGA, tn("Hamilton", "Chattanooga"))).text).toBe("City of Chattanooga, TN · Hamilton County");
    expect((await badge(CLARKSVILLE, tn("Montgomery", "Clarksville"))).text).toBe("City of Clarksville, TN · Montgomery County");
    expect((await badge(KNOXVILLE, tn("Knox", "Knoxville"))).text).toBe("City of Knoxville, TN · Knox County");
  });
  it("a city that crosses a county line (Goodlettsville): the county is the one the SITE is in", async () => {
    expect((await badge(GOODLETTSVILLE_SUMNER, tn("Sumner", "Goodlettsville"))).text).toBe("City of Goodlettsville, TN · Sumner County");
    expect((await badge(GOODLETTSVILLE_DAVIDSON, tn("Davidson", "Goodlettsville"))).text).toBe("City of Goodlettsville, TN · Metro Nashville-Davidson County");
  });
  it("NEVER 'ETJ' (nor 'extraterritorial') on a Tennessee site — every visible string the badge carries", async () => {
    const cases = [[CULVERT, tn("Davidson", "Nashville")], [EPPS_MILL, tn("Rutherford", null)], [MEMPHIS, tn("Shelby", "Memphis")], [CHATTANOOGA, tn("Hamilton", "Chattanooga")]];
    for (const [pt, routes] of cases) {
      const j = await run(pt, routes);
      const b = formatJurisdictionBadge(j);
      const everything = JSON.stringify({ t: b.text, jur: b.jur, parts: b.parts, tail: b.tail, note: b.gaNote, msgs: j.sources.map((x) => x.msg) });
      expect(everything).not.toMatch(/etj|extraterritorial/i);
    }
  });
  it("the tooltip note is plain: no ETJ, the vintage, the growth-plan caveat; Shelby's note only on Memphis / unincorporated Shelby", async () => {
    const memphis = await badge(MEMPHIS, tn("Shelby", "Memphis"));
    expect(memphis.gaNote).not.toMatch(/county is the local government/); // a city site: that sentence is noise
    const rural = await badge(EPPS_MILL, tn("Rutherford", null));
    expect(rural.gaNote).toMatch(/Outside city limits the county is the local government/);
    expect(rural.gaNote).toMatch(/growth plans/);
    expect(memphis.gaNote).toMatch(/Unified Development Code/);
    expect(memphis.gaNote).toMatch(/last edited 2026-03-18/);
    expect((await badge(UNINC_SHELBY, tn("Shelby", null))).gaNote).toMatch(/Unified Development Code/);
    expect((await badge(GERMANTOWN, tn("Shelby", "Germantown"))).gaNote).not.toMatch(/Unified Development Code/); // Germantown has its own planning
    expect((await badge(KNOXVILLE, tn("Knox", "Knoxville"))).gaNote).not.toMatch(/Unified Development Code/);
    expect(shelbyUdcApplies(["Shelby"], ["Memphis"])).toBe(true);
    expect(shelbyUdcApplies(["Shelby"], ["Collierville"])).toBe(false);
    expect(shelbyUdcApplies(["Davidson"], [])).toBe(false);
  });
  it("the narrow-header rungs name the Metro government, never 'City of Nashville'", async () => {
    const b = await badge(CULVERT, tn("Davidson", "Nashville"));
    expect(governingIdentity(b)).toBe("Metro Nashville-Davidson County");
    for (const r of jurisdictionRungs(b)) expect(r).not.toMatch(/City of Nashville/);
    expect(governingIdentity(await badge(BELLE_MEADE, tn("Davidson", "Belle Meade")))).toBe("City of Belle Meade");
    expect(governingIdentity(await badge(EPPS_MILL, tn("Rutherford", null)))).toBe("Unincorporated");
  });
  it("source name for the tooltip is Tennessee's own, never the Texas string", () => {
    expect(jurisdictionSourceName("TN")).toBe(TN_JURISDICTION_SOURCE_NAME);
    expect(TN_JURISDICTION_SOURCE_NAME).not.toMatch(/TxDOT|TxGIO|ETJ/);
  });
});

describe("the state is point-in-polygon, never the box", () => {
  it("a Georgia point that Georgia's box shares with Tennessee's (north Georgia, county answered by Georgia) is Georgia", async () => {
    const routes = { ...tn(null, null), [GA_COUNTY]: () => one({ NAME: "Catoosa", GEOID: "13047" }) };
    const j = await run([-85.1, 34.99], routes);
    expect(j.state).toBe("GA");
    expect(j.notInTennessee).toBeUndefined();
    expect(formatJurisdictionBadge(j).state).toBe("GA");
  });
  it("Kentucky / Virginia / Arkansas ground inside the box (no county from any layer) is neither Tennessee nor Georgia — no badge, no 'Unincorporated'", async () => {
    for (const p of [SOUTHAVEN_MS, BRISTOL_VA, WEST_MEMPHIS_AR]) {
      const j = await run(p, tn(null, null));
      expect(j.notInTennessee, JSON.stringify(p)).toBe(true);
      expect(formatJurisdictionBadge(j)).toBeNull();
    }
  });
  it("a failed Tennessee lookup is an outage, not 'not Tennessee'", async () => {
    const dead = { [TN_COUNTY]: () => { throw new Error("boom"); }, [TN_CITY]: () => { throw new Error("boom"); }, [GA_COUNTY]: () => [], Municipal_Boundaries: () => [] };
    const j = await run(EPPS_MILL, dead);
    expect(j.notInTennessee).toBeUndefined();
    expect(formatJurisdictionBadge(j)).not.toBeNull();
  });
  it("countyAtPoint answers Chattanooga with Tennessee's county (and a Georgia point in the overlap with Georgia's)", async () => {
    const tnAns = await countyAtPoint(CHATTANOOGA[0], CHATTANOOGA[1], { cache: freshCache(), fetchJson: fakeFetch(tn("Hamilton", "Chattanooga")) });
    expect(tnAns.name).toBe("Hamilton");
    expect(tnAns.state).toBe("TN");
    expect(tnAns.key).toBeNull(); // never a Texas key
    const gaAns = await countyAtPoint(-85.1, 34.99, { cache: freshCache(), fetchJson: fakeFetch({ ...tn(null, null), [GA_COUNTY]: () => one({ NAME: "Catoosa", GEOID: "13047" }) }) });
    expect(gaAns.state).toBe("GA");
    expect(gaAns.name).toBe("Catoosa");
  });
});

describe("consolidated governments", () => {
  it("exactly three, keyed by county, matched however the county is spelled", () => {
    expect(Object.keys(TN_CONSOLIDATED).sort()).toEqual(["Davidson", "Moore", "Trousdale"]);
    expect(tennesseeConsolidatedFor(["Davidson County"]).label).toBe("Metro Nashville-Davidson County");
    expect(tennesseeConsolidatedFor(["moore"]).city).toBe("Lynchburg");
    expect(tennesseeConsolidatedFor(["Shelby"])).toBeNull();
    expect(tennesseeConsolidatedFor([])).toBeNull();
  });
});

describe("Site Analysis — jurisdiction rows, zoning, governs line", () => {
  it("rows: county with the Metro name, the city, and 'None in Tennessee' for ETJ; no Texas source string", async () => {
    const j = await run(CULVERT, tn("Davidson", "Nashville"));
    const f = buildJurisdictionFinding(j, "TN");
    const rows = Object.fromEntries(f.rows.map((r) => [r[0], r[1]]));
    expect(rows.County).toBe("Davidson — Metro Nashville-Davidson County");
    expect(rows.City).toBe("Nashville");
    expect(f.rows.map((r) => r[0])).not.toContain("ETJ"); // not even "none"
    expect(rows["School district"]).toBe("Not screened in Tennessee");
    expect(f.sourceName).toBe(TN_JURISDICTION_SOURCE_NAME);
    const rural = buildJurisdictionFinding(await run(EPPS_MILL, tn("Rutherford", null)), "TN");
    expect(Object.fromEntries(rural.rows.map((r) => [r[0], r[1]])).City).toBe("Unincorporated");
  });
  it("zoning states TENNESSEE doctrine, never Texas's 'counties have no zoning' and never Houston's", async () => {
    const rural = deriveZoning(await run(EPPS_MILL, tn("Rutherford", null)), "TN");
    expect(rural.summary).toMatch(/Tennessee counties MAY zone/);
    expect(rural.summary).not.toMatch(/Texas|no zoning;/i);
    expect(JSON.stringify(rural)).not.toMatch(/etj/i);
    const metro = deriveZoning(await run(CULVERT, tn("Davidson", "Nashville")), "TN");
    expect(metro.summary).toMatch(/^Metro Nashville-Davidson County — Metro zoning applies/);
    const city = deriveZoning(await run(MEMPHIS, tn("Shelby", "Memphis")), "TN");
    expect(city.summary).toMatch(/^Within Memphis — city zoning likely applies/);
  });
  it("the governs model reads the badge: the Metro line, the county, 'Not screened' school district", async () => {
    const b = formatJurisdictionBadge(await run(CULVERT, tn("Davidson", "Nashville")));
    const g = buildGovernsModel(b, { roads: [] }, { state: "TN", stateLabel: "Tennessee", layerKeys: [] });
    expect(g.city.text).toBe("Metro Nashville-Davidson County, TN");
    expect(g.county).toBe("Metro Nashville-Davidson County");
    expect(g.school).toBe("Not screened in Tennessee");
    expect(cityLineOf(formatJurisdictionBadge(await run(EPPS_MILL, tn("Rutherford", null)))).text).toBe("Unincorporated Rutherford County, TN");
  });
});

describe("road authority — TDOT's Road Segment inventory, same plain labels as Texas", () => {
  const seg = (RTE_NME, GOVT_CTRL, ADM_SYS, FUNC_CLASS, NBR_RTE) => ({ attributes: { RTE_NME, GOVT_CTRL, ADM_SYS, FUNC_CLASS, NBR_RTE, NBR_TENN_CNTY: "Rutherford" },
    geometry: { paths: [[[-86.3194, 35.7295], [-86.3194, 35.7305]]] } });
  const roadRoutes = (feats) => ({ Road_Segment: () => feats });
  it("labels: State (TDOT) / County / City — and unknown stays unknown", () => {
    expect(tnRoadAuthority("State Highway Agency", "Interstate, Urban").label).toBe("State (TDOT)");
    expect(tnRoadAuthority("County Highway Agency", "Other County Roads").label).toBe("County");
    expect(tnRoadAuthority("Municipal Highway Agency", "Other City Streets").label).toBe("City");
    expect(tnRoadAuthority("Army", "Federal Park or Reservation").label).toBe("Federal");
    expect(tnRoadAuthority(null, null).label).toBe("Unknown");
    expect(tnRoadAuthority("Something New", "x").label).toBe("Unknown");
  });
  it("functional class text → the FHWA number the road list already decodes", () => {
    expect(tnFuncClassNumber("Urban Interstate")).toBe(1);
    expect(tnFuncClassNumber("Urban Minor Arterial")).toBe(4);
    expect(tnFuncClassNumber("Rural Minor Collector")).toBe(6);
    expect(tnFuncClassNumber("Urban Local")).toBe(7);
    expect(tnFuncClassNumber("Rural Major Collector")).toBe(5);
    expect(tnFuncClassNumber("")).toBeNull();
  });
  it("Epps Mill Rd / I-24: the state maintains I-24, the county the county roads — through the real identify, from the Tennessee source", async () => {
    const fetchJson = fakeFetch(roadRoutes([seg("I-24", "State Highway Agency", "Interstate, Urban", "Urban Interstate", "I0024"),
      seg("EPPS MILL RD.", "County Highway Agency", "STP Urban, Non-State", "Rural Major Collector", "01044"),
      seg("MILLER LN.", "County Highway Agency", "Other County Roads", "Rural Local", "0A514")]));
    const r = await identifyRoadAuthority(EPPS_MILL[0], EPPS_MILL[1], { ring: [[-86.3200, 35.7295], [-86.3188, 35.7295], [-86.3188, 35.7305], [-86.3200, 35.7305], [-86.3200, 35.7295]], cache: freshCache(), fetchJson });
    expect(fetchJson.log).toEqual(["Road_Segment"]);
    expect(r.sourceName).toBe("TDOT Road Segment inventory");
    const byName = Object.fromEntries(r.roads.map((x) => [x.name, x.authority.label]));
    expect(byName).toEqual({ "I-24": "State (TDOT)", "Epps Mill Rd": "County", "Miller Ln": "County" });
    const line = roadsLineOf(r);
    expect(line.kind).toBe("mixed");
    expect(line.text).toMatch(/Mixed · 3 roads · 1 state, 2 county/);
    expect(buildRoadFinding(r).sourceName).toBe("TDOT Road Segment inventory");
  });
  it("a Texas point still asks the TxDOT row (no Tennessee source reaches Houston)", async () => {
    const fetchJson = fakeFetch({ Roadway_Inventory: () => [], "TxDOT": () => [], "": () => [] });
    await identifyRoadAuthority(HOUSTON[0], HOUSTON[1], { cache: freshCache(), fetchJson });
    expect(fetchJson.log.length).toBe(1);
    expect(sourceCoversState(GIS_SOURCES.road, "TN")).toBe(false);
    expect(sourceCoversState(GIS_SOURCES.roadTn, "TN")).toBe(true);
    expect(sourceCoversState(GIS_SOURCES.roadTn, "TX")).toBe(false);
  });
});

describe("no Texas number on a Tennessee site", () => {
  it("detention is the named 'not available in Tennessee yet' state — never a rate, even with a Texas reviewer forced", () => {
    const r = computeRequiredDetention({ siteState: "TN", acres: 25, authorityId: "montgomery" });
    expect(r.kind).toBe("unavailable");
    expect(r.requiredAcFt).toBeNull();
    expect(r.rateAcFtPerAc).toBeNull();
    expect(r.headline).toBe("Detention criteria not yet available in Tennessee");
    expect(r.verdictSubject).toBe("Tennessee detention");
    expect(r.flags).toContain("tennessee-not-wired");
  });
  it("Clarksville is Montgomery County, TENNESSEE — it must never resolve Montgomery County, Texas's rules (or Harris's HCFCD)", async () => {
    const j = await run(CLARKSVILLE, tn("Montgomery", "Clarksville"));
    expect(j.state).toBe("TN");
    const a = authorityForJurisdiction(j);
    expect(a.primary).toBeNull();
    expect(a.channelAuthority).toBeNull();
    expect(a.flags).toContain("tennessee-not-wired");
    expect(a.flags).toContain("no-criteria-modeled");
  });
});

describe("the registry", () => {
  it("the three Tennessee rows pass the registry audit (provider, fixtures, spread, state scope, tier)", () => {
    const only = Object.fromEntries(["countyTn", "cityTn", "roadTn"].map((k) => [k, GIS_SOURCES[k]]));
    expect(auditRegistry(only, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
    for (const k of ["countyTn", "cityTn", "roadTn"]) expect(GIS_SOURCES[k].states).toEqual(["TN"]);
    expect(GIS_SOURCES.cityTn.fullPurposeOnly).toBe(true);
  });
  it("the rows are the State of Tennessee's own, on CORS-open ArcGIS Online hosts — no relay, no key", () => {
    for (const k of ["countyTn", "cityTn"]) expect(GIS_SOURCES[k].serviceUrl).toMatch(/^https:\/\/services1\.arcgis\.com\/YuVBSS7Y1of2Qud1\//);
    expect(GIS_SOURCES.roadTn.serviceUrl).toMatch(/^https:\/\/services2\.arcgis\.com\/nf3p7v7Zy4fTOh6M\//);
  });
});
