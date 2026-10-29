/* B2528688 — the Colorado due-diligence layers (coloradoLayers.js). What this pins, and why each is a real failure someone would have shipped:
 *   · every row is offered ONLY in Colorado, and a county / city row only inside its own county / city (a Weld row on a Larimer site, or any Colorado row on a Texas/Georgia/Tennessee site, is the
 *     "row offered outside its state" bug);
 *   · every relayed row reads a host the /gis-proxy allow-list names (a row on an un-listed host draws nothing, and says "couldn't load");
 *   · the legend and the map are built from ONE table (a legend that does not match the map);
 *   · the regulatory words are cited and say what the rule covers (ECMC Rule 604 governs NEW pads, not building near an existing well);
 *   · the cards never print an empty row, a raw field name, a bare URL or an epoch number;
 *   · the PDF prints a point row in the colours the screen shows (PDF-PARITY). */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import * as CL from "../src/workspaces/site-planner/lib/coloradoLayers.js";
import { ALL_LAYERS, LAYER_VINTAGE } from "../src/workspaces/site-planner/lib/layers.js";
import { layerAvailableHere } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { _setServiceAreas } from "../src/workspaces/site-planner/lib/serviceAreas.js";
import { SERVICE_AREAS } from "../src/workspaces/site-planner/lib/serviceAreaData.js";
import { LAYER_TIER, tierOf } from "../src/workspaces/site-planner/lib/layerWeight.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { hoverText } from "../src/workspaces/site-planner/lib/featureHover.js";
import { esriPrintFeatures } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";
import { PILL_DEFS, OFF_REGION_PILLS, pillsFor } from "../src/workspaces/site-planner/lib/siteLayerPills.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const { COLORADO_LAYERS } = CL;
const IDS = Object.keys(COLORADO_LAYERS);
const GROUPS = ["jurisdiction", "flood", "utilities", "environmental", "access", "topography"];
const AT = {
  commerceCity: { lat: 39.8083, lng: -104.9339 }, greeley: { lat: 40.4233, lng: -104.7091 }, windsor: { lat: 40.4775, lng: -104.9014 },
  fortCollins: { lat: 40.5853, lng: -105.0844 }, aurora: { lat: 39.7294, lng: -104.7319 }, denver: { lat: 39.7392, lng: -104.9903 }, durango: { lat: 37.2753, lng: -107.88 },
  houston: { lat: 29.76, lng: -95.37 }, atlanta: { lat: 33.75, lng: -84.39 }, nashville: { lat: 36.16, lng: -86.78 }, dallas: { lat: 32.78, lng: -96.8 },
};
const availableIds = (loc) => IDS.filter((id) => layerAvailableHere(ALL_LAYERS[id], { loc }));
beforeAll(() => { _setServiceAreas(SERVICE_AREAS); });

describe("the Colorado rows are complete and in the registry", () => {
  it("there are 27 rows and every one reached ALL_LAYERS (a row that never got spread draws nowhere)", () => {
    expect(IDS.length).toBe(27);
    for (const id of IDS) expect(ALL_LAYERS[id], id).toBe(COLORADO_LAYERS[id]);
  });
  it("each carries a label, a source, a note, a role, a panel group, an order, a vintage and a declared tier (an inline // comment once swallowed a row's label)", () => {
    for (const id of IDS) {
      const c = COLORADO_LAYERS[id];
      expect(typeof c.label, `${id} label`).toBe("string");
      expect(c.label.length, `${id} label`).toBeGreaterThan(5);
      expect(c.label, `${id} label is Title Case`).toMatch(/^[A-Z0-9]/);
      expect(c.label.length, `${id} label is short`).toBeLessThan(34);
      expect(c.source, `${id} source`).toBeTruthy();
      expect(c.note, `${id} note`).toBeTruthy();
      expect(["area", "line", "point"], `${id} role`).toContain(c.role);
      expect(GROUPS, `${id} group`).toContain(c.group);
      expect(typeof c.order, `${id} order`).toBe("number");
      expect(c.kind, id).toBe("esriFeature");
      expect(LAYER_VINTAGE[id], `${id} vintage`).toBeTruthy();
      expect(["constraint", "reference", "context"], `${id} tier`).toContain(tierOf(id));
      expect(LAYER_TIER[id], `${id} tier is declared in layerWeight.js`).toBeTruthy();
    }
  });
  it("⛔ a row that limits `fields` lists OBJECTID (esri-leaflet keys painted features by it — without it a layer that answers thousands paints ONE; measured live 2026-10-29)", () => {
    const limited = IDS.filter((id) => Array.isArray(COLORADO_LAYERS[id].fields));
    expect(limited.length).toBeGreaterThan(8);
    for (const id of limited) expect(COLORADO_LAYERS[id].fields, id).toContain("OBJECTID");
  });
  it("labels are unique across the registry's Colorado-visible rows within a group (two rows with one name are one confusing checkbox)", () => {
    const seen = new Map();
    for (const [id, c] of Object.entries(ALL_LAYERS)) {
      if (c.states && !c.states.includes("CO")) continue;
      const k = `${c.group}|${c.label}`;
      if (seen.has(k) && (COLORADO_LAYERS[id] || COLORADO_LAYERS[seen.get(k)])) throw new Error(`${id} and ${seen.get(k)} share the label "${c.label}" in ${c.group}`);
      seen.set(k, id);
    }
  });
});

