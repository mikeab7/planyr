/* NEW-1 (FL/GA pipelines) — the screening rule: for Florida and Georgia, an empty pipeline answer is
 * NEVER "clear". Three halves:
 *   1. the pure combiner (`eiaPipelineScreen.js`) — every outcome, the wording, the 811 pointers;
 *   2. the real orchestrator (`runSiteAnalysis`) driven with an injected fetch, so the STATE ROUTING is
 *      proven end to end — including that a Texas-only source is never queried at a Florida coordinate
 *      (the pre-change behaviour, which rendered "No mapped RRC pipelines crossing the site"), and that
 *      Texas is byte-for-byte unchanged (still TxRRC, still authoritative, still "absent" when empty);
 *   3. the registry + Layers panel wiring — one row per layer, FL/GA-scoped, URLs from the registry.
 *
 * RED PROOF (measured 2026-09-30): with `runSiteAnalysis`'s state gate removed (the pre-change logic)
 * the "FL/GA never clear" block goes red on the routing tests — a Florida ring reads status "absent"
 * with the summary "No mapped RRC pipelines crossing the site". */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(() => null), cachedPipelineLayer: vi.fn(() => null), cachedCorridorLayer: vi.fn(() => null), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  EIA_COMMODITIES, EIA_SCREEN_STATES, isEiaScreenState, EIA_BUFFER_MI,
} from "../src/workspaces/site-planner/lib/eiaPipelineScreen.js";
import {
  combineEiaFindings, outOfStateFinding, siteCheckPointers, pointerLine,
} from "../src/workspaces/site-planner/lib/eiaPipelineScreenCopy.js";
import { runSiteAnalysis, EIA_PIPELINE_SOURCES, ANALYSIS_SOURCES } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { siteState, STATE_POLYGONS } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { GIS_SOURCES, EIA_PIPELINE_KEYS, statesFor, sourceCoversState, auditRegistry, gisSource } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { ALL_LAYERS, attachFeatureRetry } from "../src/workspaces/site-planner/lib/layers.js";

const NEVER_CLEAR = ["absent"];
const CLEAR_WORDS = /\b(no mapped|none found|clear of|all[- ]clear|no pipelines)\b/i; // the wording of a "clean" verdict

const part = (i, finding) => ({ commodity: EIA_COMMODITIES[i], finding: { id: EIA_COMMODITIES[i].key, ...finding } });
const empty = (i) => part(i, { status: "unknown", summary: null, detail: [], error: null });
const hit = (i, summary = "1 natural gas line(s) within 1 mi — nearest 300 ft: Sabal Trail") =>
  part(i, { status: "present", summary, detail: ["Sabal Trail · 300 ft"], error: null });
const failed = (i) => part(i, { status: "unavailable", summary: null, detail: [], error: "timeout" });

