/* NEW-1 (Fort Bend County layers, 2026-11-12) — the county's levees, LIDs, Brazos studies, TIRZ, management districts, development agreements and proposed thoroughfares.
 *
 * Holds: (1) the eight rows exist, are Texas-only AND region-scoped to the Fort Bend polygon (hidden at Harris / Dallas / Georgia points, shown at the owner's named Fort Bend points);
 * (2) every row reads a registry source (GIS_SOURCES) at the county's real public host and nothing rides the relay; (3) the click cards are CLEAN — plain labels, no raw field names, no
 * sentinel placeholders (-8888, -9999, 'NP', the year-9999 date), the Brazos studies say "not the effective FEMA map", the levee duplicates share a dedupe key; (4) the Flood & Drainage
 * rows carry a tier + agency, the two Brazos studies fold into ONE panel row; (5) the registry fixtures sit at the owner's named points.
 * The live endpoint truth (Fulshear → no LID; the Candela agreement on FM 359 draws) is the V# live pass — a unit test cannot ask the county. */
import { describe, it, expect, vi, beforeAll } from "vitest";

// layers.js reaches Leaflet-facing modules that need a DOM — stubbed exactly as test/sugarLandLayers.test.js does (nothing here draws).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), tiledMapLayer: vi.fn(), featureLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn(() => () => null) }));

import { ALL_LAYERS, MERGE_GROUPS } from "../src/workspaces/site-planner/lib/layers.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { GIS_SOURCES, auditRegistry } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { LAYER_TIER } from "../src/workspaces/site-planner/lib/layerWeight.js";
import {
  FORTBEND_LAYERS, STUDY_STATUS, soft, monthYear, lidCard, leveeCard, inundationCard, floodplainCard, tirzCard, mmdCard, agreementCard, mtpProposedCard,
} from "../src/workspaces/site-planner/lib/fortBendLayers.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

const IDS = ["fb_lid", "fb_levees", "fb_brazos_inundation", "fb_brazos_floodplain", "fb_tirz", "fb_mmd", "fb_dev_agreements", "fb_mtp_proposed"];
const scopeOf = (p) => ({ state: siteState(p), loc: p });
const FORT_BEND_LID2 = { lat: 29.58, lng: -95.62 }; // the owner's named point → "Fort Bend LID #2"
const FULSHEAR = { lat: 29.69, lng: -95.9 };
const HOUSTON = { lat: 29.76, lng: -95.37 };
const DALLAS = { lat: 32.78, lng: -96.8 };
const GEORGIA = { lat: 32.84, lng: -83.63 };

