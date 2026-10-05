import { describe, it, expect, vi } from "vitest";
// layers.js pulls in Leaflet-facing modules that need a DOM — same stubs as test/californiaJurisdiction.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { cityLineOf, roadsLineOf, buildGovernsModel, buildCalls, CALLS, mergeRoadAnswers } from "../src/workspaces/site-planner/lib/siteGoverns.js";
import { pillsFor, pillOn, togglePill, PILLS_NOTE, PILL_DEFS } from "../src/workspaces/site-planner/lib/siteLayerPills.js";
import { focusOverlays, FOCUS_DIM } from "../src/workspaces/site-planner/lib/layerFocus.js";
import { runSiteScreen, legacyFindings, roadRings } from "../src/workspaces/site-planner/lib/siteScreen.js";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

describe("who governs — the structured badge, compact only when compact is complete", () => {
  const jur = (over = {}) => ({ city: [], etj: [], county: ["Harris"], isd: ["Goose Creek CISD"], unincorporated: true, straddle: false, ages: {}, sources: [], ...over });
  it("a Goose Creek-shaped split: 'Baytown, part ETJ' with a straddles flag, share kept as a note", () => {
    const j = jur({ city: ["Baytown"], etj: ["Baytown"], unincorporated: false, cityCentroid: ["Baytown"], cityAll: [], citySome: ["Baytown"], cityContainment: "partial",
      cityCoverage: { inCity: 6, tested: 14 }, sources: [{ id: "city", state: "ok" }, { id: "etj", state: "ok" }, { id: "county", state: "ok" }] });
    const b = formatJurisdictionBadge(j);
    expect(b.shape).toBe("split");
    const c = cityLineOf(b);
    expect(c.text).toBe("Baytown, part ETJ");
    expect(buildGovernsModel(b, null).city.straddles).toBe(true);
  });
  it("a limited-purpose annexation is NEVER collapsed into 'Baytown': the full badge text (with its class) is shown", () => {
    const b = { shape: "in-city", governingCities: ["Baytown"], partialCities: [], etjLabels: [], cityLimitedAreas: [{ name: "Baytown", class: "limited" }], jur: "City of Baytown limited-purpose annexation", tail: null, straddle: false };
    expect(cityLineOf(b).text).toBe("City of Baytown limited-purpose annexation");
  });
  it("a failed city lookup says so; an unincorporated site says Unincorporated; a disputed ETJ keeps its words", () => {
    expect(cityLineOf(null).failed).toBe(true);
    expect(cityLineOf({ shape: "unknown", jur: "Couldn't check city limits" }).failed).toBe(true);
    expect(cityLineOf({ shape: "unincorporated", governingCities: [], partialCities: [], etjLabels: [], jur: "Unincorporated" }).text).toBe("Unincorporated");
    expect(cityLineOf({ shape: "etj", governingCities: [], partialCities: [], etjLabels: ["Houston"], etjUndetermined: [{}], jur: "ETJ undetermined (disputed)" }).text).toBe("ETJ undetermined (disputed)");
  });
  it("roads: one maintainer for all, a mixed per-road list, none, failed, off-Texas", () => {
    const rd = (name, label) => ({ name, authority: { label } });
    const all = roadsLineOf({ roads: [rd("John Martin Rd", "County"), rd("N Battle Bell", "County"), rd("Lee Rd", "County"), rd("Ward Rd", "County")] });
    expect(all.kind).toBe("all");
    expect(all.text).toBe("County maintains all 4 · John Martin Rd, N Battle Bell, Lee Rd, …");
    const mixed = roadsLineOf({ roads: [rd("FM 565", "State (TxDOT)"), rd("Lee Rd", "County")] });
    expect(mixed.kind).toBe("mixed"); expect(mixed.items).toHaveLength(2);
    expect(roadsLineOf({ roads: [] }).kind).toBe("none");
    expect(roadsLineOf({ __error: new Error("x") }).kind).toBe("failed");
    expect(roadsLineOf({ roads: [], error: "The GIS source returned HTTP 503" }).kind).toBe("failed"); // the engine RETURNS its failure
    expect(roadsLineOf({ __notScreened: true }, { notScreenedIn: "Colorado" }).text).toBe("Not screened in Colorado");
  });
  it("school district off Texas ground is 'Not screened', never a dash that reads as 'none'", () => {
    const g = buildGovernsModel({ shape: "unincorporated", county: "Weld County", isd: null, governingCities: [], partialCities: [], etjLabels: [], jur: "Unincorporated" }, null, { state: "CO", stateLabel: "Colorado" });
    expect(g.school).toBe("Not screened in Colorado");
  });
});