describe("combineEiaFindings — no outcome is ever 'clear'", () => {
  for (const state of ["FL", "GA"]) {
    it(`${state}: all four layers answered and nothing hit → "unconfirmed", never "absent"`, () => {
      const f = combineEiaFindings([0, 1, 2, 3].map(empty), { state });
      expect(f.status).toBe("unconfirmed");
      expect(NEVER_CLEAR).not.toContain(f.status);
      expect(f.summary).toMatch(/^Not confirmed/);
      expect(f.summary).not.toMatch(CLEAR_WORDS); // the only "clear" in the text is the explicit negation
      expect(f.summary).toMatch(/not "clear"/);
      expect(f.verified).toBe(false);
      expect(f.approximate).toBe(true);
    });

    it(`${state}: the "not confirmed" answer carries the real site checks — title, ALTA survey, that state's 811`, () => {
      const f = combineEiaFindings([0, 1, 2, 3].map(empty), { state });
      const all = [f.summary, ...f.detail].join(" | ");
      expect(all).toMatch(/title commitment/i);
      expect(all).toMatch(/ALTA survey/i);
      expect(all).toMatch(state === "FL" ? /Sunshine 811/ : /Georgia 811/);
      expect(all).not.toMatch(state === "FL" ? /Georgia 811/ : /Sunshine 811/);
    });
  }

  it("a layer that FAILED with no hit anywhere is `unavailable` (retryable), never clear and never 'not confirmed'", () => {
    const f = combineEiaFindings([empty(0), failed(1), empty(2), empty(3)], { state: "GA" });
    expect(f.status).toBe("unavailable");
    expect(f.error).toMatch(/petroleum products/);
    expect(f.error).toMatch(/not a clear result/);
    expect(f.summary).toBeNull();
    expect(f.detail.join(" ")).toMatch(/811/); // the pointers still ride the failure
  });

  it("NO layers at all is `unavailable`, not a vacuous 'not confirmed'", () => {
    expect(combineEiaFindings([], { state: "FL" }).status).toBe("unavailable");
  });

  it("a hit is reported, labelled approximate, and toggles the layer that hit", () => {
    const f = combineEiaFindings([hit(0), empty(1), empty(2), empty(3)], { state: "FL" });
    expect(f.status).toBe("present");
    expect(f.summary).toMatch(/^Approximate/);
    expect(f.mapLayer).toBe("eia_gas");
    expect(f.detail.join(" ")).toMatch(/Sabal Trail/);
    expect(f.caveat).toMatch(/APPROXIMATE/);
  });

  it("a hit alongside a failed layer still names the failure (a partial answer is not a whole one)", () => {
    const f = combineEiaFindings([hit(0), failed(1), empty(2), empty(3)], { state: "GA" });
    expect(f.status).toBe("present");
    expect(f.detail.join(" ")).toMatch(/didn't load/);
  });

  it("the panel label says approximate + transmission-only (short, plain wording)", () => {
    const f = combineEiaFindings([0, 1, 2, 3].map(empty), { state: "FL" });
    expect(f.label).toMatch(/approximate/i);
    expect(f.label).toMatch(/transmission/i);
  });
});

describe("outOfStateFinding — a Texas-only source on a non-Texas site is never 'none found'", () => {
  it("is `unconfirmed`, names the state and says it is a gap in what Planyr carries", () => {
    const f = outOfStateFinding({ id: "oilgas", category: "Oil & gas wells", label: "Oil & gas well surface locations" }, "FL");
    expect(f.status).toBe("unconfirmed");
    expect(f.summary).toMatch(/Not available in Florida/);
    expect(f.summary).toMatch(/not a finding/);
    expect(f.outOfState).toBe(true);
  });
});

/* ---- the orchestrator: state routing, end to end (injected fetch — no network) ---- */
const ring = (lng, lat, d = 0.002) => [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
const FL_RINGS = ring(-82.05, 28.5);   // Ocala/Lake County, FL
const GA_RINGS = ring(-84.39, 33.75);  // Atlanta, GA
const TX_RINGS = ring(-94.886, 29.846); // Mont Belvieu, TX

function harness({ hitsFor = () => 0, failFor = () => false } = {}) {
  const calls = [];
  const fetchJson = vi.fn(async (url, o) => {
    calls.push(String(url));
    if (failFor(String(url))) throw new Error("HTTP 503");
    const n = hitsFor(String(url));
    const q = String(url) + " " + JSON.stringify((o && o.body) || {});
    if (/returnCountOnly=true/.test(q)) return { count: n };
    return {
      features: Array.from({ length: n }, (_, i) => ({
        attributes: { Operator: "TEST OP", Pipename: "Test line", OPERATOR: "TX OP", OBJECTID: i },
        geometry: { paths: [[[-82.05, 28.5], [-82.04, 28.51]]] },
      })),
    };
  });
  const opts = {
    cache: freshCache(),
    fetchJson,
    identifyJurisdiction: async () => ({ county: [], city: [], etj: [], unincorporated: true, ages: {}, sources: [] }),
    identifyRoadAuthority: async () => ({ roads: [] }),
  };
  return { opts, calls, fetchJson };
}
function freshCache() {
  // a private in-memory swr so tests never share state through the module-level cache
  const store = new Map();
  return {
    swr(key, fetcher) {
      if (!store.has(key)) store.set(key, fetcher().then((data) => ({ data, error: null, ts: 1, ageMs: 0 }), (error) => ({ data: null, error, ts: null, ageMs: null })));
      return { fresh: store.get(key) };
    },
  };
}
const pipelines = (r) => r.findings.find((f) => f.id === "pipelines");
const oilgas = (r) => r.findings.find((f) => f.id === "oilgas");

describe("runSiteAnalysis — FL/GA pipelines route to EIA and are never clear", () => {
  for (const [name, rings, st] of [["Florida", FL_RINGS, "FL"], ["Georgia", GA_RINGS, "GA"]]) {
    it(`${name} site with ZERO EIA hits → pipelines is "unconfirmed", not "absent"`, async () => {
      const { opts } = harness({ hitsFor: () => 0 });
      const r = await runSiteAnalysis(rings, opts);
      expect(r.site.state).toBe(st);
      const p = pipelines(r);
      expect(p.status).toBe("unconfirmed");
      expect(p.status).not.toBe("absent");
      expect(p.summary).toMatch(/Not confirmed/);
      expect(p.summary).not.toMatch(/No mapped RRC pipelines/);
    });

    it(`${name}: the Texas RRC service is never asked about a ${name} coordinate`, async () => {
      const { opts, calls } = harness();
      await runSiteAnalysis(rings, opts);
      expect(calls.filter((u) => /gis\.rrc\.texas\.gov/.test(u))).toEqual([]);
      // …and the four EIA services ARE asked
      for (const k of EIA_PIPELINE_KEYS) expect(calls.some((u) => u.startsWith(GIS_SOURCES[k].serviceUrl)), k).toBe(true);
    });

    it(`${name}: the Texas-only wells source is 'not available', never "No mapped oil & gas wells"`, async () => {
      const { opts } = harness();
      const w = oilgas(await runSiteAnalysis(rings, opts));
      expect(w.status).toBe("unconfirmed");
      expect(w.summary).toMatch(new RegExp(`Not available in ${name}`));
      expect(w.summary).not.toMatch(/No mapped oil/);
    });

    it(`${name}: no finding anywhere is the green "absent" for a Texas-only source`, async () => {
      const { opts } = harness();
      const r = await runSiteAnalysis(rings, opts);
      for (const s of ANALYSIS_SOURCES) {
        if (!statesFor(GIS_SOURCES[s.id])) continue; // national rows may legitimately be absent
        expect(r.findings.find((f) => f.id === s.id).status, s.id).not.toBe("absent");
      }
    });
  }

  it("a hit on a FL site is reported present and labelled approximate", async () => {
    const { opts } = harness({ hitsFor: (u) => (u.startsWith(GIS_SOURCES.eiaGas.serviceUrl) ? 2 : 0) });
    const p = pipelines(await runSiteAnalysis(FL_RINGS, opts));
    expect(p.status).toBe("present");
    expect(p.summary).toMatch(/^Approximate/);
    expect(p.mapLayer).toBe("eia_gas");
  });

  it("one EIA service erroring with no hit elsewhere is `unavailable` — an outage never reads as clear", async () => {
    const { opts } = harness({ failFor: (u) => u.startsWith(GIS_SOURCES.eiaPetroleum.serviceUrl) });
    const p = pipelines(await runSiteAnalysis(GA_RINGS, opts));
    expect(p.status).toBe("unavailable");
    expect(p.error).toMatch(/petroleum products/);
  });

  it("every EIA source is `verified:false`, so the proximity engine itself can never emit 'absent' for them", () => {
    for (const s of EIA_PIPELINE_SOURCES) expect(s.verified).toBe(false);
    expect(EIA_PIPELINE_SOURCES.map((s) => s.id)).toEqual(EIA_PIPELINE_KEYS);
  });
});

describe("Texas regression — unchanged: still TxRRC, still authoritative", () => {
  it("a Texas site queries the RRC pipelines + wells services and never an EIA one", async () => {
    const { opts, calls } = harness({ hitsFor: () => 0 });
    const r = await runSiteAnalysis(TX_RINGS, opts);
    expect(r.site.state).toBe("TX");
    expect(calls.some((u) => u.startsWith(GIS_SOURCES.pipelines.serviceUrl))).toBe(true);
    expect(calls.some((u) => u.startsWith(GIS_SOURCES.oilgas.serviceUrl))).toBe(true);
    expect(calls.filter((u) => /FiaPA4ga0iQKduv3.*(Pipelines|Pipeline)/.test(u))).toEqual([]);
  });

  it("an empty Texas answer is still the verified 'absent' with the RRC wording (the authoritative source's contract)", async () => {
    const { opts } = harness({ hitsFor: () => 0 });
    const p = pipelines(await runSiteAnalysis(TX_RINGS, opts));
    expect(p.status).toBe("absent");
    expect(p.summary).toBe("No mapped RRC pipelines crossing the site");
    expect(p.verified).toBe(true);
    expect(p.sourceName).toMatch(/Railroad Commission/);
  });

  it("an UNKNOWN state (outside every region) keeps the legacy behaviour — the gate fires on a POSITIVE mismatch only", async () => {
    const { opts, calls } = harness();
    const r = await runSiteAnalysis(ring(-100.0, 41.0), opts); // Nebraska
    expect(r.site.state).toBeNull();
    expect(calls.some((u) => u.startsWith(GIS_SOURCES.pipelines.serviceUrl))).toBe(true);
  });
});

describe("siteState — Florida and Georgia are real outlines, and neighbours are not swept in", () => {
  const cases = [
    ["Atlanta", 33.75, -84.39, "GA"], ["Savannah", 32.08, -81.09, "GA"], ["Augusta", 33.47, -81.97, "GA"], ["Columbus", 32.46, -84.99, "GA"],
    ["Jacksonville", 30.33, -81.66, "FL"], ["Tampa", 27.95, -82.46, "FL"], ["Miami", 25.76, -80.19, "FL"], ["Pensacola", 30.42, -87.22, "FL"],
    ["Key West", 24.56, -81.78, "FL"], ["Naples", 26.14, -81.79, "FL"], ["Tallahassee", 30.44, -84.28, "FL"],
    ["Birmingham AL", 33.52, -86.8, null], ["Montgomery AL", 32.37, -86.3, null], ["Gulf Shores AL", 30.25, -87.7, null],
    ["Charleston SC", 32.78, -79.93, null],
    // B1990960 (main): Georgia's ROUTING BOX is deliberately generous and answers "GA" for the SC / TN edges (fail-closed:
    // a wrong "GA" only hides a Texas number). Which of those points is truly Georgia is decided by county polygons in
    // jurisdiction.js. Pinned so a change to that decision is a visible one.
    ["Aiken SC (inside the GA routing box)", 33.56, -81.72, "GA"], ["Chattanooga TN (inside the GA routing box)", 35.05, -85.3, "GA"],
    // …but FLORIDA north of the box floor is Florida, not Georgia — the outlines are asked first.
    ["Jacksonville FL (inside the GA routing box)", 30.33, -81.66, "FL"], ["Tallahassee FL (inside the GA routing box)", 30.44, -84.28, "FL"],
    ["Houston TX", 29.76, -95.37, "TX"], ["Denver CO", 39.7, -104.99, "CO"],
  ];
  for (const [n, lat, lng, want] of cases) it(`${n} → ${want}`, () => expect(siteState({ lat, lng })).toBe(want));
  it("both outlines are closed simple rings of ≥ 3 vertices", () => {
    for (const poly of Object.values(STATE_POLYGONS)) expect(poly.length).toBeGreaterThanOrEqual(3);
  });
  it("is EIA-screen state only for FL and GA", () => {
    expect(EIA_SCREEN_STATES).toEqual(["FL", "GA"]);
    expect(isEiaScreenState("TX")).toBe(false);
    expect(isEiaScreenState(null)).toBe(false);
  });
});

describe("registry — one entry per layer, coverage + tier + lastVerified, scoped to FL/GA, no URL hardcoded twice", () => {
  it("the four rows exist, are FL/GA-scoped and pass the registry audit with their fixtures", () => {
    expect(EIA_PIPELINE_KEYS).toEqual(["eiaGas", "eiaPetroleum", "eiaCrude", "eiaHgl"]);
    for (const k of EIA_PIPELINE_KEYS) {
      const s = gisSource(k);
      expect(statesFor(s)).toEqual(["FL", "GA"]);
      expect(s.tier).toBe("monitored-exception");
      expect(SOURCE_DOCS[k].tierReason).toMatch(/republication/i);
      expect(s.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.coverage).toBeTruthy();
      expect(s.provider).toMatch(/Energy Information Administration/);
      expect(SOURCE_FIXTURES[k].fixtures.length).toBeGreaterThan(0);
    }
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });

  it("a Texas site never gets an EIA row, and FL/GA never get a TxRRC one", () => {
    for (const k of EIA_PIPELINE_KEYS) {
      expect(sourceCoversState(GIS_SOURCES[k], "TX")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "FL")).toBe(true);
      expect(sourceCoversState(GIS_SOURCES[k], "GA")).toBe(true);
    }
    for (const k of ["pipelines", "oilgas"]) {
      expect(sourceCoversState(GIS_SOURCES[k], "FL")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "GA")).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "TX")).toBe(true);
    }
  });

  it("no EIA / Esri Federal pipeline URL appears anywhere but the registry (layers + analysis read it from there)", () => {
    for (const [id, key] of [["eia_gas", "eiaGas"], ["eia_petroleum", "eiaPetroleum"], ["eia_crude", "eiaCrude"], ["eia_hgl", "eiaHgl"]]) {
      expect(ALL_LAYERS[id].url).toBe(GIS_SOURCES[key].serviceUrl);
    }
    for (const s of EIA_PIPELINE_SOURCES) expect(s.url).toBe(GIS_SOURCES[s.id].serviceUrl);
  });
});

