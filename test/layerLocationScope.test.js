/* NEW-1 (owner 2026-10-29) — a layer is offered ONLY where its source serves, and both surfaces answer the same for the same point.
 *
 * THE FINDING (measured on main 793f75e): `layerAvailableHere` hid a row only on a POSITIVE state mismatch and treated "no state" as
 * "unknown → show everything". But `siteState` answers null for every located point in a state the app has no region for (Kentucky,
 * Ohio, Tennessee's neighbours …), so such a site was offered every Texas row — the Texas Railroad Commission Pipelines row among
 * them — while the one pipeline source that works outside Texas (the four EIA rows) was offered only in Florida and Georgia. A
 * Tennessee point, which the app does resolve, already hid the Texas rows but got NO pipeline row at all.
 *
 * This drives the real panel model (`availableEntries` over the real registry) at one point per state the app knows plus Kentucky,
 * from the two hosts' own scopes (planner: plan origin + its siteState; finder: the rounded view centre + the centre's siteState). */
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
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { PANEL_GROUPS, groupEntriesFor, availableEntries, layerAvailableHere, drawnOverlaysOf } from "../src/workspaces/site-planner/lib/layerPanelModel.js";

beforeAll(() => _setServiceAreas(SERVICE_AREAS));

/* One point per state the app knows, two in Texas (inside Houston and well outside it), and Kentucky — a state with NO region. */
const POINTS = {
  txHouston: { st: "TX", lat: 29.7604, lng: -95.3698 },
  txDallas: { st: "TX", lat: 32.7767, lng: -96.797 },
  tn: { st: "TN", lat: 36.1627, lng: -86.7816 },
  ga: { st: "GA", lat: 33.749, lng: -84.388 },
  fl: { st: "FL", lat: 25.7617, lng: -80.1918 },
  co: { st: "CO", lat: 39.7392, lng: -104.9903 },
  ca: { st: "CA", lat: 34.0522, lng: -118.2437 },
  nj: { st: "NJ", lat: 40.7357, lng: -74.1724 },
  ny: { st: "NY", lat: 42.6526, lng: -73.7562 },
  ky: { st: null, lat: 38.2527, lng: -85.7585 }, // Louisville — siteState() has no answer for it
};
const EIA = ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"];

const groups = PANEL_GROUPS.filter((g) => g.key !== "base").map((g) => g.key);
const rowsFor = (scope) => groups.flatMap((g) => availableEntries(groupEntriesFor(ALL_LAYERS, g), scope).map(([id]) => id)).sort();
/* the planner's scope: the plan origin and the state resolved from it (SitePlanner.jsx layerScopeState) */
const plannerScope = (p) => ({ state: siteState({ lat: p.lat, lng: p.lng }), loc: { lat: p.lat, lng: p.lng } });
/* the finder's scope: the view centre's state, and the centre rounded to a 0.05° cell (MapFinder.jsx onMove) */
const finderScope = (p) => ({ state: siteState({ lat: p.lat, lng: p.lng }), loc: { lat: Math.round(p.lat * 20) / 20, lng: Math.round(p.lng * 20) / 20 } });

describe("the points are what this test says they are", () => {
  it("siteState resolves each known point, and has no answer for Kentucky (the case that used to fail open)", () => {
    for (const [k, p] of Object.entries(POINTS)) expect(siteState({ lat: p.lat, lng: p.lng }), k).toBe(p.st);
  });
});

describe("no row is offered where its source does not serve", () => {
  for (const [k, p] of Object.entries(POINTS)) {
    it(`${k}: no state-scoped row from another state, no row excluded from here`, () => {
      for (const id of rowsFor(plannerScope(p))) {
        const c = ALL_LAYERS[id];
        if (c.states) expect(p.st && c.states.includes(p.st), `${id} ${JSON.stringify(c.states)} offered at ${k}`).toBe(true);
        if (c.statesNot) expect(c.statesNot.includes(p.st), `${id} excluded from ${p.st} but offered at ${k}`).toBe(false);
      }
    });
  }
  it("Kentucky is offered no Texas row at all (the RRC Pipelines, Oil & Gas, Road Ownership… rows used to appear)", () => {
    const ky = rowsFor(plannerScope(POINTS.ky));
    for (const id of ["txrrc_pipe", "txrrc_pipe_easement", "txrrc_wells", "env_lpst", "txdot_aadt", "jur_county", "jur_road_authority", "hcfcd_row", "coh_storm"]) expect(ky, id).not.toContain(id);
  });
  it("…and a point-less scope (no state, no coordinates) still shows everything — unknown is not 'somewhere else'", () => {
    const all = rowsFor({ state: null, loc: null });
    expect(all).toContain("txrrc_pipe");
    expect(all).toContain("eia_gas");
  });
});

