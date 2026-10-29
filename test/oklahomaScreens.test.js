/* NEW-1 (Oklahoma screening, owner 2026-10-29) — the Oklahoma layer set, asserted against the REAL registry.
 *
 * What this pins, by name (the adversarial review's list): a row offered outside Oklahoma · a legend that does not match the map · a relay host missing from the
 * relay's allow-list · an endpoint that is not the registry's · a fixture point that is not in Oklahoma at all (the first critical-habitat probes landed in Kansas and in Texas) ·
 * a click card that prints a raw column, an empty row or a bare URL · a regulatory number with no citation · a row missing its registry/tier/vector entry. */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS, MERGE_GROUPS } from "../src/workspaces/site-planner/lib/layers.js";
import { SPECIAL_WS, OK_LAYERS, OK_MERGE_GROUPS, OK_VECTOR_SOURCES, OK_LAYER_TIERS, WELL_CLASSES, wellClassOf, DAM_CLASSES, damHazardOf, ROAD_CLASSES, IMPAIRED, urlFor, viaRelay, registryUrl, clean, tc } from "../src/workspaces/site-planner/lib/oklahomaLayers.js";
import { VECTOR_SOURCES } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { LAYER_TIER } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { layerAvailableHere } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { cleanCard } from "../src/workspaces/site-planner/lib/identifyCard.js";
import { GIS_SOURCES, auditRegistry, looksNonProduction, fixtureReachProblems } from "../src/shared/gis/sources.js";
import { OK_SOURCES } from "../src/shared/gis/sourcesOk.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { OK_FIXTURES } from "../src/shared/gis/sourceFixturesOk.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const ids = Object.keys(OK_LAYERS);
const scope = (lat, lng) => ({ state: siteState({ lat, lng }), loc: { lat, lng } });
const OK_SITE = scope(36.9, -95.85); // the owner's six real sites: Washington / Nowata County
const ELSEWHERE = { houston: scope(29.7604, -95.3698), atlanta: scope(33.749, -84.388), denver: scope(39.7392, -104.9903), kansas: scope(37.69, -97.34), arkansas: scope(36.07, -94.16), nashville: scope(36.16, -86.78) };

describe("the Oklahoma rows are offered in Oklahoma and nowhere else", () => {
  it("the points are what this test says they are", () => {
    expect(OK_SITE.state).toBe("OK");
    expect(scope(36.154, -95.993).state).toBe("OK"); // Tulsa
    for (const [k, s] of Object.entries(ELSEWHERE)) expect(s.state, k).not.toBe("OK");
  });
  it("every row declares exactly states:[OK] and is available at the owner's real site", () => {
    expect(ids.length).toBe(32);
    for (const id of ids) {
      expect(ALL_LAYERS[id], id).toBeTruthy();
      expect(ALL_LAYERS[id].states, id).toEqual(["OK"]);
      expect(layerAvailableHere(ALL_LAYERS[id], OK_SITE), id).toBe(true);
    }
  });
  it("no row is offered at Houston, Atlanta, Denver, Wichita, Fayetteville or Nashville", () => {
    for (const [k, s] of Object.entries(ELSEWHERE)) for (const id of ids) expect(layerAvailableHere(ALL_LAYERS[id], s), `${id} @ ${k}`).toBe(false);
  });
  it("the set of rows scoped to Oklahoma is exactly this module's (a stray `states:[OK]` elsewhere fails)", () => {
    const scoped = Object.entries(ALL_LAYERS).filter(([, c]) => (c.states || []).includes("OK")).map(([k]) => k).sort();
    expect(scoped).toEqual([...ids].sort());
  });
  it("no Oklahoma row bleeds Texas wording", () => {
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      expect(JSON.stringify({ label: c.label, note: c.note, source: c.source, caveat: c.infoCaveat }), id).not.toMatch(/Railroad Commission|TCEQ|TxDOT|\bRRC\b|HCFCD/);
    }
  });
});

