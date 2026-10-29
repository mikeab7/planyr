/* NEW-1 (B2479568 amendment, owner 2026-10-29: "you need to check every state") — ONE state answer for EVERY US point, and a layer
 * row is offered only where its source serves, in EVERY state.
 *
 * THE FINDING (measured on main 65ed6399): `siteState` answered only TX / CO / FL / GA / TN / CA / NJ / NY — three of them from BOXES. The Texas box
 * holds Shreveport (LA), Roswell (NM) and Lawton (OK), so a Shreveport site read "TX" and was offered every Texas-only row (the Texas
 * Railroad Commission Pipelines row among them); Georgia's box reached into SC, so North Augusta read "GA"; and every other state read null.
 * #2584 had only checked TX/TN/GA/FL/CO/CA/NJ/NY/KY.
 *
 * This iterates ALL 50 states + DC with one interior point each — asserting (a) `siteState` names the state, (b) no row scoped to another
 * state is offered and every row that serves the state is, on the planner's AND the finder's own scope, and (c) Pipelines is the Texas RRC
 * row in TX and the national EIA row everywhere else — plus the border points the owner's fix is about. */
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
import { siteState, realStateAt, US_STATE_CODES, US_STATE_NAMES } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { PANEL_GROUPS, groupEntriesFor, availableEntries, layerAvailableHere } from "../src/workspaces/site-planner/lib/layerPanelModel.js";
import { US_STATES_ENCODED } from "../src/workspaces/site-planner/lib/usStatesData.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

/* One point well inside each state (a city, not a border town). [lat, lng]. */
const INTERIOR = {
  AL: [33.52, -86.80], AK: [61.2181, -149.9003], AZ: [33.4484, -112.074], AR: [34.7465, -92.2896], CA: [38.5816, -121.4944],
  CO: [39.7392, -104.9903], CT: [41.7658, -72.6734], DE: [39.1582, -75.5244], DC: [38.9072, -77.0369], FL: [28.5383, -81.3792],
  GA: [33.749, -84.388], HI: [21.3069, -157.8583], ID: [43.615, -116.2023], IL: [39.7817, -89.6501], IN: [39.7684, -86.1581],
  IA: [41.5868, -93.625], KS: [39.0473, -95.6752], KY: [38.2527, -85.7585], LA: [30.4515, -91.1871], ME: [44.3106, -69.7795],
  MD: [39.2904, -76.6122], MA: [42.2626, -71.8023], MI: [42.7325, -84.5555], MN: [44.9778, -93.265], MS: [32.2988, -90.1848],
  MO: [38.5767, -92.1735], MT: [46.5891, -112.0391], NE: [40.8136, -96.7026], NV: [39.1638, -119.7674], NH: [43.2081, -71.5376],
  NJ: [40.7357, -74.1724], NM: [35.687, -105.9378], NY: [42.6526, -73.7562], NC: [35.7796, -78.6382], ND: [46.8083, -100.7837],
  OH: [39.9612, -82.9988], OK: [35.4676, -97.5164], OR: [44.9429, -123.0351], PA: [40.2732, -76.8867], RI: [41.824, -71.4128],
  SC: [34.0007, -81.0348], SD: [44.3683, -100.351], TN: [36.1627, -86.7816], TX: [30.2672, -97.7431], UT: [40.7608, -111.891],
  VT: [44.2601, -72.5754], VA: [37.5407, -77.436], WA: [47.0379, -122.9007], WV: [38.3498, -81.6326], WI: [43.0731, -89.4012],
  WY: [41.14, -104.8202],
};