describe("Pipelines is the RRC row in Texas and the EIA row everywhere else", () => {
  for (const [k, p] of Object.entries(POINTS)) {
    it(`${k}`, () => {
      const rows = rowsFor(plannerScope(p));
      const pipes = rows.filter((id) => ALL_LAYERS[id].mergeGroup === "pipelines");
      if (p.st === "TX") expect(pipes).toEqual(["txrrc_pipe"]);
      else expect(pipes.sort()).toEqual([...EIA].sort());
    });
  }
  it("the assumed easement corridor (the RRC row's setting) is offered in Texas only", () => {
    for (const [k, p] of Object.entries(POINTS)) expect(layerAvailableHere(ALL_LAYERS.txrrc_pipe_easement, plannerScope(p)), k).toBe(p.st === "TX");
  });
  it("the EIA rows keep their approximate / transmission-only wording and say nothing state-specific about 811", () => {
    for (const id of EIA) {
      const c = ALL_LAYERS[id];
      expect(c.statesNot).toEqual(["TX"]);
      expect(c.states).toBeUndefined();
      expect(c.sublabel).toMatch(/Approximate/);
      expect(c.emptyMsg).toMatch(/not proof there are none/);
      expect(c.infoCaveat).toMatch(/811/);
      expect(c.infoCaveat).not.toMatch(/Sunshine|Georgia 811|Florida/);
    }
  });
});

describe("planner and finder list the same rows for the same point", () => {
  for (const [k, p] of Object.entries(POINTS)) {
    it(`${k}`, () => expect(rowsFor(finderScope(p))).toEqual(rowsFor(plannerScope(p))));
  }
  it("…even when the host hands over a location but no state (the state is a function of the point)", () => {
    for (const [k, p] of Object.entries(POINTS)) expect(rowsFor({ state: null, loc: { lat: p.lat, lng: p.lng } }), k).toEqual(rowsFor(plannerScope(p)));
  });
});

describe("a layer saved ON where its source does not serve is not drawn there, and the saved state is untouched", () => {
  const saved = { txrrc_pipe: { on: true }, txrrc_pipe_easement: { on: true }, eia_gas: { on: true }, fema: { on: true } };
  const drawn = (p) => drawnOverlaysOf(saved, { layers: ALL_LAYERS, scope: plannerScope(p) });
  it("Tennessee and Kentucky: the RRC lines and corridor are off, the EIA line and FEMA stay on", () => {
    for (const k of ["tn", "ky"]) {
      const d = drawn(POINTS[k]);
      expect(d.txrrc_pipe.on, k).toBe(false);
      expect(d.txrrc_pipe_easement.on, k).toBe(false);
      expect(d.eia_gas.on, k).toBe(true);
      expect(d.fema.on, k).toBe(true);
    }
  });
  it("Texas: the EIA line is off, the RRC lines stay on", () => {
    const d = drawn(POINTS.txHouston);
    expect(d.eia_gas.on).toBe(false);
    expect(d.txrrc_pipe.on).toBe(true);
  });
  it("saved state is never written to", () => {
    const before = JSON.stringify(saved);
    drawn(POINTS.tn);
    expect(JSON.stringify(saved)).toBe(before);
  });
});

describe("the sweep: every row that declares where it serves is offered where it says it serves", () => {
  it("a row with `states` and no `regions` is offered at a point in each of its states", () => {
    const stPoint = {};
    for (const p of Object.values(POINTS)) if (p.st) stPoint[p.st] ??= p;
    for (const [id, c] of Object.entries(ALL_LAYERS)) {
      if (!c.states || (c.regions && c.regions.length)) continue;
      for (const st of c.states) {
        const p = stPoint[st];
        expect(p, `${id}: no probe point for ${st}`).toBeTruthy();
        expect(layerAvailableHere(c, plannerScope(p)), `${id} should be offered in ${st}`).toBe(true);
      }
    }
  });
  it("every row's scope names only states the app can resolve, in `states` and `statesNot` alike", () => {
    const known = new Set(Object.values(POINTS).map((p) => p.st).filter(Boolean));
    for (const [id, c] of Object.entries(ALL_LAYERS)) for (const st of [...(c.states || []), ...(c.statesNot || [])]) expect(known.has(st), `${id}: ${st}`).toBe(true);
  });
});