describe("calls to make — only what applies, prompts not claims", () => {
  const inCity = { governingCities: ["Baytown"], partialCities: [], cityContainment: "in" };
  const partial = { governingCities: [], partialCities: ["Baytown"], cityContainment: "partial" };
  const row = (id, severity) => ({ id, severity });
  it("always power; water/sewer unless BOTH certificates are positively on file; zoning only with a city part", () => {
    expect(buildCalls({ ccn: { water: true, sewer: true }, badge: null, rows: [] }).map((c) => c.id)).toEqual(["power"]);
    expect(buildCalls({ ccn: { water: true, sewer: false }, badge: null, rows: [] }).map((c) => c.id)).toEqual(["water-sewer", "power"]);
    expect(buildCalls({ ccn: { water: null, sewer: null }, badge: null, rows: [] }).map((c) => c.id)).toEqual(["water-sewer", "power"]);
    expect(buildCalls({ ccn: { water: true, sewer: true }, badge: inCity, rows: [] }).find((c) => c.id === "zoning").label).toBe("Zoning district");
    expect(buildCalls({ ccn: { water: true, sewer: true }, badge: partial, rows: [] }).find((c) => c.id === "zoning").label).toBe("Zoning district · city part only");
  });
  it("811 only when the pipeline row is red or amber", () => {
    for (const [sev, want] of [["red", true], ["amber", true], ["green", false], ["failed", false]]) {
      expect(buildCalls({ ccn: { water: true, sewer: true }, rows: [row("pipelines", sev)] }).some((c) => c.id === "pipelines-811"), sev).toBe(want);
    }
  });
  it("labels carry no jargon and make no data claim", () => {
    const all = [CALLS.waterSewer, CALLS.zoning, CALLS.pipelines811, CALLS.power].map((c) => c.label).join(" ");
    expect(all).not.toMatch(/CCN|AADT|SFHA|INFO/);
  });
});

describe("show-on-the-map pills — handles on the SAME layer keys the Layers panel uses", () => {
  const ids = (p) => p.map((x) => x.id);
  it("a Texas site: power, rail, traffic, contamination (both layers), faults — pipelines and wells are verdict rows, not pills", () => {
    const p = pillsFor({ regions: ["TX"], untrusted: [], layers: ALL_LAYERS });
    expect(ids(p)).toEqual(["power", "rail", "traffic", "contamination", "faults"]);
    expect(p.find((x) => x.id === "contamination").layers).toEqual(["env_lpst", "env_cleanups"]);
    for (const pill of p) for (const k of pill.layers) expect(ALL_LAYERS[k], k).toBeTruthy();
  });
  it("a Colorado site: Colorado's own layers, no Texas-only layer, and no wells pill (ECMC is unwired)", () => {
    const p = pillsFor({ regions: ["CO"], untrusted: ["pipelines", "wells"], layers: ALL_LAYERS });
    expect(p.find((x) => x.id === "faults")).toBeUndefined();
    expect(p.find((x) => x.id === "traffic").layers).toEqual(["co_aadt"]);
    expect(p.find((x) => x.id === "wells")).toBeUndefined();
    expect(p.find((x) => x.id === "pipelines")).toBeUndefined();
    for (const pill of p) for (const k of pill.layers) expect(ALL_LAYERS[k].states === undefined || ALL_LAYERS[k].states.includes("CO"), k).toBe(true);
  });
  it("a Georgia site: pipelines come back as the (approximate) EIA layers", () => {
    const p = pillsFor({ regions: ["GA"], untrusted: ["pipelines", "wells"], layers: ALL_LAYERS });
    expect(p.find((x) => x.id === "pipelines").layers).toEqual(["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"]);
  });
  it("the muted line is EXACTLY the owner's words", () => {
    expect(PILLS_NOTE).toBe("Tap one to turn it on. These come from public maps that are often off, so Planyr doesn't flag them for you.");
  });
  it("toggle round-trips through ONE writer: pill on ⇒ every layer on; the Layers panel flipping one layer is seen by the pill", () => {
    const state = { env_lpst: false, env_cleanups: false };
    const set = (k, v) => { state[k] = v; };
    const is = (k) => !!state[k];
    const pill = pillsFor({ regions: ["TX"], layers: ALL_LAYERS }).find((x) => x.id === "contamination");
    expect(pillOn(pill, is)).toBe(false);
    expect(togglePill(pill, is, set)).toBe(true);
    expect(state).toEqual({ env_lpst: true, env_cleanups: true });
    state.env_cleanups = false;                 // the Layers panel turns ONE of them off…
    expect(pillOn(pill, is)).toBe(true);        // …the pill still reads on (any layer on)
    state.env_lpst = false;
    expect(pillOn(pill, is)).toBe(false);       // both off → off
    expect(PILL_DEFS.length).toBe(5);
  });
});

