/* B1075–B1080 — the Flood & drainage group model + the NHD decoder.
 *
 * These lock the behaviour the 2026-07-29 Tsakiris report demanded: the panel must
 * auto-scope to the district that actually governs, must SAY why a source came back
 * empty, and must never let an advisory model be mistaken for a regulatory one.
 */
import { describe, it, expect, vi } from "vitest";
import {
  FLOOD_TIERS, FLOOD_TIER_ORDER, FEMA_ZONES_NOT_CHANNELS,
  DRAINAGE_DISTRICTS, COUNTY_DISTRICT, districtName, districtShort,
  governingDistrict, scopeFloodEntries, floodRowRelevance, districtReaches, floodMasterState,
  countyKey, countyName, femaZoneVerdict, isSfhaZone, emptyReason, districtDrainageNote,
} from "../src/workspaces/site-planner/lib/floodGroup.js";
import { NHD_FTYPE, ftypeLabel, flowlineTitle, flowlineSummary } from "../src/workspaces/site-planner/lib/nhdFlowline.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub the offenders (unused by
// ALL_LAYERS, a pure config object) so it loads in the node test env. Same pattern as
// test/coverage.test.js.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn() }));

import { ALL_LAYERS, LAYER_GROUP_LABEL } from "../src/workspaces/site-planner/lib/layers.js";

// ---------------------------------------------------------------------------
describe("NHD ftype decoding (B1078)", () => {
  it("decodes the Tsakiris case — 336 is a canal / ditch, never the bare number", () => {
    expect(ftypeLabel(336)).toBe("canal / ditch");
    expect(ftypeLabel("336")).toBe("canal / ditch");
    expect(NHD_FTYPE[460]).toBe("stream / river");
  });
  it("an UNKNOWN code is reported honestly as a number — never guessed into a nearby class", () => {
    expect(ftypeLabel(999)).toBe("type 999");
  });
  it("no code at all → null, so the caller omits the row rather than printing 'unknown'", () => {
    expect(ftypeLabel(null)).toBeNull();
    expect(ftypeLabel("")).toBeNull();
    expect(ftypeLabel("abc")).toBeNull();
  });
  it("titles prefer the USGS name, fall back to the class, never return empty", () => {
    expect(flowlineTitle({ gnis_name: "Willow Fork", ftype: 336 })).toBe("Willow Fork");
    expect(flowlineTitle({ ftype: 336 })).toBe("canal / ditch");
    expect(flowlineTitle({})).toBe("Watercourse");
  });
  it("the summary never repeats the class when the name IS the class", () => {
    expect(flowlineSummary({ gnis_name: "Willow Fork", ftype: 336 })).toBe("Willow Fork (canal / ditch)");
    expect(flowlineSummary({ ftype: 336 })).toBe("canal / ditch");
  });
});

// ---------------------------------------------------------------------------
describe("governingDistrict (B1076) — which drainage authority governs", () => {
  it("a BOUNDARY hit WINS: it is a fact, a county map is a heuristic", () => {
    // The Tsakiris case exactly: Waller County has no county-wide district, but the
    // BKDD boundary polygon contains the site.
    expect(governingDistrict({ detected: ["bkdd"], county: "waller" })).toMatchObject({ id: "bkdd", source: "boundary" });
    // …and it OUTRANKS the county default where the two disagree (BKDD reaches into Harris).
    expect(governingDistrict({ detected: ["bkdd"], county: "harris" }).id).toBe("bkdd");
  });
  it("no boundary hit → the county-wide district", () => {
    expect(governingDistrict({ county: "harris" })).toMatchObject({ id: "hcfcd", source: "county" });
    expect(governingDistrict({ county: "Fort Bend" })).toMatchObject({ id: "fbcdd", source: "county" });
  });
  it("Waller has NO county-wide district — an honest null, with the reason named", () => {
    const g = governingDistrict({ county: "waller" });
    expect(g.id).toBeNull();
    expect(g.reason).toMatch(/no county-wide flood-control district in Waller County/);
  });
  it("nothing known at all → null (never a guess)", () => {
    expect(governingDistrict({}).id).toBeNull();
    expect(governingDistrict({ detected: ["nonsense"], county: null }).id).toBeNull();
  });
  it("BKDD spans three counties — which is exactly why a county lookup alone can't decide it", () => {
    expect(DRAINAGE_DISTRICTS.bkdd.counties).toEqual(expect.arrayContaining(["waller", "harris", "fortbend"]));
    expect(COUNTY_DISTRICT.waller).toBeUndefined();
    expect(districtName("bkdd")).toMatch(/Brookshire/);
    expect(districtShort("hcfcd")).toBe("HCFCD");
  });
});