describe("location scope — a row is offered where its data is, and nowhere else", () => {
  it("every row declares states [CO] and is hidden on a Texas, Georgia, Tennessee or Dallas point", () => {
    for (const id of IDS) expect(COLORADO_LAYERS[id].states, id).toEqual(["CO"]);
    for (const where of ["houston", "atlanta", "nashville", "dallas"]) expect(availableIds(AT[where]), where).toEqual([]);
  });
  it("the state-wide rows are offered on every Colorado point; the county / city rows only inside their own area", () => {
    const county = IDS.filter((id) => COLORADO_LAYERS[id].regions);
    const statewide = IDS.filter((id) => !COLORADO_LAYERS[id].regions);
    expect(statewide.length).toBe(15);
    for (const where of ["commerceCity", "greeley", "fortCollins", "aurora", "denver", "durango"]) for (const id of statewide) expect(availableIds(AT[where]), `${id} at ${where}`).toContain(id);
    const weld = county.filter((id) => COLORADO_LAYERS[id].regions.includes("co_weld"));
    const adams = county.filter((id) => COLORADO_LAYERS[id].regions.includes("co_adams"));
    const aurora = county.filter((id) => COLORADO_LAYERS[id].regions.includes("co_aurora"));
    expect(weld.length).toBe(6); expect(adams.length).toBe(3); expect(aurora.length).toBe(3);
    for (const id of weld) { expect(availableIds(AT.greeley), `${id} greeley`).toContain(id); expect(availableIds(AT.windsor), `${id} windsor`).toContain(id); expect(availableIds(AT.fortCollins), `${id} fort collins (Larimer)`).not.toContain(id); expect(availableIds(AT.denver), `${id} denver`).not.toContain(id); }
    for (const id of adams) { expect(availableIds(AT.commerceCity), `${id} commerce city`).toContain(id); expect(availableIds(AT.greeley), `${id} greeley`).not.toContain(id); expect(availableIds(AT.durango), `${id} durango`).not.toContain(id); }
    for (const id of aurora) { expect(availableIds(AT.aurora), `${id} aurora`).toContain(id); expect(availableIds(AT.fortCollins), `${id} fort collins`).not.toContain(id); expect(availableIds(AT.durango), `${id} durango`).not.toContain(id); }
  });
  it("a point with no location shows everything (fail open — the pre-gate behaviour)", () => {
    for (const id of IDS) expect(layerAvailableHere(ALL_LAYERS[id], {}), id).toBe(true);
  });
});