/* The border points the fix is about. [name, lat, lng, state]. */
const BORDER = [
  ["Shreveport LA", 32.5252, -93.7502, "LA"],
  ["Texarkana, Arkansas side", 33.4251, -94.0377, "AR"],
  ["Texarkana, Texas side", 33.4255, -94.0477, "TX"],
  ["Lawton OK", 34.6036, -98.3959, "OK"],
  ["Roswell NM", 33.3943, -104.523, "NM"],
  ["Jacksonville FL", 30.3322, -81.6557, "FL"],
  ["Tallahassee FL", 30.4383, -84.2807, "FL"],
  ["Chattanooga TN", 35.0456, -85.3097, "TN"],
  ["Fort Oglethorpe GA", 34.9484, -85.2569, "GA"],
  ["Augusta GA", 33.4735, -81.9748, "GA"],
  ["North Augusta SC", 33.5035, -81.9648, "SC"],
  ["Columbus GA (on the Chattahoochee)", 32.46, -84.99, "GA"],
  ["Reno NV", 39.5296, -119.8138, "NV"],
  ["Las Vegas NV", 36.1699, -115.1398, "NV"],
  ["Hoboken NJ (Hudson riverfront)", 40.744, -74.0324, "NJ"],
  ["Hudson Yards, Manhattan NY", 40.7536, -74.001, "NY"],
  ["Philadelphia PA (a few km from NJ)", 39.9526, -75.1652, "PA"],
  ["Bluffton SC (inside the old Georgia outline)", 32.24, -80.86, "SC"],
  ["Yuma AZ", 32.6927, -114.6277, "AZ"],
  ["Orange TX (on the Sabine)", 30.0927, -93.7366, "TX"],
  ["Denison TX (on the Red River)", 33.7557, -96.5367, "TX"],
  ["Durant OK (just over the Red River)", 33.9937, -96.3711, "OK"],
];

/* Ground that is not a US state at all — it stays null (and so is "somewhere else", never "unknown"). */
const OFF_US = [["Toronto", 43.6532, -79.3832], ["Monterrey MX", 25.6866, -100.3161], ["Mexico City", 19.4326, -99.1332],
  ["Vancouver", 49.2827, -123.1207], ["Havana", 23.1136, -82.3666], ["mid-Gulf of Mexico", 25.0, -90.0], ["mid-Atlantic", 35.0, -60.0]];

const EIA = ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"];
const groups = PANEL_GROUPS.filter((g) => g.key !== "base").map((g) => g.key);
const rowsFor = (scope) => groups.flatMap((g) => availableEntries(groupEntriesFor(ALL_LAYERS, g), scope).map(([id]) => id)).sort();
/* the planner's scope: the plan origin and the state resolved from it (SitePlanner.jsx) */
const plannerScope = (lat, lng) => ({ state: siteState({ lat, lng }), loc: { lat, lng } });
/* the finder's scope: the view centre's state, and the centre rounded to a 0.05° cell (MapFinder.jsx onMove) */
const finderScope = (lat, lng) => ({ state: siteState({ lat, lng }), loc: { lat: Math.round(lat * 20) / 20, lng: Math.round(lng * 20) / 20 } });

describe("the state list is the 50 states + DC, and every one has a name and a boundary", () => {
  it("US_STATE_CODES is 51 codes, each named, each with a polygon in the generated data", () => {
    expect(US_STATE_CODES.length).toBe(51);
    expect(new Set(US_STATE_CODES).size).toBe(51);
    const inData = new Set(US_STATES_ENCODED.split(";").map((p) => p.slice(0, p.indexOf(":"))));
    for (const st of US_STATE_CODES) { expect(US_STATE_NAMES[st], st).toBeTruthy(); expect(inData.has(st), `${st} has no polygon`).toBe(true); }
    expect(Object.keys(INTERIOR).sort()).toEqual([...US_STATE_CODES].sort());
  });
});

describe("(a) siteState names every state from its real boundary", () => {
  for (const st of Object.keys(INTERIOR)) {
    it(`${st}: an interior point answers ${st}`, () => {
      const [lat, lng] = INTERIOR[st];
      expect(siteState({ lat, lng })).toBe(st);
    });
  }
  for (const [name, lat, lng, want] of BORDER) it(`border — ${name} → ${want}`, () => expect(siteState({ lat, lng })).toBe(want));
  for (const [name, lat, lng] of OFF_US) it(`off the US — ${name} stays null`, () => expect(siteState({ lat, lng })).toBeNull());
  it("a point with no coordinates stays null (every legacy saved plan)", () => {
    expect(siteState({})).toBeNull();
    expect(siteState({ lat: NaN, lng: NaN })).toBeNull();
    expect(siteState()).toBeNull();
  });
  it("the Texas box no longer answers Texas for Louisiana, New Mexico or Oklahoma ground (they were inside it)", () => {
    for (const [lat, lng, st] of [[32.5, -93.75, "LA"], [33.4, -104.5, "NM"], [34.62, -98.4, "OK"], [32.7, -103.1, "NM"], [36.7, -103.3, "NM"]]) {
      expect(siteState({ lat, lng }), `${lat},${lng}`).toBe(st);
    }
  });
  it("the real-boundary set alone already names every interior point (the guards are for the river margins, not the interior)", () => {
    for (const [st, [lat, lng]] of Object.entries(INTERIOR)) expect(realStateAt(lat, lng), st).toBe(st);
  });
});