describe("row highlight — focus is derived, never written", () => {
  const reg = { fema: { opacity: 0.6 }, wetlands: { opacity: 0.7 }, hifld_tx: { opacity: 0.8 } };
  it("identity when nothing is focused (the overlay-sync effect must not re-run for nothing)", () => {
    const o = { fema: { on: false } };
    expect(focusOverlays(o, null, reg)).toBe(o);
    expect(focusOverlays(o, "nope", reg)).toBe(o);
  });
  it("shows the focused layer at full strength even if it was off, dims every other layer that is on, leaves off layers off", () => {
    const o = { fema: { on: false, opacity: 0.6 }, wetlands: { on: true, opacity: 0.8 }, hifld_tx: { on: false } };
    const f = focusOverlays(o, "fema", reg);
    expect(f.fema).toEqual(expect.objectContaining({ on: true, opacity: 1 }));
    expect(f.wetlands.opacity).toBeCloseTo(0.8 * FOCUS_DIM);
    expect(f.hifld_tx.on).toBe(false);
    expect(o.fema.on).toBe(false);              // the REAL state is untouched — nothing persisted, nothing undoable
    expect(o.wetlands.opacity).toBe(0.8);
  });
});

describe("runSiteScreen — the whole pipeline with injected services", () => {
  const TX = [[[-95.0, 29.8], [-94.997, 29.8], [-94.997, 29.803], [-95.0, 29.803]]];
  const CO = [[[-104.99, 39.74], [-104.987, 39.74], [-104.987, 39.743], [-104.99, 39.743]]];
  const ok = () => ({ features: [] });
  const fetchJson = vi.fn(async (url) => {
    if (url.includes("hazards.fema.gov")) return { features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "" }, geometry: { rings: [[[-96, 29], [-94, 29], [-94, 31], [-96, 31]]] } }] };
    return ok();
  });
  const idJur = async () => ({ county: ["Harris"], city: [], etj: [], isd: ["X ISD"], unincorporated: true, straddle: false, ages: {}, sources: [] });
  const idRoad = async () => ({ roads: [{ name: "Lee Rd", authority: { label: "County" } }] });
  const mk = () => createGisCache({ store: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null }, now: () => 1 });
  it("Texas: five rows, governs + calls present, legacy wetlands finding for the buildability link", async () => {
    const r = await runSiteScreen(TX, { fetchJson, identifyJurisdiction: idJur, identifyRoadAuthority: idRoad, cache: mk() });
    expect(r.rows.map((x) => x.id)).toEqual(["flood100", "flood500", "wetlands", "pipelines", "wells"]);
    expect(r.governs.roads.text).toContain("County maintains");
    expect(r.calls.map((c) => c.id)).toContain("power");
    expect(r.findings).toEqual([{ id: "wetlands", status: "absent" }]);
  });
  it("Colorado: three rows only; the road authority is not screened (Texas source) and no RRC request is made", async () => {
    fetchJson.mockClear();
    const r = await runSiteScreen(CO, { fetchJson, identifyJurisdiction: idJur, identifyRoadAuthority: idRoad, cache: mk() });
    expect(r.rows.map((x) => x.id)).toEqual(["flood100", "flood500", "wetlands"]);
    expect(r.untrusted.sort()).toEqual(["pipelines", "wells"]);
    expect(r.governs.roads.kind).toBe("not-screened");
    expect(fetchJson.mock.calls.some(([u]) => u.includes("gis.rrc.texas.gov") || u.includes("puc") )).toBe(false);
  });
  it("legacy finding maps a failed wetlands row to 'unavailable', never 'absent'", () => {
    expect(legacyFindings([{ id: "wetlands", severity: "failed" }])).toEqual([{ id: "wetlands", status: "unavailable" }]);
    expect(legacyFindings([{ id: "wetlands", severity: "red" }])).toEqual([{ id: "wetlands", status: "present" }]);
  });
  it("a jurisdiction engine that throws still returns the verdict rows", async () => {
    const r = await runSiteScreen(TX, { fetchJson, identifyJurisdiction: async () => { throw new Error("boom"); }, identifyRoadAuthority: idRoad, cache: mk() });
    expect(r.rows).toHaveLength(5);
    expect(r.governs.city.failed).toBe(true);
  });
  it("a Retry (only: [...]) returns just that row and skips governs/utility fetches", async () => {
    const idJ = vi.fn(idJur);
    const r = await runSiteScreen(TX, { fetchJson, identifyJurisdiction: idJ, identifyRoadAuthority: idRoad, cache: mk(), only: ["wells"], force: true });
    expect(r.rows.map((x) => x.id)).toEqual(["wells"]);
    expect(idJ).not.toHaveBeenCalled();
  });
});

