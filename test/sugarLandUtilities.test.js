/* City of Sugar Land water and sewer network (NEW-1, 2026-11-06).
 *
 * WHAT IS PINNED, each from a measurement of the live service on 2026-11-06:
 *   · the SOURCE WIRING — which layer id is water and which is sewer (layer 18 "Pressurized Mains" is SEWAGE force mains; the water pressure mains are layer 17), the CDM Smith org, the `where`s;
 *   · the DATE STORY — the newest install date is Jan 2017, the layers' own edit dates differ (2025-11-20 water, 2025-12-23 gravity, 2021-11-10 the rest), and every surface carries them;
 *   · the CARDS and STYLES — plain labels, nothing invented (Subtype / Elevation never decoded), junk sizes dropped, abandoned lines grey and dotted, force mains dashed;
 *   · the GATING — covered point by point in sugarLandLayers.test.js (every row in SUGARLAND_LAYERS is offered at the Academy point and nowhere else); here the new rows are asserted to be in that set. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES } from "../src/shared/gis/sourceFixtures.js";
import { cleanCard } from "../src/workspaces/site-planner/lib/identifyCard.js";
import {
  UTILITY_DATA_AS_OF, UTILITY_TAG, UTILITY_LAYER_EDITED, UTILITY_CAVEAT_TEXT, utilitySource, utilityVintage, taggedLabel,
  sizeInches, installYear, lifecycle, isAbandoned, materialText, operatorText, carriesText, pipeWeight,
  WATER_COLORS, SEWER_COLORS, waterKind, waterStyle, sewerStyle, WATER_LEGEND, SEWER_LEGEND,
  waterLineCard, gravityMainCard, lateralCard, forceMainCard, waterValveCard, controlValveCard, manholeCard, cleanoutCard, liftStationCard, wwtpCard, waterPlantCard, wellCard,
  WATER_WHERE, GRAVITY_WHERE, FORCE_WHERE,
} from "../src/workspaces/site-planner/lib/sugarLandUtilities.js";
import { SUGARLAND_LAYERS, SUGARLAND_MERGE_GROUPS, SUGARLAND_VINTAGE, UTILITY_REQUEST_LINK, UTILITY_MAP_REQUEST_URL } from "../src/workspaces/site-planner/lib/sugarLandLayers.js";
import { rowInfoSections, mergeGroupInfoSections } from "../src/workspaces/site-planner/lib/layerPanelInfo.js";

const NEW_ROWS = {
  sl_water_lines: ["slWaterLines", 17], sl_sewer_gravity: ["slSewerGravity", 20], sl_sewer_laterals: ["slSewerLaterals", 19], sl_sewer_force: ["slSewerForce", 18],
  sl_water_valves: ["slWaterValves", 2], sl_water_control_valves: ["slWaterControlValves", 9], sl_manholes: ["slManholes", 13], sl_cleanouts: ["slCleanouts", 16],
  sl_lift_stations: ["slLiftStations", 23], sl_wwtp: ["slWwtp", 22], sl_water_plants: ["slWaterPlants", 21], sl_water_wells: ["slWaterWells", 4],
};
const day = (iso) => Date.parse(iso + "T12:00:00Z");

describe("source wiring — the right layer is water and the right layer is sewer", () => {
  it("every new row reads CDM Smith's org copy, the layer id measured on 2026-11-06, and nothing from the city's token-locked server", () => {
    for (const [id, [key, layer]] of Object.entries(NEW_ROWS)) {
      const src = GIS_SOURCES[key];
      expect(src, key).toBeTruthy();
      expect(src.serviceUrl, key).toBe(`https://services1.arcgis.com/VVapzOPgBae5joyC/arcgis/rest/services/CityofSugarLand/FeatureServer/${layer}`);
      expect(src.relay, key).toBeUndefined();
      expect(src.states, key).toEqual(["TX"]);
      expect(src.coverage, key).toBe("sugarland");
      expect(SUGARLAND_LAYERS[id].url, id).toBe(src.serviceUrl);
      expect(src.serviceUrl, key).not.toMatch(/interactivemaps|PW_Utilities|CWOL_Services/);
    }
  });
  it("layer 18 ('IWRP - Pressurized Mains', every feature WaterType Sewage) is the SEWER force main row; water pressure mains are layer 17", () => {
    expect(GIS_SOURCES.slSewerForce.serviceUrl).toMatch(/\/18$/);
    expect(GIS_SOURCES.slWaterLines.serviceUrl).toMatch(/\/17$/);
    expect(SUGARLAND_LAYERS.sl_sewer_force.mergeGroup).toBe("sl_sewer_lines");
    expect(SUGARLAND_LAYERS.sl_water_lines.mergeGroup).toBeUndefined();
  });
  it("the three sewer line layers are ONE row (Sewer Lines); valves, structures and plants fold the same way", () => {
    for (const id of ["sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force"]) expect(SUGARLAND_LAYERS[id].mergeGroup, id).toBe("sl_sewer_lines");
    for (const id of ["sl_water_valves", "sl_water_control_valves"]) expect(SUGARLAND_LAYERS[id].mergeGroup, id).toBe("sl_valves");
    for (const id of ["sl_manholes", "sl_cleanouts"]) expect(SUGARLAND_LAYERS[id].mergeGroup, id).toBe("sl_sewer_structures");
    for (const id of ["sl_lift_stations", "sl_wwtp", "sl_water_plants", "sl_water_wells"]) expect(SUGARLAND_LAYERS[id].mergeGroup, id).toBe("sl_plants");
    for (const g of ["sl_sewer_lines", "sl_valves", "sl_sewer_structures", "sl_plants"]) expect(SUGARLAND_MERGE_GROUPS[g], g).toBeTruthy();
  });
  it("the `where` clauses are one definition: the registry carries exactly what the pure module exports", () => {
    expect(GIS_SOURCES.slWaterLines.where).toBe(WATER_WHERE);
    expect(GIS_SOURCES.slSewerGravity.where).toBe(GRAVITY_WHERE);
    expect(GIS_SOURCES.slSewerForce.where).toBe(FORCE_WHERE);
    expect(SUGARLAND_LAYERS.sl_water_lines.where).toBe(WATER_WHERE);
    expect(SUGARLAND_LAYERS.sl_sewer_gravity.where).toBe(GRAVITY_WHERE);
    expect(GRAVITY_WHERE).toMatch(/Proposed/);
    expect(GRAVITY_WHERE).toMatch(/Storm/);
    expect(WATER_WHERE).toMatch(/Removed/);
  });
  it("each row names its fields, includes the service's own object-id field, and requests no editor / creator column", () => {
    for (const id of Object.keys(NEW_ROWS)) {
      const f = SUGARLAND_LAYERS[id].fields;
      expect(Array.isArray(f) && f.length > 2, id).toBe(true);
      expect(f.some((n) => /^OBJECTID/.test(n)), id).toBe(true);
      expect(f.filter((n) => /created_|last_edi|Creator|Editor|GlobalID|WorkorderI/i.test(n)), id).toEqual([]);
    }
    // layers 17/18/19/13/16/2/9/21 use OBJECTID_1 as their id, layer 20 and layer 4 use OBJECTID_12 — a list that omits the real one collapses every feature into one
    expect(SUGARLAND_LAYERS.sl_water_lines.fields).toContain("OBJECTID_1");
    expect(SUGARLAND_LAYERS.sl_sewer_gravity.fields).toContain("OBJECTID_12");
    expect(SUGARLAND_LAYERS.sl_water_wells.fields).toContain("OBJECTID_12");
  });
  it("dense layers page through their whole view (fetchAll)", () => {
    for (const id of ["sl_water_lines", "sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force", "sl_water_valves", "sl_water_control_valves", "sl_manholes", "sl_cleanouts"]) expect(SUGARLAND_LAYERS[id].fetchAll, id).toBe(true);
  });
  it("THE LINES DRAW AT THE ZOOM A DEVELOPER WORKS AT — a whole-site view is ~8 km across (about zoom 14.6), so no line row may be gated above 14 (owner report 2026-11-06: water and sewer drew nothing at ~zoom 14.6 because the gates were 15 / 16)", () => {
    for (const id of ["sl_water_lines", "sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force"]) expect(SUGARLAND_LAYERS[id].minZoom, id).toBeLessThanOrEqual(14);
    // points stay close-zoom so they do not swamp the map (14,648 valves, 15,135 manholes)
    for (const id of ["sl_water_valves", "sl_water_control_valves", "sl_manholes", "sl_cleanouts"]) expect(SUGARLAND_LAYERS[id].minZoom, id).toBeGreaterThanOrEqual(15);
  });
  it("every member of a merged row has the SAME gate — otherwise one switch draws part of a row and the panel toasts 'Sewer Laterals is hidden at this zoom' for a sub-layer the user never saw", () => {
    const byGroup = {};
    for (const id of Object.keys(NEW_ROWS)) { const g = SUGARLAND_LAYERS[id].mergeGroup; if (g) (byGroup[g] ??= new Set()).add(SUGARLAND_LAYERS[id].minZoom); }
    for (const [g, zooms] of Object.entries(byGroup)) expect([...zooms], g).toHaveLength(1);
  });
  it("every new source has at least two real-feature fixture points", () => {
    for (const [, [key]] of Object.entries(NEW_ROWS)) expect(SOURCE_FIXTURES[key].fixtures.length, key).toBeGreaterThanOrEqual(2);
  });
  it("opacity starts at 100% (constraint 42) and click, not hover, answers (constraint 43)", () => {
    for (const id of Object.keys(NEW_ROWS)) { expect(SUGARLAND_LAYERS[id].opacity ?? 1, id).toBe(1); expect(typeof SUGARLAND_LAYERS[id].identifyCard, id).toBe("function"); expect(SUGARLAND_LAYERS[id].canvasIdentify, id).toBe(true); }
  });
});

describe("the date is on the row, in the (i), and on every card", () => {
  it("the content date is Jan 2017 and the three layer edit dates are the ones the service reports", () => {
    expect(UTILITY_DATA_AS_OF).toBe("Jan 2017");
    expect(UTILITY_TAG).toBe("as of 2017");
    expect(UTILITY_LAYER_EDITED).toEqual({ water: "Nov 20, 2025", gravity: "Dec 23, 2025", other: "Nov 10, 2021" });
    expect(taggedLabel("Water Lines")).toBe("Water Lines · as of 2017");
  });
  it("the row label carries the tag (solo row and every merged row)", () => {
    expect(SUGARLAND_LAYERS.sl_water_lines.label).toBe("Water Lines · as of 2017");
    expect(SUGARLAND_MERGE_GROUPS.sl_sewer_lines.label).toBe("Sewer Lines · as of 2017");
    expect(SUGARLAND_MERGE_GROUPS.sl_valves.label).toBe("Water Valves · as of 2017");
    expect(SUGARLAND_MERGE_GROUPS.sl_sewer_structures.label).toBe("Manholes · as of 2017");
    expect(SUGARLAND_MERGE_GROUPS.sl_plants.label).toBe("Utility Plants · as of 2017");
  });
  it("no tagged label is long enough to clip the date at the Layers panel's default width (seen live 2026-11-06: 'Manholes & Cleanouts · as of 2017' lost its date; the owner asked to KEEP the 'as of 2017' wording, so the names are what was shortened)", () => {
    const labels = [SUGARLAND_LAYERS.sl_water_lines.label, ...["sl_sewer_lines", "sl_valves", "sl_sewer_structures", "sl_plants"].map((g) => SUGARLAND_MERGE_GROUPS[g].label)];
    for (const l of labels) { expect(l, l).toMatch(/ · as of 2017$/); expect(l.length, l).toBeLessThanOrEqual(27); }
  });
  it("the (i): every row's Source line names the publisher, the content date and that layer's own edit date; the vintage line says so too", () => {
    expect(SUGARLAND_LAYERS.sl_water_lines.source).toBe(utilitySource("Nov 20, 2025"));
    expect(SUGARLAND_LAYERS.sl_sewer_gravity.source).toMatch(/Dec 23, 2025/);
    expect(SUGARLAND_LAYERS.sl_manholes.source).toMatch(/Nov 10, 2021/);
    for (const id of Object.keys(NEW_ROWS)) {
      expect(SUGARLAND_LAYERS[id].source, id).toMatch(/CDM Smith for the City of Sugar Land/);
      expect(SUGARLAND_LAYERS[id].source, id).toMatch(/dated through Jan 2017/);
      expect(SUGARLAND_VINTAGE[id], id).toMatch(/Jan 2017/);
      expect(SUGARLAND_VINTAGE[id], id).toMatch(/Nov 10, 2021|Nov 20, 2025|Dec 23, 2025/);
      expect(SUGARLAND_LAYERS[id].infoCaveat, id).toBe(UTILITY_CAVEAT_TEXT);
    }
    expect(utilityVintage("Nov 20, 2025")).toMatch(/item was last modified Nov 10, 2021/);
  });
  it("the caution says mains built since are not shown and points to the city's as-builts and 811", () => {
    expect(UTILITY_CAVEAT_TEXT).toMatch(/built since are not shown/);
    expect(UTILITY_CAVEAT_TEXT).toMatch(/Utility Map Request/);
    expect(UTILITY_CAVEAT_TEXT).toMatch(/811/);
  });
  const CARDS = [
    ["water main", waterLineCard, UTILITY_LAYER_EDITED.water], ["gravity main", gravityMainCard, UTILITY_LAYER_EDITED.gravity], ["lateral", lateralCard, UTILITY_LAYER_EDITED.other],
    ["force main", forceMainCard, UTILITY_LAYER_EDITED.other], ["water valve", waterValveCard, UTILITY_LAYER_EDITED.other], ["control valve", controlValveCard, UTILITY_LAYER_EDITED.other],
    ["manhole", manholeCard, UTILITY_LAYER_EDITED.other], ["clean-out", cleanoutCard, UTILITY_LAYER_EDITED.other], ["lift station", liftStationCard, UTILITY_LAYER_EDITED.other],
    ["wwtp", wwtpCard, UTILITY_LAYER_EDITED.other], ["water plant", waterPlantCard, UTILITY_LAYER_EDITED.other], ["well", wellCard, UTILITY_LAYER_EDITED.other],
  ];
  it.each(CARDS)("the %s card carries the data date, the layer's edit date and the source — even for an empty record", (_n, card, edited) => {
    const c = cleanCard(card({}));
    const asOf = c.rows.find((r) => r.label === "Data as of");
    expect(asOf.text).toBe(`Jan 2017 · layer last edited ${edited}`);
    expect(c.rows.find((r) => r.label === "Source").text).toBe("CDM Smith for the City of Sugar Land");
  });
});

describe("cards — plain, nothing invented", () => {
  it("a water main: size, material in words, what it carries, status, install year, operator", () => {
    const c = waterLineCard({ Diameter: 8, Material: "PVC", WaterType: "Potable", LifecycleS: "Active", InstallDat: day("1998-06-15"), Administra: "City of Sugar Land", Subtype: 5, Elevation: 12, Operationa: "District 1" });
    expect(c.title).toBe("Water main");
    expect(c.rows.slice(0, 6)).toEqual([
      { label: "Size", text: "8 in" }, { label: "Material", text: "PVC" }, { label: "Carries", text: "Drinking water" },
      { label: "Status", text: "Active" }, { label: "Installed", text: "1998" }, { label: "Operated by", text: "City of Sugar Land" },
    ]);
    const all = JSON.stringify(c);
    expect(all).not.toMatch(/Subtype|Elevation|District 1|Operationa/);
  });
  it("blank or junk fields drop their rows instead of printing zero, null or a made-up value", () => {
    const c = waterLineCard({ Diameter: 0, Material: " ", WaterType: " ", LifecycleS: null, InstallDat: -2209161600000, Year_: "", Administra: "N" });
    expect(c.rows.map((r) => r.label)).toEqual(["Data as of", "Source"]);
    expect(lateralCard({ Diameter: 86 }).rows.map((r) => r.label)).not.toContain("Size"); // the layer's one 86-inch "lateral" is a slip
    expect(sizeInches(86, 60)).toBeNull();
    expect(sizeInches(36)).toBe(36);
    expect(sizeInches(-1)).toBeNull();
    expect(sizeInches(null)).toBeNull();
  });
  it("sewer mains read NominalDia, laterals and force mains read Diameter", () => {
    expect(gravityMainCard({ NominalDia: 12, Material: "CONC", LifecycleS: "Active", Year_: "1979" }).rows.slice(0, 4)).toEqual([
      { label: "Size", text: "12 in" }, { label: "Material", text: "Concrete" }, { label: "Status", text: "Active" }, { label: "Installed", text: "1979" }]);
    expect(forceMainCard({ Diameter: 1, Material: "PVC" }).title).toBe("Sewer force main (pressure)");
    expect(lateralCard({ Diameter: 6 }).rows[0]).toEqual({ label: "Size", text: "6 in" });
    expect(gravityMainCard({}).title).toBe("Gravity sewer main");
  });
  it("small readers: install year, lifecycle (including the city's 'Adbandoned' typo), material, operator, what a line carries", () => {
    expect(installYear({ InstallDat: day("1970-08-27") })).toBe("1970");
    expect(installYear({ InstallDat: -2209161600000, Year_: "2003" })).toBe("2003"); // 1900-01-01 means unset
    expect(installYear({ InstallDat: day("2030-01-01") })).toBeNull();
    expect(installYear({})).toBeNull();
    expect(lifecycle("Adbandoned")).toBe("Abandoned");
    expect(lifecycle("Abandoned")).toBe("Abandoned");
    expect(lifecycle(" ")).toBeNull();
    expect(isAbandoned({ LifecycleS: "Adbandoned" })).toBe(true);
    expect(materialText("AC")).toBe("Asbestos cement");
    expect(materialText("DIP")).toBe("Ductile iron");
    expect(materialText("Poly Vinyl Chloride")).toBe("PVC");
    expect(materialText("ZZZ")).toBe("ZZZ");
    expect(operatorText("City")).toBe("City of Sugar Land");
    expect(operatorText("City of Sugarland")).toBe("City of Sugar Land");
    expect(operatorText("MUD 128")).toBe("MUD 128");
    expect(operatorText("N")).toBeNull();
    expect(operatorText("Unk")).toBeNull();
    expect(carriesText("Potable Water")).toBe("Drinking water");
    expect(carriesText("Raw")).toBe("Raw water");
    expect(carriesText("Reclaimed")).toBe("Reclaimed water");
    expect(carriesText("Chlorine")).toBe("Chlorine feed line");
    expect(carriesText(" ")).toBeNull();
  });
  it("facilities: shouted names read as words, a missing name still gets a plain title", () => {
    expect(liftStationCard({ BUILDING_N: "HARMON LIFT STATION", LOCATION: "14316 HARMAN ST", LIFE_CYCLE: "Active" }).title).toBe("Harmon Lift Station");
    expect(liftStationCard({ BUILDING_N: "HARMON LIFT STATION", LOCATION: "14316 HARMAN ST" }).rows[0]).toEqual({ label: "Address", text: "14316 Harman St" });
    expect(liftStationCard({}).title).toBe("Sewer lift station");
    expect(wwtpCard({ BUILDING_N: "West WWTP" }).title).toBe("West WWTP");
    expect(waterPlantCard({ Name: "Mason" }).title).toBe("Mason water plant");
    expect(waterPlantCard({}).title).toBe("Water plant");
    expect(wellCard({ Name: " Oakview DR", WaterType: "Raw" }).rows[0]).toEqual({ label: "Carries", text: "Raw water" });
  });
  it("valves and manholes show size / status / year / asset id and nothing else", () => {
    expect(waterValveCard({ Diameter: 6, LifecycleS: "Active", InstallDat: day("2003-05-01"), ASSETID: "WT.SV.A000000001" }).rows.slice(0, 4)).toEqual([
      { label: "Size", text: "6 in" }, { label: "Status", text: "Active" }, { label: "Installed", text: "2003" }, { label: "ID", text: "WT.SV.A000000001" }]);
    expect(manholeCard({ ASSETID: "SS.MH.A000003006", Elevation: 76.5, InvertElev: 5, AccessDiam: 36 }).rows.map((r) => r.label)).toEqual(["ID", "Data as of", "Source"]);
  });
});

describe("styles — water and sewer read apart, pressure from gravity", () => {
  const stroke = (f, p) => f(p, 1);
  it("water is blue, raw teal and dashed, reclaimed purple, abandoned grey and dotted; size sets the weight", () => {
    expect(stroke(waterStyle, { WaterType: "Potable", Diameter: 8 }).color).toBe(WATER_COLORS.potable);
    const raw = stroke(waterStyle, { WaterType: "Raw", Diameter: 8 });
    expect(raw.color).toBe(WATER_COLORS.raw);
    expect(raw.dashArray).toBe("8 4");
    expect(stroke(waterStyle, { WaterType: "Reclaimed" }).color).toBe(WATER_COLORS.reclaimed);
    const ab = stroke(waterStyle, { WaterType: "Potable", LifecycleS: "Abandoned" });
    expect(ab.color).toBe(WATER_COLORS.abandoned);
    expect(ab.dashArray).toBe("2 5");
    expect(waterKind({ WaterType: "Potable Water" })).toBe("potable");
    expect(waterKind({ WaterType: "Phosphates" })).toBe("potable");
    expect(pipeWeight(36)).toBeGreaterThan(pipeWeight(12));
    expect(pipeWeight(12)).toBeGreaterThan(pipeWeight(8));
    expect(pipeWeight(8)).toBeGreaterThan(pipeWeight(6));
    expect(pipeWeight(null)).toBeGreaterThan(0);
    expect(waterStyle({}, 0.5).opacity).toBe(0.5);
    expect(waterStyle({}, 1).fill).toBe(false);
  });
  it("sewer is green; a force main is dashed (pressure), a gravity main is solid; abandoned is grey and dotted; a lateral is the thinnest", () => {
    const g = sewerStyle("gravity")({ NominalDia: 8 }, 1), l = sewerStyle("lateral")({ Diameter: 6 }, 1), f = sewerStyle("force")({ Diameter: 4 }, 1);
    expect(g.color).toBe(SEWER_COLORS.gravity);
    expect(g.dashArray).toBeUndefined();
    expect(f.dashArray).toBe("10 5");
    expect(l.weight).toBeLessThan(g.weight);
    expect(sewerStyle("gravity")({ LifecycleS: "Adbandoned" }, 1)).toMatchObject({ color: SEWER_COLORS.abandoned, dashArray: "2 5" });
  });
  it("water and sewer never share a colour; the legends list what the map draws", () => {
    const w = new Set(Object.values(WATER_COLORS).filter((c) => c !== WATER_COLORS.abandoned)), s = new Set(Object.values(SEWER_COLORS).filter((c) => c !== SEWER_COLORS.abandoned));
    for (const c of s) expect(w.has(c)).toBe(false);
    expect(WATER_LEGEND.map((e) => e.label)).toEqual(["Water main", "Raw water", "Reclaimed water", "Abandoned"]);
    expect(SEWER_LEGEND.map((e) => e.label)).toEqual(["Gravity sewer main", "Service lateral", "Force main (pressure)", "Abandoned"]);
    expect(SUGARLAND_LAYERS.sl_water_lines.legend).toBe(WATER_LEGEND);
    expect(SUGARLAND_LAYERS.sl_sewer_gravity.legend).toBe(SEWER_LEGEND);
  });
});

describe("the source / date note and the request link live behind each row's (i) — never as a paragraph in the panel (owner rule, 2026-11-06)", () => {
  it("every water / sewer row carries the Utility Map Request link", () => {
    expect(UTILITY_REQUEST_LINK).toEqual({ text: "Request current utility maps from the city", href: UTILITY_MAP_REQUEST_URL });
    for (const id of Object.keys(NEW_ROWS)) expect(SUGARLAND_LAYERS[id].infoLink, id).toBe(UTILITY_REQUEST_LINK);
    expect(UTILITY_MAP_REQUEST_URL).toBe("https://survey123.arcgis.com/share/a9755767526546b5a9509d1648399862");
  });
  it("a solo row's (i) ends with the link, after the source, the as-of line and the caution", () => {
    const sec = rowInfoSections(SUGARLAND_LAYERS.sl_water_lines, { vintage: SUGARLAND_VINTAGE.sl_water_lines });
    expect(sec.map((x) => (x.link ? "link" : /^Source:/.test(x.text) ? "source" : /^As of:/.test(x.text) ? "asof" : "other")).filter((k) => k !== "other")).toEqual(["source", "asof", "link"]);
    expect(sec.at(-1).link.href).toBe(UTILITY_MAP_REQUEST_URL);
    expect(sec.some((x) => x.text === UTILITY_CAVEAT_TEXT)).toBe(true);
  });
  it("a merged row's (i) shows the link ONCE, not once per member", () => {
    const members = ["sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force"].map((id) => [id, SUGARLAND_LAYERS[id]]);
    const sec = mergeGroupInfoSections(members, { groupNote: SUGARLAND_MERGE_GROUPS.sl_sewer_lines.note });
    expect(sec.filter((x) => x.link)).toHaveLength(1);
    expect(sec.filter((x) => x.text === UTILITY_CAVEAT_TEXT)).toHaveLength(1);
  });
  it("the panel renders NO group-level note: no GroupNote component, no layer-group-note, no Sugar Land note function", () => {
    const panel = readFileSync("src/workspaces/site-planner/components/LayerPanel.jsx", "utf8");
    expect(panel).not.toMatch(/GroupNote|layer-group-note|sugarLandGroupNote/);
    expect(panel).toMatch(/layer-info-link/); // the (i) can carry a link
    const layers = readFileSync("src/workspaces/site-planner/lib/sugarLandLayers.js", "utf8");
    expect(layers).not.toMatch(/SUGARLAND_UTILITY_NOTE|sugarLandGroupNote/);
  });
});