describe("every row is complete and drawn from the registry", () => {
  it("label, source, note, role, group, order, a url — and a click card", () => {
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      expect(c.label && c.label.length > 3, `${id} label`).toBeTruthy();
      expect(c.source, `${id} source`).toBeTruthy();
      expect(c.note, `${id} note`).toBeTruthy();
      expect(["area", "line", "point"], `${id} role`).toContain(c.role);
      expect(typeof c.order, `${id} order`).toBe("number");
      expect(c.group, `${id} group`).toBeTruthy();
      expect(c.url, `${id} url`).toMatch(/^(https:\/\/|\/gis-proxy\/)/);
      if (c.kind === "esriFeature") expect(typeof c.identifyCard, `${id} card`).toBe("function");
    }
  });
  it("a legend, where a row has a class table, is the SAME list the map reads (label + colour)", () => {
    for (const w of WELL_CLASSES) expect(ALL_LAYERS.ok_wells.legend).toContainEqual({ label: w.label, color: w.color });
    for (const d of DAM_CLASSES) expect(ALL_LAYERS.ok_dams.legend).toContainEqual({ label: d.label, color: d.color });
    for (const r of ROAD_CLASSES) expect(ALL_LAYERS.ok_road.legend).toContainEqual({ label: r.label, color: r.color, ...(r.dash ? { dash: true } : {}) });
    for (const i of IMPAIRED) expect(ALL_LAYERS.ok_deq_303d.legend).toContainEqual({ label: i.label, color: i.color });
  });
  it("the map ink for each class is the legend's colour (a swatch that lies is a defect)", () => {
    const sw = (cfg, props) => cfg.styleFn(props, 1);
    for (const w of WELL_CLASSES) for (const k of w.classes) expect(sw(ALL_LAYERS.ok_wells, { symbol_class: k }).fillColor, k).toBe(w.color);
    expect(sw(ALL_LAYERS.ok_wells, { symbol_class: "SOMETHING_NEW" }).fillColor).toBe(WELL_CLASSES.find((w) => w.key === "other").color);
    for (const [raw, key] of [["H", "High"], ["High", "High"], ["S", "Significant"], ["L", "Low"], ["Low", "Low"], ["D", "Other"], ["Decommissioned/Drained", "Other"], ["U", "Other"], ["Non-Jurisdictional", "Other"], [null, "Other"], ["", "Other"]]) {
      expect(damHazardOf(raw), String(raw)).toBe(key);
      expect(sw(ALL_LAYERS.ok_dams, { hazard: raw }).fillColor).toBe(DAM_CLASSES.find((d) => d.key === key).color);
    }
    for (const r of ROAD_CLASSES) expect(sw(ALL_LAYERS.ok_road, { ODOTROUTECLASS: r.key }).color).toBe(r.color);
    for (const i of IMPAIRED) expect(sw(ALL_LAYERS.ok_deq_303d, { Category: i.key.toUpperCase() }).color).toBe(i.color);
  });
  it("a merged row's lead member carries a legend that names every member's colour", () => {
    const members = (g) => ids.filter((id) => ALL_LAYERS[id].mergeGroup === g);
    for (const g of Object.keys(OK_MERGE_GROUPS)) {
      const ms = members(g);
      expect(ms.length, g).toBeGreaterThanOrEqual(2);
      expect(MERGE_GROUPS[g], g).toBeTruthy();
      const lead = ms.find((id) => Array.isArray(ALL_LAYERS[id].legend));
      expect(lead, `${g} has a legend`).toBeTruthy();
      const colors = new Set(ALL_LAYERS[lead].legend.map((e) => e.color));
      for (const id of ms) expect(colors.has(ALL_LAYERS[id].color), `${id} base colour is in ${g}'s legend`).toBe(true);
    }
    // the cleanup row: each of the seven members' own colour is in the lead's key
    const cleanup = ids.filter((id) => ALL_LAYERS[id].mergeGroup === "ok_cleanup");
    expect(cleanup.length).toBe(8);
    const keyColors = new Set(ALL_LAYERS.ok_deq_superfund.legend.map((e) => e.color));
    for (const id of cleanup) expect(keyColors.has(ALL_LAYERS[id].color), id).toBe(true);
    const waste = new Set(ALL_LAYERS.ok_deq_solid_waste.legend.map((e) => e.color));
    for (const id of ids.filter((i) => ALL_LAYERS[i].mergeGroup === "ok_waste")) expect(waste.has(ALL_LAYERS[id].color), id).toBe(true);
    const water = new Set(ALL_LAYERS.ok_deq_whpa.legend.map((e) => e.color));
    for (const id of ["ok_deq_well_buffers", "ok_deq_intakes"]) expect(water.has(ALL_LAYERS[id].color), id).toBe(true);
  });
  it("every row has a declared volume tier, within its ceiling", () => {
    for (const id of ids) { expect(LAYER_TIER[id], id).toBe(OK_LAYER_TIERS[id]); expect(["constraint", "reference", "context"]).toContain(OK_LAYER_TIERS[id]); }
    expect(Object.keys(OK_LAYER_TIERS).sort()).toEqual([...ids].sort());
  });
  it("the two vector rows are registered and query the registry's service", () => {
    for (const [id, key] of [["ok_county", "okCounty"], ["ok_city", "okCity"]]) {
      expect(ALL_LAYERS[id].kind).toBe("vector");
      expect(VECTOR_SOURCES[id]).toBe(OK_VECTOR_SOURCES[id]);
      expect(VECTOR_SOURCES[id].query.url).toBe(GIS_SOURCES[key].serviceUrl + "/query");
      expect(VECTOR_SOURCES[id].labelField).toBe(GIS_SOURCES[key].fields.name);
      expect(VECTOR_SOURCES[id].query.tiers.length).toBeGreaterThan(0);
    }
    expect(OK_VECTOR_SOURCES.ok_county.nameTemplate).toMatch(/County/);
  });
});