describe("roads — the mixed-ownership path (Goose Creek: IH 10 + county roads)", () => {
  const rd = (name, label, lengthM = 100) => ({ name, authority: { label }, lengthM });
  it("one parcel fronting BOTH a state and a county road reads Mixed with the per-road list", () => {
    const line = roadsLineOf({ roads: [rd("IH 10", "State (TxDOT)"), rd("John Martin Rd", "County"), rd("N Battle Bell Rd", "County")] });
    expect(line.kind).toBe("mixed");
    expect(line.items.map((i) => `${i.name} — ${i.authority}`)).toEqual(["IH 10 — State (TxDOT)", "John Martin Rd — County", "N Battle Bell Rd — County"]);
  });
  it("roads fronted by DIFFERENT parcels merge: parcel A fronts only IH 10, parcel B only county roads → Mixed, not 'State maintains IH 10'", () => {
    const merged = mergeRoadAnswers([{ roads: [rd("IH 10", "State (TxDOT)", 900)] }, { roads: [rd("John Martin Rd", "County", 400), rd("Pocahontas Dr", "County", 200)] }]);
    expect(merged.roads).toHaveLength(3);
    expect(roadsLineOf(merged).kind).toBe("mixed");
  });
  it("the same road across parcels is one row; lengths add and the longest piece names the authority", () => {
    const merged = mergeRoadAnswers([{ roads: [rd("John Martin Rd", "County", 300)] }, { roads: [rd("John Martin Rd", "County", 500)] }]);
    expect(merged.roads).toHaveLength(1);
    expect(merged.roads[0].lengthM).toBe(800);
  });
  it("a parcel whose lookup failed is REPORTED, never silently dropped; all failed → the failure", () => {
    const m = mergeRoadAnswers([{ roads: [rd("IH 10", "State (TxDOT)")] }, { __error: new Error("x") }]);
    expect(m.partialError).toBe(true);
    expect(roadsLineOf(m).text).toContain("some parcels couldn't be checked");
    expect(roadsLineOf(mergeRoadAnswers([{ __error: new Error("x") }, { __error: new Error("y") }])).kind).toBe("failed");
  });
  it("runSiteScreen asks the road engine for EVERY parcel's frontage (largest first), not just the largest", async () => {
    const big = [[-95.0, 29.8], [-94.99, 29.8], [-94.99, 29.81], [-95.0, 29.81]];
    const small = [[-94.98, 29.8], [-94.979, 29.8], [-94.979, 29.801], [-94.98, 29.801]];
    const seen = [];
    const idRoad = async (lng, lat, o) => { seen.push(o.ring); return o.ring === big ? { roads: [rd("IH 10", "State (TxDOT)")] } : { roads: [rd("John Martin Rd", "County")] }; };
    const r = await runSiteScreen([small, big], { fetchJson: async () => ({ features: [] }), identifyJurisdiction: async () => ({ county: ["Harris"], city: [], etj: [], isd: [], unincorporated: true, straddle: false, ages: {}, sources: [] }), identifyRoadAuthority: idRoad, cache: createGisCache({ store: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null }, now: () => 1 }) });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(big);
    expect(r.governs.roads.kind).toBe("mixed");
  });
  it("roadRings orders largest-first and caps", () => {
    const many = Array.from({ length: 20 }, (_, i) => [[0, 0], [i + 1, 0], [i + 1, 1]]);
    expect(roadRings(many)).toHaveLength(12);
    expect(roadRings(many)[0]).toBe(many[19]);
  });
});