// ---------------------------------------------------------------------------
describe("scopeFloodEntries (B1076) — tiers + district auto-scoping", () => {
  const entries = [
    ["fema", { floodTier: "regulatory", order: 1, agency: "FEMA" }],
    ["hcfcd_row", { floodTier: "local", district: "hcfcd", order: 1, agency: "HCFCD" }],
    ["bkdd_drainage", { floodTier: "local", district: "bkdd", order: 3 }],
    ["bkdd_easements", { floodTier: "local", district: "bkdd", order: 4 }],
    ["coh_storm", { floodTier: "local", order: 6, agency: "City of Houston", areaCounties: ["harris"] }],
    ["nhd_flowlines", { floodTier: "hydrography", order: 1 }],
    ["bkdd_dmp", { floodTier: "advisory", district: "bkdd", order: 5 }],
  ];
  const ids = (r) => r.tiers.flatMap((t) => t.rows.map(([id]) => id));
  const offIds = (r) => r.offRows.map(([id]) => id);

  it("inside BKDD: HCFCD's row is not rendered at all, and BKDD's are", () => {
    const r = scopeFloodEntries(entries, { governing: "bkdd" });
    expect(ids(r)).not.toContain("hcfcd_row");
    expect(ids(r)).toEqual(expect.arrayContaining(["bkdd_drainage", "bkdd_easements", "bkdd_dmp"]));
    expect(r.suppressed).toEqual(["hcfcd"]);
  });
  it("in Harris: BKDD's rows are suppressed instead", () => {
    const r = scopeFloodEntries(entries, { governing: "hcfcd" });
    expect(ids(r)).toContain("hcfcd_row");
    expect(ids(r)).not.toContain("bkdd_drainage");
    expect(r.suppressed).toEqual(["bkdd"]);
  });
  it("UNKNOWN district, county unknown → suppress NOTHING (never hide the right one on a guess)", () => {
    const r = scopeFloodEntries(entries, { governing: null });
    expect(ids(r)).toEqual(expect.arrayContaining(["hcfcd_row", "bkdd_drainage"]));
    expect(r.suppressed).toEqual([]);
    expect(r.offRows).toEqual([]);
  });
  /* B1091 — the live Tsakiris failure: the drainage check hadn't resolved a district, so
   * the old scoping fell fully open and a Waller site listed a Harris-County channel layer
   * and a City-of-Houston storm sewer with no explanation. The county alone is enough to
   * know both are impossible here. */
  it("UNKNOWN district but a KNOWN county still demotes what can't reach that county", () => {
    const r = scopeFloodEntries(entries, { governing: null, county: "waller" });
    expect(ids(r)).not.toContain("hcfcd_row");
    expect(ids(r)).not.toContain("coh_storm");
    expect(offIds(r)).toEqual(expect.arrayContaining(["hcfcd_row", "coh_storm"]));
    // …and BKDD, which DOES reach Waller, is untouched.
    expect(ids(r)).toEqual(expect.arrayContaining(["bkdd_drainage", "bkdd_easements", "bkdd_dmp"]));
  });
  it("every demoted row carries its own reason, naming the county — never a silent drop", () => {
    const r = scopeFloodEntries(entries, { governing: "bkdd", county: "waller" });
    expect(r.notes.hcfcd_row).toBe("Harris County Flood Control District doesn't cover Waller County — Brookshire–Katy Drainage District is shown instead.");
    expect(r.notes.coh_storm).toBe("City of Houston's system doesn't reach Waller County — it maps Harris County only.");
  });
  it("a row you have ALREADY TURNED ON stays listed (with its reason), never yanked away", () => {
    const r = scopeFloodEntries(entries, { governing: "bkdd", county: "waller", isOn: (id) => id === "hcfcd_row" });
    expect(ids(r)).toContain("hcfcd_row");
    expect(offIds(r)).not.toContain("hcfcd_row");
    expect(r.notes.hcfcd_row).toMatch(/doesn't cover Waller County/);
  });
  it("a NON-district local row survives scoping wherever its own service area reaches", () => {
    for (const g of ["bkdd", "hcfcd", "fbcdd", null]) {
      expect(ids(scopeFloodEntries(entries, { governing: g, county: "harris" }))).toContain("coh_storm");
    }
  });
  it("national hydrography is never district- or county-scoped — that universality is the point", () => {
    for (const g of ["bkdd", "hcfcd", null]) {
      for (const c of ["harris", "waller", "fortbend", null]) {
        expect(ids(scopeFloodEntries(entries, { governing: g, county: c }))).toContain("nhd_flowlines");
      }
    }
  });
  it("the coverage engine's published-extent verdict demotes too — ONE mechanism, not two", () => {
    const r = scopeFloodEntries(entries, { governing: null, county: "harris", coverage: { fema: "out" } });
    expect(offIds(r)).toContain("fema");
    expect(r.notes.fema).toBe("FEMA's data doesn't reach this area.");
  });
  it("tiers come back in decision order and empty tiers are dropped", () => {
    const r = scopeFloodEntries(entries, { governing: "bkdd" });
    expect(r.tiers.map((t) => t.key)).toEqual(["regulatory", "local", "hydrography", "advisory"]);
    const only = scopeFloodEntries([entries[0]], { governing: null });
    expect(only.tiers.map((t) => t.key)).toEqual(["regulatory"]);
  });
  it("rows sort by their own `order` inside a tier", () => {
    const r = scopeFloodEntries(entries, { governing: "bkdd" });
    const local = r.tiers.find((t) => t.key === "local");
    expect(local.rows.map(([id]) => id)).toEqual(["bkdd_drainage", "bkdd_easements", "coh_storm"]);
  });
  it("the ADVISORY tier is a separate tier — a master-plan floodplain must never merge with the SFHA", () => {
    expect(FLOOD_TIER_ORDER).toEqual(["regulatory", "local", "hydrography", "advisory"]);
    const advisory = FLOOD_TIERS.find((t) => t.key === "advisory");
    expect(advisory.note).toMatch(/never treat an advisory floodplain as an SFHA/i);
  });
});

// ---------------------------------------------------------------------------
describe("floodRowRelevance / districtReaches (B1091) — can this source say anything here?", () => {
  it("county reach is a FACT about the data, independent of any drainage check", () => {
    expect(districtReaches("hcfcd", "waller")).toBe(false);
    expect(districtReaches("hcfcd", "Harris")).toBe(true);
    // BKDD spans three counties: reaching Waller is true, which is why reach alone can
    // never decide WHICH district governs — only that HCFCD is impossible here.
    expect(districtReaches("bkdd", "waller")).toBe(true);
    expect(districtReaches("bkdd", "chambers")).toBe(false);
  });
  it("county spellings can't miss: the panel key, CNTY_NM and free text all canonicalise", () => {
    expect(countyKey("Fort Bend")).toBe("fortbend");
    expect(countyKey("fortbend")).toBe("fortbend");
    expect(countyKey("Fort Bend County")).toBe("fortbend");
    expect(districtReaches("fbcdd", "fortbend")).toBe(true);
    expect(districtReaches("fbcdd", "Fort Bend")).toBe(true);
    expect(countyName("fortbend")).toBe("Fort Bend County");
    expect(countyName("waller")).toBe("Waller County");
  });
  it("an unknown county fails OPEN — never hide a source on a guess", () => {
    expect(districtReaches("hcfcd", null)).toBeNull();
    expect(floodRowRelevance({ district: "hcfcd" }, { county: null }).relevant).toBe(true);
  });
  it("the governing district wins over county reach where the two disagree", () => {
    // A Harris site inside BKDD: HCFCD reaches Harris, but BKDD governs — so the reason
    // says GOVERNS, not COVERS. Getting this wrong would print a falsehood.
    const r = floodRowRelevance({ district: "hcfcd" }, { governing: "bkdd", county: "harris" });
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("Harris County Flood Control District doesn't govern drainage at this site — Brookshire–Katy Drainage District does.");
  });
  it("a row with no district and no declared service area is always relevant", () => {
    expect(floodRowRelevance({ agency: "USGS" }, { county: "waller" })).toEqual({ relevant: true, reason: null });
  });
});

// ---------------------------------------------------------------------------
describe("floodMasterState (B1076) — one master toggle over the whole bundle", () => {
  const tiers = [{ rows: [["a", {}], ["b", {}]] }, { rows: [["c", {}]] }];
  it("all on → checked; some on → indeterminate, not checked (clicking turns the REST on)", () => {
    expect(floodMasterState(tiers, { a: { on: true }, b: { on: true }, c: { on: true } })).toMatchObject({ all: true, any: true, onCount: 3 });
    expect(floodMasterState(tiers, { a: { on: true }, b: {}, c: {} })).toMatchObject({ all: false, any: true, onCount: 1 });
    expect(floodMasterState(tiers, {})).toMatchObject({ all: false, any: false, onCount: 0 });
  });
  it("an empty group is never reported as 'all on'", () => {
    expect(floodMasterState([], {})).toMatchObject({ all: false, ids: [] });
  });
  it("it drives every listed id — the master switch can't miss a tier", () => {
    expect(floodMasterState(tiers, {}).ids).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
describe("femaZoneVerdict (B1077a) — the answer that was missing entirely", () => {
  it("Zone X: says minimal hazard AND that no SFHA is mapped (the live Tsakiris answer)", () => {
    const v = femaZoneVerdict({ state: "loaded", zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD" }] });
    expect(v.tone).toBe("ok");
    expect(v.text).toBe("FEMA effective FIRM: Zone X, area of minimal flood hazard — no special flood hazard area mapped here.");
  });
  it("an SFHA is named, and a floodway is called out", () => {
    expect(femaZoneVerdict({ state: "loaded", zones: [{ zone: "AE" }] })).toMatchObject({ tone: "alert" });
    const fw = femaZoneVerdict({ state: "loaded", zones: [{ zone: "AE", subtype: "FLOODWAY" }] });
    expect(fw.text).toMatch(/including regulatory floodway/);
  });
  it("an OUTAGE is 'unknown, not clear' — never mistaken for 'no flood hazard'", () => {
    const v = femaZoneVerdict({ state: "failed", zones: [] });
    expect(v.tone).toBe("warn");
    expect(v.text).toMatch(/unknown, not clear/);
  });
  it("no check has run → NO claim at all", () => {
    expect(femaZoneVerdict(null)).toBeNull();
    expect(femaZoneVerdict({})).toBeNull();
  });
  it("A and V zones are SFHA; X and D are not", () => {
    expect(isSfhaZone("AE")).toBe(true);
    expect(isSfhaZone("A")).toBe(true);
    expect(isSfhaZone("VE")).toBe(true);
    expect(isSfhaZone("X")).toBe(false);
    expect(isSfhaZone("D")).toBe(false);
    expect(isSfhaZone(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("emptyReason (B1077) — 'no features' must say WHY", () => {
  it("a STUDY-AREA layer outside its extent says so — never a clean 'no floodplain'", () => {
    const r = emptyReason({ studyArea: true, agency: "BKDD" }, { coverage: "out" });
    expect(r).toMatch(/Outside this study area/);
    expect(r).toMatch(/Not a finding of "no floodplain"/);
  });
  it("a study-area layer INSIDE its extent reports a real modelled empty", () => {
    expect(emptyReason({ studyArea: true, agency: "BKDD" }, { coverage: "in" })).toMatch(/modelled this area and mapped nothing here/);
  });
  it("an ordinary out-of-coverage layer names the reach limit", () => {
    expect(emptyReason({ agency: "HCFCD" }, { coverage: "out" })).toMatch(/data doesn't reach this area/);
  });
  it("in coverage + nothing found is stated positively, not left silent", () => {
    expect(emptyReason({ agency: "FEMA" }, { coverage: "in" })).toMatch(/covers this area and reports nothing at this site/);
  });
});

// ---------------------------------------------------------------------------
describe("districtDrainageNote (B1080) — the readout's governing-district line", () => {
  it("BKDD: names the channel, the easement width + exhibit, and the sub-watershed", () => {
    const n = districtDrainageNote({
      drainageDistrict: { id: "bkdd" },
      channel: { state: "loaded", near: true, name: "Willow Fork", kindLabel: "canal / ditch", distFt: 42 },
      easements: { present: true, maxWidthFt: 70, items: [{ widthFt: 70, exhibit: "WF-10.pdf" }] },
      watershed: { state: "loaded", names: ["Willow Fork"], sqMiles: 23 },
    });
    expect(n.text).toContain("BKDD governs drainage here");
    expect(n.text).toContain("Willow Fork (canal / ditch) within ~42 ft");
    expect(n.text).toContain("district drainage easement 70 ft (exhibit WF-10.pdf)");
    expect(n.text).toContain("sub-watershed “Willow Fork” (23 sq mi)");
  });
  it("HCFCD stays silent here — its own Auto/Yes/No wording already says it (no doubling)", () => {
    expect(districtDrainageNote({ drainageDistrict: { id: "hcfcd" }, channel: { state: "loaded", near: true, name: "W100-00-00" } })).toBeNull();
  });
  it("no district + an NHD hit → says WHOSE data answered and that it is an inventory", () => {
    const n = districtDrainageNote({
      drainageDistrict: { id: null },
      channel: { state: "loaded", near: true, name: "Willow Fork", kindLabel: "canal / ditch", distFt: 42, inventoryOnly: true },
    });
    expect(n.text).toMatch(/No drainage district publishes maps here — USGS hydrography/);
    expect(n.text).toMatch(/not that it can take your discharge/);
  });
  it("a district-service OUTAGE is an honest unknown, never 'nothing here'", () => {
    const n = districtDrainageNote({ drainageDistrict: { id: "bkdd" }, channel: { state: "failed" } });
    expect(n.tone).toBe("warn");
    expect(n.text).toMatch(/unknown, not clear/);
  });
  it("nothing resolved yet → no claim", () => {
    expect(districtDrainageNote(null)).toBeNull();
    expect(districtDrainageNote({ drainageDistrict: { id: null }, channel: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("the registered layers actually satisfy the group contract", () => {
  const floodEntries = Object.entries(ALL_LAYERS).filter(([, c]) => c.group === "flood");

  it("every Flood & drainage layer declares a tier from the legend", () => {
    for (const [id, cfg] of floodEntries) {
      expect(FLOOD_TIER_ORDER, `${id} has an unknown floodTier "${cfg.floodTier}"`).toContain(cfg.floodTier);
    }
  });
  it("every flood layer names its agency, so the badge is never blank", () => {
    for (const [id, cfg] of floodEntries) expect(cfg.agency, `${id} has no agency`).toBeTruthy();
  });
  it("a district-scoped row names a district the scoper knows", () => {
    for (const [id, cfg] of floodEntries) {
      if (cfg.district) expect(DRAINAGE_DISTRICTS[cfg.district], `${id} → unknown district`).toBeTruthy();
    }
  });
  it("the BKDD family is registered and reachable from the panel", () => {
    const ids = floodEntries.map(([id]) => id);
    expect(ids).toEqual(expect.arrayContaining(["bkdd_drainage", "bkdd_easements", "bkdd_dmp", "nhd_flowlines"]));
    expect(LAYER_GROUP_LABEL.flood).toBe("Flood & drainage");
  });
  it("the master-plan family is ADVISORY and study-area gated — the two things that keep it honest", () => {
    expect(ALL_LAYERS.bkdd_dmp.floodTier).toBe("advisory");
    expect(ALL_LAYERS.bkdd_dmp.studyArea).toBe(true);
  });
  it("every BKDD layer carries the cold-start stall override (B1079)", () => {
    for (const id of ["bkdd_drainage", "bkdd_easements", "bkdd_dmp"]) {
      // BKDD's first call to a cold ArcGIS Server measured 16.5–18.3 s; the shared 15 s
      // watchdog would go amber on every first visit to a perfectly healthy source.
      expect(ALL_LAYERS[id].stallMs, `${id}`).toBeGreaterThanOrEqual(20000);
    }
  });
  it("every BKDD registry row carries a per-source timeout well past the cold start", () => {
    for (const k of ["bkddStreams", "bkddEasements", "bkddEasements107", "bkddSubwatersheds", "bkddBoundary", "bkddDmpFloodplain"]) {
      expect(GIS_SOURCES[k].timeoutMs, k).toBeGreaterThanOrEqual(20000);
    }
  });
  it("BKDD layer numbers are never shared across services — the trap that would swap streams for MUDs", () => {
    // 121 means "All Streams" in Drainage_Information and "MUD boundary" in Boundaries.
    expect(GIS_SOURCES.bkddAllStreams.serviceUrl).toMatch(/Drainage_Information/);
    expect(GIS_SOURCES.bkddAllStreams.layerId).toBe(121);
    expect(GIS_SOURCES.bkddBoundary.serviceUrl).toMatch(/Boundaries/);
    expect(GIS_SOURCES.bkddBoundary.layerId).toBe(129);
  });
  it("the two NHD registry rows stay distinct — different services, different schemas", () => {
    expect(GIS_SOURCES.nhdFlowline.serviceUrl).toMatch(/NHDPlus_HR/);   // routed network, UPPERCASE fields
    expect(GIS_SOURCES.nhdHydro.serviceUrl).toMatch(/services\/nhd\//); // plain NHD, lowercase + ftype
    expect(GIS_SOURCES.nhdHydro.fields.ftype).toBe("ftype");
    expect(GIS_SOURCES.nhdHydro.layerId).toBe(6);   // "Flowline - Large Scale", not the 1:100k layer 4
    expect(GIS_SOURCES.nhdHydroWaterbody.layerId).toBe(12); // "Waterbody - Large Scale", not the small-scale 10
  });
  it("the standing FEMA-zones-not-channels line is stated, and only once", () => {
    expect(FEMA_ZONES_NOT_CHANNELS).toMatch(/FEMA maps flood ZONES, not channels/);
  });
});