describe("every row reads the service its registry row names, through a host the relay allows", () => {
  const SRC_FOR = {
    co_ecmc_wells: "ecmcWells", co_ecmc_flowlines: "ecmcFlowlines", co_ecmc_locations: "ecmcLocations", co_ecmc_facilities: "ecmcFacilities", co_superfund: "cdpheSuperfund",
    co_rcra_ca: "cdpheRcraCa", co_inst_controls: "cdpheInstControls", co_closed_landfills: "cdpheClosedLandfills", co_solid_waste: "cdpheSolidWaste", co_undermined: "drmsUndermined",
    co_prairie_dog: "cpwPrairieDog", co_eagle_nests: "cpwEagleNests", co_crit_habitat: "critHabitatCo", co_nrhp: "nrhpCo", co_weld_ogla: "weldOilGasAssessment", co_adams_landfills: "adamsLandfills",
    co_enterprise_zones: "enterpriseZonesCo", co_weld_zoning: "weldZoning", co_weld_ugb: "weldGrowthBoundary", co_weld_iga: "weldIga", co_adams_zoning: "adamsZoning", co_aurora_zoning: "auroraZoning",
    co_weld_airport: "weldAirportOverlay", co_adams_aviation: "adamsAviation", co_aurora_noise: "auroraAirportNoise", co_aurora_apz: "auroraBuckleyApz", co_weld_row: "weldRoadRow",
  };
  it("the mapping covers every row", () => { expect(Object.keys(SRC_FOR).sort()).toEqual([...IDS].sort()); });
  it("each row's url IS its registry serviceUrl (or the same-origin relay form of it) — one source of truth", () => {
    for (const [id, key] of Object.entries(SRC_FOR)) {
      const s = GIS_SOURCES[key];
      expect(s, key).toBeTruthy();
      expect(s.states, key).toEqual(["CO"]);
      expect(s.tier, key).toBe("production");
      expect(s.lastVerified, key).toBe("2026-10-29");
      const u = COLORADO_LAYERS[id].url;
      expect(u === s.serviceUrl || u === CL.relayUrl(s.serviceUrl), `${id}: ${u}`).toBe(true);
    }
  });
  it("a relayed row's host is on the /gis-proxy allow-list; a direct row's host needs no relay", () => {
    for (const id of IDS) {
      const u = COLORADO_LAYERS[id].url;
      const m = u.match(/^\/gis-proxy\/([^/]+)\//);
      if (m) expect(ALLOWED_HOSTS.has(m[1]), `${id}: ${m[1]} is not in ALLOWED_HOSTS`).toBe(true);
      else expect(u, id).toMatch(/^https:\/\/(services\d*\.arcgis\.com|carto\.nationalmap\.gov)\//);
    }
    expect(ALLOWED_HOSTS.has("gisdnr.state.co.us")).toBe(true);
    expect(ALLOWED_HOSTS.has("ags.auroragov.org")).toBe(true);
    // measured and pruned: no ArcGIS service (dnrweb) / origin unreachable (denvergov) — an allow-list entry nothing uses is attack surface
    expect(ALLOWED_HOSTS.has("dnrweb.state.co.us")).toBe(false);
    expect(ALLOWED_HOSTS.has("gis.denvergov.org")).toBe(false);
  });
  it("the ECMC rows are Colorado DNR's own ECMC_Public service — never a county copy (B242545's trap)", () => {
    for (const id of ["co_ecmc_wells", "co_ecmc_flowlines", "co_ecmc_locations", "co_ecmc_facilities"]) {
      expect(COLORADO_LAYERS[id].url, id).toMatch(/^\/gis-proxy\/gisdnr\.state\.co\.us\/arcgis\/rest\/services\/ECMC_Public\//);
      expect(COLORADO_LAYERS[id].url, id).not.toMatch(/arcgis\.com|adams|broomfield|larimer/i);
    }
  });
  it("dense layers are zoom-gated so a pan never asks for a county's worth of wells", () => {
    expect(COLORADO_LAYERS.co_ecmc_wells.minZoom).toBeGreaterThanOrEqual(13);
    expect(COLORADO_LAYERS.co_ecmc_flowlines.minZoom).toBeGreaterThanOrEqual(13);
    expect(COLORADO_LAYERS.co_weld_zoning.simplifyFactor).toBeGreaterThan(0); // the county-wide agricultural base polygon
  });
  it("every row whose polygons are far more detailed than a screen can show asks the SERVER to generalise (measured 2026-10-29: USFWS Colorado River fish habitat = 265,043 vertices / 9.7 MB in ONE view — over the 120,000-vertex draw budget, so it drew NOTHING until it asked)", () => {
    for (const id of ["co_crit_habitat", "co_prairie_dog", "co_weld_zoning", "co_adams_zoning", "co_aurora_zoning"]) expect(COLORADO_LAYERS[id].simplifyFactor, id).toBeGreaterThan(0);
  });
});

describe("ECMC wells — the status table is the map AND the legend", () => {
  it("every status code decodes to words and to one of four classes", () => {
    for (const [code, [label, cls]] of Object.entries(CL.WELL_STATUS)) { expect(CL.wellStatusLabel(code)).toBe(label); expect(CL.wellClassOf(code)).toBe(cls); expect(CL.WELL_CLASSES[cls], code).toBeTruthy(); }
    expect(CL.wellStatusLabel("pr")).toBe("Producing");
    expect(CL.wellStatusLabel("ZZ")).toBe("ZZ"); // an unknown code is shown as ECMC wrote it, never guessed
    expect(CL.wellClassOf("ZZ")).toBeNull();
  });
  it("the legend's colours are exactly the colours the style paints (no legend entry the map never draws)", () => {
    const painted = new Set(Object.keys(CL.WELL_STATUS).map((c) => CL.wellStyle({ wellstat: c }, 1).color));
    const legend = COLORADO_LAYERS.co_ecmc_wells.legend.map((l) => l.color);
    expect(new Set(legend)).toEqual(painted);
    expect(legend.length).toBe(4);
  });
  it("PR is red and filled, PA is a small grey dot, an unknown status is neutral", () => {
    expect(CL.wellStyle({ wellstat: "PR" }, 1).color).toBe("#b91c1c");
    expect(CL.wellStyle({ wellstat: "PA" }, 1).radius).toBeLessThan(CL.wellStyle({ wellstat: "PR" }, 1).radius);
    expect(CL.wellStyle({ wellstat: "??" }, 1).color).toBe("#6b7280");
  });
  it("the PDF prints a well in the colour the screen shows (PDF-PARITY)", () => {
    const leafStyle = (x) => x;
    const gj = (st) => ({ geometry: { type: "Point", coordinates: [-104.7, 40.4] }, properties: { wellstat: st } });
    const pr = esriPrintFeatures(gj("PR"), COLORADO_LAYERS.co_ecmc_wells, leafStyle).find((f) => f.kind === "point");
    const pa = esriPrintFeatures(gj("PA"), COLORADO_LAYERS.co_ecmc_wells, leafStyle).find((f) => f.kind === "point");
    expect(pr.style.fill).toBe("#b91c1c");
    expect(pa.style.fill).toBe("#4b5563");
    expect(pr.style.radius).toBeGreaterThan(pa.style.radius);
    // a point row WITHOUT a styleFn is unchanged
    const plain = esriPrintFeatures(gj("PR"), { color: "#0f766e", weight: 2, pointRadius: 5 }, leafStyle).find((f) => f.kind === "point");
    expect(plain.style.fill).toBe("#0f766e");
  });
  it("the hover line decodes the code (no bare 'PR')", () => {
    const t = hoverText(COLORADO_LAYERS.co_ecmc_wells, { API_Label: "123-45678", wellstat: "PA", WellName: "SMITH 1", Operator: "KERR MCGEE OIL & GAS ONSHORE LP", County: "WELD" });
    expect(t).toMatch(/Plugged and abandoned/);
    expect(t).not.toMatch(/\bPA\b/);
  });
});

describe("ECMC flowlines — an abandoned line is the hazard, so it is never hidden or drawn like an active one", () => {
  it("the free-text status classifier (≈70 real spellings, measured 2026-10-29)", () => {
    for (const out of ["Abandoned", "Abandoned – Method Unknown", "Abandoned in Place", "Abandon", "Abaondoned", "REMOVED", "Out of Service", "Out-of-Service", "OutofService", "OOS", "OOSLAT", "Inactive", "IDLE", "Flushed and capped", "Decommissioned", "RETIRED", "PA", "ABiP", "AIP", "PreAbandonment", "Pre-Abandonment", "Discontinued", "Shut in", "SI", "TA", "In Active", "Temporarily abandoned"]) expect(CL.flowlineIsOut(out), out).toBe(true);
    for (const live of ["Active", "In Service", "ACTIVE/IN-SERVICE", "New Construction", "Pre-Commissioned", "PLANNED", "Injection", "", null, undefined, "Unknown"]) expect(CL.flowlineIsOut(live), String(live)).toBe(false);
  });
  it("out-of-service lines are dashed red, live and blank-status lines solid purple, and the legend says so", () => {
    expect(CL.flowlineStyle({ Status: "Abandoned" }, 1)).toMatchObject({ color: "#dc2626", dashArray: "6 4" });
    expect(CL.flowlineStyle({ Status: "Active" }, 1).dashArray).toBeUndefined();
    expect(CL.flowlineStyle({ Status: null }, 1).color).toBe("#6d28d9");
    const lg = COLORADO_LAYERS.co_ecmc_flowlines.legend;
    expect(lg.map((l) => l.color)).toEqual(["#6d28d9", "#dc2626"]);
    expect(lg[1].dash).toBe(true);
  });
  it("its words say a missing line is not proof of none", () => {
    const c = COLORADO_LAYERS.co_ecmc_flowlines;
    expect(c.infoCaveat).toMatch(/never proof there is no flowline/);
    expect(c.note).toMatch(/abandoned/i);
  });
});

describe("regulatory words are cited and say what the rule covers", () => {
  it("the wells and pad rows cite ECMC Rule 604 / SB 19-181, say 2,000 ft, and say it governs NEW pads, not building near an existing well", () => {
    for (const id of ["co_ecmc_wells", "co_ecmc_locations"]) {
      const n = COLORADO_LAYERS[id].note;
      expect(n, id).toMatch(/Rule 604/);
      expect(n, id).toMatch(/2 CCR 404-1/);
      expect(n, id).toMatch(/SB 19-181/);
      expect(n, id).toMatch(/2,000 ft/);
      expect(n, id).toMatch(/NEW/);
      expect(n, id).toMatch(/does not stop anyone building near an existing well/);
      expect(n, id).toMatch(/confirm the current text/i);
    }
  });
  it("the enterprise-zone row cites the statute and says the map is not eligibility", () => {
    const c = COLORADO_LAYERS.co_enterprise_zones;
    expect(c.note).toMatch(/C\.R\.S\. 39-30-101/);
    expect(c.infoCaveat).toMatch(/not eligibility/);
  });
  it("no row states a buffer or setback width of its own (a number only ever comes from a cited rule)", () => {
    for (const [id, c] of Object.entries(COLORADO_LAYERS)) {
      const text = `${c.note || ""} ${c.infoCaveat || ""}`;
      const feet = [...text.matchAll(/(\d[\d,]*)\s*(?:ft|feet)\b/g)].map((m) => m[0]);
      for (const f of feet) expect(["co_ecmc_wells", "co_ecmc_locations", "co_undermined"], `${id} states "${f}"`).toContain(id);
    }
  });
});

describe("click cards never print an empty row, a raw field name, a bare URL or an epoch number", () => {
  const samples = {
    co_ecmc_wells: { API_Label: "123-45678", wellstat: "PR", WellName: "SMITH 1", Operator: "KERR MCGEE OIL & GAS ONSHORE LP", County: "WELD", BASIN: "Denver (DJ) Basin", spud_date: 1500000000000, status_date: -384825600000, loc_name_num: "SMITH PAD", scout_card_public: "https://ecmc.state.co.us/cogisdb/Facility/FacilityDetail?api=00105000" },
    co_ecmc_flowlines: { Status: "Abandoned", FluidType: "OIL (RAW)", PipeSize: 2, MatType: "Steel", Company: "KERR MCGEE OIL & GAS ONSHORE LP", Length_ft: 65.76, Form_Type: "Form 44 OLFL" },
    co_ecmc_locations: { location_name: "OCHSNER  #22-19", operator_name: "PDC ENERGY INC", facility_status: "CL", form_type: "Approved Location", expire_date: 1361291476000 },
    co_superfund: { NAME: "Rocky Mountain Arsenal/RMA", CITY: "Commerce City", SiteStatus: "NPL ACTIVE", POLLUTANTS: "DIMP, DBCP", CDPHE_LINK: "https://cdphe.colorado.gov/x", EPA_Links: "javascript:alert(1)" },
    co_rcra_ca: { facility_names: "Sundance Dry Cleaners", status: "open", gw_impacts_Y_or_N: "Y", offsite_impacts_Y_or_N: "N", plume_dist_ft: "50" },
    co_inst_controls: { Site: "Former Commerce City Dog Track/CDT", IC_Type: "Notice of Environmental Use Restrictions", Desc_: "Mile High Greyhound Park - C3", Approved: "2020/10/20 00:00:00+00", Acres: 12.34 },
  };
  it("a full record becomes labelled rows with decoded words and short links", () => {
    const w = COLORADO_LAYERS.co_ecmc_wells.identifyCard(samples.co_ecmc_wells);
    expect(w.title).toBe("Oil & gas well · 123-45678");
    expect(w.rows.find((r) => r.label === "Status").text).toBe("Producing");
    expect(w.rows.find((r) => r.label === "Operator").text).toBe("Kerr McGee Oil & Gas Onshore LP");
    expect(w.rows.find((r) => r.label === "ECMC well record").href).toMatch(/^https:\/\/ecmc\.state\.co\.us\//);
    const sf = COLORADO_LAYERS.co_superfund.identifyCard(samples.co_superfund);
    expect(sf.title).toBe("Superfund site · Rocky Mountain Arsenal");
    expect(sf.rows.some((r) => r.href && /javascript:/i.test(r.href))).toBe(false); // a non-https "link" is never rendered
    expect(sf.rows.find((r) => r.label === "CDPHE site page")).toBeTruthy();
    expect(sf.rows.find((r) => r.label === "Status").text).toBe("On the National Priorities List");
    const fl = COLORADO_LAYERS.co_ecmc_flowlines.identifyCard(samples.co_ecmc_flowlines);
    expect(fl.rows.find((r) => r.label === "Pipe size").text).toBe("2 in");
    const ic = COLORADO_LAYERS.co_inst_controls.identifyCard(samples.co_inst_controls);
    expect(ic.title).toBe("Institutional control · Former Commerce City Dog Track");
    expect(ic.rows.find((r) => r.label === "Approved").text).toBe("Oct 20, 2020");
  });
  it("every card for every sample: no blank text, no field-name-looking label, no raw epoch, hrefs are https", () => {
    for (const [id, props] of Object.entries(samples)) {
      const card = COLORADO_LAYERS[id].identifyCard(props);
      for (const r of card.rows) {
        expect(String(r.text).trim().length, `${id}/${r.label}`).toBeGreaterThan(0);
        expect(r.label, `${id}`).not.toMatch(/_|[a-z][A-Z]|^[a-z]+$/); // wellstat, gw_impacts_Y_or_N, WellName … are field names, not labels
        expect(String(r.text), `${id}/${r.label}`).not.toMatch(/^\d{10,}$/);
        if (r.href) expect(r.href).toMatch(/^https:\/\//);
      }
    }
  });
  it("an all-empty record yields a title and no rows (nothing invented)", () => {
    for (const id of ["co_ecmc_wells", "co_ecmc_locations", "co_rcra_ca", "co_inst_controls", "co_closed_landfills", "co_solid_waste", "co_undermined", "co_nrhp", "co_adams_landfills", "co_weld_row", "co_aurora_zoning"]) {
      const card = COLORADO_LAYERS[id].identifyCard({});
      expect(card.rows.every((r) => String(r.text).trim()), id).toBe(true);
      expect(card.rows.map((r) => r.label), id).toEqual([]);
    }
  });
  it("an unregistered flowline says its status is not stated — the one row that is deliberately printed for a blank record", () => {
    expect(COLORADO_LAYERS.co_ecmc_flowlines.identifyCard({}).rows).toEqual([{ label: "Status", text: "Not stated" }]);
  });
  it("tidy() drops placeholders and nice() only re-cases ALL-CAPS text", () => {
    expect(CL.tidy("  <Null> ")).toBe(""); expect(CL.tidy("N/A")).toBe(""); expect(CL.tidy("  a   b ")).toBe("a b");
    expect(CL.nice("PDC ENERGY INC")).toBe("PDC Energy INC"); expect(CL.nice("KERR MCGEE OIL & GAS ONSHORE LP")).toBe("Kerr McGee Oil & Gas Onshore LP");
    expect(CL.nice("Weld Pad 3")).toBe("Weld Pad 3");
  });
});

describe("the other style tables stay consistent with their legends", () => {
  it("solid waste, prairie dog and eagle legends list exactly the colours their styles paint", () => {
    expect(new Set(COLORADO_LAYERS.co_solid_waste.legend.map((l) => l.color))).toEqual(new Set(["landfill", "compost", "recycling", "asbestos", "other"].map((c) => CL.swisStyle({ Category: c }, 1).color)));
    expect(new Set(COLORADO_LAYERS.co_prairie_dog.legend.map((l) => l.color))).toEqual(new Set(["H", "M", "L"].map((c) => CL.prairieDogStyle({ PotentialO: c }, 1).color)));
    expect(new Set(COLORADO_LAYERS.co_eagle_nests.legend.map((l) => l.color))).toEqual(new Set(["ACTIVE", "INACTIVE", "UNKNOWN", "DESTROYED"].map((c) => CL.eagleStyle({ STATUS: c }, 1).color)));
  });
  it("Aurora noise bands and Buckley zones classify as published", () => {
    expect(CL.noiseBand("55 LDN")).toBe("55"); expect(CL.noiseBand("60 LDN")).toBe("60"); expect(CL.noiseBand("65-80 LDN")).toBe("65"); expect(CL.noiseBand("65+ LDN")).toBe("65"); expect(CL.noiseBand("65 LDN")).toBe("65"); expect(CL.noiseBand("Influence")).toBe("INF");
    expect(CL.apzKind("APZ II - N")).toBe("APZ II"); expect(CL.apzKind("APZ I - S")).toBe("APZ I"); expect(CL.apzKind("CZ - N")).toBe("CZ"); expect(CL.apzKind(" ")).toBeNull();
    expect(CL.auroraZoningClass("Industrial District")).toBe("I"); expect(CL.auroraZoningClass("Business/Tech District")).toBe("I"); expect(CL.auroraZoningClass("Airport District")).toBe("I"); expect(CL.auroraZoningClass("Mixed-Use Regional District")).toBe("M"); expect(CL.auroraZoningClass("Medium-Density Residential District")).toBe("R");
  });
  it("Adams zoning draws a city-labelled polygon faint, never as a county district", () => {
    expect(CL.adamsZoneKind("I-2")).toBe("I"); expect(CL.adamsZoneKind("C-3")).toBe("C"); expect(CL.adamsZoneKind("A-1")).toBe("A"); expect(CL.adamsZoneKind("R-1-C")).toBe("R"); expect(CL.adamsZoneKind("P-U-D")).toBe("PUD");
    expect(CL.adamsZoneKind("COMMERCE CITY")).toBe("city"); expect(CL.adamsZoneKind("AURORA")).toBe("city"); expect(CL.adamsZoneKind("DIA")).toBe("other");
    expect(CL.adamsZoningStyle({ ZONE_: "COMMERCE CITY" }, 1).fillOpacity).toBeLessThan(0.1);
    expect(COLORADO_LAYERS.co_adams_zoning.identifyCard({ ZONE_: "COMMERCE CITY", CITY_NAME: "Commerce City" }).title).toBe("In Commerce City");
  });
  it("Weld zoning colours by master class", () => {
    expect(CL.weldZoningStyle({ MASTERZ: "I" }, 1).color).toBe("#7c3aed");
    expect(CL.weldZoningStyle({ MASTERZ: "A" }, 1).fillOpacity).toBeLessThan(CL.weldZoningStyle({ MASTERZ: "C" }, 1).fillOpacity);
    expect(CL.weldZoningStyle({ MASTERZ: " " }, 1).color).toBe("#6b7280");
  });
});

describe("Site Analysis pills (siteLayerPills) — the way in for a layer the panel will not give a verdict on", () => {
  it("a Colorado site gets wells, pipelines and contamination pills that point at the Colorado rows", () => {
    const pills = pillsFor({ regions: ["CO"], untrusted: ["pipelines", "wells"], layers: ALL_LAYERS });
    const by = Object.fromEntries(pills.map((p) => [p.id, p.layers]));
    expect(by.wells).toEqual(["co_ecmc_wells", "co_ecmc_locations"]);
    expect(by.pipelines).toEqual(["co_ecmc_flowlines", "eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"]);
    expect(by.contamination).toEqual(expect.arrayContaining(["co_env_cleanups", "co_superfund", "co_rcra_ca", "co_inst_controls", "co_closed_landfills"]));
  });
  it("a Texas site is unchanged (no Colorado row leaks into its pills)", () => {
    const pills = pillsFor({ regions: ["TX"], untrusted: [], layers: ALL_LAYERS });
    for (const p of pills) for (const k of p.layers) expect(k.startsWith("co_"), `${p.id}/${k}`).toBe(false);
    expect(OFF_REGION_PILLS.wells.byRegion.TX).toBeUndefined();
    expect(PILL_DEFS.length).toBeGreaterThan(3);
  });
});

describe("adversarial review round 1 (B2528688) — each confirmed finding stays fixed", () => {
  const L = COLORADO_LAYERS;
  const cardOf = (id, props) => L[id].identifyCard(props, { lat: 40, lng: -105 });
  it("heavy rows ask the server to generalise (measured vertices per 512 px cell: Weld ROW 301k at z13, Enterprise Zones 175k at z7, ECMC pads 67k at z13, Critical Habitat 85k–614k) and Aurora zoning starts above the service's 2,000-record cap", () => {
    for (const id of ["co_weld_row", "co_enterprise_zones", "co_ecmc_locations", "co_crit_habitat"]) expect(L[id].simplifyFactor, id).toBeGreaterThan(0);
    expect(L.co_crit_habitat.minZoom).toBeGreaterThanOrEqual(11);
    expect(L.co_aurora_zoning.minZoom).toBeGreaterThanOrEqual(13);
  });
  it("Aurora's Industrial District is the industrial colour, not grey", () => {
    expect(CL.auroraZoningStyle({ Dist_Name: "Industrial District" }, 1).color).toBe(CL.AURORA_ZONE_COLORS.I);
    expect(CL.auroraZoningStyle({ Dist_Name: "Something Else" }, 1).color).toBe(CL.AURORA_ZONE_COLORS.other);
  });
  it("Facilities leaves off the flowline points, draws active vs closed differently and says so in a legend", () => {
    expect(L.co_ecmc_facilities.where).toMatch(/Off-location flowline/);
    expect(CL.facilityStyle({ facility_status: "AC" }, 1).fillColor).not.toBe(CL.facilityStyle({ facility_status: "CL" }, 1).fillColor);
    expect(L.co_ecmc_facilities.legend.map((l) => l.color)).toEqual([CL.facilityStyle({ facility_status: "AC" }, 1).fillColor, CL.facilityStyle({ facility_status: "CL" }, 1).fillColor]);
  });
  it("no click card prints a raw code: facility, Adams fill, Superfund, flowline registration", () => {
    const t = (c) => c.rows.map((r) => `${r.label}: ${r.text}`).join("\n");
    expect(t(cardOf("co_ecmc_facilities", { facility_name: "X", facility_type: "Tank battery", facility_status: "CL" }))).toMatch(/Status: Closed/);
    expect(t(cardOf("co_ecmc_facilities", { facility_name: "X", facility_type: "Tank battery", facility_status: "PD" }))).not.toMatch(/Status/);
    expect(t(cardOf("co_adams_landfills", { CASENAME: "A", DISP_SITE_TYPE: "CD" }))).toMatch(/Type: Construction debris/);
    expect(t(cardOf("co_adams_landfills", { CASENAME: "A", DISP_SITE_TYPE: "UNK" }))).not.toMatch(/Type/);
    expect(t(cardOf("co_superfund", { NAME: "Site", SiteStatus: "F" }))).not.toMatch(/Status/);
    expect(t(cardOf("co_ecmc_flowlines", { Status: "Active", Form_Type: "Form 44 OLFL" }))).not.toMatch(/OLFL/);
    expect(t(cardOf("co_crit_habitat", { comname: "Fish", unitname: "Please check current species specific shapefile" }))).not.toMatch(/Unit/);
  });
  it("a Weld assessment that is plugged and abandoned is drawn as finished, not as an active location", () => {
    expect(CL.weldOglaStyle({ B1_APPL_STATUS: "Plugged and Abandoned" }, 1).color).toBe(CL.weldOglaStyle({ B1_APPL_STATUS: "Closed" }, 1).color);
  });
  it("every well-status code stays in its class (a remapped code would recolour tens of thousands of wells)", () => {
    expect(Object.fromEntries(Object.entries(CL.WELL_STATUS).map(([c, [, k]]) => [c, k]))).toEqual({ PR: "live", AC: "live", DG: "live", WO: "live", IJ: "live", SI: "idle", TA: "idle", SO: "idle", PA: "plugged", AP: "never", EP: "never", AL: "never" });
  });
  it("the Rule 604 note states the 500–2,000 ft band; the Buckley note gives no industrial verdict", () => {
    expect(L.co_ecmc_wells.note).toMatch(/500 and 2,000 ft/);
    expect(L.co_aurora_apz.note).not.toMatch(/generally allows/);
  });
});