describe("(b) a row is offered only where its source serves — in every state, on both surfaces", () => {
  for (const st of Object.keys(INTERIOR)) {
    it(`${st}: states-scoped rows appear only when ${st} is in their list, statesNot rows only when it is not`, () => {
      const [lat, lng] = INTERIOR[st];
      for (const [label, scope] of [["planner", plannerScope(lat, lng)], ["finder", finderScope(lat, lng)]]) {
        expect(scope.state, `${label} scope state`).toBe(st);
        for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
          if (cfg.regions && cfg.regions.length) continue; // a region row is also gated by a boundary — covered by layerLocationScope
          const want = (!cfg.states || cfg.states.includes(st)) && !(cfg.statesNot || []).includes(st);
          expect(layerAvailableHere(cfg, scope), `${label}: ${id} at ${st}`).toBe(want);
        }
      }
    });
    it(`${st}: the planner and the finder list the SAME rows`, () => {
      const [lat, lng] = INTERIOR[st];
      expect(rowsFor(plannerScope(lat, lng))).toEqual(rowsFor(finderScope(lat, lng)));
    });
  }
  for (const [name, lat, lng, st] of BORDER) {
    it(`border — ${name}: no row scoped to a state other than ${st} is offered; planner and finder agree`, () => {
      const planner = plannerScope(lat, lng), finder = finderScope(lat, lng);
      for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
        if (cfg.regions && cfg.regions.length) continue;
        if (cfg.states && !cfg.states.includes(st)) expect(layerAvailableHere(cfg, planner), `${id} offered at ${name}`).toBe(false);
        if (cfg.statesNot && cfg.statesNot.includes(st)) expect(layerAvailableHere(cfg, planner), `${id} offered at ${name}`).toBe(false);
      }
      // the finder rounds its centre to a 0.05° cell, so a point within ~3 km of a line may round across it; the rows agree wherever it does not
      if (finder.state === st) expect(rowsFor(planner)).toEqual(rowsFor(finder));
    });
  }
  for (const [name, lat, lng] of OFF_US) {
    it(`off the US — ${name}: a LOCATED point no state holds is offered no states-scoped row`, () => {
      const scope = plannerScope(lat, lng);
      for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
        if (cfg.regions && cfg.regions.length) continue;
        if (cfg.states) expect(layerAvailableHere(cfg, scope), id).toBe(false);
      }
    });
  }
});

describe("(c) Pipelines is the Texas RRC row in Texas and the national EIA row everywhere else", () => {
  const pipes = (scope) => rowsFor(scope).filter((id) => id === "txrrc_pipe" || EIA.includes(id));
  for (const st of Object.keys(INTERIOR)) {
    it(`${st}`, () => {
      const [lat, lng] = INTERIOR[st];
      for (const scope of [plannerScope(lat, lng), finderScope(lat, lng)]) {
        if (st === "TX") expect(pipes(scope)).toEqual(["txrrc_pipe"]);
        else expect(pipes(scope).sort()).toEqual([...EIA].sort());
      }
    });
  }
  it("Shreveport (inside the old Texas box) gets the national row, not the Texas Railroad Commission one", () => {
    const rows = rowsFor(plannerScope(32.5252, -93.7502));
    expect(rows).not.toContain("txrrc_pipe");
    expect(rows).not.toContain("txrrc_wells");
    for (const id of EIA) expect(rows).toContain(id);
  });
  it("Houston keeps every Texas row it had", () => {
    const rows = rowsFor(plannerScope(29.7604, -95.3698));
    expect(rows).toContain("txrrc_pipe");
    for (const id of EIA) expect(rows).not.toContain(id);
  });
});