describe("endpoints: the registry decides, and the relay is allow-listed", () => {
  const relayed = ids.filter((id) => ALL_LAYERS[id].url.startsWith("/gis-proxy/"));
  it("a row on an agency server the sandbox cannot reach reads through the relay, and the host is in the relay's allow-list", () => {
    expect(relayed.length).toBeGreaterThanOrEqual(15);
    for (const id of relayed) {
      const host = ALL_LAYERS[id].url.split("/")[2];
      expect(ALLOWED_HOSTS.has(host), `${id}: ${host}`).toBe(true);
      expect(["gis.occ.ok.gov", "gis.deq.ok.gov", "owrb.csa.ou.edu"], id).toContain(host);
    }
    expect(viaRelay("https://gis.deq.ok.gov/server/rest/services/LandWeb/MapServer/1")).toBe("/gis-proxy/gis.deq.ok.gov/server/rest/services/LandWeb/MapServer/1");
  });
  it("a row on a CORS-open host (AGOL, USGS) is read directly, never via the relay", () => {
    for (const id of ids.filter((i) => !relayed.includes(i) && ALL_LAYERS[i].kind === "esriFeature")) expect(ALL_LAYERS[id].url, id).toMatch(/^https:\/\/(services\d*\.arcgis\.com|carto\.nationalmap\.gov)\//);
  });
  it("the row URL is the registry URL (+ the sub-layer id) — never a second, hand-typed endpoint", () => {
    const pairs = { ok_wells: "okWells", ok_pst: "okPst", ok_deq_superfund: "okSuperfund", ok_deq_rcra: "okRcra", ok_deq_restrictions: "okInstControl", ok_deq_vcp: "okVcp", ok_deq_scap: "okScap", ok_deq_brownfields: "okBrownfieldDeq", ok_occ_brownfields: "okBrownfieldOcc", ok_deq_solid_waste: "okSolidWaste", ok_deq_haz_waste: "okHazWaste", ok_deq_whpa: "okWhpa", ok_deq_well_buffers: "okWellBuffer", ok_deq_intakes: "okPwsIntake", ok_deq_appb_areas: "okAppendixBArea", ok_deq_appb_streams: "okAppendixBLine", ok_deq_sensitive: "okSensitiveWaters", ok_deq_303d: "ok303d", ok_pst_releases: "okPstReleases", ok_owrb_scenic: "okScenicRivers", ok_owrb_special_ws: "okSpecialWatersheds", ok_dams: "okDams", ok_water_systems: "okWaterSystems", ok_nrhp: "okNrhp", ok_cemeteries: "okCemeteries", ok_crit_habitat: "okCritHabitat", ok_road: "okRoad", ok_tribal: "okTribal", ok_cherokee_res: "okCherokeeRes", ok_cherokee_land: "okCherokeeLand" };
    for (const [id, key] of Object.entries(pairs)) expect(ALL_LAYERS[id].url.replace(/^(\/gis-proxy\/[^/]+|https:\/\/[^/]+)/, ""), id).toBe(registryUrl(key).replace(/^https:\/\/[^/]+/, ""));
    expect(Object.keys(pairs).length + 2).toBe(ids.length); // + the two vector rows
    expect(urlFor("okWells")).toMatch(/^\/gis-proxy\/gis\.occ\.ok\.gov\//);
  });
  it("the narrowing `where` of the road and tribal rows is the registry's (the unfiltered layers hold every road / every state)", () => {
    expect(ALL_LAYERS.ok_road.where).toBe(GIS_SOURCES.okRoad.where);
    expect(ALL_LAYERS.ok_road.where).toMatch(/ODOTROUTECLASS IN \('I','U','S','T'\)/);
    expect(ALL_LAYERS.ok_tribal.where).toBe(GIS_SOURCES.okTribal.where);
    expect(ALL_LAYERS.ok_tribal.where).toMatch(/OTSA/);
  });
  it("a dense layer asks for the attributes its card prints, not the whole record (the roads layer carries ninety)", () => {
    expect(ALL_LAYERS.ok_road.fields.length).toBeLessThan(12);
    expect(ALL_LAYERS.ok_wells.fields).toContain("symbol_class");
    expect(ALL_LAYERS.ok_wells.minZoom).toBeGreaterThanOrEqual(13); // 457,000 wells — never at metro scale
    expect(ALL_LAYERS.ok_road.minZoom).toBeGreaterThanOrEqual(12); // 2,000 pieces in a 0.4° view (measured)
  });
});

describe("the Oklahoma registry rows", () => {
  const keys = Object.keys(OK_SOURCES);
  it("32 rows, each Oklahoma-scoped, production-tier, https, not on a test/staging path, with a provider and a verified date", () => {
    expect(keys.length).toBe(32);
    for (const k of keys) {
      const s = GIS_SOURCES[k];
      expect(s, k).toBe(OK_SOURCES[k]);
      expect(s.states, k).toEqual(["OK"]);
      expect(s.tier, k).toBe("production");
      expect(s.serviceUrl, k).toMatch(/^https:\/\//);
      expect(looksNonProduction(s.serviceUrl), k).toBe(false);
      expect(s.provider, k).toBeTruthy();
      expect(s.lastVerified, k).toBe("2026-10-29");
    }
  });
  it("auditRegistry (fixtures present, reach classes met, state scope declared) finds nothing wrong with them", () => {
    const { problems } = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
    expect(problems.filter((p) => /^ok[A-Z0-9]/.test(p))).toEqual([]);
    for (const k of keys) expect(fixtureReachProblems(GIS_SOURCES[k], SOURCE_FIXTURES[k]), k).toEqual([]);
  });
  it("every fixture sits INSIDE Oklahoma (siteState) — a probe in Kansas proves nothing about Oklahoma", () => {
    for (const k of keys) {
      const fx = OK_FIXTURES[k].fixtures;
      expect(fx.length, k).toBeGreaterThanOrEqual(2);
      for (const f of fx) { const [lng, lat] = f.point; expect(siteState({ lat, lng }), `${k}: ${f.label}`).toBe("OK"); expect(f.expectMinCount, k).toBeGreaterThanOrEqual(1); }
    }
  });
  it("every relayed row's registry host is in the relay allow-list", () => {
    for (const k of keys) { const host = new URL(GIS_SOURCES[k].serviceUrl).host; if (/\.ok\.gov$|^owrb\.csa\.ou\.edu$/.test(host)) expect(ALLOWED_HOSTS.has(host), `${k}: ${host}`).toBe(true); }
  });
});

describe("regulatory numbers are cited, and the rule's source is the agency's own words", () => {
  it("the 300-ft public-well buffer cites DEQ rule OAC 252:626-7-4 in the row's note/card, the registry and the docs", () => {
    const c = ALL_LAYERS.ok_deq_well_buffers;
    expect(c.source).toMatch(/OAC 252:626-7-4/);
    expect(c.identifyCard({ SYSTEM: "x", SOURCE_NAM: "WELL 1", POP_SERVED: 25, COUNTY: "TULSA" }).note).toMatch(/OAC 252:626-7-4/);
    expect(GIS_SOURCES.okWellBuffer.provider).toMatch(/OAC 252:626-7-4/);
    expect(SOURCE_DOCS.okWellBuffer.notes).toMatch(/OAC 252:626-7-4/);
    expect(c.note).toMatch(/300-ft/);
  });
  it("Appendix B and the OKR10 layer cite the Water Quality Standards / the permit (no chapter number from memory); no invented distance anywhere", () => {
    expect(ALL_LAYERS.ok_deq_appb_areas.source).toMatch(/Water Quality Standards/);
    expect(ALL_LAYERS.ok_deq_appb_areas.source).not.toMatch(/OAC \d/);
    expect(ALL_LAYERS.ok_deq_sensitive.source).toMatch(/OKR10/);
    // A "ft" / "feet" / "mile" figure may appear only on the cited 300-ft buffer row.
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      const text = [c.note, c.infoCaveat, c.label].join(" ");
      if (id === "ok_deq_well_buffers") continue;
      expect(text, id).not.toMatch(/\b\d+[- ]?(ft|feet|foot|mile|miles)\b/i);
    }
  });
  it("tribal wording never asserts a legal conclusion: statistical areas are said to be statistical", () => {
    const t = ALL_LAYERS.ok_tribal;
    expect(t.note).toMatch(/statistical/i);
    expect(t.note).toMatch(/NOT legal boundaries/i);
    expect(t.infoCaveat).toMatch(/legal question/i);
    expect(t.identifyCard({ NAME: "Cherokee OTSA" }).note).toMatch(/not legal boundaries/i);
    expect(ALL_LAYERS.ok_tribal.legend.find((e) => /statistical/i.test(e.label))).toBeTruthy();
  });
});

describe("click cards are clean (constraint #45) — plain labels, no empty rows, no raw URLs", () => {
  const samples = {
    ok_wells: { symbol_class: "ORPHAN", well_name: "SMITH", well_num: "1-A", operator: "HILL RESOURCES INC", welltype: "OIL", county: "WASHINGTON" },
    ok_pst: { facility_name: "QUIK STOP", facility_type: "Gas Station", facility_status: "Active", address1: "1 MAIN", city: "TULSA", active_ust_tank_count: 3, active_ast_tank_count: 0, indian_trust_lands: "NO" },
    ok_road: { ODOTROUTECLASS: "U", STREETNAME: "US-75", AADT: 28100, MAINTENANCERESPONSIBILITY: "S", TRUCKROUTE: 1 },
    ok_dams: { dam_name: "Crain Farm Dam #3", hazard: "H", owner_name: null, owner_type: "F", county: "Caddo", river: null, year_completed: null, dam_height: 31.3 },
    ok_deq_restrictions: { FacilityNa: "44th Street Armory", Program: "SCAP", DateFiled: 1348790400000, Land_Use_Restrictions: "No residential use of the property by children age 6 or under.", County: "Oklahoma", Link_to_Do: "https://applications.deq.ok.gov/webdata/x.pdf " },
    ok_deq_superfund: { NPL_SITE: "Compass Industries Landfill", EPA_ID: "OKD980620983", Link: "https://arcg.is/1WbfCf1" },
    ok_deq_solid_waste: { Facility_Name: "TULSA LANDFILL", Facility_Type: "MSW", City: "TULSA", Cty: "TULSA" },
    ok_tribal: { NAME: "Cherokee OTSA" }, ok_cherokee_land: { COUNTY: "Washington", Tract_ID: "W-12", Acres: 40.25 }, ok_cherokee_res: { Acres: 4400000 },
    ok_deq_303d: { Name: "Bird Creek", Category: "5a" }, ok_deq_whpa: { ZONE: "B" },
    ok_deq_appb_areas: { NAME: "Hochatown State Park", TYPE: "State Park", AB_TABLE: 1 }, ok_water_systems: { name: "Washington Co RWD #3", pwsid: "OK3007203", county: "Washington" },
  };
  it("no card prints a column name, a null, a bare URL or an empty row", () => {
    for (const [id, props] of Object.entries(samples)) {
      const raw = ALL_LAYERS[id].identifyCard(props);
      const c = cleanCard({ ...raw, sourceName: ALL_LAYERS[id].source });
      expect(c, id).toBeTruthy();
      expect(c.title, id).toBeTruthy();
      for (const r of c.rows) {
        expect(r.label, `${id} label`).not.toMatch(/[_.]|^(OBJECTID|FID|GlobalID)$/);
        expect(String(r.text), `${id} ${r.label}`).not.toMatch(/^(null|undefined|n\/a|none|0)$/i);
        expect(String(r.text), `${id} ${r.label}`).not.toMatch(/^https?:\/\//);
      }
    }
  });
  it("the orphan-well card says what it is, in words", () => {
    const rows = ALL_LAYERS.ok_wells.identifyCard(samples.ok_wells).rows;
    expect(rows.find((r) => r.label === "Status").text).toMatch(/orphan/i);
    expect(rows.find((r) => r.label === "Operator").text).toBe("Hill Resources INC");
    expect(rows.find((r) => r.label === "Well").text).toBe("Smith 1-A");
  });
  it("a dam card decodes the one-letter hazard and owner codes; an unnamed owner is simply absent", () => {
    const rows = ALL_LAYERS.ok_dams.identifyCard(samples.ok_dams).rows;
    expect(rows.find((r) => r.label === "Hazard class").text).toMatch(/^High/);
    expect(rows.find((r) => r.label === "Owner type").text).toBe("Federal");
    expect(rows.find((r) => r.label === "Owner")).toBeUndefined();
  });
  it("a road card decodes the maintainer and prints traffic as words", () => {
    const rows = ALL_LAYERS.ok_road.identifyCard(samples.ok_road).rows;
    expect(rows.find((r) => r.label === "Maintained by").text).toBe("State (ODOT)");
    expect(rows.find((r) => r.label === "Traffic").text).toBe("28,100 vehicles a day");
  });
  it("the restriction card keeps the restriction text, formats the date and links the filed notice", () => {
    const c = cleanCard({ ...ALL_LAYERS.ok_deq_restrictions.identifyCard(samples.ok_deq_restrictions), sourceName: "x" });
    expect(c.rows.find((r) => r.label === "Restriction").text).toMatch(/No residential use/);
    expect(c.rows.find((r) => r.label === "Filed").text).toBe("Sep 28, 2012");
    expect(c.rows.find((r) => r.label === "Filed notice").href).toBe("https://applications.deq.ok.gov/webdata/x.pdf");
  });
  it("helpers: shouted names are title-cased, sentinels dropped", () => {
    expect(tc("HILL RESOURCES INC")).toBe("Hill Resources INC");
    expect(clean(" null ")).toBe(""); expect(clean("<Null>")).toBe(""); expect(clean("Tulsa")).toBe("Tulsa");
    expect(wellClassOf("OIL/GAS").key).toBe("active");
  });
});

describe("the Counties & Cities row learns Oklahoma", () => {
  it("both rows are members of the one merged row, drawn like every other state's", async () => {
    const { boundaryKey } = await import("../src/workspaces/site-planner/lib/layerPanelModel.js");
    const key = boundaryKey([["ok_county", ALL_LAYERS.ok_county], ["ok_city", ALL_LAYERS.ok_city]]);
    expect(key.map((k) => k.label)).toEqual(["County", "City Limits"]);
    const { isCountyLinesId, isCityLimitsId } = await import("../src/workspaces/site-planner/lib/vectorLayers.js");
    expect(isCountyLinesId("ok_county")).toBe(true);
    expect(isCityLimitsId("ok_city")).toBe(true);
    expect(ALL_LAYERS.ok_city.note).toMatch(/ETJ is not mapped/);
  });
});

describe("adversarial-review findings, pinned (each was a confirmed defect)", () => {
  it("OWRB's Scenic Rivers and special-provision watersheds ARE offered, in Protected Waters, and the 'not built' header no longer says otherwise", async () => {
    expect(ALL_LAYERS.ok_owrb_scenic.mergeGroup).toBe("ok_protected_waters");
    expect(ALL_LAYERS.ok_owrb_special_ws.mergeGroup).toBe("ok_protected_waters");
    const fs = await import("node:fs");
    const hdr = fs.readFileSync(new URL("../src/shared/gis/sourcesOk.js", import.meta.url), "utf8").split("export const OK_SOURCES")[0];
    expect(hdr).not.toMatch(/OWRB publishes no polygon service for them/);
  });
  it("the special-watershed ink matches its legend, type by type", () => {
    for (const w of SPECIAL_WS) {
      expect(ALL_LAYERS.ok_deq_appb_areas.legend).toContainEqual({ label: w.label, color: w.color });
      expect(ALL_LAYERS.ok_owrb_special_ws.styleFn({ type: w.key }, 1).color, w.key).toBe(w.color);
    }
  });
  it("the tribal key lists the Shawnee trust land the map draws, and the dashed OTSA swatch is dashed", () => {
    const k = ALL_LAYERS.ok_tribal.legend;
    expect(k.find((e) => /Trust land/i.test(e.label))).toBeTruthy();
    expect(k.find((e) => /statistical/i.test(e.label)).dash).toBe(true);
    expect(ALL_LAYERS.ok_tribal.styleFn({ NAME: "Shawnee Trust Land" }, 1).color).toBe(k.find((e) => /Trust land/i.test(e.label)).color);
  });
  it("a well card never prints a raw well-type code, and a well with no class carries no Status row", () => {
    const rows = ALL_LAYERS.ok_wells.identifyCard({ well_name: "X", symbol_class: "", welltype: "NT", operator: "A B" }).rows;
    expect(rows.find((r) => r.label === "Type")).toBeUndefined();
    expect(rows.find((r) => r.label === "Status")).toBeUndefined();
    expect(ALL_LAYERS.ok_wells.fields).not.toContain("welltype");
  });
  it("dam copy: the High definition is OWRB's, the inundation maps are acknowledged, and the card shows one when the inventory says it exists", () => {
    const t = [ALL_LAYERS.ok_dams.note, ALL_LAYERS.ok_dams.infoCaveat].join(" ");
    expect(t).not.toMatch(/No dam-break inundation map is published/);
    expect(t).toMatch(/107 dams/);
    expect(t).toMatch(/OWRB describes/);
    expect(ALL_LAYERS.ok_dams.legend[0].label).toBe("High hazard");
    const y = ALL_LAYERS.ok_dams.identifyCard({ dam_name: "A", hazard: "H", inundation_map_created: "Y" }).rows;
    expect(y.find((r) => r.label === "Inundation map")).toBeTruthy();
    expect(ALL_LAYERS.ok_dams.identifyCard({ dam_name: "A", hazard: "H", inundation_map_created: "false" }).rows.find((r) => r.label === "Inundation map")).toBeUndefined();
    expect(ALL_LAYERS.ok_dams.fields).toContain("inundation_map_created");
  });
  it("no row asserts an uncited legal conclusion: no 'no ETJ', no 'county is the zoning authority', no invented 5b meaning", () => {
    for (const id of ids) {
      const c = ALL_LAYERS[id];
      const text = [c.note, c.infoCaveat, c.identifyNote].join(" ");
      expect(text, id).not.toMatch(/has no ETJ|zoning and permitting authority|review pending/i);
      expect(text, id).not.toMatch(/McGirt|Osage Wind|\bBIA\b|sign-off/i); // legal conclusions about reservations / mineral estates are never typed from memory
    }
    expect(OK_SOURCES.okCity.fullPurposeOnly).toBe(true);
  });
  it("a well with a status code the table does not know prints that code, not 'Dry, terminated, water supply, other'", () => {
    const c = ALL_LAYERS.ok_wells.identifyCard({ symbol_class: "INACTIVE", well_name: "X", well_num: "1" });
    expect(c.rows.find((x) => x.label === "Status").text).toBe("Inactive");
    expect(ALL_LAYERS.ok_wells.identifyCard({ symbol_class: "PLUGGED" }).rows.find((x) => x.label === "Status").text).toBe("Plugged");
  });
  it("a tank release whose status is neither Open nor Closed has its own ink, in the legend", () => {
    const r = ALL_LAYERS.ok_pst_releases;
    const other = r.styleFn({ case_status: "Municipal" }, 1).fillColor;
    expect([ "#4338ca", "#a5b4fc" ]).not.toContain(other);
    expect(ALL_LAYERS.ok_deq_superfund.legend.map((e) => e.color)).toContain(other);
  });
  it("the county line labels name Oklahoma and keep the Mc prefix", async () => {
    const { countyLabelText } = await import("../src/workspaces/site-planner/lib/countyLineLabels.js");
    expect(OK_VECTOR_SOURCES.ok_county.stateAbbr).toBe("OK");
    expect(countyLabelText("MCCURTAIN", "OK", "TX")).toBe("McCurtain Co., OK");
    expect(countyLabelText("MCCLAIN", "OK", "OK")).toBe("McClain Co.");
    expect(tc("MCINTOSH")).toBe("McIntosh");
  });
  it("the quoted tribal counts say 25 areas plus four joint-use areas", () => {
    expect(ALL_LAYERS.ok_tribal.note).toMatch(/25 Oklahoma Tribal Statistical Areas plus four joint-use areas/);
  });
  it("city labels keep the Mc prefix capital (McAlester, McKinney)", async () => {
    const { titleCaseName } = await import("../src/workspaces/site-planner/lib/boundaryLabels.js");
    expect(titleCaseName("MCALESTER")).toBe("McAlester");
    expect(titleCaseName("MCKINNEY")).toBe("McKinney");
    expect(titleCaseName("SAND SPRINGS")).toBe("Sand Springs");
    expect(titleCaseName("MACKVILLE")).toBe("Mackville");
  });
  it("the NRHP card capitalises the type", () => {
    expect(ALL_LAYERS.ok_nrhp.identifyCard({ RESNAME: "X", ResType: "building" }).rows.find((r) => r.label === "Type").text).toBe("Building");
  });
  it("critical habitat asks the server to generalise (a Canadian River view is 225,000 unsimplified vertices — over the 120,000 draw budget)", () => {
    expect(ALL_LAYERS.ok_crit_habitat.simplifyFactor).toBeGreaterThan(0);
    for (const id of ["ok_tribal", "ok_deq_sensitive", "ok_owrb_special_ws", "ok_deq_appb_areas", "ok_deq_303d"]) expect(ALL_LAYERS[id].simplifyFactor, id).toBeGreaterThan(0);
  });
  it("the solid-waste card decodes both spellings of construction & demolition, and the state-highway note does not over-claim who permits access", () => {
    for (const code of ["C/D", "C&D"]) expect(ALL_LAYERS.ok_deq_solid_waste.identifyCard({ Facility_Name: "X", Facility_Type: code }).rows.find((r) => r.label === "Kind").text).toBe("Construction & demolition landfill");
    expect(ALL_LAYERS.ok_road.note).toMatch(/usually permits/);
    expect(ALL_LAYERS.ok_road.note).not.toMatch(/On one of these ODOT/);
  });
  it("third-review fixes: turnpike is keyed off the maintainer, a route code is no street name, WHPA is generalised, every row has a vintage, the apostrophe case is right", async () => {
    const { roadClassKeyOf, OK_VINTAGE, tc: tc2 } = await import("../src/workspaces/site-planner/lib/oklahomaLayers.js");
    expect(roadClassKeyOf({ ODOTROUTECLASS: "I", MAINTENANCERESPONSIBILITY: "T" })).toBe("T");
    expect(roadClassKeyOf({ ODOTROUTECLASS: "S", MAINTENANCERESPONSIBILITY: "S" })).toBe("S");
    expect(ALL_LAYERS.ok_road.styleFn({ ODOTROUTECLASS: "I", MAINTENANCERESPONSIBILITY: "T" }, 1).color).toBe(ROAD_CLASSES.find((r) => r.key === "T").color);
    expect(ALL_LAYERS.ok_road.identifyCard({ ODOTROUTECLASS: "I", MAINTENANCERESPONSIBILITY: "T", STREETNAME: "U059" }).rows.find((r) => r.label === "Road")).toBeUndefined();
    expect(ALL_LAYERS.ok_deq_whpa.simplifyFactor).toBeGreaterThan(0);
    expect(ALL_LAYERS.ok_crit_habitat.vertexBudget).toBeGreaterThanOrEqual(135479);
    for (const id of ids) expect(ALL_LAYERS[id].vintage || (await import("../src/workspaces/site-planner/lib/layers.js")).LAYER_VINTAGE[id], id).toBeTruthy();
    expect(Object.keys(OK_VINTAGE).sort()).toEqual([...ids].filter((i) => !["ok_county_x"].includes(i)).sort());
    expect(tc2("DON'S SERVICE")).toBe("Don's Service");
    expect(tc2("O'BRIEN")).toBe("O'Brien");
  });
  it("Petroleum Tank Releases: open cases are the legend's open ink, closed the pale one, dates are words, and the tank row's note points at it", () => {
    const r = ALL_LAYERS.ok_pst_releases;
    expect(r.styleFn({ case_status: "Open" }, 1).fillColor).toBe("#4338ca");
    expect(r.styleFn({ case_status: "Closed" }, 1).fillColor).toBe("#a5b4fc");
    expect(ALL_LAYERS.ok_deq_superfund.legend.map((e) => e.color)).toEqual(expect.arrayContaining(["#4338ca", "#a5b4fc"]));
    const c = r.identifyCard({ facility_name: "7-Eleven #1", case_status: "Open", case_type: "Confirmed Release", release_date: 1791867600000, close_date: null, release_cause_type: "Unknown", tank_type: "UST", case_number: "064-5244" });
    expect(c.rows.find((x) => x.label === "Released").text).toBe("Oct 13, 2026");
    expect(c.rows.find((x) => x.label === "Closed")).toBeUndefined();
    expect(ALL_LAYERS.ok_pst.note).toMatch(/Petroleum Tank Releases/);
  });
});