describe("Layers panel — labels say approximate, transmission-only, FL/GA-scoped", () => {
  const rows = ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"].map((id) => [id, ALL_LAYERS[id]]);
  it("all four layers exist", () => expect(rows.every(([, c]) => c && c.kind === "esriFeature")).toBe(true));
  for (const [id, cfg] of rows) {
    it(`${id}: 'approx.' in the label; detail behind the info icon names transmission-only and no mains/gathering; FL/GA only`, () => {
      expect(cfg.label).toMatch(/approx/i);
      expect(cfg.sublabel).toMatch(/Approximate/);
      expect(cfg.sublabel).toMatch(/transmission/i);
      expect(cfg.sublabel).toMatch(/no local gas mains or gathering lines/i);
      expect(cfg.infoCaveat).toMatch(/Sunshine 811/);
      expect(cfg.infoCaveat).toMatch(/Georgia 811/);
      expect(cfg.states).toEqual(["FL", "GA"]);
      expect(cfg.label.length).toBeLessThan(45); // short text in the row; the detail lives behind ⓘ
    });
  }
  it("the Texas pipeline layer is untouched (TX-only, authoritative TxRRC)", () => {
    expect(ALL_LAYERS.txrrc_pipe.states).toEqual(["TX"]);
    expect(ALL_LAYERS.txrrc_pipe.imageFallback.url).toBe(GIS_SOURCES.pipelines.serviceUrl);
  });
  it("pointer helpers name the right state's one-call centre", () => {
    expect(pointerLine("FL")).toMatch(/Sunshine 811/);
    expect(pointerLine("GA")).toMatch(/Georgia 811/);
    expect(siteCheckPointers("FL").length).toBe(3);
    expect(EIA_BUFFER_MI).toBeGreaterThan(0);
  });
});

describe("an EMPTY view on an approximate EIA layer never reads as 'no pipelines'", () => {
  const fake = (snapshot) => {
    const h = {};
    return { _currentSnapshot: snapshot, on(e, cb) { h[e] = cb; return this; }, fire(e, ...a) { h[e] && h[e](...a); } };
  };
  it("the row reports the layer's own honest-empty wording, not the generic 'No features in this view.'", () => {
    const lyr = fake([]);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "eia_petroleum", ALL_LAYERS.eia_petroleum, onStatus);
    lyr.fire("load");
    expect(onStatus).toHaveBeenCalledWith("eia_petroleum", "empty", "None mapped in this view — not proof there are none.");
  });
  it("a layer with no override keeps the generic wording (nothing else moved)", () => {
    const lyr = fake([]);
    const onStatus = vi.fn();
    attachFeatureRetry(lyr, "bts_rail", ALL_LAYERS.bts_rail, onStatus);
    lyr.fire("load");
    expect(onStatus).toHaveBeenCalledWith("bts_rail", "empty", "No features in this view.");
  });
});