describe("the eight Fort Bend rows are registered, Texas-only and region-scoped", () => {
  it("all eight are in the registry, and nothing else was added under the fb_ prefix", () => {
    expect(Object.keys(FORTBEND_LAYERS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(ALL_LAYERS[id], id).toBe(FORTBEND_LAYERS[id]);
    expect(Object.keys(ALL_LAYERS).filter((k) => k.startsWith("fb_")).sort()).toEqual([...IDS].sort());
  });
  it("the dead 1-ft contour row is gone", () => { expect(ALL_LAYERS.fb_contours).toBeUndefined(); });
  it("the Fort Bend polygon is in the service-area data (bundled county polygon) and holds the owner's named points", () => {
    expect(SERVICE_AREAS.fortbend.polys.length).toBeGreaterThan(0);
  });
  it.each(IDS)("%s: states [TX], regions [fortbend]", (id) => {
    expect(ALL_LAYERS[id].states).toEqual(["TX"]);
    expect(ALL_LAYERS[id].regions).toEqual(["fortbend"]);
  });
  it.each(IDS)("%s is offered at Fort Bend points and hidden at Houston, Dallas and Georgia points", (id) => {
    const cfg = ALL_LAYERS[id];
    expect(layerAvailableHere(cfg, scopeOf(FORT_BEND_LID2)), "LID #2 point").toBe(true);
    expect(layerAvailableHere(cfg, scopeOf(FULSHEAR)), "Fulshear").toBe(true);
    expect(layerAvailableHere(cfg, scopeOf(HOUSTON)), "Houston").toBe(false);
    expect(layerAvailableHere(cfg, scopeOf(DALLAS)), "Dallas").toBe(false);
    expect(layerAvailableHere(cfg, scopeOf(GEORGIA)), "Georgia").toBe(false);
  });
  it("the map's draw filter turns every row off outside the county (so no request fires) and leaves them on inside it", () => {
    const on = Object.fromEntries(IDS.map((id) => [id, { on: true, opacity: 1 }]));
    const inside = drawnOverlaysOf(on, { scope: scopeOf(FORT_BEND_LID2), layers: ALL_LAYERS });
    for (const id of IDS) expect(inside[id].on, id).toBe(true);
    for (const elsewhere of [HOUSTON, DALLAS, GEORGIA]) {
      const drawn = drawnOverlaysOf(on, { scope: scopeOf(elsewhere), layers: ALL_LAYERS });
      for (const id of IDS) expect(drawn[id].on, id).toBe(false);
    }
  });
});

describe("every row reads a registry source at the county's own public host", () => {
  const KEYS = { fb_lid: "fbLid", fb_levees: "fbLevees", fb_brazos_inundation: "fbBrazosInundation", fb_brazos_floodplain: "fbBrazosFloodplain", fb_tirz: "fbTirz", fb_mmd: "fbMmd", fb_dev_agreements: "fbDevAgreements", fb_mtp_proposed: "fbMtpProposed" };
  it.each(Object.entries(KEYS))("%s → GIS_SOURCES.%s", (id, key) => {
    const src = GIS_SOURCES[key];
    expect(src, key).toBeTruthy();
    expect(ALL_LAYERS[id].url).toBe(src.serviceUrl);
    expect(src.serviceUrl).toMatch(/^https:\/\/gisportal\.fortbendcountytx\.gov\/arcgis\/rest\/services\/(InteractiveMap|Drainage)\/[A-Za-z_]+\/MapServer\/\d+$/);
    expect(src.serviceUrl).not.toMatch(/\/gis-proxy\//); // the host is CORS-open — no relay
    expect(src.states).toEqual(["TX"]);
    expect(src.tier).toBe("production");
  });
  it("the root folders that answer 'Token Required' are never read", () => {
    for (const key of Object.values(KEYS)) expect(GIS_SOURCES[key].serviceUrl).not.toMatch(/services\/(Boundaries|WaterDistricts|ThoroughfarePlan|Parcels)\//);
  });
  it("the registry audit is clean for the Fort Bend rows (fixtures present, two points ≥ 2 km apart, a tier, a state scope)", () => {
    const mine = Object.fromEntries(Object.entries(GIS_SOURCES).filter(([k]) => Object.values(KEYS).includes(k)));
    expect(auditRegistry(mine, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });
  it("the owner's named fixtures are present: LID #2 point, a Sienna levee, the Candela agreement on FM 359", () => {
    const has = (key, pt) => SOURCE_FIXTURES[key].fixtures.some((f) => Math.abs(f.point[0] - pt[0]) < 1e-4 && Math.abs(f.point[1] - pt[1]) < 1e-4);
    expect(has("fbLid", [-95.62, 29.58])).toBe(true);
    expect(SOURCE_FIXTURES.fbLevees.fixtures.some((f) => /Sienna/.test(f.label))).toBe(true);
    expect(SOURCE_FIXTURES.fbDevAgreements.fixtures.some((f) => /Candela/.test(f.label) && /FM 359/.test(f.label))).toBe(true);
  });
});

describe("the click cards are clean (owner constraint #45) and honest", () => {
  const RAW = /\b(LID_NAME|TCEQ_ID|OPERATOR|ENGINEER_FIRM|LEVEE_NM|LEVEE_ID|LEVEE_STAT|PL84_99TF|WTR_NM|FLD_ZONE|ENTITYCODE|MMD_NAME|SUBDIVISION|AFFECTED_ROAD|FULL_NAME|OBJECTID|ROAD_CLA_1|DATE_MODIF|undefined|null|NaN)\b/;
  const text = (card) => JSON.stringify(card);
  it("LID: the name, operator, engineer, TCEQ id, 'Active'", () => {
    const c = lidCard({ LID_NAME: "Fort Bend LID #2", TCEQ_ID: 3071000, OPERATOR: "LID Solutions, LLC", ENGINEER_FIRM: "LJA Engineering, Inc.", STATUS: "A" });
    expect(c.title).toBe("Fort Bend LID #2");
    expect(c.rows).toEqual([
      { label: "Operator", text: "LID Solutions, LLC" }, { label: "Engineer", text: "LJA Engineering, Inc." },
      { label: "TCEQ district ID", text: "3071000" }, { label: "Status", text: "Active" },
    ]);
    expect(text(c)).not.toMatch(RAW);
  });
  it("LID: blank fields drop out, a card with nothing but a name still has a title", () => {
    const c = lidCard({ LID_NAME: "X LID", OPERATOR: " ", ENGINEER_FIRM: null, TCEQ_ID: null, STATUS: "" });
    expect(c.rows).toEqual([]);
    expect(lidCard({}).title).toBe("Levee Improvement District");
  });
  it("Levee: a real county row prints the name in words, the waterway, and NEVER the placeholders", () => {
    const c = leveeCard({ LEVEE_ID: "48157C_189", LEVEE_NM: "SIENNA PLANTATION LEVEE IMPROVEMENT DISTRICT LEVEE", OWNER: "NP", PL84_99TF: "U", LEVEE_STAT: "NP", WTR_NM: "BRAZOS RIVER", FREEBOARD: -8888, CONST_DATE: 253392451200000 });
    expect(c.title).toBe("Sienna Plantation Levee Improvement District Levee");
    expect(c.rows).toEqual([
      { label: "Waterway", text: "Brazos River" },
      { label: "FEMA accreditation", text: "Not stated in the county's data" },
    ]);
    const t = text(c);
    expect(t).not.toMatch(/-8888|253392451200000|\bNP\b|\bU\b/);
    expect(t).not.toMatch(RAW);
  });
  it("Levee: an accredited one says so; PL 84-99 T/F reads in words", () => {
    expect(leveeCard({ LEVEE_NM: "Pecan Grove Municipal Utility District Levee", LEVEE_STAT: "Accredited", WTR_NM: "BRAZOS RIVER" }).rows[1]).toEqual({ label: "FEMA accreditation", text: "Accredited" });
    expect(leveeCard({ LEVEE_NM: "L", PL84_99TF: "T" }).rows.some((r) => /Enrolled/.test(r.text))).toBe(true);
    expect(leveeCard({ LEVEE_NM: "L", PL84_99TF: "F" }).rows.some((r) => /Not enrolled/.test(r.text))).toBe(true);
  });
  it("Levee: the 28 repeated county rows share one dedupe key per LEVEE_ID, different levees do not", () => {
    const a = leveeCard({ LEVEE_ID: "48157C_283", LEVEE_NM: "A" }), b = leveeCard({ LEVEE_ID: "48157C_283", LEVEE_NM: "A" }), c = leveeCard({ LEVEE_ID: "48157C_284", LEVEE_NM: "B" });
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
    expect(leveeCard({ LEVEE_NM: "no id" }).dedupeKey).toBeUndefined();
  });
  it("Brazos studies: both cards say 'not the effective FEMA map'; the 55-ft card prints the zone but no elevation or depth", () => {
    expect(STUDY_STATUS).toMatch(/not the effective FEMA map/);
    expect(JSON.stringify(inundationCard())).toContain(STUDY_STATUS);
    const f = floodplainCard({ FLD_ZONE: "AE", STATIC_BFE: -9999, DEPTH: -9999, SOURCE_CIT: "STUDY1" });
    expect(f.rows).toEqual([{ label: "Mapped in the study as", text: "Zone AE" }, { label: "What this is", text: STUDY_STATUS }]);
    expect(text(f)).not.toMatch(/-9999|STUDY1|BFE|depth/i);
  });
  it("TIRZ / management district / development agreement", () => {
    expect(tirzCard({ NAME: "C06 TIRZ 1", ENTITYCODE: "T104", NOTES: null })).toEqual({ title: "C06 TIRZ 1", rows: [{ label: "County code", text: "T104" }] });
    expect(mmdCard({ MMD_NAME: "Sienna Plantation Management District", TCEQ_ID: 7573200, STATUS: "A", POC: "A Person" })).toEqual({
      title: "Sienna Plantation Management District", rows: [{ label: "TCEQ district ID", text: "7573200" }, { label: "Status", text: "Active" }],
    });
    expect(text(mmdCard({ MMD_NAME: "M", POC: "A Person", POC_PHONE: "555" }))).not.toMatch(/Person|555/); // the contact is never printed
    const a = agreementCard({ SUBDIVISION: "Candela (Hines Nursery)", AFFECTED_ROAD: "FM 359 Rd, Fulshear Gaston Rd", DEVELOPER: "JDS Nursery Tract LLC", TYPE: "Shared-Construction and Contribution", STATUS: "Active" });
    expect(a.title).toBe("Candela (Hines Nursery)");
    expect(a.rows).toEqual([
      { label: "Affected road", text: "FM 359 Rd, Fulshear Gaston Rd" }, { label: "Developer", text: "JDS Nursery Tract LLC" },
      { label: "Agreement type", text: "Shared-Construction and Contribution" }, { label: "Status", text: "Active" },
    ]);
    expect(text(a)).not.toMatch(RAW);
  });
  it("MTP proposed road: name in words, 'Proposed — not built', the city, the plan line's last-update month; no lanes (the layer reads 0)", () => {
    const c = mtpProposedCard({ FULL_NAME: "MUEGGE RD", RD_NAME: "MUEGGE", ROAD_CLA_1: "PROPOSED", LANES: 0, CITY: "ROSENBERG", DATE_MODIF: 1093928400000 });
    expect(c.title).toBe("Muegge Rd");
    expect(c.rows).toEqual([{ label: "Plan status", text: "Proposed — not built" }, { label: "City", text: "Rosenberg" }, { label: "Plan line last updated", text: "Aug 2004" }]);
    expect(text(c)).not.toMatch(/lane/i);
    expect(mtpProposedCard({ FULL_NAME: "X", CITY: " ", DATE_MODIF: null }).rows).toEqual([{ label: "Plan status", text: "Proposed — not built" }]);
  });
  it("soft() and monthYear() read shouted text and epochs, and refuse placeholders", () => {
    expect(soft("FM 359 RD")).toBe("FM 359 Rd");
    expect(soft("Already Mixed Case")).toBe("Already Mixed Case");
    expect(monthYear(253392451200000)).toBeNull();
    expect(monthYear(0)).toBeNull();
    expect(monthYear("junk")).toBeNull();
  });
  it("every row's click card is wired (no hover popup — the card only opens on a click, owner constraint #43)", () => {
    for (const id of IDS) {
      expect(typeof ALL_LAYERS[id].identifyCard, id).toBe("function");
      expect(ALL_LAYERS[id].hoverTitle, id).toBeUndefined();
      expect(ALL_LAYERS[id].hoverFields, id).toBeUndefined();
    }
  });
});

describe("Flood & Drainage placement and the standing owner rules", () => {
  it("the four flood rows join a tier with an agency; the Brazos studies are ADVISORY and say FBCDD", () => {
    for (const id of ["fb_lid", "fb_levees", "fb_brazos_inundation", "fb_brazos_floodplain"]) {
      expect(ALL_LAYERS[id].group, id).toBe("flood");
      expect(["regulatory", "local", "hydrography", "advisory"]).toContain(ALL_LAYERS[id].floodTier);
      expect(ALL_LAYERS[id].agency, id).toBeTruthy();
      expect(ALL_LAYERS[id].areaCounties, id).toEqual(["fortbend"]);
    }
    expect(ALL_LAYERS.fb_brazos_inundation.floodTier).toBe("advisory");
    expect(ALL_LAYERS.fb_brazos_floodplain.floodTier).toBe("advisory");
    expect(ALL_LAYERS.fb_brazos_inundation.agency).toBe("FBCDD");
    expect(ALL_LAYERS.fb_levees.agency).toBe("FBCDD");
  });
  it("the two Brazos studies are ONE panel row (merge group) and carry the 'not FEMA effective' caveat behind the (i)", () => {
    expect(MERGE_GROUPS.fb_brazos_studies.label).toMatch(/Brazos/);
    expect(ALL_LAYERS.fb_brazos_inundation.mergeGroup).toBe("fb_brazos_studies");
    expect(ALL_LAYERS.fb_brazos_floodplain.mergeGroup).toBe("fb_brazos_studies");
    for (const id of ["fb_brazos_inundation", "fb_brazos_floodplain"]) expect(ALL_LAYERS[id].infoCaveat).toMatch(/not the effective FEMA map/);
  });
  it("TIRZ / management districts / development agreements are Jurisdictions rows; the proposed thoroughfares an Access row", () => {
    for (const id of ["fb_tirz", "fb_mmd", "fb_dev_agreements"]) expect(ALL_LAYERS[id].group, id).toBe("jurisdiction");
    expect(ALL_LAYERS.fb_mtp_proposed.group).toBe("access");
    expect(ALL_LAYERS.fb_mtp_proposed.role).toBe("line");
    expect(ALL_LAYERS.fb_levees.role).toBe("line");
  });
  it("every row declares a stacking role, a zone gate, a source and a loudness tier (layerWeight)", () => {
    for (const id of IDS) {
      expect(["area", "line", "point"]).toContain(ALL_LAYERS[id].role);
      expect(ALL_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(10);
      expect(ALL_LAYERS[id].source, id).toBeTruthy();
      expect(LAYER_TIER[id], id).toBeTruthy();
    }
  });
  it("opacity: no row sets its own default below 100% (owner constraint #42 — the registry normalises it)", () => {
    for (const id of IDS) expect(ALL_LAYERS[id].opacity ?? 1, id).toBe(1);
  });
  it("no row requests a personal-contact column (the MMD point of contact, the LID operator's phone)", () => {
    for (const id of IDS) for (const f of ALL_LAYERS[id].fields || []) expect(f, `${id}.${f}`).not.toMatch(/PHONE|POC|ENGINEER_PHONE|OPERATOR_PHONE/);
  });
});
